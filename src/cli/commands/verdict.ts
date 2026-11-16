import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { findProjectRoot, loadProject, UsageError } from "../../core/project.js";
import { revParse, tryGit } from "../../git/history.js";
import { git } from "../../git/git.js";
import { toJson } from "../../report/json.js";
import { errors } from "../../report/messages.js";
import { EXIT } from "../exit-codes.js";
import type { Io } from "../io.js";

// Verdicts (C13): the judge's opinion per contract, stored as Git notes. Advice only.
export const NOTES_REF = "capsules";

export const VerdictSchema = z.strictObject({
  format: z.literal("0.1"),
  commit: z.string().min(4),
  base: z.string().nullable(),
  judge: z.strictObject({ agent: z.string(), subagent: z.string() }),
  results: z.array(
    z.strictObject({
      contract: z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*#[A-Za-z0-9-]+$/),
      verdict: z.enum(["kept", "broken", "unsure"]),
      reason: z.string(),
      evidence: z.array(z.string()),
    }),
  ),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export function verdictRecord(io: Io, opts: { file: string; json?: boolean }): number {
  const project = loadProject(findProjectRoot(io.cwd));
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolve(io.cwd, opts.file), "utf8"));
  } catch (e) {
    throw new UsageError(
      errors.verdictUnreadable(opts.file, e instanceof Error ? e.message : String(e)),
    );
  }
  const parsed = VerdictSchema.safeParse(raw);
  if (!parsed.success)
    throw new UsageError(
      errors.verdictInvalid(
        opts.file,
        parsed.error.issues.map((i) => `${i.path.join(".") || "(top)"}: ${i.message}`),
      ),
    );
  const v = parsed.data;
  const sha = revParse(v.commit, project.root);
  if (!sha) throw new UsageError(errors.verdictNoCommit(v.commit));
  const known = new Set(project.capsules.flatMap((c) => c.nodes.map((n) => `${c.id}#${n.id}`)));
  const unknown = v.results.map((r) => r.contract).filter((a) => !known.has(a));
  if (unknown.length) throw new UsageError(errors.verdictUnknownContracts(unknown));
  // One compact JSON line per verdict, appended, so several judges can add theirs.
  git(
    ["notes", `--ref=${NOTES_REF}`, "append", "-m", JSON.stringify({ ...v, commit: sha }), sha],
    project.root,
  );
  const count = (k: string) => v.results.filter((r) => r.verdict === k).length;
  if (opts.json)
    io.out(toJson("verdict", { recorded: true, commit: sha, results: v.results.length }));
  else
    io.out(
      `Recorded ${v.results.length} verdicts on ${sha.slice(0, 7)} (refs/notes/${NOTES_REF}): ${count("kept")} kept, ${count("broken")} broken, ${count("unsure")} unsure.\n` +
        "Verdicts are advice; they never block. Share them with: git push origin refs/notes/capsules\n",
    );
  return EXIT.ok;
}

export function verdictShow(io: Io, commit: string | undefined, opts: { json?: boolean }): number {
  const root = findProjectRoot(io.cwd);
  const sha = revParse(commit ?? "HEAD", root);
  if (!sha) throw new UsageError(errors.verdictNoCommit(commit ?? "HEAD"));
  const text = tryGit(["notes", `--ref=${NOTES_REF}`, "show", sha], root) ?? "";
  const verdicts: Verdict[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const p = VerdictSchema.safeParse(JSON.parse(line));
      if (p.success) verdicts.push(p.data);
    } catch {
      // not ours
    }
  }
  if (opts.json) {
    io.out(toJson("verdicts", { commit: sha, verdicts }));
    return EXIT.ok;
  }
  if (!verdicts.length) {
    io.out(`No verdicts on ${sha.slice(0, 7)}. Run /capsules-judge in Claude Code to get some.\n`);
    return EXIT.ok;
  }
  const lines: string[] = [];
  for (const v of verdicts) {
    lines.push(
      `Verdicts on ${sha.slice(0, 7)} by ${v.judge.agent}/${v.judge.subagent}${v.base ? ` (base ${v.base.slice(0, 7)})` : ""}:`,
    );
    for (const r of v.results) {
      lines.push(`  ${r.verdict.padEnd(6)} ${r.contract}: ${r.reason}`);
      for (const e of r.evidence) lines.push(`         ${e}`);
    }
  }
  lines.push(
    "",
    "Verdicts are advice from an agent; tests and `capsules check` decide what blocks.",
  );
  io.out(lines.join("\n") + "\n");
  return EXIT.ok;
}
