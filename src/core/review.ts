// `capsules review` (C18.4, D-033): everything waiting for a human, worked out from the files
// and Git. Risky items (rules, intents, examples, checks, proposals) come first, in full;
// routine items one line each. Only some items can be approved here; each says what to do.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { git, hashObjects } from "../git/git.js";
import { changesSince } from "../git/history.js";
import { fileApproved, nodeApproved } from "./approvals.js";
import type { Base } from "./base.js";
import { checkFileMatcher, Contents, diffCapsule, type ChangeUnit } from "./changes.js";
import { guard, rangeBase } from "./guard.js";
import { capsuleFromPath } from "./judges.js";
import { linkKey, splitReplaced, staleLinks, stalePrompts } from "./lock.js";
import { address, type Capsule, type CapsuleNode } from "./model.js";
import { parseCapsuleFile } from "./parse.js";
import type { Project } from "./project.js";
import { loadProposals } from "./proposals.js";
import { targetOf } from "./resolve.js";

export type Approval =
  | { type: "node"; addr: string; hash: string | null }
  | { type: "file"; capsule: string; path: string; blob: string | null }
  | { type: "link"; key: string; hash: string };

export interface ReviewItem {
  /** Stable key, used to make sure an approval is for what the human saw. */
  key: string;
  group: "risky" | "routine";
  title: string;
  /** Shown in full for risky items. */
  detail: string[];
  /** What to do, in plain words. */
  hint: string;
  approve: Approval | null;
  /** `r1`, `r2`, … for items that can be approved here. */
  id?: string;
}

const MAX_LINES = 60;
const RULE_TYPES = new Set(["intent", "contract", "example", "assumption"]);
const firstLines = (text: string, max = MAX_LINES) => {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  return lines.length > max
    ? [...lines.slice(0, max), `… ${lines.length - max} more lines (open the file to read them)`]
    : lines;
};
const nodeText = (n: CapsuleNode) => n.prose.trim() || "(no text)";

/** Stale links from these node types stay routine; from any other (examples, contracts…) they are risky (D-039). */
const ROUTINE_LINK_SOURCES = new Set(["code", "context", "decision"]);

function nodeAt(project: Project, addr: string): CapsuleNode | null {
  const [cap, id] = addr.split("#");
  return project.capsules.find((c) => c.id === cap)?.nodes.find((n) => n.id === id) ?? null;
}

function staleReport(project: Project) {
  return project.lockOnDisk
    ? splitReplaced(staleLinks(project.lockOnDisk, project.current), project.capsules).report
    : [];
}

/**
 * After a rule changes: the nodes whose links to it are now stale, the ones to update first
 * (examples, contracts, intents…) and the rest (code, context, decisions), each sorted.
 */
export function staleDependents(
  project: Project,
  addr: string,
): { update: string[]; other: string[] } {
  const update: string[] = [];
  const other: string[] = [];
  for (const s of staleReport(project)) {
    if (s.to !== addr) continue;
    const t = nodeAt(project, s.from)?.type;
    (t && !ROUTINE_LINK_SOURCES.has(t) ? update : other).push(s.from);
  }
  return { update: [...new Set(update)].sort(), other: [...new Set(other)].sort() };
}

function parseAt(text: string | null, path: string): Capsule | null {
  const cap = capsuleFromPath(path);
  return cap && text !== null ? parseCapsuleFile(text, path, cap.id, cap.kind).capsule : null;
}

function ruleHint(project: Project, addr: string): string {
  const { update, other } = staleDependents(project, addr);
  if (!update.length) return "approve it if this is what you mean.";
  const more = update.length - 1 + other.length;
  return `approve it if this is what you mean, then ask the drafter to update ${update[0]}${more ? ` (and ${more} other${more === 1 ? "" : "s"})` : ""} first.`;
}

