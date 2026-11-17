// M3 end to end: the guard in CI. Real temporary Git repos with scripted commits (F1).
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanup, commit, demoHistory, gitIn, run, runEnv } from "./helpers.js";

afterAll(cleanup);

const INVOICES = ".capsules/billing/invoices.md";
const CREATE = "src/billing/invoices/create.js";
const DUP_TEST = "tests/invoices/duplicates.test.js";
const UNKNOWN = "someone@example.com";

function edit(dir: string, path: string, from: string, to: string) {
  const p = join(dir, ...path.split("/"));
  const text = readFileSync(p, "utf8");
  if (!text.includes(from)) throw new Error(`${path} does not contain ${from}`);
  writeFileSync(p, text.replace(from, to));
}

/** A change to the invoice code, and the assertion that would have caught it. */
const breakCode = (dir: string) =>
  edit(
    dir,
    CREATE,
    "if (existing) return existing;",
    'if (existing && period !== "2026-03") return existing;',
  );
const removeAssertion = (dir: string) => edit(dir, DUP_TEST, "  assert.equal(a.id, b.id);\n", "");

interface Diag {
  code: string;
  severity: string;
  message: string;
  file?: string;
  line?: number;
}
interface CheckJson {
  status: number | null;
  diagnostics: Diag[];
  checks: { address: string; status: string }[];
  unreviewedChecks: string[];
}
const check = (dir: string, ...args: string[]): CheckJson => {
  const r = run(dir, "check", "--json", ...args);
  return { status: r.status, ...(JSON.parse(r.stdout) as Omit<CheckJson, "status">) };
};
/** Codes found, ignoring the demo's intentional orphan (W101). */
const codes = (dir: string, ...args: string[]) =>
  check(dir, "--no-run", ...args)
    .diagnostics.filter((d) => d.code !== "W101")
    .map((d) => `${d.severity === "error" ? "E" : "W"}:${d.code}`);

