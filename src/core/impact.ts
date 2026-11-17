// `capsules impact <address>` and `capsules why <address>` (C15). Both are read-only walks of
// the link graph; neither calls git.
import { address, type Capsule, type CapsuleNode, type LinkType } from "./model.js";
import { targetOf } from "./resolve.js";

export interface Dependent {
  address: string;
  type: string;
  /** How it depends on the node it points at, e.g. `shows` or `uses`. */
  link: LinkType;
  /** The node this one links to (the asked-for node, or a dependent of it). */
  on: string;
  /** 1 = links straight to the asked-for node, 2 = to one of those, and so on. */
  distance: number;
  text: string;
}

export interface Impact {
  address: string;
  type: string;
  text: string;
  dependents: Dependent[];
  /** Files named by dependents: code nodes' paths, checks' `files`, prompts' `file`. */
  files: string[];
}

interface Indexed {
  nodes: Map<string, CapsuleNode>;
  /** Links pointing at each address: [from address, link type]. */
  incoming: Map<string, [string, LinkType][]>;
}

function index(capsules: Capsule[]): Indexed {
  const nodes = new Map<string, CapsuleNode>();
  const incoming = new Map<string, [string, LinkType][]>();
  for (const c of capsules)
    for (const n of c.nodes) {
      const from = address(c.id, n.id);
      nodes.set(from, n);
      for (const l of n.links) {
        const to = targetOf(l.ref, c.id);
        const list = incoming.get(to) ?? [];
        if (!list.some(([f, t]) => f === from && t === l.type)) list.push([from, l.type]);
        incoming.set(to, list);
      }
    }
  return { nodes, incoming };
}

const firstLine = (n: CapsuleNode) => n.prose.split("\n").find((l) => l.trim()) ?? "";
const byAddress = (a: { address: string }, b: { address: string }) =>
  a.address < b.address ? -1 : a.address > b.address ? 1 : 0;

function filesOf(n: CapsuleNode): string[] {
  if (n.type === "code")
    return n.prose
      .split("\n")
      .map((l) => l.trim().split("#")[0]!)
      .filter(Boolean);
  if (n.type === "check") return n.fields.filter((f) => f.key === "files").map((f) => f.value);
  if (n.type === "prompt") return n.fields.filter((f) => f.key === "file").map((f) => f.value);
  return [];
}

/** Everything that depends on `addr`, nearest first (breadth-first over incoming links). */
export function impactOf(capsules: Capsule[], addr: string): Impact | null {
  const g = index(capsules);
  const root = g.nodes.get(addr);
  if (!root) return null;
  const seen = new Set([addr]);
  const out: Dependent[] = [];
  let frontier = [addr];
  for (let distance = 1; frontier.length; distance++) {
    const next: string[] = [];
    const level: Dependent[] = [];
    for (const on of frontier)
      for (const [from, link] of g.incoming.get(on) ?? []) {
        if (seen.has(from)) continue;
        seen.add(from);
        const n = g.nodes.get(from)!;
        level.push({ address: from, type: n.type, link, on, distance, text: firstLine(n) });
        next.push(from);
      }
    out.push(...level.sort(byAddress));
    frontier = next;
  }
  const files = [...new Set(out.flatMap((d) => filesOf(g.nodes.get(d.address)!)))].sort();
  return { address: addr, type: root.type, text: firstLine(root), dependents: out, files };
}

export interface DecisionWhy {
  address: string;
  text: string;
  rejected: string[];
  /** Assumptions it rests on, with their review-by date if any. */
  assumes: { address: string; text: string; reviewBy: string | null }[];
  /** Older decisions it replaced, nearest first. */
  replaces: string[];
  /** The decision that replaced this one, if any. */
  replacedBy: string | null;
  /** What it serves, when that isn't the asked-for node itself. */
  via: string | null;
}

export interface Why {
  address: string;
  type: string;
  text: string;
  /** What this node serves or shows (its reason one level up), with their text. */
  serves: { address: string; link: LinkType; text: string }[];
  decisions: DecisionWhy[];
}

/** The decisions behind a node, with rejected options, and what it serves. */
export function whyOf(capsules: Capsule[], addr: string): Why | null {
  const g = index(capsules);
  const node = g.nodes.get(addr);
  if (!node) return null;
  const out = (n: CapsuleNode, type: LinkType) =>
    n.links.filter((l) => l.type === type).map((l) => targetOf(l.ref, n.capsule));
  const replacedBy = (d: string) =>
    (g.incoming.get(d) ?? []).find(([, t]) => t === "supersedes")?.[0] ?? null;

  // The reasons one level up: contract -> intent, example -> contract, decision -> served node.
  const serves = (["serves", "shows", "implements"] as LinkType[]).flatMap((type) =>
    out(node, type).map((a) => ({
      address: a,
      link: type,
      text: g.nodes.has(a) ? firstLine(g.nodes.get(a)!) : "(missing)",
    })),
  );

  const describe = (d: string, via: string | null): DecisionWhy => {
    const n = g.nodes.get(d)!;
    const replaces: string[] = [];
    let cur: string | undefined = d;
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      const older: string | undefined = out(g.nodes.get(cur)!, "supersedes")[0];
      if (older && g.nodes.has(older)) replaces.push(older);
      cur = older && g.nodes.has(older) ? older : undefined;
    }
    return {
      address: d,
      text: firstLine(n),
      rejected: n.fields.filter((f) => f.key === "rejected").map((f) => f.value),
      assumes: out(n, "assumes")
        .filter((a) => g.nodes.has(a))
        .map((a) => {
          const an = g.nodes.get(a)!;
          return {
            address: a,
            text: firstLine(an),
            reviewBy: an.fields.find((f) => f.key === "review-by")?.value ?? null,
          };
        }),
      replaces,
      replacedBy: replacedBy(d),
      via,
    };
  };

  const decisions: DecisionWhy[] = [];
  const seen = new Set<string>();
  const add = (d: string, via: string | null) => {
    if (seen.has(d) || g.nodes.get(d)?.type !== "decision") return;
    seen.add(d);
    decisions.push(describe(d, via));
  };
  if (node.type === "decision") add(addr, null);
  // Decisions that serve this node, then decisions that serve what it serves (one level up).
  for (const [from, t] of g.incoming.get(addr) ?? []) if (t === "serves") add(from, null);
  for (const s of serves)
    for (const [from, t] of g.incoming.get(s.address) ?? [])
      if (t === "serves") add(from, s.address);
  // Replaced decisions last: current reasons first.
  decisions.sort((a, b) => Number(a.replacedBy !== null) - Number(b.replacedBy !== null));
  return { address: addr, type: node.type, text: firstLine(node), serves, decisions };
}
