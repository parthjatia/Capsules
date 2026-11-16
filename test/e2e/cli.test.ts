// Runs the real built CLI (dist/cli.js) as a user would. `npm test` builds first.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const cli = join(root, "dist", "cli.js");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };

function run(...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

describe("capsules CLI", () => {
  it("--version prints the package version and exits 0", () => {
    const r = run("--version");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
  });

  it("-v is the short form", () => {
    expect(run("-v").stdout.trim()).toBe(pkg.version);
  });

  it("--help exits 0 and names the tool", () => {
    const r = run("--help");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("capsules");
  });

  it("an unknown option is a usage error (exit 64)", () => {
    const r = run("--no-such-flag");
    expect(r.status).toBe(64);
  });

  it("output has no colour codes when not a terminal", () => {
    const r = run("--help");
    expect(r.stdout.includes("\u001b[")).toBe(false);
  });

  it("the built file starts with a node shebang", () => {
    expect(readFileSync(cli, "utf8").startsWith("#!/usr/bin/env node")).toBe(true);
  });
});
