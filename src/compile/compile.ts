// `capsules compile` (C10): turn .capsules/ into rule files agents read. Deterministic: the
// same capsules always give the same bytes.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { agentMay } from "../core/access.js";
import { ancestorsOf, address, type Capsule, type CapsuleNode } from "../core/model.js";
import type { Project } from "../core/project.js";
import { buildIndex, targetOf } from "../core/resolve.js";
import { compileMsg, type Diagnostic } from "../report/messages.js";
import { AGENTS_BEGIN, AGENTS_END, MARKER, agentsBlock } from "./paths.js";

const firstLine = (s: string) =>
  s
    .split("\n")
    .find((l) => l.trim())
    ?.trim() ?? "";
const scopeOf = (n: CapsuleNode) =>
  n.fields.find((f) => f.key === "scope")?.value === "own" ? "own" : "tree";
const yamlString = (s: string) => JSON.stringify(s);

/** The capsules each file-carrying capsule's files are covered by (concerns), from membership. */
function concernsOf(project: Project, id: string): string[] {
  const out = new Set<string>();
  for (const m of project.membership.files.values())
    if (m.home === id) for (const c of m.concerns) out.add(c);
  return [...out].sort();
}

function section(title: string, lines: string[]): string[] {
  return lines.length ? [`## ${title}`, "", ...lines, ""] : [];
}

