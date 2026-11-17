// The pull request summary (C17): what a change did to the capsules, computed only from the
// diff and the check results. No AI. `capsules check --ci --summary <file>` writes it; the
// GitHub Action posts it as one sticky comment.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckResult } from "../checks/runner.js";
import type { Base } from "../core/base.js";
import { Contents, diffCapsule, type NodeChange } from "../core/changes.js";
import { capsuleFromPath } from "../core/judges.js";
import { splitReplaced, staleLinks, stalePrompts } from "../core/lock.js";
import { membershipOf } from "../core/membership.js";
import { address, type CapsuleNode } from "../core/model.js";
import { parseCapsuleFile } from "../core/parse.js";
import type { Project } from "../core/project.js";
import { targetOf } from "../core/resolve.js";
import type { Diagnostic } from "./messages.js";
import { plural } from "./text.js";

/** The first line of the comment: the Action finds its own comment by it. */
export const SUMMARY_MARKER = "<!-- capsules-summary -->";

const POLICY = new Set(["E009", "E027", "E028", "E029", "E030"]);
const firstLine = (s: string) =>
  s
    .split("\n")
    .find((l) => l.trim())
    ?.trim() ?? "";
const quoteText = (n: CapsuleNode) => {
  const t = firstLine(n.prose);
  return t.length > 80 ? `"${t.slice(0, 77)}..."` : `"${t}"`;
};

export interface SummaryInput {
  base: Base;
  changedPaths: string[];
  diagnostics: Diagnostic[];
  checksRun: boolean;
  results: CheckResult[];
}

/** Node changes in every capsule file changed since the base (or in the working tree). */
function nodeChanges(project: Project, base: Base, changed: string[]): NodeChange[] {
  const contents = new Contents(project.root);
  const out: NodeChange[] = [];
  for (const p of changed) {
    const own = capsuleFromPath(p);
    if (!own) continue;
    const parse = (text: string | null) =>
      text === null ? null : parseCapsuleFile(text, p, own.id, own.kind).capsule;
    const abs = join(project.root, ...p.split("/"));
    const before = parse(contents.get(base.sha, p));
    const after = parse(existsSync(abs) ? readFileSync(abs, "utf8") : null);
    if (!before && !after) continue;
    out.push(...diffCapsule(before, after).nodes);
  }
  return out;
}

export function prSummary(project: Project, input: SummaryInput): string {
  const changed = input.changedPaths.filter((p) => !p.startsWith(".capsules/_cache/"));
  const ids = new Set(project.capsules.map((c) => c.id));

  // The capsules this change touches: capsule files edited, and homes and concerns of files.
  const touched = new Set<string>();
  for (const p of changed) {
    const own = capsuleFromPath(p);
    if (own) {
      if (ids.has(own.id)) touched.add(own.id);
      continue;
    }
    if (p.startsWith(".capsules/")) continue;
    const m = membershipOf(p, project.capsules);
    if (m.home) touched.add(m.home);
    for (const k of m.concerns) touched.add(k);
  }

  const nodes = nodeChanges(project, input.base, changed);
  const sign = { added: "+", changed: "~", removed: "-" } as const;
  const line = (c: NodeChange, extra = "") =>
    `${sign[c.change]} ${address(c.capsule, c.node.id)}${c.change === "removed" ? "" : ` ${quoteText(c.node)}`}${extra}`;
  const of = (...types: string[]) => nodes.filter((c) => types.includes(c.node.type));

  const approval = " (needs owner approval)";
  const intents = of("intent").map((c) => line(c, approval));
  const contracts = of("contract", "example").map((c) => line(c, approval));
  const decisions = of("decision").map((c) => {
    const sup = c.node.links
      .filter((l) => l.type === "supersedes")
      .map((l) => targetOf(l.ref, c.capsule).split("#")[1]);
    const bad = c.change !== "added" ? " (decisions are append-only: E009)" : "";
    return `${sign[c.change]} ${address(c.capsule, c.node.id)}${sup.length ? ` (supersedes ${sup.join(", ")})` : ""}${bad}`;
  });

  const errors = input.diagnostics.filter((d) => d.severity === "error");
  const warnings = input.diagnostics.filter((d) => d.severity === "warning");
  const policy = errors.filter((d) => POLICY.has(d.code));
  const pass = input.results.filter((r) => r.status === "pass").length;
  const fail = input.results.length - pass;
  const stale = project.lockOnDisk
    ? splitReplaced(staleLinks(project.lockOnDisk, project.current), project.capsules).report
        .length + stalePrompts(project.lockOnDisk, project.current).length
    : 0;

  const checks = !input.checksRun
    ? "not run"
    : input.results.length
      ? `${pass} pass, ${fail} fail`
      : "none affected";
  const policyText = policy.length
    ? `${plural(policy.length, "problem")} (${[...new Set(policy.map((d) => d.code))].join(", ")})`
    : "OK";
  const staleText = stale ? `${stale} (run \`capsules status\`)` : "0";

  const block = (label: string, items: string[], none: string) => {
    const pad = `${label}:`.padEnd(12);
    if (!items.length) return [`${pad}${none}`];
    return items.map((x, i) => (i === 0 ? `${pad}${x}` : `${" ".repeat(12)}${x}`));
  };
  // A pull request comment is visible to everyone who can see the PR: never print emails.
  const noEmail = (t: string) =>
    t.replace(/[^\s()<>,;:@]+@[^\s()<>,;:@]+\.[A-Za-z]{2,}/g, "(email hidden)");
  const summarise = (ds: Diagnostic[], max = 8) => [
    ...ds
      .slice(0, max)
      .map(
        (d) =>
          `${d.code} ${firstLine(d.message)}${d.file ? ` (${d.file}${d.line ? `:${d.line}` : ""})` : ""}`,
      ),
    ...(ds.length > max ? [`and ${ds.length - max} more (run \`capsules check\`)`] : []),
  ];

  const lines = [
    `Capsules:   ${touched.size ? [...touched].sort().join(", ") : "none touched"}`,
    ...block("Intent", intents, "no change"),
    ...block("Contracts", contracts, "no change"),
    ...block("Decisions", decisions, "none added"),
    `Checks:     ${checks} | Policy: ${policyText} | Stale: ${staleText}`,
    ...(errors.length ? block("Errors", summarise(errors), "") : []),
    ...(warnings.length ? block("Warnings", summarise(warnings), "") : []),
  ];
  const ok = errors.length === 0 && fail === 0;
  return [
    SUMMARY_MARKER,
    `**Capsules** ${ok ? "found no problems" : "found problems"} in this pull request${
      input.base.sha ? ` (compared with \`${input.base.sha.slice(0, 7)}\`)` : ""
    }.`,
    "",
    "```text",
    ...lines.map(noEmail),
    "```",
    "",
    "<sub>Computed from the diff and the check results by `capsules check --ci`; no AI involved. Updated on every push.</sub>",
    "",
  ].join("\n");
}
