import { describe, expect, it } from "vitest";
import {
  computeCurrent,
  LOCK_HEADER,
  lockChanges,
  parseLock,
  skippedLine,
  splitReplaced,
  serializeLock,
  staleLinks,
  stalePrompts,
  updateLock,
} from "../../src/core/lock.js";
import type { Capsule } from "../../src/core/model.js";
import { parseCapsuleFile } from "../../src/core/parse.js";

const BLOB_A = "8d3f0e1a9b27c4d6e5f8a0b1c2d3e4f5a6b7c8d9";
const BLOB_B = "0000000000000000000000000000000000000001";

function capsules(c1Text = "Never create two invoices."): Capsule[] {
  const text = `---
title: Invoices
---

## intent I1
Charge once.

## contract C1 serves @I1
${c1Text}
checked-by: @dup

## check dup
run: npm test

## decision D7 serves @C1
Use idempotency keys.

## context keys derived-from @D7
Pass both. {{ @C1 }}

## prompt agent
file: prompts/agent.md
`;
  return [
    parseCapsuleFile(text, ".capsules/billing/invoices.md", "billing.invoices", "area").capsule,
  ];
}

const blobs = (b = BLOB_A) => new Map([["prompts/agent.md", b]]);

describe("lockfile format (C7.2)", () => {
  const lock = computeCurrent(capsules(), blobs());
  const text = serializeLock(lock);

  it("starts with the header, sorts by kind then lexically, LF and a trailing newline", () => {
    const lines = text.split("\n");
    expect(lines[0]).toBe(LOCK_HEADER);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.includes("\r")).toBe(false);
    const kinds = lines.slice(1, -1).map((l) => l.split(" ")[0]);
    expect(kinds).toEqual([...kinds].sort((a, b) => order(a!) - order(b!)));
    const nodes = lines.filter((l) => l.startsWith("node "));
    expect(nodes).toEqual([...nodes].sort());
    expect(nodes.map((l) => l.split(" ").slice(1, 3).join(" "))).toEqual([
      "billing.invoices#C1 contract",
      "billing.invoices#D7 decision",
      "billing.invoices#I1 intent",
      "billing.invoices#agent prompt",
      "billing.invoices#dup check",
      "billing.invoices#keys context",
    ]);
  });

  it("records links, including transclusions, and prompt files", () => {
    const links = text.split("\n").filter((l) => l.startsWith("link "));
    expect(links.map((l) => l.split(" ").slice(1, 4).join(" "))).toEqual([
      "billing.invoices#C1 checked-by billing.invoices#dup",
      "billing.invoices#C1 serves billing.invoices#I1",
      "billing.invoices#D7 serves billing.invoices#C1",
      "billing.invoices#keys derived-from billing.invoices#D7",
      "billing.invoices#keys uses billing.invoices#C1",
    ]);
    expect(text).toContain(`file billing.invoices#agent prompts/agent.md ${BLOB_A}\n`);
  });

  it("round-trips through parseLock", () => {
    const { lock: back, diagnostics } = parseLock(text);
    expect(diagnostics).toEqual([]);
    expect(serializeLock(back)).toBe(text);
  });

  it("is byte-identical when written twice (determinism)", () => {
    expect(serializeLock(computeCurrent(capsules(), blobs()))).toBe(text);
  });

  it("reports unreadable lines as E026 with the line number", () => {
    const { diagnostics } = parseLock(`${LOCK_HEADER}\nnode a#C1 contract nothex\nbogus\n`);
    expect(diagnostics.map((d) => [d.code, d.line])).toEqual([
      ["E026", 2],
      ["E026", 3],
    ]);
  });
});

