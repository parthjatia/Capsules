// Tests added after the independent review of PR #8 (see docs/DOGFOOD.md):
// the search box run for real in a headless browser, true nesting of the tree, the whole
// network-blocking rule, errors and overdue assumptions in "Needs attention", --base, and
// same-bytes output for Mermaid and JSON.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { cleanup, commit, demoHistory, run } from "./helpers.js";

afterAll(cleanup);

const mapFile = (dir: string) => join(dir, ".capsules", "_cache", "map.html");
const html = (dir: string, ...extra: string[]) => {
  expect(run(dir, "map", ...extra).status).toBe(0);
  return readFileSync(mapFile(dir), "utf8");
};
const append = (dir: string, file: string, text: string) => {
  const p = join(dir, ...file.split("/"));
  writeFileSync(p, readFileSync(p, "utf8") + text);
};

// ---------------------------------------------------------------------------------------
// A real browser: Edge first, then Chrome (the same engine). In CI a missing browser fails
// the test instead of skipping it, so the search can't go untested by accident.

function findBrowser(): string | null {
  const env = process.env.CAPSULES_TEST_BROWSER;
  if (env) return env;
  const candidates =
    process.platform === "win32"
      ? [
          "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
          "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
          "C:/Program Files/Google/Chrome/Application/chrome.exe",
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          ]
        : [
            "microsoft-edge",
            "microsoft-edge-stable",
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser",
          ];
  for (const c of candidates) {
    if (c.includes("/")) {
      if (existsSync(c)) return c;
    } else if (spawnSync("which", [c], { encoding: "utf8" }).status === 0) return c;
  }
  return null;
}

const BROWSER = findBrowser();
const inCi = Boolean(process.env.CI);

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

/**
 * Type `term` into the page's own search box (its real script runs) and read back what it
 * shows: for each result card, the file and each row's lines.
 */
function searchInBrowser(
  page: string,
  term: string,
): { count: string; cards: { file: string; rows: Record<string, string[]> }[] } {
  const dir = mkdtempSync(join(tmpdir(), "capsules-browser-"));
  const driver = `<script>var q=document.getElementById("q");q.value=${JSON.stringify(term)};q.dispatchEvent(new Event("input"));</script></body>`;
  const file = join(dir, "page.html");
  writeFileSync(file, page.replace("</body>", driver));
  const r = spawnSync(
    BROWSER!,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--no-first-run",
      `--user-data-dir=${join(dir, "profile")}`,
      "--virtual-time-budget=3000",
      "--dump-dom",
      pathToFileURL(file).href,
    ],
    { encoding: "utf8", timeout: 60000 },
  );
  const dom = r.stdout;
  expect(dom, `browser printed no page (exit ${r.status}): ${r.stderr}`).toContain('id="results"');
  const results = dom.slice(dom.indexOf('id="results"'), dom.indexOf('id="tree"'));
  const count = unescape(/<p class="count">([^<]*)<\/p>/.exec(results)?.[1] ?? "");
  const cards = [...results.matchAll(/<details class="file card"[^>]*>([\s\S]*?)<\/details>/g)].map(
    (m) => {
      const body = m[1]!;
      const fileName = unescape(/<summary><code>([^<]*)<\/code><\/summary>/.exec(body)?.[1] ?? "");
      const rows: Record<string, string[]> = {};
      for (const row of body.matchAll(/<dt>([^<]*)<\/dt><dd>([\s\S]*?)<\/dd>/g))
        rows[unescape(row[1]!)] = [...row[2]!.matchAll(/<div>([\s\S]*?)<\/div>/g)].map((d) =>
          unescape(d[1]!),
        );
      return { file: fileName, rows };
    },
  );
  return { count, cards };
}

interface Explained {
  file: string;
  home: string | null;
  homePattern: string | null;
  conflict: string[];
  parents: string[];
  concerns: string[];
  rules: { address: string; text: string }[];
  checks: string[];
  mayEdit: { agent: string; scope: string }[];
  blocked: { agent: string; reason: string }[];
  decisions: { address: string; text: string; rejected: string[] }[];
}

