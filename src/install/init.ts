// `capsules init` (C15): show a plan of every file it will create or change, confirm, then
// set up .capsules/, the agent files and the hooks, and record it all in installed.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { applyCompile, compilePlan } from "../compile/compile.js";
import { serializeLock, updateLock, LOCK_FILE } from "../core/lock.js";
import { loadProject, toPosix, UsageError } from "../core/project.js";
import { gitToplevel } from "../git/git.js";
import { configuredEmail, tryGit } from "../git/history.js";
import { findRoot } from "../hooks/index-cache.js";
import { errors } from "../report/messages.js";
import {
  blobHash,
  cliPath,
  emptyLocal,
  emptyManifest,
  LOCAL_MANIFEST,
  MANIFEST,
  readLocal,
  readManifest,
  template,
  writeJsonFile,
  type LocalManifest,
  type Manifest,
} from "./manifest.js";
import { hasOurHooks, mergeHooks } from "./settings-merge.js";

export const AGENT_KINDS = ["claude-code", "cursor", "agents-md"] as const;

export interface InitOptions {
  agents?: string;
  gitHooks?: boolean;
  workflow?: boolean;
}

export interface Step {
  path: string;
  change: "create" | "update" | "merge" | "delete" | "keep" | "skip";
  why: string;
}

/** Template files installed for Claude Code (C12). /capsules-map arrives with the map in M5. */
export const CLAUDE_TEMPLATES: [string, string][] = [
  [".claude/commands/capsules-draft.md", "claude/commands/capsules-draft.md"],
  [".claude/commands/capsules-work.md", "claude/commands/capsules-work.md"],
  [".claude/commands/capsules-judge.md", "claude/commands/capsules-judge.md"],
  [".claude/commands/capsules-map.md", "claude/commands/capsules-map.md"],
  [".claude/agents/capsules-judge.md", "claude/agents/capsules-judge.md"],
  [".claude/agents/capsules-drafter.md", "claude/agents/capsules-drafter.md"],
  [".claude/skills/capsules/SKILL.md", "claude/skills/capsules/SKILL.md"],
];
const WORKFLOW: [string, string] = [
  ".github/workflows/capsules.yml",
  "github/workflows/capsules.yml",
];
export const SETTINGS_LOCAL = ".claude/settings.local.json";
export const HOOK_MARKER = "# Added by capsules init --git-hooks.";

export interface InitPlan {
  root: string;
  steps: Step[];
  /** Set when the starter permissions.yaml can't recognise the owner's commits yet. */
  ownerHint: string | null;
  apply: () => void;
}

const abs = (root: string, p: string) => join(root, ...p.split("/"));
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);

/** The starter .capsules/ files for a project that has none. */
function starter(
  root: string,
  agents: string[],
): { files: [string, string][]; owner: string; known: boolean } {
  const email = configuredEmail(root) ?? "";
  const handle = /^(?:\d+\+)?([A-Za-z0-9-]+)@users\.noreply\.github\.com$/i.exec(email)?.[1];
  const name = tryGit(["config", "user.name"], root)?.trim() ?? "";
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const owner = slug(handle ?? "") || slug(name) || "owner";
  const fill = (t: string) =>
    t
      .replaceAll("{{owner}}", owner)
      .replaceAll("{{github}}", handle ? `github: "${handle}", ` : "")
      .replaceAll("{{title}}", basename(root))
      .replaceAll("{{agents}}", agents.join(", "));
  return {
    files: [
      [".capsules/config.yaml", fill(template("capsules/config.yaml"))],
      [".capsules/permissions.yaml", fill(template("capsules/permissions.yaml"))],
      [".capsules/root.md", fill(template("capsules/root.md"))],
      [".capsules/.gitignore", template("capsules/gitignore")],
    ],
    owner,
    known: Boolean(handle),
  };
}

