// M2 end to end: lock, refresh, relock --cosmetic, staleness in status and check.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanup, demoRepo, FM, makeRepo, run } from "./helpers.js";

afterAll(cleanup);

const INVOICES = ".capsules/billing/invoices.md";
const C1_OLD = "Never create two invoices for the same customer and period.";
const C1_NEW = "Never create two invoices for the same customer and billing period.";

function edit(dir: string, path: string, from: string, to: string) {
  const p = join(dir, ...path.split("/"));
  const text = readFileSync(p, "utf8");
  if (!text.includes(from)) throw new Error(`${path} does not contain ${from}`);
  writeFileSync(p, text.replace(from, to));
}

const lockOf = (dir: string) => readFileSync(join(dir, ".capsules", "capsules.lock"), "utf8");
const json = (dir: string, ...args: string[]) => JSON.parse(run(dir, ...args, "--json").stdout);
const staleFrom = (dir: string) =>
  json(dir, "status").staleLinks.map((s: { from: string }) => s.from);

// D3 also links to C1, but D7 replaced it, so it is skipped (D-015).
const DEPENDENTS_OF_C1 = [
  "billing.invoices#D7",
  "billing.invoices#E1",
  "billing.invoices#create-invoice",
  "billing.invoices#idempotency",
];

describe("the M2 demo: change a contract, see what is stale", () => {
  it("the committed demo lockfile is up to date", () => {
    const dir = demoRepo();
    expect(json(dir, "status").lock.state).toBe("up-to-date");
    expect(run(dir, "lock", "--dry-run").stdout).toContain("already up to date");
  });

  it("editing C1 makes every link to it stale (W104) and the lock out of date (E010)", () => {
    const dir = demoRepo();
    edit(dir, INVOICES, C1_OLD, C1_NEW);
    const s = json(dir, "status");
    expect(s.lock).toEqual({ state: "out-of-date", changes: ["node billing.invoices#C1 changed"] });
    expect(staleFrom(dir)).toEqual(DEPENDENTS_OF_C1);
    const text = run(dir, "status").stdout;
    expect(text).toContain("stale:     4 links, 0 prompts");
    expect(text).toContain(
      "\n1 replaced decision skipped (billing.invoices#D3, replaced by billing.invoices#D7).\n",
    );
    expect(text).not.toContain("billing.invoices#D3 serves");
    expect(s.skippedReplaced).toEqual([
      { decision: "billing.invoices#D3", replacedBy: ["billing.invoices#D7"] },
    ]);
    expect(text).toContain("billing.invoices#D7 serves billing.invoices#C1");

    const check = run(dir, "check", "--no-run");
    expect(check.status).toBe(1);
    expect(check.stdout).toContain(
      "error E010  The lockfile is out of date: node billing.invoices#C1 changed.",
    );
    expect(check.stdout).toContain(
      "warning W104  Stale link: billing.invoices#D7 serves billing.invoices#C1",
    );
    expect(check.stdout).not.toContain("Stale link: billing.invoices#D3");
    expect(check.stdout).toContain(
      "note: 1 replaced decision skipped (billing.invoices#D3, replaced by billing.invoices#D7).",
    );
  });

  it("`lock` updates records but never clears staleness (B12)", () => {
    const dir = demoRepo();
    edit(dir, INVOICES, C1_OLD, C1_NEW);
    const r = run(dir, "lock");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("4 links still stale");
    expect(r.stdout).toContain(
      "1 replaced decision skipped (billing.invoices#D3, replaced by billing.invoices#D7).",
    );
    expect(json(dir, "status").lock.state).toBe("up-to-date");
    expect(staleFrom(dir)).toEqual(DEPENDENTS_OF_C1);
    expect(run(dir, "check", "--no-run").status).toBe(0); // stale links are warnings by default
  });

  it("`relock --cosmetic` clears them and prints the trailer (F1 scenario 3, D-013)", () => {
    const dir = demoRepo();
    edit(dir, INVOICES, C1_OLD, C1_NEW);
    const r = run(dir, "relock", "--cosmetic", "billing.invoices#C1");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("\n  Capsule-Cosmetic: billing.invoices#C1\n");
    expect(r.stdout).toContain("Only an owner of billing.invoices (parth)");
    expect(staleFrom(dir)).toEqual([]);
    expect(json(dir, "status").lock.state).toBe("up-to-date");
  });

  it("`refresh` re-pins only links from the reviewed node", () => {
    const dir = demoRepo();
    edit(dir, INVOICES, C1_OLD, C1_NEW);
    run(dir, "lock");
    expect(run(dir, "refresh", "billing.invoices#D7").status).toBe(0);
    expect(staleFrom(dir)).toEqual(DEPENDENTS_OF_C1.filter((a) => a !== "billing.invoices#D7"));
  });

  it("stale-links: block turns W104 into an error", () => {
    const dir = demoRepo();
    edit(dir, ".capsules/config.yaml", "stale-links: warn", "stale-links: block");
    edit(dir, INVOICES, C1_OLD, C1_NEW);
    run(dir, "lock");
    const r = json(dir, "check", "--no-run");
    expect(r.ok).toBe(false);
    expect(r.diagnostics.find((d: { code: string }) => d.code === "W104").severity).toBe("error");
  });

  it("a changed prompt file is stale (W110) until locked", () => {
    const dir = demoRepo();
    edit(dir, "prompts/invoice-agent.md", "invoice assistant", "billing assistant");
    const s = json(dir, "status");
    expect(s.stalePrompts.map((p: { path: string }) => p.path)).toEqual([
      "prompts/invoice-agent.md",
    ]);
    expect(s.lock.changes).toEqual(["file billing.invoices#invoice-agent changed"]);
    expect(run(dir, "check", "--no-run").stdout).toContain(
      "warning W110  Stale prompt: prompts/invoice-agent.md",
    );
  });
});

