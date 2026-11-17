// `capsules propose <address|check-file> --why <reason> [--text <new text>]` (C18.3, D-032):
// leave a proposal or a note for an owner, instead of changing a rule or a test, or stopping.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseAddress } from "../../core/address.js";
import { membershipOf } from "../../core/membership.js";
import { address } from "../../core/model.js";
import { findProjectRoot, loadProject, projectPath, UsageError } from "../../core/project.js";
import { PROPOSALS_DIR, renderProposal, slug, type ProposalKind } from "../../core/proposals.js";
import { activeWorkSession } from "../../hooks/session.js";
import { toJson } from "../../report/json.js";
import { errors, proposalMsg } from "../../report/messages.js";
import { EXIT } from "../exit-codes.js";
import type { Io } from "../io.js";

export interface ProposeOptions {
  why?: string;
  text?: string;
  dryRun?: boolean;
  json?: boolean;
}

export function propose(io: Io, target: string, opts: ProposeOptions, env = process.env): number {
  const project = loadProject(findProjectRoot(io.cwd));
  if (!opts.why?.trim()) throw new UsageError(proposalMsg.needsWhy());
  const session = activeWorkSession(project.root, env);
  const role = session?.role ?? null;
  if (role && (project.permissions.roles[role]?.may ?? []).every((a) => a === "read"))
    throw new UsageError(proposalMsg.readOnlyRole(session!.agent, role));
  const text = opts.text !== undefined ? opts.text : null;

  let capsule: string;
  let canonical: string;
  let kind: ProposalKind;
  let nodeSlug: string;
  if (target.includes("#") || target.includes(":")) {
    const p = parseAddress(target, { ref: false });
    if (!p.ok && p.reason === "cross-repo")
      throw new UsageError(errors.crossRepoArg(target, p.repo));
    if (!p.ok) throw new UsageError(errors.badAddressArg(target));
    capsule = p.capsule!;
    if (!project.capsules.some((c) => c.id === capsule))
      throw new UsageError(proposalMsg.unknownCapsule(capsule));
    canonical = address(capsule, p.node);
    const exists = project.current.nodes.has(canonical);
    if (!exists && text === null) throw new UsageError(proposalMsg.newNeedsText(canonical));
    kind = !exists ? "new" : text === null ? "note" : "change";
    nodeSlug = p.node;
  } else {
    // projectPath resolves short Windows names (RUNNER~1) and symlinks, as `explain` does.
    let rel: string;
    try {
      rel = projectPath(project.root, io.cwd, target);
    } catch {
      throw new UsageError(proposalMsg.unknownTarget(target));
    }
    if (!existsSync(join(project.root, rel)))
      throw new UsageError(proposalMsg.unknownTarget(target));
    canonical = rel;
    capsule = membershipOf(rel, project.capsules).home ?? "root";
    kind = text === null ? "note" : "change";
    nodeSlug = slug(rel);
  }

  const dir = join(project.root, ...PROPOSALS_DIR.split("/"));
  let n = 1;
  while (existsSync(join(dir, `${capsule}--${nodeSlug}--${n}.md`))) n++;
  const name = `${capsule}--${nodeSlug}--${n}`;
  const file = `${PROPOSALS_DIR}/${name}.md`;
  const body = renderProposal({
    target: canonical,
    capsule,
    kind,
    by: session?.agent ?? (env.CLAUDECODE ? "default" : "a human (no session)"),
    session: session?.id ?? null,
    why: opts.why,
    text,
  });
  if (!opts.dryRun) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.md`), body);
  }
  if (opts.json)
    io.out(toJson("propose", { id: name, file, target: canonical, kind, dryRun: !!opts.dryRun }));
  else io.out(proposalMsg.wrote(file, canonical, kind, !!opts.dryRun));
  return EXIT.ok;
}
