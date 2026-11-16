// Core types for capsules, nodes, links and addresses (C2).

export const NODE_TYPES = [
  "intent",
  "contract",
  "example",
  "check",
  "decision",
  "assumption",
  "context",
  "prompt",
  "code",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const LINK_TYPES = [
  "serves",
  "checked-by",
  "shows",
  "implements",
  "uses",
  "assumes",
  "derived-from",
  "supersedes",
] as const;
export type LinkType = (typeof LINK_TYPES)[number];

/** A reference as written: `@C1` (same capsule) or `@billing#C1`. */
export interface Ref {
  raw: string;
  /** null means "the capsule this ref is written in". */
  capsule: string | null;
  node: string;
  line: number;
}

export interface Link {
  type: LinkType;
  ref: Ref;
  /** Where the link was written. Transclusions count as implicit `uses` links (C2.5). */
  via: "heading" | "field" | "transclusion";
}

export interface Field {
  key: string;
  value: string;
  line: number;
}

export interface CapsuleNode {
  type: NodeType;
  id: string;
  capsule: string;
  /** Line of the `##` heading (1-based). */
  line: number;
  /** The heading text after `## `, as written. */
  heading: string;
  links: Link[];
  fields: Field[];
  /** All body lines (fields and prose), as written, without the heading. */
  body: string;
  /** Body without field lines, trimmed. */
  prose: string;
}

export interface FrontMatter {
  title: string;
  owners: string[] | null;
  covers: string[];
  excludes: string[];
  status: "active" | "draft";
}

export type CapsuleKind = "area" | "concern";

export interface Capsule {
  id: string;
  kind: CapsuleKind;
  /** Project-relative path with `/` separators, e.g. `.capsules/billing/invoices.md`. */
  file: string;
  /** null if the front matter was missing or invalid (an E008 was reported). */
  front: FrontMatter | null;
  nodes: CapsuleNode[];
  /** Parent area id; null for `root` and for concerns. */
  parent: string | null;
}

export function address(capsule: string, node: string): string {
  return `${capsule}#${node}`;
}

export function depth(areaId: string): number {
  return areaId === "root" ? 0 : areaId.split(".").length;
}

/** True if `a` is a strict ancestor of area `b`. `root` is the ancestor of every other area. */
export function isAncestor(a: string, b: string): boolean {
  if (a === b) return false;
  if (a === "root") return true;
  return b.startsWith(a + ".");
}

/** Ancestors of an area, nearest first, ending with `root`. */
export function ancestorsOf(areaId: string): string[] {
  if (areaId === "root") return [];
  const parts = areaId.split(".");
  const out: string[] = [];
  for (let i = parts.length - 1; i >= 1; i--) out.push(parts.slice(0, i).join("."));
  out.push("root");
  return out;
}
