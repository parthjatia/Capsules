import { createInterface } from "node:readline/promises";
import { findProjectRoot, loadProject } from "../../core/project.js";
import { doctor as runDoctor } from "../../install/doctor.js";
import { planInit, type Step } from "../../install/init.js";
import { planRemove } from "../../install/remove.js";
import { toJson } from "../../report/json.js";
import { errors } from "../../report/messages.js";
import { plural } from "../../report/text.js";
import { EXIT } from "../exit-codes.js";
import type { Io } from "../io.js";

export interface WriteFlags {
  yes?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

/** Ask the person to confirm a plan; false when we can't ask (not a terminal). */
export type Confirm = (question: string) => Promise<boolean | null>;

export const terminalConfirm: Confirm = async (question) => {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
};

function planText(title: string, steps: Step[]): string {
  const width = Math.max(...steps.map((s) => s.path.length), 10);
  return [
    title,
    "",
    ...steps.map((s) => `  ${s.change.padEnd(7)} ${s.path.padEnd(width)}  ${s.why}`),
    "",
  ].join("\n");
}

async function go(
  io: Io,
  flags: WriteFlags,
  confirm: Confirm,
  question: string,
): Promise<"apply" | "stop" | number> {
  if (flags.dryRun) {
    io.out("Dry run: nothing was changed.\n");
    return "stop";
  }
  if (flags.yes) return "apply";
  const answer = await confirm(question);
  if (answer === null) {
    io.err(`error  ${errors.initNeedsConfirm()}\n`);
    return EXIT.usage;
  }
  if (!answer) {
    io.out("Nothing was changed.\n");
    return "stop";
  }
  return "apply";
}

export async function init(
  io: Io,
  opts: WriteFlags & { agents?: string; gitHooks?: boolean; workflow?: boolean },
  confirm: Confirm = terminalConfirm,
): Promise<number> {
  const plan = planInit(io.cwd, opts);
  const changing = plan.steps.filter((s) => s.change !== "keep" && s.change !== "skip");
  if (opts.json && (opts.dryRun || !opts.yes)) {
    io.out(toJson("init", { root: plan.root, applied: false, steps: plan.steps }));
    return opts.dryRun ? EXIT.ok : EXIT.usage;
  }
  if (!opts.json)
    io.out(
      planText(
        `capsules init will change ${plural(changing.length, "item")} in ${plan.root}. It never touches app code, package.json or build settings.`,
        plan.steps,
      ),
    );
  const decision = await go(io, opts, confirm, "Go ahead? [y/N] ");
  if (decision !== "apply") return decision === "stop" ? EXIT.ok : decision;
  plan.apply();
  if (opts.json) {
    io.out(toJson("init", { root: plan.root, applied: true, steps: plan.steps }));
    return EXIT.ok;
  }
  io.out(
    [
      "Done. Next:",
      "  1. In Claude Code, run /capsules-draft to draft capsules for this project, and approve the intents.",
      "  2. Run `capsules doctor` to check that your app builds and tests exactly as before.",
      "  3. Commit .capsules/ and the files under .claude/ (not .claude/settings.local.json: it is per machine).",
      "Undo everything with `capsules remove`.",
      ...(plan.ownerHint ? ["", `note: ${plan.ownerHint}`] : []),
      "",
    ].join("\n"),
  );
  return EXIT.ok;
}

export async function remove(
  io: Io,
  opts: WriteFlags & { all?: boolean },
  confirm: Confirm = terminalConfirm,
): Promise<number> {
  const root = findProjectRoot(io.cwd);
  const plan = planRemove(root, opts);
  if (!plan.installed && !opts.all) {
    if (opts.json) io.out(toJson("remove", { applied: false, installed: false, steps: [] }));
    else
      io.out("capsules is not installed here (no .capsules/installed.json). Nothing to remove.\n");
    return EXIT.ok;
  }
  if (opts.json && (opts.dryRun || !opts.yes)) {
    io.out(toJson("remove", { applied: false, installed: plan.installed, steps: plan.steps }));
    return opts.dryRun ? EXIT.ok : EXIT.usage;
  }
  if (!opts.json)
    io.out(
      planText(
        `capsules remove will undo what capsules installed${opts.all ? ", and delete .capsules/" : " (.capsules/ stays; add --all to delete it too)"}:`,
        plan.steps,
      ),
    );
  const decision = await go(io, opts, confirm, "Remove these? [y/N] ");
  if (decision !== "apply") return decision === "stop" ? EXIT.ok : decision;
  plan.apply();
  if (opts.json) io.out(toJson("remove", { applied: true, installed: true, steps: plan.steps }));
  else io.out("Removed.\n");
  return EXIT.ok;
}

export async function doctorCmd(io: Io, opts: { run: boolean; json?: boolean }): Promise<number> {
  const project = loadProject(findProjectRoot(io.cwd));
  const r = await runDoctor(project, opts.run);
  const failed = r.problems.length > 0 || r.runs.some((x) => x.status === "fail");
  if (opts.json) {
    io.out(toJson("doctor", { ...r, ok: !failed }));
    return failed ? EXIT.problems : EXIT.ok;
  }
  const lines: string[] = [];
  if (!r.installed)
    lines.push(
      "capsules isn't installed here yet (no .capsules/installed.json); run `capsules init`.",
      "",
    );
  lines.push(`Files capsules created or changed (${r.touched.length}):`);
  for (const p of r.touched) lines.push(`  ${p}`);
  if (r.outsideProject.length) {
    lines.push("Outside the project (per machine, never committed):");
    for (const p of r.outsideProject) lines.push(`  ${p}`);
  }
  lines.push("");
  if (r.problems.length) for (const p of r.problems) lines.push(`problem  ${p}`);
  else lines.push("ok   none of them is app code, package.json, a lockfile or a build output.");
  lines.push(
    r.packageJson === "absent"
      ? "ok   there is no package.json here."
      : r.packageJson === "unchanged"
        ? "ok   package.json is unchanged (capsules never writes it)."
        : "note package.json has uncommitted changes; capsules never writes it, so they are someone else's.",
  );
  for (const x of r.runs) {
    const label = x.what === "build" ? "build" : "tests";
    if (x.status === "not configured")
      lines.push(
        `--   ${label}: not configured (set build.${x.what === "build" ? "command" : "test"} in .capsules/config.yaml)`,
      );
    else if (x.status === "skipped") lines.push(`--   ${label}: not run (--no-run): ${x.command}`);
    else if (x.status === "pass") lines.push(`ok   ${label} pass: ${x.command}`);
    else {
      lines.push(`FAIL ${label} failed: ${x.command}`);
      for (const d of (x.detail ?? "").split("\n")) lines.push(`       ${d}`);
    }
  }
  lines.push(
    "",
    failed
      ? "capsules doctor: problems found."
      : "capsules doctor: your app is unaffected by capsules.",
  );
  io.out(lines.join("\n") + "\n");
  return failed ? EXIT.problems : EXIT.ok;
}
