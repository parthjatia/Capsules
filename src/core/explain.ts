// What `capsules explain` says about one file (C3). Shared with the map's file search (C14),
// so both always give the same answer.
import { isIgnored, membershipOf } from "./membership.js";
import { whoMayEditCode } from "./permissions.js";
import type { Project } from "./project.js";
import { rulesForFile, type AppliedRule, type DecisionSummary } from "./rules.js";

export interface FileExplanation {
  file: string;
  tracked: boolean;
  ignoredBy: string | null;
  home: string | null;
  homePattern: string | null;
  conflict: string[];
  parents: string[];
  concerns: string[];
  rules: AppliedRule[];
  checks: string[];
  mayEdit: { agent: string; scope: "code" | "context" }[];
  blocked: { agent: string; reason: string }[];
  decisions: DecisionSummary[];
}

export function explainFile(project: Project, file: string): FileExplanation {
  const ignoredBy = project.config.ignore.find((g) => isIgnored(file, [g])) ?? null;
  const m = project.membership.files.get(file) ?? membershipOf(file, project.capsules);
  const r = rulesForFile(m, project.capsules);
  const who = whoMayEditCode(m.home, m.concerns, project.permissions);
  return {
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
    mayEdit: who.flatMap((w) => (w.may ? [{ agent: w.agent, scope: w.may }] : [])),
    blocked: who.flatMap((w) =>
      !w.may && w.reason && w.reason !== "read-only" ? [{ agent: w.agent, reason: w.reason }] : [],
    ),
    decisions: r.decisions,
  };
}
