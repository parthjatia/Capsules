// M6b: the gentle-mode gap from the PR #9 test review (D-040), and the 45-second demo folder.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, it } from "vitest";
import { CLI, cleanup, commit, demoHistory, gitIn } from "./helpers.js";

afterAll(cleanup);

/** Outside any agent session, outside GitHub Actions, on a fixed day. */
const clean = (extra: Record<string, string> = {}) => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ["CAPSULES_SESSION", "CLAUDECODE", "CLAUDE_ENV_FILE"]) delete env[k];
  for (const k of ["GITHUB_ACTIONS", "GITHUB_EVENT_PATH"]) delete env[k];
  env.CAPSULES_TODAY = "2026-11-17";
  return { ...env, ...extra };
};
const cli = (dir: string, ...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: "utf8", env: clean() });
const hook = (dir: string, event: string, input: object) =>
  spawnSync(process.execPath, [CLI, "hook", event], {
    cwd: dir,
    input: JSON.stringify({ cwd: dir, ...input }),
    encoding: "utf8",
    env: clean(),
  });
const edit = (dir: string, file: string, from: string, to: string) => {
  const p = join(dir, ...file.split("/"));
  const s = readFileSync(p, "utf8");
  expect(s).toContain(from);
  writeFileSync(p, s.replace(from, to));
};

const INVOICES = ".capsules/billing/invoices.md";
const C1_OLD = "Never create two invoices for the same customer and period.";
const C1_NEW = "Never create two invoices for the same customer, period and plan.";

/** The demo in gentle mode, with a drafter limited to the web capsules (an owner's commit). */
function gentleWithWebDrafter(): string {
  const dir = demoHistory();
  edit(
    dir,
    ".capsules/config.yaml",
    "weakened-tests: warn\n",
    "mode: gentle\nweakened-tests: warn\n",
  );
  edit(
    dir,
    ".capsules/permissions.yaml",
    "  test-maintainer:",
    '  web-drafter:      { role: drafter, capsules: ["web", "web.**"] }\n  test-maintainer:',
  );
  commit(dir, "gentle, and a drafter for web"); // Parth, an owner
  gitIn(dir, "branch", "-f", "main");
  return dir;
}

