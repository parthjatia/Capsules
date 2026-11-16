// Sessions (C8) and what each session has changed, so the hooks can apply the one rule
// within a session (C6.2, D-024). Everything lives in .capsules/_cache/sessions/.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Perms } from "../core/access.js";

export const SESSIONS_DIR = ".capsules/_cache/sessions";

export interface WorkSession {
  format: "0.1";
  id: string;
  agent: string;
  role: string;
  capsules: string[];
  started: string;
}

/** What one session has changed so far. */
export interface Tracking {
  format: "0.1";
  /** Code files, with the capsules (home and concerns) they belong to. */
  code: { path: string; capsules: string[] }[];
  /** Changes to existing checks, with the capsules each check judges. */
  checks: { what: string; judges: string[] }[];
  /** Files this session created: editing them later is not changing an "existing" check. */
  created: string[];
  /** Existing intents this session changed. */
  intents: string[];
  /** Contracts and examples this session changed, with the intents they serve. */
  rules: { addr: string; serves: string[] }[];
}

const dir = (root: string) => join(root, ...SESSIONS_DIR.split("/"));
const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100);

function writeJson(path: string, value: unknown) {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  renameSync(tmp, path);
}

function readJson<T>(path: string): T | null {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
  } catch {
    return null;
  }
}

/** The work session in force: CAPSULES_SESSION if set, otherwise the current one. */
export function activeWorkSession(root: string, env = process.env): WorkSession | null {
  const id = env.CAPSULES_SESSION?.trim() || readCurrent(root);
  return id ? readJson<WorkSession>(join(dir(root), `${safe(id)}.json`)) : null;
}

function readCurrent(root: string): string | null {
  try {
    return readFileSync(join(dir(root), "current"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function startWorkSession(
  root: string,
  agent: string,
  role: string,
  capsules: string[],
): WorkSession {
  const s: WorkSession = {
    format: "0.1",
    id: randomBytes(8).toString("hex"),
    agent,
    role,
    capsules,
    started: new Date().toISOString(),
  };
  writeJson(join(dir(root), `${s.id}.json`), s);
  writeFileSync(join(dir(root), "current"), s.id + "\n");
  return s;
}

/** End the current (or CAPSULES_SESSION) work session. Returns it, or null if none was active. */
export function endWorkSession(root: string, env = process.env): WorkSession | null {
  const s = activeWorkSession(root, env);
  if (!s) return null;
  rmSync(join(dir(root), `${safe(s.id)}.json`), { force: true });
  rmSync(join(dir(root), `track-work-${safe(s.id)}.json`), { force: true });
  if (readCurrent(root) === s.id) rmSync(join(dir(root), "current"), { force: true });
  return s;
}

export interface HookActor {
  agent: string;
  /** A work session narrows the agent's capsules (C8). */
  scope?: string[];
  /** Which session's changes the one rule is applied to. */
  trackKey: string;
}

/**
 * C8: a sub-agent (or `claude --agent`) named in permissions.yaml is the actor; otherwise
 * the work session's agent; otherwise `default`. Sub-agents share their parent's session.
 */
export function resolveActor(
  input: { agent_type?: string; session_id?: string },
  root: string,
  perms: Perms,
  env = process.env,
): HookActor {
  const work = activeWorkSession(root, env);
  const trackKey = work ? `work-${work.id}` : `claude-${input.session_id ?? "unknown"}`;
  if (input.agent_type && perms.agents[input.agent_type]) {
    const agent = input.agent_type;
    return work && work.agent === agent
      ? { agent, scope: work.capsules, trackKey }
      : { agent, trackKey };
  }
  if (work) return { agent: work.agent, scope: work.capsules, trackKey };
  return { agent: "default", trackKey };
}

const trackFile = (root: string, key: string) => join(dir(root), `track-${safe(key)}.json`);

export function readTracking(root: string, key: string): Tracking {
  return (
    readJson<Tracking>(trackFile(root, key)) ?? {
      format: "0.1",
      code: [],
      checks: [],
      created: [],
      intents: [],
      rules: [],
    }
  );
}

export function writeTracking(root: string, key: string, t: Tracking): void {
  writeJson(trackFile(root, key), t);
}

/** Cosmetic marks waiting for the next commit message (C7.3, D-013). */
export const PENDING_COSMETIC = ".capsules/_cache/pending-cosmetic.json";

export function addPendingCosmetic(root: string, address: string): void {
  const p = join(root, ...PENDING_COSMETIC.split("/"));
  const list = readJson<string[]>(p) ?? [];
  if (!list.includes(address)) list.push(address);
  writeJson(p, list.sort());
}

export function takePendingCosmetic(root: string): string[] {
  const p = join(root, ...PENDING_COSMETIC.split("/"));
  const list = readJson<string[]>(p) ?? [];
  rmSync(p, { force: true });
  return list;
}