/** The Markdown body of one capsule's rule file (C10 items 1 to 6). `short` shrinks far content. */
function capsuleBody(project: Project, c: Capsule, short: boolean): string {
  const idx = buildIndex(project.capsules);
  const nodes = (t: CapsuleNode["type"]) => c.nodes.filter((n) => n.type === t);
  const title = c.front?.title ?? c.id;
  const out: string[] = [
    `# ${title} (capsule \`${c.id}\`${c.kind === "concern" ? ", a concern" : ""})`,
    "",
    `Source: \`${c.file}\`. Read it for the full text; run \`capsules explain <file>\` for any file.`,
    "",
  ];

  // 1. Intents.
  out.push(
    ...section(
      "What this part is for",
      nodes("intent").map((n) => `- **${address(c.id, n.id)}**: ${n.prose.replace(/\n+/g, " ")}`),
    ),
  );

  // 2. Contracts: own, inherited (scope: tree), from concerns.
  const contractLine = (capId: string, n: CapsuleNode) => {
    const checks = n.links
      .filter((l) => l.type === "checked-by")
      .map((l) => `\`${targetOf(l.ref, capId)}\``);
    return `- **${address(capId, n.id)}**: ${n.prose.replace(/\n+/g, " ")}${checks.length ? ` (checked by ${checks.join(", ")})` : ""}`;
  };
  const rules: string[] = nodes("contract").map((n) => contractLine(c.id, n));
  const far: { from: string; lines: string[]; brief: string }[] = [];
  const ancestors = c.kind === "area" ? ancestorsOf(c.id).filter((a) => idx.capsules.has(a)) : [];
  for (const a of ancestors) {
    const tree = (idx.capsules.get(a)?.nodes ?? []).filter(
      (n) => n.type === "contract" && scopeOf(n) === "tree",
    );
    if (tree.length)
      far.push({
        from: `inherited from \`${a}\``,
        lines: tree.map((n) => contractLine(a, n)),
        brief: `- From \`${a}\`: ${tree.map((n) => `\`${address(a, n.id)}\``).join(", ")}`,
      });
  }
  for (const k of c.kind === "area" ? concernsOf(project, c.id) : []) {
    const cs = (idx.capsules.get(k)?.nodes ?? []).filter((n) => n.type === "contract");
    if (cs.length)
      far.push({
        from: `from the \`${k}\` concern`,
        lines: cs.map((n) => contractLine(k, n)),
        brief: `- From the \`${k}\` concern: ${cs.map((n) => `\`${address(k, n.id)}\``).join(", ")}`,
      });
  }
  if (rules.length || far.length) {
    out.push("## Rules that must stay true", "");
    out.push(...rules);
    for (const f of far)
      if (short) out.push(f.brief);
      else out.push("", `Also ${f.from}:`, "", ...f.lines);
    out.push("");
  }

  // 3. Examples.
  out.push(
    ...section(
      "Examples",
      nodes("example").map((n) => {
        const shows = n.links.filter((l) => l.type === "shows").map((l) => targetOf(l.ref, c.id));
        return `- **${address(c.id, n.id)}** (shows ${shows.join(", ")}): ${n.prose.replace(/\n+/g, " ")}`;
      }),
    ),
  );

  // 4. Context, with transclusions resolved.
  const resolveText = (n: CapsuleNode) =>
    n.prose.replace(/\{\{\s*(@[^\s}]+)\s*\}\}/g, (whole, ref: string) => {
      const target = idx.nodes.get(ref.includes("#") ? ref.slice(1) : address(c.id, ref.slice(1)));
      return target ? target.prose.trim() : whole;
    });
  out.push(
    ...section(
      "Context",
      nodes("context").flatMap((n) => [`### ${n.id}`, "", resolveText(n), ""]),
    ),
  );

  // 5. Decisions in brief, with rejected options.
  const superseded = new Set<string>();
  for (const cap of project.capsules)
    for (const n of cap.nodes)
      for (const l of n.links) if (l.type === "supersedes") superseded.add(targetOf(l.ref, cap.id));
  out.push(
    ...section(
      "Decisions (don't re-suggest rejected options)",
      nodes("decision")
        .filter((n) => !superseded.has(address(c.id, n.id)))
        .flatMap((n) => [
          `- **${address(c.id, n.id)}**: ${firstLine(n.prose)}`,
          ...n.fields.filter((f) => f.key === "rejected").map((f) => `  - Rejected: ${f.value}`),
        ]),
    ),
  );

  // 6. What you may edit, must not edit, and how to propose a change.
  const perms = project.permissions;
  const concerns = c.kind === "area" ? concernsOf(project, c.id) : [c.id];
  const builders = Object.keys(perms.agents)
    .filter(
      (a) => agentMay(a, "edit-code", c.kind === "area" ? c.id : "root", concerns, perms).allowed,
    )
    .sort();
  const checkFiles = [
    ...new Set(
      nodes("check").flatMap((n) => n.fields.filter((f) => f.key === "files").map((f) => f.value)),
    ),
  ].sort();
  out.push(
    "## What you may and must not edit",
    "",
    `- **May edit code here:** ${builders.length ? builders.map((b) => `\`${b}\``).join(", ") : "no agent"}. Context notes and new decisions may be added; new tests may be added alongside code.`,
    `- **Must not edit:** existing checks${checkFiles.length ? ` (${checkFiles.map((f) => `\`${f}\``).join(", ")} and every file matching \`checks.files\`)` : ""}, existing decisions, \`.capsules/config.yaml\`, \`.capsules/permissions.yaml\`, the lockfile, and generated files.`,
    "- **The one rule:** never change code and an existing check that judges it in the same session, and never change a rule and the intent it serves together.",
    "- **To propose a change** to an intent, rule or example: edit it in the capsule file and say so; an owner approves it in the pull request. To change a decision, add a new one that `supersedes` it.",
    "",
  );
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function overviewBody(project: Project): string {
  const areas = project.capsules.filter((c) => c.kind === "area");
  const concerns = project.capsules.filter((c) => c.kind === "concern");
  const line = (c: Capsule) => {
    const intent = c.nodes.find((n) => n.type === "intent");
    const depth = c.id === "root" ? 0 : c.id.split(".").length;
    return `${"  ".repeat(depth)}- \`${c.id}\`: ${c.front?.title ?? c.id}${intent ? `. ${firstLine(intent.prose)}` : ""}`;
  };
  return [
    "# Capsules: what each part of this app is for",
    "",
    "This project keeps a record of what each part is meant to do in `.capsules/`. Each capsule lists intents (why it exists), rules that must stay true, the checks that prove them, and past decisions with rejected options.",
    "",
    "## Parts",
    "",
    ...areas.map(line),
    "",
    ...section(
      "Concerns (cut across parts)",
      concerns.map(
        (c) =>
          `- \`${c.id}\`: ${c.front?.title ?? c.id}. Covers ${(c.front?.covers ?? []).map((g) => `\`${g}\``).join(", ")}`,
      ),
    ),
    "## Before you change a file",
    "",
    "- Run `capsules explain <file>` to see its capsule, the rules it must keep and who may edit it.",
    "- Never weaken or delete an existing test to make it pass; fix the code. Never change code and an existing check that judges it in the same session.",
    '- Don\'t change an intent, rule, example or existing test to finish a task. If one looks wrong, run `capsules propose <address or test file> --why "<reason>"` and carry on.',
    "- If a capsules hook blocks an edit, don't try another way around it: carry on with the rest of the task.",
    "- Never edit an existing decision; add a new one that supersedes it.",
    "- Don't edit `.capsules/config.yaml`, `.capsules/permissions.yaml`, `.capsules/capsules.lock` or generated `capsules-*` rule files. After changing a capsule, run `capsules lock` and `capsules compile`.",
    "- Before finishing, run `capsules check --no-run`.",
    "",
  ].join("\n");
}

/** Every generated file and its exact contents, by project path. */
export function compileFiles(project: Project): Map<string, string> {
  const files = new Map<string, string>();
  const agents = project.config.agents;
  const max = project.config.rules["max-chars"];
  const withCovers = project.capsules.filter((c) => (c.front?.covers ?? []).length > 0);
  const body = (c: Capsule) => {
    const full = capsuleBody(project, c, false);
    return full.length <= max ? full : capsuleBody(project, c, true);
  };
  if (agents.includes("claude-code")) {
    files.set(".claude/rules/capsules-overview.md", `${MARKER}\n\n${overviewBody(project)}`);
    for (const c of withCovers) {
      const paths = c.front!.covers.map((g) => `  - ${yamlString(g)}`).join("\n");
      files.set(
        `.claude/rules/capsules-${c.id}.md`,
        `---\npaths:\n${paths}\n---\n${MARKER}\n\n${body(c)}`,
      );
    }
  }
  if (agents.includes("cursor")) {
    files.set(
      ".cursor/rules/capsules-overview.mdc",
      `---\ndescription: ${yamlString("What each part of this app is for, and the capsules rules")}\nalwaysApply: true\n---\n${MARKER}\n\n${overviewBody(project)}`,
    );
    for (const c of withCovers)
      files.set(
        `.cursor/rules/capsules-${c.id}.mdc`,
        `---\ndescription: ${yamlString(`Capsule ${c.id}: ${c.front!.title}`)}\nglobs: ${c.front!.covers.join(",")}\nalwaysApply: false\n---\n${MARKER}\n\n${body(c)}`,
      );
  }
  return files;
}

export function agentsMdBlock(project: Project): string {
  return [
    AGENTS_BEGIN,
    MARKER,
    "",
    "## Capsules",
    "",
    "This project records what each part is for in `.capsules/`. Before changing a file:",
    "",
    "- Run `capsules explain <file>` to see its capsule, rules, checks and who may edit it.",
    "- Run `capsules context <file>` for the full context, including past decisions and rejected options.",
    "- Never weaken or delete an existing test to make it pass, and never change code and an existing check that judges it in the same session.",
    "- Don't change an intent, rule, example or existing test to finish a task. If one looks wrong, run `capsules propose <address or test file> --why \"<reason>\"` and carry on. If a capsules hook blocks an edit, don't try another way around it.",
    "- Never edit an existing decision; add a new one that supersedes it.",
    "- Before finishing, run `capsules check --no-run`.",
    "",
    `Parts: ${project.capsules
      .filter((c) => c.kind === "area")
      .map((c) => `\`${c.id}\``)
      .join(", ")}.`,
    AGENTS_END,
  ].join("\n");
}

const GENERATED_DIRS: [string, RegExp][] = [
  [".claude/rules", /^capsules-.+\.md$/],
  [".cursor/rules", /^capsules-.+\.mdc$/],
];

export function generatedOnDisk(root: string): string[] {
  const out: string[] = [];
  for (const [dir, re] of GENERATED_DIRS) {
    const abs = join(root, ...dir.split("/"));
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs).sort()) if (re.test(name)) out.push(`${dir}/${name}`);
  }
  return out;
}

const readText = (p: string) =>
  existsSync(p) ? readFileSync(p, "utf8").replace(/\r\n?/g, "\n") : null;

export interface CompileChange {
  path: string;
  change: "create" | "update" | "delete";
}

/** What `capsules compile` would change. */
export function compilePlan(project: Project): {
  changes: CompileChange[];
  files: Map<string, string>;
} {
  const files = compileFiles(project);
  const changes: CompileChange[] = [];
  for (const [path, text] of files) {
    const disk = readText(join(project.root, ...path.split("/")));
    if (disk === null) changes.push({ path, change: "create" });
    else if (disk !== text) changes.push({ path, change: "update" });
  }
  for (const path of generatedOnDisk(project.root))
    if (!files.has(path)) changes.push({ path, change: "delete" });
  if (project.config.agents.includes("agents-md")) {
    const disk = readText(join(project.root, "AGENTS.md"));
    const block = agentsMdBlock(project);
    if (disk === null) changes.push({ path: "AGENTS.md", change: "create" });
    else if (agentsBlock(disk) !== block) changes.push({ path: "AGENTS.md", change: "update" });
  }
  changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { changes, files };
}

export function applyCompile(project: Project, plan: ReturnType<typeof compilePlan>): void {
  for (const { path, change } of plan.changes) {
    const abs = join(project.root, ...path.split("/"));
    if (change === "delete") {
      rmSync(abs, { force: true });
      continue;
    }
    if (path === "AGENTS.md") {
      const block = agentsMdBlock(project);
      const disk = readText(abs);
      const next =
        disk === null
          ? `${block}\n`
          : agentsBlock(disk) !== null
            ? disk.replace(agentsBlock(disk)!, block)
            : `${disk.replace(/\n*$/, "\n\n")}${block}\n`;
      writeFileSync(abs, next);
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, plan.files.get(path)!);
  }
}

/** `E011` for `capsules check`, once agent files are installed (D-024). */
export function compileDiagnostics(project: Project): Diagnostic[] {
  const installed =
    existsSync(join(project.root, ".capsules", "installed.json")) ||
    generatedOnDisk(project.root).length > 0 ||
    agentsBlock(readText(join(project.root, "AGENTS.md")) ?? "") !== null;
  if (!installed) return [];
  return compilePlan(project).changes.map((c) =>
    compileMsg.E011(
      c.path,
      c.change === "create" ? "missing" : c.change === "delete" ? "extra" : "differs",
    ),
  );
}
