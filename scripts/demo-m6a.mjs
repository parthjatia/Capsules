// The M6a demo (zero friction, C18): run `npm run build && node scripts/demo-m6a.mjs`.
// Everything happens in a temporary copy of the demo app; nothing else changes.
// The hooks are fed the same JSON Claude Code sends them, so no Claude session is needed.
// Steps marked "you" run as a human would in their own terminal.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CLI = join(ROOT, "dist", "cli.js");
const dir = mkdtempSync(join(tmpdir(), "capsules-m6a-"));
const human = { ...process.env };
delete human.CLAUDECODE; // "you", in your own terminal
delete human.CAPSULES_SESSION;
delete human.CLAUDE_ENV_FILE;

const sh = (cmd, args, env = human) => spawnSync(cmd, args, { cwd: dir, encoding: "utf8", env });
const git = (...a) => sh("git", a);
const capsules = (args, env = human, input) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: "utf8", env, input });
const hook = (event, input, env = human) =>
  capsules(["hook", event], env, JSON.stringify({ cwd: dir, ...input }));
const edit = (file, from, to) => {
  const p = join(dir, ...file.split("/"));
  writeFileSync(p, readFileSync(p, "utf8").replace(from, to));
};
const step = (n, title) => console.log(`\n=== ${n}. ${title} ===\n`);
const show = (text) => console.log(text.trimEnd().replace(/^/gm, "  "));

cpSync(join(ROOT, "examples", "billing-demo"), dir, { recursive: true });
git("init", "-q");
git("config", "core.autocrlf", "false");
git("config", "user.name", "Parth");
git("config", "user.email", "63094286+parthjatia@users.noreply.github.com");
git("checkout", "-q", "-b", "main");
git("add", "-A");
git("commit", "-qm", "the app");
git("checkout", "-q", "-b", "work");
console.log(`Demo folder: ${dir}`);

step(1, "A Claude Code session starts: capsules opens a session by itself (SessionStart)");
const envFile = join(mkdtempSync(join(tmpdir(), "capsules-m6a-env-")), "claude-env");
writeFileSync(envFile, "");
const start = hook(
  "session-start",
  { hook_event_name: "SessionStart", session_id: "demo-session", source: "startup" },
  { ...human, CLAUDE_ENV_FILE: envFile },
);
show(start.stdout);
show(`(for Claude's shell commands: ${readFileSync(envFile, "utf8").trim()})`);
const session = /CAPSULES_SESSION=(\S+)/.exec(readFileSync(envFile, "utf8"))[1];
const agentEnv = { ...human, CLAUDECODE: "1", CAPSULES_SESSION: session };

step(2, "Claude changes the refund code, then tries to make a test pass by weakening it");
const preEdit = (file) =>
  hook("pre-edit", {
    hook_event_name: "PreToolUse",
    session_id: "demo-session",
    tool_name: "Edit",
    tool_input: { file_path: join(dir, file), old_string: "a", new_string: "b" },
  });
show(
  `edit src/billing/invoices/refund.js -> ${preEdit("src/billing/invoices/refund.js").status === 0 ? "allowed" : "blocked"}`,
);
const blocked = preEdit("tests/invoices/refunds.test.js");
show(`edit tests/invoices/refunds.test.js -> ${blocked.status === 2 ? "BLOCKED" : "allowed"}:`);
show(blocked.stderr);

step(3, "Instead of stopping, Claude leaves a note for you and carries on (capsules propose)");
show(
  capsules(
    [
      "propose",
      "tests/invoices/refunds.test.js",
      "--why",
      "The refund limit may need to allow partial refunds.",
    ],
    agentEnv,
  ).stdout,
);

step(4, "Gentle mode: an agent outside its area only gets a warning; tests and rules stay blocked");
show(capsules(["mode", "gentle"]).stdout); // you
git("commit", "-qam", "Try gentle mode"); // your own commit: only an owner may change config.yaml
const fe = hook("pre-edit", {
  hook_event_name: "PreToolUse",
  session_id: "fe-session",
  agent_type: "frontend-agent",
  tool_name: "Edit",
  tool_input: { file_path: join(dir, "src/web/checkout.tsx"), old_string: "a", new_string: "b" },
});
show(
  `frontend-agent edits src/web/checkout.tsx (covered by payments) -> ${fe.status === 0 ? "allowed, with:" : "blocked"}`,
);
show(JSON.parse(fe.stdout).systemMessage);
show(capsules(["mode"]).stdout);

step(
  5,
  "The drafter proposes a rule change; at the end of the task, the fast checks CI would run (Stop report)",
);
edit(
  ".capsules/billing/invoices.md",
  "for the same customer and period.",
  "for the same customer, period and plan.",
);
capsules(["lock"]);
git("add", "-A");
git(
  "commit",
  "-qm",
  "Invoices per plan\n\nCapsule-Session: " +
    session +
    "\nCapsule-Agent: capsules-drafter\nCapsule-Role: drafter\nCapsule-Scope: **",
);
show(
  JSON.parse(hook("stop", { hook_event_name: "Stop", session_id: "demo-session" }).stdout)
    .systemMessage,
);

step(
  6,
  "You: capsules review (changed rules and tests first, in full; routine items one line each)",
);
show(capsules(["review", "--base", "main"]).stdout);

step(7, "Approving is for humans: refused in Claude's shell, done in yours");
show(capsules(["review", "approve", "r1", "--base", "main"], agentEnv).stderr);
show(capsules(["review", "approve", "r1", "--base", "main"]).stdout);
show(readFileSync(join(dir, ".capsules", "approvals.lock"), "utf8"));

console.log(`\nDone. Everything above happened in ${dir}; nothing else was changed.`);
