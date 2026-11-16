// Build the one file a design partner installs before we publish (M6).
// Run: npm run pack:partner
// It writes release/pyscoparth-capsules-<version>.tgz and prints its SHA-256, so the partner
// can check the file arrived intact. It publishes nothing: package.json stays "private".
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const sh = (args) => {
  // npm is a .cmd shim on Windows, which needs a shell: pass one command line there.
  const r =
    process.platform === "win32"
      ? spawnSync([npm, ...args].join(" "), { cwd: ROOT, encoding: "utf8", shell: true })
      : spawnSync(npm, args, { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) {
    process.stderr.write(r.stdout + r.stderr);
    process.exit(1);
  }
  return r.stdout;
};

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
if (!pkg.private) {
  console.error(
    'package.json is not "private". Refusing: the partner build must never be publishable by accident.',
  );
  process.exit(1);
}
console.log("Building...");
sh(["run", "-s", "build"]);
mkdirSync(join(ROOT, "release"), { recursive: true });
const out = JSON.parse(sh(["pack", "--pack-destination", "release", "--json", "--silent"]));
const file = join(ROOT, "release", out[0].filename);
const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
console.log(`
Partner package ready:
  file:     ${file}
  version:  ${pkg.version}
  size:     ${Math.round(statSync(file).size / 1024)} KB, ${out[0].entryCount} files
  sha256:   ${sha}

Send the partner this file and docs/PARTNER-INSTALL.md, privately (not in a public place).
Before sending, rehearse their install on a clean copy: npm run try:partner
`);