/** What the search must show for a file, built from `capsules explain --json`. */
function expectedRows(e: Explained): Record<string, string[]> {
  const none = (xs: string[]) => (xs.length ? xs : ["(none)"]);
  const joined = (xs: string[]) => none(xs.length ? [xs.join(", ")] : []);
  return {
    home: [
      e.home
        ? `${e.home}  (covers: ${e.homePattern})`
        : e.conflict.length
          ? `(conflict: ${e.conflict.join(", ")}) E004, treated as root`
          : "(none) orphan, treated as root for permissions",
    ],
    parents: joined(e.parents),
    concerns: joined(e.concerns),
    rules: none(e.rules.map((r) => `${r.address}: ${r.text}`)),
    checks: joined(e.checks),
    "may edit": joined(
      e.mayEdit.map((w) => (w.scope === "context" ? `${w.agent} (context only)` : w.agent)),
    ),
    blocked: joined(e.blocked.map((w) => `${w.agent} (${w.reason})`)),
    decisions: none(
      e.decisions.map(
        (d) =>
          `${d.address}: ${d.text}${d.rejected.length ? ` (rejected: ${d.rejected.join("; ")})` : ""}`,
      ),
    ),
  };
}

describe.skipIf(!BROWSER && !inCi)("the search box, run in a real browser", () => {
  it("has a browser to run in", () => {
    expect(BROWSER, "no Edge or Chrome found; set CAPSULES_TEST_BROWSER").not.toBeNull();
  });

  const dir = demoHistory();
  const page = html(dir);

  it.each([
    "src/web/checkout.tsx",
    "src/billing/invoices/create.js",
    "scripts/seed.js",
    "src/users/store.js",
  ])(
    "shows exactly what `capsules explain` says for %s, field by field",
    (file) => {
      const e = JSON.parse(run(dir, "explain", file, "--json").stdout) as Explained;
      const shown = searchInBrowser(page, file);
      expect(shown.count).toBe("1 file");
      expect(shown.cards).toHaveLength(1);
      expect(shown.cards[0]!.file).toBe(file);
      expect(shown.cards[0]!.rows).toEqual(expectedRows(e));
    },
    90000,
  );

  it("finds every tracked file that contains the typed text, and only those", () => {
    const all = (
      JSON.parse(run(dir, "map", "--format", "json").stdout).files as { file: string }[]
    ).map((f) => f.file);
    const want = all.filter((f) => f.toLowerCase().includes("web/"));
    expect(want.length).toBeGreaterThan(3);
    const shown = searchInBrowser(page, "WEB/");
    expect(shown.count).toBe(`${want.length} files`);
    expect(shown.cards.map((c) => c.file)).toEqual(want);
  }, 90000);

  it("says so when nothing matches", () => {
    const shown = searchInBrowser(page, "no/such/file");
    expect(shown.count).toBe("No tracked file matches.");
    expect(shown.cards).toEqual([]);
  }, 90000);
});

// ---------------------------------------------------------------------------------------

/** For each element id, the ids of the <details> elements it sits inside, nearest first. */
function detailsParents(page: string): Map<string, string[]> {
  const stack: (string | null)[] = [];
  const out = new Map<string, string[]>();
  for (const m of page.matchAll(/<details\b([^>]*)>|<\/details>/g)) {
    if (m[0] === "</details>") {
      stack.pop();
      continue;
    }
    const id = /\bid="([^"]*)"/.exec(m[1]!)?.[1] ?? null;
    if (id) out.set(id, stack.filter((s): s is string => s !== null).reverse());
    stack.push(id);
  }
  expect(stack).toEqual([]);
  return out;
}

describe("the tree nests areas inside their parents", () => {
  it("puts billing.invoices inside billing, inside root; web and users directly inside root", () => {
    const parents = detailsParents(html(demoHistory()));
    expect(parents.get("cap-root")).toEqual([]);
    expect(parents.get("cap-billing")).toEqual(["cap-root"]);
    expect(parents.get("cap-billing.invoices")).toEqual(["cap-billing", "cap-root"]);
    expect(parents.get("cap-web")).toEqual(["cap-root"]);
    expect(parents.get("cap-users")).toEqual(["cap-root"]);
    expect(parents.get("con-payments")).toEqual([]);
  });

  it("puts a new deeper area inside its own parent", () => {
    const dir = demoHistory();
    mkdirSync(join(dir, ".capsules", "billing", "invoices"), { recursive: true });
    writeFileSync(
      join(dir, ".capsules", "billing", "invoices", "pdf.md"),
      "---\ntitle: Invoice PDFs\ncovers:\n  - src/billing/invoices/pdf/**\n---\n\n## intent I1\n\nInvoices print cleanly.\n",
    );
    const parents = detailsParents(html(dir));
    expect(parents.get("cap-billing.invoices.pdf")).toEqual([
      "cap-billing.invoices",
      "cap-billing",
      "cap-root",
    ]);
  });
});

