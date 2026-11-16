// CLAUDE.md says docs/SPEC.md must stay identical to Part C. This test enforces it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error: plain .mjs build script without type declarations
import { expectedSpec } from "../../scripts/sync-spec.mjs";

describe("docs/SPEC.md", () => {
  it("is identical to Part C of CLAUDE.md (fix: npm run spec:sync)", () => {
    const have = readFileSync(
      join(import.meta.dirname, "..", "..", "docs", "SPEC.md"),
      "utf8",
    ).replace(/\r\n?/g, "\n");
    expect(have).toBe((expectedSpec as () => string)());
  });
});