describe("the one rule, V1 (F1 scenario 1)", () => {
  it("code and an assertion removed from its existing test in one commit is E028, with the C6.2 message", () => {
    const dir = demoHistory();
    breakCode(dir);
    removeAssertion(dir);
    commit(dir, "Fix invoices");
    const r = run(dir, "check", "--no-run");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      [
        "error E028  One change touched both code and an existing check that judges it.",
        "  capsules: billing.invoices, payments",
      ].join("\n"),
    );
    expect(r.stdout).toMatch(/ {2}change: {2}commit [0-9a-f]{7} "Fix invoices"\n/);
    expect(r.stdout).toContain(
      `  code:    ${CREATE}\n  check:   ${DUP_TEST} (existing test, 1 assertion removed)`,
    );
    expect(r.stdout).toContain("why:  an agent could make a test pass by weakening the test.");
    expect(r.stdout).toContain(
      "fix:  put the test change in its own commit from a separate session",
    );
    expect(r.stdout).toContain(
      "base:      main (the local main branch, as there is no remote), merge base ",
    );
    expect(codes(dir)).toEqual(["E:E028", "W:W107"]);
  });

  it("the same change left uncommitted is also E028", () => {
    const dir = demoHistory();
    breakCode(dir);
    removeAssertion(dir);
    expect(codes(dir)).toEqual(["E:E028", "W:W107"]);
    expect(run(dir, "check", "--no-run").stdout).toContain("  change:  uncommitted changes\n");
  });

  it("code and its test in separate commits without trailers: the whole-PR unit finds it (a warning in solo mode)", () => {
    const dir = demoHistory();
    breakCode(dir);
    commit(dir, "Fix invoices");
    removeAssertion(dir);
    commit(dir, "Tidy test");
    const r = check(dir, "--no-run");
    const e028 = r.diagnostics.filter((d) => d.code === "E028");
    expect(e028).toHaveLength(1);
    expect(e028[0]!.severity).toBe("warning");
    expect(e028[0]!.message).toContain("all 2 commits without a Capsule-Session trailer, together");
    expect(r.status).toBe(0);
  });

  it("... and an error when solo is off", () => {
    const dir = demoHistory();
    edit(dir, ".capsules/permissions.yaml", "solo: true", "solo: false");
    commit(dir, "Turn solo off");
    breakCode(dir);
    commit(dir, "Fix invoices");
    removeAssertion(dir);
    commit(dir, "Tidy test");
    expect(codes(dir)).toContain("E:E028");
  });

  it("code and its test in two commits of the same session is an error, even in solo mode", () => {
    const dir = demoHistory();
    const session = ["Capsule-Session: 7f3c0000", "Capsule-Agent: billing-agent"];
    breakCode(dir);
    commit(dir, "Fix invoices", session);
    removeAssertion(dir);
    commit(dir, "Tidy test", session);
    const r = check(dir, "--no-run");
    const e028 = r.diagnostics.filter((d) => d.code === "E028");
    expect(e028.map((d) => d.severity)).toEqual(["error"]);
    expect(e028[0]!.message).toContain("session 7f3c0000 (2 commits)");
  });

  it("adding a new test alongside code is fine, and listed as unreviewed", () => {
    const dir = demoHistory();
    breakCode(dir);
    writeFileSync(join(dir, "tests", "invoices", "periods.test.js"), "// new test\n");
    edit(
      dir,
      DUP_TEST,
      "beforeEach(() => resetInvoices());\n",
      "beforeEach(() => resetInvoices());\n// more\n",
    );
    commit(dir, "Fix invoices, add tests");
    const r = check(dir, "--no-run");
    expect(r.diagnostics.map((d) => d.code)).not.toContain("E028");
    expect(r.unreviewedChecks).toEqual([
      `${DUP_TEST} (lines added)`,
      "tests/invoices/periods.test.js",
    ]);
    expect(run(dir, "check", "--no-run").stdout).toContain(
      "unreviewed new checks: added together with the code they judge.",
    );
  });

  it("one-rule.new-checks-with-code: block makes a new test alongside code a violation", () => {
    const dir = demoHistory();
    edit(
      dir,
      ".capsules/config.yaml",
      "new-checks-with-code: allow",
      "new-checks-with-code: block",
    );
    commit(dir, "Stricter");
    breakCode(dir);
    writeFileSync(join(dir, "tests", "invoices", "periods.test.js"), "// new test\n");
    commit(dir, "Fix invoices, add a test");
    expect(run(dir, "check", "--no-run").stdout).toContain(
      "tests/invoices/periods.test.js (new test)",
    );
  });

  it("a test change without code is not a violation (W107 still flags it)", () => {
    const dir = demoHistory();
    removeAssertion(dir);
    commit(dir, "Tidy test");
    expect(codes(dir)).toEqual(["W:W107"]);
  });

  it("findings in a draft capsule are warnings", () => {
    const dir = demoHistory();
    edit(dir, INVOICES, "status: active", "status: draft");
    edit(
      dir,
      ".capsules/_concerns/payments.md",
      "title: Payments",
      "title: Payments\nstatus: draft",
    );
    run(dir, "lock");
    commit(dir, "Drafts");
    breakCode(dir);
    removeAssertion(dir);
    commit(dir, "Fix invoices");
    expect(check(dir, "--no-run").diagnostics.find((d) => d.code === "E028")!.severity).toBe(
      "warning",
    );
  });
});

