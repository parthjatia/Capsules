// Weakened-test signals (C9.2): deterministic heuristics, no AI. Each signal names the
// file, the line and the pattern.
import type { Config } from "../core/config.js";

export const DEFAULT_ASSERTIONS = [
  "assert",
  "expect(",
  "should",
  "t.Error",
  "require.",
  "XCTAssert",
];
export const DEFAULT_SKIPS = [
  ".skip(",
  "xit(",
  "xdescribe(",
  "test.todo(",
  "@pytest.mark.skip",
  "t.Skip(",
  "@Ignore",
  "@Disabled",
];

export interface Patterns {
  assertions: string[];
  skips: string[];
}

export function patternsOf(config: Config): Patterns {
  const p = config["weakened-tests-patterns"];
  return {
    assertions: p?.assertions ?? DEFAULT_ASSERTIONS,
    skips: p?.skips ?? DEFAULT_SKIPS,
  };
}

export interface Signal {
  kind: "deleted" | "assertions-removed" | "skip-added";
  /** 1-based line: in the old version for removed assertions, in the new one for skips. */
  line?: number;
  /** How many assertion lines were removed, or skip markers added. */
  count?: number;
  pattern?: string;
  /** Plain words, e.g. `2 assertions removed (first at line 10 of the old version: "assert")`. */
  what: string;
}

const lines = (t: string) => t.replace(/\r\n?/g, "\n").split("\n");

/** Lines (1-based number and text) matching any pattern, with the first pattern that matched. */
function matching(text: string, patterns: string[]) {
  const out: { line: number; text: string; pattern: string }[] = [];
  lines(text).forEach((l, i) => {
    const pattern = patterns.find((p) => l.includes(p));
    if (pattern) out.push({ line: i + 1, text: l.trim(), pattern });
  });
  return out;
}

/** Lines in `a` that are not in `b`, counting duplicates (a multiset difference). */
function missingFrom<T extends { text: string }>(a: T[], b: T[]): T[] {
  const left = new Map<string, number>();
  for (const x of b) left.set(x.text, (left.get(x.text) ?? 0) + 1);
  const out: T[] = [];
  for (const x of a) {
    const n = left.get(x.text) ?? 0;
    if (n > 0) left.set(x.text, n - 1);
    else out.push(x);
  }
  return out;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Signals for one existing check file: `after` is null if the file was deleted. */
export function weakenedSignals(before: string, after: string | null, p: Patterns): Signal[] {
  if (after === null) return [{ kind: "deleted", what: "the test file was deleted" }];
  const out: Signal[] = [];
  const aBefore = matching(before, p.assertions);
  const aAfter = matching(after, p.assertions);
  if (aAfter.length < aBefore.length) {
    const removed = missingFrom(aBefore, aAfter);
    const first = removed[0] ?? aBefore[aBefore.length - 1]!;
    const n = aBefore.length - aAfter.length;
    out.push({
      kind: "assertions-removed",
      line: first.line,
      count: n,
      pattern: first.pattern,
      what: `${plural(n, "assertion")} removed (first at line ${first.line} of the old version, pattern "${first.pattern}")`,
    });
  }
  const sBefore = matching(before, p.skips);
  const sAfter = matching(after, p.skips);
  if (sAfter.length > sBefore.length) {
    const added = missingFrom(sAfter, sBefore);
    const first = added[0] ?? sAfter[sAfter.length - 1]!;
    const n = sAfter.length - sBefore.length;
    out.push({
      kind: "skip-added",
      line: first.line,
      count: n,
      pattern: first.pattern,
      what: `${plural(n, "skip marker")} added (first at line ${first.line}, pattern "${first.pattern}")`,
    });
  }
  return out;
}

/** Short words for the one-rule message: `existing test, 1 assertion removed`. */
export function describeCheckChange(
  before: string | null,
  after: string | null,
  p: Patterns,
): string {
  if (before === null) return "new test";
  const signals = weakenedSignals(before, after, p);
  if (signals.some((s) => s.kind === "deleted")) return "existing test, deleted";
  const parts = signals.map((s) =>
    s.kind === "assertions-removed"
      ? `${plural(s.count!, "assertion")} removed`
      : `${plural(s.count!, "skip marker")} added`,
  );
  return `existing test, ${parts.length ? parts.join(", ") : "changed"}`;
}
