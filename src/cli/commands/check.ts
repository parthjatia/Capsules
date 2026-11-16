import { skippedLine, splitReplaced, staleLinks } from "../../core/lock.js";
import { findProjectRoot, loadProject } from "../../core/project.js";
import { toJson } from "../../report/json.js";
import { countBySeverity, formatDiagnostics, plural } from "../../report/text.js";
import { EXIT } from "../exit-codes.js";
import type { Io } from "../io.js";

// Validation (C2.6) and the lockfile (C7). Compiled files, the one rule, weakened tests
// and running checks are added in M3 and M4, in the order C15 lists them.
export function check(io: Io, opts: { run: boolean; json?: boolean }): number {
  const project = loadProject(findProjectRoot(io.cwd));
  const { errors, warnings } = countBySeverity(project.diagnostics);
  const ok = errors === 0;
  const notRun = opts.run
    ? "Check commands were not run: running them arrives in M3, so this validated the capsules only."
    : "Check commands were not run (--no-run).";
  const skipped = project.lockOnDisk
    ? splitReplaced(staleLinks(project.lockOnDisk, project.current), project.capsules).skipped
    : [];

  if (opts.json) {
    io.out(
      toJson("check", {
        ok,
        errors,
        warnings,
        checksRun: false,
        diagnostics: project.diagnostics,
        skippedReplaced: skipped,
      }),
    );
    return ok ? EXIT.ok : EXIT.problems;
  }
  const body = formatDiagnostics(project.diagnostics);
  const skippedText = skippedLine(skipped);
  const summary = `capsules check: ${plural(errors, "error")}, ${plural(warnings, "warning")}. ${notRun}`;
  io.out(
    (body ? body + "\n\n" : "") + (skippedText ? `note: ${skippedText}.\n\n` : "") + summary + "\n",
  );
  return ok ? EXIT.ok : EXIT.problems;
}
