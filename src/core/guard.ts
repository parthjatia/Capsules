// The CI guard (M3): permissions (C5.2), the one rule (C6.2), append-only decisions (C6.3),
// weakened-test signals (C9.2) and the Capsule-Cosmetic owner check (C8, D-013).
import { existsSync } from "node:fs";
import { join } from "node:path";
import picomatch from "picomatch";
import { describeCheckChange, patternsOf, weakenedSignals } from "../checks/heuristics.js";
import { changesSince, filesAt, revParse, WORKTREE, type Commit } from "../git/history.js";
import { msg, type Diagnostic } from "../report/messages.js";
import { parseAddress } from "./address.js";
import { readGithubEvent, type Base } from "./base.js";
import {
  checkFileMatcher,
  checkGlobs,
  classify,
  Contents,
  diffCapsule,
  type ChangeUnit,
  type Classified,
} from "./changes.js";
import { nodeHash } from "./hash.js";
import { hashObjects } from "../git/git.js";
import {
  APPROVALS_FILE,
  changedRecords,
  emptyApprovals,
  fileApproved,
  nodeApproved,
  parseApprovals,
} from "./approvals.js";
import {
  actorLabel,
  humanFromEmail,
  humanFromGithub,
  isOwner,
  ownersOf,
  trailer,
  type Actor,
} from "./identity.js";
import { isIgnored } from "./membership.js";
import { address, type Capsule, type CapsuleNode } from "./model.js";
import { parseCapsuleFile } from "./parse.js";
import { agentMay, type Action, type Verdict } from "./permissions.js";
import { gentleRelaxes } from "./access.js";
import { capsuleFromPath, checkJudges } from "./judges.js";
import type { Project } from "./project.js";
import { targetOf } from "./resolve.js";

export interface GuardResult {
  diagnostics: Diagnostic[];
  /** New checks added in the same change as code they judge (C6.2): not reviewed yet. */
  unreviewed: string[];
  /** Every path changed since the base (or HEAD), for picking the checks to run (C9.1). */
  changedPaths: string[];
}

/** The commit (or HEAD) the whole range is compared with; null when there is no history. */
export function rangeBase(project: Project, base: Base): string | null {
  return base.sha ?? (revParse("HEAD", project.root) ? "HEAD" : null);
}

export function guard(project: Project, base: Base, units: ChangeUnit[]): GuardResult {
  const contents = new Contents(project.root);
  const isCheckFile = checkFileMatcher(project);
  const drafts = new Set(
    project.capsules.filter((c) => c.front?.status === "draft").map((c) => c.id),
  );
  const out: Diagnostic[] = [];
  // Drafts never block (C2.1): a finding only about draft capsules is a warning.
  const add: Add = (d, capsules) => {
    const list = capsules === null ? [] : typeof capsules === "string" ? [capsules] : capsules;
    if (list.length && list.every((c) => drafts.has(c))) d.severity = "warning";
    out.push(d);
  };

  // D-038: a check file is "existing" only if it existed at the base, in every unit, as the
  // hooks treat a file created in the session (D-024). A branch-new one stays unreviewed.
  const baseRev = rangeBase(project, base);
  const branchNew = (c: Classified): Classified =>
    c.kind === "check-file" &&
    c.status !== "A" &&
    baseRev !== null &&
    contents.get(baseRev, c.path) === null
      ? {
          ...c,
          additive: true,
          actions: [{ action: "add-checks", detail: `check file new in this branch ${c.path}` }],
        }
      : c;
  const classified = units.map((u) => ({
    unit: u,
    files: u.files.map((f) => branchNew(classify(f, project, contents, isCheckFile))),
  }));

  // Permissions (C5.2), per commit and for uncommitted changes.
  for (const { unit, files } of classified) {
    if (unit.kind !== "commit" && unit.kind !== "uncommitted") continue;
    checkPermissions(project, unit, files, add);
  }

  // The one rule (C6.2). Whole-PR findings only count if no smaller unit found them already.
  const found = new Set<string>();
  const ordered = [
    ...classified.filter((c) => c.unit.kind !== "whole-pr"),
    ...classified.filter((c) => c.unit.kind === "whole-pr"),
  ];
  const unreviewed = new Set<string>();
  for (const { unit, files } of ordered) {
    for (const v of oneRule(project, unit, files, contents)) {
      const keys = v.capsules.map((c) => `${v.code}|${c}`);
      if (unit.kind === "whole-pr") {
        if (keys.every((k) => found.has(k))) continue;
        if (project.permissions.solo) v.diagnostic.severity = "warning";
      } else for (const k of keys) found.add(k);
      add(v.diagnostic, v.capsules);
    }
    for (const u of newChecksWithCode(files, isDrafter(project, unit))) unreviewed.add(u);
  }

  const from = rangeBase(project, base);
  const range = from ? changesSince(from, project.root) : [];
  if (from) {
    appendOnly(project, from, contents, add);
    weakenedTests(project, from, range, contents, isCheckFile, add);
  }
  cosmeticOwners(project, units, add);
  approvalOwners(project, units, contents, add);

  return {
    diagnostics: out,
    unreviewed: [...unreviewed].filter((u) => !approvedNow(project, u)).sort(),
    changedPaths: range.map((r) => r.path).sort(),
  };
}

