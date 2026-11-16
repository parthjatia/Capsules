// The M3 demo: an "agent" changes the invoice code and deletes the test line that would
// catch its bug, in one commit. `capsules check` refuses it (the one rule, C6.2).
// Everything happens in a temporary copy of examples/billing-demo; nothing here changes.
// Run from the repository root:  node scripts/demo-m3.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dirname, "..");
const cli = join(repo, "dist", "cli.js");
if (!existsSync(cli)) {
  console.error("Build capsules first:  npm run build");
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "capsules-m3-demo-"));
const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
const edit = (path, from, to) => {
  const p = join(dir, ...path.split("/"));
  const text = readFileSync(p, "utf8");
  if (!text.includes(from)) throw new Error(`${path} does not contain: ${from}`);
  writeFileSync(p, text.replace(from, to));
};

console.log(`1. Copy the demo app to ${dir}`);
console.log("   and commit it on a branch called main.");
cpSync(join(repo, "examples", "billing-demo"), dir, { recursive: true });
git("init", "-q");
git("config", "core.autocrlf", "false");
git("config", "user.name", "Demo");
// The demo's permissions.yaml lists the owner by GitHub handle; this noreply form maps to it.
git("config", "user.email", "parthjatia@users.noreply.github.com");
git("checkout", "-q", "-b", "main");
git("add", "-A");
git("commit", "-q", "-m", "The app before the change");

console.log("\n2. On a new branch, one commit does two things, as a careless agent might:");
console.log(
  "   - changes src/billing/invoices/create.js so March invoices can be created twice (a bug)",
);
console.log("   - deletes the line in tests/invoices/duplicates.test.js that would have caught it");
git("checkout", "-q", "-b", "fix-invoices");
edit(
  "src/billing/invoices/create.js",
  "if (existing) return existing;",
  'if (existing && period !== "2026-03") return existing;',
);
edit("tests/invoices/duplicates.test.js", "  assert.equal(a.id, b.id);\n", "");
git("add", "-A");
git("commit", "-q", "-m", "Fix invoice creation");

console.log("\n3. Run: capsules check\n");
const r = spawnSync(process.execPath, [cli, "check"], { cwd: dir, stdio: "inherit" });
console.log(
  `\ncapsules check exited with code ${r.status} (1 means: problems found, the change is refused).`,
);
console.log(`The demo copy stays in ${dir} if you want to look; it is safe to delete.`);
