// The M4b demo: install capsules on an app that has never seen it, prove the app is
// unaffected, show an agent being stopped from switching its own guard off, then remove
// everything and show the repo is exactly as before.
// Run: npm run build && node scripts/demo-m4b.mjs
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CLI = join(ROOT, "dist", "cli.js");
const dir = mkdtempSync(join(tmpdir(), "capsules-m4b-demo-"));
const sh = (cmd, args, input) =>
  spawnSync(cmd, args, { cwd: dir, encoding: "utf8", ...(input ? { input } : {}) });
const capsules = (...a) => sh(process.execPath, [CLI, ...a]);
const say = (s = "") => console.log(s);
const indent = (t, n = 2) =>
  t
    .trimEnd()
    .split("\n")
    .map((l) => " ".repeat(n) + l)
    .join("\n");

// An app that has never seen capsules: the billing demo without its .capsules/ folder.
cpSync(join(ROOT, "examples", "billing-demo"), dir, { recursive: true });
rmSync(join(dir, ".capsules"), { recursive: true, force: true });
sh("git", ["init", "-q"]);
sh("git", ["config", "core.autocrlf", "false"]);
sh("git", ["add", "-A"]);
sh("git", ["-c", "user.email=demo@example.com", "-c", "user.name=demo", "commit", "-qm", "an app"]);

say("Capsules M4b demo: install, prove, guard, remove");
say("================================================");
say();
say("1. `capsules init` first shows its plan and changes nothing until you say yes:");
say(indent(capsules("init", "--dry-run").stdout));
say();
say("2. `capsules init --yes` applies it:");
say(indent(capsules("init", "--yes").stdout.split("\n").slice(-8).join("\n")));
say();
say(
  "3. `capsules doctor` proves the app is unaffected (and runs the build and tests once they're set in config.yaml):",
);
say(indent(capsules("doctor").stdout));
say();
say("4. An agent tries to switch its own guard off by editing the hooks file:");
const r = sh(
  process.execPath,
  [CLI, "hook", "pre-edit"],
  JSON.stringify({
    cwd: dir,
    session_id: "demo",
    tool_name: "Edit",
    tool_input: {
      file_path: join(dir, ".claude", "settings.local.json"),
      old_string: '"hooks"',
      new_string: '"hooks_off"',
    },
  }),
);
say(`  -> exit code ${r.status} (${r.status === 2 ? "BLOCKED" : "allowed"})`);
say(indent(r.stderr, 5));
say();
say("5. `capsules remove --all --yes` undoes everything:");
say(indent(capsules("remove", "--all", "--yes").stdout.split("\n").slice(-4).join("\n")));
const status = sh("git", [
  "status",
  "--porcelain",
  "--untracked-files=all",
  "--ignored",
]).stdout.trim();
say();
say(
  status
    ? `  git status still shows changes:\n${indent(status, 4)}`
    : "  git status: nothing changed, nothing added, nothing left behind. The repo is exactly as before.",
);
rmSync(dir, { recursive: true, force: true });
