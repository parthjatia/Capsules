// The M5 demo: the capsules map of the billing demo app, with a few real problems in it
// (a changed rule, a broken test, a new test nobody reviewed, a file with no capsule).
// Run: npm run build && node scripts/demo-m5.mjs          (add --open to open it in your browser)
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CLI = join(ROOT, "dist", "cli.js");
const dir = mkdtempSync(join(tmpdir(), "capsules-m5-demo-"));
const keep = join(tmpdir(), "capsules-m5-demo-map.html");
const sh = (cmd, args) => spawnSync(cmd, args, { cwd: dir, encoding: "utf8" });
const capsules = (...a) => sh(process.execPath, [CLI, ...a]);
const change = (file, from, to) => {
  const p = join(dir, ...file.split("/"));
  writeFileSync(p, readFileSync(p, "utf8").replace(from, to));
};
const say = (s = "") => console.log(s);

cpSync(join(ROOT, "examples", "billing-demo"), dir, { recursive: true });
sh("git", ["init", "-q"]);
sh("git", ["config", "core.autocrlf", "false"]);
sh("git", ["add", "-A"]);
sh("git", [
  "-c",
  "user.email=demo@example.com",
  "-c",
  "user.name=demo",
  "commit",
  "-qm",
  "the app",
]);

// Some real problems for the map to show.
change(
  ".capsules/billing/invoices.md",
  "Never create two invoices for the same customer and period.",
  "Never create two invoices for one customer in one period.",
);
change("tests/web/checkout.test.js", "assert.equal(", "assert.notEqual(");
change("src/web/cart.tsx", "", "// a small change\n");
writeFileSync(
  join(dir, "tests", "web", "cart.test.js"),
  "import test from 'node:test';\ntest('cart', () => {});\n",
);
say("Running the checks once, so the map can show their results...");
capsules("check", "--all");

say();
say("Capsules M5 demo: the map");
say("=========================");
say();
say("1. `capsules map` writes one offline web page. Its summary line:");
const r = capsules("map");
say("  " + (r.stdout.split("\n")[1] ?? "").trim());
copyFileSync(join(dir, ".capsules", "_cache", "map.html"), keep);
say();
say("2. `capsules map --format mermaid` prints a diagram for a README or a pull request:");
say(
  capsules("map", "--format", "mermaid")
    .stdout.trimEnd()
    .split("\n")
    .map((l) => "  " + l)
    .join("\n"),
);
rmSync(dir, { recursive: true, force: true });
say();
say(`The map from this demo is saved here, so you can open it:\n  ${keep}`);
if (process.argv.includes("--open")) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["explorer.exe", [keep]]
      : process.platform === "darwin"
        ? ["open", [keep]]
        : ["xdg-open", [keep]];
  spawnSync(cmd, args, { stdio: "ignore" });
  say("Opened it in your browser.");
}
