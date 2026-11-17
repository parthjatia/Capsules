// Rehearse a design partner's install of the package file, step by step as in
// docs/PARTNER-INSTALL.md, on a clean copy of the demo app. Everything happens in a temporary
// folder: the "global" install goes into its own prefix there, so nothing on this machine
// changes. Run: npm run pack:partner && npm run try:partner
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const win = process.platform === "win32";
const releases = existsSync(join(ROOT, "release"))
  ? readdirSync(join(ROOT, "release"))
      .filter((f) => f.endsWith(".tgz"))
      .sort()
  : [];
const tgz = process.argv[2] ?? (releases.length ? join(ROOT, "release", releases.at(-1)) : null);
if (!tgz || !existsSync(tgz)) {
  console.error("No package file found. Run `npm run pack:partner` first.");
  process.exit(64);
}

const tmp = mkdtempSync(join(tmpdir(), "capsules-partner-"));
const prefix = join(tmp, "global");
const app = join(tmp, "their-app");
const bin = win ? join(prefix, "capsules.cmd") : join(prefix, "bin", "capsules");
let failed = 0;
const step = (n, what, ok, detail = "") => {
  if (!ok) failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${n}. ${what}${detail ? `\n       ${detail.trim().split("\n").join("\n       ")}` : ""}`,
  );
};
// On Windows, .cmd shims (npm, capsules) need a shell: pass one quoted command line.
const quote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
const run = (cmd, args, opts = {}) =>
  (opts.shell ?? win)
    ? // Quote the program only if it must be: npm.cmd can't find itself when quoted.
      spawnSync([/\s/.test(cmd) ? quote(cmd) : cmd, ...args.map(quote)].join(" "), {
        encoding: "utf8",
        ...opts,
        shell: true,
      })
    : spawnSync(cmd, args, { encoding: "utf8", ...opts, shell: false });
const capsules = (...args) => run(bin, args, { cwd: app });

console.log(`Rehearsing the partner install of ${tgz}\nin ${tmp}\n`);

// Step 1: what they need.
const nodeMajor = Number(process.versions.node.split(".")[0]);
step(
  1,
  `Node 22 or later (${process.version}) and Git`,
  nodeMajor >= 22 && run("git", ["--version"]).status === 0,
);

// Step 2: install the file (here into a private prefix instead of their real global folder).
const npm = win ? "npm.cmd" : "npm";
const inst = run(npm, [
  "install",
  "-g",
  "--prefix",
  prefix,
  "--no-audit",
  "--no-fund",
  "--prefer-offline",
  tgz,
]);
step(
  2,
  "npm install -g <the file>",
  inst.status === 0 && existsSync(bin),
  inst.status === 0 ? "" : inst.stderr,
);

// Step 3: their app: a Git repo with committed work (the demo app without capsules).
cpSync(join(ROOT, "examples", "billing-demo"), app, { recursive: true });
rmSync(join(app, ".capsules"), { recursive: true, force: true });
for (const a of [
  ["init", "-q"],
  ["config", "core.autocrlf", "false"],
  ["add", "-A"],
  ["-c", "user.email=partner@example.com", "-c", "user.name=Partner", "commit", "-qm", "their app"],
])
  run("git", a, { cwd: app, shell: false });
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const v = capsules("--version");
step(3, "capsules --version", v.stdout.trim() === pkg.version, v.stdout + v.stderr);

// Step 4: init.
const init = capsules("init", "--yes");
step(
  4,
  "capsules init (answering yes)",
  init.status === 0,
  init.status === 0 ? "" : init.stdout + init.stderr,
);
const settingsPath = join(app, ".claude", "settings.local.json");
const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : null;
const hookCmd = settings?.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command ?? "";
step(
  5,
  "the hooks point at the installed capsules, not at this repo",
  hookCmd.includes(prefix.split("\\").join("/")) || hookCmd.includes(prefix),
  hookCmd,
);

// The hook, run exactly as Claude Code runs it: an agent tries to switch its guard off.
const blocked = spawnSync(hookCmd, {
  shell: true,
  cwd: app,
  encoding: "utf8",
  input: JSON.stringify({
    cwd: app,
    session_id: "partner",
    tool_name: "Write",
    tool_input: { file_path: settingsPath, content: "{}" },
  }),
});
step(
  6,
  "the live hook blocks an agent's edit to .claude/settings.local.json",
  blocked.status === 2,
  blocked.stderr.split("\n")[0],
);

// Step 5 in the guide: doctor.
const doc = capsules("doctor");
step(
  7,
  "capsules doctor says the app is unaffected",
  doc.status === 0 && doc.stdout.includes("your app is unaffected"),
  doc.status === 0 ? "" : doc.stdout,
);

// The map works from the installed package (templates and all).
const map = capsules("map");
step(
  8,
  "capsules map",
  map.status === 0 && existsSync(join(app, ".capsules", "_cache", "map.html")),
  map.stdout.split("\n")[1] ?? "",
);

// M6a: a new install starts in gentle mode, opens a session per Claude Code session, and an
// agent's note reaches the human in capsules review.
const config = readFileSync(join(app, ".capsules", "config.yaml"), "utf8");
step(
  9,
  "new install: gentle mode and the SessionStart hook",
  /^mode: gentle(\s|$)/m.test(config) && !!settings?.hooks?.SessionStart,
  /^mode:.*$/m.exec(config)?.[0] ?? "no mode line",
);
const note = capsules("propose", "README.md", "--why", "a note for the owner");
const rev = capsules("review");
step(
  10,
  "capsules propose, then capsules review shows the note",
  note.status === 0 && rev.status === 0 && rev.stdout.includes("a note for the owner"),
  note.stdout + note.stderr + rev.stderr,
);

// Step 9 in the guide: remove, then uninstall.
const rem = capsules("remove", "--all", "--yes");
const status = run("git", ["status", "--porcelain", "--untracked-files=all", "--ignored"], {
  cwd: app,
  shell: false,
}).stdout.trim();
step(
  11,
  "capsules remove --all leaves their repo exactly as before",
  rem.status === 0 && status === "",
  status,
);
const un = run(npm, ["uninstall", "-g", "--prefix", prefix, "@pyscoparth/capsules"]);
step(12, "npm uninstall -g @pyscoparth/capsules", un.status === 0 && !existsSync(bin), un.stderr);

rmSync(tmp, { recursive: true, force: true });
console.log(
  failed
    ? `\n${failed} step(s) failed.`
    : "\nEvery step of docs/PARTNER-INSTALL.md worked on a clean copy.",
);
process.exit(failed ? 1 : 0);
