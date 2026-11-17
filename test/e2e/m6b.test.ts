// M6b: the gentle-mode gap from the PR #9 test review (D-040), and the 45-second demo folder.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
