import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalNodeText,
  capsuleHash,
  jcs,
  nodeHash,
  normaliseText,
  shortestPrefixes,
} from "../../src/core/hash.js";
import { parseCapsuleFile } from "../../src/core/parse.js";

const sha12 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 12);

function node(text: string, id = "C1") {
  const r = parseCapsuleFile(
    `---\ntitle: T\n---\n\n${text}`,
    ".capsules/billing.md",
    "billing",
    "area",
  );
  const n = r.capsule.nodes.find((x) => x.id === id);
  if (!n) throw new Error("node not parsed");
  return n;
}

describe("JSON Canonicalization Scheme, RFC 8785 (D-012)", () => {
  it("sorts object keys by UTF-16 code units (RFC 8785 section 3.2.3 example)", () => {
    const input = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      דּ: "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
      "\u0080": "Control",
      ö: "Latin Small Letter O With Diaeresis",
    };
    const keys = Object.keys(JSON.parse(jcs(input)));
    // JSON.parse reorders integer-like keys, so compare the raw output instead.
    expect(keys).toBeDefined();
    expect(jcs(input)).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}',
    );
  });

  it("serialises numbers like ECMAScript (RFC 8785 section 3.2.2.3)", () => {
    expect(jcs([1e21, 1e-7, 0.000001, -0, 333333333.3333333, 4.5, 2e-3])).toBe(
      "[1e+21,1e-7,0.000001,0,333333333.3333333,4.5,0.002]",
    );
  });

  it("escapes strings minimally (RFC 8785 section 3.2.2.2)", () => {
    expect(jcs('€$\u000f\nA\'B"\\\\"/')).toBe('"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"');
  });

  it("handles nesting, null, booleans and empty containers", () => {
    expect(jcs({ b: [true, null, {}], a: { d: [], c: false } })).toBe(
      '{"a":{"c":false,"d":[]},"b":[true,null,{}]}',
    );
  });

  it("rejects values JSON can't represent", () => {
    expect(() => jcs(Number.NaN)).toThrow();
    expect(() => jcs(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => jcs(undefined)).toThrow();
  });
});

describe("normalisation (C7.1 step 2)", () => {
  it("converts CRLF/CR, applies NFC, strips trailing spaces, trims and collapses blank lines", () => {
    expect(normaliseText("\n\nA  \r\nbé\r\r\r\nc\t\n\n")).toBe("A\nbé\n\nc");
  });
});

describe("node hash (C7.1)", () => {
  const c1 = node(
    "## contract C1 serves @I1\nNever create two invoices for the same customer and period.\nchecked-by: @no-duplicates\n",
  );

  it("builds the canonical text: type and id, sorted fully-qualified links, ---, body", () => {
    expect(canonicalNodeText(c1)).toBe(
      [
        "contract C1",
        "checked-by billing#no-duplicates",
        "serves billing#I1",
        "---",
        "Never create two invoices for the same customer and period.",
        "checked-by: @no-duplicates",
      ].join("\n"),
    );
  });

  it("is the first 12 hex characters of SHA-256 of that text", () => {
    expect(nodeHash(c1)).toBe(sha12(canonicalNodeText(c1)));
    expect(nodeHash(c1)).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is frozen: this exact node always hashes to the same value (B11)", () => {
    // Cross-checked with Python hashlib, independent of this code.
    expect(nodeHash(c1)).toBe("a454f81937ba");
  });

  it("ignores formatting: CRLF, trailing spaces, extra blank lines, Prettier's blank line", () => {
    const messy = node(
      "## contract C1 serves @I1\r\n\r\nNever create two invoices for the same customer and period.   \r\n\r\n\r\nchecked-by: @no-duplicates\r\n",
    );
    const tidy = node(
      "## contract C1 serves @I1\nNever create two invoices for the same customer and period.\n\nchecked-by: @no-duplicates\n",
    );
    expect(nodeHash(messy)).toBe(nodeHash(tidy));
  });

  it("treats composed and decomposed accents the same (NFC)", () => {
    expect(nodeHash(node("## intent I1\ncafé\n", "I1"))).toBe(
      nodeHash(node("## intent I1\ncafé\n", "I1")),
    );
  });

  it("changes when the wording changes", () => {
    const changed = node(
      "## contract C1 serves @I1\nNever create two invoices for one customer and period.\nchecked-by: @no-duplicates\n",
    );
    expect(nodeHash(changed)).not.toBe(nodeHash(c1));
  });

  it("changes when a link changes, and same-capsule refs equal fully-qualified ones", () => {
    const other = node(
      "## contract C1 serves @I2\nNever create two invoices for the same customer and period.\nchecked-by: @no-duplicates\n",
    );
    expect(nodeHash(other)).not.toBe(nodeHash(c1));
    const qualified = node(
      "## contract C1 serves @billing#I1\nNever create two invoices for the same customer and period.\nchecked-by: @no-duplicates\n",
    );
    expect(canonicalNodeText(qualified).split("\n").slice(0, 3)).toEqual(
      canonicalNodeText(c1).split("\n").slice(0, 3),
    );
  });

  it("keeps a transclusion placeholder in the body (C2.5)", () => {
    const ctx = node("## context k derived-from @D1\nKeys use both. {{ @C1 }}\n", "k");
    expect(canonicalNodeText(ctx)).toBe(
      "context k\nderived-from billing#D1\nuses billing#C1\n---\nKeys use both. {{ @C1 }}",
    );
  });
});

describe("capsule (front matter) hash (C7.1 step 5, D-012)", () => {
  const base = "title: Invoices\nowners: [parth]\ncovers:\n  - src/a/**\n";

  it("ignores comments, key order, quoting, flow vs block style and CRLF", () => {
    const other =
      "# a comment\r\ncovers: ['src/a/**']   # inline\r\nowners:\r\n  - \"parth\"\r\ntitle: 'Invoices'\r\n";
    expect(capsuleHash(other)).toBe(capsuleHash(base));
  });

  it("hashes the JCS form of the parsed value", () => {
    expect(capsuleHash(base)).toBe(
      sha12('{"covers":["src/a/**"],"owners":["parth"],"title":"Invoices"}'),
    );
  });

  it("changes when a value changes", () => {
    expect(capsuleHash(base.replace("src/a/**", "src/b/**"))).not.toBe(capsuleHash(base));
  });

  it("is frozen (cross-checked with Python hashlib)", () => {
    expect(capsuleHash(base)).toBe("2e6540dc2fbd");
  });
});

describe("shortest unique prefixes (C7.1 step 4)", () => {
  it("are at least 4 characters and unique", () => {
    expect(shortestPrefixes(["a91f2c81d0b4", "a91f3000aaaa", "3c07aa12e9f1"])).toEqual(
      new Map([
        ["a91f2c81d0b4", "a91f2"],
        ["a91f3000aaaa", "a91f3"],
        ["3c07aa12e9f1", "3c07"],
      ]),
    );
  });
});
