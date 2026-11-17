// M6c (C19): trial safety. `capsules pause` / `resume`, `log`, `report` and `stats`, and how
// the hooks behave while paused. Every command here reads and writes this machine's
// .capsules/_cache/ only.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CLI, cleanup, commit, demoHistory, gitIn } from "./helpers.js";

afterAll(cleanup);

const T0 = "2026-11-17T10:00:00.000Z";
const later = (hours: number) => new Date(Date.parse(T0) + hours * 3600_000).toISOString();

/** A human's terminal: no agent variables. `at` sets the clock. */
const env = (at = T0, extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
  const e: NodeJS.ProcessEnv = { ...process.env, CAPSULES_NOW: at, CAPSULES_TODAY: "2026-11-17" };
  for (const k of ["CAPSULES_SESSION", "CLAUDECODE", "CLAUDE_ENV_FILE", "GITHUB_ACTIONS"])
    delete e[k];
  return { ...e, ...extra };
};
const cli = (dir: string, args: string[], at = T0, extra: Record<string, string> = {}) =>
  spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: env(at, extra),
  });
const hook = (dir: string, event: string, input: object, at = T0) =>
  spawnSync(process.execPath, [CLI, "hook", event], {
    cwd: dir,
    input: JSON.stringify({ cwd: dir, session_id: "trial-1", ...input }),
    encoding: "utf8",
    env: env(at),
  });

const REFUNDS = join("tests", "invoices", "refunds.test.js");
const ASSERT = "  assert.throws(() => refund(invoice, 901), /exceeds/);\n";
const weaken = (dir: string, session = "trial-1") => ({
  session_id: session,
  tool_name: "Edit",
  tool_input: { file_path: join(dir, REFUNDS), old_string: ASSERT, new_string: "" },
});
const PAUSE_FILE = (dir: string) => join(dir, ".capsules", "_cache", "pause.json");

