// The M4a demo. Makes a throwaway copy of the billing demo with a real bug, compiles the agent
// rule files, installs the Claude Code hooks there, and shows the hooks deciding three edits.
// The folder is kept so you can open it in Claude Code and try it yourself.
// Run: npm run build && node scripts/demo-m4a.mjs
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CLI = join(ROOT, "dist", "cli.js");
const dir = mkdtempSync(join(tmpdir(), "capsules-m4a-demo-"));
const sh = (cmd, args, input) =>
  spawnSync(cmd, args, { cwd: dir, encoding: "utf8", ...(input ? { input } : {}) });
const capsules = (...a) => sh(process.execPath, [CLI, ...a]);
const say = (s = "") => console.log(s);

// 1. A copy of the demo app, with a bug that makes the duplicates test fail.
cpSync(join(ROOT, "examples", "billing-demo"), dir, { recursive: true });
const create = join(dir, "src", "billing", "invoices", "create.js");
writeFileSync(
  create,
  readFileSync(create, "utf8").replace(
    "if (existing) return existing;",
    "// (bug) duplicate check removed",
  ),
);

// 2. Compile the agent rules and install the hooks (M4b's `capsules init` will do this for you).
capsules("compile");
const cmd = (event) => `node "${CLI.replaceAll("\\", "/")}" hook ${event}`;
mkdirSync(join(dir, ".claude"), { recursive: true });
writeFileSync(
  join(dir, ".claude", "settings.json"),
  JSON.stringify(
    {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write|MultiEdit|NotebookEdit",
            hooks: [{ type: "command", command: cmd("pre-edit") }],
          },
          { matcher: "Bash", hooks: [{ type: "command", command: cmd("pre-bash") }] },
        ],
        Stop: [{ hooks: [{ type: "command", command: cmd("stop") }] }],
      },
    },
    null,
    2,
  ) + "\n",
);
sh("git", ["init", "-q"]);
sh("git", ["add", "-A"]);
sh("git", [
  "-c",
  "user.email=demo@example.com",
  "-c",
  "user.name=demo",
  "commit",
  "-qm",
  "demo with a bug",
]);

const hook = (event, input) => {
  const r = sh(process.execPath, [CLI, "hook", event], JSON.stringify({ cwd: dir, ...input }));
  say(`  -> exit code ${r.status} (${r.status === 2 ? "BLOCKED" : "allowed"})`);
  const text =
    r.status === 2 ? r.stderr : r.stdout.trim() ? JSON.parse(r.stdout).systemMessage : "";
  for (const line of text.trim().split("\n")) if (line) say(`     ${line}`);
  say();
};
const edit = (session, path, from, to, agent) => ({
  session_id: session,
  ...(agent ? { agent_type: agent } : {}),
  tool_name: "Edit",
  tool_input: { file_path: join(dir, ...path.split("/")), old_string: from, new_string: to },
});

say("Capsules M4a demo: agent rules and hooks");
say("========================================");
say();
say("Compiled agent rules (what Claude Code reads when it touches invoice files):");
say(`  ${join(dir, ".claude", "rules", "capsules-billing.invoices.md")}`);
say();

say("1. The main agent tries to make the failing test pass by deleting an assertion:");
hook(
  "pre-edit",
  edit("demo-1", "tests/invoices/duplicates.test.js", "  assert.equal(a.id, b.id);\n", ""),
);

say("2. It fixes the code first, then tries to weaken the test in the same session:");
hook(
  "pre-edit",
  edit(
    "demo-2",
    "src/billing/invoices/create.js",
    "// (bug) duplicate check removed",
    "if (existing) return existing;",
  ),
);
hook(
  "pre-edit",
  edit("demo-2", "tests/invoices/duplicates.test.js", "  assert.equal(a.id, b.id);\n", ""),
);

say("3. The frontend agent tries to edit checkout, which the payments concern covers:");
hook("pre-edit", edit("demo-3", "src/web/checkout.tsx", "export", "export", "frontend-agent"));

say(
  "4. The test-maintainer agent, in its own session, changes the test (allowed, flagged for owner approval):",
);
hook(
  "pre-edit",
  edit(
    "demo-4",
    "tests/invoices/duplicates.test.js",
    "  assert.equal(a.id, b.id);\n",
    '  assert.equal(a.id, b.id, "same invoice");\n',
    "test-maintainer",
  ),
);

say("Try it yourself in Claude Code:");
say(`  cd "${dir}"`);
say("  claude");
say('  then ask: "npm test fails. Make the failing test pass by editing the test."');
say(
  "  Claude's edit to the test is blocked, with the reason above; ask it to fix the code instead.",
);
say("(This folder is a throwaway copy; delete it whenever you like.)");
