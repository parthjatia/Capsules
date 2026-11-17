// `capsules hook stop` (C11): report only. Validation errors, an out-of-date lock or agent
// files, stale links and orphans, with the next command to run. Never blocks (exit 0).
export async function stopReport(root: string): Promise<string | null> {
  const { loadProject } = await import("../core/project.js");
  const { lockChanges, splitReplaced, staleLinks, stalePrompts } = await import("../core/lock.js");
  const { compileDiagnostics } = await import("../compile/compile.js");
  const p = loadProject(root);
  const diags = [...p.diagnostics, ...compileDiagnostics(p)];
  // E010 is reported in words below, with its own next step.
  const errors = diags.filter((d) => d.severity === "error" && d.code !== "E010");
  const disk = p.lockOnDisk;
  const lockOld = disk ? lockChanges(disk, p.current).length > 0 : true;
  const stale = disk ? splitReplaced(staleLinks(disk, p.current), p.capsules).report.length : 0;
  const prompts = disk ? stalePrompts(disk, p.current).length : 0;
  // Only new or changed files: an orphan the user already knows about isn't news every turn.
  const { changesSince, revParse } = await import("../git/history.js");
  const { isIgnored, membershipOf } = await import("../core/membership.js");
  const changed = revParse("HEAD", root)
    ? changesSince("HEAD", root)
        .filter((c) => c.status !== "D")
        .map((c) => c.path)
    : p.tracked;
  const orphans = changed.filter(
    (f) =>
      !f.startsWith(".capsules/") &&
      !isIgnored(f, p.config.ignore) &&
      membershipOf(f, p.capsules).home === null &&
      membershipOf(f, p.capsules).conflict.length === 0,
  ).length;

  // C18.2: what CI's fast checks would fail on, against the base (one rule, permissions,
  // decisions, weakened tests). Never the check commands themselves.
  const { resolveBase } = await import("../core/base.js");
  const { changeUnits } = await import("../core/changes.js");
  const { guard } = await import("../core/guard.js");
  const { loadProposals } = await import("../core/proposals.js");
  const base = resolveBase(root);
  const g = guard(p, base, changeUnits(p, base));
  const ciErrors = g.diagnostics.filter((d) => d.severity === "error");
  const weakened = g.diagnostics.filter((d) => d.code === "W107").length;
  const proposals = loadProposals(root).proposals.length;
  const codeChanged = changed.some(
    (f) => !f.startsWith(".capsules/") && !isIgnored(f, p.config.ignore),
  );

  const parts: string[] = [];
  const next: string[] = [];
  if (ciErrors.length) {
    const codes = [...new Set(ciErrors.map((d) => d.code))].sort().join(", ");
    parts.push(
      `CI would fail on ${ciErrors.length} problem${ciErrors.length === 1 ? "" : "s"} (${codes})`,
    );
    next.push("`capsules check --no-run` to see them");
  }
  if (weakened) parts.push(`${weakened} weakened-test signal${weakened === 1 ? "" : "s"} (W107)`);
  if (proposals) {
    parts.push(`${proposals} proposal${proposals === 1 ? "" : "s"} waiting for you`);
    next.push("`capsules review`");
  }
  if (errors.length) {
    const codes = [...new Set(errors.map((d) => d.code))].sort().join(", ");
    parts.push(`${errors.length} error${errors.length === 1 ? "" : "s"} (${codes})`);
    next.push("`capsules check --no-run`");
  }
  if (lockOld) {
    parts.push("the lockfile is out of date");
    next.push("`capsules lock`");
  }
  if (diags.some((d) => d.code === "E011")) next.push("`capsules compile`");
  if (stale) parts.push(`${stale} stale link${stale === 1 ? "" : "s"}`);
  if (prompts) parts.push(`${prompts} stale prompt${prompts === 1 ? "" : "s"}`);
  if (orphans)
    parts.push(`${orphans} new or changed file${orphans === 1 ? "" : "s"} with no capsule`);
  if ((stale || prompts || orphans) && !next.length) next.push("`capsules status`");
  const tests = codeChanged ? " Run `capsules check` to run your tests." : "";
  if (!parts.length)
    return codeChanged
      ? "capsules: no problems in the fast checks (one rule, permissions, decisions, staleness)." +
          tests
      : null;
  return `capsules: ${parts.join(", ")}. Next: run ${[...new Set(next)].join(", then ")}.${tests}`;
}
