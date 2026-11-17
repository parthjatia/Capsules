// Find and load a project: the `.capsules/` folder, its settings, every capsule file,
// the tracked files, and all validation diagnostics.
import { APPROVALS_FILE, emptyApprovals, parseApprovals, type Approvals } from "./approvals.js";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseConfig, type Config } from "./config.js";
import { shortestPrefixes } from "./hash.js";
import {
  computeCurrent,
  LOCK_FILE,
  lockChanges,
  parseLock,
  splitReplaced,
  staleLinks,
  stalePrompts,
  type Lock,
} from "./lock.js";
import { computeMembership, type MembershipResult } from "./membership.js";
import { address, type Capsule, type CapsuleKind } from "./model.js";
import { parseCapsuleFile } from "./parse.js";
import { parsePermissions, type Permissions } from "./permissions.js";
export { capsuleFromPath } from "./judges.js";
import { targetOf, validateGraph } from "./resolve.js";
import { gitToplevel, hashObjects, lsFiles } from "../git/git.js";
import { errors, msg, type Diagnostic } from "../report/messages.js";

export class UsageError extends Error {}

export interface Project {
  /** Absolute folder that contains `.capsules/`. */
  root: string;
  config: Config;
  permissions: Permissions;
  capsules: Capsule[];
  tracked: string[];
  membership: MembershipResult;
  /** The lockfile as committed, or null if there is none (or it can't be read). */
  lockOnDisk: Lock | null;
  /** The lock as it would be if every link were pinned now. */
  current: Lock;
  /** What owners approved (C18.4); empty when there is no approvals.lock. */
  approvals: Approvals;
  diagnostics: Diagnostic[];
}

export const toPosix = (p: string) => p.split(sep).join("/");

/**
 * The project root is the nearest folder, from `cwd` up to the Git top level,
 * that contains `.capsules/` (D-008). Usually that is the repository root.
 */
export function findProjectRoot(cwd: string): string {
  const top = gitToplevel(cwd);
  if (!top) throw new UsageError(errors.notGitRepo(cwd));
  // Real paths, so symlinked temp folders (macOS /var -> /private/var) compare equal.
  const topAbs = realpathSync.native(resolve(top));
  let dir = realpathSync.native(resolve(cwd));
  for (;;) {
    if (existsSync(join(dir, ".capsules")) && statSync(join(dir, ".capsules")).isDirectory())
      return dir;
    if (dir === topAbs || dirname(dir) === dir) break;
    dir = dirname(dir);
  }
  throw new UsageError(errors.noCapsulesFolder(cwd));
}

interface FoundFile {
  id: string;
  kind: CapsuleKind;
  file: string;
}

const ID_PART = /^[a-z0-9-]+$/;

