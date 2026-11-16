import { membershipOf, isIgnored } from "../../core/membership.js";
import { whoMayEditCode } from "../../core/permissions.js";
import { findProjectRoot, loadProject, projectPath } from "../../core/project.js";
import { rulesForFile } from "../../core/rules.js";
import { toJson } from "../../report/json.js";
import { countBySeverity, plural, rows } from "../../report/text.js";
import { EXIT } from "../exit-codes.js";
import type { Io } from "../io.js";

export function explain(io: Io, input: string, opts: { json?: boolean }): number {
  const root = findProjectRoot(io.cwd);
  const project = loadProject(root);
  const file = projectPath(root, io.cwd, input);
  const ignoredBy = project.config.ignore.find((g) => isIgnored(file, [g])) ?? null;
  const m = project.membership.files.get(file) ?? membershipOf(file, project.capsules);
  const r = rulesForFile(m, project.capsules);
  const who = whoMayEditCode(m.home, m.concerns, project.permissions);
  const mayEdit = who.filter((w) => w.may);
  const blocked = who.filter((w) => !w.may && w.reason !== "read-only");
  const { errors } = countBySeverity(project.diagnostics);

  if (opts.json) {
    io.out(
      toJson("explain", {
        file,
        tracked: project.tracked.includes(file),
        ignoredBy,
        home: m.home,
        homePattern: m.homePattern,
        conflict: m.conflict,
        parents: r.parents,
        concerns: r.concerns,
        rules: r.rules,
        checks: r.checks,
        mayEdit: mayEdit.map((w) => ({ agent: w.agent, scope: w.may })),
        blocked: blocked.map((w) => ({ agent: w.agent, reason: w.reason })),
        decisions: r.decisions,
        projectErrors: errors,
      }),
    );
    return EXIT.ok;
  }

  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "(none)");
  let home: string;
  if (m.home) home = `${m.home.padEnd(26)}(covers: ${m.homePattern})`;
  else if (m.conflict.length) home = `(conflict: ${m.conflict.join(", ")}) E004, treated as root`;
  else home = "(none) orphan W101, treated as root for permissions";

  const out: [string, string][] = [["file", file]];
  if (ignoredBy) out.push(["ignored", `yes, matches "${ignoredBy}" in .capsules/config.yaml`]);
  out.push(
    ["home", home],
    ["parents", list(r.parents)],
    ["concerns", list(r.concerns)],
    ["rules", list(r.rules.map((x) => x.address))],
    ["checks", list(r.checks)],
    [
      "may edit",
      list(mayEdit.map((w) => (w.may === "context" ? `${w.agent} (context only)` : w.agent))),
    ],
    ["blocked", list(blocked.map((w) => `${w.agent} (${w.reason})`))],
    [
      "decisions",
      list(
        r.decisions.map((d) =>
          d.rejected.length ? `${d.address} (rejected: ${d.rejected.join("; ")})` : d.address,
        ),
      ),
    ],
  );
  let text = rows(out);
  if (errors)
    text += `\n\nnote: the capsules have ${plural(errors, "error")}, so this may be incomplete. Run: capsules check --no-run`;
  io.out(text + "\n");
  return EXIT.ok;
}
