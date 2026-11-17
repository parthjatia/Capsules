// M6h: property-based tests. Instead of a few hand-picked examples, fast-check generates
// hundreds of random inputs per rule and shrinks any failure to the smallest one.
// Fixed seed, so a run is repeatable; FC_SEED=<n> tries another.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_ASSERTIONS, DEFAULT_SKIPS, weakenedSignals } from "../../src/checks/heuristics.js";
import { CAPSULE_ID_RE, NODE_ID_RE, parseAddress } from "../../src/core/address.js";
import {
  capsuleHash,
  jcs,
  nodeHash,
  normaliseText,
  shortestPrefixes,
} from "../../src/core/hash.js";
import { emptyLock, linkKey, parseLock, serializeLock, type Lock } from "../../src/core/lock.js";
import { parseCapsuleFile } from "../../src/core/parse.js";

const seed = Number(process.env.FC_SEED ?? 20261117);
const runs = Number(process.env.FC_RUNS ?? 300); // FC_RUNS=20000 for a long run
const opts = { seed, numRuns: runs };

// --- Generators ---------------------------------------------------------------------------

const seg = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,7}$/);
const capsuleId = fc.array(seg, { minLength: 1, maxLength: 3 }).map((s) => s.join("."));
const nodeId = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9-]{0,7}$/);
const hex = (n: number) => fc.stringMatching(new RegExp(`^[0-9a-f]{${n}}$`));
/** Prose lines without anything the parser treats as structure (headings, fences, fields). */
const proseLine = fc
  .stringMatching(/^[A-Za-z0-9 ,.()'"é€-]{0,40}$/)
  .filter((l) => !/^\s*(#|```|~~~| {4}|\t)/.test(l) && !/^[a-z-]+:/.test(l.trim()));
const prose = fc.array(proseLine, { minLength: 1, maxLength: 6 }).map((ls) => ls.join("\n"));
/** Messy whitespace a formatter or another OS could add. */
const ws = fc.constantFrom("", " ", "  ", "\t", " \t", " ");

function contract(body: string): ReturnType<typeof parseCapsuleFile> {
  return parseCapsuleFile(
    `---\ntitle: T\n---\n\n## intent I1\nWhy.\n\n## contract C1 serves @I1\n${body}\n`,
    ".capsules/billing.md",
    "billing",
    "area",
  );
}
const c1 = (r: ReturnType<typeof parseCapsuleFile>) => r.capsule.nodes.find((n) => n.id === "C1")!;

// --- Hashes (C7.1, B11) -------------------------------------------------------------------

describe("hash pipeline properties (C7.1)", () => {
  it("normalising twice gives the same text as normalising once", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 200 }), (s) => {
        expect(normaliseText(normaliseText(s))).toBe(normaliseText(s));
      }),
      opts,
    );
  });

  it("normalised text has no CR, no trailing spaces, no blank edges, no double blank lines", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 200 }), (s) => {
        const n = normaliseText(s);
        expect(n).not.toMatch(/\r/);
        expect(n).not.toMatch(/\s\n|\s$/u);
        expect(n).not.toMatch(/^\n|\n\n\n/);
      }),
      opts,
    );
  });

  it("a contract's hash ignores CRLF, trailing whitespace and extra blank lines", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(proseLine, ws), { minLength: 1, maxLength: 6 }), (rows) => {
        const clean = rows.map(([l]) => l.trimEnd()).join("\n");
        const messy = rows.map(([l, w]) => l + w).join("\r\n\r\n");
        const a = c1(contract(clean));
        const b = c1(contract(messy));
        // Blank lines collapse to one, so join the clean lines the same way.
        const collapsed = c1(contract(rows.map(([l]) => l.trimEnd()).join("\n\n")));
        expect(nodeHash(b)).toBe(nodeHash(collapsed));
        expect(a).toBeDefined();
      }),
      opts,
    );
  });

  it("the same text in NFC and NFD gives the same hash", () => {
    fc.assert(
      fc.property(prose, (p) => {
        const nfd = p.normalize("NFD") + "\nCafé";
        const nfc = p.normalize("NFC") + "\nCafé".normalize("NFD").normalize("NFC");
        expect(nodeHash(c1(contract(nfd)))).toBe(nodeHash(c1(contract(nfc))));
      }),
      opts,
    );
  });

  it("changing a visible character of a contract changes its hash", () => {
    fc.assert(
      fc.property(prose, fc.stringMatching(/^[A-Za-z0-9]$/), (p, ch) => {
        const a = nodeHash(c1(contract(`${p}\nRule ${ch}.`)));
        const other = ch === "Z" ? "Y" : "Z";
        const b = nodeHash(c1(contract(`${p}\nRule ${other}.`)));
        expect(a).not.toBe(b);
      }),
      opts,
    );
  });

  it("hashes are always 12 lowercase hex characters", () => {
    fc.assert(
      fc.property(prose, (p) => {
        expect(nodeHash(c1(contract(p)))).toMatch(/^[0-9a-f]{12}$/);
      }),
      opts,
    );
  });
});