function discover(root: string, diagnostics: Diagnostic[]): FoundFile[] {
  const base = join(root, ".capsules");
  const found: FoundFile[] = [];

  const concernsDir = join(base, "_concerns");
  if (existsSync(concernsDir)) {
    for (const name of readdirSync(concernsDir).sort()) {
      if (!name.endsWith(".md")) continue;
      const stem = name.slice(0, -3);
      const file = `.capsules/_concerns/${name}`;
      if (!ID_PART.test(stem)) {
        diagnostics.push(msg.E020({ file, line: 1 }, stem));
        continue;
      }
      found.push({ id: stem, kind: "concern", file });
    }
  }

  const walkAreas = (dirAbs: string, dirRel: string, prefix: string[]) => {
    for (const name of readdirSync(dirAbs).sort()) {
      if (prefix.length === 0 && name.startsWith("_")) continue; // reserved (C1)
      if (name.startsWith(".")) continue;
      const abs = join(dirAbs, name);
      const rel = `${dirRel}/${name}`;
      if (statSync(abs).isDirectory()) {
        if (!ID_PART.test(name)) continue;
        const own = `${dirRel}/${name}.md`;
        if (!existsSync(join(dirAbs, `${name}.md`)))
          diagnostics.push(msg.E013({ file: rel }, rel, own));
        walkAreas(abs, rel, [...prefix, name]);
        continue;
      }
      if (!name.endsWith(".md")) continue;
      const stem = name.slice(0, -3);
      if (!ID_PART.test(stem)) {
        diagnostics.push(msg.E020({ file: rel, line: 1 }, stem));
        continue;
      }
      if (prefix.length === 0 && stem === "root") {
        found.push({ id: "root", kind: "area", file: rel });
        continue;
      }
      if (prefix.length > 0 && prefix[0] === "root") continue; // .capsules/root/ is not a namespace
      found.push({ id: [...prefix, stem].join("."), kind: "area", file: rel });
    }
  };
  walkAreas(base, ".capsules", []);

  if (!found.some((f) => f.id === "root" && f.kind === "area")) {
    diagnostics.push(msg.E023({ file: ".capsules/root.md" }));
  }
  const topAreas = new Map(
    found.filter((f) => f.kind === "area" && !f.id.includes(".")).map((f) => [f.id, f.file]),
  );
  for (const f of found) {
    if (f.kind === "concern" && topAreas.has(f.id))
      diagnostics.push(msg.E012({ file: f.file, line: 1 }, f.id, topAreas.get(f.id)!));
  }
  return found;
}

function readOptional(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

export function today(): string {
  const env = process.env.CAPSULES_TODAY;
  if (env && /^\d{4}-\d{2}-\d{2}$/.test(env)) return env;
  return new Date().toISOString().slice(0, 10);
}

export function loadProject(root: string): Project {
  const diagnostics: Diagnostic[] = [];
  const config = parseConfig(
    readOptional(join(root, ".capsules", "config.yaml")),
    ".capsules/config.yaml",
    diagnostics,
  );
  const permissions = parsePermissions(
    readOptional(join(root, ".capsules", "permissions.yaml")),
    ".capsules/permissions.yaml",
    diagnostics,
  );

  const capsules: Capsule[] = [];
  const fileDiagnostics: Diagnostic[] = [];
  for (const f of discover(root, diagnostics)) {
    const text = readFileSync(join(root, ...f.file.split("/")), "utf8");
    const r = parseCapsuleFile(text, f.file, f.id, f.kind);
    capsules.push(r.capsule);
    fileDiagnostics.push(...r.diagnostics);
  }

  // Owners must be humans listed in permissions.yaml.
  const humans = new Set(Object.keys(permissions.humans));
  for (const c of capsules) {
    for (const o of c.front?.owners ?? []) {
      if (!humans.has(o)) {
        fileDiagnostics.push(msg.E021({ file: c.file, line: 1 }, o));
      }
    }
  }

  fileDiagnostics.push(...validateGraph(capsules, { projectRoot: root, today: today() }));
  const tracked = lsFiles(root);
  const membership = computeMembership(tracked, capsules, config.ignore);
  fileDiagnostics.push(...membership.diagnostics);

  // Fingerprints and the lockfile (C7).
  const promptPaths = [
    ...new Set(
      capsules.flatMap((c) =>
        c.nodes
          .filter((n) => n.type === "prompt")
          .map((n) => n.fields.find((f) => f.key === "file")?.value ?? "")
          .filter((p) => p && existsSync(join(root, p))),
      ),
    ),
  ].sort();
  const current = computeCurrent(capsules, hashObjects(promptPaths, root));
  const lockText = readOptional(join(root, ...LOCK_FILE.split("/")));
  let lockOnDisk: Lock | null = null;
  if (lockText !== null) {
    const parsed = parseLock(lockText);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.diagnostics.length === 0) lockOnDisk = parsed.lock;
  }
  fileDiagnostics.push(
    ...lockDiagnostics(capsules, config, lockText !== null, lockOnDisk, current),
  );
  let approvals = emptyApprovals();
  const approvalsText = readOptional(join(root, ...APPROVALS_FILE.split("/")));
  if (approvalsText !== null) {
    const parsed = parseApprovals(approvalsText);
    if (parsed.ok) approvals = parsed.approvals;
    else diagnostics.push(msg.E034(APPROVALS_FILE, parsed.line, parsed.text));
  }

  // Draft capsules report but never block (C2.1): their errors become warnings.
  const drafts = new Set(capsules.filter((c) => c.front?.status === "draft").map((c) => c.file));
  for (const d of fileDiagnostics)
    if (d.file && drafts.has(d.file) && d.severity === "error") d.severity = "warning";

  diagnostics.push(...fileDiagnostics);
  return {
    root,
    config,
    permissions,
    capsules,
    tracked,
    membership,
    lockOnDisk,
    current,
    approvals,
    diagnostics: sortDiagnostics(diagnostics),
  };
}

