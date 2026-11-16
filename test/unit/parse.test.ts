import { describe, expect, it } from "vitest";
import { parseCapsuleFile } from "../../src/core/parse.js";

// The C2 example from the spec, verbatim.
const SPEC_EXAMPLE = `---
title: Invoices
owners: [parth]
covers:
  - src/billing/invoices/**
  - prompts/invoice-agent.md
excludes: []
status: active            # active | draft (draft capsules never block)
---

# Invoices

## intent I1
Each customer is charged exactly once per billing period, net of refunds.

## contract C1 serves @I1
Never create two invoices for the same customer and period.
checked-by: @no-duplicates

## example E1 shows @C1
Customer A, period 2026-03, two CreateInvoice calls -> one invoice.
checked-by: @no-duplicates

## check no-duplicates
run: npm test -- invoices.duplicates
files: tests/invoices/duplicates.test.ts

## assumption A3
Fewer than 1,000 invoices per minute.
review-by: 2027-06-01

## decision D7 serves @C1 assumes @A3 supersedes @D3
Use Stripe for invoice creation.
rejected: own ledger (3 weeks of work, no audit trail)

## context idempotency derived-from @D7
Stripe idempotency keys are built from customer_id + period.
Always pass both. {{ @C1 }}

## prompt invoice-agent
file: prompts/invoice-agent.md

## code create-invoice implements @C1
src/billing/invoices/create.ts#createInvoice
`;

function parse(text: string, id = "billing.invoices", kind: "area" | "concern" = "area") {
  return parseCapsuleFile(text, ".capsules/billing/invoices.md", id, kind);
}

function codes(text: string, kind: "area" | "concern" = "area") {
  return parse(text, kind === "concern" ? "pii" : "billing.invoices", kind).diagnostics.map(
    (d) => d.code,
  );
}

const FM = "---\ntitle: T\n---\n\n";

describe("parseCapsuleFile: the spec example (C2)", () => {
  const { capsule, diagnostics } = parse(SPEC_EXAMPLE);

  it("has no diagnostics", () => {
    expect(diagnostics).toEqual([]);
  });

  it("reads the front matter", () => {
    expect(capsule.front).toEqual({
      title: "Invoices",
      owners: ["parth"],
      covers: ["src/billing/invoices/**", "prompts/invoice-agent.md"],
      excludes: [],
      status: "active",
    });
  });

  it("finds all nine nodes in order with their heading lines", () => {
    expect(capsule.nodes.map((n) => `${n.type} ${n.id} @${n.line}`)).toEqual([
      "intent I1 @13",
      "contract C1 @16",
      "example E1 @20",
      "check no-duplicates @24",
      "assumption A3 @28",
      "decision D7 @32",
      "context idempotency @36",
      "prompt invoice-agent @40",
      "code create-invoice @43",
    ]);
  });

  it("reads checked-by written after the prose as a field and a link (D-007)", () => {
    const c1 = capsule.nodes[1]!;
    expect(c1.fields).toEqual([{ key: "checked-by", value: "@no-duplicates", line: 18 }]);
    expect(c1.links.map((l) => `${l.type} ${l.ref.raw} ${l.via}`)).toEqual([
      "serves @I1 heading",
      "checked-by @no-duplicates field",
    ]);
    expect(c1.prose).toBe("Never create two invoices for the same customer and period.");
  });

  it("reads multi-link headings", () => {
    const d7 = capsule.nodes[5]!;
    expect(d7.links.map((l) => `${l.type} ${l.ref.node}`)).toEqual([
      "serves C1",
      "assumes A3",
      "supersedes D3",
    ]);
    expect(d7.fields.map((f) => f.key)).toEqual(["rejected"]);
  });

  it("turns {{ @ref }} transclusions into implicit uses links (C2.5)", () => {
    const ctx = capsule.nodes[6]!;
    expect(ctx.links.map((l) => `${l.type} ${l.ref.raw} ${l.via}`)).toEqual([
      "derived-from @D7 heading",
      "uses @C1 transclusion",
    ]);
  });

  it("keeps check fields", () => {
    const check = capsule.nodes[3]!;
    expect(check.fields.map((f) => [f.key, f.value])).toEqual([
      ["run", "npm test -- invoices.duplicates"],
      ["files", "tests/invoices/duplicates.test.ts"],
    ]);
  });

  it("parses CRLF input identically", () => {
    const crlf = parse(SPEC_EXAMPLE.replace(/\n/g, "\r\n"));
    expect(crlf.capsule).toEqual(capsule);
    expect(crlf.diagnostics).toEqual([]);
  });
});

