// The map's data (C14): one deterministic model shared by the HTML, Mermaid and JSON formats.
// Everything is sorted and nothing depends on the clock or the machine, so the same files give
// the same map, byte for byte.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveBase } from "../core/base.js";
import { changeUnits } from "../core/changes.js";
import { explainFile, type FileExplanation } from "../core/explain.js";
import { guard } from "../core/guard.js";
import picomatch from "picomatch";
import { capsuleFromPath, checkGlobs } from "../core/judges.js";
import { splitReplaced, staleLinks, stalePrompts } from "../core/lock.js";
import { address, type Capsule, type CapsuleNode } from "../core/model.js";
import type { Project } from "../core/project.js";
import { plural } from "../report/text.js";

export type CheckStatus = "pass" | "fail" | "timeout" | "not run";

export interface MapNode {
  address: string;
  text: string;
}

export interface MapCapsule {
  id: string;
  kind: "area" | "concern";
  title: string;
  file: string;
  status: "active" | "draft";
  /** Area parent (null for root and concerns). */
  parent: string | null;
  depth: number;
  children: string[];
  intents: MapNode[];
  contracts: (MapNode & { scope: "tree" | "own" })[];
  checks: { address: string; status: CheckStatus }[];
  /** Areas: concerns covering any file whose home is here. Concerns: areas they reach. */
  related: string[];
  /** Files whose home is this area, or which this concern covers. */
  files: string[];
  stale: number;
  orphansNearby: string[];
}

export type AttentionKind =
  "error" | "stale" | "failing-check" | "unreviewed" | "orphan" | "assumption";

export interface AttentionItem {
  kind: AttentionKind;
  text: string;
  /** The capsule this item belongs to, for linking into the tree. */
  capsule: string;
  /** A file to look up in the search, when the item is about one. */
  file: string | null;
}

export interface MapSummary {
  areas: number;
  concerns: number;
  rules: number;
  stale: number;
  checks: { total: number; pass: number; fail: number; notRun: number };
  line: string;
}

export interface MapModel {
  title: string;
  summary: MapSummary;
  attention: AttentionItem[];
  capsules: MapCapsule[];
  files: FileExplanation[];
}

const firstLine = (s: string) =>
  s
    .split("\n")
    .find((l) => l.trim())
    ?.trim() ?? "";
const scopeOf = (n: CapsuleNode): "tree" | "own" =>
  n.fields.find((f) => f.key === "scope")?.value === "own" ? "own" : "tree";
const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const dirOf = (f: string) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "");

function lastResults(project: Project): Map<string, CheckStatus> {
  try {
    const raw = JSON.parse(
      readFileSync(join(project.root, ".capsules", "_cache", "last-check.json"), "utf8"),
    ) as { results?: { address?: unknown; status?: unknown }[] };
    const out = new Map<string, CheckStatus>();
    for (const r of raw.results ?? [])
      if (
        typeof r.address === "string" &&
        (r.status === "pass" || r.status === "fail" || r.status === "timeout")
      )
        out.set(r.address, r.status);
    return out;
  } catch {
    return new Map();
  }
}

/** New checks that arrived with code since the base (C6.2), as `capsules check` reports them. */
function unreviewedChecks(project: Project, baseRef: string | undefined): string[] {
  try {
    const base = resolveBase(project.root, baseRef);
    return guard(project, base, changeUnits(project, base)).unreviewed;
  } catch {
    return [];
  }
}

/** Areas in tree order: root, then each child (sorted) followed by its descendants. */
function treeOrder(areas: Capsule[]): Capsule[] {
  const kids = new Map<string | null, Capsule[]>();
  for (const a of areas) {
    const p = a.id === "root" ? null : (a.parent ?? "root");
    kids.set(p, [...(kids.get(p) ?? []), a]);
  }
  const out: Capsule[] = [];
  const seen = new Set<string>();
  const walk = (p: string | null) => {
    for (const c of (kids.get(p) ?? []).sort((x, y) => byString(x.id, y.id))) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
      walk(c.id);
    }
  };
  walk(null);
  // Areas whose parent is missing (E013 and similar) still appear, at the end.
  for (const a of [...areas].sort((x, y) => byString(x.id, y.id))) if (!seen.has(a.id)) out.push(a);
  return out;
}

