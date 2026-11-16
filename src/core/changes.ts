// Change units (C6.1) and classifying each changed file (C5.2 step 1).
import {
  changesSince,
  commitChanges,
  commitsSince,
  configuredEmail,
  fileAt,
  revParse,
  WORKTREE,
  type ChangeStatus,
  type Commit,
} from "../git/history.js";
import type { Base } from "./base.js";
import { capsuleHash, nodeHash } from "./hash.js";
import { actorOf, humanFromEmail, trailer, type Actor } from "./identity.js";
import { LOCK_FILE } from "./lock.js";
import { isIgnored, membershipOf } from "./membership.js";
import type { Capsule, CapsuleNode, NodeType } from "./model.js";
import { parseCapsuleFile } from "./parse.js";
import type { Action } from "./permissions.js";
import { capsuleFromPath, checkFileMatcher as matcherFor } from "./judges.js";
import type { Project } from "./project.js";

export interface UnitFile {
  path: string;
  status: ChangeStatus;
  /** Where the "before" version lives (a commit), or null if the file is new. */
  beforeRev: string | null;
  /** Where the "after" version lives (a commit or WORKTREE). */
  afterRev: string;
}

export type UnitKind = "commit" | "session" | "whole-pr" | "uncommitted";

export interface ChangeUnit {
  kind: UnitKind;
  /** Plain words, e.g. `commit 1a2b3c4 "Fix invoices"`. */
  label: string;
  commits: Commit[];
  /** Who made it. null for the whole-PR unit, which mixes authors. */
  actor: Actor | null;
  files: UnitFile[];
}

const short = (sha: string) => sha.slice(0, 7);

/** File contents at a revision, cached: the same file is asked for by several units. */
export class Contents {
  private cache = new Map<string, string | null>();
  constructor(private root: string) {}
  get(rev: string | null, path: string): string | null {
    if (rev === null) return null;
    const key = `${rev}\0${path}`;
    if (!this.cache.has(key)) this.cache.set(key, fileAt(rev, path, this.root));
    return this.cache.get(key)!;
  }
}

