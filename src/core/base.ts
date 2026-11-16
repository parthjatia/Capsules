// The base `capsules check` compares against (C6.4, D-018). No network: in GitHub Actions
// the pull request's base comes from the local event file.
import { existsSync, readFileSync } from "node:fs";
import { mergeBase, revParse } from "../git/history.js";
import { errors } from "../report/messages.js";
import { UsageError } from "./project.js";

export interface Base {
  /** What was asked for or found, e.g. `origin/main`; null when there is none. */
  ref: string | null;
  /** The merge base of HEAD and `ref`; null when only uncommitted changes are checked. */
  sha: string | null;
  /** How it was chosen, in plain words, for the report. */
  how: string;
}

export interface GithubEvent {
  baseSha: string | null;
  baseRef: string | null;
  prAuthor: string | null;
}

/** The pull request fields we need from GITHUB_EVENT_PATH, or null outside a PR run. */
export function readGithubEvent(env: NodeJS.ProcessEnv = process.env): GithubEvent | null {
  if (env.GITHUB_ACTIONS !== "true" || !env.GITHUB_EVENT_PATH) return null;
  if (!existsSync(env.GITHUB_EVENT_PATH)) return null;
  try {
    const e = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8")) as {
      pull_request?: { base?: { sha?: string; ref?: string }; user?: { login?: string } };
    };
    const pr = e.pull_request;
    if (!pr) return null;
    return {
      baseSha: pr.base?.sha ?? null,
      baseRef: pr.base?.ref ?? null,
      prAuthor: pr.user?.login ?? null,
    };
  } catch {
    return null;
  }
}

export function resolveBase(cwd: string, explicit?: string): Base {
  const head = revParse("HEAD", cwd);
  const finish = (ref: string, how: string): Base => ({
    ref,
    sha: head ? mergeBase(head, ref, cwd) : null,
    how,
  });

  if (explicit !== undefined) {
    if (!revParse(explicit, cwd)) throw new UsageError(errors.badBase(explicit));
    return finish(explicit, "given with --base");
  }
  const event = readGithubEvent();
  if (event) {
    if (event.baseSha && revParse(event.baseSha, cwd))
      return finish(event.baseSha, "the pull request's base (GitHub Actions event file)");
    if (event.baseRef && revParse(`origin/${event.baseRef}`, cwd))
      return finish(
        `origin/${event.baseRef}`,
        "the pull request's base branch (GitHub Actions event file)",
      );
  }
  for (const ref of ["origin/HEAD", "origin/main"]) {
    if (revParse(ref, cwd)) return finish(ref, "the remote's default branch");
  }
  if (revParse("main", cwd)) return finish("main", "the local main branch, as there is no remote");
  return { ref: null, sha: null, how: "no base found, so only uncommitted changes are checked" };
}
