// Checks that need every capsule at once: references, link targets, cycles, and
// the reported warnings W102, W103, W105, W106 (C2.4, C2.6).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseAddress } from "./address.js";
import {
  address,
  type Capsule,
  type CapsuleNode,
  type LinkType,
  type NodeType,
  type Ref,
} from "./model.js";
import { msg, type Diagnostic } from "../report/messages.js";

export interface GraphIndex {
  capsules: Map<string, Capsule>;
  nodes: Map<string, CapsuleNode>;
}

export function buildIndex(capsules: Capsule[]): GraphIndex {
  const idx: GraphIndex = { capsules: new Map(), nodes: new Map() };
  for (const c of capsules) {
    idx.capsules.set(c.id, c);
    for (const n of c.nodes) idx.nodes.set(address(c.id, n.id), n);
  }
  return idx;
}

/** Fully-qualified target address of a ref written inside capsule `from`. */
export function targetOf(ref: Ref, from: string): string {
  return address(ref.capsule ?? from, ref.node);
}

const TARGETS: Record<
  LinkType,
  { allowed: (from: NodeType, to: NodeType) => boolean; text: string }
> = {
  serves: {
    allowed: (f, t) => (f === "contract" ? t === "intent" : t === "contract" || t === "intent"),
    text: "from a contract to an intent, or from a decision to a contract or intent",
  },
  "checked-by": {
    allowed: (_f, t) => t === "check",
    text: "from a contract or example to a check",
  },
  shows: { allowed: (_f, t) => t === "contract", text: "from an example to a contract" },
  implements: { allowed: (_f, t) => t === "contract", text: "from a code node to a contract" },
  uses: { allowed: () => true, text: "from a context or prompt to any node" },
  assumes: { allowed: (_f, t) => t === "assumption", text: "from a decision to an assumption" },
  "derived-from": { allowed: () => true, text: "from a context to any node" },
  supersedes: { allowed: (_f, t) => t === "decision", text: "from a decision to another decision" },
};

export interface ValidateOptions {
  projectRoot: string;
  /** Today's date as YYYY-MM-DD, for `review-by` (W105). */
  today: string;
}

export function validateGraph(capsules: Capsule[], opts: ValidateOptions): Diagnostic[] {
  const idx = buildIndex(capsules);
  const out: Diagnostic[] = [];

  const lookup = (
    ref: Ref,
    from: Capsule,
    at: { file: string; line: number },
  ): CapsuleNode | null => {
    const capId = ref.capsule ?? from.id;
    const cap = idx.capsules.get(capId);
    if (!cap) {
      out.push(msg.E003(at, ref.raw, `there is no capsule "${capId}"`));
      return null;
    }
    const node = idx.nodes.get(address(capId, ref.node));
    if (!node) {
      out.push(msg.E003(at, ref.raw, `capsule ${capId} has no node "${ref.node}"`));
      return null;
    }
    return node;
  };

  for (const cap of capsules) {
    for (const node of cap.nodes) {
      for (const link of node.links) {
        const at = { file: cap.file, line: link.ref.line };
        const target = lookup(link.ref, cap, at);
        if (!target) continue;
        const rule = TARGETS[link.type];
        if (!rule.allowed(node.type, target.type)) {
          out.push(msg.E006(at, link.type, node.type, target.type, rule.text));
        }
      }

      const addr = address(cap.id, node.id);
      if (node.type === "contract" && !node.links.some((l) => l.type === "serves")) {
        out.push(msg.W102({ file: cap.file, line: node.line }, addr));
      }
      if (
        (node.type === "contract" || node.type === "example") &&
        !node.links.some((l) => l.type === "checked-by")
      ) {
        out.push(msg.W103({ file: cap.file, line: node.line }, node.type, addr));
      }
      if (node.type === "assumption") {
        const tripwire = node.fields.find((f) => f.key === "tripwire");
        if (tripwire) {
          const p = parseAddress(tripwire.value, { ref: true });
          if (p.ok) {
            const ref: Ref = {
              raw: tripwire.value,
              capsule: p.capsule,
              node: p.node,
              line: tripwire.line,
            };
            const t = lookup(ref, cap, { file: cap.file, line: tripwire.line });
            if (t && t.type !== "check") {
              out.push(
                msg.E006(
                  { file: cap.file, line: tripwire.line },
                  "tripwire",
                  "assumption",
                  t.type,
                  "from an assumption to a check",
                ),
              );
            }
          }
        }
        const review = node.fields.find((f) => f.key === "review-by");
        if (review && /^\d{4}-\d{2}-\d{2}$/.test(review.value) && review.value < opts.today) {
          out.push(msg.W105({ file: cap.file, line: review.line }, addr, review.value));
        }
      }
      if (node.type === "prompt") {
        const f = node.fields.find((x) => x.key === "file");
        if (f && f.value && !existsSync(join(opts.projectRoot, f.value))) {
          out.push(msg.W109({ file: cap.file, line: f.line }, addr, f.value));
        }
      }
      if (node.type === "code") {
        const bodyLines = node.body.split("\n");
        bodyLines.forEach((line, i) => {
          const path = line.trim().split("#")[0]!.trim();
          if (!path) return;
          if (!existsSync(join(opts.projectRoot, path))) {
            out.push(msg.W106({ file: cap.file, line: node.line + 1 + i }, addr, path));
          }
        });
      }
    }
  }

  for (const linkType of ["supersedes", "derived-from"] as const) {
    out.push(...findCycles(capsules, idx, linkType));
  }
  return out;
}

function findCycles(capsules: Capsule[], idx: GraphIndex, linkType: LinkType): Diagnostic[] {
  const edges = new Map<string, string[]>();
  for (const cap of capsules) {
    for (const node of cap.nodes) {
      const targets = node.links
        .filter((l) => l.type === linkType)
        .map((l) => targetOf(l.ref, cap.id))
        .filter((t) => idx.nodes.has(t))
        .sort();
      if (targets.length) edges.set(address(cap.id, node.id), targets);
    }
  }
  const out: Diagnostic[] = [];
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const reported = new Set<string>();

  const visit = (n: string) => {
    state.set(n, "visiting");
    stack.push(n);
    for (const t of edges.get(n) ?? []) {
      if (state.get(t) === "visiting") {
        const cycle = stack.slice(stack.indexOf(t));
        const key = [...cycle].sort().join(" ");
        if (!reported.has(key)) {
          reported.add(key);
          const [capId] = t.split("#");
          const cap = idx.capsules.get(capId!);
          const node = idx.nodes.get(t);
          out.push(
            msg.E005({ file: cap?.file ?? "", line: node?.line ?? 1 }, linkType, [...cycle, t]),
          );
        }
      } else if (!state.has(t)) {
        visit(t);
      }
    }
    stack.pop();
    state.set(n, "done");
  };
  for (const n of [...edges.keys()].sort()) if (!state.has(n)) visit(n);
  return out;
}
