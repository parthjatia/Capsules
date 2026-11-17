// M6c (C19.4): a design partner installs a newer package over the one they have. Their
// capsules, approvals, proposals, settings and Claude Code settings must all survive, and the
// guard must keep working, both before and after they run `capsules init` again.
//
// "The one they have" is the real package file partners received: 0.1.0-rc.2, kept as a
// fixture. The global install is simulated in a temp folder: npm puts a package in the same
// folder on every upgrade, so the upgrade replaces that folder's contents with this build.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { cleanup, commit, demoHistory, gitIn, ROOT } from "./helpers.js";

const OLD_TGZ = join(ROOT, "test", "fixtures", "packages", "pyscoparth-capsules-0.1.0-rc.2.tgz");
const temps: string[] = [];
afterAll(() => {
  cleanup();
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

/** Unpack an npm package file (gzip + ustar) into `dest`, without the leading `package/`. */
function unpack(tgz: string, dest: string): void {
  const buf = gunzipSync(readFileSync(tgz));
  const str = (a: number, b: number) => buf.toString("utf8", a, b).replace(/\0.*$/s, "");
  for (let off = 0; off + 512 <= buf.length;) {
    const name = str(off, off + 100);
    if (!name) break;
    const size = parseInt(str(off + 124, off + 136).trim() || "0", 8);
    const type = str(off + 156, off + 157);
    const prefix = str(off + 345, off + 500);
    const path = (prefix ? prefix + "/" : "") + name;
    const body = buf.subarray(off + 512, off + 512 + size);
    if (type === "0" || type === "") {
      const out = join(dest, ...path.replace(/^package\//, "").split("/"));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, body);
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
}

/** Every file under `dir` (except `skip`), with its bytes. */
function snapshot(dir: string, skip: (rel: string) => boolean): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const rel = relative(dir, p).split("\\").join("/");
      if (skip(rel)) continue;
      if (statSync(p).isDirectory()) walk(p);
      else out.set(rel, readFileSync(p, "utf8"));
    }
  };
  walk(dir);
  return out;
}

const humanEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env, CAPSULES_TODAY: "2026-11-17" };
  for (const k of ["CAPSULES_SESSION", "CLAUDECODE", "CLAUDE_ENV_FILE", "GITHUB_ACTIONS"])
    delete env[k];
  return env;
};

describe("upgrading from the package partners have (0.1.0-rc.2)", () => {
  it("keeps .capsules/, approvals, proposals and settings, and the guard keeps working", () => {
    expect(existsSync(OLD_TGZ)).toBe(true);
    const tmp = mkdtempSync(join(tmpdir(), "capsules-upgrade-"));
    temps.push(tmp);
    // Where `npm install -g` puts the package; the same folder before and after an upgrade.
    const pkg = join(tmp, "global", "node_modules", "@pyscoparth", "capsules");
    unpack(OLD_TGZ, pkg);
    const cli = join(pkg, "dist", "cli.js");
    const capsules = (dir: string, ...args: string[]) =>
      spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: "utf8", env: humanEnv() });
    expect(capsules(tmp, "--version").stdout.trim()).toBe("0.1.0-rc.2");

    // Their project, with their own Claude Code settings already there.
    const dir = demoHistory();
    const settingsPath = join(dir, ".claude", "settings.local.json");
    mkdirSync(dirname(settingsPath), { recursive: true });
    const theirSettings =
      JSON.stringify(
        {
          permissions: { allow: ["Bash(npm test)"] },
          hooks: {
            PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo mine" }] }],
          },
        },
        null,
        2,
      ) + "\n";
    writeFileSync(settingsPath, theirSettings);

    // A trial under rc.2: init, a comment of their own in config.yaml, gentle mode, a proposal,
    // a new test approved by the owner, and a gentle-mode warning logged by rc.2's hook.
    const init1 = capsules(dir, "init", "--yes");
    expect(init1.status, init1.stdout + init1.stderr).toBe(0);
    const cfg = join(dir, ".capsules", "config.yaml");
    writeFileSync(cfg, "# our team's note: keep this line\n" + readFileSync(cfg, "utf8"));
    expect(capsules(dir, "mode", "gentle").status).toBe(0);
    expect(
      capsules(dir, "propose", "billing.invoices#C1", "--why", "refunds may be partial").status,
    ).toBe(0);
    const NEW_TEST = "tests/invoices/partial.test.js";
    writeFileSync(join(dir, ...NEW_TEST.split("/")), 'import { test } from "node:test";\n');
    const review = capsules(dir, "review");
    const id = /\b(r\d+)\b[^\n]*partial\.test\.js/.exec(review.stdout)?.[1];
    expect(id, review.stdout).toBeTruthy();
    expect(capsules(dir, "review", "approve", id!).status).toBe(0);
    const hook = (cliPath: string, input: object) =>
      spawnSync(process.execPath, [cliPath, "hook", "pre-edit"], {
        cwd: dir,
        input: JSON.stringify({ cwd: dir, session_id: "upgrade-1", ...input }),
        encoding: "utf8",
        env: humanEnv(),
      });
    // frontend-agent may not touch payments code: gentle mode lets it through with W111.
    const gentle = hook(cli, {
      agent_type: "frontend-agent",
      tool_name: "Edit",
      tool_input: {
        file_path: join(dir, "src", "web", "checkout.tsx"),
        old_string: "export",
        new_string: "export",
      },
    });
    expect(gentle.status, gentle.stderr).toBe(0);
    expect(gentle.stdout).toContain("W111");
    gitIn(dir, "add", "-A", ".capsules", NEW_TEST);
    commit(dir, "trial under rc.2");

    const before = snapshot(join(dir, ".capsules"), (r) => r.startsWith("_cache"));
    const settingsBefore = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };

    // The upgrade: the new package replaces the old one in the same folder.
    rmSync(pkg, { recursive: true, force: true });
    for (const part of ["dist", "templates", "package.json", "LICENSE"])
      cpSync(join(ROOT, part), join(pkg, part), { recursive: true });
    const version = (
      JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
        version: string;
      }
    ).version;
    expect(capsules(tmp, "--version").stdout.trim()).toBe(version);
    expect(version).not.toBe("0.1.0-rc.2");

    // 1. Right after the upgrade, before anything else: the hooks rc.2 installed call the new
    //    version, and still block weakening an existing test.
    // The exact command rc.2 wrote into their settings, run as Claude Code would run it.
    const installed = Object.values(settingsBefore.hooks)
      .flat()
      .flatMap((g) => g.hooks.map((h) => h.command))
      .find((c) => c.endsWith("hook pre-edit"));
    expect(installed).toBeTruthy();
    const installedCli = /^node "([^"]+)" hook pre-edit$/.exec(installed!)?.[1];
    expect(installedCli, installed).toBeTruthy();
    expect(installedCli!.split("\\").join("/")).toBe(cli.split("\\").join("/"));
    const blocked = hook(installedCli!, {
      session_id: "upgrade-2",
      tool_name: "Edit",
      tool_input: {
        file_path: join(dir, "tests", "invoices", "refunds.test.js"),
        old_string: "  assert.throws(() => refund(invoice, 901), /exceeds/);\n",
        new_string: "",
      },
    });
    expect(blocked.status, blocked.stdout + blocked.stderr).toBe(2);
    expect(blocked.stderr).toContain("(E027)");

    // 2. `capsules init` again, as the guide says: nothing of theirs changes.
    const init2 = capsules(dir, "init", "--yes");
    expect(init2.status, init2.stdout + init2.stderr).toBe(0);
    const after = snapshot(join(dir, ".capsules"), (r) => r.startsWith("_cache"));
    for (const f of [
      "config.yaml",
      "permissions.yaml",
      "capsules.lock",
      "approvals.lock",
      "billing/invoices.md",
    ])
      expect(after.get(f), f).toBe(before.get(f));
    expect(after.get("config.yaml")).toContain("# our team's note: keep this line");
    expect(after.get("config.yaml")).toMatch(/^mode: gentle/m);
    const proposals = [...before.keys()].filter((k) => k.startsWith("_proposals/"));
    expect(proposals.length).toBe(1);
    for (const p of proposals) expect(after.get(p), p).toBe(before.get(p));
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());

    // Their own Claude Code settings are still there, and our hooks appear once each.
    const settingsAfter = JSON.parse(readFileSync(settingsPath, "utf8")) as typeof settingsBefore;
    expect(settingsAfter).toMatchObject({ permissions: { allow: ["Bash(npm test)"] } });
    const commands = Object.values(settingsAfter.hooks)
      .flat()
      .flatMap((g) => g.hooks.map((h) => h.command));
    expect(commands).toContain("echo mine");
    for (const event of ["session-start", "pre-edit", "pre-bash", "stop"])
      expect(commands.filter((c) => c.endsWith(`hook ${event}`)).length, event).toBe(1);
    expect(settingsAfter).toEqual(settingsBefore);

    // 3. Everything still reads as it did: approvals hold, the proposal waits, the rc.2
    //    gentle-mode warning is still listed, and nothing is out of date.
    const check = capsules(dir, "check", "--no-run");
    expect(check.status, check.stdout + check.stderr).toBe(0);
    expect(check.stdout).toContain("W112");
    expect(check.stdout).not.toMatch(/E01[01]/);
    expect(capsules(dir, "review").stdout).not.toContain("partial.test.js");
    const mode = capsules(dir, "mode");
    expect(mode.stdout).toContain("frontend-agent");
    expect(mode.stdout).toContain("src/web/checkout.tsx");
    expect(capsules(dir, "compile", "--check").status).toBe(0);

    // 4. The new commands work on the upgraded install, and `remove` still restores their
    //    settings byte for byte, using what rc.2 recorded at install time.
    expect(capsules(dir, "log").stdout).toContain("blocked E027");
    expect(capsules(dir, "stats").stdout).toContain("1 edit blocked");
    const removed = capsules(dir, "remove", "--yes");
    expect(removed.status, removed.stdout + removed.stderr).toBe(0);
    expect(readFileSync(settingsPath, "utf8")).toBe(theirSettings);
  }, 180_000);
});