const MAX_LOCK_CHANGES_SHOWN = 5;

/** E010 (lock out of date), W104 (stale links) and W110 (stale prompts), from C7.4. */
function lockDiagnostics(
  capsules: Capsule[],
  config: Config,
  lockExists: boolean,
  lockOnDisk: Lock | null,
  current: Lock,
): Diagnostic[] {
  // An unreadable lockfile is already E026; don't pile E010 on top of it.
  if (lockExists && !lockOnDisk) return [];
  if (!lockOnDisk) return [msg.E010([], 0, true)];

  const out: Diagnostic[] = [];
  const changes = lockChanges(lockOnDisk, current);
  if (changes.length) {
    const shown = changes
      .slice(0, MAX_LOCK_CHANGES_SHOWN)
      .map((c) => `${c.kind} ${c.key} ${c.change}`);
    out.push(msg.E010(shown, changes.length - shown.length, false));
  }

  const where = new Map<string, { file: string; line: number }>();
  for (const c of capsules)
    for (const n of c.nodes) where.set(address(c.id, n.id), { file: c.file, line: n.line });
  const prefix = shortestPrefixes(
    [...current.nodes.values()]
      .map((n) => n.hash)
      .concat([...lockOnDisk.links.values()].map((l) => l.hash)),
  );
  const short = (h: string) => prefix.get(h) ?? h.slice(0, 4);
  for (const s of splitReplaced(staleLinks(lockOnDisk, current), capsules).report) {
    const d = msg.W104(
      where.get(s.from) ?? {},
      s.from,
      s.type,
      s.to,
      short(s.hash),
      short(s.current),
    );
    if (config["stale-links"] === "block") d.severity = "error";
    out.push(d);
  }
  for (const p of stalePrompts(lockOnDisk, current)) {
    const node = capsules
      .flatMap((c) => c.nodes)
      .find((n) => address(n.capsule, n.id) === p.address);
    const linked = (node?.links ?? [])
      .filter((l) => l.type === "uses")
      .map((l) => targetOf(l.ref, node!.capsule));
    out.push(msg.W110(where.get(p.address) ?? {}, p.address, p.path, linked));
  }
  return out;
}

export function sortDiagnostics(ds: Diagnostic[]): Diagnostic[] {
  // Plain code-unit comparison, never locale-dependent, so output is identical everywhere.
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  const sev = (d: Diagnostic) => (d.severity === "error" ? 0 : 1);
  return [...ds].sort(
    (a, b) =>
      sev(a) - sev(b) ||
      cmp(a.file ?? "", b.file ?? "") ||
      (a.line ?? 0) - (b.line ?? 0) ||
      cmp(a.code, b.code) ||
      cmp(a.message, b.message),
  );
}

/** Turn a user-typed path (relative to cwd, any separators) into a project-relative `/` path. */
export function projectPath(root: string, cwd: string, input: string): string {
  const abs = resolve(realpathSync.native(cwd), input);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || resolve(root, rel) !== abs || rel === "") {
    throw new UsageError(errors.outsideProject(input, root));
  }
  return toPosix(rel);
}
