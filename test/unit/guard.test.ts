// M3 building blocks: identity (C5.3), permissions (C5.2), additive check edits,
// weakened-test signals (C9.2), trailers and capsule paths.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ASSERTIONS,
  DEFAULT_SKIPS,
  describeCheckChange,
  weakenedSignals,
} from "../../src/checks/heuristics.js";
import { isAdditive } from "../../src/core/changes.js";
import { humanFromEmail, humanFromGithub, isOwner, ownersOf } from "../../src/core/identity.js";
import { parseCapsuleFile } from "../../src/core/parse.js";
import { agentMay, parsePermissions } from "../../src/core/permissions.js";
import { capsuleFromPath } from "../../src/core/project.js";
import { parseTrailers } from "../../src/git/history.js";

const perms = parsePermissions(
  `
solo: true
humans:
  parth: { github: "parthjatia", owns: ["**"] }
  sam: { github: "sam-k", emails: ["Sam@Example.com"] }
roles:
  builder: { may: [edit-code, add-checks, edit-context, add-decisions] }
  drafter: { may: [edit-context, propose-contracts] }
agents:
  default: { role: builder, capsules: ["**"] }
  billing-agent: { role: builder, capsules: ["billing", "billing.**"] }
  frontend-agent: { role: builder, capsules: ["web", "web.**"], blocked-by: [payments] }
  drafter: { role: drafter, capsules: ["**"] }
`,
  "permissions.yaml",
  [],
);

describe("who made a commit (C5.3, D-017)", () => {
  it("maps both GitHub noreply forms to the handle, case-insensitively", () => {
    expect(humanFromEmail("63094286+ParthJatia@users.noreply.github.com", perms)).toEqual({
      kind: "human",
      name: "parth",
    });
    expect(humanFromEmail("parthjatia@users.noreply.github.com", perms)).toEqual({
      kind: "human",
      name: "parth",
    });
  });

  it("uses the optional emails list, case-insensitively", () => {
    expect(humanFromEmail("sam@example.COM", perms)).toEqual({ kind: "human", name: "sam" });
  });

  it("anyone else is unknown (and acts as default)", () => {
    expect(humanFromEmail("x@example.com", perms)).toEqual({
      kind: "unknown",
      email: "x@example.com",
    });
    expect(humanFromEmail("1+nobody@users.noreply.github.com", perms).kind).toBe("unknown");
    expect(humanFromEmail(null, perms).kind).toBe("unknown");
    expect(humanFromGithub("SAM-K", perms)).toEqual({ kind: "human", name: "sam" });
  });
});

describe("owners", () => {
  const cap = (id: string, owners: string | null, kind: "area" | "concern" = "area") =>
    parseCapsuleFile(
      `---\ntitle: T\n${owners ? `owners: [${owners}]\n` : ""}---\n`,
      `.capsules/${id}.md`,
      id,
      kind,
    ).capsule;
  const caps = [
    cap("root", "parth"),
    cap("billing", "sam"),
    cap("billing.invoices", null),
    cap("pii", null, "concern"),
  ];

  it("inherit from the nearest ancestor; concerns fall back to root", () => {
    expect(ownersOf(caps, "billing.invoices")).toEqual(["sam"]);
    expect(ownersOf(caps, "pii")).toEqual(["parth"]);
  });

  it("owns patterns also make an owner", () => {
    expect(isOwner("sam", "billing.invoices", caps, perms)).toBe(true);
    expect(isOwner("sam", "root", caps, perms)).toBe(false);
    expect(isOwner("parth", "billing.invoices", caps, perms)).toBe(true); // owns: ["**"]
  });
});

