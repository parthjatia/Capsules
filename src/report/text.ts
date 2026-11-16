// Plain-text rendering. No colours (output is often piped), no timestamps (F2, C15).
import type { Diagnostic } from "./messages.js";

export function formatDiagnostic(d: Diagnostic): string {
  const where = d.file ? `${d.file}${d.line ? `:${d.line}` : ""}` : "";
  const lines = [`${d.severity} ${d.code}  ${d.message}`];
  if (where) lines.push(`  at:   ${where}`);
  lines.push(`  why:  ${d.why}`);
  lines.push(`  fix:  ${d.fix}`);
  return lines.join("\n");
}

const MAX_ORPHANS_SHOWN = 10;

/** Render diagnostics, folding long runs of orphan warnings into one line. */
export function formatDiagnostics(ds: Diagnostic[]): string {
  const orphans = ds.filter((d) => d.code === "W101");
  const shownOrphans = new Set(orphans.slice(0, MAX_ORPHANS_SHOWN));
  const blocks: string[] = [];
  for (const d of ds) {
    if (d.code === "W101" && !shownOrphans.has(d)) continue;
    blocks.push(formatDiagnostic(d));
  }
  if (orphans.length > MAX_ORPHANS_SHOWN) {
    blocks.push(
      `warning W101  ...and ${orphans.length - MAX_ORPHANS_SHOWN} more files with no home capsule.\n  fix:  run \`capsules status\` to list them all.`,
    );
  }
  return blocks.join("\n\n");
}

export function countBySeverity(ds: Diagnostic[]): { errors: number; warnings: number } {
  return {
    errors: ds.filter((d) => d.severity === "error").length,
    warnings: ds.filter((d) => d.severity === "warning").length,
  };
}

export function plural(n: number, word: string, many = word + "s"): string {
  return `${n} ${n === 1 ? word : many}`;
}

/** Aligned `label:  value` rows, like `capsules explain` (C3). */
export function rows(pairs: [string, string][], width = 11): string {
  return pairs.map(([k, v]) => `${(k + ":").padEnd(width)}${v}`).join("\n");
}