describe("lockfile determinism (F1)", () => {
  it("lock twice gives identical bytes", () => {
    const dir = demoRepo();
    const first = lockOf(dir);
    run(dir, "lock");
    expect(lockOf(dir)).toBe(first);
    writeFileSync(join(dir, ".capsules", "capsules.lock"), "");
    run(dir, "lock");
    run(dir, "lock");
    expect(lockOf(dir)).toBe(first);
  });

  it("a CRLF copy of every capsule gives identical hashes", () => {
    const dir = demoRepo();
    const before = lockOf(dir);
    for (const f of [".capsules/root.md", ".capsules/billing.md", INVOICES, ".capsules/web.md"]) {
      const p = join(dir, ...f.split("/"));
      writeFileSync(p, readFileSync(p, "utf8").replace(/\r?\n/g, "\r\n"));
    }
    expect(json(dir, "status").lock.state).toBe("up-to-date");
    run(dir, "lock");
    expect(lockOf(dir)).toBe(before);
  });

  it("the written lockfile uses LF only and ends with a newline", () => {
    const text = lockOf(demoRepo());
    expect(text.includes("\r")).toBe(false);
    expect(text.endsWith("\n")).toBe(true);
  });
});

describe("lock, refresh and relock: safety and usage", () => {
  const simple = () =>
    makeRepo({ ".capsules/root.md": `${FM("Root", ["**"])}## intent I1\nx\n`, "a.ts": "" });

  it("--dry-run writes nothing", () => {
    const dir = simple();
    const r = run(dir, "lock", "--dry-run");
    expect(r.stdout).toContain("would write .capsules/capsules.lock");
    expect(() => lockOf(dir)).toThrow();
  });

  it("a missing lockfile is E010; lock creates it", () => {
    const dir = simple();
    expect(run(dir, "check", "--no-run").stdout).toContain("There is no lockfile yet");
    expect(run(dir, "lock").status).toBe(0);
    expect(run(dir, "check", "--no-run").status).toBe(0);
  });

  it("lock refuses while capsules have errors, and writes nothing", () => {
    const dir = makeRepo({
      ".capsules/root.md": `${FM("Root", ["**"])}## contract C1 serves @I9\nx\n`,
      "a.ts": "",
    });
    const r = run(dir, "lock");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("nothing written");
    expect(() => lockOf(dir)).toThrow();
  });

  it("an unreadable lockfile line is E026, and lock refuses rather than lose pins", () => {
    const dir = simple();
    run(dir, "lock");
    writeFileSync(
      join(dir, ".capsules", "capsules.lock"),
      lockOf(dir) + "node root#I1 intent zz\n",
    );
    const r = json(dir, "check", "--no-run");
    expect(r.diagnostics.map((d: { code: string }) => d.code)).toEqual(["E026"]);
    expect(run(dir, "lock").status).toBe(1);
  });

  it("relock without --cosmetic, a bad address, an unknown node and a cross-repo address are usage errors", () => {
    const dir = simple();
    run(dir, "lock");
    expect(run(dir, "relock", "root#I1").status).toBe(64);
    expect(run(dir, "refresh", "not an address").status).toBe(64);
    expect(run(dir, "refresh", "root#I9").stderr).toContain("There is no node root#I9");
    const x = run(dir, "refresh", "payments-service:billing#C3");
    expect(x.status).toBe(64);
    expect(x.stderr).toContain("not supported yet");
  });

  it("a prompt node pointing at a missing file is W109", () => {
    const dir = makeRepo({
      ".capsules/root.md": `${FM("Root", ["**"])}## prompt p\nfile: prompts/missing.md\n`,
      "a.ts": "",
    });
    run(dir, "lock");
    expect(json(dir, "check", "--no-run").diagnostics.map((d: { code: string }) => d.code)).toEqual(
      ["W109"],
    );
  });
});