describe("agentMay (C5.2 step 3)", () => {
  it("checks role, scope and blocked-by, and flags propose-* for approval", () => {
    expect(agentMay("billing-agent", "edit-code", "billing.invoices", [], perms)).toEqual({
      allowed: true,
      needsApproval: false,
    });
    expect(agentMay("billing-agent", "edit-code", "web", [], perms)).toMatchObject({
      allowed: false,
      reason: "web is outside the scope of billing-agent",
    });
    expect(agentMay("frontend-agent", "edit-code", "web", ["payments"], perms)).toMatchObject({
      allowed: false,
      reason: "frontend-agent is blocked by the payments concern",
    });
    expect(agentMay("default", "change-checks", "root", [], perms)).toMatchObject({
      allowed: false,
      reason: "the builder role of default doesn't include change-checks",
    });
    expect(agentMay("drafter", "propose-contracts", "billing", [], perms)).toEqual({
      allowed: true,
      needsApproval: true,
    });
    expect(agentMay("ghost", "edit-code", "root", [], perms)).toMatchObject({ allowed: false });
  });
});

describe("isAdditive", () => {
  it("is true only when every old line survives, in order", () => {
    expect(isAdditive("a\nb\nc\n", "a\nb\nx\nc\n")).toBe(true);
    expect(isAdditive("a\r\nb\r\n", "a\nb\nc\n")).toBe(true);
    expect(isAdditive("a\nb\nc\n", "a\nc\n")).toBe(false);
    expect(isAdditive("a\nb\n", "b\na\n")).toBe(false);
  });
});

describe("weakened-test signals (C9.2)", () => {
  const p = { assertions: DEFAULT_ASSERTIONS, skips: DEFAULT_SKIPS };
  const before = 'test("a", () => {\n  expect(x).toBe(1);\n  expect(y).toBe(2);\n});\n';

  it("counts removed assertions and names the first removed line of the old version", () => {
    const after = 'test("a", () => {\n  expect(y).toBe(2);\n});\n';
    expect(weakenedSignals(before, after, p)).toEqual([
      {
        kind: "assertions-removed",
        line: 2,
        count: 1,
        pattern: "expect(",
        what: '1 assertion removed (first at line 2 of the old version, pattern "expect(")',
      },
    ]);
    expect(describeCheckChange(before, after, p)).toBe("existing test, 1 assertion removed");
  });

  it("finds added skip markers in the new version", () => {
    const after = before.replace('test("a"', 'test.skip("a"');
    expect(weakenedSignals(before, after, p).map((s) => [s.kind, s.line, s.pattern])).toEqual([
      ["skip-added", 1, ".skip("],
    ]);
  });

  it("a deleted file, an unchanged count and a new file", () => {
    expect(weakenedSignals(before, null, p)).toEqual([
      { kind: "deleted", what: "the test file was deleted" },
    ]);
    expect(weakenedSignals(before, before.replace("1", "3"), p)).toEqual([]);
    expect(describeCheckChange(before, before.replace("1", "3"), p)).toBe("existing test, changed");
    expect(describeCheckChange(null, before, p)).toBe("new test");
  });
});

describe("trailers and capsule paths", () => {
  it("reads trailers from the last paragraph only", () => {
    const t = parseTrailers(
      "Fix: invoices\n\nBody text: not a trailer.\n\nCapsule-Session: 7f3c\nCapsule-Agent: billing-agent\n",
    );
    expect([...t]).toEqual([
      ["Capsule-Session", ["7f3c"]],
      ["Capsule-Agent", ["billing-agent"]],
    ]);
    expect([...parseTrailers("Capsule-Agent: x")]).toEqual([]); // a subject alone has none
  });

  it("maps .capsules paths to capsule ids (C1)", () => {
    expect(capsuleFromPath(".capsules/root.md")).toEqual({ id: "root", kind: "area" });
    expect(capsuleFromPath(".capsules/billing/invoices.md")).toEqual({
      id: "billing.invoices",
      kind: "area",
    });
    expect(capsuleFromPath(".capsules/_concerns/pii.md")).toEqual({ id: "pii", kind: "concern" });
    expect(capsuleFromPath(".capsules/_cache/map.md")).toBeNull();
    expect(capsuleFromPath(".capsules/config.yaml")).toBeNull();
    expect(capsuleFromPath("src/root.md")).toBeNull();
  });
});
