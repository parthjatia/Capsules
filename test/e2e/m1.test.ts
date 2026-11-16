// M1 end to end: explain, status and check --no-run on real temporary Git repos.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanup, demoRepo, FM, makeRepo, run } from "./helpers.js";

afterAll(cleanup);

describe("billing demo (the M1 demo)", () => {
  const dir = demoRepo();

  it("explain src/web/checkout.tsx shows home, parents, concerns, rules (C3)", () => {
    const r = run(dir, "explain", "src/web/checkout.tsx");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(
      [
        "file:      src/web/checkout.tsx",
        "home:      web                       (covers: src/web/**)",
        "parents:   root",
        "concerns:  payments, pii",
        "rules:     web#C1, root#C1, payments#C1, payments#C2, pii#C1",
        "checks:    web#checkout-e2e, root#all-tests, payments#no-double-charge, pii#no-pii-logs",
        "may edit:  default, capsules-drafter (context only)",
        "blocked:   billing-agent (outside its scope), frontend-agent (concern: payments)",
        "decisions: web#D2 (rejected: client-side tax calculation)",
        "",
      ].join("\n"),
    );
  });

  it("explain of a nested area lists every ancestor", () => {
    const r = run(dir, "explain", "src/billing/invoices/create.js", "--json");
    const j = JSON.parse(r.stdout);
    expect(j).toMatchObject({
      format: "0.1",
      kind: "explain",
      home: "billing.invoices",
      parents: ["billing", "root"],
      concerns: ["payments"],
    });
    expect(j.rules.map((x: { address: string }) => x.address)).toEqual([
      "billing.invoices#C1",
      "billing.invoices#C2",
      "billing#C1",
      "root#C1",
      "payments#C1",
      "payments#C2",
    ]);
    expect(j.decisions.map((d: { address: string }) => d.address)).toEqual(["billing.invoices#D7"]);
  });

  it.skipIf(process.platform !== "win32")("explain accepts Windows-style separators", () => {
    const r = run(dir, "explain", "src\\web\\checkout.tsx", "--json");
    expect(JSON.parse(r.stdout).file).toBe("src/web/checkout.tsx");
  });

  it("explain an orphan says so", () => {
    expect(run(dir, "explain", "scripts/seed.js").stdout).toContain("orphan W101");
  });

  it("explain from a subfolder resolves paths relative to it", () => {
    const r = run(join(dir, "src", "web"), "explain", "checkout.tsx", "--json");
    expect(JSON.parse(r.stdout).home).toBe("web");
  });

  it("status lists the orphan", () => {
    const r = run(dir, "status");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("5 areas, 2 concerns");
    expect(r.stdout).toContain("  scripts/seed.js");
  });

  it("check --no-run passes with only the orphan warning", () => {
    const r = run(dir, "check", "--no-run", "--json");
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.diagnostics.map((d: { code: string }) => d.code)).toEqual(["W101"]);
  });

  it("output is deterministic", () => {
    expect(run(dir, "check", "--no-run", "--json").stdout).toBe(
      run(dir, "check", "--no-run", "--json").stdout,
    );
    expect(run(dir, "status").stdout).toBe(run(dir, "status").stdout);
  });

  it("CRLF capsule files give the same result", () => {
    const crlf = demoRepo();
    for (const f of [
      ".capsules/web.md",
      ".capsules/billing/invoices.md",
      ".capsules/_concerns/pii.md",
    ]) {
      const p = join(crlf, ...f.split("/"));
      writeFileSync(p, readFileSync(p, "utf8").replace(/\r?\n/g, "\r\n"));
    }
    expect(run(crlf, "explain", "src/web/checkout.tsx").stdout).toBe(
      run(dir, "explain", "src/web/checkout.tsx").stdout,
    );
  });
});

const ROOT_MD = `${FM("Root")}## intent I1\nx\n`;

function codesOf(dir: string): string[] {
  return JSON.parse(run(dir, "check", "--no-run", "--json").stdout).diagnostics.map(
    (d: { code: string }) => d.code,
  );
}

