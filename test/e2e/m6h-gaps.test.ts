// M6h: paths the coverage report showed no test reached. Each one is a way an agent could
// change a test, so each gets its own test here.
import { spawnSync } from "node:child_process";
import { readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CLI, cleanup, commit, demoHistory, gitIn } from "./helpers.js";

afterAll(cleanup);

const clean = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ["CAPSULES_SESSION", "CLAUDECODE", "CLAUDE_ENV_FILE", "GITHUB_ACTIONS"])
    delete env[k];
  env.CAPSULES_TODAY = "2026-11-17";
  return env;
};
const cli = (dir: string, ...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: "utf8", env: clean() });
const hook = (dir: string, session: string, tool: string, file: string, ti: object) =>
  spawnSync(process.execPath, [CLI, "hook", "pre-edit"], {
    cwd: dir,
    input: JSON.stringify({
      cwd: dir,
      hook_event_name: "PreToolUse",
      session_id: session,
      tool_name: tool,
      tool_input: { file_path: join(dir, ...file.split("/")), ...ti },
    }),
    encoding: "utf8",
    env: clean(),
  });

const REFUNDS = "tests/invoices/refunds.test.js";
const ASSERT = "  assert.throws(() => refund(invoice, 901), /exceeds/);\n";

describe("MultiEdit on an existing test (C11)", () => {
  it("removing an assertion with MultiEdit is blocked like Edit (E027)", () => {
    const dir = demoHistory();
    const r = hook(dir, "me1", "MultiEdit", REFUNDS, {
      edits: [
        { old_string: "a refund never", new_string: "a refund should never" },
        { old_string: ASSERT, new_string: "" },
      ],
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("(E027)");
    expect(r.stderr).toContain(REFUNDS);
  });

  it("MultiEdit that only adds lines to an existing test is allowed (add-checks)", () => {
    const dir = demoHistory();
    const r = hook(dir, "me2", "MultiEdit", REFUNDS, {
      edits: [
        {
          old_string: ASSERT,
          new_string: ASSERT + "  assert.throws(() => refund(invoice, 1000), /exceeds/);\n",
        },
      ],
    });
    expect(r.status).toBe(0);
  });

  it("a MultiEdit whose text isn't in the file can't be simulated, and a test file is still protected", () => {
    const dir = demoHistory();
    const r = hook(dir, "me3", "MultiEdit", REFUNDS, {
      edits: [{ old_string: "text that is not there", new_string: "" }],
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("(E027)");
  });
});

describe("a test created in this session (D-024)", () => {
  it("may be written, then changed again, in the same session", () => {
    const dir = demoHistory();
    const NEW = "tests/invoices/partial.test.js";
    const body =
      'import assert from "node:assert/strict";\nimport { test } from "node:test";\n' +
      'test("partial", () => {\n  assert.equal(1, 1);\n  assert.equal(2, 2);\n});\n';
    const w = hook(dir, "new1", "Write", NEW, { content: body });
    expect(w.status).toBe(0);
    writeFileSync(join(dir, ...NEW.split("/")), body); // the tool ran
    // Removing an assertion from it is fine: it isn't an existing check yet.
    const e = hook(dir, "new1", "Edit", NEW, {
      old_string: "  assert.equal(2, 2);\n",
      new_string: "",
    });
    expect(e.status).toBe(0);
    // A different session sees a file that exists, so it is protected there.
    const other = hook(dir, "new2", "Edit", NEW, {
      old_string: "  assert.equal(2, 2);\n",
      new_string: "",
    });
    expect(other.status).toBe(2);
  });
});

describe("one-rule.new-checks-with-code: block, in the hooks (C4, C6.2)", () => {
  it("after a new test for invoices, the same session may not change invoice code (E028)", () => {
    const dir = demoHistory();
    const cfg = join(dir, ".capsules", "config.yaml");
    const text = readFileSync(cfg, "utf8");
    expect(text).toContain("new-checks-with-code: allow");
    writeFileSync(cfg, text.replace("new-checks-with-code: allow", "new-checks-with-code: block"));
    commit(dir, "block new checks with code"); // Parth
    gitIn(dir, "branch", "-f", "main");

    const NEW = "tests/invoices/partial.test.js";
    expect(hook(dir, "nc1", "Write", NEW, { content: "test\n" }).status).toBe(0);
    writeFileSync(join(dir, ...NEW.split("/")), "test\n");
    const code = hook(dir, "nc1", "Edit", "src/billing/invoices/refund.js", {
      old_string: "export",
      new_string: "export",
    });
    expect(code.status).toBe(2);
    expect(code.stderr).toContain("(E028)");
    expect(code.stderr).toContain("new-checks-with-code is block");
    // With the default (allow), the same steps are fine.
    const d2 = demoHistory();
    expect(hook(d2, "nc2", "Write", NEW, { content: "test\n" }).status).toBe(0);
    writeFileSync(join(d2, ...NEW.split("/")), "test\n");
    expect(
      hook(d2, "nc2", "Edit", "src/billing/invoices/refund.js", {
        old_string: "export",
        new_string: "export",
      }).status,
    ).toBe(0);
  });
});

describe("assumption tripwires (C2.3)", () => {
  it("a tripwire that points at something other than a check is E006", () => {
    const dir = demoHistory();
    const f = join(dir, ".capsules", "billing", "invoices.md");
    const text = readFileSync(f, "utf8");
    expect(text).toContain("review-by: 2027-06-01");
    writeFileSync(f, text.replace("review-by: 2027-06-01", "tripwire: @C1\nreview-by: 2027-06-01"));
    const r = cli(dir, "check", "--no-run");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/E006[\s\S]*tripwire/);
    // Pointing it at a real check is fine.
    writeFileSync(
      f,
      text.replace("review-by: 2027-06-01", "tripwire: @refunds\nreview-by: 2027-06-01"),
    );
    expect(cli(dir, "lock").status).toBe(0);
    expect(cli(dir, "check", "--no-run").stdout).not.toContain("E006");
  });
});

/** The edit hook with an exact file_path and raw stdin text. */
const rawHook = (dir: string, input: string) =>
  spawnSync(process.execPath, [CLI, "hook", "pre-edit"], {
    cwd: dir,
    input,
    encoding: "utf8",
    env: clean(),
  });
const removeAssert = (dir: string, session: string, filePath: string) =>
  JSON.stringify({
    cwd: dir,
    hook_event_name: "PreToolUse",
    session_id: session,
    tool_name: "Edit",
    tool_input: { file_path: filePath, old_string: ASSERT, new_string: "" },
  });

describe("other names for the same test file (M6h red-team findings)", () => {
  it("a Windows short (8.3) path to a test is judged as that test", () => {
    if (process.platform !== "win32") return;
    const dir = demoHistory();
    // Verbatim, or Node escapes the quotes and cmd prints a mangled path.
    const r = spawnSync("cmd.exe", ["/d", "/s", "/c", `"for %I in ("${dir}") do @echo %~sI"`], {
      encoding: "utf8",
      windowsVerbatimArguments: true,
    });
    const short = r.stdout.trim();
    if (!short || short.toLowerCase() === dir.toLowerCase()) return; // 8.3 names are off here
    const h = rawHook(
      dir,
      removeAssert(dir, "sp", join(short, "tests", "invoices", "refunds.test.js")),
    );
    expect(h.status).toBe(2);
    expect(h.stderr).toContain("(E027)");
  });

  it("a symlink with a code-like name that points at a test is judged as the test", () => {
    const dir = demoHistory();
    const link = join(dir, "src", "billing", "helper.js");
    try {
      symlinkSync(join(dir, "tests", "invoices", "refunds.test.js"), link);
    } catch {
      return; // Windows without symlink rights
    }
    const h = rawHook(dir, removeAssert(dir, "ln", link));
    expect(h.status).toBe(2);
    expect(h.stderr).toContain("(E027)");
  });

  it("hook input that starts with a byte-order mark is read, not a crash that lets the edit through", () => {
    const dir = demoHistory();
    const h = rawHook(
      dir,
      "﻿" + removeAssert(dir, "bom", join(dir, "tests", "invoices", "refunds.test.js")),
    );
    expect(h.stderr).not.toContain("hook failed");
    expect(h.status).toBe(2);
  });
});

describe("a YAML alias bomb in a capsule (M6h security scan)", () => {
  // A few lines that would expand to 9^10 values. The yaml library refuses it by throwing.
  const bomb = () => {
    let y = '---\ntitle: T\na0: &a0 ["x","x","x","x","x","x","x","x","x"]\n';
    for (let i = 1; i < 10; i++)
      y += `a${i}: &a${i} [${Array(9)
        .fill(`*a${i - 1}`)
        .join(",")}]\n`;
    return y + "---\n\n# T\n";
  };

  it("is reported as E008 by check, not a crash", () => {
    const dir = demoHistory();
    writeFileSync(join(dir, ".capsules", "web.md"), bomb());
    const r = cli(dir, "check", "--no-run");
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/E008[\s\S]*can't be read/);
    expect(r.stderr).not.toContain("internal error");
  });

  it("doesn't crash the edit hook, so a test edit is still blocked", () => {
    const dir = demoHistory();
    writeFileSync(join(dir, ".capsules", "web.md"), bomb());
    const h = rawHook(
      dir,
      removeAssert(dir, "yb", join(dir, "tests", "invoices", "refunds.test.js")),
    );
    expect(h.stderr).not.toContain("hook failed");
    expect(h.status).toBe(2);
    expect(h.stderr).toContain("(E027)");
  });

  it("in config.yaml is E022, not a crash", () => {
    const dir = demoHistory();
    writeFileSync(join(dir, ".capsules", "config.yaml"), bomb().split("---\n")[1]!);
    const r = cli(dir, "check", "--no-run");
    expect(r.stdout).toMatch(/E022[\s\S]*can't be read/);
    expect(r.stderr).not.toContain("internal error");
  });
});
