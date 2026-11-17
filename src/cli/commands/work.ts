import { capsuleMatches } from "../../core/access.js";
import { findProjectRoot, loadProject, UsageError } from "../../core/project.js";
import {
  activeWorkSession,
  endWorkSession,
  narrowWorkSession,
  startWorkSession,
} from "../../hooks/session.js";
import { toJson } from "../../report/json.js";
import { errors } from "../../report/messages.js";
import { EXIT } from "../exit-codes.js";
import type { Io } from "../io.js";

// `capsules work <pattern> [--agent <name>]` and `capsules work --end` (C8).
export function work(
  io: Io,
  pattern: string | undefined,
  opts: { agent?: string; end?: boolean; json?: boolean },
  env = process.env,
): number {
  const project = loadProject(findProjectRoot(io.cwd));
  if (opts.end) {
    const s = endWorkSession(project.root, env);
    if (opts.json) io.out(toJson("work", { ended: s }));
    else
      io.out(
        s
          ? `Ended session ${s.id} (${s.agent} on ${s.capsules.join(", ")}).\n`
          : "No work session was active. Nothing to end.\n",
      );
    return EXIT.ok;
  }
  if (!pattern) throw new UsageError(errors.workNeedsPattern());
  const agent = opts.agent ?? "default";
  const spec = project.permissions.agents[agent];
  if (!spec)
    throw new UsageError(errors.workUnknownAgent(agent, Object.keys(project.permissions.agents)));
  const patterns = pattern
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const ids = project.capsules.map((c) => c.id);
  const matched = ids.filter((id) => patterns.some((p) => capsuleMatches(id, p))).sort();
  if (!matched.length) throw new UsageError(errors.workNoCapsule(pattern, ids));
  // Inside a Claude Code session with an automatic session (C18.1), narrow that one.
  const auto = activeWorkSession(project.root, env);
  const s =
    auto && auto.id.startsWith("cc-") && env.CAPSULES_SESSION?.trim() === auto.id
      ? narrowWorkSession(project.root, auto, agent, spec.role, patterns)
      : startWorkSession(project.root, agent, spec.role, patterns);
  if (opts.json) {
    io.out(toJson("work", { session: s, capsules: matched }));
    return EXIT.ok;
  }
  io.out(
    [
      `Started session ${s.id}.`,
      `  agent:    ${agent} (role: ${spec.role})`,
      `  capsules: ${matched.join(", ")}`,
      "",
      "The hooks now check every edit against this session. Commits get these trailers",
      "(added by the commit-msg hook if installed, otherwise add them yourself):",
      "",
      `  Capsule-Session: ${s.id}`,
      `  Capsule-Agent: ${agent}`,
      `  Capsule-Role: ${spec.role}`,
      `  Capsule-Scope: ${patterns.join(", ")}`,
      "",
      `To run several sessions at once, set CAPSULES_SESSION=${s.id} in this one's shell.`,
      "End it with `capsules work --end`.",
    ].join("\n") + "\n",
  );
  return EXIT.ok;
}