export function planInit(cwd: string, opts: InitOptions): InitPlan {
  const top = gitToplevel(cwd);
  if (!top) throw new UsageError(errors.notGitRepo(cwd));
  const root = findRoot(cwd) ?? top;
  const hasCapsules = existsSync(join(root, ".capsules"));
  const agents = opts.agents
    ? opts.agents.split(",").map((a) => a.trim())
    : hasCapsules
      ? null
      : ["claude-code"];
  for (const a of agents ?? [])
    if (!(AGENT_KINDS as readonly string[]).includes(a))
      throw new UsageError(errors.badAgentKind(a, [...AGENT_KINDS]));

  const manifest: Manifest = readManifest(root) ?? emptyManifest();
  const local: LocalManifest = readLocal(root) ?? emptyLocal();
  const ours = new Set(manifest.files.map((f) => f.path));
  const steps: Step[] = [];
  const writes: (() => void)[] = [];
  const createdDirs = new Set<string>();
  const ensureDir = (p: string) => {
    let d = dirname(p);
    const missing: string[] = [];
    while (d !== "." && d !== "" && !existsSync(abs(root, d))) {
      missing.push(d);
      d = dirname(d);
    }
    for (const m of missing) createdDirs.add(m.split("\\").join("/"));
  };

  // 1. .capsules/ (kept as it is if it exists).
  const start = hasCapsules ? null : starter(root, agents ?? ["claude-code"]);
  const starterFiles = start?.files ?? [];
  // Commits are matched to people by GitHub noreply address or the `emails` list (C5.3).
  const ownerHint =
    start && !start.known
      ? `capsules can't tell which commits are yours yet. In .capsules/permissions.yaml, give ${start.owner} your GitHub handle (github: "<handle>") and commit with your GitHub noreply address, or list your commit email under emails (it becomes public if the repo is).`
      : null;
  if (hasCapsules)
    steps.push({
      path: ".capsules/",
      change: "keep",
      why: "already exists; capsules and settings are left as they are",
    });
  for (const [p, text] of starterFiles) {
    steps.push({
      path: p,
      change: "create",
      why: "starter capsule settings (a draft: nothing blocks yet)",
    });
    writes.push(() => {
      mkdirSync(dirname(abs(root, p)), { recursive: true });
      writeFileSync(abs(root, p), text);
    });
  }
  if (!hasCapsules) {
    steps.push({ path: LOCK_FILE, change: "create", why: "fingerprints of the starter capsule" });
    manifest.createdCapsules = true;
  }
  const useAgents = agents ?? null; // null: read from config.yaml when applying

  // 2. Claude Code commands, sub-agents and skill.
  const wantClaude = (useAgents ?? configAgents(root)).includes("claude-code");
  if (wantClaude)
    for (const [p, t] of CLAUDE_TEMPLATES) {
      const text = template(t);
      const disk = read(abs(root, p));
      if (disk === null) {
        steps.push({ path: p, change: "create", why: "Claude Code command, sub-agent or skill" });
        ensureDir(p);
      } else if (disk.replace(/\r\n?/g, "\n") === text) {
        steps.push({ path: p, change: "keep", why: "already up to date" });
        continue;
      } else if (ours.has(p))
        steps.push({ path: p, change: "update", why: "newer version from capsules" });
      else {
        steps.push({
          path: p,
          change: "skip",
          why: "a file capsules didn't create is already there",
        });
        continue;
      }
      writes.push(() => {
        mkdirSync(dirname(abs(root, p)), { recursive: true });
        writeFileSync(abs(root, p), text);
        manifest.files = manifest.files.filter((f) => f.path !== p);
        manifest.files.push({ path: p, blob: blobHash(text) });
      });
    }

  // 3. Compiled agent rules (folders recorded, so remove can tidy them up).
  steps.push({
    path: ".claude/rules/capsules-*.md",
    change: "create",
    why: "agent rules generated by `capsules compile` (also .cursor/rules and AGENTS.md if enabled)",
  });
  for (const d of [".claude", ".claude/rules", ".cursor", ".cursor/rules"])
    if (!existsSync(abs(root, d))) createdDirs.add(d);

  // 4. Hooks in .claude/settings.local.json, kept out of Git (D-026).
  const cli = cliPath();
  if (wantClaude) {
    const p = SETTINGS_LOCAL;
    const before = read(abs(root, p));
    steps.push({
      path: p,
      change: before === null ? "create" : "merge",
      why: `Claude Code hooks (session-start, pre-edit, pre-bash, stop) running ${cli}; your own settings are kept`,
    });
    if (before === null) ensureDir(p);
    writes.push(() => {
      const now = read(abs(root, p));
      const merged = mergeHooks(now, p, cli);
      if (!local.settings.some((s) => s.path === p))
        local.settings.push({ path: p, before: hasOurHooks(now) ? null : now });
      mkdirSync(dirname(abs(root, p)), { recursive: true });
      writeFileSync(abs(root, p), merged);
    });
    // Keep it out of Git: Claude Code does this only for files it creates itself.
    const ignored = tryGit(["check-ignore", "-q", p], root) !== null;
    if (ignored)
      steps.push({
        path: p,
        change: "keep",
        why: "already ignored by Git, so no .git/info/exclude line is needed",
      });
    else {
      const excludeRel = tryGit(["rev-parse", "--git-path", "info/exclude"], root)?.trim();
      if (excludeRel) {
        const exclude = join(root, excludeRel);
        const line = "/" + toPosix(relative(top, abs(root, p)));
        steps.push({
          path: toPosix(relative(root, exclude)),
          change: "merge",
          why: `add "${line}" so Git ignores the per-machine settings`,
        });
        writes.push(() => {
          const before = read(exclude);
          const text =
            before === null ? "" : before.endsWith("\n") || before === "" ? before : before + "\n";
          mkdirSync(dirname(exclude), { recursive: true });
          writeFileSync(exclude, text + line + "\n");
          local.lines.push({ file: exclude.split("\\").join("/"), line, before });
        });
      }
    }
  }

  // 5. Optional commit-msg Git hook (D-023).
  if (opts.gitHooks) {
    const hooksRel = tryGit(["rev-parse", "--git-path", "hooks"], root)?.trim();
    if (hooksRel) {
      const hook = join(root, hooksRel, "commit-msg");
      const disk = read(hook);
      const shown = toPosix(relative(root, hook));
      if (disk !== null && !disk.includes(HOOK_MARKER))
        steps.push({
          path: shown,
          change: "skip",
          why: 'a commit-msg hook already exists; add `capsules hook commit-msg "$1"` to it yourself',
        });
      else {
        steps.push({
          path: shown,
          change: disk === null ? "create" : "update",
          why: "adds Capsule-* trailers to commit messages",
        });
        writes.push(() => {
          mkdirSync(dirname(hook), { recursive: true });
          writeFileSync(
            hook,
            `#!/bin/sh\n${HOOK_MARKER} Remove with: capsules remove\nexec node "${cli}" hook commit-msg "$1"\n`,
            { mode: 0o755 },
          );
          const h = hook.split("\\").join("/");
          if (!local.gitHooks.includes(h)) local.gitHooks.push(h);
        });
      }
    }
  }

  // 6. Optional CI workflow.
  if (opts.workflow) {
    const [p, t] = WORKFLOW;
    const disk = read(abs(root, p));
    if (disk !== null && !ours.has(p))
      steps.push({
        path: p,
        change: "skip",
        why: "a file capsules didn't create is already there",
      });
    else {
      const text = template(t);
      steps.push({
        path: p,
        change: disk === null ? "create" : "update",
        why: "runs `capsules check --ci` on pull requests",
      });
      if (disk === null) ensureDir(p);
      writes.push(() => {
        mkdirSync(dirname(abs(root, p)), { recursive: true });
        writeFileSync(abs(root, p), text);
        manifest.files = manifest.files.filter((f) => f.path !== p);
        manifest.files.push({ path: p, blob: blobHash(text) });
      });
    }
  }

  steps.push({
    path: MANIFEST,
    change: existsSync(abs(root, MANIFEST)) ? "update" : "create",
    why: "the record `capsules remove` uses to undo all of this",
  });

  const apply = () => {
    for (const w of writes) w();
    if (!hasCapsules) {
      const p = loadProject(root);
      writeFileSync(abs(root, LOCK_FILE), serializeLock(updateLock(null, p.current)));
    }
    // installed.json first, so compile and check treat the agent files as installed.
    manifest.dirs = [...new Set([...manifest.dirs, ...createdDirs])].sort();
    const project = loadProject(root);
    const agentsOn = project.config.agents;
    manifest.generated = agentsOn.filter((a) => a !== "agents-md").sort();
    if (agentsOn.includes("agents-md") && !manifest.agentsMd)
      manifest.agentsMd = { created: !existsSync(abs(root, "AGENTS.md")) };
    manifest.files.sort((a, b) => (a.path < b.path ? -1 : 1));
    writeJsonFile(abs(root, MANIFEST), manifest);
    applyCompile(project, compilePlan(project));
    writeJsonFile(abs(root, LOCAL_MANIFEST), local);
  };
  return { root, steps, ownerHint, apply };
}

function configAgents(root: string): string[] {
  try {
    return loadProject(root).config.agents;
  } catch {
    return ["claude-code"];
  }
}