// ---------------------------------------------------------------------------------------

function decide(actor: Actor, action: Action, c: Classified, project: Project): Verdict {
  if (actor.kind === "agent")
    return agentMay(actor.name, action, c.capsule, c.concerns, project.permissions);
  if (
    actor.kind === "human" &&
    isOwner(actor.name, c.capsule, project.capsules, project.permissions)
  )
    return { allowed: true, needsApproval: false };
  // Humans who aren't owners, and unknown authors, act as `default` (C5, C5.3).
  return agentMay("default", action, c.capsule, c.concerns, project.permissions);
}

function checkPermissions(project: Project, unit: ChangeUnit, files: Classified[], add: Add) {
  const actor = unit.actor!;
  const denied = new Map<
    string,
    { capsule: string; action: string; reason: string; what: string[] }
  >();
  const approval = new Map<string, string[]>();
  const gentle = new Map<
    string,
    { capsule: string; action: string; reason: string; what: string[] }
  >();
  for (const c of files) {
    for (const a of c.actions) {
      const v = decide(actor, a.action, c, project);
      if (!v.allowed && gentleRelaxes(v, project.config.mode)) {
        const key = `${c.capsule}\0${a.action}\0${v.reason}`;
        const entry = gentle.get(key) ?? {
          capsule: c.capsule,
          action: a.action,
          reason: v.reason,
          what: [],
        };
        entry.what.push(a.detail);
        gentle.set(key, entry);
      } else if (!v.allowed) {
        const key = `${c.capsule}\0${a.action}\0${v.reason}`;
        const entry = denied.get(key) ?? {
          capsule: c.capsule,
          action: a.action,
          reason: v.reason,
          what: [],
        };
        entry.what.push(a.detail);
        denied.set(key, entry);
      } else if (v.needsApproval && !approvedNow(project, a.node ?? c.path)) {
        approval.set(c.capsule, [...(approval.get(c.capsule) ?? []), a.detail]);
      }
    }
  }
  for (const d of denied.values())
    add(
      msg.E027(
        unit.label,
        actorLabel(actor),
        d.capsule,
        d.action,
        d.reason,
        d.what,
        actor.kind === "unknown",
      ),
      d.capsule,
    );
  for (const g of gentle.values())
    add(msg.W111(unit.label, actorLabel(actor), g.capsule, g.action, g.reason, g.what), null);
  for (const [capsule, what] of approval)
    add(msg.W108(unit.label, capsule, ownersOf(project.capsules, capsule), what), null);
}

type Add = (d: Diagnostic, capsules: string | string[] | null) => void;

interface Violation {
  code: "E028" | "E029";
  capsules: string[];
  diagnostic: Diagnostic;
}

