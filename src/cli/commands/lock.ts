import { ownersOf } from "../../core/identity.js";
// `capsules lock`, `capsules refresh <address>`, `capsules relock --cosmetic <address>` (C7.3).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseAddress } from "../../core/address.js";
import {
  emptyLock,
  LOCK_FILE,
  lockChanges,
  serializeLock,
  skippedLine,
  splitReplaced,
  staleLinks,
  updateLock,
  type UpdateOptions,
} from "../../core/lock.js";
import { address } from "../../core/model.js";
import { findProjectRoot, loadProject, UsageError, type Project } from "../../core/project.js";
import { toJson } from "../../report/json.js";
import { errors } from "../../report/messages.js";
import { formatDiagnostics, plural } from "../../report/text.js";
import { EXIT } from "../exit-codes.js";
import { addPendingCosmetic } from "../../hooks/session.js";
import type { Io } from "../io.js";

interface WriteOpts {
  dryRun?: boolean;
  json?: boolean;
}

export function lock(io: Io, opts: WriteOpts): number {
  return writeLock(io, "lock", {}, opts);
}

export function refresh(io: Io, addr: string, opts: WriteOpts): number {
  return writeLock(io, "refresh", { refreshFrom: addr }, opts);
}

export function relock(io: Io, addr: string, opts: WriteOpts & { cosmetic?: boolean }): number {
  if (!opts.cosmetic) throw new UsageError(errors.relockNeedsCosmetic());
  return writeLock(io, "relock", { relockTo: addr }, opts);
}

function writeLock(
  io: Io,
  command: "lock" | "refresh" | "relock",
  update: UpdateOptions,
  opts: WriteOpts,
): number {
  const project = loadProject(findProjectRoot(io.cwd));
  const named = update.refreshFrom ?? update.relockTo;
  if (named !== undefined) checkAddress(project, named);
  const target = named !== undefined ? normalise(named) : undefined;
  const upd: UpdateOptions =
    command === "refresh"
      ? { refreshFrom: target! }
      : command === "relock"
        ? { relockTo: target! }
        : {};

  // Locking broken capsules would pin fingerprints of things that don't parse.
  const blocking = project.diagnostics.filter((d) => d.severity === "error" && d.code !== "E010");
  if (blocking.length) {
    io.err(
      `${formatDiagnostics(blocking)}\n\ncapsules ${command}: nothing written. Fix the ${plural(blocking.length, "error")} above first (see \`capsules check --no-run\`).\n`,
    );
    return EXIT.problems;
  }

  const before = project.lockOnDisk ?? emptyLock();
  const next = updateLock(project.lockOnDisk, project.current, upd);
  const changes = lockChanges(before, next).map((c) => `${c.kind} ${c.key} ${c.change}`);
  const repinned = [...next.links.values()]
    .filter((l) => {
      const old = before.links.get(`${l.from} ${l.type} ${l.to}`);
      return old !== undefined && old.hash !== l.hash;
    })
    .map((l) => `${l.from} ${l.type} ${l.to}`)
    .sort();
  const { report: stillStale, skipped } = splitReplaced(
    staleLinks(next, project.current),
    project.capsules,
  );
  const text = serializeLock(next);
  const changed = project.lockOnDisk === null || text !== serializeLock(project.lockOnDisk);
  const write = changed && !opts.dryRun;
  if (write) writeFileSync(join(project.root, ...LOCK_FILE.split("/")), text);
  // The optional commit-msg hook adds the trailer to the next commit (C7.3).
  if (command === "relock" && !opts.dryRun) addPendingCosmetic(project.root, target!);

  const trailer = command === "relock" ? `Capsule-Cosmetic: ${target}` : null;
  const owners = target ? ownersOf(project.capsules, target.split("#")[0]!) : [];

  if (opts.json) {
    io.out(
      toJson(command, {
        file: LOCK_FILE,
        dryRun: Boolean(opts.dryRun),
        written: write,
        changes,
        repinned,
        stillStale: stillStale.map((s) => `${s.from} ${s.type} ${s.to}`),
        skippedReplaced: skipped,
        ...(trailer ? { trailer, owners } : {}),
      }),
    );
    return EXIT.ok;
  }

  const verb = opts.dryRun ? "would write" : "wrote";
  const lines: string[] = [];
  if (!changed) lines.push(`${LOCK_FILE} is already up to date. Nothing written.`);
  else {
    const what = [
      changes.length ? plural(changes.length, "record change") : "",
      repinned.length ? `${plural(repinned.length, "link")} re-pinned` : "",
    ]
      .filter(Boolean)
      .join(", ");
    lines.push(`${verb} ${LOCK_FILE}${what ? `: ${what}` : ""}.`);
    for (const c of changes) lines.push(`  ${c}`);
    for (const r of repinned) lines.push(`  re-pinned: ${r}`);
  }
  if (stillStale.length) {
    lines.push(
      "",
      `${plural(stillStale.length, "link")} still stale. \`capsules lock\` never clears staleness; review them with \`capsules status\`.`,
    );
  }
  const skippedText = skippedLine(skipped);
  if (skippedText) lines.push(skippedText + ".");
  if (trailer) {
    lines.push(
      "",
      "Add this line to your commit message (the commit-msg hook adds it for you if installed):",
      "",
      `  ${trailer}`,
      "",
      `Only an owner of ${target!.split("#")[0]} (${owners.length ? owners.join(", ") : "no owners set"}) may declare a change cosmetic. CI checks this.`,
    );
  }
  io.out(lines.join("\n") + "\n");
  return EXIT.ok;
}

function normalise(addr: string): string {
  const p = parseAddress(addr, { ref: false });
  return p.ok ? address(p.capsule!, p.node) : addr;
}

function checkAddress(project: Project, addr: string): void {
  const p = parseAddress(addr, { ref: false });
  if (!p.ok && p.reason === "cross-repo") throw new UsageError(errors.crossRepoArg(addr, p.repo));
  if (!p.ok) throw new UsageError(errors.badAddressArg(addr));
  const full = address(p.capsule!, p.node);
  if (!project.current.nodes.has(full)) throw new UsageError(errors.unknownAddressArg(full));
}

/** Owners of a capsule: its own `owners`, else the nearest ancestor's (C2.1). */
