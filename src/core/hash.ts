// The frozen hash pipeline (C7.1, B11, D-012). Changing anything here changes every
// fingerprint in every user's lockfile, so test/unit/hash.test.ts pins exact values.
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { address, type CapsuleNode } from "./model.js";
import { targetOf } from "./resolve.js";

export const HASH_LENGTH = 12;

export function sha12(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, HASH_LENGTH);
}

/** C7.1 step 2: LF, NFC, no trailing whitespace, no leading/trailing blank lines, single blank lines. */
export function normaliseText(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .normalize("NFC")
    .split("\n")
    .map((l) => l.replace(/\s+$/u, "")); // ECMAScript whitespace, incl. Unicode spaces
  const out: string[] = [];
  for (const l of lines) {
    if (l === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(l);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/** C7.1 step 1: the canonical text of a node. */
export function canonicalNodeText(node: CapsuleNode): string {
  const links = node.links
    .map((l) => ({ type: l.type, target: targetOf(l.ref, node.capsule) }))
    .sort((a, b) => cmp(a.type, b.type) || cmp(a.target, b.target))
    .map((l) => `${l.type} ${l.target}`);
  return normaliseText([`${node.type} ${node.id}`, ...links, "---", node.body].join("\n"));
}

export function nodeHash(node: CapsuleNode): string {
  return sha12(canonicalNodeText(node));
}

export function nodeAddress(node: CapsuleNode): string {
  return address(node.capsule, node.id);
}

/** C7.1 step 5 (D-012): SHA-256 of the RFC 8785 form of the parsed front matter. */
export function capsuleHash(frontMatterYaml: string): string {
  const text = frontMatterYaml.replace(/\r\n?/g, "\n").normalize("NFC");
  const value: unknown = parseYaml(text, { version: "1.2" }) ?? {};
  return sha12(jcs(value));
}

/** JSON Canonicalization Scheme, RFC 8785. */
export function jcs(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error("RFC 8785: numbers must be finite");
      // ECMAScript Number-to-String is exactly what RFC 8785 requires; -0 becomes 0.
      return JSON.stringify(value);
    case "string":
      // RFC 8785 string serialisation is ECMAScript's JSON.stringify.
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
      const obj = value as Record<string, unknown>;
      // Default string sort compares UTF-16 code units, as RFC 8785 section 3.2.3 requires.
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs(obj[k])}`).join(",")}}`;
    }
    default:
      throw new Error(`RFC 8785: can't serialise a ${typeof value}`);
  }
}

/** C7.1 step 4: shortest unique prefix of at least 4 characters, like Git. */
export function shortestPrefixes(hashes: string[]): Map<string, string> {
  const unique = [...new Set(hashes)];
  const out = new Map<string, string>();
  for (const h of unique) {
    let n = 4;
    while (n < h.length && unique.some((o) => o !== h && o.startsWith(h.slice(0, n)))) n++;
    out.set(h, h.slice(0, n));
  }
  return out;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
