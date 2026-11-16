import { Command, CommanderError } from "commander";
import { UsageError } from "../core/project.js";
import { GitError } from "../git/git.js";
import { VERSION } from "../version.js";
import { check, type CheckOptions } from "./commands/check.js";
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

process.exitCode = await main(process.argv);
