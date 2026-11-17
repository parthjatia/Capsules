// `capsules hook session-start` (C18.1, D-030): open this Claude Code session's capsules
// session, hand it to Claude's later shell commands through CLAUDE_ENV_FILE, and tell Claude
// in two lines who it is here. SessionStart can't block; this never fails the session.
import { appendFileSync } from "node:fs";
import { hookMsg } from "../report/messages.js";
import type { HookIndex } from "./index-cache.js";
import { openAutoSession } from "./session.js";

export interface SessionStartInput {
  session_id?: string;
  source?: string;
  agent_type?: string;
}

/** Returns the text for Claude's context, or null when there is nothing to open. */
export function sessionStart(
  input: SessionStartInput,
  root: string,
  index: HookIndex,
  env: NodeJS.ProcessEnv,
): string | null {
  if (!input.session_id) return null;
  const agents = index.permissions.agents;
  const agent = input.agent_type && agents[input.agent_type] ? input.agent_type : "default";
  const spec = agents[agent];
  if (!spec) return hookMsg.sessionNoDefault();
  const { session, reopened } = openAutoSession(
    root,
    input.session_id,
    agent,
    spec.role,
    spec.capsules,
  );
  const envFile = env.CLAUDE_ENV_FILE?.trim();
  if (envFile) appendFileSync(envFile, `export CAPSULES_SESSION=${session.id}\n`);
  return hookMsg.sessionStarted(
    session.id,
    session.agent,
    session.role,
    session.capsules,
    reopened,
  );
}