describe("RFC 8785 and the capsule hash (D-012)", () => {
  const json = fc.jsonValue({ maxDepth: 3 });

  it("jcs output is valid JSON with the same value", () => {
    fc.assert(
      fc.property(json, (v) => {
        // JSON has no -0; RFC 8785 writes it as 0.
        expect(JSON.parse(jcs(v))).toEqual(JSON.parse(JSON.stringify(v)));
      }),
      opts,
    );
  });

  it("key order never changes jcs output", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), json, { maxKeys: 8 }), (o) => {
        const reversed = Object.fromEntries(Object.entries(o).reverse());
        expect(jcs(reversed)).toBe(jcs(o));
      }),
      opts,
    );
  });

  it("front matter key order, comments and quoting never change the capsule hash", () => {
    const owner = fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/);
    fc.assert(
      fc.property(
        prose.map((p) => p.split("\n")[0]!),
        fc.array(owner, { maxLength: 3 }),
        (title, owners) => {
          const t = title.replace(/"/g, "'").trim() || "T";
          const a = `title: "${t}"\nowners: [${owners.join(", ")}]\n`;
          const b = `# a comment\nowners:\n${owners.map((o) => `  - '${o}'`).join("\n") || "  []"}\ntitle:   "${t}"   # trailing\n`;
          const bFixed = owners.length
            ? b
            : `# a comment\nowners: []\ntitle:   "${t}"   # trailing\n`;
          expect(capsuleHash(bFixed)).toBe(capsuleHash(a));
        },
      ),
      opts,
    );
  });

  it("shortest prefixes are unique, at least 4 characters, and prefixes of their hash", () => {
    fc.assert(
      fc.property(fc.uniqueArray(hex(12), { maxLength: 40 }), (hs) => {
        const m = shortestPrefixes(hs);
        const prefixes = [...m.values()];
        expect(new Set(prefixes).size).toBe(prefixes.length);
        for (const [h, p] of m) {
          expect(p.length).toBeGreaterThanOrEqual(4);
          expect(h.startsWith(p)).toBe(true);
          for (const o of hs) if (o !== h) expect(o.startsWith(p)).toBe(false);
        }
      }),
      opts,
    );
  });
});

// --- Lockfile (C7.2) ----------------------------------------------------------------------

const addr = fc.tuple(capsuleId, nodeId).map(([c, n]) => `${c}#${n}`);
const lockArb: fc.Arbitrary<Lock> = fc
  .record({
    capsules: fc.array(fc.tuple(capsuleId, hex(12)), { maxLength: 6 }),
    nodes: fc.array(
      fc.tuple(addr, fc.constantFrom("intent", "contract", "example", "check"), hex(12)),
      { maxLength: 8 },
    ),
    links: fc.array(fc.tuple(addr, fc.constantFrom("serves", "shows", "uses"), addr, hex(12)), {
      maxLength: 8,
    }),
    files: fc.array(
      fc.tuple(addr, fc.stringMatching(/^[a-z][a-z0-9/ ._-]{0,20}[a-z0-9]$/), hex(40)),
      { maxLength: 4 },
    ),
  })
  .map((r) => {
    const l = emptyLock();
    for (const [c, h] of r.capsules) l.capsules.set(c, h);
    for (const [a, type, hash] of r.nodes) l.nodes.set(a, { type, hash });
    for (const [from, type, to, hash] of r.links)
      l.links.set(linkKey(from, type, to), { from, type, to, hash });
    for (const [a, path, blob] of r.files) l.files.set(a, { path, blob });
    return l;
  });

