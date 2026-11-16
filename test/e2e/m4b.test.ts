// M4b end to end: init, doctor, remove, context, verdicts, codeowners, and the guard on
// Claude Code's settings files (D-026).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CLI, cleanup, commit, demoHistory, gitIn, run, runEnv } from "./helpers.js";

afterAll(cleanup);

/** Every file under `dir` (including .git/info/exclude and .git/hooks/commit-msg) with its hash. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (abs: string, rel: string) => {
    for (const name of readdirSync(abs).sort()) {
      const a = join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      if (r === ".git") continue;
      if (statSync(a).isDirectory()) {
        out.set(`${r}/`, "dir");
        walk(a, r);
      } else out.set(r, createHash("sha1").update(readFileSync(a)).digest("hex"));
    }
  };
  walk(dir, "");
  for (const g of [".git/info/exclude", ".git/hooks/commit-msg"]) {
    const p = join(dir, ...g.split("/"));
    out.set(g, existsSync(p) ? createHash("sha1").update(readFileSync(p)).digest("hex") : "absent");
  }
  return out;
}

const diff = (a: Map<string, string>, b: Map<string, string>) =>
  [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k)).sort();

/** The demo app without its capsules, committed, with a user's own settings and AGENTS.md. */
function freshApp(): string {
  const dir = demoHistory();
  rmSync(join(dir, ".capsules"), { recursive: true, force: true });
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(
    join(dir, ".claude", "settings.local.json"),
    '{\n  "permissions": { "allow": ["Bash(npm test)"] }\n}\n',
  );
  writeFileSync(join(dir, "AGENTS.md"), "# Agents\n\nUse node --test.\n");
  commit(dir, "app without capsules");
  return dir;
}

