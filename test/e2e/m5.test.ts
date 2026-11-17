// M5 end to end: `capsules map` in HTML, Mermaid and JSON (C14).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanup, demoHistory, run } from "./helpers.js";

afterAll(cleanup);

const mapFile = (dir: string) => join(dir, ".capsules", "_cache", "map.html");
const html = (dir: string) => {
  expect(run(dir, "map").status).toBe(0);
  return readFileSync(mapFile(dir), "utf8");
};
const json = (dir: string, ...extra: string[]) =>
  JSON.parse(run(dir, "map", "--format", "json", ...extra).stdout);
const edit = (dir: string, file: string, from: string, to: string) => {
  const p = join(dir, ...file.split("/"));
  const s = readFileSync(p, "utf8");
  expect(s).toContain(from);
  writeFileSync(p, s.replace(from, to));
};

describe("capsules map (HTML)", () => {
  it("writes .capsules/_cache/map.html and prints its path and the summary", () => {
    const dir = demoHistory();
    const r = run(dir, "map");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Wrote the capsules map: ");
    expect(r.stdout).toContain(".capsules/_cache/map.html");
    expect(r.stdout).toContain("5 areas · 3 concerns · 10 rules · 0 stale · checks not run yet");
    expect(existsSync(mapFile(dir))).toBe(true);
  });

  it("is identical byte for byte across runs and across machines (no paths, no clock)", () => {
    const a = demoHistory();
    const b = demoHistory();
    const first = html(a);
    expect(html(a)).toBe(first);
    expect(html(b)).toBe(first);
    expect(first).not.toContain(a.split("\\").join("/"));
    expect(first).not.toContain(a);
  });

  it("makes no network requests: a strict security policy and no external references", () => {
    const page = html(demoHistory());
    expect(page).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'`,
    );
    for (const s of [
      "src=",
      'href="http',
      "href='http",
      "url(",
      "@import",
      "fetch(",
      "XMLHttpRequest",
      "import(",
    ])
      expect(page).not.toContain(s);
  });

  it("puts the summary line at the very top", () => {
    const page = html(demoHistory());
    const summary = page.indexOf('<p class="summary" id="summary">');
    expect(summary).toBeGreaterThan(0);
    expect(summary).toBeLessThan(page.indexOf('id="attention"'));
    expect(page).toContain("5 areas · 3 concerns · 10 rules · 0 stale · checks not run yet</p>");
  });

  it("shows concerns as coloured tags on the areas they reach, linking to the concern", () => {
    const page = html(demoHistory());
    const web = page.slice(
      page.indexOf('id="cap-web"'),
      page.indexOf("</summary>", page.indexOf('id="cap-web"')),
    );
    expect(web).toMatch(/<a class="tag t1" href="#con-payments">payments<\/a>/);
    expect(web).toMatch(/<a class="tag t2" href="#con-pii">pii<\/a>/);
    expect(page).toContain('id="con-payments"');
  });

  it("nests the areas: root, then billing, then billing.invoices", () => {
    const page = html(demoHistory());
    const root = page.indexOf('id="cap-root"');
    const billing = page.indexOf('id="cap-billing"');
    const invoices = page.indexOf('id="cap-billing.invoices"');
    expect(root).toBeGreaterThan(0);
    expect(billing).toBeGreaterThan(root);
    expect(invoices).toBeGreaterThan(billing);
  });

  it("lists what needs attention, each linking to its place in the tree", () => {
    const dir = demoHistory();
    // A stale rule: the contract's wording changed after its dependents were written.
    edit(
      dir,
      ".capsules/billing/invoices.md",
      "Never create two invoices for the same customer and period.",
      "Never create two invoices for one customer in one period.",
    );
    // A failing check, as the last `capsules check` recorded it.
    mkdirSync(join(dir, ".capsules", "_cache"), { recursive: true });
    writeFileSync(
      join(dir, ".capsules", "_cache", "last-check.json"),
      JSON.stringify({
        format: "0.1",
        results: [
          { address: "web#checkout-e2e", run: "x", status: "fail", exitCode: 1, durationMs: 5 },
        ],
      }),
    );
    // An unreviewed check: a new test added together with the code it judges.
    edit(dir, "src/web/cart.tsx", "", "// changed\n");
    writeFileSync(join(dir, "tests", "web", "new.test.js"), "test('x', () => {});\n");

    const page = html(dir);
    const attn = page.slice(page.indexOf('id="attention"'), page.indexOf('id="search"'));
    expect(attn).toContain('Stale rules <span class="n">(4)</span>');
    expect(attn).toContain(
      '<a href="#cap-billing.invoices">billing.invoices</a>: billing.invoices#E1 (shows billing.invoices#C1)',
    );
    expect(attn).toContain('Failing checks <span class="n">(1)</span>');
    expect(attn).toContain(
      '<a href="#cap-web">web</a>: web#checkout-e2e failed in the last capsules check.',
    );
    expect(attn).toContain("Unreviewed checks");
    expect(attn).toContain(
      '<a href="#cap-web">web</a>: tests/web/new.test.js is a new check added together with the code it judges.',
    );
    expect(attn).toContain('Files with no capsule <span class="n">(1)</span>');
    expect(attn).toContain('data-file="scripts/seed.js">look up</button>');
    expect(page).toContain("4 stale · 1 check failed");
  });

  it("says so when nothing needs attention", () => {
    const dir = demoHistory();
    edit(dir, ".capsules/config.yaml", "ignore:\n", 'ignore:\n  - "scripts/**"\n');
    const page = html(dir);
    expect(page).toContain("Nothing needs attention");
  });

  it("keeps capsule text inside the page: a </script> in a rule can't break out", () => {
    const dir = demoHistory();
    edit(
      dir,
      ".capsules/web.md",
      "They never calculate prices or tax themselves.",
      "They never calculate prices </script><script>alert(1)</script> themselves.",
    );
    const page = html(dir);
    expect(page.match(/<\/script>/g)).toHaveLength(2);
    expect(page).toContain("&lt;/script&gt;&lt;script&gt;alert(1)");
  });

  it("has a valid inline script", () => {
    const page = html(demoHistory());
    const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    expect(scripts).toHaveLength(1);
    expect(() => new Function(scripts[0]!)).not.toThrow();
  });

  it("--out writes elsewhere, --dry-run writes nothing", () => {
    const dir = demoHistory();
    expect(run(dir, "map", "--dry-run").stdout).toContain("Dry run: would write the capsules map");
    expect(existsSync(mapFile(dir))).toBe(false);
    expect(run(dir, "map", "--out", "out/map.html").status).toBe(0);
    expect(readFileSync(join(dir, "out", "map.html"), "utf8")).toContain("<!doctype html>");
  });

  it("rejects an unknown format, and --open with a format that isn't HTML", () => {
    const dir = demoHistory();
    expect(run(dir, "map", "--format", "pdf").status).toBe(64);
    const r = run(dir, "map", "--format", "json", "--open");
    expect(r.status).toBe(64);
    expect(r.stderr).toContain("--open only works with the HTML map.");
  });
});

