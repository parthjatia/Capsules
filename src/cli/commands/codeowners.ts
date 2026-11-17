import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { ownersOf } from "../../core/identity.js";
import { gitToplevel } from "../../git/git.js";
import { findProjectRoot, loadProject } from "../../core/project.js";
import { toJson } from "../../report/json.js";
import { EXIT } from "../exit-codes.js";
import type { Io } from "../io.js";

// `capsules codeowners` (C15): suggested CODEOWNERS lines, so GitHub asks an owner to approve
// changes to capsules, settings and check files (C8, D-016). Prints only; writes nothing.
export function codeowners(io: Io, opts: { json?: boolean }): number {
  const project = loadProject(findProjectRoot(io.cwd));
  const handles = (humans: string[]) =>
    humans
      .map((h) => project.permissions.humans[h]?.github)
      .filter((g): g is string => Boolean(g))
      .map((g) => `@${g}`);
  const rootOwners = handles(ownersOf(project.capsules, "root"));
  // CODEOWNERS paths start at the repository root; the project may be a subfolder.
  const top = gitToplevel(project.root);
  const sub = top
    ? relative(realpathSync.native(top), realpathSync.native(project.root)).split("\\").join("/")
    : "";
  const prefix = sub ? `/${sub}/` : "/";
  const lines: { pattern: string; owners: string[]; why: string }[] = [];
  const add = (pattern: string, owners: string[], why: string) => {
    if (!lines.some((l) => l.pattern === pattern && l.owners.join() === owners.join()))
      lines.push({ pattern, owners, why });
  };

  add(`${prefix}.capsules/`, rootOwners, "capsules, settings, the lockfile and approvals.lock");
  for (const c of [...project.capsules].sort((a, b) => (a.file < b.file ? -1 : 1))) {
    const o = handles(ownersOf(project.capsules, c.id));
    if (o.join(" ") !== rootOwners.join(" ")) add(`${prefix}${c.file}`, o, `capsule ${c.id}`);
  }
  add(`${prefix}.github/workflows/`, rootOwners, "CI: an agent could switch the guard off (D-020)");
  add(`${prefix}.claude/settings.json`, rootOwners, "Claude Code settings hold the hooks (D-026)");
  for (const g of project.config.checks.files)
    add(
      g.startsWith("**/") && !sub ? g.slice(3) : `${prefix}${g}`,
      rootOwners,
      "existing checks are protected",
    );
  for (const c of project.capsules)
    for (const n of c.nodes)
      if (n.type === "check")
        for (const f of n.fields.filter((x) => x.key === "files"))
          add(
            `${prefix}${f.value}`,
            handles(ownersOf(project.capsules, c.id)),
            `check ${c.id}#${n.id}`,
          );

  const missing = Object.entries(project.permissions.humans)
    .filter(([, h]) => !h.github)
    .map(([k]) => k);
  if (opts.json) {
    io.out(toJson("codeowners", { lines, humansWithoutGithub: missing }));
    return EXIT.ok;
  }
  const out = [
    "# Suggested by `capsules codeowners`. Put these lines at the END of .github/CODEOWNERS",
    "# (later lines win), then require code owner reviews in branch protection for main.",
    "# On private repos with GitHub Free, GitHub can't require them (D-025).",
    ...lines.map(
      (l) =>
        `${l.pattern} ${l.owners.join(" ") || "# (no owner with a github handle)"}`.padEnd(60) +
        `  # ${l.why}`,
    ),
  ];
  if (missing.length)
    out.push(
      `# Note: ${missing.join(", ")} in permissions.yaml has no github handle, so can't be listed.`,
    );
  io.out(out.join("\n") + "\n");
  return EXIT.ok;
}