function oneRule(
  project: Project,
  unit: ChangeUnit,
  files: Classified[],
  contents: Contents,
): Violation[] {
  const blockNew = project.config["one-rule"]["new-checks-with-code"] === "block";
  const patterns = patternsOf(project.config);
  const judges = checkJudges(project.capsules);
  const checkNodes = project.capsules.flatMap((c) =>
    c.nodes
      .filter((n) => n.type === "check")
      .map((n) => ({ addr: address(c.id, n.id), match: picomatch(checkGlobs(n), { dot: true }) })),
  );

  const code = new Map<string, string[]>();
  const judged = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const list = m.get(k) ?? [];
    if (!list.includes(v)) list.push(v);
    m.set(k, list);
  };

  for (const c of files) {
    if (c.kind === "code") for (const x of [c.capsule, ...c.concerns]) push(code, x, c.path);
    if (c.kind === "check-file") {
      const changesExisting = c.status !== "A" && !c.additive;
      if (!changesExisting && !blockNew) continue;
      const f = unit.files.find((u) => u.path === c.path)!;
      const what = `${c.path} (${describeCheckChange(
        contents.get(f.beforeRev, f.path),
        c.status === "D" ? null : contents.get(f.afterRev, f.path),
        patterns,
      )})`;
      const xs = new Set([c.capsule, ...c.concerns]);
      for (const cn of checkNodes)
        if (cn.match(c.path)) for (const x of judges.get(cn.addr) ?? []) xs.add(x);
      for (const x of xs) push(judged, x, what);
    }
    if (c.kind === "capsule") {
      for (const nc of c.nodes ?? []) {
        if (nc.node.type !== "check" || (nc.change === "added" && !blockNew)) continue;
        const addr = address(nc.capsule, nc.node.id);
        const what = `check node ${addr} (${nc.change === "added" ? "new" : `existing check, ${nc.change}`})`;
        for (const x of judges.get(addr) ?? new Set([nc.capsule])) push(judged, x, what);
      }
    }
  }

  // One finding per distinct (code, checks) pair, naming every capsule it applies to.
  const groups = new Map<string, { capsules: string[]; code: string[]; checks: string[] }>();
  for (const [x, codeFiles] of [...code].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const checks = judged.get(x);
    if (!checks) continue;
    const key = JSON.stringify([codeFiles, checks]);
    const g = groups.get(key) ?? { capsules: [], code: codeFiles, checks };
    g.capsules.push(x);
    groups.set(key, g);
  }
  const out: Violation[] = [];
  for (const g of groups.values())
    out.push({
      code: "E028",
      capsules: g.capsules,
      diagnostic: msg.E028(g.capsules, unit.label, g.code, g.checks),
    });

  // V2: a contract or example, and an existing intent it serves, changed together.
  const changedIntents = new Set<string>();
  for (const c of files)
    for (const nc of c.nodes ?? [])
      if (nc.node.type === "intent" && nc.change !== "added")
        changedIntents.add(address(nc.capsule, nc.node.id));
  if (changedIntents.size) {
    const nodeAt = new Map<string, CapsuleNode>();
    for (const cap of project.capsules)
      for (const n of cap.nodes) nodeAt.set(address(cap.id, n.id), n);
    const servedBy = (n: CapsuleNode): string[] => {
      if (n.type === "contract")
        return n.links.filter((l) => l.type === "serves").map((l) => targetOf(l.ref, n.capsule));
      return n.links
        .filter((l) => l.type === "shows")
        .flatMap((l) => {
          const contract = nodeAt.get(targetOf(l.ref, n.capsule));
          return contract ? servedBy(contract) : [];
        });
    };
    const byCapsule = new Map<string, { rules: string[]; intents: string[] }>();
    for (const c of files)
      for (const nc of c.nodes ?? []) {
        if (nc.node.type !== "contract" && nc.node.type !== "example") continue;
        const hit = servedBy(nc.node).filter((i) => changedIntents.has(i));
        if (!hit.length) continue;
        const e = byCapsule.get(nc.capsule) ?? { rules: [], intents: [] };
        e.rules.push(address(nc.capsule, nc.node.id));
        for (const i of hit) if (!e.intents.includes(i)) e.intents.push(i);
        byCapsule.set(nc.capsule, e);
      }
    for (const [x, e] of byCapsule)
      out.push({
        code: "E029",
        capsules: [x],
        diagnostic: msg.E029(x, unit.label, e.rules, e.intents),
      });
  }
  return out;
}

/** New checks that arrived together with code changes: unreviewed until confirmed (C6.2). */
/** A unit made by an agent whose role is `drafter`: its new checks are starter checks (C18.6). */
function isDrafter(project: Project, unit: ChangeUnit): boolean {
  const a = unit.actor;
  return a?.kind === "agent" && project.permissions.agents[a.name]?.role === "drafter";
}

/**
 * An unreviewed item or a change needing approval, approved by an owner exactly as it is now
 * (C18.4): `check node <addr>` / an address by its node hash, a path by its blob hash.
 */
