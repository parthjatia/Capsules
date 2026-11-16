// Which checks judge which capsules (C6.2), and which files are checks (C5.2). Light enough
// for the hooks (D-010): no Markdown, YAML or zod.
import picomatch from "picomatch";
import { address, type Capsule, type CapsuleNode, type CapsuleKind } from "./model.js";
import { targetOf } from "./resolve.js";

export function checkGlobs(n: CapsuleNode): string[] {
  return n.fields.filter((f) => f.key === "files").map((f) => f.value);
}

/** Every glob that marks a check file: `checks.files` plus each check node's `files`. */
export function checkFileMatcher(
  checkFiles: string[],
  capsules: Capsule[],
): (path: string) => boolean {
  const globs = [
    ...checkFiles,
    ...capsules.flatMap((c) =>
      c.nodes.filter((n) => n.type === "check").flatMap((n) => checkGlobs(n)),
    ),
  ];
  const tests = globs.map((g) => picomatch(g, { dot: true }));
  return (p) => tests.some((t) => t(p));
}

/** Which capsules each check node judges: its own, plus those whose rules are `checked-by` it. */
export function checkJudges(capsules: Capsule[]): Map<string, Set<string>> {
  const judges = new Map<string, Set<string>>();
  for (const c of capsules)
    for (const n of c.nodes)
      if (n.type === "check") judges.set(address(c.id, n.id), new Set([c.id]));
  for (const c of capsules)
    for (const n of c.nodes)
      for (const l of n.links)
        if (l.type === "checked-by") judges.get(targetOf(l.ref, c.id))?.add(c.id);
  return judges;
}

/**
 * The capsules an existing check file judges (C6.2 V1): its home and concerns, plus every
 * capsule judged by a check node whose `files` match it.
 */
export function capsulesJudgedByFile(
  path: string,
  homeAndConcerns: string[],
  capsules: Capsule[],
): string[] {
  const judges = checkJudges(capsules);
  const out = new Set(homeAndConcerns);
  for (const c of capsules)
    for (const n of c.nodes) {
      if (n.type !== "check") continue;
      const globs = checkGlobs(n);
      if (globs.length && picomatch.isMatch(path, globs, { dot: true }))
        for (const x of judges.get(address(c.id, n.id)) ?? []) out.add(x);
    }
  return [...out].sort();
}

/** The contracts and examples a node serves, through `serves` and `shows` (C6.2 V2). */
export function intentsServed(n: CapsuleNode, capsules: Capsule[]): string[] {
  const nodeAt = new Map<string, CapsuleNode>();
  for (const c of capsules) for (const x of c.nodes) nodeAt.set(address(c.id, x.id), x);
  const served = (x: CapsuleNode): string[] => {
    if (x.type === "contract")
      return x.links.filter((l) => l.type === "serves").map((l) => targetOf(l.ref, x.capsule));
    if (x.type !== "example") return [];
    return x.links
      .filter((l) => l.type === "shows")
      .flatMap((l) => {
        const contract = nodeAt.get(targetOf(l.ref, x.capsule));
        return contract ? served(contract) : [];
      });
  };
  return served(n);
}

const ID_PART = /^[a-z0-9-]+$/;

/** The capsule a `.capsules/` path defines (C1), or null if it isn't a capsule file. */
export function capsuleFromPath(path: string): { id: string; kind: CapsuleKind } | null {
  if (!path.startsWith(".capsules/") || !path.endsWith(".md")) return null;
  const parts = path.slice(".capsules/".length, -".md".length).split("/");
  if (parts[0] === "_concerns")
    return parts.length === 2 && ID_PART.test(parts[1]!)
      ? { id: parts[1]!, kind: "concern" }
      : null;
  if (parts.some((p) => !ID_PART.test(p))) return null;
  if (parts[0] === "root") return parts.length === 1 ? { id: "root", kind: "area" } : null;
  return { id: parts.join("."), kind: "area" };
}