describe("gentle mode keeps owner approval for rule changes (D-040)", () => {
  it("the hook warns W111 and still says an owner must approve (W108)", () => {
    const dir = gentleWithWebDrafter();
    const r = hook(dir, "pre-edit", {
      hook_event_name: "PreToolUse",
      session_id: "wd",
      agent_type: "web-drafter",
      tool_name: "Edit",
      tool_input: {
        file_path: join(dir, ...INVOICES.split("/")),
        old_string: C1_OLD,
        new_string: C1_NEW,
      },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("gentle mode, W111");
    expect(r.stdout).toContain("billing.invoices is outside the scope of web-drafter");
    expect(r.stdout).toContain("An owner must approve this change in the pull request (W108)");
  });

  it("CI reports W111 and W108 for the same commit, and the approval clears W108", () => {
    const dir = gentleWithWebDrafter();
    edit(dir, INVOICES, C1_OLD, C1_NEW);
    expect(cli(dir, "lock").status).toBe(0);
    commit(dir, "rule change outside its scope", [
      "Capsule-Session: s1",
      "Capsule-Agent: web-drafter",
      "Capsule-Role: drafter",
      "Capsule-Scope: web.**",
    ]);
    const ci = cli(dir, "check", "--no-run", "--base", "main");
    expect(ci.stdout).toMatch(/warning W111[\s\S]*web-drafter/);
    expect(ci.stdout).toMatch(/warning W108[\s\S]*billing\.invoices/);
    expect(ci.stdout).not.toContain("error E027");

    // After an owner approves the rule in capsules review, W108 goes; W111 stays (it's the scope).
    cli(dir, "review", "--base", "main");
    const shown = cli(dir, "review", "--base", "main").stdout;
    const id = /(r\d+)\s+Changed contract billing\.invoices#C1/.exec(shown)![1]!;
    expect(cli(dir, "review", "approve", id, "--base", "main").status).toBe(0);
    commit(dir, "approve"); // Parth
    const after = cli(dir, "check", "--no-run", "--base", "main").stdout;
    expect(after).not.toContain("W108");
    expect(after).toContain("W111");
  });

  it("strict mode still blocks the same edit (E027)", () => {
    const dir = gentleWithWebDrafter();
    edit(dir, ".capsules/config.yaml", "mode: gentle\n", "mode: strict\n");
    commit(dir, "strict");
    const r = hook(dir, "pre-edit", {
      hook_event_name: "PreToolUse",
      session_id: "wd",
      agent_type: "web-drafter",
      tool_name: "Edit",
      tool_input: {
        file_path: join(dir, ...INVOICES.split("/")),
        old_string: C1_OLD,
        new_string: C1_NEW,
      },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("(E027)");
    expect(existsSync(join(dir, ".capsules", "_cache", "gentle-log.jsonl"))).toBe(false);
  });
});

const DEMO = join(import.meta.dirname, "..", "..", "scripts", "demo-45s.mjs");

describe("the 45-second demo repo (scripts/demo-45s.mjs)", () => {
  it("prepares a repo where the refund test fails, editing that test is blocked, and capsules runs", () => {
    const out = join(mkdtempSync(join(tmpdir(), "capsules-45s-test-")), "demo");
    const prep = spawnSync(process.execPath, [DEMO, "--out", out, "--json"], {
      encoding: "utf8",
      env: clean(),
    });
    expect(prep.status).toBe(0);
    const { dir, bin, map } = JSON.parse(prep.stdout) as { dir: string; bin: string; map: string };
    expect(dir).toBe(out);
    expect(existsSync(map)).toBe(true);
    // Clean working tree: the bug and the setup are committed, so Claude's changes stand out.
    expect(gitIn(dir, "status", "--porcelain").trim()).toBe("");
    // The bug is real: the refund test fails.
    const test = spawnSync(process.execPath, ["--test", "tests/invoices/refunds.test.js"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(test.status).not.toBe(0);
    // ...because of the injected bug: with the commit before it, the same test passes.
    const REFUND = "src/billing/invoices/refund.js";
    gitIn(dir, "checkout", "HEAD~1", "--", REFUND);
    const before = spawnSync(process.execPath, ["--test", "tests/invoices/refunds.test.js"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(before.status).toBe(0);
    gitIn(dir, "checkout", "HEAD", "--", REFUND);
    // The hooks are installed, and block "make it pass by editing the test", with a next step.
    const settings = readFileSync(join(dir, ".claude", "settings.local.json"), "utf8");
    expect(settings).toContain("hook pre-edit");
    expect(settings).toContain("hook session-start");
    const r = hook(dir, "pre-edit", {
      hook_event_name: "PreToolUse",
      session_id: "demo",
      tool_name: "Edit",
      tool_input: {
        file_path: join(dir, "tests", "invoices", "refunds.test.js"),
        old_string: "assert",
        new_string: "// assert",
      },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("(E027)");
    expect(r.stderr).toContain("next:    don't try another way around this block");
    // The demo's own `capsules` command works for Claude's shell, with nothing installed globally.
    const shim =
      process.platform === "win32"
        ? spawnSync("cmd.exe", ["/d", "/c", join(bin, "capsules.cmd"), "--version"], {
            cwd: dir,
            encoding: "utf8",
          })
        : spawnSync("sh", [join(bin, "capsules"), "--version"], { cwd: dir, encoding: "utf8" });
    expect(shim.status).toBe(0);
    expect(shim.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    // A second run into the same folder is refused rather than mixing two demos.
    const again = spawnSync(process.execPath, [DEMO, "--out", out], {
      encoding: "utf8",
      env: clean(),
    });
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("is not empty");
    rmSync(dirname(out), { recursive: true, force: true });
  });
});

describe("gentle mode, a blocked-by concern: W111 and W108 too (D-040)", () => {
  // A capsule file has no concerns of its own, so blocked-by applies to app and test files.
  // The case that needs an owner: a test maintainer barred from payments changes a payments test.
  it("a maintainer barred from payments may change a payments test in gentle mode, flagged for an owner", () => {
    const dir = demoHistory();
    edit(
      dir,
      ".capsules/config.yaml",
      "weakened-tests: warn\n",
      "mode: gentle\nweakened-tests: warn\n",
    );
    edit(
      dir,
      ".capsules/permissions.yaml",
      "  test-maintainer:",
      '  ui-maintainer:    { role: maintainer, capsules: ["**"], blocked-by: [payments] }\n  test-maintainer:',
    );
    // The payments concern also covers its own tests here (in the demo they only have a home).
    edit(
      dir,
      ".capsules/_concerns/payments.md",
      "  - src/billing/**\n",
      "  - src/billing/**\n  - tests/payments/**\n",
    );
    expect(cli(dir, "lock").status).toBe(0);
    commit(dir, "gentle, and a maintainer barred from payments"); // Parth
    gitIn(dir, "branch", "-f", "main");
    const input = {
      hook_event_name: "PreToolUse",
      session_id: "ui-pay",
      agent_type: "ui-maintainer",
      tool_name: "Edit",
      tool_input: {
        file_path: join(dir, "tests", "payments", "double-charge.test.js"),
        old_string: "paying twice for one checkout charges once",
        new_string: "paying twice for one checkout charges exactly once",
      },
    };
    const r = hook(dir, "pre-edit", input);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("gentle mode, W111");
    expect(r.stdout).toContain("ui-maintainer is blocked by the payments concern");
    expect(r.stdout).toContain("An owner must approve this change in the pull request (W108)");
    // Strict mode blocks the same edit.
    edit(dir, ".capsules/config.yaml", "mode: gentle\n", "mode: strict\n");
    commit(dir, "strict");
    const s2 = hook(dir, "pre-edit", { ...input, session_id: "ui-pay-2" });
    expect(s2.status).toBe(2);
    expect(s2.stderr).toContain("ui-maintainer is blocked by the payments concern");
  });
});