function approvedNow(project: Project, item: string): boolean {
  const addr = item.startsWith("check node ") ? item.slice(11) : item.includes("#") ? item : null;
  if (addr)
    return nodeApproved(project.approvals, addr, project.current.nodes.get(addr)?.hash ?? null);
  const path = item.replace(/ \(lines added\)$/, "");
  if (!project.approvals.files.has(path)) return false;
  const blob =
    hashObjects(
      [path].filter((p) => project.tracked.includes(p) || existsOnDisk(project, p)),
      project.root,
    ).get(path) ?? null;
  return fileApproved(project.approvals, path, blob);
}

const existsOnDisk = (project: Project, p: string) =>
  existsSync(join(project.root, ...p.split("/")));

/**
 * C18.4: every commit that changes approvals.lock must be made by an owner of each capsule
 * whose records it adds or changes, never by an agent (E033). In GitHub Actions the person
 * is the pull request's author, as for Capsule-Cosmetic (D-013).
 */
function approvalOwners(project: Project, units: ChangeUnit[], contents: Contents, add: Add) {
  const event = readGithubEvent();
  const seen = new Set<string>();
  for (const u of units) {
    if (u.kind !== "commit") continue;
    const f = u.files.find((x) => x.path === APPROVALS_FILE);
    const c = u.commits[0];
    if (!f || !c || seen.has(c.sha)) continue;
    seen.add(c.sha);
    const read = (rev: string | null) => {
      const t = rev === null ? null : contents.get(rev, APPROVALS_FILE);
      const p = t === null ? null : parseApprovals(t);
      return p && p.ok ? p.approvals : emptyApprovals();
    };
    const items = changedRecords(read(f.beforeRev), read(f.status === "D" ? null : f.afterRev));
    if (!items.length) continue;
    const agent = trailer(c.trailers, "Capsule-Agent")[0];
    const who: Actor = agent
      ? { kind: "agent", name: agent }
      : event
        ? humanFromGithub(event.prAuthor, project.permissions)
        : humanFromEmail(c.authorEmail, project.permissions);
    const notOwned = items.filter(
      (i) =>
        !(
          who.kind === "human" &&
          isOwner(who.name, i.capsule, project.capsules, project.permissions)
        ),
    );
    if (!notOwned.length) continue;
    const label = `commit ${c.sha.slice(0, 7)} "${c.subject}"`;
    const whoText =
      who.kind === "human"
        ? who.name
        : who.kind === "agent"
          ? `the agent ${who.name}`
          : event
            ? `the pull request author (${event.prAuthor ?? "unknown"})`
            : actorLabel(who);
    const owners = [...new Set(notOwned.flatMap((i) => ownersOf(project.capsules, i.capsule)))];
    add(msg.E033(label, whoText, notOwned, owners), null);
  }
}

function newChecksWithCode(files: Classified[], drafter = false): string[] {
  if (!drafter && !files.some((c) => c.kind === "code")) return [];
  const out: string[] = [];
  for (const c of files) {
    if (c.kind === "check-file" && (c.status === "A" || c.additive))
      out.push(c.status === "A" ? c.path : `${c.path} (lines added)`);
    for (const nc of c.nodes ?? [])
      if (nc.node.type === "check" && nc.change === "added")
        out.push(`check node ${address(nc.capsule, nc.node.id)}`);
  }
  return out;
}

function capsulesAt(project: Project, rev: string, contents: Contents): Capsule[] {
  const out: Capsule[] = [];
  for (const path of filesAt(rev, ".capsules", project.root)) {
    const cap = capsuleFromPath(path);
    const text = cap ? contents.get(rev, path) : null;
    if (cap && text !== null) out.push(parseCapsuleFile(text, path, cap.id, cap.kind).capsule);
  }
  return out;
}

/** C6.3: an existing decision must never change or disappear (E009). */
function appendOnly(project: Project, from: string, contents: Contents, add: Add) {
  const now = new Map<string, { node: CapsuleNode; file: string }>();
  for (const c of project.capsules)
    for (const n of c.nodes)
      if (n.type === "decision") now.set(address(c.id, n.id), { node: n, file: c.file });
  for (const c of capsulesAt(project, from, contents)) {
    for (const n of c.nodes) {
      if (n.type !== "decision") continue;
      const addr = address(c.id, n.id);
      const cur = now.get(addr);
      if (!cur) add(msg.E009({ file: c.file }, addr, "deleted"), c.id);
      else if (cur.node.type !== "decision" || nodeHash(cur.node) !== nodeHash(n))
        add(msg.E009({ file: cur.file, line: cur.node.line }, addr, "edited"), c.id);
    }
  }
}

