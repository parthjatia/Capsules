// Thin wrapper over the git CLI (D3). All paths returned use `/`.
import { spawnSync } from "node:child_process";
import { errors } from "../report/messages.js";

export class GitError extends Error {}

export function git(args: string[], cwd: string): string {
  const r = spawnSync("git", ["-c", "core.quotepath=off", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  if (r.error) throw new GitError(errors.gitFailed(args.join(" "), r.error.message));
  if (r.status !== 0) throw new GitError(errors.gitFailed(args.join(" "), r.stderr ?? ""));
  return r.stdout;
}

/** The repository's top-level folder, or null if `cwd` is not inside a Git repository. */
export function gitToplevel(cwd: string): string | null {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.error || r.status !== 0) return null;
  return r.stdout.trim();
}

/** Tracked files under `cwd`, relative to `cwd`. */
export function lsFiles(cwd: string): string[] {
  return git(["ls-files", "-z"], cwd)
    .split("\0")
    .filter((f) => f.length > 0);
}

/** Git blob hashes of files (relative to `cwd`), as `git hash-object` computes them. */
export function hashObjects(paths: string[], cwd: string): Map<string, string> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const hashes = git(["hash-object", "--", ...paths], cwd)
    .trim()
    .split("\n");
  paths.forEach((p, i) => {
    const h = hashes[i]?.trim();
    if (h) out.set(p, h);
  });
  return out;
}
