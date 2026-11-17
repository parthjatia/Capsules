// The fast entry for `capsules hook <event>` (C11, D-010). Loads only hook code and the
// saved index; the full CLI is never imported here.
import { readFileSync } from "node:fs";
import { hookMsg } from "../report/messages.js";
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
  try {
    if (event === "commit-msg") {
      const root = findRoot(io.cwd);
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
    // A byte-order mark (Windows PowerShell adds one when piping) must not crash the hook:
    // with on-error: open, a crash lets the edit through (M6h).
    const raw = io.stdin().replace(/^\uFEFF/, "");
    const input = (raw.trim() ? JSON.parse(raw) : {}) as HookInput;
    const root = findRoot(input.cwd ?? io.cwd);
    if (!root) return 0; // not a capsules project: nothing to guard
    if (event === "stop") {
      const text = await (await import("./stop.js")).stopReport(root);
      if (text) io.out(JSON.stringify({ systemMessage: text }) + "\n");
      return 0;
    }
    const index: HookIndex = await loadIndex(root);
    onError = index.config.onError;
    if (event === "session-start") {
      const text = (await import("./session-start.js")).sessionStart(input, root, index, io.env);
      if (text) io.out(text);
      return 0;
    }
    const result: HookResult =
      event === "pre-edit"
        ? await (await import("./pre-edit.js")).preEdit(input, root, index, io.env)
        : (await import("./pre-bash.js")).preBash(input, root, index);
    if (result.kind === "block") {
      io.err(result.reason);
      return 2;
    }
    if (result.notice) io.out(JSON.stringify({ systemMessage: result.notice }) + "\n");
    return 0;
  } catch (err) {
    // Report-only events: never in the way.
    if (event === "stop" || event === "commit-msg" || event === "session-start") return 0;
    io.err(hookMsg.crashed(err instanceof Error ? err.message : String(err), onError === "open"));
    return onError === "open" ? 1 : 2;
  }
}
