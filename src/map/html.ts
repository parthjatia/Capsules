// `capsules map --format html` (C14): one self-contained page. Inline CSS and plain JS, no
// network requests (the Content-Security-Policy forbids them), no timestamps, sorted input:
// the same capsules give the same bytes.
import type { FileExplanation } from "../core/explain.js";
import type { AttentionItem, AttentionKind, MapCapsule, MapModel } from "./model.js";
import { plural } from "../report/text.js";

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** JSON that is safe inside a <script> element. */
const scriptJson = (v: unknown) =>
  JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .split(String.fromCharCode(0x2028))
    .join("\\u2028")
    .split(String.fromCharCode(0x2029))
    .join("\\u2029");

const TAG_COLOURS = 8;

const KIND_TITLES: [AttentionKind, string, string][] = [
  ["error", "Errors in the capsules", "bad"],
  ["stale", "Stale rules", "warn"],
  ["failing-check", "Failing checks", "bad"],
  ["unreviewed", "Unreviewed checks", "warn"],
  ["orphan", "Files with no capsule", "warn"],
  ["assumption", "Assumptions past their review date", "warn"],
];

const CSS = `
:root {
  --bg: #fbfaf7; --fg: #1d1c1a; --muted: #6a675f; --card: #ffffff; --border: #e3e0d8;
  --accent: #2f5fb3; --ok: #2d7a46; --warn: #a15c00; --bad: #b3261e; --hl: #fff4c2;
  --t0b: #e4ecfb; --t0f: #1f4b99; --t1b: #fbe7e4; --t1f: #9a2c1d; --t2b: #e3f4e8; --t2f: #1f6b3a;
  --t3b: #f6ecd9; --t3f: #7d5300; --t4b: #efe6fa; --t4f: #5b2f99; --t5b: #e0f3f4; --t5f: #145f66;
  --t6b: #fae6f0; --t6f: #8c1f55; --t7b: #ececec; --t7f: #3d3d3d;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #161614; --fg: #ecebe6; --muted: #a29f96; --card: #201f1c; --border: #3a3833;
    --accent: #8fb1f0; --ok: #7cc994; --warn: #e8b05c; --bad: #f08a80; --hl: #4a4220;
    --t0b: #22324f; --t0f: #b9cff7; --t1b: #4a2622; --t1f: #f5bfb5; --t2b: #1f3d2a; --t2f: #a9e2bb;
    --t3b: #3f3420; --t3f: #f0d29a; --t4b: #34284a; --t4f: #d6c2f5; --t5b: #1d3b3e; --t5f: #a6e0e5;
    --t6b: #45233a; --t6f: #f3b9d6; --t7b: #33322f; --t7f: #d8d6d0;
  }
}
:root[data-theme="dark"] {
  --bg: #161614; --fg: #ecebe6; --muted: #a29f96; --card: #201f1c; --border: #3a3833;
  --accent: #8fb1f0; --ok: #7cc994; --warn: #e8b05c; --bad: #f08a80; --hl: #4a4220;
  --t0b: #22324f; --t0f: #b9cff7; --t1b: #4a2622; --t1f: #f5bfb5; --t2b: #1f3d2a; --t2f: #a9e2bb;
  --t3b: #3f3420; --t3f: #f0d29a; --t4b: #34284a; --t4f: #d6c2f5; --t5b: #1d3b3e; --t5f: #a6e0e5;
  --t6b: #45233a; --t6f: #f3b9d6; --t7b: #33322f; --t7f: #d8d6d0;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
body { overflow-wrap: anywhere; }
.wrap { max-width: 980px; margin: 0 auto; padding: 24px 16px 64px; }
header h1 { margin: 0 0 4px; font-size: 26px; line-height: 1.2; }
.summary { margin: 0; font-size: 17px; font-weight: 600; }
.sub { margin: 6px 0 0; color: var(--muted); font-size: 13px; }
h2 { font-size: 18px; margin: 32px 0 10px; }
h3 { font-size: 15px; margin: 16px 0 6px; }
code { font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
a { color: var(--accent); }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
.attn ul { margin: 0; padding-left: 20px; }
.attn li { margin: 4px 0; overflow-wrap: anywhere; }
.attn h3 .n { color: var(--muted); font-weight: 400; }
.attn h3.bad { color: var(--bad); } .attn h3.warn { color: var(--warn); }
.calm { color: var(--ok); margin: 0; }
button.look { font: inherit; font-size: 12px; margin-left: 6px; padding: 1px 8px; cursor: pointer;
  color: var(--accent); background: transparent; border: 1px solid var(--border); border-radius: 10px; }
input[type="search"] { width: 100%; font: inherit; padding: 9px 12px; color: var(--fg);
  background: var(--card); border: 1px solid var(--border); border-radius: 8px; }
#results { margin-top: 10px; }
#results .count { color: var(--muted); font-size: 13px; margin: 0 0 6px; }
.file { margin: 6px 0; }
.file > summary { cursor: pointer; }
.rows { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 14px; margin: 8px 0 4px; font-size: 14px; }
.rows dt { color: var(--muted); }
.rows dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.rows dd div + div { margin-top: 2px; }
details.area, details.concern { margin: 6px 0; }
details.area > summary, details.concern > summary { cursor: pointer; padding: 6px 0; list-style-position: outside; }
.kids { margin-left: 10px; padding-left: 14px; border-left: 2px solid var(--border); }
.title { font-weight: 600; }
.id { color: var(--muted); margin-left: 6px; }
.badge { font-size: 12px; border: 1px solid var(--border); color: var(--muted); border-radius: 10px; padding: 0 7px; margin-left: 6px; }
.tag { display: inline-block; font-size: 12px; line-height: 18px; border-radius: 9px; padding: 0 8px;
  margin: 2px 0 2px 6px; text-decoration: none; }
${Array.from({ length: TAG_COLOURS }, (_, i) => `.t${i} { background: var(--t${i}b); color: var(--t${i}f); }`).join("\n")}
.body { padding: 0 0 6px 18px; }
.intents { margin: 2px 0 6px; padding-left: 18px; }
.health { margin: 4px 0; font-size: 13px; color: var(--muted); }
.health .ok { color: var(--ok); } .health .warn { color: var(--warn); } .health .bad { color: var(--bad); }
details.rules { font-size: 14px; margin: 4px 0; }
details.rules > summary { cursor: pointer; color: var(--muted); }
details.rules ul { margin: 4px 0; padding-left: 18px; }
.flash { animation: flash 2s ease-out; }
@keyframes flash { from { background: var(--hl); } to { background: transparent; } }
@media (max-width: 560px) { .rows { grid-template-columns: minmax(0, 1fr); } .kids { margin-left: 4px; padding-left: 10px; } .body { padding-left: 8px; } .rows dt { margin-top: 6px; } }
`;