describe("the one rule, V2 (F1 scenario 2)", () => {
  it("a contract and the intent it serves changed in one commit is E029", () => {
    const dir = demoHistory();
    edit(
      dir,
      INVOICES,
      "charged exactly once per billing period",
      "charged at most twice per billing period",
    );
    edit(dir, INVOICES, "Never create two invoices", "Never create three invoices");
    run(dir, "lock");
    commit(dir, "Relax invoices");
    const r = run(dir, "check", "--no-run");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      "error E029  One change touched both a rule and the intent it serves.\n  capsule: billing.invoices",
    );
    expect(r.stdout).toContain("  rule:    billing.invoices#C1\n  intent:  billing.invoices#I1");
  });

  it("the intent and the contract in separate commits is fine", () => {
    const dir = demoHistory();
    edit(
      dir,
      INVOICES,
      "charged exactly once per billing period",
      "charged at most twice per billing period",
    );
    run(dir, "lock");
    commit(dir, "Intent");
    edit(dir, INVOICES, "Never create two invoices", "Never create three invoices");
    run(dir, "lock");
    commit(dir, "Contract");
    // Separate human commits are fine; the whole-PR unit flags them only as a warning (solo).
    const e029 = check(dir, "--no-run").diagnostics.filter((d) => d.code === "E029");
    expect(e029.map((d) => d.severity)).toEqual(["warning"]);
  });
});

describe("append-only decisions (F1 scenario 6)", () => {
  it("editing an existing decision is E009", () => {
    const dir = demoHistory();
    edit(dir, INVOICES, "Use an idempotency key per customer", "Use a random key per customer");
    run(dir, "lock");
    commit(dir, "Reword D7");
    const e009 = check(dir, "--no-run").diagnostics.filter((d) => d.code === "E009");
    expect(e009).toHaveLength(1);
    expect(e009[0]).toMatchObject({ file: INVOICES, line: 44, severity: "error" });
    expect(e009[0]!.message).toBe(
      "Decision billing.invoices#D7 was edited. Decisions are append-only.",
    );
  });

  it("deleting a decision is E009; adding one that supersedes it is fine", () => {
    const dir = demoHistory();
    edit(dir, INVOICES, "## decision D3 serves @C1\nBuild our own invoice ledger.\n\n", "");
    edit(dir, INVOICES, " supersedes @D3", "");
    run(dir, "lock");
    commit(dir, "Drop D3");
    expect(codes(dir)).toContain("E:E009");

    const ok = demoHistory();
    edit(
      ok,
      INVOICES,
      "## context idempotency",
      "## decision D8 serves @C1 supersedes @D7\nUse Stripe keys.\n\n## context idempotency",
    );
    run(ok, "lock");
    commit(ok, "Add D8");
    expect(codes(ok)).not.toContain("E:E009");
  });
});

describe("weakened-test signals (F1 scenario 5, C9.2)", () => {
  it("an added skip marker is W107, naming the file, line and pattern", () => {
    const dir = demoHistory();
    edit(dir, DUP_TEST, 'test("different periods', 'test.skip("different periods');
    commit(dir, "Skip a test");
    const w = check(dir, "--no-run").diagnostics.filter((d) => d.code === "W107");
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ file: DUP_TEST, line: 14 });
    expect(w[0]!.message).toContain('1 skip marker added (first at line 14, pattern ".skip(")');
  });

  it("a deleted test file and a changed run: command are W107", () => {
    const dir = demoHistory();
    rmSync(join(dir, "tests", "invoices", "refunds.test.js"));
    edit(dir, INVOICES, "run: node --test tests/invoices/duplicates.test.js", "run: echo ok");
    run(dir, "lock");
    commit(dir, "Simplify");
    const msgs = check(dir, "--no-run")
      .diagnostics.filter((d) => d.code === "W107")
      .map((d) => d.message);
    expect(msgs).toEqual([
      'Weakened-test signal in .capsules/billing/invoices.md: the run command of check billing.invoices#no-duplicates changed (was "node --test tests/invoices/duplicates.test.js").',
      "Weakened-test signal in tests/invoices/refunds.test.js: the test file was deleted.",
    ]);
  });

  it("weakened-tests: block makes them errors; off hides them", () => {
    const dir = demoHistory();
    edit(dir, ".capsules/config.yaml", "weakened-tests: warn", "weakened-tests: block");
    commit(dir, "Block");
    removeAssertion(dir);
    expect(codes(dir)).toEqual(["E:W107"]);
    edit(dir, ".capsules/config.yaml", "weakened-tests: block", "weakened-tests: off");
    expect(codes(dir)).toEqual([]);
  });
});

