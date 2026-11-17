// Proposals (C18.3, D-032): notes an agent leaves for an owner instead of changing an intent,
// rule, example or check, or instead of stopping. One Markdown file each in
// .capsules/_proposals/, committed. They never change a rule by themselves.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Diagnostic } from "../report/messages.js";
import { proposalMsg } from "../report/messages.js";
import { PROPOSALS_DIR, proposalCapsule } from "./proposal-path.js";

export { isProposalPath, PROPOSALS_DIR, proposalCapsule } from "./proposal-path.js";

export type ProposalKind = "change" | "new" | "note";

export interface Proposal {
  /** File name without `.md`, e.g. `billing.invoices--C1--1`. */
  id: string;
  file: string;
  target: string;
  /** The capsule it is about (from the target). */
  capsule: string;
  kind: ProposalKind;
  by: string;
  session: string | null;
  why: string;
  text: string | null;
}

export const slug = (s: string) =>
  s
    .replace(/[^A-Za-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "x";

/** The text of a proposal file. No timestamps (F2). */
export function renderProposal(p: Omit<Proposal, "id" | "file">): string {
  const fm = [
    "---",
    `target: ${JSON.stringify(p.target)}`,
    `kind: ${p.kind}`,
    `by: ${JSON.stringify(p.by)}`,
    ...(p.session ? [`session: ${JSON.stringify(p.session)}`] : []),
    "---",
    "",
    `# Proposal for ${p.target}`,
    "",
    "## why",
    "",
    p.why.trim(),
    "",
  ];
  if (p.text !== null) fm.push("## suggested text", "", p.text.trim(), "");
  return fm.join("\n");
}

function section(body: string, name: string): string | null {
  const m = new RegExp(`^## ${name}[ \\t]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(body);
  return m ? m[1]!.trim() : null;
}

export function parseProposal(file: string, text: string): Proposal | Diagnostic {
  const bad = (why: string): Diagnostic => ({
    code: "E034",
    severity: "error",
    file,
    line: 1,
    message: proposalMsg.unreadable(file, why),
    why: proposalMsg.unreadableWhy,
    fix: proposalMsg.unreadableFix,
  });
  const t = text.replace(/\r\n?/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(t);
  if (!m) return bad("it has no front matter");
  let fm: unknown;
  try {
    fm = parseYaml(m[1]!);
  } catch {
    return bad("its front matter is not valid YAML");
  }
  const o = (fm ?? {}) as Record<string, unknown>;
  if (typeof o.target !== "string" || !o.target) return bad("`target` is missing");
  if (o.kind !== "change" && o.kind !== "new" && o.kind !== "note")
    return bad("`kind` must be change, new or note");
  const why = section(m[2]!, "why");
  if (!why) return bad("it has no `## why` section");
  const name = file.slice(PROPOSALS_DIR.length + 1).replace(/\.md$/, "");
  return {
    id: name,
    file,
    target: o.target,
    capsule: proposalCapsule(file),
    kind: o.kind,
    by: typeof o.by === "string" ? o.by : "unknown",
    session: typeof o.session === "string" ? o.session : null,
    why,
    text: section(m[2]!, "suggested text"),
  };
}

/** Every proposal in the project, sorted by file name; unreadable ones as E034. */
export function loadProposals(root: string): { proposals: Proposal[]; diagnostics: Diagnostic[] } {
  const dir = join(root, ...PROPOSALS_DIR.split("/"));
  const proposals: Proposal[] = [];
  const diagnostics: Diagnostic[] = [];
  if (!existsSync(dir)) return { proposals, diagnostics };
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith(".md"))
    .sort()) {
    const file = `${PROPOSALS_DIR}/${name}`;
    const r = parseProposal(file, readFileSync(join(dir, name), "utf8"));
    if ("code" in r) diagnostics.push(r);
    else proposals.push(r);
  }
  return { proposals, diagnostics };
}

/** W112 for each open proposal, plus E034 for unreadable ones (C18.3). */
export function proposalDiagnostics(root: string): Diagnostic[] {
  const { proposals, diagnostics } = loadProposals(root);
  return [
    ...diagnostics,
    ...proposals.map((p): Diagnostic => ({
      code: "W112",
      severity: "warning",
      file: p.file,
      line: 1,
      message: proposalMsg.waiting(p.target, p.kind, p.by),
      why: proposalMsg.waitingWhy,
      fix: proposalMsg.waitingFix(p.id),
    })),
  ];
}