function hook(dir: string, event: string, input: Record<string, unknown>) {
  const r = spawnSync(process.execPath, [CLI, "hook", event], {
    cwd: dir,
    input: JSON.stringify({ cwd: dir, session_id: "m4b", ...input }),
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("init, doctor, remove (F1 scenario 8)", () => {
  it("leaves the repo byte-identical apart from .capsules/, and fully identical with --all", () => {
    const dir = freshApp();
    const before = snapshot(dir);
    const init = run(
      dir,
      "init",
      "--agents",
      "claude-code,agents-md",
      "--git-hooks",
      "--workflow",
      "--yes",
    );
    expect(init.status).toBe(0);
    expect(init.stdout).toContain("It never touches app code, package.json or build settings.");

    // What init did.
    const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"));
    expect(settings.permissions.allow).toEqual(["Bash(npm test)"]);
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toMatch(/cli\.js" hook pre-edit$/);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("<!-- capsules:begin -->");
    expect(existsSync(join(dir, ".claude", "agents", "capsules-judge.md"))).toBe(true);
    expect(existsSync(join(dir, ".claude", "rules", "capsules-root.md"))).toBe(true);
    expect(readFileSync(join(dir, ".git", "hooks", "commit-msg"), "utf8")).toContain(
      "hook commit-msg",
    );
    expect(run(dir, "check", "--no-run", "--base", "HEAD").stdout).toContain(
      "capsules check: 0 errors",
    );

    const doc = run(dir, "doctor");
    expect(doc.status).toBe(0);
    expect(doc.stdout).toContain("capsules doctor: your app is unaffected by capsules.");
    expect(doc.stdout).toContain(".claude/settings.local.json");

    expect(run(dir, "remove", "--yes").status).toBe(0);
    expect(diff(before, snapshot(dir)).filter((k) => !k.startsWith(".capsules"))).toEqual([]);

    // Again, removing .capsules/ too: nothing at all is left.
    expect(
      run(dir, "init", "--agents", "claude-code,agents-md", "--git-hooks", "--workflow", "--yes")
        .status,
    ).toBe(0);
    expect(run(dir, "remove", "--all", "--yes").status).toBe(0);
    expect(diff(before, snapshot(dir))).toEqual([]);
  });

  it("changes nothing without --yes when it can't ask, or with --dry-run", () => {
    const dir = freshApp();
    const before = snapshot(dir);
    const r = spawnSync(process.execPath, [CLI, "init"], { cwd: dir, input: "", encoding: "utf8" });
    expect(r.status).toBe(64);
    expect(r.stderr).toContain("run the same command with --yes");
    expect(run(dir, "init", "--dry-run").stdout).toContain("Dry run: nothing was changed.");
    expect(diff(before, snapshot(dir))).toEqual([]);
  });

  it("keeps an existing .capsules/ and is safe to run twice", () => {
    const dir = demoHistory();
    const caps = snapshot(join(dir, ".capsules"));
    run(dir, "init", "--yes");
    const second = run(dir, "init", "--yes");
    expect(second.stdout).toContain("keep    .capsules/");
    const settings = readFileSync(join(dir, ".claude", "settings.local.json"), "utf8");
    expect(settings.match(/hook pre-edit/g)).toHaveLength(1);
    const after = snapshot(join(dir, ".capsules"));
    expect(
      diff(caps, after).filter((k) => !k.startsWith("_cache") && k !== "installed.json"),
    ).toEqual([]);
  });

  it("never overwrites a commit-msg hook or file it didn't create", () => {
    const dir = freshApp();
    writeFileSync(join(dir, ".git", "hooks", "commit-msg"), "#!/bin/sh\necho mine\n");
    const r = run(dir, "init", "--git-hooks", "--yes");
    expect(r.stdout).toMatch(/skip +\.git\/hooks\/commit-msg/);
    expect(readFileSync(join(dir, ".git", "hooks", "commit-msg"), "utf8")).toBe(
      "#!/bin/sh\necho mine\n",
    );
  });

  it("doctor runs the app's tests and flags a record that touches app files", () => {
    const dir = demoHistory();
    run(dir, "init", "--yes");
    const ok = run(dir, "doctor");
    expect(ok.stdout).toContain("ok   tests pass: npm test");
    const manifest = JSON.parse(readFileSync(join(dir, ".capsules", "installed.json"), "utf8"));
    manifest.files.push({ path: "package.json", blob: "x" });
    writeFileSync(join(dir, ".capsules", "installed.json"), JSON.stringify(manifest));
    const bad = run(dir, "doctor", "--no-run");
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain("problem  package.json is an app file");
  });

  it("says so when there is nothing to remove", () => {
    const dir = demoHistory();
    expect(run(dir, "remove", "--yes").stdout).toContain("Nothing to remove.");
  });
});

describe("agents can't edit Claude Code's settings (D-026)", () => {
  const dir = demoHistory();
  const settingsFiles = [".claude/settings.json", ".claude/settings.local.json"];

  it.each(settingsFiles)("pre-edit blocks writing %s, even when it doesn't exist yet", (p) => {
    const r = hook(dir, "pre-edit", {
      tool_name: "Write",
      tool_input: { file_path: join(dir, ...p.split("/")), content: "{}" },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("doesn't include edit-config");
    expect(r.stderr).toContain("ask a human owner");
  });

  it("pre-edit blocks removing the hooks from an existing settings file", () => {
    run(dir, "init", "--yes");
    const p = join(dir, ".claude", "settings.local.json");
    const r = hook(dir, "pre-edit", {
      tool_name: "Edit",
      tool_input: { file_path: p, old_string: '"hooks"', new_string: '"hooks_off"' },
    });
    expect(r.status).toBe(2);
  });

  it.each([
    "rm .claude/settings.local.json",
    "echo {} > .claude/settings.json",
    "rm -rf .claude",
    "sed -i s/pre-edit/x/ .claude/settings.local.json",
  ])("pre-bash blocks %s", (command) => {
    const r = hook(dir, "pre-bash", { tool_name: "Bash", tool_input: { command } });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Claude Code's settings, which hold the hooks");
  });

  it("CI reports an agent's commit to .claude/settings.json as E027 (edit-config)", () => {
    const repo = demoHistory();
    mkdirSync(join(repo, ".claude"), { recursive: true });
    writeFileSync(join(repo, ".claude", "settings.json"), "{}\n");
    commit(repo, "turn hooks off", ["Capsule-Agent: default"]);
    const r = runEnv(repo, {}, "check", "--no-run");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("E027");
    expect(r.stdout).toContain("edit-config");
  });
});

describe("capsules context (C16)", () => {
  const dir = demoHistory();

  it("gives a file's home, its rules, inherited rules and concerns", () => {
    const r = run(dir, "context", "src/web/checkout.tsx");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      "# Context for src/web/checkout.tsx (home: web; concerns: payments, pii)",
    );
    expect(r.stdout).toContain("## Inherited from ancestors");
    expect(r.stdout).toContain("root#C1 (contract)");
    expect(r.stdout).toContain("payments#C1 (contract)");
    expect(r.stdout).toContain("rejected: client-side tax calculation");
  });

  it("shrinks the far parts first to fit --budget, never the capsule itself", () => {
    const full = run(dir, "context", "billing").stdout;
    const small = run(dir, "context", "billing", "--budget", "200").stdout;
    expect(small.length).toBeLessThan(full.length);
    expect(small).toContain("billing#C1");
    expect(small).toContain("(left out: over the --budget)");
  });

  it("gives the judge the diff and the contracts that apply to the changed files", () => {
    const p = join(dir, "src", "web", "cart.tsx");
    writeFileSync(p, readFileSync(p, "utf8") + "\n// change\n");
    const r = run(dir, "context", "--for", "judge", "--base", "HEAD", "--json");
    const j = JSON.parse(r.stdout);
    expect(j.contracts.map((c: { address: string }) => c.address)).toContain("web#C1");
    expect(j.diff).toContain("+// change");
    expect(j.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("rejects unknown targets and bad options with a usage error", () => {
    expect(run(dir, "context", "nope").status).toBe(64);
    expect(run(dir, "context").status).toBe(64);
    expect(run(dir, "context", "web", "--budget", "lots").status).toBe(64);
  });
});

describe("capsules verdict (C13)", () => {
  const dir = demoHistory();
  const head = gitIn(dir, "rev-parse", "HEAD").trim();
  const verdict = (results: unknown[]) => ({
    format: "0.1",
    commit: head,
    base: null,
    judge: { agent: "claude-code", subagent: "capsules-judge" },
    results,
  });
  const file = join(dir, "verdict.json");

  it("records a verdict as a Git note and shows it", () => {
    writeFileSync(
      file,
      JSON.stringify(
        verdict([
          {
            contract: "web#C1",
            verdict: "kept",
            reason: "Totals come from the server.",
            evidence: ["src/web/cart.tsx:3"],
          },
        ]),
      ),
    );
    const r = run(dir, "verdict", "record", "--file", "verdict.json");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("1 kept, 0 broken, 0 unsure");
    expect(gitIn(dir, "notes", "--ref=capsules", "show", head)).toContain('"web#C1"');
    const show = run(dir, "verdict", "show");
    expect(show.stdout).toContain("kept   web#C1: Totals come from the server.");
    expect(show.stdout).toContain("Verdicts are advice");
  });

  it("rejects a verdict that doesn't match the format or names unknown rules", () => {
    writeFileSync(
      file,
      JSON.stringify(verdict([{ contract: "web#C1", verdict: "fine", reason: "", evidence: [] }])),
    );
    expect(run(dir, "verdict", "record", "--file", "verdict.json").status).toBe(64);
    writeFileSync(
      file,
      JSON.stringify(verdict([{ contract: "web#C9", verdict: "kept", reason: "", evidence: [] }])),
    );
    const r = run(dir, "verdict", "record", "--file", "verdict.json");
    expect(r.status).toBe(64);
    expect(r.stderr).toContain("web#C9");
  });
});

describe("capsules codeowners", () => {
  it("prints owner lines for capsules, settings, workflows and check files, once each", () => {
    const dir = demoHistory();
    const r = run(dir, "codeowners");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("/.capsules/ @parthjatia");
    expect(r.stdout).toContain("/.claude/settings.json @parthjatia");
    expect(r.stdout).toContain("/tests/invoices/duplicates.test.js @parthjatia");
    expect(r.stdout.match(/^\/tests\/\*\* /gm)).toHaveLength(1);
  });
});
