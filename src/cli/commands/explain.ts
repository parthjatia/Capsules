import { explainFile } from "../../core/explain.js";
import { findProjectRoot, loadProject, projectPath } from "../../core/project.js";
import { toJson } from "../../report/json.js";
import { countBySeverity, plural, rows } from "../../report/text.js";
import { EXIT } from "../exit-codes.js";
import type { Io } from "../io.js";

export function explain(io: Io, input: string, opts: { json?: boolean }): number {
  const root = findProjectRoot(io.cwd);
  const project = loadProject(root);
  const e = explainFile(project, projectPath(root, io.cwd, input));
  const { errors } = countBySeverity(project.diagnostics);

  if (opts.json) {
    io.out(toJson("explain", { ...e, projectErrors: errors }));
    return EXIT.ok;
  }

  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "(none)");
  let home: string;
  if (e.home) home = `${e.home.padEnd(26)}(covers: ${e.homePattern})`;
  else if (e.conflict.length) home = `(conflict: ${e.conflict.join(", ")}) E004, treated as root`;
  else home = "(none) orphan W101, treated as root for permissions";

  const out: [string, string][] = [["file", e.file]];
  if (e.ignoredBy) out.push(["ignored", `yes, matches "${e.ignoredBy}" in .capsules/config.yaml`]);
  out.push(
    ["home", home],
    ["parents", list(e.parents)],
    ["concerns", list(e.concerns)],
    ["rules", list(e.rules.map((x) => x.address))],
    ["checks", list(e.checks)],
    [
      "may edit",
      list(e.mayEdit.map((w) => (w.scope === "context" ? `${w.agent} (context only)` : w.agent))),
    ],
    ["blocked", list(e.blocked.map((w) => `${w.agent} (${w.reason})`))],
    [
      "decisions",
      list(
        e.decisions.map((d) =>
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
