import { Command, CommanderError } from "commander";
import { UsageError } from "../core/project.js";
import { GitError } from "../git/git.js";
import { VERSION } from "../version.js";
import { check } from "./commands/check.js";
import { explain } from "./commands/explain.js";
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
      "validate every capsule (later milestones add locks, the one rule and running checks)",
    )
    .option("--no-run", "don't run check commands; validate only")
    .option("--json", "print JSON instead of text")
    .action((opts: { run: boolean; json?: boolean }) => setExit(check(io, opts)));

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
