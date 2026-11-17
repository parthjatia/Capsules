// M6h: try capsules on real open-source repositories, the way a new user would, and prove
// it leaves each one exactly as it found it.
//
// Run:  npm run build && node scripts/try-real-repos.mjs --work <empty folder> [--only name,...]
//
// For each repo: a shallow clone into --work (never inside this repo), then init, check,
// status, explain, map, compile --check, codeowners, doctor --no-run, the hooks (an allowed
// code edit and a blocked test edit, timed), and remove --all. It compares every tracked
// file, every untracked file, .git/info/exclude and .git/hooks before and after.
// Results go to <work>/results.json and a table on stdout. Nothing is pushed anywhere.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const REPOS = [
  ["express", "https://github.com/expressjs/express", "JavaScript"],
  ["commander", "https://github.com/tj/commander.js", "JavaScript"],
  ["ky", "https://github.com/sindresorhus/ky", "TypeScript"],
  ["hono", "https://github.com/honojs/hono", "TypeScript"],
  ["vite", "https://github.com/vitejs/vite", "TypeScript monorepo"],
  ["prettier", "https://github.com/prettier/prettier", "JavaScript, very large"],
  ["flask", "https://github.com/pallets/flask", "Python"],
  ["requests", "https://github.com/psf/requests", "Python"],
  ["fastapi", "https://github.com/fastapi/fastapi", "Python, many docs"],
  ["cobra", "https://github.com/spf13/cobra", "Go"],
  ["gin", "https://github.com/gin-gonic/gin", "Go"],
  ["fzf", "https://github.com/junegunn/fzf", "Go"],
  ["ripgrep", "https://github.com/BurntSushi/ripgrep", "Rust"],
  ["serde", "https://github.com/serde-rs/serde", "Rust"],
  ["sinatra", "https://github.com/sinatra/sinatra", "Ruby"],
  ["gson", "https://github.com/google/gson", "Java"],
  ["jq", "https://github.com/jqlang/jq", "C"],
  ["newtonsoft-json", "https://github.com/JamesNK/Newtonsoft.Json", "C#"],
  ["laravel", "https://github.com/laravel/framework", "PHP"],
  ["swift-argument-parser", "https://github.com/apple/swift-argument-parser", "Swift"],
];

const ROOT = join(import.meta.dirname, "..");
const CLI = join(ROOT, "dist", "cli.js");
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const work = opt("--work") && resolve(opt("--work"));
if (!work) {
  console.error("Usage: node scripts/try-real-repos.mjs --work <empty folder> [--only a,b]");
  process.exit(64);
}
if (!existsSync(CLI)) {
  console.error("Build capsules first: npm run build");
  process.exit(1);
}
const only = opt("--only")?.split(",");
mkdirSync(work, { recursive: true });

// A person in their own terminal: no agent session, not in CI.
const env = { ...process.env };
for (const k of [
  "CAPSULES_SESSION",
  "CLAUDECODE",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_ENV_FILE",
  "GITHUB_ACTIONS",
  "GITHUB_EVENT_PATH",
])
  delete env[k];

const run = (cmd, a, cwd, input) => {
  const t = process.hrtime.bigint();
  const r = spawnSync(cmd, a, {
    cwd,
    env,
    input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: 600_000,
  });
  return { ...r, ms: Number(process.hrtime.bigint() - t) / 1e6 };
};
const git = (dir, ...a) => run("git", a, dir);
const capsules = (dir, ...a) => run(process.execPath, [CLI, ...a], dir);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function snapshot(dir) {
  const hooksDir = join(dir, ".git", "hooks");
  const exclude = join(dir, ".git", "info", "exclude");
  return {
    tracked: git(dir, "ls-files", "-s").stdout,
    // Modified tracked files and every untracked file, ignored ones included.
    status: git(dir, "status", "--porcelain", "--untracked-files=all", "--ignored").stdout,
    exclude: existsSync(exclude) ? readFileSync(exclude, "utf8") : null,
    hooks: existsSync(hooksDir) ? readdirSync(hooksDir).sort().join(",") : "",
  };
}