describe("check --no-run validation (C2.6)", () => {
  it("E004: two unrelated capsules cover one file (F1 scenario 7)", () => {
    const dir = makeRepo({
      ".capsules/root.md": ROOT_MD,
      ".capsules/web.md": `${FM("Web", ["src/**"])}## intent I1\nx\n`,
      ".capsules/users.md": `${FM("Users", ["src/users/**"])}## intent I1\nx\n`,
      "src/users/a.ts": "",
    });
    const r = run(dir, "check", "--no-run");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      "error E004  src/users/a.ts has more than one home capsule: users, web.",
    );
    expect(r.stdout).toContain("fix:");
  });

  it("E003: a reference to a missing node, with file:line", () => {
    const dir = makeRepo({
      ".capsules/root.md": `${FM("Root", ["**"])}## intent I1\nx\n\n## contract C1 serves @I9\ny\n`,
      "a.ts": "",
    });
    const r = run(dir, "check", "--no-run");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('Reference @I9 points to nothing: capsule root has no node "I9".');
    expect(r.stdout).toContain("at:   .capsules/root.md:10");
  });

  it("E015: cross-repo address is rejected as not supported yet", () => {
    const dir = makeRepo({
      ".capsules/root.md": `${FM("Root", ["**"])}## contract C1 serves @payments-service:billing#I3\ny\n`,
      "a.ts": "",
    });
    const r = run(dir, "check", "--no-run");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Cross-repo links are not supported yet in v0.1.");
  });

  it("E005: a supersedes loop", () => {
    const dir = makeRepo({
      ".capsules/root.md": `${FM("Root", ["**"])}## decision D1 supersedes @D2\na\n\n## decision D2 supersedes @D1\nb\n`,
      "a.ts": "",
    });
    expect(codesOf(dir)).toContain("E005");
  });

  it("E006: a link to the wrong node type", () => {
    const dir = makeRepo({
      ".capsules/root.md": `${FM("Root", ["**"])}## intent I1\nx\n\n## contract C1 serves @I1\ny\nchecked-by: @I1\n`,
      "a.ts": "",
    });
    expect(codesOf(dir)).toContain("E006");
  });

  it("E012 and E013: concern id collision and folder without capsule file", () => {
    const dir = makeRepo({
      ".capsules/root.md": ROOT_MD,
      ".capsules/web.md": `${FM("Web", ["src/**"])}## intent I1\nx\n`,
      ".capsules/_concerns/web.md": `${FM("Web concern", ["src/**"])}## intent I1\nx\n`,
      ".capsules/billing/invoices.md": `${FM("Invoices", ["lib/**"])}## intent I1\nx\n`,
      "src/a.ts": "",
      "lib/b.ts": "",
    });
    const codes = codesOf(dir);
    expect(codes).toContain("E012");
    expect(codes).toContain("E013");
  });

  it("E023: root.md missing", () => {
    const dir = makeRepo({ ".capsules/web.md": `${FM("Web", ["src/**"])}`, "src/a.ts": "" });
    expect(codesOf(dir)).toContain("E023");
  });

  it("E014: a concern that covers nothing", () => {
    const dir = makeRepo({
      ".capsules/root.md": `${FM("Root", ["**"])}`,
      ".capsules/_concerns/pii.md": `${FM("PII", ["nothing/**"])}`,
      "a.ts": "",
    });
    expect(codesOf(dir)).toEqual(["E014"]);
  });

  it("E021 owner not in permissions, E022 bad config key, E020 bad file name", () => {
    const dir = makeRepo({
      ".capsules/root.md": `${FM("Root", ["**"], "owners: [nobody]\n")}`,
      ".capsules/config.yaml": "ignore: []\nweakend-tests: warn\n",
      ".capsules/Billing.md": `${FM("Billing", ["src/**"])}`,
      "a.ts": "",
    });
    const r = JSON.parse(run(dir, "check", "--no-run", "--json").stdout);
    const byCode = Object.fromEntries(
      r.diagnostics.map((d: { code: string; message: string }) => [d.code, d.message]),
    );
    expect(Object.keys(byCode).sort()).toEqual(["E020", "E021", "E022"]);
    expect(byCode.E021).toContain('Owner "nobody" is not listed');
    expect(byCode.E022).toContain("unknown key `weakend-tests`");
    expect(byCode.E020).toContain('"Billing" is not a valid capsule id');
  });

  it("W105 and W106: assumption past review, missing code path", () => {
    const dir = makeRepo({
      ".capsules/root.md": `${FM("Root", ["**"])}## assumption A1\nx\nreview-by: 2026-01-01\n\n## code c\nsrc/gone.ts#f\n`,
      "a.ts": "",
    });
    const r = run(dir, "check", "--no-run", "--json");
    expect(r.status).toBe(0);
    expect(codesOf(dir)).toEqual(["W105", "W106"]);
  });

  it("errors in a draft capsule are reported but never block (C2.1)", () => {
    const dir = makeRepo({
      ".capsules/root.md": `${FM("Root", ["**"], "status: draft\n")}## contract C1 serves @I9\ny\n`,
      "a.ts": "",
    });
    const r = run(dir, "check", "--no-run", "--json");
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.diagnostics[0]).toMatchObject({ code: "E003", severity: "warning" });
  });

  it("orphans are folded after ten in text output", () => {
    const files: Record<string, string> = { ".capsules/root.md": `${FM("Root")}` };
    for (let i = 0; i < 15; i++) files[`f${String(i).padStart(2, "0")}.ts`] = "";
    const r = run(makeRepo(files), "check", "--no-run");
    expect(r.stdout).toContain("...and 5 more files with no home capsule.");
  });
});

describe("usage errors (exit 64)", () => {
  it("outside a Git repository", () => {
    const dir = makeRepo({});
    // Remove .git by pointing at a non-repo temp folder inside it is unreliable; use a sibling.
    const plain = join(dir, "..", `not-a-repo-${process.pid}-${Date.now()}`);
    mkdirSync(plain);
    const r = run(plain, "status");
    // Some CI machines have a git repo above tmp; accept either message but always exit 64.
    expect(r.status).toBe(64);
  });

  it("no .capsules folder", () => {
    const r = run(makeRepo({ "a.ts": "" }), "status");
    expect(r.status).toBe(64);
    expect(r.stderr).toContain("No .capsules/ folder found");
  });

  it("explain a path outside the project", () => {
    const dir = makeRepo({ ".capsules/root.md": FM("Root", ["**"]), "a.ts": "" });
    expect(run(dir, "explain", "../elsewhere.ts").status).toBe(64);
  });

  it("unknown command option", () => {
    const dir = makeRepo({ ".capsules/root.md": FM("Root", ["**"]) });
    expect(run(dir, "check", "--frobnicate").status).toBe(64);
  });
});
