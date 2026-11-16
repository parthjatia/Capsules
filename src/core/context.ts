// The context pack (C16): what an agent needs before working on a capsule, nearest first.
// Over budget, far rings shrink to one line per item first, then are left out.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { splitReplaced, staleLinks } from "./lock.js";
import { ancestorsOf, address, type Capsule, type CapsuleNode } from "./model.js";
import { membershipOf } from "./membership.js";
import type { Project } from "./project.js";
import { buildIndex, targetOf } from "./resolve.js";

export interface Ring {
  title: string;
  full: string[];
  short: string[];
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();
const scopeOf = (n: CapsuleNode) =>
  n.fields.find((f) => f.key === "scope")?.value === "own" ? "own" : "tree";

/** The capsules a context pack is for: a capsule id, or a file's home (root for orphans). */
export function resolveTarget(
  project: Project,
  target: string,
): { capsule: Capsule; file: string | null; concerns: string[] } | null {
  const byId = project.capsules.find((c) => c.id === target);
  if (byId) return { capsule: byId, file: null, concerns: [] };
  const file = target.split("\\").join("/").replace(/^\.\//, "");
  if (!existsSync(join(project.root, ...file.split("/")))) return null;
  const m = membershipOf(file, project.capsules);
  const home = project.capsules.find((c) => c.id === (m.home ?? "root"));
  return home ? { capsule: home, file, concerns: m.concerns } : null;
}

function nodeText(c: Capsule, n: CapsuleNode): string[] {
  return [
    `### ${n.heading}  (${address(c.id, n.id)})`,
    ...(n.body.trim() ? [n.body.trim()] : []),
    "",
  ];
}

export function contextRings(project: Project, c: Capsule, fileConcerns: string[]): Ring[] {
  const idx = buildIndex(project.capsules);
  const rings: Ring[] = [];
  const line = (capId: string, n: CapsuleNode) =>
    `- ${address(capId, n.id)} (${n.type}): ${oneLine(n.prose)}`;

  // Warnings first: stale links touching this capsule, failing checks, assumptions past review.
  const warn: string[] = [];
  const mine = (a: string) => a.split("#")[0] === c.id;
  if (project.lockOnDisk) {
    const { report } = splitReplaced(
      staleLinks(project.lockOnDisk, project.current),
      project.capsules,
    );
    for (const s of report)
      if (mine(s.from) || mine(s.to))
        warn.push(
          `- stale: ${s.from} ${s.type} ${s.to} (the target changed since it was pinned; review it)`,
        );
  }
  try {
    const last = JSON.parse(
      readFileSync(join(project.root, ".capsules", "_cache", "last-check.json"), "utf8"),
    ) as {
      results: { address: string; status: string }[];
    };
    for (const r of last.results)
      if (mine(r.address) && r.status !== "pass")
        warn.push(`- check ${r.address} last result: ${r.status}`);
  } catch {
    // no check results yet
  }
  for (const d of project.diagnostics)
    if (d.code === "W105" && d.file === c.file) warn.push(`- ${d.message}`);
  rings.push({ title: "Warnings", full: warn, short: warn });

  // The capsule itself: everything.
  rings.push({
    title: `${c.front?.title ?? c.id} (capsule ${c.id}, ${c.file})`,
    full: c.nodes.flatMap((n) => nodeText(c, n)),
    short: c.nodes.flatMap((n) => nodeText(c, n)),
  });

  // Ancestors: intents and `scope: tree` contracts, one line each.
  const anc = c.kind === "area" ? ancestorsOf(c.id).filter((a) => idx.capsules.has(a)) : [];
  const ancLines = anc.flatMap((a) =>
    (idx.capsules.get(a)?.nodes ?? [])
      .filter((n) => n.type === "intent" || (n.type === "contract" && scopeOf(n) === "tree"))
      .map((n) => line(a, n)),
  );
  rings.push({
    title: "Inherited from ancestors (these rules apply here too)",
    full: ancLines,
    short: ancLines,
  });

  // Concerns covering its files: contracts and context.
  const concerns = new Set(fileConcerns);
  if (c.kind === "area")
    for (const m of project.membership.files.values())
      if (m.home === c.id) m.concerns.forEach((k) => concerns.add(k));
  const conc = [...concerns].sort();
  rings.push({
    title: "Concerns covering its files",
    full: conc.flatMap((k) =>
      (idx.capsules.get(k)?.nodes ?? [])
        .filter((n) => n.type === "contract" || n.type === "context")
        .map((n) =>
          n.type === "contract"
            ? line(k, n)
            : `- ${address(k, n.id)} (context): ${oneLine(n.prose)}`,
        ),
    ),
    short: conc.flatMap((k) =>
      (idx.capsules.get(k)?.nodes ?? [])
        .filter((n) => n.type === "contract")
        .map((n) => line(k, n)),
    ),
  });

  // Children: contracts and interfaces (code nodes).
  const children = project.capsules.filter((x) => x.parent === c.id && x.kind === "area");
  rings.push({
    title: "Children",
    full: children.flatMap((ch) => [
      `- ${ch.id}: ${ch.front?.title ?? ch.id}`,
      ...ch.nodes
        .filter((n) => n.type === "contract" || n.type === "code")
        .map((n) => `  ${line(ch.id, n)}`),
    ]),
    short: children.map((ch) => `- ${ch.id}: ${ch.front?.title ?? ch.id}`),
  });

  // Siblings and `uses` targets: titles and contracts, one line each.
  const siblings = project.capsules.filter(
    (x) =>
      x.kind === "area" &&
      x.id !== c.id &&
      x.id !== "root" &&
      x.parent === c.parent &&
      c.kind === "area",
  );
  const usesTargets = [
    ...new Set(
      c.nodes.flatMap((n) =>
        n.links.filter((l) => l.type === "uses").map((l) => targetOf(l.ref, c.id)),
      ),
    ),
  ].filter((a) => !mine(a));
  rings.push({
    title: "Siblings and what it uses",
    full: [
      ...siblings.flatMap((s) => [
        `- ${s.id}: ${s.front?.title ?? s.id}`,
        ...s.nodes.filter((n) => n.type === "contract").map((n) => `  ${line(s.id, n)}`),
      ]),
      ...usesTargets.map((a) => {
        const n = idx.nodes.get(a);
        return n ? line(a.split("#")[0]!, n) : `- ${a}`;
      }),
    ],
    short: [
      ...siblings.map((s) => `- ${s.id}: ${s.front?.title ?? s.id}`),
      ...usesTargets.map((a) => `- ${a}`),
    ],
  });

  // Decisions elsewhere that link to this capsule's nodes.
  const linked: string[] = [];
  const linkedShort: string[] = [];
  for (const other of project.capsules) {
    if (other.id === c.id) continue;
    for (const n of other.nodes) {
      if (n.type !== "decision") continue;
      if (!n.links.some((l) => mine(targetOf(l.ref, other.id)))) continue;
      linked.push(line(other.id, n));
      for (const f of n.fields.filter((x) => x.key === "rejected"))
        linked.push(`  rejected: ${f.value}`);
      linkedShort.push(line(other.id, n));
    }
  }
  rings.push({
    title: "Decisions elsewhere that rest on this capsule",
    full: linked,
    short: linkedShort,
  });
  return rings;
}

/** Render the rings within a budget (characters; 0 = no limit). Far rings shrink first. */
export function renderRings(header: string[], rings: Ring[], budgetChars: number): string {
  const mode: ("full" | "short" | "out")[] = rings.map(() => "full");
  const render = () =>
    [
      ...header,
      ...rings.flatMap((r, i) => {
        const body = mode[i] === "full" ? r.full : mode[i] === "short" ? r.short : [];
        if (mode[i] === "out")
          return r.full.length ? [`## ${r.title}`, "", "(left out: over the --budget)", ""] : [];
        return body.length ? [`## ${r.title}`, "", ...body, ""] : [];
      }),
    ]
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  let text = render();
  if (!budgetChars) return text;
  // Rings 0 (warnings) and 1 (the capsule) never shrink.
  for (const step of ["short", "out"] as const)
    for (let i = rings.length - 1; i >= 2 && text.length > budgetChars; i--) {
      mode[i] = step;
      text = render();
    }
  return text;
}
