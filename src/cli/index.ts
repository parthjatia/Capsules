import { Command, CommanderError } from "commander";
import { VERSION } from "../version.js";
import { EXIT } from "./exit-codes.js";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("capsules")
    .description(
      "Keep a Git-stored record of what each part of your app is meant to do, and stop agents from quietly breaking it.",
    )
    .version(VERSION, "-v, --version", "print the capsules version")
    .exitOverride();
  return program;
}

export async function main(argv: string[]): Promise<number> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
    return EXIT.ok;
  } catch (err) {
    if (err instanceof CommanderError) {
      // --version, --help and bare `capsules` (which shows help) are not errors.
      if (
        err.code === "commander.version" ||
        err.code === "commander.helpDisplayed" ||
        err.code === "commander.help"
      ) {
        return EXIT.ok;
      }
      return EXIT.usage;
    }
    process.stderr.write(
      `internal error  capsules crashed. This is a bug in capsules, not in your project.\n  ${String(err)}\n`,
    );
    return EXIT.internal;
  }
}

process.exitCode = await main(process.argv);