describe("capsules pause and resume (C19.1)", () => {
  it("are refused in an agent's shell, and pre-bash blocks them", () => {
    const dir = demoHistory();
    for (const v of [{ CAPSULES_SESSION: "x" }, { CLAUDECODE: "1" }]) {
      const r = cli(dir, ["pause"], T0, v);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("is for humans");
      expect(existsSync(PAUSE_FILE(dir))).toBe(false);
      expect(cli(dir, ["resume"], T0, v).status).toBe(1);
    }
    for (const command of [
      "capsules pause",
      "npx capsules resume",
      "capsules pause --hours 1 && echo ok",
      "capsules log --false-alarm 3",
      "capsules log --false-alarm=3 --why x",
    ]) {
      const b = hook(dir, "pre-bash", { tool_name: "Bash", tool_input: { command } });
      expect(b.status, command).toBe(2);
      expect(b.stderr, command).toContain("for humans only");
    }
    // Reading the log is fine for anyone.
    expect(
      hook(dir, "pre-bash", { tool_name: "Bash", tool_input: { command: "capsules log" } }).status,
    ).toBe(0);
  });

  it("an agent can't pause the guard by writing the pause file, with a tool or the shell", () => {
    const dir = demoHistory();
    const body = JSON.stringify({ format: "0.1", since: T0, until: later(24) });
    const w = hook(dir, "pre-edit", {
      tool_name: "Write",
      tool_input: { file_path: PAUSE_FILE(dir), content: body },
    });
    expect(w.status).toBe(2);
    for (const command of [
      `echo '${body}' > .capsules/_cache/pause.json`,
      "cp /tmp/p.json .capsules/_cache/pause.json",
      "rm .capsules/_cache/log.jsonl",
    ]) {
      const b = hook(dir, "pre-bash", { tool_name: "Bash", tool_input: { command } });
      expect(b.status, command).toBe(2);
      expect(b.stderr, command).toContain("capsules' pause switch");
    }
  });

  it("nor through another name, a symlink, or the rest of the guard's cache (M6c review)", () => {
    const dir = demoHistory();
    const cache = join(dir, ".capsules", "_cache");
    mkdirSync(cache, { recursive: true });
    const write = (file: string) =>
      hook(dir, "pre-edit", {
        tool_name: "Write",
        tool_input: { file_path: file, content: "{}" },
      });
    // Any file in _cache, including the hook index and sessions' one-rule memory.
    for (const f of ["log.jsonl", "hook-index.json", join("sessions", "x.json"), "map.html"])
      expect(write(join(cache, f)).status, f).toBe(2);
    expect(
      hook(dir, "pre-edit", {
        tool_name: "Edit",
        tool_input: { file_path: join(cache, "log.jsonl"), old_string: "a", new_string: "" },
      }).status,
    ).toBe(2);
    // Letter case: the same file on Windows and macOS; still the cache on Linux.
    expect(write(join(cache, "Pause.json")).status).toBe(2);
    expect(write(join(dir, ".capsules", "_CACHE", "pause.json")).status).toBe(
      process.platform === "linux" ? 0 : 2,
    );
    for (const command of [
      "echo {} > .capsules/_cache/PAUSE.json",
      "rm .capsules/_cache/hook-index.json",
      "rm -rf .capsules/_cache/sessions",
    ]) {
      const b = hook(dir, "pre-bash", { tool_name: "Bash", tool_input: { command } });
      expect(b.status, command).toBe(2);
    }
    // A symlink elsewhere that points into the cache.
    const link = join(dir, "src", "notes.json");
    try {
      symlinkSync(join(cache, "pause.json"), link);
    } catch {
      return; // Windows without symlink rights
    }
    expect(write(link).status).toBe(2);
  });

  it("a pause that says it starts in the future is ignored and removed", () => {
    const dir = demoHistory();
    writeFileSync(
      PAUSE_FILE(dir),
      JSON.stringify({
        format: "0.1",
        since: "2099-01-01T00:00:00.000Z",
        until: "2099-01-02T00:00:00.000Z",
      }),
    );
    expect(hook(dir, "pre-edit", weaken(dir)).status).toBe(2);
    expect(existsSync(PAUSE_FILE(dir))).toBe(false);
  });

  it("while paused, a blocked shell command is let through and logged; warnings stay", () => {
    const dir = demoHistory();
    expect(cli(dir, ["pause"]).status).toBe(0);
    const b = hook(
      dir,
      "pre-bash",
      { tool_name: "Bash", tool_input: { command: "sed -i d tests/invoices/refunds.test.js" } },
      later(1),
    );
    expect(b.status).toBe(0);
    expect(b.stdout).toContain("capsules is paused, so this was let through");
    // A gentle-mode warning still appears and is logged as a warning, not a pause.
    const cfg = join(dir, ".capsules", "config.yaml");
    writeFileSync(cfg, readFileSync(cfg, "utf8").replace(/^mode:.*$/m, "") + "mode: gentle\n");
    const w = hook(
      dir,
      "pre-edit",
      {
        session_id: "g1",
        agent_type: "frontend-agent",
        tool_name: "Edit",
        tool_input: {
          file_path: join(dir, "src", "web", "checkout.tsx"),
          old_string: "export",
          new_string: "export",
        },
      },
      later(1),
    );
    expect(w.status, w.stderr).toBe(0);
    expect(w.stdout).toContain("W111");
    expect(w.stdout).toContain("capsules is PAUSED");
    const json = JSON.parse(cli(dir, ["log", "--json"], later(1)).stdout) as {
      entries: { kind: string; code?: string; tool?: string }[];
    };
    expect(json.entries.map((e) => `${e.kind}:${e.code ?? ""}:${e.tool ?? ""}`)).toEqual([
      "warning:W111:",
      "paused:E027:Bash",
      "pause::capsules pause",
    ]);
    // A paused entry can be marked a false alarm too.
    expect(cli(dir, ["log", "--false-alarm", "2", "--dry-run"], later(1)).stdout).toContain(
      "Would mark #2",
    );
    expect(cli(dir, ["log", "--false-alarm", "2"], later(1)).status).toBe(0);
  });

  it("after a pause ends by itself, the next session start says so", () => {
    const dir = demoHistory();
    expect(cli(dir, ["pause", "--hours", "1"]).status).toBe(0);
    const s = hook(dir, "session-start", { session_id: "late" }, later(3));
    expect(s.stdout).toContain("the pause ended");
    expect(existsSync(PAUSE_FILE(dir))).toBe(false);
  });

  it("while paused, a blocked edit is let through and logged; it resumes by itself after 24 hours", () => {
    const dir = demoHistory();
    expect(hook(dir, "pre-edit", weaken(dir)).status).toBe(2);

    const p = cli(dir, ["pause"]);
    expect(p.status, p.stderr).toBe(0);
    expect(p.stdout).toContain("for 24 hours");
    expect(p.stdout).toContain("CI check everything as usual");

    // Paused: judged, logged, let through, with a reminder.
    const e = hook(dir, "pre-edit", weaken(dir, "trial-2"), later(1));
    expect(e.status, e.stderr).toBe(0);
    const msg = (JSON.parse(e.stdout) as { systemMessage: string }).systemMessage;
    expect(msg).toContain("capsules is paused, so this was let through");
    expect(msg).toContain("(E027)");
    // Reminders at the start and the end of a task.
    expect(hook(dir, "session-start", { session_id: "s" }, later(1)).stdout).toContain(
      "capsules is PAUSED",
    );
    expect(hook(dir, "stop", {}, later(1)).stdout).toContain("capsules is PAUSED");
    // An allowed edit gets the reminder too.
    const ok = hook(
      dir,
      "pre-edit",
      {
        tool_name: "Edit",
        tool_input: {
          file_path: join(dir, "src", "billing", "invoices", "refund.js"),
          old_string: "export",
          new_string: "export",
        },
      },
      later(2),
    );
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("capsules is PAUSED");

    // 24 hours later it blocks again, and says once that the pause ended.
    const back = hook(dir, "pre-edit", weaken(dir, "trial-3"), later(24));
    expect(back.status).toBe(2);
    expect(back.stderr).toContain("(E027)");
    expect(back.stderr).toContain("the pause ended");
    const stop = hook(dir, "stop", {}, later(24.1));
    expect(stop.stdout).toContain("the pause ended");
    expect(existsSync(PAUSE_FILE(dir))).toBe(false);
    expect(hook(dir, "stop", {}, later(24.2)).stdout).not.toContain("pause");

    const log = cli(dir, ["log"], later(25)).stdout;
    expect(log).toMatch(/#1 .*blocked E027/);
    expect(log).toMatch(/#2 .*paused\b/);
    expect(log).toMatch(/#3 .*paused, let through E027/);
    expect(log).toMatch(/#4 .*resumed/);
    expect(log).toMatch(/#5 .*blocked E027/);
    // Newest first.
    expect(log.indexOf("#5 ")).toBeLessThan(log.indexOf("#1 "));
  });

  it("a pause file can't keep the guard off for more than 24 hours", () => {
    const dir = demoHistory();
    writeFileSync(
      PAUSE_FILE(dir),
      JSON.stringify({ format: "0.1", since: T0, until: "2099-01-01T00:00:00.000Z" }),
    );
    expect(hook(dir, "pre-edit", weaken(dir), later(23)).status).toBe(0);
    expect(hook(dir, "pre-edit", weaken(dir, "t2"), later(24)).status).toBe(2);
  });

  it("--hours is 1 to 24; resume turns it back on; check ignores a pause", () => {
    const dir = demoHistory();
    for (const bad of ["0", "25", "1.5", "x"])
      expect(cli(dir, ["pause", "--hours", bad]).status).toBe(64);
    expect(cli(dir, ["pause", "--hours", "2", "--dry-run"]).stdout).toContain("Would pause");
    expect(existsSync(PAUSE_FILE(dir))).toBe(false);
    expect(cli(dir, ["pause", "--hours", "2"]).stdout).toContain("for 2 hours");
    expect(hook(dir, "pre-edit", weaken(dir), later(1)).status).toBe(0);

    // `capsules check` (and so CI) doesn't know about pauses: the weakened test still fails it.
    const f = join(dir, REFUNDS);
    writeFileSync(f, readFileSync(f, "utf8").replace(ASSERT, ""));
    writeFileSync(
      join(dir, "src", "billing", "invoices", "refund.js"),
      readFileSync(join(dir, "src", "billing", "invoices", "refund.js"), "utf8") + "\n// changed\n",
    );
    gitIn(dir, "add", "-A");
    commit(dir, "agent work", ["Capsule-Agent: default", "Capsule-Session: s1"]);
    const check = cli(dir, ["check", "--no-run"], later(1));
    expect(check.status).toBe(1);
    expect(check.stdout).toContain("E028");

    expect(cli(dir, ["resume"], later(1)).stdout).toContain("Turned capsules back on");
    expect(hook(dir, "pre-edit", weaken(dir, "t9"), later(1)).status).toBe(2);
    expect(cli(dir, ["resume"], later(1)).stdout).toContain("isn't paused");
  });
});

describe("capsules log (C19.2)", () => {
  it("lists blocks, warnings, proposals and approvals newest first; false alarms are humans only", () => {
    const dir = demoHistory();
    expect(cli(dir, ["log"]).stdout).toContain("Nothing logged on this machine yet");
    expect(hook(dir, "pre-edit", weaken(dir)).status).toBe(2);
    expect(
      cli(dir, ["propose", "billing.invoices#C1", "--why", "SECRET-REASON partial refunds"]).status,
    ).toBe(0);
    const out = cli(dir, ["log"]).stdout;
    expect(out).toMatch(/#2 .*proposal +billing\.invoices#C1/);
    expect(out).not.toContain("SECRET-REASON"); // the proposal's wording stays in the proposal
    expect(out.indexOf("#2 ")).toBeLessThan(out.indexOf("#1 "));

    expect(cli(dir, ["log", "--false-alarm", "1"], T0, { CLAUDECODE: "1" }).status).toBe(1);
    expect(cli(dir, ["log", "--false-alarm", "2"]).status).toBe(64); // a proposal isn't a block
    expect(cli(dir, ["log", "--false-alarm", "99"]).status).toBe(64);
    const m = cli(dir, ["log", "--false-alarm", "#1", "--why", "the test really was wrong"]);
    expect(m.status, m.stderr).toBe(0);
    const after = cli(dir, ["log"]).stdout;
    expect(after).toContain("[marked a false alarm]");
    expect(after).toContain("why: the test really was wrong");

    const json = JSON.parse(cli(dir, ["log", "--json"]).stdout) as {
      total: number;
      entries: { n: number; kind: string; falseAlarm: boolean }[];
    };
    expect(json.total).toBe(3);
    expect(json.entries.map((e) => e.n)).toEqual([3, 2, 1]);
    expect(json.entries.find((e) => e.n === 1)?.falseAlarm).toBe(true);
  });

  it("shows the last 50 by default, --limit and --all", () => {
    const dir = demoHistory();
    for (let i = 0; i < 55; i++)
      expect(
        hook(dir, "pre-bash", { tool_name: "Bash", tool_input: { command: `sed -i d ${REFUNDS}` } })
          .status,
      ).toBe(2);
    expect(cli(dir, ["log"]).stdout).toContain("(50 of 55; --all shows every entry)");
    expect(cli(dir, ["log", "--limit", "3"]).stdout).toContain("(3 of 55;");
    expect(cli(dir, ["log", "--all"]).stdout).toContain("(55 of 55)");
    expect(cli(dir, ["log", "--limit", "0"]).status).toBe(64);
  }, 180_000);
});

describe("capsules report (C19.3)", () => {
  it("holds versions, settings and the last 50 entries, never code, capsule text or emails", () => {
    const dir = demoHistory("someone.private@example.com");
    // An email in permissions.yaml and a comment in config.yaml must not reach the report.
    const perms = join(dir, ".capsules", "permissions.yaml");
    writeFileSync(
      perms,
      readFileSync(perms, "utf8").replace("emails: []", 'emails: ["owner.secret@example.com"]'),
    );
    const cfg = join(dir, ".capsules", "config.yaml");
    // Comments never reach the report (only parsed settings do); no email here, so the
    // email scrub can't hide a leak.
    writeFileSync(cfg, "# MARKER-COMMENT ask ops.team@example.com\n" + readFileSync(cfg, "utf8"));
    for (let i = 0; i < 52; i++) hook(dir, "pre-edit", weaken(dir, `r${i}`));
    cli(dir, ["propose", "billing.invoices#C1", "--why", "SECRET-REASON"]);
    // A broken hook input is an internal error, and is logged, but not the text it quoted.
    spawnSync(process.execPath, [CLI, "hook", "pre-edit"], {
      cwd: dir,
      input: '{"MARKER-INPUT const secret = 1',
      encoding: "utf8",
      env: env(),
    });

    const r = cli(dir, ["report"]);
    expect(r.status, r.stderr).toBe(0);
    const file = join(dir, ".capsules", "_cache", "capsules-report.txt");
    const text = readFileSync(file, "utf8");
    // It shows the whole file before anything else happens.
    expect(r.stdout).toContain(text);
    expect(r.stdout).toContain("Nothing has been sent");

    expect(text).toMatch(/capsules: +0\.1\.0/);
    expect(text).toContain(`node:     ${process.version}`);
    expect(text).toMatch(/mode: +strict/);
    expect(text).toMatch(/paused: +no/);
    expect(text).toContain('"weakened-tests"');
    expect(text).toContain("The last 50 log entries (of 54)");
    expect(text).toMatch(/Internal errors \(1 in all\)[\s\S]*internal error +hook pre-edit/);

    // Never: emails, capsule text, code, proposal wording, the machine's folders.
    expect(text).not.toMatch(/@example\.com/);
    expect(text).not.toContain("MARKER-COMMENT");
    expect(text).not.toContain("MARKER-INPUT");
    expect(text).not.toContain("SECRET-REASON");
    // People: a count, never their names or GitHub handles.
    expect(text).toMatch(/people: +1 in permissions\.yaml/);
    expect(text).not.toContain("parthjatia");
    expect(text).not.toMatch(/\bparth\b/i);
    expect(text).toMatch(/agents: +default \(builder\)/);
    expect(text).toMatch(/hooks: +not installed/);
    const capsuleText = readFileSync(join(dir, ".capsules", "billing", "invoices.md"), "utf8");
    const intent = /## intent I1\n+(.+)/.exec(capsuleText)![1]!;
    expect(intent.length).toBeGreaterThan(20);
    expect(text).not.toContain(intent);
    const code = readFileSync(join(dir, "src", "billing", "invoices", "refund.js"), "utf8");
    for (const line of code.split("\n").filter((l) => l.trim().length > 25))
      expect(text).not.toContain(line.trim());
    expect(text).not.toContain(dir);
    expect(text).not.toContain(dir.split("\\").join("/"));

    // --out writes elsewhere; --dry-run writes nothing.
    expect(cli(dir, ["report", "--out", "mine.txt"]).status).toBe(0);
    expect(existsSync(join(dir, "mine.txt"))).toBe(true);
    const dry = cli(dir, ["report", "--dry-run", "--out", "none.txt"]);
    expect(dry.stdout).toContain("nothing was written");
    expect(existsSync(join(dir, "none.txt"))).toBe(false);

    // Hooks that call a program that is gone (a broken upgrade) are named in the report.
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(
      join(dir, ".claude", "settings.local.json"),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                { type: "command", command: `node "${join(dir, "gone", "cli.js")}" hook stop` },
              ],
            },
          ],
        },
      }),
    );
    expect(cli(dir, ["report", "--dry-run"]).stdout).toMatch(
      /hooks: +1 installed; MISSING program/,
    );
  }, 180_000);
});

