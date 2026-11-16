// Helpers for end-to-end tests: temporary Git repos and running the built CLI.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const ROOT = join(import.meta.dirname, "..", "..");
export const CLI = join(ROOT, "dist", "cli.js");
const made: string[] = [];

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

/** A fresh temp Git repo containing `files` (path -> content), all staged. */
export function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "capsules-e2e-"));
  made.push(dir);
  git(dir, "init", "-q");
  for (const [path, content] of Object.entries(files)) {
    const abs = join(dir, ...path.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  git(dir, "add", "-A");
  return dir;
}

/** A temp Git repo with a copy of examples/billing-demo. */
export function demoRepo(): string {
  const dir = makeRepo({});
  cpSync(join(ROOT, "examples", "billing-demo"), dir, { recursive: true });
  git(dir, "add", "-A");
  return dir;
}

export function cleanup(): void {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
}

export function run(cwd: string, ...args: string[]) {
  return runEnv(cwd, {}, ...args);
}

/** Run the CLI with extra environment variables. GitHub Actions variables from the machine
 * running the tests are removed, so a test only sees an event file if it passes one. */
export function runEnv(cwd: string, extra: Record<string, string>, ...args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, CAPSULES_TODAY: "2026-11-16", NO_COLOR: "1" };
  delete env.GITHUB_ACTIONS;
  delete env.GITHUB_EVENT_PATH;
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...env, ...extra },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export const PARTH_NOREPLY = "63094286+parthjatia@users.noreply.github.com";

/** Run git in `cwd`, failing the test if it fails. */
export function gitIn(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

/**
 * The demo app as a repo with history: everything committed on `main` by `email`, then a
 * `work` branch checked out, so `capsules check` compares against main.
 */
export function demoHistory(email = PARTH_NOREPLY): string {
  const dir = demoRepo();
  gitIn(dir, "config", "core.autocrlf", "false");
  gitIn(dir, "config", "user.name", "Test");
  gitIn(dir, "config", "user.email", email);
  gitIn(dir, "checkout", "-q", "-b", "main");
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", "base");
  gitIn(dir, "checkout", "-q", "-b", "work");
  return dir;
}

/** Commit everything, with optional trailers (`Key: value` lines) and author email. */
export function commit(dir: string, subject: string, trailers: string[] = [], email?: string) {
  gitIn(dir, "add", "-A");
  const message = trailers.length ? `${subject}\n\n${trailers.join("\n")}` : subject;
  const author = email ? ["-c", `user.email=${email}`] : [];
  gitIn(dir, ...author, "commit", "-q", "-m", message);
}

export const FM = (title: string, covers: string[] = [], extra = "") =>
  `---\ntitle: ${title}\n${covers.length ? `covers:\n${covers.map((c) => `  - "${c}"`).join("\n")}\n` : ""}${extra}---\n\n`;
