import { shortestPrefixes } from "../../core/hash.js";
import {
  lockChanges,
  skippedLine,
  splitReplaced,
  staleLinks,
  stalePrompts,
} from "../../core/lock.js";
import { findProjectRoot, loadProject } from "../../core/project.js";
import { toJson } from "../../report/json.js";
import { countBySeverity, plural, rows } from "../../report/text.js";
import { EXIT } from "../exit-codes.js";
import type { Io } from "../io.js";

// Capsule and file counts, the lockfile, stale links and prompts, orphans, assumptions
// past review, problem totals. Check results join in M3.
export function status(io: Io, opts: { json?: boolean }): number {
  const project = loadProject(findProjectRoot(io.cwd));
  const files = [...project.membership.files.values()];
  const orphans = files.filter((f) => !f.home && !f.conflict.length).map((f) => f.file);
  const conflicts = files.filter((f) => f.conflict.length).map((f) => f.file);
  const overdue = project.diagnostics.filter((d) => d.code === "W105");
  const areas = project.capsules.filter((c) => c.kind === "area").length;
  const concerns = project.capsules.length - areas;
  const { errors, warnings } = countBySeverity(project.diagnostics);

  const unreadable = project.diagnostics.some((d) => d.code === "E026");
  const disk = project.lockOnDisk;
  const changes = disk ? lockChanges(disk, project.current) : [];
  const { report: stale, skipped } = splitReplaced(
    disk ? staleLinks(disk, project.current) : [],
    project.capsules,
  );
  const prompts = disk ? stalePrompts(disk, project.current) : [];
  const lockState = unreadable
    ? "unreadable"
    : !disk
      ? "missing"
      : changes.length
        ? "out-of-date"
        : "up-to-date";
  const prefix = shortestPrefixes([
    ...[...project.current.nodes.values()].map((n) => n.hash),
    ...stale.map((s) => s.hash),
  ]);
  const short = (h: string) => prefix.get(h) ?? h.slice(0, 4);

  if (opts.json) {
    io.out(
      toJson("status", {
        capsules: { areas, concerns },
        files: {
          tracked: project.tracked.length,
          withHome: files.length - orphans.length - conflicts.length,
          ignored: project.membership.ignored.length,
          orphans: orphans.length,
          conflicts: conflicts.length,
        },
        lock: {
          state: lockState,
          changes: changes.map((c) => `${c.kind} ${c.key} ${c.change}`),
        },
        staleLinks: stale.map((s) => ({
          from: s.from,
          type: s.type,
          to: s.to,
          pinned: s.hash,
          current: s.current,
        })),
        skippedReplaced: skipped,
        stalePrompts: prompts,
        orphans,
        conflicts,
        assumptionsPastReview: overdue.map((d) => ({
          file: d.file,
          line: d.line,
          message: d.message,
        })),
        problems: { errors, warnings },
      }),
    );
    return EXIT.ok;
  }

  const lockText = {
    "up-to-date": "up to date",
    missing: "missing (run: capsules lock)",
    unreadable: "can't be read (E026, see: capsules check --no-run)",
    "out-of-date": `out of date, ${plural(changes.length, "change")} (run: capsules lock)`,
  }[lockState];

  const parts: string[] = [
    rows([
      ["capsules", `${plural(areas, "area")}, ${plural(concerns, "concern")}`],
      [
        "files",
        `${project.tracked.length} tracked: ${files.length - orphans.length - conflicts.length} with a home, ${project.membership.ignored.length} ignored, ${plural(orphans.length, "orphan")}${conflicts.length ? `, ${conflicts.length} with two homes (E004)` : ""}`,
      ],
      ["lock", lockText],
      ["stale", `${plural(stale.length, "link")}, ${plural(prompts.length, "prompt")}`],
      [
        "problems",
        `${plural(errors, "error")}, ${plural(warnings, "warning")}${errors + warnings ? " (details: capsules check --no-run)" : ""}`,
      ],
    ]),
  ];
  if (changes.length) {
    parts.push(
      `lock out of date (E010): what changed since the last \`capsules lock\`\n${changes.map((c) => `  ${c.kind} ${c.key} ${c.change}`).join("\n")}`,
    );
  }
  if (stale.length) {
    const width = Math.max(...stale.map((s) => `${s.from} ${s.type} ${s.to}`.length));
    parts.push(
      [
        "stale links (W104): written against an older version of what they point to",
        ...stale.map(
          (s) =>
            `  ${`${s.from} ${s.type} ${s.to}`.padEnd(width)}   ${s.to.split("#")[1]} changed: ${short(s.hash)} -> ${short(s.current)}`,
        ),
        "  next: review each one, then `capsules refresh <from>`. If the change was only a typo,",
        "        an owner runs `capsules relock --cosmetic <to>` instead.",
      ].join("\n"),
    );
  }
  const skippedText = skippedLine(skipped);
  if (skippedText) parts.push(skippedText + ".");
  if (prompts.length) {
    parts.push(
      `changed prompts (W110): re-check the rules about them, then run \`capsules lock\`\n${prompts.map((p) => `  ${p.path} (${p.address})`).join("\n")}`,
    );
  }
  if (orphans.length) {
    parts.push(
      `orphans (W101): files no capsule covers. Add them to a capsule's covers, or to ignore in .capsules/config.yaml.\n${orphans.map((f) => `  ${f}`).join("\n")}`,
    );
  }
  if (conflicts.length)
    parts.push(`files with two homes (E004):\n${conflicts.map((f) => `  ${f}`).join("\n")}`);
  if (overdue.length) {
    parts.push(
      `assumptions past review (W105):\n${overdue.map((d) => `  ${d.message} (${d.file}:${d.line})`).join("\n")}`,
    );
  }
  io.out(parts.join("\n\n") + "\n");
  return EXIT.ok;
}
