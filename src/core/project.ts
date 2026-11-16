// Find and load a project: the `.capsules/` folder, its settings, every capsule file,
// the tracked files, and all validation diagnostics.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseConfig, type Config } from "./config.js";
import { computeMembership, type MembershipResult } from "./membership.js";
import type { Capsule, CapsuleKind } from "./model.js";
import { parseCapsuleFile } from "./parse.js";
import { parsePermissions, type Permissions } from "./permissions.js";
import { validateGraph } from "./resolve.js";
import { gitToplevel, lsFiles } from "../git/git.js";
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
    diagnostics: sortDiagnostics(diagnostics),
  };
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
