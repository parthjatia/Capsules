// The fast entry for `capsules hook <event>` (C11, D-010). Loads only hook code and the
// saved index; the full CLI is never imported here.
import { readFileSync } from "node:fs";
import { basename, isAbsolute, relative, sep } from "node:path";
import {
  appendLog,
  clearPause,
  errorSummary,
  pauseState,
  type PauseState,
} from "../core/activity.js";
import { hookMsg, trialMsg } from "../report/messages.js";
import { VERSION } from "../version.js";
import { findRoot, loadIndex, type HookIndex } from "./index-cache.js";
import type { HookInput, HookResult } from "./pre-edit.js";

export interface HookIo {
  stdin: () => string;
  out: (t: string) => void;
  err: (t: string) => void;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

const processHookIo = (): HookIo => ({
  stdin: () => {
    try {
      return readFileSync(0, "utf8");
    } catch {
      return "";
    }
  },
  out: (t) => void process.stdout.write(t),
  err: (t) => void process.stderr.write(t),
  cwd: process.cwd(),
  env: process.env,
});

/** Run one hook; returns the exit code (0 allow, 2 block, 1 crash with on-error open). */
export async function runHook(args: string[], io: HookIo = processHookIo()): Promise<number> {
  const event = args[0];
  let onError: "open" | "closed" = "open";
  let root: string | null = null;
  try {
    if (event === "commit-msg") {
      root = findRoot(io.cwd);
      const file = args[1];
      if (root && file) (await import("./commit-msg.js")).commitMsg(root, file, io.env);
      return 0;
    }
    if (
      event !== "pre-edit" &&
      event !== "pre-bash" &&
      event !== "stop" &&
      event !== "session-start"
    ) {
      io.err(
        `error  unknown hook "${event ?? ""}". Use session-start, pre-edit, pre-bash, stop or commit-msg.\n`,
      );
      return 64;
    }
    const raw = io.stdin();
    const input = (raw.trim() ? JSON.parse(raw) : {}) as HookInput;
    root = findRoot(input.cwd ?? io.cwd);
    if (!root) return 0; // not a capsules project: nothing to guard
    // C19.1: a pause is for this machine only, and ends by itself after 24 hours.
    const pause = pauseState(root, io.env);
    const reminder = pauseReminder(pause);
    if (event === "stop") {
      const text = await (await import("./stop.js")).stopReport(root);
      const all = [reminder, text].filter(Boolean).join("\n");
      if (all) io.out(JSON.stringify({ systemMessage: all }) + "\n");
      if (!pause.paused && pause.autoResumed) clearPause(root); // the user has been told
      return 0;
    }
    const index: HookIndex = await loadIndex(root);
    onError = index.config.onError;
    if (event === "session-start") {
      const text = (await import("./session-start.js")).sessionStart(input, root, index, io.env);
      const all = (text ?? "") + (reminder ? reminder + "\n" : "");
      if (all) io.out(all);
      if (!pause.paused && pause.autoResumed) clearPause(root);
      return 0;
    }
    const result: HookResult =
      event === "pre-edit"
        ? await (await import("./pre-edit.js")).preEdit(input, root, index, io.env)
        : (await import("./pre-bash.js")).preBash(input, root, index);
    const where = logFields(input, root, event);
    if (result.kind === "block") {
      const facts = fromReason(result.reason);
      if (pause.paused) {
        // Still judged and logged, but let through (C19.1).
        appendLog(root, { kind: "paused", ...where, ...facts }, io.env);
        const note = trialMsg.pausedAllowed(facts.code ?? "E027", facts.summary, pause.until);
        io.out(JSON.stringify({ systemMessage: note }) + "\n");
        return 0;
      }
      appendLog(root, { kind: "block", ...where, ...facts }, io.env);
      io.err(result.reason + (reminder ? reminder + "\n" : ""));
      return 2;
    }
    // W111 is logged by pre-edit itself, with the agent and the change (C18.5).
    for (const line of (result.notice ?? "").split("\n"))
      if (line.includes("(W108)"))
        appendLog(
          root,
          { kind: "warning", code: "W108", ...where, summary: oneLine(line) },
          io.env,
        );
    const notice = [reminder, result.notice].filter(Boolean).join("\n");
    if (notice) io.out(JSON.stringify({ systemMessage: notice }) + "\n");
    return 0;
  } catch (err) {
    // A crash before the project was found (unreadable input) is logged too.
    if (!root) {
      try {
        root = findRoot(io.cwd);
      } catch {
        root = null;
      }
    }
    if (root)
      appendLog(
        root,
        {
          kind: "error",
          tool: `hook ${event ?? ""}`,
          summary: errorSummary(err),
          version: VERSION,
        },
        io.env,
      );
    // Report-only events: never in the way.
    if (event === "stop" || event === "commit-msg" || event === "session-start") return 0;
    io.err(hookMsg.crashed(err instanceof Error ? err.message : String(err), onError === "open"));
    return onError === "open" ? 1 : 2;
  }
}

/** Shown while paused, and once when a pause has ended by itself (C19.1). */
function pauseReminder(p: PauseState): string | null {
  if (p.paused) return trialMsg.pausedReminder(p.until);
  if (p.autoResumed) return trialMsg.autoResumed(p.autoResumed.until);
  return null;
}

const oneLine = (t: string): string => {
  const l = (t.split("\n")[0] ?? "").trim();
  return l.length > 200 ? l.slice(0, 197) + "..." : l;
};

interface Facts {
  code?: string;
  summary: string;
  agent?: string;
  file?: string;
}

/** The facts of a block, from capsules' own message: code, one-line summary, agent, file. */
function fromReason(reason: string): Facts {
  const lines = reason.split("\n");
  const m = /^capsules blocked this change \((\w+)\): (.*)$/.exec(lines[0] ?? "");
  const field = (k: string): string | undefined => {
    const prefix = `  ${k}:`;
    const l = lines.find((x) => x.startsWith(prefix));
    return l ? l.slice(prefix.length).trim() || undefined : undefined;
  };
  const out: Facts = { summary: oneLine(m ? m[2]! : (lines[0] ?? "")) };
  if (m) out.code = m[1]!;
  const agent = field("agent");
  if (agent) out.agent = agent;
  const file = field("file");
  if (file) out.file = file;
  return out;
}

/** Tool, file and agent from the hook input; never the edit's text or the shell command. */
function logFields(
  input: HookInput,
  root: string,
  event: string,
): { tool: string; file?: string; agent: string } {
  const out: { tool: string; file?: string; agent: string } = {
    tool: typeof input.tool_name === "string" && input.tool_name ? input.tool_name : event,
    agent: typeof input.agent_type === "string" && input.agent_type ? input.agent_type : "default",
  };
  const fp = input.tool_input?.file_path;
  if (typeof fp === "string" && fp) {
    const rel = relative(root, fp).split(sep).join("/");
    out.file = rel.startsWith("..") || isAbsolute(rel) ? basename(fp) : rel;
  }
  return out;
}