describe("permissions via trailers (C5.2, C5.3)", () => {
  it("frontend-agent editing a payments file is E027 (blocked-by)", () => {
    const dir = demoHistory();
    edit(dir, "src/web/checkout.tsx", "\n", "\n// tweak\n");
    commit(dir, "Tweak checkout", ["Capsule-Agent: frontend-agent"]);
    const e = check(dir, "--no-run").diagnostics.filter((d) => d.code === "E027");
    expect(e).toHaveLength(1);
    expect(e[0]!.message).toContain(
      "by agent frontend-agent: edit-code in web is not allowed (frontend-agent is blocked by the payments concern)",
    );
  });

  it("an agent outside its scope, and an unknown agent, are E027", () => {
    const dir = demoHistory();
    edit(dir, "src/web/cart.tsx", "\n", "\n// tweak\n");
    commit(dir, "Tweak cart", ["Capsule-Agent: billing-agent"]);
    edit(dir, "src/users/store.js", "\n", "\n// tweak\n");
    commit(dir, "Tweak users", ["Capsule-Agent: mystery-agent"]);
    const msgs = check(dir, "--no-run")
      .diagnostics.filter((d) => d.code === "E027")
      .map((d) => d.message);
    expect(msgs.some((m) => m.includes("web is outside the scope of billing-agent"))).toBe(true);
    expect(
      msgs.some((m) => m.includes("mystery-agent is not listed under agents in permissions.yaml")),
    ).toBe(true);
  });

  it("a builder agent changing an existing test is E027 (change-checks)", () => {
    const dir = demoHistory();
    removeAssertion(dir);
    commit(dir, "Tidy test", ["Capsule-Agent: billing-agent"]);
    expect(check(dir, "--no-run").diagnostics.find((d) => d.code === "E027")!.message).toContain(
      "the builder role of billing-agent doesn't include change-checks",
    );
  });

  it("the drafter proposing a contract needs owner approval (W108); the owner doesn't", () => {
    const dir = demoHistory();
    edit(dir, INVOICES, "A refund never exceeds", "A refund never, ever exceeds");
    run(dir, "lock");
    commit(dir, "Propose", ["Capsule-Agent: capsules-drafter"]);
    const w = check(dir, "--no-run").diagnostics.filter((d) => d.code === "W108");
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toContain(
      "changes billing.invoices, which needs approval from an owner (parth)",
    );
    expect(w[0]!.message).toContain("changed contract billing.invoices#C2");

    const owner = demoHistory();
    edit(owner, INVOICES, "A refund never exceeds", "A refund never, ever exceeds");
    run(owner, "lock");
    commit(owner, "Owner edit");
    expect(codes(owner)).toEqual([]);
  });

  it("an author not in permissions.yaml acts as default, which can't change contracts", () => {
    const dir = demoHistory();
    edit(dir, INVOICES, "A refund never exceeds", "A refund never, ever exceeds");
    run(dir, "lock");
    commit(dir, "Edit", [], UNKNOWN);
    const e = check(dir, "--no-run").diagnostics.find((d) => d.code === "E027")!;
    expect(e.message).toContain(
      `by ${UNKNOWN} (not in permissions.yaml, so acts as default): propose-contracts`,
    );
    expect(e.message).toContain("changed: changed contract billing.invoices#C2");
  });

  it("an email in the emails list identifies the human", () => {
    const dir = demoHistory();
    edit(dir, ".capsules/permissions.yaml", "emails: []", `emails: ["${UNKNOWN.toUpperCase()}"]`);
    commit(dir, "Add email");
    edit(dir, INVOICES, "A refund never exceeds", "A refund never, ever exceeds");
    run(dir, "lock");
    commit(dir, "Edit", [], UNKNOWN);
    expect(codes(dir)).toEqual([]);
  });
});

