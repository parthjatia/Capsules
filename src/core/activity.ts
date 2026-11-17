// What capsules did on this machine, for a design partner's trial (C19, M6c): one log of every
// block, warning, proposal, approval, pause and internal error, and the pause switch.
// Both live in .capsules/_cache/ (never committed; agents can't edit it: C5.1, C11). This
// module is loaded by the hooks, so it uses only node:fs and node:path.
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const LOG_FILE = ".capsules/_cache/log.jsonl";
export const PAUSE_FILE = ".capsules/_cache/pause.json";
/** Older installs (rc.2) kept gentle-mode warnings here; still read, never written. */
export const OLD_GENTLE_LOG = ".capsules/_cache/gentle-log.jsonl";
export const PAUSE_HOURS = 24;

export type LogKind =
  | "block" // a hook blocked an edit or a shell command
  | "warning" // a hook allowed it with a warning (W111, W108)
  | "paused" // a hook would have blocked it, but capsules was paused
  | "proposal" // `capsules propose` left a proposal or note
  | "approval" // `capsules review approve` approved an item
  | "false-alarm" // a human marked an earlier entry as a false alarm
  | "pause"
  | "resume"
  | "error"; // capsules itself failed (a bug)

export interface LogEntry {
  time: string; // ISO, UTC
  kind: LogKind;
  code?: string; // E027, W111, …
  tool?: string; // Edit, Write, Bash, or the command
  file?: string; // project-relative path, or a capsule address
  agent?: string;
  summary: string; // one line, capsules' own words
  ref?: number; // false-alarm: the entry it is about
  why?: string; // false-alarm: the human's reason
  version?: string;
}

/** A log entry with its number: line 1 of the log is #1, so numbers never change. */
export type NumberedEntry = LogEntry & { n: number };

const at = (root: string, rel: string) => join(root, ...rel.split("/"));

/** The clock. `CAPSULES_NOW` (an ISO time) lets tests move it. */
export function now(env: NodeJS.ProcessEnv = process.env): Date {
  const v = env.CAPSULES_NOW?.trim();
  if (v) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

export function appendLog(
  root: string,
  e: Omit<LogEntry, "time"> & { time?: string },
  env: NodeJS.ProcessEnv = process.env,
): void {
  try {
    const p = at(root, LOG_FILE);
    mkdirSync(dirname(p), { recursive: true });
    const entry: LogEntry = { time: e.time ?? now(env).toISOString(), ...e } as LogEntry;
    appendFileSync(p, JSON.stringify(entry) + "\n");
  } catch {
    // The log is a convenience: never let it get in the way of the guard.
  }
}

function readLines(path: string): string[] {
  try {
    return readFileSync(path, "utf8").split("\n");
  } catch {
    return [];
  }
}

/** Every entry, oldest first, numbered by line. Unreadable lines keep their number. */
export function readLog(root: string): NumberedEntry[] {
  const out: NumberedEntry[] = [];
  readLines(at(root, LOG_FILE)).forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const e = JSON.parse(line) as LogEntry;
      if (e && typeof e.time === "string" && typeof e.kind === "string")
        out.push({ ...e, n: i + 1 });
    } catch {
      // skip
    }
  });
  return out;
}

/** Gentle-mode warnings an older version wrote to its own file, so an upgrade keeps them. */
export function readOldGentle(
  root: string,
): { date: string; agent: string; file: string; change: string; reason: string }[] {
  return readLines(at(root, OLD_GENTLE_LOG)).flatMap((l) => {
    if (!l.trim()) return [];
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}

// ---------------------------------------------------------------------------------------
// Pause (C19.1)

export interface PauseFile {
  format: "0.1";
  since: string;
  until: string;
  /** Set once the pause has run out, until the user has seen that it ended. */
  ended?: boolean;
}

export type PauseState =
  | { paused: true; since: string; until: string }
  | { paused: false; autoResumed?: { since: string; until: string } };

/**
 * Is capsules paused on this machine? A pause past its end is removed here, logged as an
 * automatic resume, and reported once (`autoResumed`), so the reminder reaches the user.
 */
export function pauseState(root: string, env: NodeJS.ProcessEnv = process.env): PauseState {
  const p = at(root, PAUSE_FILE);
  let f: PauseFile | null;
  try {
    f = JSON.parse(readFileSync(p, "utf8")) as PauseFile;
  } catch {
    return { paused: false };
  }
  const until = new Date(f?.until ?? "");
  const since = new Date(f?.since ?? "");
  const t = now(env).getTime();
  // A pause can't be longer than 24 hours, whatever the file says.
  const end = Math.min(until.getTime(), since.getTime() + PAUSE_HOURS * 3600_000);
  // A start in the future (a forged file) would make "24 hours from the start" never come.
  if (!f || Number.isNaN(end) || since.getTime() > t + 60_000) {
    rmSync(p, { force: true });
    return { paused: false };
  }
  if (t < end && !f.ended)
    return { paused: true, since: f.since, until: new Date(end).toISOString() };
  // Ended. Log it once, and keep the file (marked ended) until the user has been told, by
  // the end-of-task report or the next session's start (`clearPause`).
  if (!f.ended) {
    writeFileSync(p, JSON.stringify({ ...f, ended: true }, null, 2) + "\n");
    appendLog(
      root,
      {
        kind: "resume",
        time: new Date(end).toISOString(),
        summary: `capsules resumed automatically after the pause ended`,
      },
      env,
    );
  }
  return { paused: false, autoResumed: { since: f.since, until: new Date(end).toISOString() } };
}

export function writePause(root: string, since: Date, until: Date): void {
  const p = at(root, PAUSE_FILE);
  mkdirSync(dirname(p), { recursive: true });
  const f: PauseFile = { format: "0.1", since: since.toISOString(), until: until.toISOString() };
  writeFileSync(p, JSON.stringify(f, null, 2) + "\n");
}

export function clearPause(root: string): void {
  rmSync(at(root, PAUSE_FILE), { force: true });
}

/** "2026-11-18 14:05" in this computer's time zone: for people, never for files. */
export function localTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

/**
 * An internal error for the log: its kind and the first line of its message, with anything
 * in quotes cut out. Parsers quote the text they failed on, which could be code or a capsule.
 */
export function errorSummary(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const line = (raw.split("\n")[0] ?? "").replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "…").trim();
  return line.length > 160 ? line.slice(0, 157) + "..." : line;
}
