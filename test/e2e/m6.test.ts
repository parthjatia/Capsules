// M6: the pull request summary (C17), written by `capsules check --ci --summary <file>`.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanup, commit, demoHistory, run } from "./helpers.js";

afterAll(cleanup);

const edit = (dir: string, file: string, change: (s: string) => string) => {
  const p = join(dir, ...file.split("/"));
  writeFileSync(p, change(readFileSync(p, "utf8")));
};
// Written outside the repo, so the summary file itself isn't a change to the repo.
const out = mkdtempSync(join(tmpdir(), "capsules-summary-"));
let n = 0;
const summary = (dir: string) => {
  const file = join(out, `summary-${n++}.md`);
  const r = run(dir, "check", "--ci", "--no-run", "--base", "main", "--summary", file);
  expect(r.status).toBe(0);
  return readFileSync(file, "utf8");
};
/** The lines inside the ```text block. */
const body = (s: string) => s.slice(s.indexOf("```text\n") + 8, s.lastIndexOf("\n```")).split("\n");

describe("capsules check --summary (C17)", () => {
  it("says what a change did: capsules, new rule, new decision, checks, policy, warnings", () => {
    const dir = demoHistory();
    edit(
      dir,
      ".capsules/billing/invoices.md",
      (s) =>
        s +
        "\n## contract C4 serves @I1\nA refund never exceeds the amount charged.\nchecked-by: @refunds\n" +
        "\n## decision D9 serves @C1 supersedes @D7\nBuild idempotency keys from customer_id, period and plan.\nrejected: random keys\n",
    );
    edit(dir, "tests/invoices/refunds.test.js", (s) => s.replace("test(", "test.skip("));
    expect(run(dir, "lock").status).toBe(0);
    commit(dir, "refund rule");

    const s = summary(dir);
    expect(s.startsWith("<!-- capsules-summary -->\n")).toBe(true);
    const lines = body(s);
    expect(lines[0]).toBe("Capsules:   billing.invoices");
    expect(lines).toContain("Intent:     no change");
    expect(lines).toContain(
      'Contracts:  + billing.invoices#C4 "A refund never exceeds the amount charged." (needs owner approval)',
    );
    expect(lines).toContain("Decisions:  + billing.invoices#D9 (supersedes D7)");
    expect(lines.find((l) => l.startsWith("Checks:"))).toBe(
      "Checks:     not run | Policy: OK | Stale: 0",
    );
    expect(lines.some((l) => /W107 .*tests\/invoices\/refunds\.test\.js/.test(l))).toBe(true);
  });

  it("reports a quiet change as no change, and a code change by the capsules it touches", () => {
    const dir = demoHistory();
    edit(dir, "src/web/checkout.tsx", (s) => s + "\n// tidy\n");
    commit(dir, "tidy");
    const lines = body(summary(dir));
    expect(lines[0]).toBe("Capsules:   payments, pii, web");
    expect(lines).toContain("Intent:     no change");
    expect(lines).toContain("Contracts:  no change");
    expect(lines).toContain("Decisions:  none added");
  });

  it("flags a changed intent and an edited decision", () => {
    const dir = demoHistory();
    edit(dir, ".capsules/web.md", (s) =>
      s
        .replace(
          "Customers can see their cart and pay in a few clicks.",
          "Customers pay in one click.",
        )
        .replace(
          "Calculate tax in the browser for instant feedback.",
          "Calculate tax in the browser.",
        ),
    );
    expect(run(dir, "lock").status).toBe(0);
    commit(dir, "intent and decision");
    const s = summary(dir);
    const lines = body(s);
    expect(lines).toContain(
      'Intent:     ~ web#I1 "Customers pay in one click." (needs owner approval)',
    );
    expect(lines.some((l) => l.includes("~ web#D1 (decisions are append-only: E009)"))).toBe(true);
    expect(lines.find((l) => l.startsWith("Checks:"))).toMatch(
      /Policy: \d+ problems? \(.*E009.*\)/,
    );
    expect(s).toContain("found problems");
  });

  it("never prints email addresses, even of unknown authors", () => {
    const dir = demoHistory();
    edit(dir, ".capsules/config.yaml", (s) => s.replace("format: 0.1", "format: 0.1 "));
    commit(dir, "config by a stranger", [], "stranger@example.com");
    const s = summary(dir);
    expect(s).toContain("E027");
    expect(s).not.toContain("stranger@example.com");
    expect(s).not.toMatch(/[^\s()]+@[^\s()]+\.[a-z]{2,}/i);
    expect(s).toContain("(email hidden)");
  });

  it("is the same bytes every time, and doesn't change what check prints or its exit code", () => {
    const dir = demoHistory();
    edit(dir, "src/web/cart.tsx", (s) => s + "\n// tidy\n");
    commit(dir, "tidy");
    const plain = run(dir, "check", "--ci", "--no-run", "--base", "main");
    const first = summary(dir);
    expect(summary(dir)).toBe(first);
    const again = run(
      dir,
      "check",
      "--ci",
      "--no-run",
      "--base",
      "main",
      "--summary",
      join(out, "s2.md"),
    );
    expect(again.stdout).toBe(plain.stdout);
    expect(again.status).toBe(plain.status);
  });
});
