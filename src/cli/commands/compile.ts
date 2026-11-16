import { applyCompile, compilePlan } from "../../compile/compile.js";
import { findProjectRoot, loadProject } from "../../core/project.js";
import { toJson } from "../../report/json.js";
import { compileMsg } from "../../report/messages.js";
import { formatDiagnostics, plural } from "../../report/text.js";
import { EXIT } from "../exit-codes.js";
import type { Io } from "../io.js";

// `capsules compile [--check] [--dry-run]` (C10).
export function compile(
  io: Io,
  opts: { check?: boolean; dryRun?: boolean; json?: boolean },
): number {
  const project = loadProject(findProjectRoot(io.cwd));
  const blocking = project.diagnostics.filter((d) => d.severity === "error" && d.code !== "E010");
  if (blocking.length && !opts.check) {
    io.err(
      `${formatDiagnostics(blocking)}\n\ncapsules compile: nothing written. Fix the ${plural(blocking.length, "error")} above first.\n`,
    );
    return EXIT.problems;
  }
  const plan = compilePlan(project);
  const write = !opts.check && !opts.dryRun && plan.changes.length > 0;
  if (write) applyCompile(project, plan);

  if (opts.json) {
    io.out(
      toJson("compile", {
        check: Boolean(opts.check),
        dryRun: Boolean(opts.dryRun),
        written: write,
        files: [...plan.files.keys()].sort(),
        changes: plan.changes,
      }),
    );
    return opts.check && plan.changes.length ? EXIT.problems : EXIT.ok;
  }
  if (opts.check) {
    if (!plan.changes.length) {
      io.out(`All ${plural(plan.files.size, "generated agent file")} are up to date.\n`);
      return EXIT.ok;
    }
    const ds = plan.changes.map((c) =>
      compileMsg.E011(
        c.path,
        c.change === "create" ? "missing" : c.change === "delete" ? "extra" : "differs",
      ),
    );
    io.out(formatDiagnostics(ds) + "\n");
    return EXIT.problems;
  }
  if (!plan.changes.length) {
    io.out(
      `All ${plural(plan.files.size, "generated agent file")} are already up to date. Nothing written.\n`,
    );
    return EXIT.ok;
  }
  io.out(
    [
      `${opts.dryRun ? "Would change" : "Changed"} ${plural(plan.changes.length, "generated agent file")}:`,
      ...plan.changes.map((c) => `  ${c.change.padEnd(7)} ${c.path}`),
      "",
      "These files are generated from .capsules/. Commit them; never edit them by hand.",
    ].join("\n") + "\n",
  );
  return EXIT.ok;
}
