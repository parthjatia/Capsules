// Copies Part C of CLAUDE.md into docs/SPEC.md, so the two never drift.
// Run: npm run spec:sync   Check: npm run spec:check (also enforced by test/unit/spec-sync.test.ts)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const HEADER =
  "<!-- Copied from Part C of CLAUDE.md by `npm run spec:sync`. Do not edit here; edit CLAUDE.md. -->\n\n";

export function extractPartC(claudeMd) {
  const text = claudeMd.replace(/\r\n?/g, "\n");
  const start = text.indexOf("\n# PART C");
  const end = text.indexOf("\n# PART D");
  if (start < 0 || end < 0)
    throw new Error("CLAUDE.md: could not find '# PART C' and '# PART D' headings");
  // Drop the trailing '---' separator that precedes Part D.
  const body = text
    .slice(start + 1, end)
    .replace(/\n---\s*$/, "")
    .trimEnd();
  return HEADER + body + "\n";
}

export function expectedSpec() {
  return extractPartC(readFileSync(join(root, "CLAUDE.md"), "utf8"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = join(root, "docs", "SPEC.md");
  const want = expectedSpec();
  if (process.argv.includes("--check")) {
    let have = "";
    try {
      have = readFileSync(target, "utf8").replace(/\r\n?/g, "\n");
    } catch {
      /* missing file counts as different */
    }
    if (have !== want) {
      console.error("docs/SPEC.md differs from Part C of CLAUDE.md. Run: npm run spec:sync");
      process.exit(1);
    }
    console.log("docs/SPEC.md matches Part C of CLAUDE.md.");
  } else {
    writeFileSync(target, want);
    console.log("Wrote docs/SPEC.md from Part C of CLAUDE.md.");
  }
}
