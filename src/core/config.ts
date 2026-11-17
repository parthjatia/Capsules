// .capsules/config.yaml (C4). Missing keys take the C4 defaults; unknown keys are errors,
// because a typo in a protection setting must never silently weaken it.
import { parseDocument } from "yaml";
import { z } from "zod";
import { msg, type Diagnostic } from "../report/messages.js";

export const DEFAULT_IGNORE = [
  ".capsules/**",
  ".claude/**",
  ".cursor/**",
  ".github/**",
  "README.md",
  "CHANGELOG.md",
  "docs/**",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
];

export const DEFAULT_CHECK_FILES = [
  "tests/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/test_*.py",
  "**/*_test.go",
];

const ConfigSchema = z.strictObject({
  format: z.union([z.number(), z.string()]).optional(),
  agents: z.array(z.enum(["claude-code", "cursor", "agents-md"])).default(["claude-code"]),
  ignore: z.array(z.string()).default(DEFAULT_IGNORE),
  checks: z
    .strictObject({
      files: z.array(z.string()).default(DEFAULT_CHECK_FILES),
      "timeout-seconds": z.number().int().positive().default(300),
    })
    .default({ files: DEFAULT_CHECK_FILES, "timeout-seconds": 300 }),
  "one-rule": z
    .strictObject({ "new-checks-with-code": z.enum(["allow", "block"]).default("allow") })
    .default({ "new-checks-with-code": "allow" }),
  // C18.5: gentle turns only scope and blocked-by refusals into warnings (W111).
  mode: z.enum(["strict", "gentle"]).default("strict"),
  "weakened-tests": z.enum(["off", "warn", "block"]).default("warn"),
  "weakened-tests-patterns": z
    .strictObject({
      assertions: z.array(z.string()).optional(),
      skips: z.array(z.string()).optional(),
    })
    .optional(),
  "stale-links": z.enum(["warn", "block"]).default("warn"),
  ci: z
    .strictObject({ mode: z.enum(["report", "block"]).default("report") })
    .default({ mode: "report" }),
  hooks: z
    .strictObject({ "on-error": z.enum(["open", "closed"]).default("open") })
    .default({ "on-error": "open" }),
  rules: z
    .strictObject({ "max-chars": z.number().int().positive().default(6000) })
    .default({ "max-chars": 6000 }),
  build: z
    .strictObject({
      command: z.string().optional(),
      test: z.string().optional(),
      outputs: z.array(z.string()).default([]),
    })
    .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function defaultConfig(): Config {
  return ConfigSchema.parse({});
}

export function zodProblems(error: z.ZodError): string {
  return error.issues
    .map((i) => {
      const where = i.path.length ? `\`${i.path.join(".")}\`` : "top level";
      if (i.code === "unrecognized_keys") {
        return `unknown key${i.keys.length > 1 ? "s" : ""} ${i.keys.map((k) => `\`${k}\``).join(", ")} at ${where}`;
      }
      return `${where}: ${i.message}`;
    })
    .join("; ");
}

/** Parse YAML text into a plain value, reporting E008 with a line on syntax errors. */
export function readYaml(text: string, file: string, diagnostics: Diagnostic[]): unknown {
  const doc = parseDocument(text.replace(/\r\n?/g, "\n"));
  if (doc.errors.length) {
    const e = doc.errors[0]!;
    diagnostics.push(
      msg.E022(
        { file, line: e.linePos?.[0]?.line ?? 1 },
        `the YAML can't be read (${e.message.split("\n")[0]})`,
      ),
    );
    return undefined;
  }
  return doc.toJS() ?? {};
}

export function parseConfig(text: string | null, file: string, diagnostics: Diagnostic[]): Config {
  if (text === null) return defaultConfig();
  const raw = readYaml(text, file, diagnostics);
  if (raw === undefined) return defaultConfig();
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    diagnostics.push(msg.E022({ file, line: 1 }, zodProblems(parsed.error)));
    return defaultConfig();
  }
  return parsed.data;
}