describe("parseCapsuleFile: fields (D-007)", () => {
  it("ignores blank lines under the heading (Prettier style)", () => {
    const r = parse(`${FM}## check t\n\nrun: npm test\n\nfiles: a.test.ts\n`);
    expect(r.diagnostics).toEqual([]);
    expect(r.capsule.nodes[0]!.fields.map((f) => f.key)).toEqual(["run", "files"]);
  });

  it("keeps 'word: text' lines that are not valid keys for the type as prose", () => {
    const r = parse(
      `${FM}## contract C1\nNote: amounts are in cents.\nrun: not a contract field\n`,
    );
    expect(r.capsule.nodes[0]!.fields).toEqual([]);
    expect(r.capsule.nodes[0]!.prose).toBe(
      "Note: amounts are in cents.\nrun: not a contract field",
    );
  });

  it("never reads fields inside fenced code blocks", () => {
    const r = parse(`${FM}## check t\nrun: npm test\n\n\`\`\`yaml\nrun: other\nfiles: x\n\`\`\`\n`);
    expect(r.capsule.nodes[0]!.fields.map((f) => f.value)).toEqual(["npm test"]);
  });

  it("never reads fields inside indented code blocks", () => {
    const r = parse(`${FM}## decision D1\nSome text.\n\n    rejected: inside code\n`);
    expect(r.capsule.nodes[0]!.fields).toEqual([]);
  });

  it("does not treat a ## line inside a code block as a heading", () => {
    const r = parse(`${FM}## context c\n\`\`\`md\n## contract C9\n\`\`\`\n`);
    expect(r.capsule.nodes.map((n) => n.id)).toEqual(["c"]);
  });

  it("allows repeatable fields to repeat", () => {
    const r = parse(`${FM}## check t\nrun: x\nfiles: a\nfiles: b\n`);
    expect(r.diagnostics).toEqual([]);
  });

  it("rejects a repeated single-value field (E007)", () => {
    expect(codes(`${FM}## check t\nrun: x\nrun: y\n`)).toEqual(["E007"]);
  });

  it("accepts several refs in one checked-by field", () => {
    const r = parse(`${FM}## contract C1\nx\nchecked-by: @a, @b\n`);
    expect(r.capsule.nodes[0]!.links.map((l) => l.ref.node)).toEqual(["a", "b"]);
  });

  it("validates field values (E007)", () => {
    expect(codes(`${FM}## contract C1\nx\nscope: everywhere\n`)).toEqual(["E007"]);
    expect(codes(`${FM}## assumption A1\nx\nreview-by: next year\n`)).toEqual(["E007"]);
    expect(codes(`${FM}## check t\nrun: x\ntimeout: soon\n`)).toEqual(["E007"]);
  });
});

describe("parseCapsuleFile: errors", () => {
  it("E001 unknown node type", () => {
    expect(codes(`${FM}## rule R1\nx\n`)).toEqual(["E001"]);
  });

  it("E001 bad id format", () => {
    expect(codes(`${FM}## contract X1\nx\n`)).toEqual(["E001"]);
    expect(codes(`${FM}## check Bad_Slug\nrun: x\n`)).toEqual(["E001"]);
  });

  it("E001 heading without an id", () => {
    expect(codes(`${FM}## intent\nx\n`)).toEqual(["E001"]);
  });

  it("E002 duplicate node id", () => {
    const r = parse(`${FM}## intent I1\na\n\n## intent I1\nb\n`);
    expect(r.diagnostics.map((d) => [d.code, d.line])).toEqual([["E002", 8]]);
  });

  it("E003 malformed reference", () => {
    expect(codes(`${FM}## contract C1 serves I1\nx\n`)).toEqual(["E003"]);
  });

  it("E006 unknown link word", () => {
    expect(codes(`${FM}## contract C1 protects @I1\nx\n`)).toEqual(["E006"]);
  });

  it("E006 link type not allowed from this node type", () => {
    expect(codes(`${FM}## intent I1 serves @I2\nx\n`)).toEqual(["E006"]);
  });

  it("E007 check without run, prompt without file, example without shows", () => {
    expect(codes(`${FM}## check t\nfiles: a\n`)).toEqual(["E007"]);
    expect(codes(`${FM}## prompt p\nsome text\n`)).toEqual(["E007"]);
    expect(codes(`${FM}## example E1\nx\n`)).toEqual(["E007"]);
  });

  it("E008 missing front matter", () => {
    expect(codes(`# T\n\n## intent I1\nx\n`)).toEqual(["E008"]);
  });

  it("E008 missing title, unknown key, bad status, bad YAML", () => {
    expect(codes(`---\ncovers: []\n---\n`)).toEqual(["E008"]);
    expect(codes(`---\ntitle: T\ncover: [a]\n---\n`)).toEqual(["E008"]);
    expect(codes(`---\ntitle: T\nstatus: live\n---\n`)).toEqual(["E008"]);
    expect(codes(`---\ntitle: [unclosed\n---\n`)).toEqual(["E008"]);
  });

  it("E008 concern without covers", () => {
    expect(codes(`---\ntitle: PII\n---\n`, "concern")).toEqual(["E008"]);
  });

  it("E015 cross-repo address in a heading, a field and a transclusion (D-001)", () => {
    const r = parse(
      `${FM}## contract C1 serves @payments-service:billing#I3\nx\nchecked-by: @other:web#t\n\n## context c\n{{ @other:web#C1 }}\n`,
    );
    expect(r.diagnostics.map((d) => d.code)).toEqual(["E015", "E015", "E015"]);
    expect(r.diagnostics[0]!.message).toContain("not supported yet");
  });

  it("reports the line of the problem", () => {
    const r = parse(`${FM}## intent I1\nx\n\n## rule R1\ny\n`);
    expect(r.diagnostics[0]).toMatchObject({
      code: "E001",
      file: ".capsules/billing/invoices.md",
      line: 8,
    });
  });
});
