// What applies to one file: its home, parents, concerns, rules, checks and decisions (C2.7 step 6, C3).
import { ancestorsOf, address, type Capsule, type CapsuleNode } from "./model.js";
import type { FileMembership } from "./membership.js";
import { buildIndex, targetOf } from "./resolve.js";

export interface AppliedRule {
  address: string;
  text: string;
  from: "home" | "ancestor" | "concern";
}

export interface DecisionSummary {
  address: string;
  text: string;
  rejected: string[];
}

export interface FileRules {
  home: string | null;
  parents: string[];
  concerns: string[];
  rules: AppliedRule[];
  checks: string[];
  decisions: DecisionSummary[];
}

function firstLine(s: string): string {
  return (
    s
      .split("\n")
      .find((l) => l.trim())
      ?.trim() ?? ""
  );
}

function scopeOf(n: CapsuleNode): "tree" | "own" {
  return n.fields.find((f) => f.key === "scope")?.value === "own" ? "own" : "tree";
}

export function rulesForFile(m: FileMembership, capsules: Capsule[]): FileRules {
  const idx = buildIndex(capsules);
  const home = m.home;
  const parents = home
    ? ancestorsOf(home).filter((a) => idx.capsules.has(a))
    : idx.capsules.has("root")
      ? ["root"]
      : [];

  const contractsOf = (
    capId: string,
    filter: (n: CapsuleNode) => boolean,
    from: AppliedRule["from"],
  ) =>
    (idx.capsules.get(capId)?.nodes ?? [])
      .filter((n) => n.type === "contract" && filter(n))
      .map((n) => ({ address: address(capId, n.id), text: firstLine(n.prose), from }));

  const rules: AppliedRule[] = [
    ...(home ? contractsOf(home, () => true, "home") : []),
    ...parents.flatMap((p) => contractsOf(p, (n) => scopeOf(n) === "tree", "ancestor")),
    ...m.concerns.flatMap((c) => contractsOf(c, () => true, "concern")),
  ];

  // Checks: those linked from the applicable contracts and from examples that show them.
  const ruleSet = new Set(rules.map((r) => r.address));
  const checks: string[] = [];
  const addCheck = (a: string) => {
    if (idx.nodes.get(a)?.type === "check" && !checks.includes(a)) checks.push(a);
  };
  for (const r of rules) {
    const [capId] = r.address.split("#");
    for (const l of idx.nodes.get(r.address)?.links ?? [])
      if (l.type === "checked-by") addCheck(targetOf(l.ref, capId!));
  }
  for (const cap of capsules) {
    for (const n of cap.nodes) {
      if (n.type !== "example") continue;
      const shows = n.links.filter((l) => l.type === "shows").map((l) => targetOf(l.ref, cap.id));
      if (!shows.some((s) => ruleSet.has(s))) continue;
      for (const l of n.links) if (l.type === "checked-by") addCheck(targetOf(l.ref, cap.id));
    }
  }

  // Decisions in the home capsule and covering concerns that nothing supersedes.
  const superseded = new Set<string>();
  for (const cap of capsules)
    for (const n of cap.nodes)
      for (const l of n.links) if (l.type === "supersedes") superseded.add(targetOf(l.ref, cap.id));
  const decisions: DecisionSummary[] = [];
  for (const capId of [...(home ? [home] : []), ...m.concerns]) {
    for (const n of idx.capsules.get(capId)?.nodes ?? []) {
      const a = address(capId, n.id);
      if (n.type !== "decision" || superseded.has(a)) continue;
      decisions.push({
        address: a,
        text: firstLine(n.prose),
        rejected: n.fields.filter((f) => f.key === "rejected").map((f) => f.value),
      });
    }
  }

  return { home, parents, concerns: m.concerns, rules, checks, decisions };
}
