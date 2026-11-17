// Line and branch coverage of src/, including the code that runs inside the CLI processes the
// end-to-end tests start (NODE_V8_COVERAGE is inherited by every child process). M6h.
//
// Run: npm run coverage   (writes coverage/ , which is git-ignored; prints a summary)
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const mod = (...p) => join(ROOT, "node_modules", ...p);
const TSUP = mod("tsup", "dist", "cli-default.js");
const run = (args) => {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
  return r.status ?? 1;
};

rmSync(join(ROOT, "coverage"), { recursive: true, force: true });
// Source maps let c8 point at src/*.ts instead of the bundled dist/ files.
if (run([TSUP, "--sourcemap", "--silent"]) !== 0) process.exit(1);
const status = run([
  mod("c8", "bin", "c8.js"),
  "--all",
  "--src",
  "src",
  "--include",
  "src/**",
  "--exclude-after-remap",
  "--reporter",
  "text-summary",
  "--reporter",
  "json-summary",
  "--reporter",
  "html",
  "--reports-dir",
  "coverage",
  mod("vitest", "vitest.mjs"),
  "run",
  ...process.argv.slice(2),
]);
// Put the normal build back (no source maps in dist/).
run([TSUP, "--silent"]);
process.exit(status);
