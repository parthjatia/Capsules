// Unit tests for M4a pieces: propose-checks (D-021), commit trailers (C8), shell parsing.
import { describe, expect, it } from "vitest";
import { agentMay, type Perms } from "../../src/core/access.js";
import { addTrailers } from "../../src/hooks/commit-msg.js";
import { words, writtenPaths } from "../../src/hooks/pre-bash.js";
import { simulate } from "../../src/hooks/pre-edit.js";

const perms: Perms = {
  solo: true,
  humans: {},
  roles: {
    builder: { may: ["edit-code", "add-checks"] },
    maintainer: { may: ["add-checks", "propose-checks"] },
    admin: { may: ["change-checks"] },
  },
  agents: {
    default: { role: "builder", capsules: ["**"], "blocked-by": [] },
    "test-maintainer": { role: "maintainer", capsules: ["**"], "blocked-by": [] },
    lead: { role: "admin", capsules: ["**"], "blocked-by": [] },
  },
};

describe("agentMay with propose-checks (D-021)", () => {
  it("lets a maintainer change existing checks, with owner approval", () => {
    expect(agentMay("test-maintainer", "change-checks", "billing", [], perms)).toEqual({
      allowed: true,
      needsApproval: true,
    });
  });
  it("never lets a maintainer edit code", () => {
    const v = agentMay("test-maintainer", "edit-code", "billing", [], perms);
    expect(v.allowed).toBe(false);
  });
  it("needs no approval when change-checks is granted explicitly", () => {
    expect(agentMay("lead", "change-checks", "billing", [], perms)).toEqual({
      allowed: true,
      needsApproval: false,
    });
  });
  it("respects a work session's narrower scope", () => {
    const v = agentMay("default", "edit-code", "users", [], perms, ["billing.**", "billing"]);
    expect(v).toMatchObject({ allowed: false });
  });
});

describe("addTrailers", () => {
  const T = ["Capsule-Session: abc", "Capsule-Agent: billing-agent"];
  it("adds a trailer paragraph after the message", () => {
    expect(addTrailers("Fix bug\n", T)).toBe(
      "Fix bug\n\nCapsule-Session: abc\nCapsule-Agent: billing-agent\n",
    );
  });
  it("joins an existing trailer block and skips lines already there", () => {
    const m = "Fix bug\n\nBody text.\n\nCo-Authored-By: X <x@y>\nCapsule-Session: abc\n";
    expect(addTrailers(m, T)).toBe(
      "Fix bug\n\nBody text.\n\nCo-Authored-By: X <x@y>\nCapsule-Session: abc\nCapsule-Agent: billing-agent\n",
    );
  });
  it("keeps git's comment lines at the end and leaves empty messages alone", () => {
    expect(addTrailers("Fix\n\n# comment\n", T)).toBe(
      "Fix\n\nCapsule-Session: abc\nCapsule-Agent: billing-agent\n\n# comment\n",
    );
    expect(addTrailers("# only a comment\n", T)).toBe("# only a comment\n");
  });
});

describe("shell parsing for pre-bash", () => {
  it("splits commands and finds redirect targets, ignoring 2>&1", () => {
    expect(words("npm test > out.txt 2>&1 && echo 'a b'")).toEqual([
      ["npm", "test", ">", "out.txt"],
      ["echo", "a b"],
    ]);
    expect(writtenPaths(["npm", "test", ">", "out.txt"])).toEqual(["out.txt"]);
    expect(words("node x.js 2>err.log")).toEqual([["node", "x.js", ">", "err.log"]]);
  });
  it("knows which arguments each writer changes", () => {
    expect(writtenPaths(["cp", "a", "b"])).toEqual(["b"]);
    expect(writtenPaths(["mv", "a", "b"])).toEqual(["a", "b"]);
    expect(writtenPaths(["sed", "-i", "s/x/y/", "f.js"])).toEqual(["f.js"]);
    expect(writtenPaths(["sed", "s/x/y/", "f.js"])).toEqual([]);
    expect(writtenPaths(["git", "checkout", "--", "f.js"])).toEqual(["f.js"]);
    expect(writtenPaths(["cat", "f.js"])).toEqual([]);
  });
});

describe("simulate", () => {
  it("applies Edit, replace_all and MultiEdit like the tools do", () => {
    expect(simulate("Edit", { old_string: "a", new_string: "b" }, "a a")).toBe("b a");
    expect(simulate("Edit", { old_string: "a", new_string: "b", replace_all: true }, "a a")).toBe(
      "b b",
    );
    expect(simulate("Edit", { old_string: "$&", new_string: "x" }, "$&")).toBe("x");
    expect(
      simulate(
        "MultiEdit",
        {
          edits: [
            { old_string: "a", new_string: "b" },
            { old_string: "b", new_string: "c" },
          ],
        },
        "a",
      ),
    ).toBe("c");
    expect(simulate("Write", { content: "new" }, "old")).toBe("new");
    expect(simulate("Edit", { old_string: "zzz", new_string: "b" }, "a")).toBeUndefined();
  });
});