// Plain JS for the search box and for opening the tree at a link. No template literals here.
const SCRIPT = `
(function () {
  var data = JSON.parse(document.getElementById("files").textContent);
  var q = document.getElementById("q");
  var out = document.getElementById("results");
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function row(dl, label, lines) {
    dl.appendChild(el("dt", null, label));
    var dd = el("dd");
    if (!lines.length) lines = ["(none)"];
    lines.forEach(function (l) { dd.appendChild(el("div", null, l)); });
    dl.appendChild(dd);
  }
  function card(f, open) {
    var d = el("details", "file card");
    if (open) d.open = true;
    var s = el("summary");
    s.appendChild(el("code", null, f.file));
    d.appendChild(s);
    var dl = el("dl", "rows");
    var home = f.home ? f.home + "  (covers: " + f.homePattern + ")"
      : f.conflict.length ? "(conflict: " + f.conflict.join(", ") + ") E004, treated as root"
      : "(none) orphan, treated as root for permissions";
    row(dl, "home", [home]);
    row(dl, "parents", f.parents.length ? [f.parents.join(", ")] : []);
    row(dl, "concerns", f.concerns.length ? [f.concerns.join(", ")] : []);
    row(dl, "rules", f.rules.map(function (r) { return r.address + ": " + r.text; }));
    row(dl, "checks", f.checks.length ? [f.checks.join(", ")] : []);
    row(dl, "may edit", f.mayEdit.length ? [f.mayEdit.map(function (w) {
      return w.scope === "context" ? w.agent + " (context only)" : w.agent; }).join(", ")] : []);
    row(dl, "blocked", f.blocked.length ? [f.blocked.map(function (w) {
      return w.agent + " (" + w.reason + ")"; }).join(", ")] : []);
    row(dl, "decisions", f.decisions.map(function (x) {
      return x.address + ": " + x.text + (x.rejected.length ? " (rejected: " + x.rejected.join("; ") + ")" : ""); }));
    d.appendChild(dl);
    return d;
  }
  function search() {
    var term = q.value.trim().toLowerCase();
    out.textContent = "";
    if (!term) return;
    var hits = data.filter(function (f) { return f.file.toLowerCase().indexOf(term) !== -1; });
    var exact = data.filter(function (f) { return f.file.toLowerCase() === term; });
    if (exact.length) hits = exact;
    var shown = hits.slice(0, 50);
    out.appendChild(el("p", "count", hits.length === 0 ? "No tracked file matches."
      : hits.length + (hits.length === 1 ? " file" : " files") + (hits.length > shown.length ? ", showing the first 50" : "")));
    shown.forEach(function (f) { out.appendChild(card(f, shown.length <= 3)); });
  }
  q.addEventListener("input", search);
  document.querySelectorAll("button.look").forEach(function (b) {
    b.addEventListener("click", function () {
      q.value = b.getAttribute("data-file");
      search();
      q.scrollIntoView({ block: "start" });
    });
  });
  function reveal() {
    var id = decodeURIComponent(location.hash.slice(1));
    var t = id && document.getElementById(id);
    if (!t) return;
    for (var p = t; p; p = p.parentElement) if (p.tagName === "DETAILS") p.open = true;
    t.scrollIntoView({ block: "start" });
    t.classList.remove("flash");
    void t.offsetWidth;
    t.classList.add("flash");
  }
  window.addEventListener("hashchange", reveal);
  reveal();
})();
`;

