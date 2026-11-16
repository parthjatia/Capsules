import { findProjectRoot, loadProject } from "../../core/project.js";
import { toJson } from "../../report/json.js";
import { countBySeverity, plural, rows } from "../../report/text.js";
import { EXIT } from "../exit-codes.js";
import type { Io } from "../io.js";

// M1 scope: capsule and file counts, orphans, assumptions past review, problem totals.
// Stale links and check results join in M2 and M3.
export function status(io: Io, opts: { json?: boolean }): number {
  const project = loadProject(findProjectRoot(io.cwd));
  const files = [...project.membership.files.values()];
  const orphans = files.filter((f) => !f.home && !f.conflict.length).map((f) => f.file);
  const conflicts = files.filter((f) => f.conflict.length).map((f) => f.file);
  const overdue = project.diagnostics.filter((d) => d.code === "W105");
  const areas = project.capsules.filter((c) => c.kind === "area").length;
  const concerns = project.capsules.length - areas;
  const { errors, warnings } = countBySeverity(project.diagnostics);

  if (opts.json) {
    io.out(
      toJson("status", {
        capsules: { areas, concerns },
        files: {
          tracked: project.tracked.length,
          withHome: files.length - orphans.length - conflicts.length,
          ignored: project.membership.ignored.length,
          orphans: orphans.length,
          conflicts: conflicts.length,
        },
        orphans,
        conflicts,
        assumptionsPastReview: overdue.map((d) => ({
          file: d.file,
          line: d.line,
          message: d.message,
        })),
        problems: { errors, warnings },
      }),
    );
    return EXIT.ok;
  }

  const parts: string[] = [
    rows([
      ["capsules", `${plural(areas, "area")}, ${plural(concerns, "concern")}`],
      [
        "files",
        `${project.tracked.length} tracked: ${files.length - orphans.length - conflicts.length} with a home, ${project.membership.ignored.length} ignored, ${plural(orphans.length, "orphan")}${conflicts.length ? `, ${conflicts.length} with two homes (E004)` : ""}`,
      ],
      [
        "problems",
        `${plural(errors, "error")}, ${plural(warnings, "warning")}${errors + warnings ? " (details: capsules check --no-run)" : ""}`,
      ],
    ]),
  ];
  if (orphans.length) {
    parts.push(
      `orphans (W101): files no capsule covers. Add them to a capsule's covers, or to ignore in .capsules/config.yaml.\n${orphans.map((f) => `  ${f}`).join("\n")}`,
    );
  }
  if (conflicts.length)
    parts.push(`files with two homes (E004):\n${conflicts.map((f) => `  ${f}`).join("\n")}`);
  if (overdue.length) {
    parts.push(
      `assumptions past review (W105):\n${overdue.map((d) => `  ${d.message} (${d.file}:${d.line})`).join("\n")}`,
    );
  }
  io.out(parts.join("\n\n") + "\n");
  return EXIT.ok;
}
