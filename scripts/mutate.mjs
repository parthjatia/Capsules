// M6h: a small mutation tester for the guard. It plants one bug at a time in the code that
// decides what to block (flip a comparison, swap && and ||, turn a block into an allow...),
// rebuilds, and runs the tests. A mutant the tests catch is "killed"; one they miss
// "survived", which points at a missing test.
//
// Why not Stryker: most of our tests run the built CLI in a separate process, which
// Stryker's in-process mutant switching can't reach. Here every mutant is rebuilt.
//
// Run (in a scratch copy of the repo, never in your working folder; it edits src/):
//   node scripts/mutate.mjs --copy <scratch folder> [--per-file 12] [--seed 1] [--files a,b]
// It makes a `git worktree` of HEAD at <scratch folder>, links node_modules, and writes
// <scratch folder>/mutants.json. Remove the copy afterwards: git worktree remove <folder>.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const copy = opt("--copy") && resolve(opt("--copy"));
if (!copy) {
  console.error("Usage: node scripts/mutate.mjs --copy <scratch folder> [--per-file n] [--seed n]");
  process.exit(64);
}
const perFile = Number(opt("--per-file", "12"));
const workers = Number(opt("--workers", "4")); // few: this machine may be short of memory
let seed = Number(opt("--seed", "1"));
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

export const FILES = [
  "src/core/access.ts",
  "src/core/permissions.ts",
  "src/core/identity.ts",
  "src/core/approvals.ts",
  "src/core/judges.ts",
  "src/core/guard.ts",
  "src/checks/heuristics.ts",
  "src/hooks/pre-edit.ts",
  "src/hooks/pre-bash.ts",
  "src/hooks/session.ts",
];
const files = opt("--files")?.split(",") ?? FILES;

// The tests that judge the guard. A killed mutant stops at the first failure (--bail).
const TESTS = [
  "test/unit/guard.test.ts",
  "test/unit/hooks.test.ts",
  "test/unit/properties.test.ts",
  "test/e2e/hooks.test.ts",
  "test/e2e/pre-bash-cd.test.ts",
  "test/e2e/m3.test.ts",
  "test/e2e/m4b.test.ts",
  "test/e2e/m6.test.ts",
  "test/e2e/m6a.test.ts",
  "test/e2e/m6b.test.ts",
  "test/e2e/m6h-gaps.test.ts",
];

const OPERATORS = [
  ["===", "!=="],
  ["!==", "==="],
  [" && ", " || "],
  [" || ", " && "],
  ["return block(", "return allow("],
  ["allowed: false", "allowed: true"],
  [".some(", ".every("],
  [".every(", ".some("],
  ["true", "false"],
  ["false", "true"],
  [" < ", " <= "],
  [" > ", " >= "],
  ["if (!", "if ("],
  ["continue;", ";"],
];

function mutantsOf(file) {
  const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
  const out = [];
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("import "))
      return;
    for (const [from, to] of OPERATORS) {
      let at = line.indexOf(from);
      while (at >= 0) {
        // Skip operators inside a string literal on that line (rough: odd quote count before).
        const before = line.slice(0, at);
        const quotes = (before.match(/"/g) ?? []).length + (before.match(/`/g) ?? []).length;
        if (quotes % 2 === 0)
          out.push({
            file,
            line: i + 1,
            from,
            to,
            text: line.slice(0, at) + to + line.slice(at + from.length),
          });
        at = line.indexOf(from, at + 1);
      }
    }
  });
  return out;
}

const run = (cmd, a, cwd, timeout = 900_000) =>
  spawnSync(cmd, a, { cwd, encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });

if (!existsSync(copy)) {
  const w = run("git", ["worktree", "add", "--detach", copy, "HEAD"], ROOT);
  if (w.status !== 0) {
    console.error(w.stderr);
    process.exit(1);
  }
  // Uncommitted work in the real folder isn't in HEAD: copy the files this run needs.
  for (const f of [
    ...FILES,
    ...TESTS,
    "test/e2e/helpers.ts",
    "test/setup-env.ts",
    "vitest.config.ts",
  ])
    if (existsSync(join(ROOT, f))) writeFileSync(join(copy, f), readFileSync(join(ROOT, f)));
  for (const f of run("git", ["ls-files", "-mo", "--exclude-standard", "src", "test"], ROOT)
    .stdout.split("\n")
    .filter(Boolean))
    writeFileSync(join(copy, f), readFileSync(join(ROOT, f)));
  symlinkSync(join(ROOT, "node_modules"), join(copy, "node_modules"), "junction");
}

const env = { ...process.env };
for (const k of [
  "CAPSULES_SESSION",
  "CLAUDECODE",
  "CLAUDE_ENV_FILE",
  "GITHUB_ACTIONS",
  "GITHUB_EVENT_PATH",
])
  delete env[k];
const node = (a, timeout) =>
  spawnSync(process.execPath, a, {
    cwd: copy,
    env,
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
const build = () =>
  node([join(copy, "node_modules", "tsup", "dist", "cli-default.js"), "--silent"], 120_000);
const test = () =>
  node(
    [
      join(copy, "node_modules", "vitest", "vitest.mjs"),
      "run",
      "--bail=1",
      `--maxWorkers=${workers}`,
      "--reporter=dot",
      ...TESTS,
    ],
    1_800_000,
  );

// The tests must pass before any mutant, or every mutant looks killed.
if (build().status !== 0 || test().status !== 0) {
  console.error("The tests fail in the copy without any mutant; fix that first.");
  process.exit(1);
}

const all = files.flatMap((f) => {
  const ms = mutantsOf(f);
  const picked = [];
  while (picked.length < Math.min(perFile, ms.length)) {
    const m = ms.splice(Math.floor(rand() * ms.length), 1)[0];
    picked.push(m);
  }
  return picked;
});

const results = [];
for (const [i, m] of all.entries()) {
  const path = join(copy, m.file);
  const original = readFileSync(path, "utf8");
  const lines = original.split("\n");
  lines[m.line - 1] = m.text;
  writeFileSync(path, lines.join("\n"));
  let status;
  const b = build();
  if (b.status !== 0) status = "invalid";
  else {
    const t = test();
    status = t.status === 0 ? "survived" : t.signal ? "timeout" : "killed";
  }
  writeFileSync(path, original);
  results.push({ ...m, status });
  process.stderr.write(
    `${i + 1}/${all.length} ${status.padEnd(8)} ${m.file}:${m.line} ${m.from.trim()} -> ${m.to.trim()}\n`,
  );
  writeFileSync(join(copy, "mutants.json"), JSON.stringify(results, null, 2));
}
build();

const count = (s) => results.filter((r) => r.status === s).length;
const valid = results.length - count("invalid");
console.log(
  `mutants: ${results.length}, killed: ${count("killed")}, survived: ${count("survived")}, timeout: ${count("timeout")}, invalid: ${count("invalid")}`,
);
console.log(
  `mutation score: ${valid ? Math.round(((count("killed") + count("timeout")) / valid) * 100) : 0}%`,
);
for (const r of results.filter((x) => x.status === "survived"))
  console.log(`survived  ${r.file}:${r.line}  ${r.from.trim()} -> ${r.to.trim()}`);
