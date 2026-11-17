// `capsules hook pre-edit` (C11): simulate an Edit/Write/MultiEdit/NotebookEdit, classify it
// (C5.2), check permissions, and apply the one rule within the session (C6.2, D-024).
import { isProposalPath, proposalCapsule } from "../core/proposal-path.js";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import picomatch from "picomatch";
import { agentMay, settingsAction, type Action } from "../core/access.js";
import {
  capsuleFromPath,
  capsulesJudgedByFile,
  checkFileMatcher,
  checkJudges,
  intentsServed,
} from "../core/judges.js";
import { membershipOf } from "../core/membership.js";
import { address, type Capsule, type CapsuleNode } from "../core/model.js";
import { agentsBlock, isGeneratedPath } from "../compile/paths.js";
import { hookMsg } from "../report/messages.js";
import type { HookIndex } from "./index-cache.js";
import {
  readTracking,
  resolveActor,
  writeTracking,
  type HookActor,
  type Tracking,
} from "./session.js";

export interface HookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  agent_type?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export type HookResult = { kind: "allow"; notice?: string } | { kind: "block"; reason: string };

const allow = (notice?: string): HookResult =>
  notice ? { kind: "allow", notice } : { kind: "allow" };
const block = (reason: string): HookResult => ({ kind: "block", reason });

/** The file's text after the tool runs, or undefined when it can't be worked out. */
export function simulate(
  tool: string,
  input: Record<string, unknown>,
  before: string | null,
): string | null | undefined {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const apply = (text: string, oldS: string, newS: string, all: boolean): string | undefined => {
    if (oldS === "") return before === null ? newS : undefined;
    if (!text.includes(oldS)) return undefined;
    return all ? text.split(oldS).join(newS) : text.replace(oldS, () => newS);
  };
  if (tool === "Write") return str(input.content);
  if (tool === "Edit")
    return apply(
      before ?? "",
      str(input.old_string),
      str(input.new_string),
      input.replace_all === true,
    );
  if (tool === "MultiEdit") {
    let text: string | undefined = before ?? "";
    for (const e of Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : []) {
      text =
        text === undefined
          ? undefined
          : apply(text, str(e.old_string), str(e.new_string), e.replace_all === true);
    }
    return text;
  }
  return undefined; // NotebookEdit and anything else: the result isn't simulated
}