export function renderHtml(model: MapModel): string {
  const byId = new Map(model.capsules.map((c) => [c.id, c]));
  const concernIds = model.capsules.filter((c) => c.kind === "concern").map((c) => c.id);
  const anchor = (id: string) => (byId.get(id)?.kind === "concern" ? `con-${id}` : `cap-${id}`);
  const tag = (k: string) =>
    `<a class="tag t${Math.max(0, concernIds.indexOf(k)) % TAG_COLOURS}" href="#con-${esc(k)}">${esc(k)}</a>`;

  const health = (c: MapCapsule) => {
    const parts: string[] = [`${plural(c.contracts.length, "rule")}`];
    const pass = c.checks.filter((k) => k.status === "pass").length;
    const fail = c.checks.filter((k) => k.status === "fail" || k.status === "timeout").length;
    const notRun = c.checks.length - pass - fail;
    if (c.checks.length) {
      const bits = [
        ...(pass ? [`${pass} passed`] : []),
        ...(fail ? [`${fail} failed`] : []),
        ...(notRun ? [`${notRun} not run`] : []),
      ];
      parts.push(
        `<span class="${fail ? "bad" : notRun ? "" : "ok"}">${plural(c.checks.length, "check")}: ${bits.join(", ")}</span>`,
      );
    } else parts.push("no checks");
    if (c.stale) parts.push(`<span class="warn">${c.stale} stale</span>`);
    if (c.orphansNearby.length)
      parts.push(`<span class="warn">${plural(c.orphansNearby.length, "orphan")} nearby</span>`);
    parts.push(plural(c.files.length, "file"));
    return `<p class="health">${parts.join(" · ")}</p>`;
  };

  const rules = (c: MapCapsule) =>
    c.contracts.length
      ? `<details class="rules"><summary>${plural(c.contracts.length, "rule")}</summary><ul>${c.contracts
          .map(
            (r) =>
              `<li><code>${esc(r.address)}</code> ${esc(r.text)}${r.scope === "own" ? ' <span class="badge">this capsule only</span>' : ""}</li>`,
          )
          .join("")}</ul></details>`
      : "";

  const intents = (c: MapCapsule) =>
    c.intents.length
      ? `<ul class="intents">${c.intents.map((i) => `<li>${esc(i.text)}</li>`).join("")}</ul>`
      : "";

  const area = (c: MapCapsule): string =>
    [
      `<details class="area" open id="${anchor(c.id)}">`,
      `<summary><span class="title">${esc(c.title)}</span><code class="id">${esc(c.id)}</code>`,
      c.status === "draft" ? '<span class="badge">draft</span>' : "",
      c.related.map(tag).join(""),
      "</summary>",
      `<div class="body">`,
      intents(c),
      health(c),
      rules(c),
      c.children.length
        ? `<div class="kids">${c.children
            .map((k) => byId.get(k))
            .filter((k): k is MapCapsule => Boolean(k))
            .map(area)
            .join("")}</div>`
        : "",
      "</div></details>",
    ].join("");

  const roots = model.capsules.filter(
    (c) => c.kind === "area" && (c.id === "root" || !byId.has(c.parent ?? "root")),
  );
  const concerns = model.capsules.filter((c) => c.kind === "concern");

  const concern = (c: MapCapsule) =>
    [
      `<details class="concern card" open id="${anchor(c.id)}">`,
      `<summary>${tag(c.id)} <span class="title">${esc(c.title)}</span></summary>`,
      `<div class="body">`,
      intents(c),
      health(c),
      rules(c),
      `<p class="health">cuts across: ${
        c.related.length
          ? c.related.map((a) => `<a href="#${anchor(a)}">${esc(a)}</a>`).join(", ")
          : "no area yet"
      }</p>`,
      c.files.length
        ? `<details class="rules"><summary>${plural(c.files.length, "file")} it covers</summary><ul>${c.files
            .map(
              (f) =>
                `<li><code>${esc(f)}</code><button class="look" type="button" data-file="${esc(f)}">look up</button></li>`,
            )
            .join("")}</ul></details>`
        : "",
      "</div></details>",
    ].join("");

  const item = (a: AttentionItem) =>
    `<li><a href="#${anchor(a.capsule)}">${esc(a.capsule)}</a>: ${esc(a.text)}${
      a.file ? `<button class="look" type="button" data-file="${esc(a.file)}">look up</button>` : ""
    }</li>`;

  const groups = KIND_TITLES.map(([kind, title, cls]) => {
    const items = model.attention.filter((a) => a.kind === kind);
    if (!items.length) return "";
    return `<h3 class="${cls}">${title} <span class="n">(${items.length})</span></h3><ul>${items.map(item).join("")}</ul>`;
  }).join("");

  const files = model.files.map((f: FileExplanation) => ({
    file: f.file,
    home: f.home,
    homePattern: f.homePattern,
    conflict: f.conflict,
    parents: f.parents,
    concerns: f.concerns,
    rules: f.rules.map((r) => ({ address: r.address, text: r.text })),
    checks: f.checks,
    mayEdit: f.mayEdit,
    blocked: f.blocked,
    decisions: f.decisions,
  }));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<title>${esc(model.title)} capsules map</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header>
<h1>${esc(model.title)}</h1>
<p class="summary" id="summary">${esc(model.summary.line)}</p>
<p class="sub">The capsules map: what each part is for, and the rules it keeps. Made by <code>capsules map</code> from <code>.capsules/</code>; works offline. Rebuild it after changes.</p>
</header>
<section class="attn" id="attention">
<h2>Needs attention${model.attention.length ? ` (${model.attention.length})` : ""}</h2>
<div class="card">${groups || '<p class="calm">Nothing needs attention: no stale rules, failing or unreviewed checks, or orphan files.</p>'}</div>
</section>
<section id="search">
<h2>Find a file</h2>
<input id="q" type="search" placeholder="Type part of a path, e.g. src/web" aria-label="Find a file" autocomplete="off">
<div id="results" aria-live="polite"></div>
</section>
<section id="tree">
<h2>Areas</h2>
${roots.map(area).join("\n")}
</section>
<section id="concerns">
<h2>Concerns</h2>
${concerns.length ? concerns.map(concern).join("\n") : "<p>No concerns yet. Concerns are rules that cut across areas, like payments or pii (.capsules/_concerns/).</p>"}
</section>
</div>
<script type="application/json" id="files">${scriptJson(files)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
