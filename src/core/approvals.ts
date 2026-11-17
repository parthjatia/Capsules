// `.capsules/approvals.lock` (C18.4, D-033): what an owner approved, pinned to the exact
// version. Written only by `capsules review approve`; line-based, sorted, LF, no timestamps.
//
//   node <address> <12-hex node hash | deleted>
//   file <capsule> <path> <40-hex blob hash | deleted>

export const APPROVALS_FILE = ".capsules/approvals.lock";
const HEADER = "# approvals.lock v1. Written by `capsules review approve`. Do not edit by hand.";

export interface Approvals {
  /** address -> approved node hash (or "deleted"). */
  nodes: Map<string, string>;
  /** path -> { capsule, blob (or "deleted") }. */
  files: Map<string, { capsule: string; blob: string }>;
}

export const emptyApprovals = (): Approvals => ({ nodes: new Map(), files: new Map() });

export type ApprovalsParse =
  { ok: true; approvals: Approvals } | { ok: false; line: number; text: string };

const NODE_RE = /^node (\S+#\S+) ([0-9a-f]{12}|deleted)$/;
const FILE_RE = /^file (\S+) (\S+) ([0-9a-f]{40}|deleted)$/;

export function parseApprovals(text: string): ApprovalsParse {
  const a = emptyApprovals();
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!l.trim() || l.startsWith("#")) continue;
    const n = NODE_RE.exec(l);
    if (n) {
      a.nodes.set(n[1]!, n[2]!);
      continue;
    }
    const f = FILE_RE.exec(l);
    if (f) {
      a.files.set(f[2]!, { capsule: f[1]!, blob: f[3]! });
      continue;
    }
    return { ok: false, line: i + 1, text: l };
  }
  return { ok: true, approvals: a };
}

export function serialiseApprovals(a: Approvals): string {
  const nodes = [...a.nodes].map(([addr, h]) => `node ${addr} ${h}`).sort();
  const files = [...a.files].map(([p, f]) => `file ${f.capsule} ${p} ${f.blob}`).sort();
  return [HEADER, ...nodes, ...files].join("\n") + "\n";
}

/** Approved exactly as it is now? `hash`/`blob` null means the item was deleted. */
export const nodeApproved = (a: Approvals, addr: string, hash: string | null) =>
  a.nodes.get(addr) === (hash ?? "deleted");
export const fileApproved = (a: Approvals, path: string, blob: string | null) =>
  a.files.get(path)?.blob === (blob ?? "deleted");

/** Records that were added or changed from `before` to `after`, with their capsule. */
export function changedRecords(
  before: Approvals,
  after: Approvals,
): { key: string; capsule: string }[] {
  const out: { key: string; capsule: string }[] = [];
  for (const [addr, h] of after.nodes)
    if (before.nodes.get(addr) !== h)
      out.push({ key: `node ${addr}`, capsule: addr.split("#")[0]! });
  for (const [p, f] of after.files)
    if (before.files.get(p)?.blob !== f.blob || before.files.get(p)?.capsule !== f.capsule)
      out.push({ key: `file ${p}`, capsule: f.capsule });
  return out;
}