/** C9.2: weakened-test signals in existing check files, and changed `run:` commands. */
function weakenedTests(
  project: Project,
  from: string,
  range: { path: string; status: string }[],
  contents: Contents,
  isCheckFile: (p: string) => boolean,
  add: Add,
) {
  const mode = project.config["weakened-tests"];
  if (mode === "off") return;
  const patterns = patternsOf(project.config);
  const emit = (d: Diagnostic) => {
    if (mode === "block") d.severity = "error";
    add(d, null);
  };
  for (const r of range) {
    if (r.status === "A" || r.path.startsWith(".capsules/")) continue;
    if (isIgnored(r.path, project.config.ignore) || !isCheckFile(r.path)) continue;
    const before = contents.get(from, r.path);
    if (before === null) continue;
    const after = r.status === "D" ? null : contents.get(WORKTREE, r.path);
    for (const s of weakenedSignals(before, after, patterns))
      emit(
        msg.W107(
          { file: r.path, ...(s.kind === "skip-added" && s.line ? { line: s.line } : {}) },
          r.path,
          s.what,
        ),
      );
  }
  for (const r of range) {
    const cap = capsuleFromPath(r.path);
    if (!cap || r.status === "A") continue;
    const parse = (rev: string | null) => {
      const text = contents.get(rev, r.path);
      return text === null ? null : parseCapsuleFile(text, r.path, cap.id, cap.kind).capsule;
    };
    const { nodes } = diffCapsule(parse(from), parse(r.status === "D" ? null : WORKTREE));
    for (const nc of nodes) {
      if (nc.node.type !== "check") continue;
      const runOf = (n: CapsuleNode | undefined) =>
        n?.fields.find((f) => f.key === "run")?.value ?? null;
      const old = parse(from)?.nodes.find((n) => n.id === nc.node.id);
      if (nc.change === "added" || runOf(old) === runOf(nc.node)) continue;
      const addr = address(cap.id, nc.node.id);
      emit(
        msg.W107(
          { file: r.path, ...(nc.change === "changed" ? { line: nc.node.line } : {}) },
          r.path,
          nc.change === "removed"
            ? `check node ${addr} was removed`
            : `the run command of check ${addr} changed (was "${runOf(old)}")`,
        ),
      );
    }
  }
}

/** C8 (D-013, D-016): only an owner may mark a change cosmetic (E030). */
function cosmeticOwners(project: Project, units: ChangeUnit[], add: Add) {
  const bySha = new Map<string, Commit>();
  for (const u of units) for (const c of u.commits) bySha.set(c.sha, c);
  const commits = [...bySha.values()];
  const event = readGithubEvent();
  const nodes = new Set(project.capsules.flatMap((c) => c.nodes.map((n) => address(c.id, n.id))));
  for (const c of commits) {
    const label = `commit ${c.sha.slice(0, 7)} "${c.subject}"`;
    for (const value of trailer(c.trailers, "Capsule-Cosmetic")) {
      const a = parseAddress(value, { ref: false });
      const addr = a.ok && a.capsule ? address(a.capsule, a.node) : value;
      if (!a.ok || !nodes.has(addr)) {
        add(
          msg.E003(
            {},
            value,
            `it is named in the Capsule-Cosmetic trailer of ${label}, but there is no such node`,
          ),
          null,
        );
        continue;
      }
      const who = event
        ? humanFromGithub(event.prAuthor, project.permissions)
        : humanFromEmail(c.authorEmail, project.permissions);
      const capsule = addr.split("#")[0]!;
      if (who.kind === "human" && isOwner(who.name, capsule, project.capsules, project.permissions))
        continue;
      const whoText =
        who.kind === "human"
          ? who.name
          : event
            ? `the pull request author (${event.prAuthor ?? "unknown"})`
            : actorLabel(who);
      add(msg.E030(label, addr, whoText, ownersOf(project.capsules, capsule)), null);
    }
  }
}
