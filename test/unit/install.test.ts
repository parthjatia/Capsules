// Unit tests for the settings merge (C11, D-026) and blob hashes.
import { describe, expect, it } from "vitest";
import { blobHash } from "../../src/install/manifest.js";
import { hasOurHooks, isOurs, mergeHooks, unmergeHooks } from "../../src/install/settings-merge.js";

const CLI = "C:/tools/capsules/dist/cli.js";

describe("mergeHooks / unmergeHooks", () => {
  it("adds our hooks next to the user's and gives the exact file back on removal", () => {
    const user =
      '{\n  "hooks": {\n    "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "./mine.sh" } ] } ]\n  },\n  "model": "x"\n}\n';
    const merged = mergeHooks(user, "s.json", CLI);
    const s = JSON.parse(merged);
    expect(s.model).toBe("x");
    expect(s.hooks.PreToolUse).toHaveLength(3);
    expect(s.hooks.PreToolUse[0].hooks[0].command).toBe("./mine.sh");
    expect(s.hooks.Stop[0].hooks[0].command).toBe(`node "${CLI}" hook stop`);
    expect(hasOurHooks(merged)).toBe(true);
    expect(unmergeHooks(merged, "s.json", user)).toBe(user);
  });

  it("replaces an older copy of our hooks instead of adding a second", () => {
    const once = mergeHooks(null, "s.json", "/old/dist/cli.js");
    const twice = mergeHooks(once, "s.json", CLI);
    expect(twice.match(/hook pre-edit/g)).toHaveLength(1);
    expect(twice).toContain(CLI);
  });

  it("deletes a file it created once only our hooks are left, and keeps later user changes", () => {
    const created = mergeHooks(null, "s.json", CLI);
    expect(unmergeHooks(created, "s.json", null)).toBeNull();
    const withUser = JSON.stringify({ ...JSON.parse(created), model: "y" });
    expect(JSON.parse(unmergeHooks(withUser, "s.json", null)!)).toEqual({ model: "y" });
  });

  it("refuses to touch a settings file that isn't valid JSON", () => {
    expect(() => mergeHooks("{ nope", "s.json", CLI)).toThrow(/not valid JSON/);
  });

  it("recognises only capsules hook commands", () => {
    expect(isOurs(`node "${CLI}" hook pre-edit`)).toBe(true);
    expect(isOurs("capsules hook pre-bash")).toBe(true);
    expect(isOurs("./my-hook.sh pre-edit")).toBe(false);
  });
});

describe("blobHash", () => {
  it("matches git hash-object", () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(blobHash("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });
});