describe("updating the lock (C7.3)", () => {
  const old = computeCurrent(capsules(), blobs());
  const changed = computeCurrent(capsules("Never create two invoices per period."), blobs());

  it("lock never re-pins an existing link (B12)", () => {
    const next = updateLock(old, changed);
    expect(next.links.get("billing.invoices#D7 serves billing.invoices#C1")!.hash).toBe(
      old.nodes.get("billing.invoices#C1")!.hash,
    );
    // ...but node records follow the current text.
    expect(next.nodes.get("billing.invoices#C1")!.hash).toBe(
      changed.nodes.get("billing.invoices#C1")!.hash,
    );
  });

  it("pins new links to the current target, drops removed links", () => {
    const next = updateLock(null, changed);
    expect(next.links.get("billing.invoices#D7 serves billing.invoices#C1")!.hash).toBe(
      changed.nodes.get("billing.invoices#C1")!.hash,
    );
    const fewer = computeCurrent(
      capsules().map((c) => ({ ...c, nodes: c.nodes.filter((n) => n.id !== "keys") })),
      blobs(),
    );
    expect(
      [...updateLock(old, fewer).links.keys()].some((k) => k.startsWith("billing.invoices#keys")),
    ).toBe(false);
  });

  it("refresh re-pins only links FROM the named node", () => {
    const next = updateLock(old, changed, { refreshFrom: "billing.invoices#D7" });
    expect(staleLinks(next, changed).map((l) => l.from)).toEqual(["billing.invoices#keys"]);
  });

  it("relock --cosmetic re-pins every link TO the named node", () => {
    const next = updateLock(old, changed, { relockTo: "billing.invoices#C1" });
    expect(staleLinks(next, changed)).toEqual([]);
  });
});

describe("staleness and out-of-date lock (C7.4)", () => {
  const old = computeCurrent(capsules(), blobs());
  const changed = computeCurrent(capsules("Never create two invoices per period."), blobs(BLOB_B));

  it("lists every link pointing at a changed node as stale (W104)", () => {
    expect(staleLinks(old, changed).map((l) => `${l.from} ${l.type}`)).toEqual([
      "billing.invoices#D7 serves",
      "billing.invoices#keys uses",
    ]);
  });

  it("lists prompt files whose blob changed (W110)", () => {
    expect(stalePrompts(old, changed)).toEqual([
      {
        address: "billing.invoices#agent",
        path: "prompts/agent.md",
        locked: BLOB_A,
        current: BLOB_B,
      },
    ]);
  });

  it("reports what lock would change (E010), but not link pins", () => {
    expect(lockChanges(old, changed)).toEqual([
      { kind: "node", key: "billing.invoices#C1", change: "changed" },
      { kind: "file", key: "billing.invoices#agent", change: "changed" },
    ]);
    expect(lockChanges(old, old)).toEqual([]);
  });
});

describe("replaced decisions are skipped (D-015)", () => {
  const text = `---
title: T
---

## intent I1
x

## contract C1 serves @I1
old

## decision D3 serves @C1
old way

## decision D7 serves @C1 supersedes @D3
new way
`;
  const caps = [parseCapsuleFile(text, ".capsules/root.md", "root", "area").capsule];
  const changed = [
    parseCapsuleFile(text.replace("\nold\n", "\nnew\n"), ".capsules/root.md", "root", "area")
      .capsule,
  ];
  const stale = staleLinks(computeCurrent(caps, new Map()), computeCurrent(changed, new Map()));

  it("reports links from current decisions only, and names the skipped ones", () => {
    const { report, skipped } = splitReplaced(stale, changed);
    expect(stale.map((s) => s.from)).toEqual(["root#D3", "root#D7"]);
    expect(report.map((s) => s.from)).toEqual(["root#D7"]);
    expect(skipped).toEqual([{ decision: "root#D3", replacedBy: ["root#D7"] }]);
    expect(skippedLine(skipped)).toBe("1 replaced decision skipped (root#D3, replaced by root#D7)");
    expect(skippedLine([])).toBeNull();
  });
});

function order(kind: string): number {
  return ["capsule", "node", "link", "file"].indexOf(kind);
}
