// `capsules impact <address>` and `capsules why <address>` (C15): read-only.
import { parseAddress } from "../../core/address.js";
import { impactOf, whyOf } from "../../core/impact.js";
import { address } from "../../core/model.js";
import { findProjectRoot, loadProject, UsageError, type Project } from "../../core/project.js";
import { toJson } from "../../report/json.js";
import { errors } from "../../report/messages.js";
import { EXIT } from "../exit-codes.js";
import type { Io } from "../io.js";

function resolveArg(project: Project, addr: string): string {
  const p = parseAddress(addr, { ref: false });
  if (!p.ok && p.reason === "cross-repo") throw new UsageError(errors.crossRepoArg(addr, p.repo));
  if (!p.ok) throw new UsageError(errors.badAddressArg(addr));
  const full = address(p.capsule!, p.node);
  if (!project.capsules.some((c) => c.id === p.capsule && c.nodes.some((n) => n.id === p.node)))
    throw new UsageError(errors.unknownAddressArg(full));
  return full;
}

export function impact(io: Io, addr: string, opts: { json?: boolean }): number {
  const project = loadProject(findProjectRoot(io.cwd));
  const r = impactOf(project.capsules, resolveArg(project, addr))!;
  if (opts.json) {
    io.out(toJson("impact", { ...r }));
    return EXIT.ok;
  }
  const lines = [`${r.address} (${r.type}): ${r.text}`];
  if (!r.dependents.length) lines.push("", "Nothing links to it.");
  else {
    lines.push(
      "",
      `${r.dependents.length} node${r.dependents.length === 1 ? "" : "s"} depend on it, nearest first:`,
    );
    for (const d of r.dependents) {
      const via = d.distance === 1 ? d.link : `${d.link} ${d.on}`;
      lines.push(`  ${"  ".repeat(d.distance - 1)}${d.address} (${d.type}, ${via}): ${d.text}`);
    }
  }
  if (r.files.length) lines.push("", `files: ${r.files.join(", ")}`);
  lines.push(
    "",
    "If it changes, these go stale (W104) until someone reviews them: `capsules status`, `capsules review`.",
  );
  io.out(lines.join("\n") + "\n");
  return EXIT.ok;
}

export function why(io: Io, addr: string, opts: { json?: boolean }): number {
  const project = loadProject(findProjectRoot(io.cwd));
  const r = whyOf(project.capsules, resolveArg(project, addr))!;
  if (opts.json) {
    io.out(toJson("why", { ...r }));
    return EXIT.ok;
  }
  const lines = [`${r.address} (${r.type}): ${r.text}`];
  for (const s of r.serves) lines.push(`  ${s.link} ${s.address}: ${s.text}`);
  if (!r.decisions.length) lines.push("", "No decision explains it yet.");
  else lines.push("", "Decisions:");
  for (const d of r.decisions) {
    const tags = [
      d.via ? `serves ${d.via}` : null,
      d.replacedBy ? `replaced by ${d.replacedBy}` : null,
    ].filter(Boolean);
    lines.push(`  ${d.address}${tags.length ? ` (${tags.join("; ")})` : ""}: ${d.text}`);
    for (const x of d.rejected) lines.push(`    rejected: ${x}`);
    for (const a of d.assumes)
      lines.push(
        `    assumes ${a.address}: ${a.text}${a.reviewBy ? ` (review by ${a.reviewBy})` : ""}`,
      );
    if (d.replaces.length) lines.push(`    replaces: ${d.replaces.join(", ")}`);
  }
  io.out(lines.join("\n") + "\n");
  return EXIT.ok;
}