describe("capsules stats (C19.5)", () => {
  it("counts the last 7 days in plain words, and --since narrows it", () => {
    const dir = demoHistory();
    hook(dir, "pre-edit", weaken(dir, "a"), later(-24 * 10)); // 10 days ago: outside 7d
    hook(dir, "pre-edit", weaken(dir, "b"), later(-3));
    hook(
      dir,
      "pre-bash",
      { tool_name: "Bash", tool_input: { command: `rm ${REFUNDS}` } },
      later(-3),
    );
    cli(dir, ["propose", "billing.invoices#C1", "--why", "x"], later(-2));
    cli(dir, ["log", "--false-alarm", "2", "--why", "fine"], later(-0.5));

    const s = cli(dir, ["stats"]).stdout;
    expect(s).toContain("In the last 7 days on this machine:");
    expect(s).toMatch(/2 edits blocked \(E027 x2\)/);
    expect(s).toMatch(/1 proposal or note left for an owner/);
    expect(s).toMatch(/0 items approved by a human/);
    expect(s).toMatch(/1 block or warning marked as a false alarm/);
    expect(s).toMatch(/Most blocked: tests\/invoices\/refunds\.test\.js \(2\)/);

    expect(cli(dir, ["stats", "--since", "30d"]).stdout).toMatch(/3 edits blocked/);
    expect(cli(dir, ["stats", "--since", "1h"]).stdout).toMatch(/0 edits blocked/);
    const j = JSON.parse(cli(dir, ["stats", "--json", "--since", "30d"]).stdout) as {
      blocks: number;
      proposals: number;
      falseAlarms: number;
    };
    expect(j).toMatchObject({ blocks: 3, proposals: 1, falseAlarms: 1 });
    for (const bad of ["7", "d", "0d", "7w"])
      expect(cli(dir, ["stats", "--since", bad]).status).toBe(64);
  });
});
