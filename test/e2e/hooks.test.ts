// M4a end to end: agent hooks fed recorded JSON on stdin, like Claude Code does (C11, F1).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CLI, cleanup, demoHistory, run } from "./helpers.js";

afterAll(cleanup);

const CREATE = "src/billing/invoices/create.js";
const DUP_TEST = "tests/invoices/duplicates.test.js";
const ASSERTION = "  assert.equal(a.id, b.id);\n";

/** Run `capsules hook <event>` with a hook input like Claude Code sends. */
function hook(
  dir: string,
  event: string,
  input: Record<string, unknown>,
  env: Record<string, string> = {},
) {
  const r = spawnSync(process.execPath, [CLI, "hook", event], {
    cwd: dir,
    input: JSON.stringify({ cwd: dir, hook_event_name: "PreToolUse", ...input }),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** An Edit tool call on a project file (absolute path, as Claude Code sends it). */
const editInput = (dir: string, path: string, oldS: string, newS: string, extra = {}) => ({
  tool_name: "Edit",
  tool_input: {
    file_path: join(dir, ...path.split("/")),
    old_string: oldS,
    new_string: newS,
    replace_all: false,
  },
  ...extra,
});

const bash = (command: string, extra = {}) => ({
  tool_name: "Bash",
  tool_input: { command },
  ...extra,
});

describe("hook pre-edit: permissions (C5.2)", () => {
  const dir = demoHistory();

  it("blocks frontend-agent editing a file the payments concern covers (F1 scenario 4)", () => {
    const r = hook(
      dir,
      "pre-edit",
      editInput(dir, "src/web/checkout.tsx", "export", "export", {
        session_id: "s-front",
        agent_type: "frontend-agent",
      }),
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("capsules blocked this change (E027)");
    expect(r.stderr).toContain("frontend-agent is blocked by the payments concern");
    expect(r.stderr).toMatch(/why: +permissions\.yaml/);
  });

  it("allows frontend-agent on a web file no concern blocks", () => {
    const r = hook(
      dir,
      "pre-edit",
      editInput(dir, "src/web/cart.tsx", "export", "export", {
        session_id: "s-front",
        agent_type: "frontend-agent",
      }),
    );
    expect(r.status).toBe(0);
  });

  it("blocks billing-agent outside its scope", () => {
    const r = hook(
      dir,
      "pre-edit",
      editInput(dir, "src/users/store.js", "export", "export", {
        session_id: "s-bill",
        agent_type: "billing-agent",
      }),
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("users is outside the scope of billing-agent");
  });

  it("blocks any agent editing config.yaml or a CI workflow (D-020)", () => {
    const cfg = hook(dir, "pre-edit", {
      session_id: "s-cfg",
      tool_name: "Write",
      tool_input: { file_path: join(dir, ".capsules", "config.yaml"), content: "format: 0.1\n" },
    });
    expect(cfg.status).toBe(2);
    expect(cfg.stderr).toContain("doesn't include edit-config");
    const wf = hook(dir, "pre-edit", {
      session_id: "s-cfg",
      tool_name: "Write",
      tool_input: { file_path: join(dir, ".github", "workflows", "ci.yml"), content: "x" },
    });
    expect(wf.status).toBe(2);
  });

  it("blocks direct edits of the lockfile and generated rule files", () => {
    const lock = hook(
      dir,
      "pre-edit",
      editInput(dir, ".capsules/capsules.lock", "capsule", "capsule", { session_id: "s-x" }),
    );
    expect(lock.status).toBe(2);
    expect(lock.stderr).toContain("only by capsules' own commands");
    const gen = hook(dir, "pre-edit", {
      session_id: "s-x",
      tool_name: "Write",
      tool_input: { file_path: join(dir, ".claude", "rules", "capsules-web.md"), content: "x" },
    });
    expect(gen.status).toBe(2);
    expect(gen.stderr).toContain("(E011)");
  });

  it("blocks editing an existing decision (E009) and points to supersedes", () => {
    const r = hook(
      dir,
      "pre-edit",
      editInput(
        dir,
        ".capsules/billing/invoices.md",
        "Use an idempotency key per customer and period",
        "Use a ledger",
        { session_id: "s-dec" },
      ),
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("(E009)");
    expect(r.stderr).toContain("supersedes");
  });

  it("allows a contract change but tells the user an owner must approve it (W108)", () => {
    const r = hook(
      dir,
      "pre-edit",
      editInput(
        dir,
        ".capsules/billing/invoices.md",
        "Never create two invoices for the same customer and period.",
        "Never create two invoices for one customer and period.",
        { session_id: "s-prop", agent_type: "capsules-drafter" },
      ),
    );
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).systemMessage).toContain("W108");
  });

  it("allows edits outside the project and ignores unknown tools", () => {
    expect(
      hook(dir, "pre-edit", {
        tool_name: "Write",
        tool_input: { file_path: join(dir, "..", "x.txt"), content: "" },
      }).status,
    ).toBe(0);
    expect(hook(dir, "pre-edit", { tool_name: "Read", tool_input: {} }).status).toBe(0);
  });
});

describe("hook pre-edit: the one rule within a session (C6.2, D-024)", () => {
  const dir = demoHistory();

  it("blocks weakening a test after changing the code it judges, in the same session", () => {
    const code = hook(
      dir,
      "pre-edit",
      editInput(dir, CREATE, "if (existing) return existing;", "if (existing) return existing; ", {
        session_id: "s-v1",
      }),
    );
    expect(code.status).toBe(0);
    const test = hook(
      dir,
      "pre-edit",
      editInput(dir, DUP_TEST, ASSERTION, "", { session_id: "s-v1" }),
    );
    expect(test.status).toBe(2);
    expect(test.stderr).toContain("capsules blocked this change (E028)");
    expect(test.stderr).toContain(CREATE);
    expect(test.stderr).toContain("an agent could make a test pass by weakening the test");
  });

  it("allows only adding lines to an existing test in the same session", () => {
    const r = hook(
      dir,
      "pre-edit",
      editInput(dir, DUP_TEST, ASSERTION, ASSERTION + "  assert.ok(a);\n", { session_id: "s-v1" }),
    );
    expect(r.status).toBe(0);
  });

  it("blocks the default agent from weakening an existing test at all (E027)", () => {
    const test = hook(
      dir,
      "pre-edit",
      editInput(dir, DUP_TEST, ASSERTION, "", { session_id: "s-v1b" }),
    );
    expect(test.status).toBe(2);
    expect(test.stderr).toContain("doesn't include change-checks");
    expect(test.stderr).toContain("fix the code instead");
  });

  it("lets a fresh session (a different session_id) change the code", () => {
    const r = hook(
      dir,
      "pre-edit",
      editInput(dir, CREATE, "if (existing) return existing;", "if (existing) return existing; ", {
        session_id: "s-other",
      }),
    );
    expect(r.status).toBe(0);
  });
});

describe("hook pre-edit: test-maintainer (D-021)", () => {
  const dir = demoHistory();
  const asMaintainer = { session_id: "s-tm", agent_type: "test-maintainer" };

  it("may change an existing test, flagged for owner approval", () => {
    const r = hook(dir, "pre-edit", editInput(dir, DUP_TEST, ASSERTION, "", asMaintainer));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).systemMessage).toContain("An owner must approve");
  });

  it("may not edit app code", () => {
    const r = hook(
      dir,
      "pre-edit",
      editInput(dir, CREATE, "if (existing) return existing;", "return null;", {
        ...asMaintainer,
        session_id: "s-tm-code",
      }),
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("doesn't include edit-code");
  });

  it("can't change a test in a session where the main agent already changed the code", () => {
    const code = hook(
      dir,
      "pre-edit",
      editInput(dir, CREATE, "if (existing) return existing;", "if (existing) return existing; ", {
        session_id: "s-shared",
      }),
    );
    expect(code.status).toBe(0);
    const test = hook(
      dir,
      "pre-edit",
      editInput(dir, "tests/invoices/refunds.test.js", "import assert", "import  assert", {
        session_id: "s-shared",
        agent_type: "test-maintainer",
      }),
    );
    // refunds.test.js judges billing.invoices too, and the sub-agent shares the session.
    expect(test.status).toBe(2);
    expect(test.stderr).toContain("(E028)");
  });
});

describe("hook pre-edit: capsules work sessions (C8)", () => {
  const dir = demoHistory();

  it("narrows the agent to the session's capsules and adds trailers to commits", () => {
    const w = run(dir, "work", "billing.invoices", "--agent", "billing-agent");
    expect(w.status).toBe(0);
    expect(w.stdout).toContain("Capsule-Agent: billing-agent");
    const id = /Started session ([0-9a-f]+)/.exec(w.stdout)![1]!;

    const out = hook(
      dir,
      "pre-edit",
      editInput(dir, "src/billing/plan.js", "export", "export", { session_id: "c1" }),
    );
    expect(out.status).toBe(2);
    expect(out.stderr).toContain("outside this session's scope (billing.invoices)");
    const inScope = hook(
      dir,
      "pre-edit",
      editInput(dir, CREATE, "if (existing) return existing;", "if (existing) return existing; ", {
        session_id: "c1",
      }),
    );
    expect(inScope.status).toBe(0);

    const msgFile = join(dir, "MSG");
    writeFileSync(msgFile, "Fix invoices\n\n# Please enter the commit message\n");
    const r = spawnSync(process.execPath, [CLI, "hook", "commit-msg", msgFile], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    const msg = readFileSync(msgFile, "utf8");
    expect(msg).toContain(
      `Fix invoices\n\nCapsule-Session: ${id}\nCapsule-Agent: billing-agent\nCapsule-Role: builder\nCapsule-Scope: billing.invoices\n`,
    );
    expect(msg).toContain("# Please enter the commit message");

    expect(run(dir, "work", "--end").stdout).toContain(`Ended session ${id}`);
    expect(existsSync(join(dir, ".capsules", "_cache", "sessions", `${id}.json`))).toBe(false);
  });

  it("rejects an unknown agent with a usage error", () => {
    const r = run(dir, "work", "billing", "--agent", "nobody");
    expect(r.status).toBe(64);
    expect(r.stderr).toContain("nobody is not listed under agents");
  });
});

describe("hook pre-bash (best effort)", () => {
  const dir = demoHistory();

  it.each([
    "sed -i 's/assert/x/' tests/invoices/refunds.test.js",
    "rm tests/invoices/duplicates.test.js",
    "echo x > .capsules/capsules.lock",
    "cat a >> .capsules/billing.md",
    "git checkout -- .capsules/root.md",
    "mv .github/workflows/ci.yml /tmp/x",
  ])("blocks %s", (command) => {
    const r = hook(dir, "pre-bash", bash(command));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("this shell command would change");
    expect(r.stderr).toContain("Edit or Write tool");
  });

  it.each([
    "npm test > out.txt 2>&1",
    "cat tests/invoices/refunds.test.js | grep assert",
    "cp tests/invoices/refunds.test.js /tmp/copy.js",
    "rm -rf .capsules/_cache",
    "node ../../dist/cli.js lock",
    "touch tests/invoices/new.test.js",
  ])("allows %s", (command) => {
    expect(hook(dir, "pre-bash", bash(command)).status).toBe(0);
  });
});

describe("hook stop (report only)", () => {
  it("is silent when all is well, and reports problems as a systemMessage", () => {
    const dir = demoHistory();
    const quiet = hook(dir, "stop", { hook_event_name: "Stop", session_id: "s" });
    expect(quiet.status).toBe(0);
    expect(quiet.stdout).toBe("");
    const p = join(dir, ".capsules", "billing", "invoices.md");
    writeFileSync(p, readFileSync(p, "utf8").replace("## intent I1", "## intent I1\nExtra words."));
    const r = hook(dir, "stop", { hook_event_name: "Stop", session_id: "s" });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).systemMessage).toMatch(
      /capsules: .*lockfile is out of date.*Next: run `capsules lock`/,
    );
  });
});

describe("hook failures never brick the agent (on-error)", () => {
  it("allows the edit with a warning (exit 1) when the input can't be read", () => {
    const dir = demoHistory();
    const r = spawnSync(process.execPath, [CLI, "hook", "pre-edit"], {
      cwd: dir,
      input: "{not json",
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("The change was allowed (hooks.on-error: open)");
  });
  it("does nothing outside a capsules project", () => {
    const r = spawnSync(process.execPath, [CLI, "hook", "pre-edit"], {
      cwd: join(CLI, "..", ".."),
      input: JSON.stringify({
        cwd: "/",
        tool_name: "Write",
        tool_input: { file_path: "/x", content: "" },
      }),
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
  });
});
