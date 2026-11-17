// Trial safety (C19, M6c): `capsules pause` · `resume` · `log` · `report` · `stats`.
// Everything here reads or writes this machine's .capsules/_cache/ only, and sends nothing.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform, release, arch } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseDocument } from "yaml";
import {
  appendLog,
  clearPause,
  localTime,
  now,
  PAUSE_HOURS,
  pauseState,
  readLog,
  writePause,
  type NumberedEntry,
} from "../../core/activity.js";
import { findProjectRoot, loadProject, UsageError } from "../../core/project.js";
import { isOurs } from "../../install/settings-merge.js";
import { toJson } from "../../report/json.js";
import { trialMsg, type Stats } from "../../report/messages.js";
import { VERSION } from "../../version.js";
import { EXIT } from "../exit-codes.js";
import type { Io } from "../io.js";
import { inAgentShell } from "./review.js";

// ---------------------------------------------------------------------------------------
// pause / resume (C19.1)

export function pause(
  io: Io,
  opts: { hours?: string; dryRun?: boolean; json?: boolean },
  env = process.env,
): number {
  if (inAgentShell(env)) {
    io.err(trialMsg.humansOnly("capsules pause"));
    return EXIT.problems;
  }
  const root = findProjectRoot(io.cwd);
  const hours = opts.hours === undefined ? PAUSE_HOURS : Number(opts.hours);
  if (!Number.isInteger(hours) || hours < 1 || hours > PAUSE_HOURS)
    throw new UsageError(trialMsg.badHours(String(opts.hours)));
  const since = now(env);
  const until = new Date(since.getTime() + hours * 3600_000);
  const was = pauseState(root, env);
  if (!opts.dryRun) {
    writePause(root, since, until);
    appendLog(
      root,
      { kind: "pause", tool: "capsules pause", summary: `paused for ${hours} hours` },
      env,
    );
  }
  if (opts.json)
    io.out(
      toJson("pause", { paused: true, until: until.toISOString(), hours, dryRun: !!opts.dryRun }),
    );
  else io.out(trialMsg.paused(until.toISOString(), hours, was.paused, !!opts.dryRun));
  return EXIT.ok;
}

export function resume(
  io: Io,
  opts: { dryRun?: boolean; json?: boolean },
  env = process.env,
): number {
  if (inAgentShell(env)) {
    io.err(trialMsg.humansOnly("capsules resume"));
    return EXIT.problems;
  }
  const root = findProjectRoot(io.cwd);
  const state = pauseState(root, env);
  if (!opts.dryRun) clearPause(root); // also a pause that ended by itself
  if (state.paused && !opts.dryRun) {
    appendLog(root, { kind: "resume", tool: "capsules resume", summary: "resumed by hand" }, env);
  }
  if (opts.json) io.out(toJson("resume", { wasPaused: state.paused, dryRun: !!opts.dryRun }));
  else io.out(trialMsg.resumed(state.paused, !!opts.dryRun));
  return EXIT.ok;
}

// ---------------------------------------------------------------------------------------
// log (C19.2)

export interface LogOptions {
  all?: boolean;
  limit?: string;
  falseAlarm?: string;
  why?: string;
  dryRun?: boolean;
  json?: boolean;
}

/** Entries a human may mark as a false alarm. */
const MARKABLE = new Set(["block", "paused", "warning"]);