describe("CI workflows and config.yaml are owners only (D-020)", () => {
  const WORKFLOW = ".github/workflows/ci.yml";
  const withWorkflow = () => {
    const dir = demoHistory();
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    writeFileSync(join(dir, ...WORKFLOW.split("/")), "steps:\n  - run: capsules check --ci\n");
    commit(dir, "Add CI");
    return dir;
  };
  const dropGuard = (dir: string) =>
    edit(dir, WORKFLOW, "  - run: capsules check --ci\n", "  - run: echo skipped\n");

  it("an agent editing a workflow is blocked (E027, edit-config)", () => {
    const dir = withWorkflow();
    dropGuard(dir);
    commit(dir, "Speed up CI", ["Capsule-Agent: billing-agent"]);
    const e = check(dir, "--no-run").diagnostics.filter((d) => d.code === "E027");
    expect(e).toHaveLength(1);
    expect(e[0]!.severity).toBe("error");
    expect(e[0]!.message).toContain(
      "by agent billing-agent: edit-config in root is not allowed (the builder role of billing-agent doesn't include edit-config)",
    );
    expect(e[0]!.message).toContain(`changed: ${WORKFLOW}`);
  });

  it("someone who isn't an owner editing a workflow is blocked too", () => {
    const dir = withWorkflow();
    dropGuard(dir);
    commit(dir, "Speed up CI", [], UNKNOWN);
    expect(codes(dir)).toEqual(["E:E027"]);
  });

  it("an agent editing config.yaml is blocked", () => {
    const dir = demoHistory();
    edit(dir, ".capsules/config.yaml", "weakened-tests: warn", "weakened-tests: off");
    commit(dir, "Quieter", ["Capsule-Agent: billing-agent"]);
    expect(codes(dir)).toEqual(["E:E027"]);
  });

  it("an owner's own commit to a workflow passes", () => {
    const dir = withWorkflow();
    dropGuard(dir);
    commit(dir, "Speed up CI");
    expect(codes(dir)).toEqual([]);
  });

  it("other ignored files (docs/**) stay outside the guard", () => {
    const dir = demoHistory();
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "notes.md"), "notes\n");
    commit(dir, "Notes", ["Capsule-Agent: billing-agent"]);
    expect(codes(dir)).toEqual([]);
  });
});

describe("Capsule-Cosmetic owner check (E030)", () => {
  const cosmeticCommit = (email?: string) => {
    const dir = demoHistory();
    edit(dir, INVOICES, "same customer and period.", "same customer and  period.");
    run(dir, "relock", "--cosmetic", "billing.invoices#C1");
    commit(dir, "Typo", ["Capsule-Cosmetic: billing.invoices#C1"], email);
    return dir;
  };

  it("an owner may use it", () => {
    expect(codes(cosmeticCommit())).toEqual([]);
  });

  it("someone who doesn't own the capsule may not", () => {
    const dir = cosmeticCommit(UNKNOWN);
    const e = check(dir, "--no-run").diagnostics.find((d) => d.code === "E030")!;
    expect(e.message).toMatch(
      /^commit [0-9a-f]{7} "Typo" carries "Capsule-Cosmetic: billing.invoices#C1", but someone@example.com/,
    );
  });

  it("in GitHub Actions, the pull request author is who counts (event file, D-016)", () => {
    const dir = cosmeticCommit();
    const event = join(dir, ".git", "event.json");
    const base = gitIn(dir, "rev-parse", "main").trim();
    writeFileSync(
      event,
      JSON.stringify({
        pull_request: { base: { sha: base, ref: "main" }, user: { login: "someone-else" } },
      }),
    );
    const env = { GITHUB_ACTIONS: "true", GITHUB_EVENT_PATH: event };
    const r = JSON.parse(runEnv(dir, env, "check", "--no-run", "--json").stdout);
    expect(r.base.how).toBe("the pull request's base (GitHub Actions event file)");
    expect(r.diagnostics.find((d: Diag) => d.code === "E030").message).toContain(
      "the pull request author (someone-else) doesn't own billing.invoices",
    );
    writeFileSync(
      event,
      JSON.stringify({
        pull_request: { base: { sha: base, ref: "main" }, user: { login: "ParthJatia" } },
      }),
    );
    expect(
      JSON.parse(runEnv(dir, env, "check", "--no-run", "--json").stdout).diagnostics.map(
        (d: Diag) => d.code,
      ),
    ).toEqual(["W101"]);
  });

  it("an address that names no node is E003", () => {
    const dir = demoHistory();
    writeFileSync(join(dir, "notes.txt"), "x\n");
    commit(dir, "Typo", ["Capsule-Cosmetic: billing.invoices#C9"]);
    expect(check(dir, "--no-run").diagnostics.find((d) => d.code === "E003")!.message).toContain(
      "Capsule-Cosmetic trailer",
    );
  });
});

