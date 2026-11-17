// M6h spec audit: things Part C promises that no test checked, or that didn't exist.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CLI, cleanup, demoRepo } from "./helpers.js";

afterAll(cleanup);

const env = (): NodeJS.ProcessEnv => {
  const e: NodeJS.ProcessEnv = { ...process.env, CAPSULES_TODAY: "2026-11-17" };
  for (const k of ["CAPSULES_SESSION", "CLAUDECODE", "CLAUDE_ENV_FILE", "GITHUB_ACTIONS"])
    delete e[k];
  return e;
};
const cli = (dir: string, ...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: "utf8", env: env() });

describe("capsules why <address> (C15)", () => {
  it("shows what a rule serves and the decisions behind it, with rejected options", () => {
    const dir = demoRepo();
    const r = cli(dir, "why", "billing.invoices#C1");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("serves billing.invoices#I1: Each customer is charged exactly once");
    expect(r.stdout).toContain("billing.invoices#D7: Use an idempotency key");
    expect(r.stdout).toContain("rejected: own ledger (3 weeks of work, no audit trail)");
    expect(r.stdout).toContain("assumes billing.invoices#A3");
    expect(r.stdout).toContain("billing.invoices#D3 (replaced by billing.invoices#D7)");
    // The current decision comes before the replaced one.
    expect(r.stdout.indexOf("#D7:")).toBeLessThan(r.stdout.indexOf("#D3 ("));
    const j = JSON.parse(cli(dir, "why", "billing.invoices#C1", "--json").stdout);
    expect(j.format).toBe("0.1");
    expect(j.decisions.map((d: { address: string }) => d.address)).toEqual([
      "billing.invoices#D7",
      "billing.invoices#D3",
    ]);
  });

  it("refuses a cross-repo address with E015 and exit 64 (C2.2), and an unknown node with 64", () => {
    const dir = demoRepo();
    const x = cli(dir, "why", "payments-service:billing#C3");
    expect(x.status).toBe(64);
    expect(x.stderr).toContain("E015");
    expect(cli(dir, "why", "billing#Z9").status).toBe(64);
    expect(cli(dir, "why", "not an address").status).toBe(64);
  });
});

describe("capsules impact <address> (C15)", () => {
  it("lists every node that depends on a node, nearest first, and the files they name", () => {
    const dir = demoRepo();
    const r = cli(dir, "impact", "billing.invoices#I1");
    expect(r.status).toBe(0);
    const at = (s: string) => r.stdout.indexOf(s);
    expect(at("billing.invoices#C1 (contract, serves)")).toBeGreaterThan(0);
    // E1 depends on C1, which depends on I1: distance 2, after the distance-1 nodes.
    expect(at("billing.invoices#E1 (example, shows billing.invoices#C1)")).toBeGreaterThan(
      at("billing.invoices#C2 (contract, serves)"),
    );
    expect(r.stdout).toContain("files: src/billing/invoices/create.js");
    const j = JSON.parse(cli(dir, "impact", "billing.invoices#C1", "--json").stdout);
    const e1 = j.dependents.find((d: { address: string }) => d.address === "billing.invoices#E1");
    expect(e1).toMatchObject({ link: "shows", distance: 1 });
  });

  it("says so when nothing links to a node", () => {
    const dir = demoRepo();
    const r = cli(dir, "impact", "billing.invoices#E1");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Nothing links to it.");
  });
});

describe("W102 and W103 (C2.6)", () => {
  it("a contract with no intent is W102; one with no check is W103", () => {
    const dir = demoRepo();
    const f = join(dir, ".capsules", "billing", "invoices.md");
    writeFileSync(
      f,
      readFileSync(f, "utf8") + "\n## contract C9\nAn invoice number is never reused.\n",
    );
    const r = cli(dir, "check", "--no-run");
    expect(r.stdout).toMatch(/warning W102[\s\S]*billing\.invoices#C9/);
    expect(r.stdout).toMatch(/warning W103[\s\S]*billing\.invoices#C9/);
  });
});