export function log(io: Io, opts: LogOptions, env = process.env): number {
  const root = findProjectRoot(io.cwd);
  const entries = readLog(root);
  if (opts.falseAlarm !== undefined) {
    if (inAgentShell(env)) {
      io.err(trialMsg.humansOnly("capsules log --false-alarm"));
      return EXIT.problems;
    }
    const n = Number(String(opts.falseAlarm).replace(/^#/, ""));
    const target = entries.find((e) => e.n === n);
    if (!target || !MARKABLE.has(target.kind))
      throw new UsageError(trialMsg.notMarkable(String(opts.falseAlarm), !!target));
    const why = opts.why?.trim() ?? "";
    if (!opts.dryRun)
      appendLog(
        root,
        {
          kind: "false-alarm",
          tool: "capsules log --false-alarm",
          ref: n,
          ...(target.code ? { code: target.code } : {}),
          ...(target.file ? { file: target.file } : {}),
          summary: `#${n} marked as a false alarm`,
          ...(why ? { why: why.slice(0, 300) } : {}),
        },
        env,
      );
    if (opts.json) io.out(toJson("log-false-alarm", { entry: n, why, dryRun: !!opts.dryRun }));
    else io.out(trialMsg.marked(n, !!opts.dryRun));
    return EXIT.ok;
  }
  const limit = opts.all ? Infinity : opts.limit ? Number(opts.limit) : 50;
  if (!(limit > 0)) throw new UsageError(trialMsg.badLimit(String(opts.limit)));
  const newest = [...entries].reverse().slice(0, limit);
  const marked = falseAlarms(entries);
  if (opts.json)
    io.out(
      toJson("log", {
        total: entries.length,
        entries: newest.map((e) => ({ ...e, falseAlarm: marked.has(e.n) })),
      }),
    );
  else io.out(trialMsg.log(newest, entries.length, marked, pauseState(root, env)));
  return EXIT.ok;
}

function falseAlarms(entries: NumberedEntry[]): Set<number> {
  return new Set(
    entries.filter((e) => e.kind === "false-alarm" && e.ref).map((e) => e.ref as number),
  );
}

// ---------------------------------------------------------------------------------------
// stats (C19.5)

export function parseSince(since: string | undefined): { ms: number; label: string } {
  const v = (since ?? "7d").trim();
  const m = /^(\d+)\s*([dh])$/i.exec(v);
  if (!m || Number(m[1]) < 1) throw new UsageError(trialMsg.badSince(v));
  const n = Number(m[1]);
  const day = m[2]!.toLowerCase() === "d";
  return {
    ms: n * (day ? 86_400_000 : 3_600_000),
    label: `${n} ${day ? "day" : "hour"}${n === 1 ? "" : "s"}`,
  };
}

export function statsOf(entries: NumberedEntry[], fromMs: number): Stats {
  const inWindow = entries.filter((e) => new Date(e.time).getTime() >= fromMs);
  const count = (k: string) => inWindow.filter((e) => e.kind === k).length;
  const byCode = (k: string) => {
    const m = new Map<string, number>();
    for (const e of inWindow.filter((x) => x.kind === k))
      m.set(e.code ?? "other", (m.get(e.code ?? "other") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const files = new Map<string, number>();
  for (const e of inWindow.filter((x) => x.kind === "block" || x.kind === "paused"))
    if (e.file) files.set(e.file, (files.get(e.file) ?? 0) + 1);
  return {
    blocks: count("block"),
    blocksByCode: byCode("block"),
    paused: count("paused"),
    warnings: count("warning"),
    warningsByCode: byCode("warning"),
    proposals: count("proposal"),
    approvals: count("approval"),
    falseAlarms: count("false-alarm"),
    pauses: count("pause"),
    errors: count("error"),
    topFiles: [...files.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5),
  };
}

export function stats(io: Io, opts: { since?: string; json?: boolean }, env = process.env): number {
  const root = findProjectRoot(io.cwd);
  const { ms, label } = parseSince(opts.since);
  const s = statsOf(readLog(root), now(env).getTime() - ms);
  if (opts.json) io.out(toJson("stats", { since: opts.since ?? "7d", ...s }));
  else io.out(trialMsg.stats(label, s));
  return EXIT.ok;
}

// ---------------------------------------------------------------------------------------
// report (C19.3)

export const REPORT_FILE = ".capsules/_cache/capsules-report.txt";

/** Hide what a report must never carry: email addresses and this machine's folders. */
export function scrub(text: string, root: string): string {
  let out = text.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email hidden>");
  const hide = (path: string, as: string) => {
    if (!path || path.length < 3) return;
    for (const v of new Set([path, path.split("\\").join("/"), path.split("/").join("\\")]))
      out = out.split(v).join(as);
  };
  hide(root, "<project>");
  hide(homedir(), "~");
  return out;
}

function gitVersion(cwd: string): string {
  const r = spawnSync("git", ["--version"], { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim().replace(/^git version /, "") : "not found";
}

function hookState(root: string): string {
  const p = join(root, ".claude", "settings.local.json");
  if (!existsSync(p)) return "not installed on this machine";
  try {
    const s = JSON.parse(readFileSync(p, "utf8")) as {
      hooks?: Record<string, { hooks?: { command?: string }[] }[]>;
    };
    const cmds = Object.values(s.hooks ?? {})
      .flat()
      .flatMap((g) => g.hooks ?? [])
      .map((h) => h.command ?? "")
      .filter(isOurs);
    if (!cmds.length) return "not installed on this machine";
    // Each command is `node "<cli>" hook <event>`: does that CLI still exist (after an upgrade)?
    const clis = [...new Set(cmds.map((c) => /"([^"]+)"/.exec(c)?.[1] ?? "?"))];
    const missing = clis.filter((c) => c !== "?" && !existsSync(c));
    return (
      `${cmds.length} installed` +
      (missing.length
        ? `; MISSING program: ${missing.join(", ")} (run \`capsules init\` again)`
        : "; the program they call exists")
    );
  } catch {
    return "Claude Code's settings.local.json can't be read";
  }
}

export function buildReport(root: string, env = process.env): string {
  const entries = readLog(root);
  const marked = falseAlarms(entries);
  const state = pauseState(root, env);
  const t = now(env);
  let project: ReturnType<typeof loadProject> | null;
  try {
    project = loadProject(root);
  } catch {
    project = null;
  }
  const lines: string[] = [];
  const add = (...l: string[]) => lines.push(...l);

  add(
    "capsules trial report",
    "",
    `Written by \`capsules report\` on ${localTime(t.toISOString())}. Nothing has been sent anywhere.`,
    "It holds versions, settings and what capsules did on this machine. It never holds your code,",
    "the text of your capsules, proposals' wording, people's names or email addresses.",
    "File paths and capsule names (like billing#C1) do appear. Read it before you share it.",
    "",
    "## Versions",
    `capsules: ${VERSION}`,
    `node:     ${process.version}`,
    `git:      ${gitVersion(root)}`,
    `system:   ${platform()} ${release()} ${arch()}`,
    "",
    "## Setup",
    `paused:   ${state.paused ? `yes, until ${localTime(state.until)}` : "no"}`,
    `hooks:    ${hookState(root)}`,
  );
  if (project) {
    const caps = project.capsules;
    const nodes = caps.flatMap((c) => c.nodes);
    const kind = (k: string) => nodes.filter((n) => n.type === k).length;
    const perms = project.permissions;
    add(
      `mode:     ${project.config.mode}`,
      `capsules: ${caps.filter((c) => c.kind === "area").length} areas, ${caps.filter((c) => c.kind === "concern").length} concerns; ` +
        `${kind("intent")} intents, ${kind("contract")} rules, ${kind("example")} examples, ${kind("check")} checks, ${kind("decision")} decisions`,
      `files:    ${project.tracked.length} tracked`,
      `people:   ${Object.keys(perms.humans).length} in permissions.yaml (solo: ${perms.solo ? "yes" : "no"})`,
      `agents:   ${Object.entries(perms.agents)
        .map(([name, a]) => `${name} (${a.role})`)
        .join(", ")}`,
      `problems: ${project.diagnostics.filter((d) => d.severity === "error").length} errors, ${project.diagnostics.filter((d) => d.severity === "warning").length} warnings (codes: ${
        [...new Set(project.diagnostics.map((d) => d.code))].sort().join(", ") || "none"
      })`,
    );
  } else add("capsules: the capsules can't be read (run `capsules check --no-run`)");

  add("", "## Settings (.capsules/config.yaml, comments left out)");
  try {
    const text = readFileSync(join(root, ".capsules", "config.yaml"), "utf8");
    const value: unknown = parseDocument(text).toJS();
    add(JSON.stringify(value ?? {}, null, 2));
  } catch {
    add("(no config.yaml, or it can't be read: the defaults apply)");
  }

  const week = statsOf(entries, t.getTime() - 7 * 86_400_000);
  add("", "## The last 7 days", trialMsg.stats("7 days", week).trimEnd());

  const errs = entries.filter((e) => e.kind === "error").slice(-20);
  add("", `## Internal errors (${entries.filter((e) => e.kind === "error").length} in all)`);
  if (!errs.length) add("none");
  for (const e of errs) add(trialMsg.reportLine(e, marked));

  const last = entries.slice(-50);
  add("", `## The last ${last.length} log entries (of ${entries.length}), oldest first`);
  if (!last.length) add("none");
  for (const e of last) add(trialMsg.reportLine(e, marked));

  return scrub(lines.join("\n") + "\n", root);
}

export function report(
  io: Io,
  opts: { out?: string; dryRun?: boolean; json?: boolean },
  env = process.env,
): number {
  const root = findProjectRoot(io.cwd);
  const text = buildReport(root, env);
  const file = opts.out ? resolve(io.cwd, opts.out) : join(root, ...REPORT_FILE.split("/"));
  if (!opts.dryRun) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  const shown = scrub(file, root);
  if (opts.json) io.out(toJson("report", { file: shown, text, dryRun: !!opts.dryRun }));
  else io.out(trialMsg.reportShown(text, shown, !!opts.dryRun));
  return EXIT.ok;
}
