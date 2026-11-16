import { describe, expect, it } from "vitest";
import { computeMembership, membershipOf } from "../../src/core/membership.js";
import type { Capsule } from "../../src/core/model.js";

function cap(
  id: string,
  covers: string[],
  opts: { kind?: "area" | "concern"; excludes?: string[] } = {},
): Capsule {
  const kind = opts.kind ?? "area";
  return {
    id,
    kind,
    file: `.capsules/${kind === "concern" ? "_concerns/" : ""}${id.replace(/\./g, "/")}.md`,
    front: { title: id, owners: null, covers, excludes: opts.excludes ?? [], status: "active" },
    frontText: null,
    nodes: [],
    parent: null,
  };
}

const capsules = [
  cap("root", []),
  cap("billing", ["src/billing/**"]),
  cap("billing.invoices", ["src/billing/invoices/**", "prompts/invoice-agent.md"]),
  cap("web", ["src/web/**"], { excludes: ["src/web/legacy/**"] }),
  cap("users", ["src/users/**", "src/web/profile.tsx"]),
  cap("pii", ["src/users/**", "src/web/checkout.tsx"], { kind: "concern" }),
  cap("payments", ["src/billing/**", "src/web/checkout.tsx"], { kind: "concern" }),
  cap("auth", ["src/auth/**"], { kind: "concern" }),
];

const files = [
  "src/billing/plan.ts",
  "src/billing/invoices/create.ts",
  "prompts/invoice-agent.md",
  "src/web/checkout.tsx",
  "src/web/profile.tsx",
  "src/web/legacy/old.ts",
  "src/users/model.ts",
  "README.md",
  "src/.hidden/config.ts",
];

describe("membership (C2.7)", () => {
  const result = computeMembership(files, capsules, ["README.md"]);
  const of = (f: string) => result.files.get(f);

  it("the deepest capsule in one ancestor chain wins", () => {
    expect(of("src/billing/invoices/create.ts")?.home).toBe("billing.invoices");
    expect(of("src/billing/plan.ts")?.home).toBe("billing");
    expect(of("prompts/invoice-agent.md")?.home).toBe("billing.invoices");
  });

  it("records which covers pattern matched", () => {
    expect(of("src/billing/invoices/create.ts")?.homePattern).toBe("src/billing/invoices/**");
  });

  it("two unrelated area capsules covering one file is E004", () => {
    expect(of("src/web/profile.tsx")?.home).toBeNull();
    expect(of("src/web/profile.tsx")?.conflict).toEqual(["users", "web"]);
    const e004 = result.diagnostics.filter((d) => d.code === "E004");
    expect(e004).toHaveLength(1);
    expect(e004[0]!.message).toContain("src/web/profile.tsx");
  });

  it("excludes are subtracted from covers", () => {
    expect(of("src/web/legacy/old.ts")?.home).toBeNull();
    expect(of("src/web/legacy/old.ts")?.conflict).toEqual([]);
  });

  it("files with no home are orphans (W101)", () => {
    const orphans = result.diagnostics.filter((d) => d.code === "W101").map((d) => d.file);
    expect(orphans).toEqual(["src/.hidden/config.ts", "src/web/legacy/old.ts"]);
  });

  it("ignored files are not members and not orphans", () => {
    expect(of("README.md")).toBeUndefined();
    expect(result.ignored).toEqual(["README.md"]);
  });

  it("every covering concern applies, in id order; concerns are never a home", () => {
    expect(of("src/web/checkout.tsx")).toMatchObject({
      home: "web",
      concerns: ["payments", "pii"],
    });
    expect(of("src/users/model.ts")).toMatchObject({ home: "users", concerns: ["pii"] });
  });

  it("a concern that covers no tracked files is E014", () => {
    const e014 = result.diagnostics.filter((d) => d.code === "E014");
    expect(e014.map((d) => d.file)).toEqual([".capsules/_concerns/auth.md"]);
  });

  it("root covering ** loses to any deeper capsule", () => {
    const r = computeMembership(
      ["a.ts", "src/web/x.ts"],
      [cap("root", ["**"]), cap("web", ["src/web/**"])],
      [],
    );
    expect(r.files.get("a.ts")?.home).toBe("root");
    expect(r.files.get("src/web/x.ts")?.home).toBe("web");
    expect(r.diagnostics).toEqual([]);
  });

  it("matches dotfiles with **", () => {
    const r = computeMembership([".env.example"], [cap("root", ["**"])], []);
    expect(r.files.get(".env.example")?.home).toBe("root");
  });

  it("membershipOf works for a path that is not tracked yet", () => {
    expect(membershipOf("src/billing/invoices/new.ts", capsules).home).toBe("billing.invoices");
  });

  it("is deterministic: diagnostics come out in a stable order", () => {
    const again = computeMembership([...files].reverse(), [...capsules].reverse(), ["README.md"]);
    expect(again.diagnostics).toEqual(result.diagnostics);
  });
});
