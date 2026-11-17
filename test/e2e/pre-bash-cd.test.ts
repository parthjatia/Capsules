// The pre-bash hook follows `cd` (D-028), so a write in another folder isn't mistaken for
// one in this repo. Reproduces the docs/DOGFOOD.md entry of 2026-11-16 (M5).
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { nativePath, resolvedWrites } from "../../src/hooks/pre-bash.js";
import { CLI, cleanup, demoHistory } from "./helpers.js";

afterAll(cleanup);

function preBash(cwd: string, command: string) {
  const r = spawnSync(process.execPath, [CLI, "hook", "pre-bash"], {
    cwd,
    input: JSON.stringify({
      cwd,
      session_id: "cd-test",
      tool_name: "Bash",
      tool_input: { command },
    }),
    encoding: "utf8",
  });
  return { status: r.status, stderr: r.stderr };
}

const repo = demoHistory();
const other = demoHistory(); // a separate copy of the demo app, outside `repo`
const slash = (p: string) => p.split("\\").join("/");

describe("pre-bash follows cd", () => {
  it("allows the DOGFOOD case: cd into another copy, then sed -i its capsule file", () => {
    const r = preBash(
      repo,
      `cd ${slash(other)} && C=/c/Users/x/dist/cli.js && sed -i 's/same customer/one customer/' .capsules/billing/invoices.md`,
    );
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("still blocks the same command without the cd, in this repo", () => {
    const r = preBash(repo, `sed -i 's/same customer/one customer/' .capsules/billing/invoices.md`);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("this shell command would change a capsules file");
    expect(r.stderr).toContain(".capsules/billing/invoices.md");
  });

  it.each([
    ["cd into a subfolder, then up again", "cd src && sed -i s/a/b/ ../.capsules/root.md"],
    [
      "cd away and back by absolute path",
      `cd ${slash(other)} && cd ${slash(repo)} && rm .capsules/root.md`,
    ],
    ["a cd inside a subshell ends with it", `(cd ${slash(other)}) && rm .capsules/root.md`],
    ["two subshells don't leak into each other", `(cd ${slash(other)}); (rm .capsules/root.md)`],
    ["pushd then popd comes back", `pushd ${slash(other)} && popd && rm .capsules/root.md`],
    [
      "cd - can't be known, so the starting folder counts",
      `cd ${slash(other)} && cd - && rm .capsules/root.md`,
    ],
    ["an unknown variable can't be known either", "cd $NOWHERE && rm .capsules/root.md"],
    ["backticks can't be known", "cd `pwd` && rm .capsules/root.md"],
    [
      "a write to an absolute path in this repo",
      `cd ${slash(other)} && rm ${slash(repo)}/.capsules/root.md`,
    ],
  ])("still blocks: %s", (_why, command) => {
    const r = preBash(repo, command);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(".capsules/root.md");
  });

  it.each([
    ["a variable set earlier in the command", `T=${slash(other)}; cd $T && rm .capsules/root.md`],
    ["the ${T} form", `T=${slash(other)} && cd "\${T}" && rm .capsules/root.md`],
    ["a subshell working elsewhere", `(cd ${slash(other)} && rm .capsules/root.md)`],
    ["pushd elsewhere", `pushd ${slash(other)} && rm .capsules/root.md`],
  ])("allows: %s", (_why, command) => {
    const r = preBash(repo, command);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});

describe("Git Bash paths on Windows (D-028)", () => {
  it("turns /c/... into C:/... on Windows only", () => {
    expect(nativePath("/c/Users/x/repo", "win32")).toBe("C:/Users/x/repo");
    expect(nativePath("/d", "win32")).toBe("D:/");
    expect(nativePath("/tmp/x", "win32")).toBe("/tmp/x");
    expect(nativePath("/c/Users/x", "linux")).toBe("/c/Users/x");
  });

  it.runIf(process.platform === "win32")(
    "blocks rm of this repo's capsule written as /c/... (was allowed before)",
    () => {
      const p = slash(repo).replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`);
      const r = preBash(repo, `rm ${p}/.capsules/root.md`);
      expect(r.status).toBe(2);
    },
  );
});

describe("resolvedWrites", () => {
  const base = resolve("/work/repo");
  it("resolves each write against the folder it happens in", () => {
    expect(resolvedWrites("cd sub && touch a && cd .. && touch b", base)).toEqual([
      join(base, "sub", "a"),
      join(base, "b"),
    ]);
  });

  it("expands ~ and a plain cd to the home folder", () => {
    expect(resolvedWrites("cd ~/x && touch a", base)).toEqual([join(homedir(), "x", "a")]);
    expect(resolvedWrites("cd && touch a", base)).toEqual([join(homedir(), "a")]);
  });
});
