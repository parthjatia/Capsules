// Which capsule is each file's home, and which concerns cover it (C2.7).
import picomatch from "picomatch";
import { depth, isAncestor, type Capsule } from "./model.js";
import { msg, type Diagnostic } from "../report/messages.js";

export interface FileMembership {
  file: string;
  /** Home area capsule id, or null for orphans and E004 conflicts (treated as root for permissions). */
  home: string | null;
  /** The `covers` pattern of the home capsule that matched. */
  homePattern: string | null;
  /** When several unrelated area capsules match (E004), their ids; otherwise []. */
  conflict: string[];
  /** Ids of every concern covering the file, sorted. */
  concerns: string[];
}

export interface MembershipResult {
  files: Map<string, FileMembership>;
  ignored: string[];
  diagnostics: Diagnostic[];
}

const GLOB_OPTS = { dot: true } as const;

interface Matcher {
  capsule: Capsule;
  covers: { pattern: string; test: (p: string) => boolean }[];
  excluded: (p: string) => boolean;
}

function matchersFor(capsules: Capsule[]): Matcher[] {
  return capsules
    .filter((c) => c.front)
    .map((c) => {
      const excludes = c.front!.excludes.map((g) => picomatch(g, GLOB_OPTS));
      return {
        capsule: c,
        covers: c.front!.covers.map((g) => ({ pattern: g, test: picomatch(g, GLOB_OPTS) })),
        excluded: (p: string) => excludes.some((t) => t(p)),
      };
    })
    .sort((a, b) => (a.capsule.id < b.capsule.id ? -1 : a.capsule.id > b.capsule.id ? 1 : 0));
}

function resolve(file: string, matchers: Matcher[]): FileMembership {
  const areas: { id: string; pattern: string }[] = [];
  const concerns: string[] = [];
  for (const m of matchers) {
    const hit = m.covers.find((c) => c.test(file));
    if (!hit || m.excluded(file)) continue;
    if (m.capsule.kind === "concern") concerns.push(m.capsule.id);
    else areas.push({ id: m.capsule.id, pattern: hit.pattern });
  }
  const out: FileMembership = { file, home: null, homePattern: null, conflict: [], concerns };
  if (areas.length === 0) return out;
  // They must form one ancestor chain; the deepest wins.
  areas.sort((a, b) => depth(a.id) - depth(b.id) || (a.id < b.id ? -1 : 1));
  for (let i = 1; i < areas.length; i++) {
    if (!isAncestor(areas[i - 1]!.id, areas[i]!.id)) {
      out.conflict = areas.map((a) => a.id).sort();
      return out;
    }
  }
  const deepest = areas[areas.length - 1]!;
  out.home = deepest.id;
  out.homePattern = deepest.pattern;
  return out;
}

/** Membership of one path (tracked or not), without ignore rules or diagnostics. */
export function membershipOf(file: string, capsules: Capsule[]): FileMembership {
  return resolve(file, matchersFor(capsules));
}

export function isIgnored(file: string, ignore: string[]): boolean {
  return ignore.some((g) => picomatch.isMatch(file, g, GLOB_OPTS));
}

export function computeMembership(
  trackedFiles: string[],
  capsules: Capsule[],
  ignore: string[],
): MembershipResult {
  const matchers = matchersFor(capsules);
  const ignoreTest = ignore.map((g) => picomatch(g, GLOB_OPTS));
  const files = new Map<string, FileMembership>();
  const ignored: string[] = [];
  const conflicts: FileMembership[] = [];
  const orphans: string[] = [];
  const concernUse = new Map<string, number>();

  for (const file of [...trackedFiles].sort()) {
    if (ignoreTest.some((t) => t(file))) {
      ignored.push(file);
      continue;
    }
    const m = resolve(file, matchers);
    files.set(file, m);
    if (m.conflict.length) conflicts.push(m);
    else if (!m.home) orphans.push(file);
    for (const c of m.concerns) concernUse.set(c, (concernUse.get(c) ?? 0) + 1);
  }

  const diagnostics: Diagnostic[] = [];
  for (const m of conflicts) {
    const first = capsules.find((c) => c.id === m.conflict[0]);
    diagnostics.push(msg.E004({ file: first?.file ?? m.file, line: 1 }, m.file, m.conflict));
  }
  for (const c of [...capsules].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (c.kind === "concern" && c.front && !concernUse.get(c.id)) {
      diagnostics.push(msg.E014({ file: c.file, line: 1 }, c.id));
    }
  }
  for (const f of orphans) diagnostics.push(msg.W101(f));
  return { files, ignored, diagnostics };
}
