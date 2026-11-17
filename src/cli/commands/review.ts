// `capsules review` · `review approve <id…>` · `review approve --routine` · `review done <proposal>`
// (C18.4, D-033). Listing is for anyone; approving and removing proposals is humans only.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { APPROVALS_FILE, serialiseApprovals } from "../../core/approvals.js";
import { resolveBase } from "../../core/base.js";
import { changeUnits } from "../../core/changes.js";
import { humanFromEmail, isOwner } from "../../core/identity.js";
import { LOCK_FILE, serializeLock } from "../../core/lock.js";
import { findProjectRoot, loadProject, type Project } from "../../core/project.js";
import { PROPOSALS_DIR } from "../../core/proposals.js";
import { buildReview, type Approval, type ReviewItem } from "../../core/review.js";
import { configuredEmail } from "../../git/history.js";
import { toJson } from "../../report/json.js";
import { reviewMsg } from "../../report/messages.js";
import { renderReview } from "../../report/review.js";
import { EXIT } from "../exit-codes.js";
import type { Io } from "../io.js";

const SHOWN = ".capsules/_cache/review.json";

export interface ReviewOptions {
  base?: string;
  routine?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

/** Inside an agent's shell (C18.4): approving is for humans. */
export function inAgentShell(env: NodeJS.ProcessEnv): boolean {
  return !!(env.CAPSULES_SESSION?.trim() || env.CLAUDECODE?.trim());
}

function items(project: Project, base?: string): ReviewItem[] {
  const b = resolveBase(project.root, base);
  return buildReview(project, b, changeUnits(project, b));
}

const same = (a: Approval | null, b: Approval | null) => JSON.stringify(a) === JSON.stringify(b);

export function review(io: Io, opts: ReviewOptions): number {
  const project = loadProject(findProjectRoot(io.cwd));
  const list = items(project, opts.base);
  // Remember exactly what was shown, so an approval is for that version (C18.4).
  const shown = list.filter((i) => i.id).map((i) => ({ id: i.id, key: i.key, approve: i.approve }));
  const path = join(project.root, ...SHOWN.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ format: "0.1", shown }, null, 2) + "\n");
  if (opts.json) io.out(toJson("review", { items: list }));
  else io.out(renderReview(list));
  return EXIT.ok;
}

export function reviewApprove(
  io: Io,
  ids: string[],
  opts: ReviewOptions,
  env = process.env,
): number {
  if (inAgentShell(env)) {
    io.err(reviewMsg.humansOnly("capsules review approve"));
    return EXIT.problems;
  }
  if (!ids.length && !opts.routine) {
    io.err(reviewMsg.approveWhat());
    return EXIT.usage;
  }
  const project = loadProject(findProjectRoot(io.cwd));
  const path = join(project.root, ...SHOWN.split("/"));
  if (!existsSync(path)) {
    io.err(reviewMsg.reviewFirst());
    return EXIT.problems;
  }
  const shown = (
    JSON.parse(readFileSync(path, "utf8")) as {
      shown: { id: string; key: string; approve: Approval }[];
    }
  ).shown;
  const now = new Map(items(project, opts.base).map((i) => [i.key, i]));
  const wanted = opts.routine
    ? shown.filter((s) => now.get(s.key)?.group === "routine")
    : ids.map((id) => shown.find((s) => s.id === id) ?? { id, key: "", approve: null });

  const done: string[] = [];
  const problems: string[] = [];
  const approvals = project.approvals;
  const lock = project.lockOnDisk;
  let approvalsChanged = false;
  let lockChanged = false;
  for (const w of wanted) {
    if (!w.key) {
      problems.push(reviewMsg.unknownId(w.id));
      continue;
    }
    const item = now.get(w.key);
    if (!item) {
      problems.push(reviewMsg.gone(w.id, w.key));
      continue;
    }
    if (!same(item.approve, w.approve)) {
      problems.push(reviewMsg.changedSince(w.id, item.title));
      continue;
    }
    const a: Approval | null = w.approve;
    if (!a) continue;
    if (a.type === "node") approvals.nodes.set(a.addr, a.hash ?? "deleted");
    else if (a.type === "file")
      approvals.files.set(a.path, { capsule: a.capsule, blob: a.blob ?? "deleted" });
    else if (lock?.links.has(a.key))
      lock.links.set(a.key, { ...lock.links.get(a.key)!, hash: a.hash });
    if (a.type === "link") lockChanged = true;
    else approvalsChanged = true;
    done.push(`${w.id}  ${item.title}`);
  }
  if (!opts.dryRun) {
    if (approvalsChanged)
      writeFileSync(
        join(project.root, ...APPROVALS_FILE.split("/")),
        serialiseApprovals(approvals),
      );
    if (lockChanged && lock)
      writeFileSync(join(project.root, ...LOCK_FILE.split("/")), serializeLock(lock));
  }

  // A friendly early warning: CI checks the commit's author owns these capsules (E033).
  const me = humanFromEmail(configuredEmail(project.root), project.permissions);
  const capsules = [
    ...new Set(
      wanted
        .map((w) => w.approve)
        .filter((a): a is Exclude<Approval, { type: "link" }> => !!a && a.type !== "link")
        .map((a) => (a.type === "node" ? a.addr.split("#")[0]! : a.capsule)),
    ),
  ];
  const notMine = capsules.filter(
    (c) => !(me.kind === "human" && isOwner(me.name, c, project.capsules, project.permissions)),
  );

  if (opts.json)
    io.out(toJson("review-approve", { approved: done, problems, dryRun: !!opts.dryRun }));
  else
    io.out(
      reviewMsg.approved(done, problems, approvalsChanged, lockChanged, notMine, !!opts.dryRun),
    );
  return problems.length ? EXIT.problems : EXIT.ok;
}

export function reviewDone(io: Io, id: string, opts: ReviewOptions, env = process.env): number {
  if (inAgentShell(env)) {
    io.err(reviewMsg.humansOnly("capsules review done"));
    return EXIT.problems;
  }
  const project = loadProject(findProjectRoot(io.cwd));
  const name = id.replace(/\.md$/, "").replace(/^.*[\\/]/, "");
  const file = join(project.root, ...PROPOSALS_DIR.split("/"), `${name}.md`);
  if (!existsSync(file)) {
    io.err(reviewMsg.noProposal(name));
    return EXIT.usage;
  }
  if (!opts.dryRun) rmSync(file);
  io.out(reviewMsg.removed(`${PROPOSALS_DIR}/${name}.md`, !!opts.dryRun));
  return EXIT.ok;
}