/** A test file with a line that holds an assertion and appears once in the file. */
function findTest(dir, files) {
  const isTest = (f) =>
    /(^|\/)(tests?|__tests__|spec)\//.test(f) ||
    /\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.go$/.test(f);
  for (const f of files.filter(isTest).slice(0, 400)) {
    let text;
    try {
      text = readFileSync(join(dir, f), "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    const hit = lines.find(
      (l) =>
        /assert|expect\(|should|t\.Error|require\./.test(l) &&
        l.trim().length > 8 &&
        text.split(l).length === 2,
    );
    if (hit) return { file: f, line: hit };
  }
  return null;
}

function codes(out) {
  const m = {};
  for (const c of out.match(/\b[EW]\d{3}\b/g) ?? []) m[c] = (m[c] ?? 0) + 1;
  return m;
}

function tryRepo([name, url, lang]) {
  const dir = join(work, name);
  const res = { name, url, lang, problems: [] };
  const problem = (p) => res.problems.push(p);
  if (!existsSync(dir)) {
    const c = git(work, "clone", "-q", "--depth", "1", "-c", "core.longpaths=true", url, name);
    if (c.status !== 0)
      return { ...res, skipped: `clone failed: ${c.stderr.trim().slice(0, 200)}` };
  }
  git(dir, "config", "user.email", "trial@example.com");
  git(dir, "config", "user.name", "Trial");
  res.commit = git(dir, "rev-parse", "--short", "HEAD").stdout.trim();
  const files = git(dir, "ls-files").stdout.split("\n").filter(Boolean);
  res.files = files.length;
  const before = snapshot(dir);

  const init = capsules(dir, "init", "--yes");
  res.init = { exit: init.status, ms: Math.round(init.ms) };
  if (init.status !== 0)
    problem(`init exit ${init.status}: ${(init.stderr || init.stdout).slice(0, 300)}`);

  const check = capsules(dir, "check", "--no-run");
  res.check = {
    exit: check.status,
    ms: Math.round(check.ms),
    codes: codes(check.stdout + check.stderr),
  };
  // A fresh install is a draft: it must not fail anyone's CI.
  if (check.status !== 0)
    problem(`check --no-run exit ${check.status}: ${(check.stdout + check.stderr).slice(0, 400)}`);
  const check2 = capsules(dir, "check", "--no-run");
  res.check.ms2 = Math.round(check2.ms); // warm (index cached)

  for (const [k, a] of [
    ["status", ["status"]],
    ["explain", ["explain", files.find((f) => !f.startsWith(".")) ?? files[0]]],
    ["map", ["map"]],
    ["compileCheck", ["compile", "--check"]],
    ["codeowners", ["codeowners"]],
    ["doctor", ["doctor", "--no-run"]],
    ["json", ["check", "--no-run", "--json"]],
  ]) {
    const r = capsules(dir, ...a);
    res[k] = { exit: r.status, ms: Math.round(r.ms) };
    if (r.status === 70 || r.signal) problem(`${a.join(" ")} crashed: ${r.stderr.slice(0, 300)}`);
    if (k === "json") {
      try {
        JSON.parse(r.stdout);
      } catch {
        problem("check --json printed invalid JSON");
      }
    }
    if (k !== "json" && k !== "map" && r.status !== 0 && k !== "doctor")
      problem(`${a.join(" ")} exit ${r.status}: ${(r.stdout + r.stderr).slice(0, 300)}`);
  }
  const map = join(dir, ".capsules", "_cache", "map.html");
  if (
    existsSync(map) &&
    /https?:\/\/(?!www\.w3\.org)/.test(readFileSync(map, "utf8").replace(/content="[^"]*"/g, ""))
  )
    problem("map.html mentions a network URL");

  // Hooks: an allowed code edit, and removing an assertion from an existing test.
  const hook = (event, input) =>
    run(
      process.execPath,
      [CLI, "hook", event],
      dir,
      JSON.stringify({ cwd: dir, session_id: `trial-${name}`, ...input }),
    );
  const code = files.find(
    (f) => /\.(js|ts|py|go|rs|rb|java|c|cs|php|swift)$/.test(f) && !findTest(dir, [f]),
  );
  if (code) {
    const times = [];
    let last;
    for (let i = 0; i < 5; i++) {
      last = hook("pre-edit", {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: join(dir, code), content: "changed\n" },
      });
      times.push(last.ms);
    }
    res.hookCode = { exit: last.status, ms: Math.round(median(times)) };
    if (last.status !== 0)
      problem(`hook blocked an allowed code edit to ${code}: ${last.stderr.slice(0, 300)}`);
  }
  const t = findTest(dir, files);
  if (t) {
    const times = [];
    let last;
    for (let i = 0; i < 5; i++) {
      last = hook("pre-edit", {
        hook_event_name: "PreToolUse",
        session_id: `trial-${name}-t${i}`,
        tool_name: "Edit",
        tool_input: { file_path: join(dir, t.file), old_string: t.line, new_string: "" },
      });
      times.push(last.ms);
    }
    res.hookTest = { file: t.file, exit: last.status, ms: Math.round(median(times)) };
    const caught = last.status === 2 || /W107|assertion/i.test(last.stdout + last.stderr);
    res.hookTest.caught = caught;
    if (!caught) problem(`removing an assertion from ${t.file} wasn't blocked or flagged`);
    const bash = hook("pre-bash", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: `sed -i '1d' ${t.file}` },
    });
    res.hookBash = { exit: bash.status, ms: Math.round(bash.ms) };
    if (bash.status !== 2) problem(`pre-bash let \`sed -i\` change ${t.file}`);
  }
  const stop = run(
    process.execPath,
    [CLI, "hook", "stop"],
    dir,
    JSON.stringify({ cwd: dir, session_id: `trial-${name}`, hook_event_name: "Stop" }),
  );
  res.hookStop = { exit: stop.status, ms: Math.round(stop.ms) };
  if (stop.status !== 0) problem(`Stop hook exit ${stop.status}`);

  const rm = capsules(dir, "remove", "--yes", "--all");
  res.remove = { exit: rm.status, ms: Math.round(rm.ms) };
  if (rm.status !== 0)
    problem(`remove exit ${rm.status}: ${(rm.stdout + rm.stderr).slice(0, 300)}`);
  const after = snapshot(dir);
  for (const k of Object.keys(before))
    if (before[k] !== after[k])
      problem(
        `after remove, ${k} differs:\n--- before\n${String(before[k]).slice(0, 400)}\n--- after\n${String(after[k]).slice(0, 400)}`,
      );
  res.identical = Object.keys(before).every((k) => before[k] === after[k]);
  return res;
}

