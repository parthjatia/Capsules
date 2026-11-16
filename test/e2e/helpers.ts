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
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CAPSULES_TODAY: "2026-11-16", NO_COLOR: "1" },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export const FM = (title: string, covers: string[] = [], extra = "") =>
  `---\ntitle: ${title}\n${covers.length ? `covers:\n${covers.map((c) => `  - "${c}"`).join("\n")}\n` : ""}${extra}---\n\n`;