/** Merge several commits' changes per path: before = first commit's parent, after = last commit. */
function mergeFiles(perCommit: { commit: Commit; files: UnitFile[] }[]): UnitFile[] {
  const byPath = new Map<string, UnitFile>();
  for (const { files } of perCommit) {
    for (const f of files) {
      const prev = byPath.get(f.path);
      byPath.set(f.path, prev ? { ...prev, afterRev: f.afterRev, status: f.status } : { ...f });
    }
  }
  const out: UnitFile[] = [];
  for (const f of byPath.values()) {
    const existedBefore = f.beforeRev !== null;
    const existsAfter = f.status !== "D";
    if (!existedBefore && !existsAfter) continue; // added, then deleted again
    out.push({
      ...f,
      status: !existedBefore ? "A" : !existsAfter ? "D" : "M",
      beforeRev: existedBefore ? f.beforeRev : null,
    });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * C6.1: one unit per commit; one per `Capsule-Session` with several commits; one for all
 * commits without a session trailer (the whole-PR unit); one for uncommitted changes.
 */
export function changeUnits(project: Project, base: Base): ChangeUnit[] {
  const root = project.root;
  const units: ChangeUnit[] = [];
  const commits = base.sha ? commitsSince(base.sha, root) : [];
  const perCommit = commits.map((c) => ({
    commit: c,
    files: commitChanges(c, root).map((p) => ({
      path: p.path,
      status: p.status,
      beforeRev: p.status === "A" ? null : c.parent,
      afterRev: c.sha,
    })),
  }));

  for (const { commit, files } of perCommit) {
    if (!files.length) continue;
    units.push({
      kind: "commit",
      label: `commit ${short(commit.sha)} "${commit.subject}"`,
      commits: [commit],
      actor: actorOf(commit.trailers, commit.authorEmail, project.permissions),
      files,
    });
  }

  const sessions = new Map<string, typeof perCommit>();
  const untrailered: typeof perCommit = [];
  for (const pc of perCommit) {
    const s = trailer(pc.commit.trailers, "Capsule-Session")[0];
    if (s) sessions.set(s, [...(sessions.get(s) ?? []), pc]);
    else untrailered.push(pc);
  }
  for (const [id, group] of [...sessions].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (group.length < 2) continue;
    const first = group[0]!.commit;
    units.push({
      kind: "session",
      label: `session ${id.slice(0, 8)} (${group.length} commits)`,
      commits: group.map((g) => g.commit),
      actor: actorOf(first.trailers, first.authorEmail, project.permissions),
      files: mergeFiles(group),
    });
  }
  if (untrailered.length >= 2) {
    units.push({
      kind: "whole-pr",
      label: `all ${untrailered.length} commits without a Capsule-Session trailer, together`,
      commits: untrailered.map((g) => g.commit),
      actor: null,
      files: mergeFiles(untrailered),
    });
  }

  if (revParse("HEAD", root)) {
    const files = changesSince("HEAD", root).map((p) => ({
      path: p.path,
      status: p.status,
      beforeRev: p.status === "A" ? null : "HEAD",
      afterRev: WORKTREE,
    }));
    if (files.length) {
      units.push({
        kind: "uncommitted",
        label: "uncommitted changes",
        commits: [],
        actor: humanFromEmail(configuredEmail(root), project.permissions),
        files,
      });
    }
  }
  for (const u of units) u.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return units;
}

// ---------------------------------------------------------------------------------------
// Classification (C5.2 step 1)

export interface NodeChange {
  capsule: string;
  node: CapsuleNode;
  change: "added" | "changed" | "removed";
}

export interface Classified {
  path: string;
  status: ChangeStatus;
  kind: "code" | "check-file" | "capsule" | "settings" | "tool" | "ignored";
  /** The capsule the change belongs to: the file's home (root for orphans), or the capsule edited. */
  capsule: string;
  concerns: string[];
  /** Each permission action the change needs, with what caused it. */
  actions: { action: Action; detail: string }[];
  /** Check files: was the change purely additive? */
  additive?: boolean;
  /** Capsule files: what happened to each node, and whether the front matter changed. */
  nodes?: NodeChange[];
  frontChanged?: boolean;
}

/** Every glob that marks a check file: `checks.files` plus each check node's `files`. */
export function checkFileMatcher(project: Project): (path: string) => boolean {
  return matcherFor(project.config.checks.files, project.capsules);
}

export { checkGlobs } from "./judges.js";

/** True if every line of `before` appears in `after`, in order: only lines were added. */
export function isAdditive(before: string, after: string): boolean {
  const b = before.replace(/\r\n?/g, "\n").split("\n");
  const a = after.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  for (const line of a) if (i < b.length && line === b[i]) i++;
  return i === b.length;
}

function parseAt(text: string | null, path: string, id: string, kind: Capsule["kind"]) {
  return text === null ? null : parseCapsuleFile(text, path, id, kind).capsule;
}

function frontHash(c: Capsule | null): string | null {
  if (!c) return null;
  try {
    return capsuleHash(c.frontText ?? "");
  } catch {
    return `raw:${c.frontText ?? ""}`;
  }
}

/** Diff two versions of a capsule file node by node. */
export function diffCapsule(
  before: Capsule | null,
  after: Capsule | null,
): { nodes: NodeChange[]; frontChanged: boolean } {
  const id = (after ?? before)!.id;
  const b = new Map((before?.nodes ?? []).map((n) => [n.id, n]));
  const a = new Map((after?.nodes ?? []).map((n) => [n.id, n]));
  const nodes: NodeChange[] = [];
  for (const [nid, n] of a) {
    const old = b.get(nid);
    if (!old) nodes.push({ capsule: id, node: n, change: "added" });
    else if (old.type !== n.type || nodeHash(old) !== nodeHash(n))
      nodes.push({ capsule: id, node: n, change: "changed" });
  }
  for (const [nid, n] of b)
    if (!a.has(nid)) nodes.push({ capsule: id, node: n, change: "removed" });
  return { nodes, frontChanged: frontHash(before) !== frontHash(after) };
}

const NODE_ACTION: Record<NodeType, { added: Action | null; other: Action | null }> = {
  intent: { added: "propose-intent", other: "propose-intent" },
  contract: { added: "propose-contracts", other: "propose-contracts" },
  example: { added: "propose-examples", other: "propose-examples" },
  check: { added: "add-checks", other: "change-checks" },
  // Changing or deleting a decision is E009 for everyone (C6.3), not a permission question.
  decision: { added: "add-decisions", other: null },
  // Decisions rest on assumptions, so changing one needs owner approval (D-019).
  assumption: { added: "add-decisions", other: "propose-contracts" },
  context: { added: "edit-context", other: "edit-context" },
  prompt: { added: "edit-context", other: "edit-context" },
  code: { added: "edit-code", other: "edit-code" },
};

const TOOL_FILES = new Set([LOCK_FILE, ".capsules/installed.json", ".capsules/.gitignore"]);

export function classify(
  f: UnitFile,
  project: Project,
  contents: Contents,
  isCheckFile: (p: string) => boolean,
): Classified {
  const base = { path: f.path, status: f.status, concerns: [] as string[], actions: [] };
  if (TOOL_FILES.has(f.path) || f.path.startsWith(".capsules/_cache/"))
    return { ...base, kind: "tool", capsule: "root" };
  // CI workflows are settings too, even though `.github/**` is ignored: an agent that can
  // edit them can switch the guard off (D-020).
  if (
    f.path === ".capsules/config.yaml" ||
    f.path === ".capsules/permissions.yaml" ||
    f.path.startsWith(".github/workflows/")
  ) {
    const action: Action = f.path.endsWith("permissions.yaml") ? "edit-permissions" : "edit-config";
    return { ...base, kind: "settings", capsule: "root", actions: [{ action, detail: f.path }] };
  }
  const cap = capsuleFromPath(f.path);
  if (cap) {
    const before = parseAt(contents.get(f.beforeRev, f.path), f.path, cap.id, cap.kind);
    const after = parseAt(
      contents.get(f.status === "D" ? null : f.afterRev, f.path),
      f.path,
      cap.id,
      cap.kind,
    );
    const { nodes, frontChanged } = diffCapsule(before, after);
    const actions: Classified["actions"] = [];
    if (frontChanged)
      actions.push({ action: "propose-contracts", detail: `front matter of ${cap.id}` });
    for (const nc of nodes) {
      const rule = NODE_ACTION[nc.node.type];
      const action = nc.change === "added" ? rule.added : rule.other;
      if (action)
        actions.push({ action, detail: `${nc.change} ${nc.node.type} ${cap.id}#${nc.node.id}` });
    }
    return { ...base, kind: "capsule", capsule: cap.id, actions, nodes, frontChanged };
  }
  const m = membershipOf(f.path, project.capsules);
  const home = m.home ?? "root";
  // Ignored files need no capsule (C4), so they are outside what the guard judges.
  if (f.path.startsWith(".capsules/") || isIgnored(f.path, project.config.ignore))
    return { ...base, kind: "ignored", capsule: home };
  if (isCheckFile(f.path)) {
    if (f.status === "A")
      return {
        ...base,
        kind: "check-file",
        capsule: home,
        concerns: m.concerns,
        additive: true,
        actions: [{ action: "add-checks", detail: `new check file ${f.path}` }],
      };
    const additive =
      f.status === "M" &&
      isAdditive(contents.get(f.beforeRev, f.path) ?? "", contents.get(f.afterRev, f.path) ?? "");
    return {
      ...base,
      kind: "check-file",
      capsule: home,
      concerns: m.concerns,
      additive,
      actions: [
        additive
          ? { action: "add-checks", detail: `lines added to existing check ${f.path}` }
          : {
              action: "change-checks",
              detail: `${f.status === "D" ? "deleted" : "changed"} existing check ${f.path}`,
            },
      ],
    };
  }
  return {
    ...base,
    kind: "code",
    capsule: home,
    concerns: m.concerns,
    actions: [{ action: "edit-code", detail: f.path }],
  };
}