export function buildReview(project: Project, base: Base, units: ChangeUnit[]): ReviewItem[] {
  const contents = new Contents(project.root);
  const g = guard(project, base, units);
  const unreviewed = new Set(g.unreviewed);
  const from = rangeBase(project, base);
  const range = from ? changesSince(from, project.root) : [];
  const isCheckFile = checkFileMatcher(project);
  const risky: ReviewItem[] = [];
  const routine: ReviewItem[] = [];
  const nowHash = (addr: string) => project.current.nodes.get(addr)?.hash ?? null;

  // 1. Capsule files: rules, intents, examples, assumptions and checks changed since the base.
  for (const r of range) {
    const cap = capsuleFromPath(r.path);
    if (!cap) continue;
    const abs = join(project.root, ...r.path.split("/"));
    const before = parseAt(from ? contents.get(from, r.path) : null, r.path);
    const after = parseAt(existsSync(abs) ? readFileSync(abs, "utf8") : null, r.path);
    const old = new Map((before?.nodes ?? []).map((n) => [n.id, n]));
    const { nodes, frontChanged } = diffCapsule(before, after);
    if (frontChanged)
      risky.push({
        key: `front ${cap.id}`,
        group: "risky",
        title: `Changed settings of capsule ${cap.id} (its covers, owners or status)`,
        detail: [`file: ${r.path}`],
        hint: "read the change with `git diff` on that file; an owner approves it in the pull request.",
        approve: null,
      });
    for (const nc of nodes) {
      const addr = address(nc.capsule, nc.node.id);
      const t = nc.node.type;
      const verb = nc.change === "added" ? "New" : nc.change === "changed" ? "Changed" : "Removed";
      if (RULE_TYPES.has(t) || t === "check") {
        const hash = nc.change === "removed" ? null : nowHash(addr);
        if (nodeApproved(project.approvals, addr, hash)) continue;
        const prev = old.get(nc.node.id);
        const detail =
          nc.change === "changed" && prev
            ? [`before: ${nodeText(prev)}`, `after:  ${nodeText(nc.node)}`]
            : [`${nc.change === "removed" ? "was" : "text"}: ${nodeText(nc.node)}`];
        const fields = nc.node.fields.map((f) => `${f.key}: ${f.value}`);
        risky.push({
          key: `node ${addr}`,
          group: "risky",
          title: `${verb} ${t === "check" ? "check" : t} ${addr}${unreviewed.has(`check node ${addr}`) ? " (unreviewed: added with the code it judges, or by the drafter)" : ""}`,
          detail: [...detail, ...(nc.change !== "removed" ? fields : [])],
          hint: ruleHint(project, addr),
          approve: { type: "node", addr, hash },
        });
      } else if (t === "decision") {
        const sup = nc.node.links
          .filter((l) => l.type === "supersedes")
          .map((l) => targetOf(l.ref, nc.capsule).split("#")[1]);
        if (nc.change === "added")
          routine.push({
            key: `decision ${addr}`,
            group: "routine",
            title: `New decision ${addr}${sup.length ? ` (supersedes ${sup.join(", ")})` : ""}: ${nodeText(nc.node).split("\n")[0]}`,
            detail: [],
            hint: "nothing to do.",
            approve: null,
          });
        else
          risky.push({
            key: `decision ${addr}`,
            group: "risky",
            title: `${verb} decision ${addr}: decisions are append-only (E009)`,
            detail: [`text: ${nodeText(nc.node)}`],
            hint: "undo this change and add a new decision that supersedes it.",
            approve: null,
          });
      } else if (t === "context" && nc.change !== "removed") {
        routine.push({
          key: `context ${addr}`,
          group: "routine",
          title: `${verb} context ${addr}`,
          detail: [],
          hint: "nothing to do.",
          approve: null,
        });
      }
    }
  }

  // 2. Test files: new ones, and changed or deleted existing ones.
  const blobs = hashObjects(
    range.filter((r) => r.status !== "D" && isCheckFile(r.path)).map((r) => r.path),
    project.root,
  );
  for (const r of range) {
    if (r.path.startsWith(".capsules/") || !isCheckFile(r.path)) continue;
    const capsule = project.membership.files.get(r.path)?.home ?? "root";
    const blob = r.status === "D" ? null : (blobs.get(r.path) ?? null);
    if (fileApproved(project.approvals, r.path, blob)) continue;
    const approve: Approval = { type: "file", capsule, path: r.path, blob };
    if (r.status === "A") {
      const text = readFileSync(join(project.root, ...r.path.split("/")), "utf8");
      risky.push({
        key: `file ${r.path}`,
        group: "risky",
        title: `New test ${r.path}${unreviewed.has(r.path) ? " (unreviewed: added with the code it judges, or by the drafter)" : ""}`,
        detail: firstLines(text).map((l) => `| ${l}`),
        hint: "approve it if it really checks what its rule says.",
        approve,
      });
    } else {
      const diff = git(["diff", "--no-color", "-U2", from!, "--", r.path], project.root)
        .split("\n")
        .filter((l) => l && !/^(diff --git|index |--- |\+\+\+ |new file|deleted file)/.test(l));
      risky.push({
        key: `file ${r.path}`,
        group: "risky",
        title: `${r.status === "D" ? "Deleted" : "Changed"} existing test ${r.path}`,
        detail: firstLines(diff.join("\n")),
        hint: "approve it only if the test was wrong, not to make failing code pass.",
        approve,
      });
    }
  }

  // 3. Proposals: read in full; applied by a human (or the drafter), never approved here.
  for (const p of loadProposals(project.root).proposals)
    risky.push({
      key: `proposal ${p.id}`,
      group: "risky",
      title: `${p.kind === "note" ? "Note" : "Proposal"} from ${p.by} about ${p.target} (${p.id})`,
      detail: [
        `why: ${p.why}`,
        ...(p.text !== null ? ["suggested text:", ...p.text.split("\n").map((l) => `  ${l}`)] : []),
      ],
      hint: `apply it if you agree (or ask the drafter to), then run \`capsules review done ${p.id}\`.`,
      approve: null,
    });

  // 4. Routine: stale links (approving re-pins one), stale prompts, assumptions, orphans.
  // D-039: a stale link from an example, contract or intent is risky: read it in full.
  const textAtBase = (addr: string): string | null => {
    const cap = project.capsules.find((c) => c.id === addr.split("#")[0]);
    if (!cap || !from) return null;
    const n = parseAt(contents.get(from, cap.file), cap.file)?.nodes.find(
      (x) => x.id === addr.split("#")[1],
    );
    return n ? nodeText(n) : null;
  };
  if (project.lockOnDisk) {
    for (const s of staleReport(project)) {
      const key = `link ${linkKey(s.from, s.type, s.to)}`;
      const approve: Approval = {
        type: "link",
        key: linkKey(s.from, s.type, s.to),
        hash: s.current,
      };
      const src = nodeAt(project, s.from);
      if (!src || ROUTINE_LINK_SOURCES.has(src.type)) {
        routine.push({
          key,
          group: "routine",
          title: `Stale link: ${s.from} (${s.type} ${s.to}) was written before ${s.to} changed`,
          detail: [],
          hint: `check ${s.from} still holds; approving re-pins this link.`,
          approve,
        });
        continue;
      }
      const target = nodeAt(project, s.to);
      const now = target ? nodeText(target) : "(removed)";
      const before = textAtBase(s.to);
      risky.push({
        key,
        group: "risky",
        title: `Stale ${src.type} ${s.from}: it ${s.type === "serves" || s.type === "shows" ? s.type : `links (${s.type}) to`} ${s.to}, which changed`,
        detail: [
          before !== null && before !== now
            ? `${s.to} before: ${before}`
            : `${s.to} changed before this branch; its old text is in Git history.`,
          `${s.to} now:    ${now}`,
          `${s.from} says: ${nodeText(src)}`,
        ],
        hint: `check ${s.from} still matches. If not, ask the drafter to update it first (or run \`capsules propose\`); approving keeps it as it is and re-pins this link.`,
        approve,
      });
    }
    for (const s of stalePrompts(project.lockOnDisk, project.current))
      routine.push({
        key: `prompt ${s.address}`,
        group: "routine",
        title: `Stale prompt: ${s.path} changed since it was locked (${s.address})`,
        detail: [],
        hint: "re-check the rules about that prompt, then run `capsules lock`.",
        approve: null,
      });
  }
  for (const d of project.diagnostics.filter((x) => x.code === "W105"))
    routine.push({
      key: `assumption ${d.file}:${d.line}`,
      group: "routine",
      title: d.message,
      detail: [],
      hint: "check it still holds, then move its review-by date.",
      approve: null,
    });
  const orphans = [...project.membership.files.values()]
    .filter((f) => !f.home && !f.conflict.length)
    .map((f) => f.file)
    .sort();
  if (orphans.length)
    routine.push({
      key: "orphans",
      group: "routine",
      title: `${orphans.length} file${orphans.length === 1 ? "" : "s"} with no capsule: ${orphans.slice(0, 5).join(", ")}${orphans.length > 5 ? ", …" : ""}`,
      detail: [],
      hint: "add them to a capsule's covers, or to ignore in config.yaml.",
      approve: null,
    });

  const items = [...risky, ...routine];
  let n = 0;
  for (const i of items) if (i.approve) i.id = `r${++n}`;
  return items;
}