function toProjectPath(root: string, cwd: string, file: string): string | null {
  const abs = isAbsolute(file) ? file : resolve(cwd, file);
  const rel = relative(root, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

function isAdditive(before: string, after: string): boolean {
  const b = before.replace(/\r\n?/g, "\n").split("\n");
  const a = after.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  for (const line of a) if (i < b.length && line === b[i]) i++;
  return i === b.length;
}

const TOOL_FILES = new Set([
  ".capsules/capsules.lock",
  ".capsules/approvals.lock",
  ".capsules/installed.json",
  ".capsules/.gitignore",
]);

const NODE_ACTION: Record<string, { added: Action | null; other: Action | null }> = {
  intent: { added: "propose-intent", other: "propose-intent" },
  contract: { added: "propose-contracts", other: "propose-contracts" },
  example: { added: "propose-examples", other: "propose-examples" },
  check: { added: "add-checks", other: "change-checks" },
  decision: { added: "add-decisions", other: null },
  assumption: { added: "add-decisions", other: "propose-contracts" },
  context: { added: "edit-context", other: "edit-context" },
  prompt: { added: "edit-context", other: "edit-context" },
  code: { added: "edit-code", other: "edit-code" },
};

/** What one edit does, in the terms the permissions and the one rule need. */
interface EditFacts {
  capsule: string;
  concerns: string[];
  actions: { action: Action; detail: string }[];
  /** Code changed in these capsules (home and concerns). */
  code?: string[];
  /** Existing checks changed, with the capsules each judges. */
  checks: { what: string; judges: string[] }[];
  createdCheck?: boolean;
  intents: string[];
  rules: { addr: string; serves: string[] }[];
  /** A decision node was changed or removed (E009). */
  decision?: string;
}

const intersects = (a: string[], b: string[]) => a.some((x) => b.includes(x));

async function capsuleFacts(
  path: string,
  cap: { id: string; kind: Capsule["kind"] },
  before: string | null,
  after: string,
  index: HookIndex,
): Promise<EditFacts> {
  const { parseCapsuleFile } = await import("../core/parse.js");
  const { diffCapsule } = await import("../core/changes.js");
  const parse = (t: string | null) =>
    t === null ? null : parseCapsuleFile(t, path, cap.id, cap.kind).capsule;
  const b = parse(before);
  const a = parse(after)!;
  const { nodes, frontChanged } = diffCapsule(b, a);
  const facts: EditFacts = {
    capsule: cap.id,
    concerns: [],
    actions: [],
    checks: [],
    intents: [],
    rules: [],
  };
  if (frontChanged)
    facts.actions.push({ action: "propose-contracts", detail: `front matter of ${cap.id}` });
  // Rules are judged against the capsules as they will be after this edit.
  const capsules = [...index.capsules.filter((c) => c.id !== cap.id), a];
  const judges = checkJudges(capsules);
  for (const nc of nodes) {
    const addr = address(cap.id, nc.node.id);
    const rule = NODE_ACTION[nc.node.type]!;
    const action = nc.change === "added" ? rule.added : rule.other;
    if (nc.node.type === "decision" && nc.change !== "added") facts.decision ??= addr;
    if (action) facts.actions.push({ action, detail: `${nc.change} ${nc.node.type} ${addr}` });
    if (nc.change === "added") continue;
    if (nc.node.type === "check")
      facts.checks.push({ what: `check ${addr}`, judges: [...(judges.get(addr) ?? [cap.id])] });
    if (nc.node.type === "code") (facts.code ??= []).push(cap.id);
    if (nc.node.type === "intent") facts.intents.push(addr);
  }
  for (const nc of nodes)
    if (nc.node.type === "contract" || nc.node.type === "example") {
      const node: CapsuleNode =
        nc.change === "removed" ? nc.node : (a.nodes.find((n) => n.id === nc.node.id) ?? nc.node);
      facts.rules.push({
        addr: address(cap.id, nc.node.id),
        serves: intentsServed(node, capsules),
      });
    }
  return facts;
}

function fileFacts(
  path: string,
  before: string | null,
  after: string | null | undefined,
  index: HookIndex,
  t: Tracking,
): EditFacts | null {
  const m = membershipOf(path, index.capsules);
  const home = m.home ?? "root";
  if (index.config.ignore.some((g) => picomatch.isMatch(path, g, { dot: true }))) return null;
  const facts: EditFacts = {
    capsule: home,
    concerns: m.concerns,
    actions: [],
    checks: [],
    intents: [],
    rules: [],
  };
  const isCheck = checkFileMatcher(index.config.checkFiles, index.capsules);
  if (isCheck(path)) {
    if (before === null || t.created.includes(path)) {
      facts.actions.push({ action: "add-checks", detail: `new check file ${path}` });
      facts.createdCheck = before === null;
      return facts;
    }
    if (after !== undefined && after !== null && isAdditive(before, after)) {
      facts.actions.push({ action: "add-checks", detail: `lines added to existing check ${path}` });
      return facts;
    }
    facts.actions.push({ action: "change-checks", detail: `changed existing check ${path}` });
    facts.checks.push({
      what: path,
      judges: capsulesJudgedByFile(path, [home, ...m.concerns], index.capsules),
    });
    return facts;
  }
  facts.actions.push({ action: "edit-code", detail: path });
  facts.code = [home, ...m.concerns];
  return facts;
}

export async function preEdit(
  input: HookInput,
  root: string,
  index: HookIndex,
  env = process.env,
): Promise<HookResult> {
  const tool = input.tool_name ?? "";
  const ti = input.tool_input ?? {};
  const file =
    typeof ti.file_path === "string"
      ? ti.file_path
      : typeof ti.notebook_path === "string"
        ? ti.notebook_path
        : null;
  if (!file) return allow();
  const path = toProjectPath(root, input.cwd ?? root, file);
  if (!path) return allow(); // outside this project
  const abs = resolve(root, path);
  const before = existsSync(abs) ? readFileSync(abs, "utf8") : null;
  const after = simulate(tool, ti, before);

  if (TOOL_FILES.has(path) || path.startsWith(".capsules/_cache/"))
    return path.startsWith(".capsules/_cache/")
      ? allow()
      : block(
          hookMsg.blocked(
            "E027",
            `${path} is written only by capsules' own commands.`,
            [["file", path]],
            hookMsg.toolFileWhy,
            hookMsg.toolFileFix,
          ),
        );
  if (
    isGeneratedPath(path) ||
    (path === "AGENTS.md" &&
      (after === undefined || agentsBlock(before ?? "") !== agentsBlock(after ?? "")))
  )
    return block(
      hookMsg.blocked(
        "E011",
        `${path} is generated by \`capsules compile\`.`,
        [["file", path]],
        hookMsg.generatedWhy,
        hookMsg.generatedFix,
      ),
    );

  const actor: HookActor = resolveActor(input, root, index.permissions, env);
  const t = readTracking(root, actor.trackKey);

  let facts: EditFacts | null;
  const settings = settingsAction(path);
  if (settings) {
    const action: Action = settings;
    facts = {
      capsule: "root",
      concerns: [],
      actions: [{ action, detail: path }],
      checks: [],
      intents: [],
      rules: [],
    };
  } else if (isProposalPath(path)) {
    // C18.3: anyone (but a read-only role) may leave a new proposal; changing or removing an
    // existing one is for owners.
    facts = {
      capsule: proposalCapsule(path),
      concerns: [],
      actions: [{ action: before === null ? "add-proposals" : "edit-proposals", detail: path }],
      checks: [],
      intents: [],
      rules: [],
    };
  } else {
    const cap = capsuleFromPath(path);
    if (cap) {
      if (after === undefined || after === null) return allow(); // can't simulate: CI judges it
      facts = await capsuleFacts(path, cap, before, after, index);
    } else if (path.startsWith(".capsules/")) {
      return allow();
    } else {
      facts = fileFacts(path, before, after, index, t);
    }
  }
  if (!facts) return allow();

  if (facts.decision)
    return block(
      hookMsg.blocked(
        "E009",
        `decision ${facts.decision} would be changed or deleted.`,
        [
          ["file", path],
          ["node", facts.decision],
        ],
        hookMsg.decisionWhy,
        hookMsg.decisionFix(facts.decision),
      ),
    );

  // The one rule within this session (C6.2, D-024).
  if (facts.code) {
    const hit = t.checks.find((c) => intersects(c.judges, facts!.code!));
    if (hit)
      return block(
        hookMsg.blocked(
          "E028",
          "this session already changed an existing check that judges this code.",
          [
            ["capsule", facts.code.filter((x) => hit.judges.includes(x)).join(", ")],
            ["code", path],
            ["check", hit.what],
          ],
          hookMsg.v1Why,
          hookMsg.v1Fix,
        ),
      );
    if (index.config.newChecksWithCode === "block") {
      const created = t.created.find((p) =>
        intersects(
          capsulesJudgedByFile(
            p,
            [
              membershipOf(p, index.capsules).home ?? "root",
              ...membershipOf(p, index.capsules).concerns,
            ],
            index.capsules,
          ),
          facts!.code!,
        ),
      );
      if (created)
        return block(
          hookMsg.blocked(
            "E028",
            "this session already added a check for this code, and one-rule.new-checks-with-code is block.",
            [
              ["capsule", facts.capsule],
              ["code", path],
              ["check", created],
            ],
            hookMsg.v1Why,
            hookMsg.v1Fix,
          ),
        );
    }
  }
  for (const c of facts.checks) {
    const hit = t.code.find((x) => intersects(x.capsules, c.judges));
    if (hit)
      return block(
        hookMsg.blocked(
          "E028",
          "this session already changed code that this existing check judges.",
          [
            ["capsule", hit.capsules.filter((x) => c.judges.includes(x)).join(", ")],
            ["code", hit.path],
            ["check", c.what],
          ],
          hookMsg.v1Why,
          hookMsg.v1Fix,
        ),
      );
    if (facts.code && intersects(facts.code, c.judges))
      return block(
        hookMsg.blocked(
          "E028",
          "this edit changes code and an existing check that judges it.",
          [
            ["capsule", facts.code.filter((x) => c.judges.includes(x)).join(", ")],
            ["check", c.what],
          ],
          hookMsg.v1Why,
          hookMsg.v1Fix,
        ),
      );
  }
  const intents = [...t.intents, ...facts.intents];
  for (const r of [...t.rules, ...facts.rules]) {
    const fresh = facts.rules.includes(r) || facts.intents.some((i) => r.serves.includes(i));
    const hit = r.serves.find((i) => intents.includes(i));
    if (fresh && hit)
      return block(
        hookMsg.blocked(
          "E029",
          "this session would change both a rule and the intent it serves.",
          [
            ["file", path],
            ["rule", r.addr],
            ["intent", hit],
          ],
          hookMsg.v2Why,
          hookMsg.v2Fix,
        ),
      );
  }

  // Permissions (C5.2 step 3). After the one rule, whose message explains more.
  const approvals: string[] = [];
  for (const { action, detail } of facts.actions) {
    const v = agentMay(
      actor.agent,
      action,
      facts.capsule,
      facts.concerns,
      index.permissions,
      actor.scope,
    );
    if (!v.allowed)
      return block(
        hookMsg.blocked(
          "E027",
          `${actor.agent} may not do this: ${v.reason}.`,
          [
            ["agent", actor.agent],
            ["capsule", facts.capsule],
            ["change", detail],
            ["needs", action],
          ],
          hookMsg.notAllowedWhy,
          hookMsg.notAllowedFix(action),
        ),
      );
    if (v.needsApproval) approvals.push(detail);
  }

  // Allowed: remember what this session changed.
  if (facts.code && !t.code.some((x) => x.path === path))
    t.code.push({ path, capsules: facts.code });
  for (const c of facts.checks) if (!t.checks.some((x) => x.what === c.what)) t.checks.push(c);
  if (facts.createdCheck && !t.created.includes(path)) t.created.push(path);
  for (const i of facts.intents) if (!t.intents.includes(i)) t.intents.push(i);
  for (const r of facts.rules) if (!t.rules.some((x) => x.addr === r.addr)) t.rules.push(r);
  writeTracking(root, actor.trackKey, t);

  return approvals.length ? allow(hookMsg.approval(approvals.join("; "))) : allow();
}
