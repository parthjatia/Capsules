import { Command, CommanderError } from "commander";
import { UsageError } from "../core/project.js";
import { GitError } from "../git/git.js";
import { VERSION } from "../version.js";
import { runHook } from "../hooks/main.js";
import { check, type CheckOptions } from "./commands/check.js";
import { codeowners } from "./commands/codeowners.js";
import { map, type MapOptions } from "./commands/map.js";
import { compile } from "./commands/compile.js";
import { context, type ContextOptions } from "./commands/context.js";
import { doctorCmd, init, remove } from "./commands/install.js";
import { verdictRecord, verdictShow } from "./commands/verdict.js";
import { work } from "./commands/work.js";
import { explain } from "./commands/explain.js";
import { lock, refresh, relock } from "./commands/lock.js";
import { status } from "./commands/status.js";
import { EXIT } from "./exit-codes.js";
import { processIo, type Io } from "./io.js";

export function buildProgram(io: Io, setExit: (code: number) => void): Command {
  const program = new Command();
  program
    .name("capsules")
    .description(
      "Keep a Git-stored record of what each part of your app is meant to do, and stop agents from quietly breaking it.",
    )
    .version(VERSION, "-v, --version", "print the capsules version")
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err });

  program
    .command("explain")
    .description(
      "show a file's home capsule, parents, concerns, rules, checks, who may edit it, and related decisions",
    )
    .argument("<file>", "path to a file in this project")
    .option("--json", "print JSON instead of text")
    .action((file: string, opts: { json?: boolean }) => setExit(explain(io, file, opts)));

  program
    .command("status")
    .description("summarise capsules, orphan files and assumptions past review")
    .option("--json", "print JSON instead of text")
    .action((opts: { json?: boolean }) => setExit(status(io, opts)));

  program
    .command("check")
    .description(
      "validate capsules and the lockfile, guard the changes since the base (permissions, the one rule, append-only decisions, weakened tests), then run the checks of affected capsules",
    )
    .option("--base <ref>", "compare against this branch or commit (default: see C6.4)")
    .option("--all", "run every check, not only those of affected capsules")
    .option("--no-run", "don't run check commands")
    .option("--ci", "CI mode: exit code follows ci.mode in config.yaml (report or block)")
    .option("--summary <file>", "also write the pull request summary (Markdown) to this file")
    .option("--json", "print JSON instead of text")
    .action(async (opts: CheckOptions) => setExit(await check(io, opts)));

  program
    .command("lock")
    .description(
      "record current fingerprints in .capsules/capsules.lock; pins new links, never re-pins existing ones",
    )
    .option("--dry-run", "show what would change without writing")
    .option("--json", "print JSON instead of text")
    .action((opts: { dryRun?: boolean; json?: boolean }) => setExit(lock(io, opts)));

  program
    .command("refresh")
    .description("after reviewing a node, re-pin the links FROM it to what they point at now")
    .argument("<address>", "the node you reviewed, e.g. billing.invoices#D7")
    .option("--dry-run", "show what would change without writing")
    .option("--json", "print JSON instead of text")
    .action((addr: string, opts: { dryRun?: boolean; json?: boolean }) =>
      setExit(refresh(io, addr, opts)),
    );

  program
    .command("relock")
    .description("declare a change to a node cosmetic, re-pinning every link TO it (owners only)")
    .argument("<address>", "the node whose change was cosmetic, e.g. billing.invoices#C1")
    .option("--cosmetic", "required: confirms the change didn't change the meaning")
    .option("--dry-run", "show what would change without writing")
    .option("--json", "print JSON instead of text")
    .action((addr: string, opts: { cosmetic?: boolean; dryRun?: boolean; json?: boolean }) =>
      setExit(relock(io, addr, opts)),
    );

  program
    .command("compile")
    .description("write the agent rule files (Claude Code, Cursor, AGENTS.md) from .capsules/")
    .option("--check", "write nothing; exit 1 if any generated file is out of date (E011)")
    .option("--dry-run", "show what would change without writing")
    .option("--json", "print JSON instead of text")
    .action((opts: { check?: boolean; dryRun?: boolean; json?: boolean }) =>
      setExit(compile(io, opts)),
    );

  program
    .command("work")
    .description("start a scoped work session for an agent, or end it with --end")
    .argument("[pattern]", "capsules to work on, e.g. billing.invoices or 'billing.**'")
    .option("--agent <name>", "the agent from permissions.yaml doing the work (default: default)")
    .option("--end", "end the current session")
    .option("--json", "print JSON instead of text")
    .action(
      (pattern: string | undefined, opts: { agent?: string; end?: boolean; json?: boolean }) =>
        setExit(work(io, pattern, opts)),
    );

  program
    .command("init")
    .description(
      "set up capsules here: shows every file it will create or change, asks, then creates .capsules/, the agent files and the hooks",
    )
    .option(
      "--agents <list>",
      "comma-separated: claude-code, cursor, agents-md (default: claude-code)",
    )
    .option("--git-hooks", "also add a commit-msg Git hook that adds Capsule-* trailers")
    .option("--workflow", "also add .github/workflows/capsules.yml")
    .option("--yes", "don't ask; apply the plan")
    .option("--dry-run", "show the plan without changing anything")
    .option("--json", "print JSON instead of text")
    .action(
      async (opts: {
        agents?: string;
        gitHooks?: boolean;
        workflow?: boolean;
        yes?: boolean;
        dryRun?: boolean;
        json?: boolean;
      }) => setExit(await init(io, opts)),
    );

  program
    .command("remove")
    .description("undo everything capsules init installed; leaves .capsules/ unless --all")
    .option("--all", "also delete .capsules/ (every capsule and the lockfile)")
    .option("--yes", "don't ask; remove")
    .option("--dry-run", "show what would be removed without changing anything")
    .option("--json", "print JSON instead of text")
    .action(async (opts: { all?: boolean; yes?: boolean; dryRun?: boolean; json?: boolean }) =>
      setExit(await remove(io, opts)),
    );

  program
    .command("doctor")
    .description(
      "prove capsules doesn't affect the app: list every file it touched, then run the app's build and tests",
    )
    .option("--no-run", "don't run the build and test commands")
    .option("--json", "print JSON instead of text")
    .action(async (opts: { run: boolean; json?: boolean }) => setExit(await doctorCmd(io, opts)));

  program
    .command("context")
    .description("print what an agent needs before working on a capsule or file (C16)")
    .argument("[target]", "a capsule id or a file path")
    .option("--budget <tokens>", "shrink the far parts to fit about this many tokens")
    .option("--for <who>", "builder (default) or judge (adds the diff and the rules to judge)")
    .option("--base <ref>", "with --for judge: compare against this branch or commit")
    .option("--json", "print JSON instead of text")
    .action((target: string | undefined, opts: ContextOptions) =>
      setExit(context(io, target, opts)),
    );

  const verdict = program
    .command("verdict")
    .description("record or show judge verdicts (advice only)");
  verdict
    .command("record")
    .description("check a judge's verdict JSON and store it as a Git note on the commit")
    .requiredOption("--file <file>", "the verdict JSON")
    .option("--json", "print JSON instead of text")
    .action((opts: { file: string; json?: boolean }) => setExit(verdictRecord(io, opts)));
  verdict
    .command("show")
    .description("print the verdicts stored on a commit")
    .argument("[commit]", "the commit (default: HEAD)")
    .option("--json", "print JSON instead of text")
    .action((commit: string | undefined, opts: { json?: boolean }) =>
      setExit(verdictShow(io, commit, opts)),
    );

  program
    .command("map")
    .description(
      "draw the map: areas, concerns, rules, what needs attention, and a file search (HTML, offline)",
    )
    .option(
      "--format <format>",
      "html (default, written to .capsules/_cache/map.html), mermaid or json",
    )
    .option("--out <file>", "write to this file instead")
    .option("--open", "open the HTML map in your browser")
    .option("--base <ref>", "compare against this branch or commit when finding unreviewed checks")
    .option("--dry-run", "say where the map would be written, without writing it")
    .option("--json", "print JSON instead of text")
    .action((opts: MapOptions) => setExit(map(io, opts)));

  program
    .command("codeowners")
    .description("print suggested CODEOWNERS lines for capsules, settings and check files")
    .option("--json", "print JSON instead of text")
    .action((opts: { json?: boolean }) => setExit(codeowners(io, opts)));

  program
    .command("hook")
    .description("called by agent and Git hooks only: pre-edit, pre-bash, stop, commit-msg <file>")
    .argument("<event>", "pre-edit | pre-bash | stop | commit-msg")
    .argument("[file]", "the commit message file (commit-msg only)")
    .action(async (event: string, file: string | undefined) =>
      setExit(await runHook(file ? [event, file] : [event])),
    );

  return program;
}

export async function main(argv: string[], io: Io = processIo()): Promise<number> {
  let code: number = EXIT.ok;
  const program = buildProgram(io, (c) => (code = c));
  try {
    await program.parseAsync(argv);
    return code;
  } catch (err) {
    if (err instanceof CommanderError) {
      // --version, --help and bare `capsules` (which shows help) are not errors.
      if (["commander.version", "commander.helpDisplayed", "commander.help"].includes(err.code))
        return EXIT.ok;
      return EXIT.usage;
    }
    if (err instanceof UsageError) {
      io.err(`error  ${err.message}\n`);
      return EXIT.usage;
    }
    if (err instanceof GitError) {
      io.err(`error  ${err.message}\n`);
      return EXIT.problems;
    }
    io.err(
      `internal error  capsules crashed. This is a bug in capsules, not in your project.\n  ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    return EXIT.internal;
  }
}
