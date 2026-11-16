// Running check commands (C9.1): the user's own shell commands, one at a time, in a fixed
// order. Exit code 0 means pass. Results go to .capsules/_cache/last-check.json.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { membershipOf } from "../core/membership.js";
import { address, ancestorsOf, type CapsuleNode } from "../core/model.js";
import { capsuleFromPath } from "../core/judges.js";
import type { Project } from "../core/project.js";
import { msg, type Diagnostic } from "../report/messages.js";

export interface CheckResult {
  address: string;
  run: string;
  status: "pass" | "fail" | "timeout";
  exitCode: number | null;
  durationMs: number;
}

/**
 * Affected capsules (C9.1): those whose covered files (or own capsule file) changed, their
 * ancestors, and the concerns covering changed files.
 */
export function affectedCapsules(project: Project, changedPaths: string[]): Set<string> {
  const out = new Set<string>();
  const ids = new Set(project.capsules.map((c) => c.id));
  for (const p of changedPaths) {
    const own = capsuleFromPath(p);
    if (own && ids.has(own.id)) out.add(own.id);
    if (p.startsWith(".capsules/")) continue;
    const m = membershipOf(p, project.capsules);
    if (m.home) out.add(m.home);
    for (const c of m.concerns) out.add(c);
  }
  for (const id of [...out]) {
    const c = project.capsules.find((x) => x.id === id);
    if (c?.kind === "area") for (const a of ancestorsOf(id)) if (ids.has(a)) out.add(a);
  }
  return out;
}

const field = (n: CapsuleNode, key: string) => n.fields.find((f) => f.key === key)?.value;

const OUTPUT_LINES = 15;

interface Ran {
  code: number | null;
  output: string;
  timedOut: boolean;
  startError: string | null;
}

/**
 * Run one shell command. On timeout, stop the whole process tree: killing only the shell
 * would leave the command itself running (and, on Windows, holding our pipes open).
 */
function runCommand(command: string, cwd: string, seconds: number): Promise<Ran> {
  return new Promise((done) => {
    let output = "";
    let timedOut = false;
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32", // its own process group, so we can stop it all
      stdio: ["ignore", "pipe", "pipe"],
    });
    const collect = (b: Buffer) => {
      output += b.toString("utf8");
      if (output.length > 1_000_000) output = output.slice(-500_000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, seconds * 1000);
    child.on("error", (e) => {
      clearTimeout(timer);
      done({ code: null, output, timedOut: false, startError: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, output, timedOut, startError: null });
    });
  });
}

function killTree(pid: number | undefined) {
  if (pid === undefined) return;
  try {
    if (process.platform === "win32")
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    else process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

export async function runChecks(
  project: Project,
  capsules: Set<string> | "all",
): Promise<{ results: CheckResult[]; diagnostics: Diagnostic[] }> {
  const results: CheckResult[] = [];
  const diagnostics: Diagnostic[] = [];
  const checks = project.capsules
    .filter((c) => capsules === "all" || capsules.has(c.id))
    .flatMap((c) => c.nodes.filter((n) => n.type === "check").map((n) => ({ c, n })))
    .sort((a, b) => (address(a.c.id, a.n.id) < address(b.c.id, b.n.id) ? -1 : 1));

  for (const { c, n } of checks) {
    const run = field(n, "run");
    if (!run) continue; // E007 already reported
    const addr = address(c.id, n.id);
    const seconds = Number(field(n, "timeout") ?? project.config.checks["timeout-seconds"]);
    const started = Date.now();
    const r = await runCommand(
      run,
      join(project.root, ...(field(n, "cwd") ?? ".").split("/")),
      seconds,
    );
    const result: CheckResult = {
      address: addr,
      run,
      status: r.timedOut ? "timeout" : r.code === 0 ? "pass" : "fail",
      exitCode: r.code,
      durationMs: Date.now() - started,
    };
    results.push(result);

    const at = { file: c.file, line: n.line };
    let d: Diagnostic | null = null;
    if (result.status === "timeout") d = msg.E032(at, addr, run, seconds);
    else if (result.status === "fail") {
      const output = r.output
        .replace(/\r\n?/g, "\n")
        .trimEnd()
        .split("\n")
        .slice(-OUTPUT_LINES)
        .map((l) => `    | ${l}`)
        .join("\n");
      const exit = r.startError ? `could not start: ${r.startError}` : `exit code ${r.code}`;
      d = msg.E031(at, addr, run, exit, output);
    }
    if (d) {
      if (c.front?.status === "draft") d.severity = "warning";
      diagnostics.push(d);
    }
  }

  try {
    const dir = join(project.root, ".capsules", "_cache");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "last-check.json"),
      JSON.stringify({ format: "0.1", results }, null, 2) + "\n",
    );
  } catch {
    // The cache is optional: never fail a check run because it can't be written.
  }
  return { results, diagnostics };
}