describe("the page can't make network requests", () => {
  it("carries exactly this network-blocking rule, and only one", () => {
    const page = html(demoHistory());
    const rules = [
      ...page.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/gi),
    ].map((m) => m[1]);
    expect(rules).toEqual([
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    ]);
    expect(page.toLowerCase().match(/content-security-policy/g)).toHaveLength(1);
    // Browsers only obey the rule in the <head>, before anything it governs.
    const at = page.indexOf('http-equiv="Content-Security-Policy"');
    expect(at).toBeGreaterThan(page.indexOf("<head>"));
    expect(at).toBeLessThan(page.indexOf("</head>"));
    expect(at).toBeLessThan(page.indexOf("<style>"));
    expect(at).toBeLessThan(page.indexOf("<script"));
    // Nothing that loads from elsewhere, written any way.
    for (const s of [
      /\bsrc\s*=/i,
      /href\s*=\s*["']?(https?:)?\/\//i,
      /<link\b/i,
      /<iframe\b/i,
      /<img\b/i,
      /url\s*\(/i,
      /@import/i,
      /\bfetch\s*\(/,
      /XMLHttpRequest/,
      /WebSocket/,
      /EventSource/,
      /sendBeacon/,
      /\bimport\s*\(/,
    ])
      expect(page).not.toMatch(s);
  });
});

describe("Needs attention: errors and assumptions past review", () => {
  it("lists an error in a capsule and an overdue assumption, each linking to that capsule", () => {
    const dir = demoHistory();
    append(
      dir,
      ".capsules/web.md",
      "\n## context cart-notes uses @C9\nNotes about the cart.\n\n## assumption A9\nFewer than 100 orders a day.\nreview-by: 2020-01-01\n",
    );
    const page = html(dir);
    const attn = page.slice(page.indexOf('id="attention"'), page.indexOf('id="search"'));
    expect(attn).toContain('Errors in the capsules <span class="n">');
    expect(attn).toMatch(
      /<li><a href="#cap-web">web<\/a>: E003 [^<]*@C9[^<]*\(\.capsules\/web\.md:\d+\)<\/li>/,
    );
    expect(attn).toContain('Assumptions past their review date <span class="n">(1)</span>');
    expect(attn).toMatch(/<li><a href="#cap-web">web<\/a>: [^<]*web#A9[^<]*<\/li>/);
    // And the targets of those links exist.
    expect(page).toContain('id="cap-web"');
  });
});

describe("--base decides which new checks are unreviewed", () => {
  it("lists a new test committed with code after the base, and not when the base is after it", () => {
    const dir = demoHistory();
    append(dir, "src/web/cart.tsx", "// changed\n");
    writeFileSync(join(dir, "tests", "web", "added.test.js"), "test('x', () => {});\n");
    commit(dir, "code and a new test");
    expect(html(dir, "--base", "main")).toContain("tests/web/added.test.js is a new check");
    expect(html(dir, "--base", "HEAD")).not.toContain("tests/web/added.test.js is a new check");
  });
});

describe("Mermaid and JSON are identical byte for byte too", () => {
  it.each(["mermaid", "json"])(
    "--format %s gives the same bytes across runs and copies",
    (format) => {
      const a = demoHistory();
      const b = demoHistory();
      const first = run(a, "map", "--format", format).stdout;
      expect(first.length).toBeGreaterThan(100);
      expect(run(a, "map", "--format", format).stdout).toBe(first);
      expect(run(b, "map", "--format", format).stdout).toBe(first);
      expect(first).not.toContain(a);
      expect(first).not.toContain(a.split("\\").join("/"));
    },
  );
});