const results = [];
for (const r of REPOS) {
  if (only && !only.includes(r[0])) continue;
  process.stderr.write(`${r[0]}... `);
  let res;
  try {
    res = tryRepo(r);
  } catch (e) {
    res = { name: r[0], url: r[1], lang: r[2], problems: [`script error: ${e.stack}`] };
  }
  results.push(res);
  process.stderr.write(
    res.skipped
      ? `skipped (${res.skipped})\n`
      : `${res.problems.length ? res.problems.length + " problem(s)" : "ok"}\n`,
  );
  writeFileSync(join(work, "results.json"), JSON.stringify(results, null, 2));
}

const pad = (s, n) => String(s ?? "-").padEnd(n);
console.log(
  pad("repo", 22) +
    pad("lang", 22) +
    pad("files", 7) +
    pad("check ms", 10) +
    pad("hook ms", 9) +
    pad("test edit", 11) +
    pad("identical", 10) +
    "problems",
);
for (const r of results)
  console.log(
    pad(r.name, 22) +
      pad(r.lang, 22) +
      pad(r.files, 7) +
      pad(r.check && `${r.check.ms}/${r.check.ms2}`, 10) +
      pad(r.hookCode?.ms, 9) +
      pad(r.hookTest ? (r.hookTest.caught ? `caught` : "MISSED") : "no test", 11) +
      pad(r.skipped ? "skipped" : r.identical, 10) +
      r.problems.length,
  );