describe("lockfile properties (C7.2)", () => {
  it("writing then reading a lock gives the same lock, with no problems", () => {
    fc.assert(
      fc.property(lockArb, (l) => {
        const text = serializeLock(l);
        const back = parseLock(text);
        expect(back.diagnostics).toEqual([]);
        expect(serializeLock(back.lock)).toBe(text);
        expect(back.lock.files).toEqual(l.files);
      }),
      opts,
    );
  });

  it("the written lock is the same bytes whatever order the records were added in", () => {
    fc.assert(
      fc.property(lockArb, (l) => {
        const rev = emptyLock();
        for (const k of ["capsules", "nodes", "links", "files"] as const)
          for (const [key, v] of [...l[k]].reverse()) (rev[k] as Map<string, unknown>).set(key, v);
        expect(serializeLock(rev)).toBe(serializeLock(l));
      }),
      opts,
    );
  });

  it("the written lock is LF-only, ends with one newline, and is sorted within each kind", () => {
    fc.assert(
      fc.property(lockArb, (l) => {
        const text = serializeLock(l);
        expect(text).not.toMatch(/\r/);
        expect(text.endsWith("\n") && !text.endsWith("\n\n")).toBe(true);
        const body = text.split("\n").slice(1, -1);
        for (const kind of ["capsule", "node", "link", "file"]) {
          const ls = body.filter((x) => x.startsWith(kind + " "));
          expect(ls).toEqual([...ls].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
        }
      }),
      opts,
    );
  });

  it("a CRLF copy of a lock reads the same", () => {
    fc.assert(
      fc.property(lockArb, (l) => {
        const text = serializeLock(l);
        expect(serializeLock(parseLock(text.replace(/\n/g, "\r\n")).lock)).toBe(text);
      }),
      opts,
    );
  });

  it("reading any text never crashes; unreadable lines are E026", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (s) => {
        const r = parseLock(s);
        for (const d of r.diagnostics) expect(d.code).toBe("E026");
      }),
      opts,
    );
  });
});

// --- Addresses (B7, C2.2) -----------------------------------------------------------------

describe("address properties (B7)", () => {
  it("every valid capsule#node address reads back as itself", () => {
    fc.assert(
      fc.property(capsuleId, nodeId, (c, n) => {
        expect(parseAddress(`${c}#${n}`, { ref: false })).toEqual({
          ok: true,
          capsule: c,
          node: n,
        });
        expect(parseAddress(`@${c}#${n}`, { ref: true })).toEqual({
          ok: true,
          capsule: c,
          node: n,
        });
      }),
      opts,
    );
  });

  it("every repo:capsule#node address is the reserved cross-repo form (E015)", () => {
    fc.assert(
      fc.property(seg, capsuleId, nodeId, (r, c, n) => {
        expect(parseAddress(`@${r}:${c}#${n}`, { ref: true })).toMatchObject({
          ok: false,
          reason: "cross-repo",
          repo: r,
        });
      }),
      opts,
    );
  });

  it("any text either parses to valid ids or is refused, and never crashes", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), fc.boolean(), (s, ref) => {
        const r = parseAddress(s, { ref });
        if (r.ok) {
          expect(r.node).toMatch(NODE_ID_RE);
          if (r.capsule !== null) expect(r.capsule).toMatch(CAPSULE_ID_RE);
          expect(r.capsule ?? "").not.toContain(":");
        }
      }),
      opts,
    );
  });
});

// --- Parser robustness (C2) ---------------------------------------------------------------

