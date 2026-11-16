import { resolveBase } from "../../core/base.js";
import { contextRings, renderRings, resolveTarget } from "../../core/context.js";
import { isIgnored, membershipOf } from "../../core/membership.js";
import { findProjectRoot, loadProject, UsageError, type Project } from "../../core/project.js";
import { rulesForFile } from "../../core/rules.js";
import { changesSince, revParse, tryGit } from "../../git/history.js";
import { toJson } from "../../report/json.js";
import { errors } from "../../report/messages.js";
import { EXIT } from "../exit-codes.js";
import type { Io } from "../io.js";

export interface ContextOptions {
  budget?: string;
  for?: string;
  base?: string;
  json?: boolean;
}

/** What the judge gets (C13, C16): the diff and the contracts that apply to changed files. */
function judgeInput(project: Project, baseRef: string | undefined) {
  const base = resolveBase(project.root, baseRef);
  const from = base.sha ?? (revParse("HEAD", project.root) ? "HEAD" : null);
  const changed = from
    ? changesSince(from, project.root)
        .map((c) => c.path)
        .filter((p) => !p.startsWith(".capsules/_cache/") && !isIgnored(p, project.config.ignore))
    : [];
  const contracts = new Map<string, { address: string; text: string; files: string[] }>();
  for (const f of changed.filter((p) => !p.startsWith(".capsules/"))) {
    for (const r of rulesForFile(membershipOf(f, project.capsules), project.capsules).rules) {
      const c = contracts.get(r.address) ?? { address: r.address, text: r.text, files: [] };
      c.files.push(f);
      contracts.set(r.address, c);
    }
  }
  const diff = from
    ? (tryGit(["diff", from, "--", ".", ":(exclude).capsules/_cache"], project.root) ?? "")
    : "";
  return {
    commit: revParse("HEAD", project.root),
    base: base.sha,
    baseHow: base.how,
    changed,
    contracts: [...contracts.values()].sort((a, b) => (a.address < b.address ? -1 : 1)),
    diff,
  };
}

export function context(io: Io, target: string | undefined, opts: ContextOptions): number {
  const project = loadProject(findProjectRoot(io.cwd));
  const forWhom = opts.for ?? "builder";
  if (forWhom !== "builder" && forWhom !== "judge")
    throw new UsageError(errors.contextFor(forWhom));
  const tokens = opts.budget === undefined ? 0 : Number(opts.budget);
  if (!Number.isInteger(tokens) || tokens < 0)
    throw new UsageError(errors.contextBudget(opts.budget ?? ""));
  if (!target && forWhom !== "judge") throw new UsageError(errors.contextNeedsTarget());

  const t = target ? resolveTarget(project, target) : null;
  if (target && !t)
    throw new UsageError(
      errors.contextUnknown(
        target,
        project.capsules.map((c) => c.id),
      ),
    );
  const judge = forWhom === "judge" ? judgeInput(project, opts.base) : null;
  const rings = t ? contextRings(project, t.capsule, t.concerns) : [];

  if (opts.json) {
    io.out(
      toJson("context", {
        for: forWhom,
        ...(t ? { capsule: t.capsule.id, file: t.file, rings } : {}),
        ...(judge ?? {}),
      }),
    );
    return EXIT.ok;
  }
  const header = t
    ? [
        `# Context for ${t.file ? `${t.file} (home: ${t.capsule.id}${t.concerns.length ? `; concerns: ${t.concerns.join(", ")}` : ""})` : `capsule ${t.capsule.id}`}`,
        "",
        "Keep every rule below. Don't re-suggest a rejected option. Never weaken an existing test.",
        "",
      ]
    : [];
  const parts: string[] = [];
  if (t) parts.push(renderRings(header, rings, tokens * 4));
  if (judge) {
    parts.push(
      [
        "# For the judge",
        "",
        `commit: ${judge.commit ?? "(none)"}`,
        `base:   ${judge.base ?? "(none)"} (${judge.baseHow})`,
        "",
        "## Contracts to judge",
        "",
        ...(judge.contracts.length
          ? judge.contracts.map((c) => `- ${c.address}: ${c.text}  (files: ${c.files.join(", ")})`)
          : ["(none: no changed file has a rule)"]),
        "",
        "## Diff",
        "",
        "```diff",
        judge.diff.trimEnd(),
        "```",
        "",
      ].join("\n"),
    );
  }
  io.out(parts.join("\n").trimEnd() + "\n");
  return EXIT.ok;
}
