import { affectedCapsules, runChecks, type CheckResult } from "../../checks/runner.js";
import { resolveBase } from "../../core/base.js";
import { changeUnits } from "../../core/changes.js";
import { compileDiagnostics } from "../../compile/compile.js";
import { guard } from "../../core/guard.js";
import { actorLabel } from "../../core/identity.js";
import { skippedLine, splitReplaced, staleLinks } from "../../core/lock.js";
import { findProjectRoot, loadProject, sortDiagnostics } from "../../core/project.js";
import { toJson } from "../../report/json.js";
import { countBySeverity, formatDiagnostics, plural, rows } from "../../report/text.js";
import { EXIT } from "../exit-codes.js";
import type { Io } from "../io.js";

export interface CheckOptions {
  run: boolean;
  base?: string;
  all?: boolean;
  ci?: boolean;
  json?: boolean;
}

// C15 order: validate, lock, compiled files, permissions and the one rule on the diff,
// append-only decisions, weakened-test signals, then run the checks of affected capsules.
export async function check(io: Io, opts: CheckOptions): Promise<number> {
  const project = loadProject(findProjectRoot(io.cwd));
  const base = resolveBase(project.root, opts.base);
  const units = changeUnits(project, base);
  const g = guard(project, base, units);

  let results: CheckResult[] = [];
  const runDiagnostics = [];
  if (opts.run) {
    const which = opts.all ? "all" : affectedCapsules(project, g.changedPaths);
    const r = await runChecks(project, which);
    results = r.results;
    runDiagnostics.push(...r.diagnostics);
  }

  const diagnostics = sortDiagnostics([
    ...project.diagnostics,
    ...compileDiagnostics(project),
    ...g.diagnostics,
    ...runDiagnostics,
  ]);
  const { errors, warnings } = countBySeverity(diagnostics);
  const ok = errors === 0;
  const reportOnly = Boolean(opts.ci) && project.config.ci.mode === "report";
  const exit = ok || reportOnly ? EXIT.ok : EXIT.problems;
  const skipped = project.lockOnDisk
    ? splitReplaced(staleLinks(project.lockOnDisk, project.current), project.capsules).skipped
    : [];
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.length - passed;

  if (opts.json) {
    io.out(
      toJson("check", {
        ok,
        errors,
        warnings,
        base: { ref: base.ref, sha: base.sha, how: base.how },
        units: units.map((u) => ({
          kind: u.kind,
          label: u.label,
          actor: u.actor ? actorLabel(u.actor) : null,
          files: u.files.map((f) => `${f.status} ${f.path}`),
        })),
        checksRun: opts.run,
        checks: results,
        unreviewedChecks: g.unreviewed,
        diagnostics,
        skippedReplaced: skipped,
        ...(opts.ci ? { ciMode: project.config.ci.mode } : {}),
      }),
    );
    return exit;
  }

  const commits = new Set(units.flatMap((u) => u.commits.map((c) => c.sha))).size;
  const uncommitted = units.some((u) => u.kind === "uncommitted");
  const changes = [
    ...(commits ? [plural(commits, "commit")] : []),
    ...(uncommitted ? ["uncommitted changes"] : []),
  ];
  const parts: string[] = [
    rows([
      [
        "base",
        base.ref
          ? `${base.ref} (${base.how})${base.sha ? `, merge base ${base.sha.slice(0, 7)}` : ""}`
          : base.how,
      ],
      ["changes", changes.length ? changes.join(" and ") : "none since the base"],
      [
        "checks",
        !opts.run
          ? "not run (--no-run)"
          : results.length
            ? `${plural(results.length, "check")} run: ${passed} passed, ${failed} failed`
            : "none to run: no capsule's files changed (use --all to run every check)",
      ],
    ]),
  ];
  if (results.length) {
    const width = Math.max(...results.map((r) => r.address.length));
    parts.push(
      results
        .map((r) => `  ${r.status.padEnd(7)} ${r.address.padEnd(width)}   ${r.run}`)
        .join("\n"),
    );
  }
  const body = formatDiagnostics(diagnostics);
  if (body) parts.push(body);
  if (g.unreviewed.length) {
    parts.push(
      `unreviewed new checks: added together with the code they judge. An owner, or a separate session, should confirm them.\n${g.unreviewed.map((u) => `  ${u}`).join("\n")}`,
    );
  }
  const skippedText = skippedLine(skipped);
  if (skippedText) parts.push(`note: ${skippedText}.`);
  const runText = !opts.run
    ? "Check commands were not run (--no-run)."
    : results.length
      ? `Ran ${plural(results.length, "check")}: ${passed} passed, ${failed} failed.`
      : "No checks needed running.";
  parts.push(
    `capsules check: ${plural(errors, "error")}, ${plural(warnings, "warning")}. ${runText}`,
  );
  if (opts.ci && reportOnly && !ok)
    parts.push(
      "ci.mode is `report`, so these errors don't fail the build yet. Set `ci: { mode: block }` in .capsules/config.yaml to make them block.",
    );
  io.out(parts.join("\n\n") + "\n");
  return exit;
}