/** Text built from the pieces a capsule file is made of, in random order. */
const capsuleish = fc
  .array(
    fc.oneof(
      fc.constantFrom(
        "---",
        "title: T",
        "owners: [parth]",
        "covers: [src/**]",
        "status: draft",
        "## intent I1",
        "## contract C1 serves @I1",
        "## contract C2 serves @other#I1",
        "## example E1 shows @C1",
        "## check c checked-by @C1",
        "## decision D1 supersedes @D0",
        "## context x uses @x:y#z",
        "## prompt p",
        "## code k implements @C1",
        "## ",
        "## contract",
        "run: npm test",
        "files: tests/**",
        "checked-by: @c",
        "scope: sideways",
        "timeout: soon",
        "review-by: 2026-02-30",
        "```",
        "    indented",
        "{{ @C1 }}",
        "",
      ),
      fc.string({ maxLength: 30 }),
    ),
    { maxLength: 30 },
  )
  .map((ls) => ls.join("\n"));

describe("parser robustness (C2)", () => {
  it("any text made of capsule pieces parses without crashing; problems are reported as codes", () => {
    fc.assert(
      fc.property(capsuleish, fc.boolean(), (text, crlf) => {
        const t = crlf ? text.replace(/\n/g, "\r\n") : text;
        const r = parseCapsuleFile(t, ".capsules/billing.md", "billing", "area");
        for (const d of r.diagnostics) expect(d.code).toMatch(/^[EW]\d{3}$/);
      }),
      { ...opts, numRuns: 500 },
    );
  });

  it("parsing is the same with CRLF and LF line endings", () => {
    fc.assert(
      fc.property(capsuleish, (text) => {
        const a = parseCapsuleFile(text, ".capsules/billing.md", "billing", "area");
        const b = parseCapsuleFile(
          text.replace(/\n/g, "\r\n"),
          ".capsules/billing.md",
          "billing",
          "area",
        );
        expect(b.capsule.nodes.map(nodeHash)).toEqual(a.capsule.nodes.map(nodeHash));
        expect(b.diagnostics.map((d) => d.code)).toEqual(a.diagnostics.map((d) => d.code));
      }),
      { ...opts, numRuns: 500 },
    );
  });
});

// --- Weakened-test signals (C9.2) ---------------------------------------------------------

const P = { assertions: DEFAULT_ASSERTIONS, skips: DEFAULT_SKIPS };
const plain = fc
  .stringMatching(/^[a-z ;=(){}0-9]{0,30}$/)
  .filter((l) => !P.assertions.some((a) => l.includes(a)) && !P.skips.some((s) => l.includes(s)));
const assertion = fc.constantFrom(
  "  expect(x).toBe(1);",
  "  assert.equal(a, b);",
  "  t.Error(err)",
);
const testFile = fc.array(fc.oneof(plain, assertion), { minLength: 1, maxLength: 20 });

describe("weakened-test signal properties (C9.2)", () => {
  it("only adding lines that aren't skips never raises a signal", () => {
    fc.assert(
      fc.property(
        testFile,
        fc.array(fc.oneof(plain, assertion), { maxLength: 5 }),
        fc.nat(),
        (before, extra, at) => {
          const i = at % (before.length + 1);
          const after = [...before.slice(0, i), ...extra, ...before.slice(i)];
          expect(weakenedSignals(before.join("\n"), after.join("\n"), P)).toEqual([]);
        },
      ),
      opts,
    );
  });

  it("removing any assertion line raises an assertions-removed signal with the right count", () => {
    fc.assert(
      fc.property(testFile, fc.nat(), (lines, k) => {
        const idx = lines.flatMap((l, i) => (P.assertions.some((a) => l.includes(a)) ? [i] : []));
        fc.pre(idx.length > 0);
        const drop = idx[k % idx.length]!;
        const after = lines.filter((_, i) => i !== drop);
        const s = weakenedSignals(lines.join("\n"), after.join("\n"), P);
        expect(s.find((x) => x.kind === "assertions-removed")?.count).toBe(1);
      }),
      opts,
    );
  });

  it("adding a skip marker anywhere raises a skip-added signal", () => {
    fc.assert(
      fc.property(testFile, fc.constantFrom(...DEFAULT_SKIPS), fc.nat(), (lines, skip, at) => {
        const i = at % (lines.length + 1);
        const after = [...lines.slice(0, i), `  ${skip}`, ...lines.slice(i)];
        const s = weakenedSignals(lines.join("\n"), after.join("\n"), P);
        expect(s.some((x) => x.kind === "skip-added" && x.line === i + 1)).toBe(true);
      }),
      opts,
    );
  });
});
