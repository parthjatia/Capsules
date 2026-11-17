// M6a, zero friction (C18): automatic sessions (C18.1) and keep-going block messages (C18.7).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CLI, cleanup, commit, demoHistory, demoRepo, gitIn } from "./helpers.js";

afterAll(cleanup);

/** The environment of a hook or command run outside any agent session. */
const clean = (extra: Record<string, string> = {}) => {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  delete env.CAPSULES_SESSION;
  delete env.CLAUDECODE;
  delete env.CLAUDE_ENV_FILE;
  return { ...env, ...extra };
};

function hook(dir: string, event: string, input: object, env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [CLI, "hook", event], {
    cwd: dir,
    input: JSON.stringify({ cwd: dir, ...input }),
    encoding: "utf8",
    env: clean(env),
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const cli = (dir: string, env: Record<string, string>, ...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: "utf8", env: clean(env) });

const start = (dir: string, session_id: string, extra: object = {}) => {
  const envFile = join(dir, `.env-${session_id}`);
  writeFileSync(envFile, "");
  const r = hook(
    dir,
    "session-start",
    { hook_event_name: "SessionStart", session_id, source: "startup", ...extra },
    { CLAUDE_ENV_FILE: envFile },
  );
  const id = /CAPSULES_SESSION=(cc-[0-9a-f]{16})/.exec(readFileSync(envFile, "utf8"))?.[1];
  return { ...r, id, envFile };
};
const edit = (dir: string, session_id: string, file: string, extra: object = {}) =>
  hook(dir, "pre-edit", {
    hook_event_name: "PreToolUse",
    session_id,
    tool_name: "Edit",
    tool_input: { file_path: join(dir, file), old_string: "a", new_string: "b" },
    ...extra,
  });

describe("automatic sessions (C18.1)", () => {
  it("SessionStart opens a session as default, tells Claude, and hands it to later shell commands", () => {
    const dir = demoRepo();
    const r = start(dir, "claude-one");
    expect(r.status).toBe(0);
    expect(r.id).toMatch(/^cc-[0-9a-f]{16}$/);
    expect(r.stdout).toContain(
      `opened session ${r.id} for this Claude Code session, as default (role builder`,
    );
    expect(r.stdout).toContain("capsules explain <file>");
    expect(readFileSync(r.envFile, "utf8")).toBe(`export CAPSULES_SESSION=${r.id}\n`);
    // It never becomes the repo's current session, so it can't take over another window's.
    expect(existsSync(join(dir, ".capsules", "_cache", "sessions", "current"))).toBe(false);
  });

  it("a resumed or compacted session keeps its session", () => {
    const dir = demoRepo();
    const first = start(dir, "claude-two");
    const again = start(dir, "claude-two", { source: "resume" });
    expect(again.id).toBe(first.id);
    expect(again.stdout).toContain(`continuing session ${first.id}`);
  });

  it("`claude --agent <name>` opens the session as that agent; an unknown name is default", () => {
    const dir = demoRepo();
    expect(start(dir, "claude-three", { agent_type: "test-maintainer" }).stdout).toContain(
      "as test-maintainer (role maintainer",
    );
    expect(start(dir, "claude-four", { agent_type: "Explore" }).stdout).toContain(
      "as default (role builder",
    );
  });

  it("commits from Claude's shell get that session's trailers", () => {
    const dir = demoRepo();
    const { id } = start(dir, "claude-five");
    const msg = join(dir, "msg.txt");
    writeFileSync(msg, "a change\n");
    expect(cli(dir, { CAPSULES_SESSION: id! }, "hook", "commit-msg", msg).status).toBe(0);
    const text = readFileSync(msg, "utf8");
    expect(text).toContain(`Capsule-Session: ${id}`);
    expect(text).toContain("Capsule-Agent: default");
  });

  it("two windows keep the one rule apart: code in one, the test in the other is allowed", () => {
    const dir = demoRepo();
    start(dir, "window-a");
    start(dir, "window-b", { agent_type: "test-maintainer" });
    expect(edit(dir, "window-a", "src/billing/invoices/create.js").status).toBe(0);
    // The same window may not now change the existing test that judges that code (V1)...
    const same = edit(dir, "window-a", "tests/invoices/duplicates.test.js");
    expect(same.status).toBe(2);
    expect(same.stderr).toContain("(E028)");
    // ...but the test-maintainer in its own window may.
    const other = edit(dir, "window-b", "tests/invoices/duplicates.test.js", {
      agent_type: "test-maintainer",
    });
    expect(other.status).toBe(0);
  });

  it("`capsules work` inside an automatic session narrows that same session", () => {
    const dir = demoRepo();
    const { id } = start(dir, "claude-six");
    const w = cli(dir, { CAPSULES_SESSION: id! }, "work", "billing", "--agent", "billing-agent");
    expect(w.status).toBe(0);
    expect(w.stdout).toContain(`Started session ${id}.`);
    const saved = JSON.parse(
      readFileSync(join(dir, ".capsules", "_cache", "sessions", `${id}.json`), "utf8"),
    ) as { agent: string; capsules: string[] };
    expect(saved).toMatchObject({ agent: "billing-agent", capsules: ["billing"] });
    // The narrowed scope is enforced in that window.
    const r = edit(dir, "claude-six", "src/web/checkout.tsx");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("(E027)");
  });

  it("init installs the SessionStart hook, and remove takes it out again", () => {
    const dir = demoRepo();
    gitIn(dir, "config", "user.email", "63094286+parthjatia@users.noreply.github.com");
    expect(cli(dir, {}, "init", "--yes").status).toBe(0);
    const settings = JSON.parse(
      readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"),
    ) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    expect(settings.hooks.SessionStart?.[0]?.hooks[0]?.command).toMatch(/hook session-start$/);
    expect(cli(dir, {}, "remove", "--yes").status).toBe(0);
    expect(existsSync(join(dir, ".claude", "settings.local.json"))).toBe(false);
  });
});

describe("when blocked, keep going (C18.7)", () => {
  it("every block message ends with how to carry on", () => {
    const dir = demoRepo();
    start(dir, "claude-seven");
    edit(dir, "claude-seven", "src/billing/invoices/create.js");
    const r = edit(dir, "claude-seven", "tests/invoices/duplicates.test.js");
    expect(r.status).toBe(2);
    const last = r.stderr.trimEnd().split("\n").at(-1)!;
    expect(last).toMatch(/^ {2}next: {4}don't try another way around this block\. Carry on/);
    expect(last).toContain('capsules propose <address or test file> --why "<reason>"');
    expect(r.stderr).not.toContain("say so and stop");
  });
});

const agentTrailers = (agent = "default", role = "builder") => [
  "Capsule-Session: s1",
  `Capsule-Agent: ${agent}`,
  `Capsule-Role: ${role}`,
  "Capsule-Scope: **",
];
const proposalsDir = (dir: string) => join(dir, ".capsules", "_proposals");
const rmProposal = (dir: string) =>
  gitIn(dir, "rm", "-q", ".capsules/_proposals/billing.invoices--C1--1.md");

describe("capsules propose (C18.3)", () => {
  it("leaves a note about a test file, and changes nothing else", () => {
    const dir = demoHistory();
    const r = cli(
      dir,
      {},
      "propose",
      "tests/invoices/refunds.test.js",
      "--why",
      "It expects the old limit.",
    );
    expect(r.status).toBe(0);
    const id = "billing.invoices--tests-invoices-refunds.test.js--1";
    expect(r.stdout).toContain(
      `Wrote .capsules/_proposals/${id}.md (a note for tests/invoices/refunds.test.js)`,
    );
    expect(r.stdout).toContain("carry on with the rest of the task");
    const text = readFileSync(join(proposalsDir(dir), `${id}.md`), "utf8");
    expect(text).toContain('target: "tests/invoices/refunds.test.js"\nkind: note\n');
    expect(text).toContain("## why\n\nIt expects the old limit.\n");
    expect(text).not.toMatch(/20\d\d-\d\d-\d\d/); // no timestamps (F2)
    expect(gitIn(dir, "status", "--porcelain")).toBe("?? .capsules/_proposals/\n");
  });

  it("proposes a change to a rule, or a new one with its text; numbers repeat proposals", () => {
    const dir = demoHistory();
    expect(
      cli(dir, {}, "propose", "billing.invoices#C1", "--why", "a", "--text", "New text.").status,
    ).toBe(0);
    expect(cli(dir, {}, "propose", "billing.invoices#C1", "--why", "b").status).toBe(0);
    const n = cli(
      dir,
      {},
      "propose",
      "billing.invoices#C9",
      "--why",
      "c",
      "--text",
      "Partial refunds.",
    );
    expect(n.stdout).toContain("a proposed new item for billing.invoices#C9");
    const one = readFileSync(join(proposalsDir(dir), "billing.invoices--C1--1.md"), "utf8");
    expect(one).toContain("kind: change");
    expect(one).toContain("## suggested text\n\nNew text.\n");
    expect(readFileSync(join(proposalsDir(dir), "billing.invoices--C1--2.md"), "utf8")).toContain(
      "kind: note",
    );
  });

  it("refuses without a reason, a new item without text, an unknown capsule, or a read-only judge", () => {
    const dir = demoHistory();
    expect(cli(dir, {}, "propose", "billing.invoices#C1").status).toBe(64);
    expect(cli(dir, {}, "propose", "billing.invoices#C9", "--why", "x").stderr).toContain(
      "needs the text",
    );
    expect(cli(dir, {}, "propose", "nope#C1", "--why", "x").stderr).toContain(
      'There is no capsule "nope"',
    );
    expect(cli(dir, {}, "propose", "nope:billing#C1", "--why", "x").status).toBe(64);
    const { id } = start(dir, "judge-window", { agent_type: "capsules-judge" });
    const j = cli(dir, { CAPSULES_SESSION: id! }, "propose", "billing.invoices#C1", "--why", "x");
    expect(j.status).toBe(64);
    expect(j.stderr).toContain("read-only");
  });

  it("check and status report open proposals (W112), and the capsules still read cleanly", () => {
    const dir = demoHistory();
    cli(dir, {}, "propose", "billing.invoices#C1", "--why", "a");
    const c = cli(dir, {}, "check", "--no-run", "--base", "main");
    expect(c.stdout).toContain("warning W112  A note about billing.invoices#C1");
    expect(c.stdout).toContain("capsules check: 0 errors");
    expect(cli(dir, {}, "status").stdout).toContain(
      "billing.invoices--C1--1: note for billing.invoices#C1",
    );
  });

  it("an unreadable proposal is E034", () => {
    const dir = demoHistory();
    cli(dir, {}, "propose", "billing.invoices#C1", "--why", "a");
    writeFileSync(join(proposalsDir(dir), "billing.invoices--C1--1.md"), "no front matter\n");
    const c = cli(dir, {}, "check", "--no-run", "--base", "main");
    expect(c.status).toBe(1);
    expect(c.stdout).toContain("error E034");
  });

  it("hooks: an agent may add a proposal, but not change or remove an existing one", () => {
    const dir = demoHistory();
    cli(dir, {}, "propose", "billing.invoices#C1", "--why", "a");
    const write = (file: string) =>
      hook(dir, "pre-edit", {
        hook_event_name: "PreToolUse",
        session_id: "w",
        tool_name: "Write",
        tool_input: { file_path: join(proposalsDir(dir), file), content: "x" },
      });
    expect(write("billing.invoices--C1--9.md").status).toBe(0);
    const r = write("billing.invoices--C1--1.md");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("(E027)");
    expect(r.stderr).toContain("edit-proposals");
  });

  it("CI: an agent's commit may add a proposal; removing one needs an owner", () => {
    const dir = demoHistory();
    cli(dir, {}, "propose", "billing.invoices#C1", "--why", "a");
    commit(dir, "propose", agentTrailers());
    expect(cli(dir, {}, "check", "--no-run", "--base", "main").stdout).not.toContain("E027");
    gitIn(dir, "checkout", "-q", "main");
    gitIn(dir, "merge", "-q", "work");
    gitIn(dir, "checkout", "-q", "-b", "more");
    rmProposal(dir);
    commit(dir, "agent removes it", agentTrailers());
    const agent = cli(dir, {}, "check", "--no-run", "--base", "main");
    expect(agent.status).toBe(1);
    expect(agent.stdout).toMatch(/E027[\s\S]*edit-proposals/);
    gitIn(dir, "reset", "-q", "--hard", "main");
    rmProposal(dir);
    commit(dir, "owner removes it"); // no trailers: Parth, who owns everything
    expect(cli(dir, {}, "check", "--no-run", "--base", "main").stdout).not.toContain("E027");
  });
});

const INVOICES = ".capsules/billing/invoices.md";
const C1_OLD = "Never create two invoices for the same customer and period.";
const C1_NEW = "Never create two invoices for the same customer, period and plan.";
const editFile = (dir: string, file: string, from: string, to: string) => {
  const p = join(dir, ...file.split("/"));
  const s = readFileSync(p, "utf8");
  expect(s).toContain(from);
  writeFileSync(p, s.replace(from, to));
};
/** Change rule C1 and weaken the refund test, as one agent commit. */
function riskyChange(dir: string) {
  editFile(dir, INVOICES, C1_OLD, C1_NEW);
  editFile(
    dir,
    "tests/invoices/refunds.test.js",
    "  assert.throws(() => refund(invoice, 901), /exceeds/);\n",
    "",
  );
  expect(cli(dir, {}, "lock").status).toBe(0);
  commit(dir, "rule and test", agentTrailers("test-maintainer", "maintainer"));
}
const review = (dir: string, ...args: string[]) =>
  cli(dir, {}, "review", "--base", "main", ...args);

describe("capsules review (C18.4)", () => {
  it("lists risky items first and in full, routine items one line each", () => {
    const dir = demoHistory();
    riskyChange(dir);
    cli(dir, {}, "propose", "billing.invoices#C1", "--why", "plans matter", "--text", "Per plan.");
    const out = review(dir).stdout;
    const r1 = out.indexOf("r1  Changed contract billing.invoices#C1");
    const r2 = out.indexOf("r2  Changed existing test tests/invoices/refunds.test.js");
    const prop = out.indexOf("--  Proposal from a human (no session) about billing.invoices#C1");
    const routine = out.indexOf("Routine (one line each):");
    expect([r1, r2, prop, routine].every((i) => i > 0)).toBe(true);
    expect(r1 < r2 && r2 < prop && prop < routine).toBe(true);
    expect(out).toContain(`before: ${C1_OLD}`);
    expect(out).toContain(`after:  ${C1_NEW}`);
    expect(out).toContain("-  assert.throws(() => refund(invoice, 901), /exceeds/);");
    expect(out).toContain("Per plan.");
    expect(out.slice(routine)).toMatch(
      /r\d+ +Stale link: billing\.invoices#D7 \(serves billing\.invoices#C1\)/,
    );
  });

  it("approving is refused in an agent's shell", () => {
    const dir = demoHistory();
    riskyChange(dir);
    review(dir);
    for (const env of [{ CLAUDECODE: "1" }, { CAPSULES_SESSION: "cc-1" }]) {
      const r = cli(dir, env, "review", "approve", "r1", "--base", "main");
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("is for humans");
    }
    expect(existsSync(join(dir, ".capsules", "approvals.lock"))).toBe(false);
    const done = cli(dir, { CLAUDECODE: "1" }, "review", "done", "x");
    expect(done.stderr).toContain("is for humans");
  });

  it("an approval pins exactly what was shown: approved items leave the list and lose W108", () => {
    const dir = demoHistory();
    riskyChange(dir);
    expect(cli(dir, {}, "check", "--no-run", "--base", "main").stdout).toContain("W108");
    review(dir);
    const a = cli(dir, {}, "review", "approve", "r1", "r2", "--base", "main");
    expect(a.status).toBe(0);
    expect(a.stdout).toContain("r1  Changed contract billing.invoices#C1");
    const lock = readFileSync(join(dir, ".capsules", "approvals.lock"), "utf8");
    expect(lock).toMatch(/^# approvals\.lock v1\./);
    expect(lock).toMatch(/\nnode billing\.invoices#C1 [0-9a-f]{12}\n/);
    expect(lock).toMatch(
      /\nfile billing\.invoices tests\/invoices\/refunds\.test\.js [0-9a-f]{40}\n$/,
    );
    const after = review(dir).stdout;
    expect(after).not.toContain("Changed contract billing.invoices#C1");
    expect(after).not.toContain("Changed existing test");
    commit(dir, "approve"); // Parth, an owner
    expect(cli(dir, {}, "check", "--no-run", "--base", "main").stdout).not.toContain("W108");
  });

  it("refuses an item that changed after it was shown, and --routine never approves a rule", () => {
    const dir = demoHistory();
    riskyChange(dir);
    review(dir);
    editFile(dir, INVOICES, C1_NEW, "Never create invoices.");
    cli(dir, {}, "lock");
    const r = cli(dir, {}, "review", "approve", "r1", "--base", "main");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("changed after you reviewed it, so it was not approved");
    review(dir);
    const routine = cli(dir, {}, "review", "approve", "--routine", "--base", "main");
    expect(routine.status).toBe(0);
    expect(routine.stdout).toContain("Stale link");
    expect(routine.stdout).not.toContain("contract");
    expect(existsSync(join(dir, ".capsules", "approvals.lock"))).toBe(false);
    // The stale links were re-pinned in capsules.lock.
    expect(cli(dir, {}, "status").stdout).not.toContain("billing.invoices#D7 (serves");
  });

  it("an approved new check is no longer unreviewed; a starter check from the drafter is (C18.6)", () => {
    const dir = demoHistory();
    writeFileSync(join(dir, "tests", "invoices", "starter.test.js"), "// a starter check\n");
    commit(dir, "starter", agentTrailers("capsules-drafter", "drafter"));
    expect(cli(dir, {}, "check", "--no-run", "--base", "main").stdout).toMatch(
      /unreviewed new checks[\s\S]*tests\/invoices\/starter\.test\.js/,
    );
    review(dir);
    expect(review(dir).stdout).toContain("New test tests/invoices/starter.test.js (unreviewed");
    expect(cli(dir, {}, "review", "approve", "r1", "--base", "main").status).toBe(0);
    expect(cli(dir, {}, "check", "--no-run", "--base", "main").stdout).not.toContain(
      "unreviewed new checks",
    );
  });

  it("CI: approvals.lock changed by an agent, or by someone who owns nothing, is E033", () => {
    const dir = demoHistory();
    riskyChange(dir);
    review(dir);
    cli(dir, {}, "review", "approve", "r1", "--base", "main");
    commit(dir, "agent approves", agentTrailers());
    const agent = cli(dir, {}, "check", "--no-run", "--base", "main");
    expect(agent.status).toBe(1);
    expect(agent.stdout).toContain("error E033");
    expect(agent.stdout).toContain("the agent default doesn't own billing.invoices");
    gitIn(dir, "reset", "-q", "HEAD~1");
    commit(dir, "stranger approves", [], "stranger@example.com");
    expect(cli(dir, {}, "check", "--no-run", "--base", "main").stdout).toContain("error E033");
    gitIn(dir, "reset", "-q", "HEAD~1");
    commit(dir, "owner approves");
    expect(cli(dir, {}, "check", "--no-run", "--base", "main").stdout).not.toContain("E033");
  });

  it("hooks block direct edits to approvals.lock; review done removes a proposal", () => {
    const dir = demoHistory();
    const r = hook(dir, "pre-edit", {
      hook_event_name: "PreToolUse",
      session_id: "w",
      tool_name: "Write",
      tool_input: { file_path: join(dir, ".capsules", "approvals.lock"), content: "x" },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("written only by capsules' own commands");
    cli(dir, {}, "propose", "billing.invoices#C1", "--why", "a");
    const d = cli(dir, {}, "review", "done", "billing.invoices--C1--1");
    expect(d.status).toBe(0);
    expect(existsSync(join(proposalsDir(dir), "billing.invoices--C1--1.md"))).toBe(false);
  });
});
