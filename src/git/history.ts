// Git history for `capsules check` (C6): commits since the base, what each changed, file
// contents at a commit. All paths are relative to the project root (`cwd`), with `/`.
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { git } from "./git.js";

/** Run git, returning stdout or null on failure (for "does this exist?" questions). */
function tryGit(args: string[], cwd: string): string | null {
  const r = spawnSync("git", ["-c", "core.quotepath=off", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  return r.error || r.status !== 0 ? null : r.stdout;
}

/** The commit a ref names, or null if it doesn't exist. */
export function revParse(ref: string, cwd: string): string | null {
  return tryGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd)?.trim() || null;
}

export function mergeBase(a: string, b: string, cwd: string): string | null {
  return tryGit(["merge-base", a, b], cwd)?.trim() || null;
}

export function hasRemote(cwd: string): boolean {
  return (tryGit(["remote"], cwd) ?? "").trim().length > 0;
}

/** The email the next commit would be authored with, or null. */
export function configuredEmail(cwd: string): string | null {
  return tryGit(["config", "user.email"], cwd)?.trim() || null;
}

export interface Commit {
  sha: string;
  /** First parent, or null for a root commit. */
  parent: string | null;
  authorEmail: string;
  subject: string;
  /** Trailers, e.g. `Capsule-Agent` -> [`billing-agent`]. Keys as written. */
  trailers: Map<string, string[]>;
}

/** Non-merge commits after `base` up to HEAD that touch this project, oldest first. */
export function commitsSince(base: string, cwd: string): Commit[] {
  const out = git(
    [
      "log",
      "--no-merges",
      "--reverse",
      "--format=%H%x1f%P%x1f%ae%x1f%B%x1e",
      `${base}..HEAD`,
      "--",
      ".",
    ],
    cwd,
  );
  return out
    .split("\x1e")
    .map((r) => r.replace(/^\n+/, ""))
    .filter((r) => r.trim())
    .map((r) => {
      const [sha, parents, email, body] = r.split("\x1f") as [string, string, string, string];
      return {
        sha,
        parent: parents.trim().split(" ")[0] || null,
        authorEmail: email,
        subject: body.split("\n")[0] ?? "",
        trailers: parseTrailers(body),
      };
    });
}

/**
 * Trailers from a commit message: `Key: value` lines in the last paragraph. Only
 * `Capsule-*` and `Co-Authored-By`-style keys matter here, so a simple reader is enough.
 */
export function parseTrailers(message: string): Map<string, string[]> {
  const paras = message
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/);
  const last = paras[paras.length - 1] ?? "";
  const map = new Map<string, string[]>();
  if (paras.length < 2) return map; // a subject line alone has no trailers
  for (const line of last.split("\n")) {
    const m = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    map.set(m[1]!, [...(map.get(m[1]!) ?? []), m[2]!]);
  }
  return map;
}

export type ChangeStatus = "A" | "M" | "D";

export interface PathChange {
  path: string;
  status: ChangeStatus;
}

function parseNameStatus(out: string): PathChange[] {
  const parts = out.split("\0").filter((p) => p.length);
  const changes: PathChange[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const s = parts[i]![0] as string;
    const status: ChangeStatus = s === "A" ? "A" : s === "D" ? "D" : "M";
    changes.push({ path: parts[i + 1]!, status });
  }
  return changes;
}

/** Files a commit changed versus its first parent (or everything, for a root commit). */
export function commitChanges(c: Commit, cwd: string): PathChange[] {
  const args = c.parent
    ? ["diff", "--name-status", "-z", "--no-renames", "--relative", c.parent, c.sha, "--", "."]
    : [
        "diff-tree",
        "--root",
        "-r",
        "--name-status",
        "-z",
        "--no-renames",
        "--relative",
        c.sha,
        "--",
        ".",
      ];
  return parseNameStatus(git(args, cwd));
}

/** Changes in the working tree (staged, unstaged and untracked) versus `rev`. */
export function changesSince(rev: string, cwd: string): PathChange[] {
  const tracked = parseNameStatus(
    git(["diff", "--name-status", "-z", "--no-renames", "--relative", rev, "--", "."], cwd),
  );
  const untracked = git(["ls-files", "-z", "--others", "--exclude-standard", "--", "."], cwd)
    .split("\0")
    .filter((p) => p.length)
    .map((path) => ({ path, status: "A" as const }));
  return [...tracked, ...untracked];
}

/** The special "revision" for the working tree. */
export const WORKTREE = "WORKTREE";

/** A file's text at a commit (or in the working tree), or null if it doesn't exist there. */
export function fileAt(rev: string | null, path: string, cwd: string): string | null {
  if (rev === null) return null;
  if (rev === WORKTREE) {
    const abs = join(cwd, ...path.split("/"));
    return existsSync(abs) ? readFileSync(abs, "utf8") : null;
  }
  return tryGit(["show", `${rev}:./${path}`], cwd);
}

/** Every file under `prefix` at a commit, relative to the project root. */
export function filesAt(rev: string, prefix: string, cwd: string): string[] {
  return (tryGit(["ls-tree", "-r", "-z", "--name-only", rev, "--", prefix], cwd) ?? "")
    .split("\0")
    .filter((p) => p.length);
}
