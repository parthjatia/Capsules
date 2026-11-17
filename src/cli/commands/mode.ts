// `capsules mode [strict|gentle]` (C18.5, D-034): show the mode and what strict mode would have
// blocked on this machine; set it (humans only). Keeps config.yaml's comments and layout.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { findProjectRoot, loadProject, UsageError } from "../../core/project.js";
import { readGentle } from "../../hooks/session.js";
import { toJson } from "../../report/json.js";
import { modeMsg, reviewMsg } from "../../report/messages.js";
import { EXIT } from "../exit-codes.js";
import type { Io } from "../io.js";
import { inAgentShell } from "./review.js";

export function mode(
  io: Io,
  value: string | undefined,
  opts: { dryRun?: boolean; json?: boolean },
  env = process.env,
): number {
  const project = loadProject(findProjectRoot(io.cwd));
  const now = project.config.mode;
  const log = readGentle(project.root);
  if (value === undefined) {
    if (opts.json) io.out(toJson("mode", { mode: now, wouldHaveBlocked: log }));
    else io.out(modeMsg.show(now, log));
    return EXIT.ok;
  }
  if (value !== "strict" && value !== "gentle") throw new UsageError(modeMsg.bad(value));
  if (inAgentShell(env)) {
    io.err(reviewMsg.humansOnly(`capsules mode ${value}`));
    return EXIT.problems;
  }
  if (value === now) {
    io.out(modeMsg.already(now));
    return EXIT.ok;
  }
  const file = join(project.root, ".capsules", "config.yaml");
  // Change only the `mode:` line (or add one after `format:`), so nothing else moves.
  const text = existsSync(file) ? readFileSync(file, "utf8") : "format: 0.1\n";
  const next = /^mode:[ \t]*[^\s#]*/m.test(text)
    ? text.replace(/^mode:[ \t]*[^\s#]*/m, `mode: ${value}`)
    : /^format:.*$/m.test(text)
      ? text.replace(/^(format:.*)$/m, `$1\nmode: ${value}`)
      : `mode: ${value}\n${text}`;
  if ((parseDocument(next).toJS() as { mode?: string } | null)?.mode !== value)
    throw new UsageError(modeMsg.couldNotSet());
  if (!opts.dryRun) writeFileSync(file, next);
  if (opts.json) io.out(toJson("mode", { mode: value, was: now, dryRun: !!opts.dryRun }));
  else io.out(modeMsg.set(now, value, log.length, !!opts.dryRun));
  return EXIT.ok;
}