describe("the map's file search matches capsules explain", () => {
  it("gives every tracked file exactly what `capsules explain --json` gives", () => {
    const dir = demoHistory();
    const files = json(dir).files as Record<string, unknown>[];
    expect(files.map((f) => f.file)).toContain("src/web/checkout.tsx");
    for (const f of files.filter((x) =>
      ["src/web/checkout.tsx", "src/billing/invoices/create.js", "scripts/seed.js"].includes(
        x.file as string,
      ),
    )) {
      const e = JSON.parse(run(dir, "explain", f.file as string, "--json").stdout);
      delete e.format;
      delete e.kind;
      delete e.projectErrors;
      expect(f).toEqual(e);
    }
  });
});

describe("capsules map --format mermaid / json", () => {
  it("prints the tree and the concerns as a Mermaid flowchart", () => {
    const r = run(demoHistory(), "map", "--format", "mermaid");
    expect(r.status).toBe(0);
    expect(r.stdout.startsWith("flowchart TD\n")).toBe(true);
    expect(r.stdout).toContain("  a_billing --> a_billing_dinvoices\n");
    expect(r.stdout).toContain("  k_payments -.- a_web\n");
    expect(r.stdout).toContain("root · 1 rule</small>");
  });

  it("prints the whole graph as versioned JSON", () => {
    const j = json(demoHistory());
    expect(j.format).toBe("0.1");
    expect(j.kind).toBe("map");
    expect(j.summary.line).toBe("5 areas · 3 concerns · 10 rules · 0 stale · checks not run yet");
    const web = j.capsules.find((c: { id: string }) => c.id === "web");
    expect(web.related).toEqual(["payments", "pii"]);
    expect(j.attention).toEqual([
      {
        kind: "orphan",
        text: "scripts/seed.js has no home capsule. Add it to a capsule's covers, or to ignore in config.yaml.",
        capsule: "root",
        file: "scripts/seed.js",
      },
    ]);
  });
});

describe("/capsules-map", () => {
  it("is installed by capsules init", () => {
    const dir = demoHistory();
    expect(run(dir, "init", "--yes").status).toBe(0);
    const cmd = readFileSync(join(dir, ".claude", "commands", "capsules-map.md"), "utf8");
    expect(cmd).toContain("description: Draw the capsules map");
    expect(cmd).toContain("capsules map --format json");
  });
});