describe("the base and running checks (C6.4, C9.1)", () => {
  it("--base with a ref that doesn't exist is a usage error", () => {
    const r = run(demoHistory(), "check", "--base", "nope");
    expect(r.status).toBe(64);
    expect(r.stderr).toContain("--base nope doesn't name a commit");
  });

  it("runs the checks of affected capsules only, and records the results", () => {
    const dir = demoHistory();
    edit(dir, "src/users/store.js", "\n", "\n// tweak\n");
    commit(dir, "Tweak users");
    const r = check(dir);
    expect(r.checks.map((c) => `${c.status} ${c.address}`)).toEqual([
      "pass pii#no-pii-logs",
      "pass root#all-tests",
    ]);
    const cached = JSON.parse(
      readFileSync(join(dir, ".capsules", "_cache", "last-check.json"), "utf8"),
    );
    expect(cached.results).toHaveLength(2);
  });

  it("a failing check is E031 with the end of its output; --no-run skips it", () => {
    const dir = demoHistory();
    breakCode(dir);
    commit(dir, "Break invoices");
    const r = run(dir, "check");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      "error E031  Check billing.invoices#no-duplicates failed (exit code 1): node --test tests/invoices/duplicates.test.js",
    );
    expect(r.stdout).toContain("    | ");
    expect(run(dir, "check", "--no-run").status).toBe(0);
  });

  it("a check that runs too long is E032", () => {
    const dir = demoHistory();
    edit(
      dir,
      INVOICES,
      "## check refunds\nrun: node --test tests/invoices/refunds.test.js",
      '## check refunds\nrun: node -e "setTimeout(() => {}, 60000)"\ntimeout: 1',
    );
    run(dir, "lock");
    commit(dir, "Slow check");
    const e = check(dir).diagnostics.find((d) => d.code === "E032")!;
    expect(e.message).toBe(
      'Check billing.invoices#refunds timed out after 1 seconds: node -e "setTimeout(() => {}, 60000)"',
    );
  });

  it("--all runs every check; with no changes nothing runs", () => {
    const dir = demoHistory();
    expect(run(dir, "check").stdout).toContain(
      "none to run: no capsule's files changed (use --all to run every check)",
    );
    expect(check(dir, "--all").checks.length).toBe(7);
  });

  it("--ci with ci.mode report exits 0 but still reports; block exits 1", () => {
    const dir = demoHistory();
    breakCode(dir);
    removeAssertion(dir);
    commit(dir, "Fix invoices");
    const r = run(dir, "check", "--no-run", "--ci");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("error E028");
    expect(r.stdout).toContain("ci.mode is `report`, so these errors don't fail the build yet.");
    edit(dir, ".capsules/config.yaml", "mode: report", "mode: block");
    expect(run(dir, "check", "--no-run", "--ci").status).toBe(1);
  });
});