export function buildMap(project: Project, opts: { base?: string } = {}): MapModel {
  const results = lastResults(project);
  const membership = [...project.membership.files.values()].sort((a, b) =>
    byString(a.file, b.file),
  );
  const known = new Set(project.capsules.map((c) => c.id));
  const capsuleOfAddress = (a: string) => a.split("#")[0] ?? "root";

  // Stale links and prompts (C7.4), by the capsule of the node that needs review.
  const stale: AttentionItem[] = [];
  if (project.lockOnDisk) {
    const { report } = splitReplaced(
      staleLinks(project.lockOnDisk, project.current),
      project.capsules,
    );
    for (const s of report)
      stale.push({
        kind: "stale",
        text: `${s.from} (${s.type} ${s.to}): ${s.to} changed after it was written. Review it, then run: capsules refresh ${s.from}`,
        capsule: capsuleOfAddress(s.from),
        file: null,
      });
    for (const p of stalePrompts(project.lockOnDisk, project.current))
      stale.push({
        kind: "stale",
        text: `${p.path} (${p.address}) changed since it was locked. Re-check the rules about it, then run capsules lock.`,
        capsule: capsuleOfAddress(p.address),
        file: p.path,
      });
  }
  const staleBy = new Map<string, number>();
  for (const s of stale) staleBy.set(s.capsule, (staleBy.get(s.capsule) ?? 0) + 1);

  // Orphans are "nearby" the area that is home to most files in the same folder; else root.
  const orphans = membership.filter((m) => !m.home && !m.conflict.length).map((m) => m.file);
  const nearby = new Map<string, string[]>();
  for (const o of orphans) {
    const counts = new Map<string, number>();
    for (const m of membership)
      if (m.home && dirOf(m.file) === dirOf(o)) counts.set(m.home, (counts.get(m.home) ?? 0) + 1);
    const best =
      [...counts.entries()].sort((a, b) => b[1] - a[1] || byString(a[0], b[0]))[0]?.[0] ?? "root";
    nearby.set(best, [...(nearby.get(best) ?? []), o]);
  }

  const areas = treeOrder(project.capsules.filter((c) => c.kind === "area"));
  const concerns = project.capsules
    .filter((c) => c.kind === "concern")
    .sort((a, b) => byString(a.id, b.id));
  const capsules: MapCapsule[] = [...areas, ...concerns].map((c) => {
    const files =
      c.kind === "area"
        ? membership.filter((m) => m.home === c.id).map((m) => m.file)
        : membership.filter((m) => m.concerns.includes(c.id)).map((m) => m.file);
    const related =
      c.kind === "area"
        ? [...new Set(membership.filter((m) => m.home === c.id).flatMap((m) => m.concerns))].sort(
            byString,
          )
        : [
            ...new Set(
              membership.filter((m) => m.concerns.includes(c.id)).map((m) => m.home ?? "root"),
            ),
          ].sort(byString);
    const node = (n: CapsuleNode) => ({ address: address(c.id, n.id), text: firstLine(n.prose) });
    return {
      id: c.id,
      kind: c.kind,
      title: c.front?.title ?? c.id,
      file: c.file,
      status: c.front?.status ?? "active",
      parent: c.kind === "area" && c.id !== "root" ? (c.parent ?? "root") : null,
      depth: c.kind === "area" && c.id !== "root" ? c.id.split(".").length : 0,
      children: areas
        .filter((a) => a.id !== "root" && (a.parent ?? "root") === c.id && c.kind === "area")
        .map((a) => a.id),
      intents: c.nodes.filter((n) => n.type === "intent").map(node),
      contracts: c.nodes
        .filter((n) => n.type === "contract")
        .map((n) => ({ ...node(n), scope: scopeOf(n) })),
      checks: c.nodes
        .filter((n) => n.type === "check")
        .map((n) => ({
          address: address(c.id, n.id),
          status: results.get(address(c.id, n.id)) ?? "not run",
        })),
      related,
      files,
      stale: staleBy.get(c.id) ?? 0,
      orphansNearby: nearby.get(c.id) ?? [],
    };
  });

  // Needs attention: errors, stale rules, failing checks, unreviewed checks, orphans, overdue assumptions.
  const attention: AttentionItem[] = [];
  for (const d of project.diagnostics)
    if (d.severity === "error") {
      const cap = d.file ? (capsuleFromPath(d.file)?.id ?? null) : null;
      attention.push({
        kind: "error",
        text: `${d.code} ${firstLine(d.message)}${d.file ? ` (${d.file}${d.line ? `:${d.line}` : ""})` : ""}`,
        capsule: cap && known.has(cap) ? cap : "root",
        file: null,
      });
    }
  attention.push(...stale);
  for (const c of capsules)
    for (const k of c.checks)
      if (k.status === "fail" || k.status === "timeout")
        attention.push({
          kind: "failing-check",
          text: `${k.address} ${k.status === "fail" ? "failed" : "timed out"} in the last capsules check.`,
          capsule: c.id,
          file: null,
        });
  // A new test belongs with the capsule whose check names it most specifically (longest
  // matching `files` glob), e.g. web's `tests/web/**` over root's `tests/**`.
  const checkFiles = project.capsules.flatMap((c) =>
    c.nodes
      .filter((n) => n.type === "check")
      .flatMap((n) => checkGlobs(n).map((g) => ({ capsule: c.id, glob: g }))),
  );
  for (const u of unreviewedChecks(project, opts.base)) {
    const best = checkFiles
      .filter((x) => picomatch.isMatch(u, x.glob, { dot: true }))
      .sort((a, b) => b.glob.length - a.glob.length || byString(a.capsule, b.capsule))[0];
    attention.push({
      kind: "unreviewed",
      text: `${u} is a new check added together with the code it judges. An owner, or a separate session, should confirm it.`,
      capsule: best?.capsule ?? project.membership.files.get(u)?.home ?? "root",
      file: u,
    });
  }
  for (const [cap, files] of [...nearby.entries()].sort((a, b) => byString(a[0], b[0])))
    for (const f of files)
      attention.push({
        kind: "orphan",
        text: `${f} has no home capsule. Add it to a capsule's covers, or to ignore in config.yaml.`,
        capsule: cap,
        file: f,
      });
  for (const d of project.diagnostics)
    if (d.code === "W105") {
      const cap = d.file ? (capsuleFromPath(d.file)?.id ?? null) : null;
      attention.push({
        kind: "assumption",
        text: firstLine(d.message),
        capsule: cap && known.has(cap) ? cap : "root",
        file: null,
      });
    }

  const all = capsules.flatMap((c) => c.checks);
  const checks = {
    total: all.length,
    pass: all.filter((k) => k.status === "pass").length,
    fail: all.filter((k) => k.status === "fail" || k.status === "timeout").length,
    notRun: all.filter((k) => k.status === "not run").length,
  };
  const checkText =
    checks.fail > 0
      ? `${plural(checks.fail, "check")} failed`
      : checks.pass === 0
        ? "checks not run yet"
        : checks.notRun
          ? `checks passed (${checks.pass} of ${checks.total} run)`
          : "checks passed";
  const rules = capsules.reduce((n, c) => n + c.contracts.length, 0);
  const summary: MapSummary = {
    areas: areas.length,
    concerns: concerns.length,
    rules,
    stale: stale.length,
    checks,
    line: [
      plural(areas.length, "area"),
      plural(concerns.length, "concern"),
      plural(rules, "rule"),
      `${stale.length} stale`,
      checkText,
    ].join(" · "),
  };

  return {
    title: capsules.find((c) => c.id === "root")?.title ?? "Capsules",
    summary,
    attention,
    capsules,
    files: membership.map((m) => explainFile(project, m.file)),
  };
}
