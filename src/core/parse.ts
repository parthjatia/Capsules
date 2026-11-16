// Parse one capsule file: YAML front matter, then one `##` heading per node (C2).
// This step reads a single file; links between capsules are checked in resolve.ts.
import type { Root, RootContent } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parseDocument } from "yaml";
import { z } from "zod";
import { CAPSULE_ID_RE, parseAddress } from "./address.js";
import {
  LINK_TYPES,
  NODE_TYPES,
  type Capsule,
  type CapsuleKind,
  type CapsuleNode,
  type Field,
  type FrontMatter,
  type Link,
  type LinkType,
  type NodeType,
  type Ref,
} from "./model.js";
import { msg, type Diagnostic } from "../report/messages.js";

// --- Node type rules (C2.3) ------------------------------------------------------------

interface TypeRule {
  id: RegExp;
  idHint: string;
  /** Link types this node type may have in its heading. */
  links: LinkType[];
  /** Field keys valid for this type; `true` means repeatable. */
  fields: Record<string, boolean>;
}

const NUMBERED = (letter: string) => ({
  id: new RegExp(`^${letter}[1-9][0-9]*$`),
  idHint: `${letter}<n>, e.g. ${letter}1`,
});
const SLUG = { id: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, idHint: "a lowercase slug, e.g. no-duplicates" };

export const TYPE_RULES: Record<NodeType, TypeRule> = {
  intent: { ...NUMBERED("I"), links: [], fields: {} },
  contract: {
    ...NUMBERED("C"),
    links: ["serves", "checked-by"],
    fields: { scope: false, "checked-by": true },
  },
  example: { ...NUMBERED("E"), links: ["shows", "checked-by"], fields: { "checked-by": true } },
  check: { ...SLUG, links: [], fields: { run: false, files: true, timeout: false, cwd: false } },
  decision: {
    ...NUMBERED("D"),
    links: ["serves", "supersedes", "assumes"],
    fields: { rejected: true },
  },
  assumption: { ...NUMBERED("A"), links: [], fields: { tripwire: false, "review-by": false } },
  context: { ...SLUG, links: ["uses", "derived-from"], fields: {} },
  prompt: { ...SLUG, links: ["uses"], fields: { file: false } },
  code: { ...SLUG, links: ["implements"], fields: {} },
};

// --- Front matter -----------------------------------------------------------------------

const globList = z.array(z.string().min(1));
const FrontSchema = z.strictObject({
  title: z.string().min(1),
  owners: z.array(z.string().min(1)).optional(),
  covers: globList.optional(),
  excludes: globList.optional(),
  status: z.enum(["active", "draft"]).optional(),
});

function describeZodIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => {
      const where = i.path.length ? `\`${i.path.join(".")}\`` : "front matter";
      if (i.code === "unrecognized_keys") {
        return `unknown key${i.keys.length > 1 ? "s" : ""} ${i.keys.map((k) => `\`${k}\``).join(", ")} (allowed: title, owners, covers, excludes, status)`;
      }
      if (i.path[0] === "title" && i.code === "invalid_type") return "`title` is required";
      if (i.path[0] === "status") return "`status` must be `active` or `draft`";
      return `${where}: ${i.message}`;
    })
    .join("; ");
}

// --- Parser -----------------------------------------------------------------------------

const processor = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]);
const FIELD_RE = /^([a-z][a-z-]*):\s*(.*?)\s*$/;
const TRANSCLUDE_RE = /\{\{\s*(@[^\s}]+)\s*\}\}/g;

export interface ParseResult {
  capsule: Capsule;
  diagnostics: Diagnostic[];
}

export function parseCapsuleFile(
  rawText: string,
  file: string,
  id: string,
  kind: CapsuleKind,
): ParseResult {
  const text = rawText.replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const diagnostics: Diagnostic[] = [];
  const tree = processor.parse(text) as Root;

  // Lines inside code blocks (fenced or indented) are never fields or headings (D-007).
  const codeLines = new Set<number>();
  walk(tree, (n) => {
    if (n.type === "code" && n.position) {
      for (let l = n.position.start.line; l <= n.position.end.line; l++) codeLines.add(l);
    }
  });

  // Front matter.
  let front: FrontMatter | null = null;
  const first = tree.children[0];
  if (first?.type === "yaml" && first.position?.start.line === 1) {
    front = readFront(first.value, file, kind, diagnostics);
  } else {
    diagnostics.push(
      msg.E008({ file, line: 1 }, "the file must start with a `---` front matter block"),
    );
  }

  // Node headings: ATX `##` at top level. `#` headings also end a node's body.
  const boundaries: { line: number; depth: number }[] = [];
  for (const child of tree.children) {
    if (child.type !== "heading" || !child.position) continue;
    const ln = child.position.start.line;
    if (!/^ {0,3}#/.test(lines[ln - 1] ?? "")) continue; // setext headings are body text
    if (child.depth <= 2) boundaries.push({ line: ln, depth: child.depth });
  }

  const nodes: CapsuleNode[] = [];
  const seen = new Map<string, number>();
  boundaries.forEach((b, i) => {
    if (b.depth !== 2) return;
    const end = (boundaries[i + 1]?.line ?? lines.length + 1) - 1;
    const node = readNode(lines, b.line, end, file, id, codeLines, diagnostics);
    if (!node) return;
    const prev = seen.get(node.id);
    if (prev !== undefined) {
      diagnostics.push(msg.E002({ file, line: node.line }, id, node.id, prev));
      return;
    }
    seen.set(node.id, node.line);
    nodes.push(node);
  });

  return {
    capsule: { id, kind, file, front, nodes, parent: parentOf(id, kind) },
    diagnostics,
  };
}

export function parentOf(id: string, kind: CapsuleKind): string | null {
  if (kind === "concern" || id === "root") return null;
  const dot = id.lastIndexOf(".");
  return dot < 0 ? "root" : id.slice(0, dot);
}

function readFront(
  yamlText: string,
  file: string,
  kind: CapsuleKind,
  diagnostics: Diagnostic[],
): FrontMatter | null {
  const doc = parseDocument(yamlText);
  if (doc.errors.length) {
    const e = doc.errors[0]!;
    const line = (e.linePos?.[0]?.line ?? 0) + 1; // +1 for the opening `---`
    diagnostics.push(
      msg.E008({ file, line }, `the YAML can't be read (${e.message.split("\n")[0]})`),
    );
    return null;
  }
  const parsed = FrontSchema.safeParse(doc.toJS() ?? {});
  if (!parsed.success) {
    diagnostics.push(msg.E008({ file, line: 1 }, describeZodIssues(parsed.error)));
    return null;
  }
  const fm = parsed.data;
  const covers = fm.covers ?? [];
  const excludes = fm.excludes ?? [];
  for (const g of [...covers, ...excludes]) {
    if (g.includes("\\") || g.startsWith("/") || g.startsWith("./")) {
      diagnostics.push(
        msg.E008(
          { file, line: 1 },
          `glob "${g}" must be repo-relative with / separators (e.g. "src/billing/**")`,
        ),
      );
      return null;
    }
  }
  if (kind === "concern" && covers.length === 0) {
    diagnostics.push(
      msg.E008({ file, line: 1 }, "a concern capsule must list the files it covers in `covers`"),
    );
    return null;
  }
  return {
    title: fm.title,
    owners: fm.owners ?? null,
    covers,
    excludes,
    status: fm.status ?? "active",
  };
}

function readNode(
  lines: string[],
  headingLine: number,
  endLine: number,
  file: string,
  capsuleId: string,
  codeLines: Set<number>,
  diagnostics: Diagnostic[],
): CapsuleNode | null {
  const raw = lines[headingLine - 1] ?? "";
  const heading = raw
    .replace(/^ {0,3}##\s*/, "")
    .replace(/\s+#+\s*$/, "")
    .trim();
  const at = { file, line: headingLine };
  const tokens = heading
    .split(/\s+/)
    .flatMap((t) => t.split(","))
    .filter((t) => t.length > 0);

  const [type, id, ...rest] = tokens;
  if (!type) {
    diagnostics.push(msg.E001_badHeading(at, heading, "it is empty"));
    return null;
  }
  if (!(NODE_TYPES as readonly string[]).includes(type)) {
    diagnostics.push(msg.E001_unknownType(at, type));
    return null;
  }
  const nodeType = type as NodeType;
  const rule = TYPE_RULES[nodeType];
  if (!id) {
    diagnostics.push(msg.E001_badHeading(at, heading, "it has no id after the type"));
    return null;
  }
  if (!rule.id.test(id)) {
    diagnostics.push(msg.E001_badId(at, nodeType, id, rule.idHint));
    return null;
  }

  // Heading links: `<link-type> @ref, @ref <link-type> @ref ...`
  const links: Link[] = [];
  let current: LinkType | null = null;
  let skipping = false; // refs after a reported bad link word are not reported again
  for (const tok of rest) {
    if (tok.startsWith("@")) {
      if (skipping) continue;
      if (!current) {
        diagnostics.push(
          msg.E001_badHeading(at, heading, `reference ${tok} has no link type before it`),
        );
        continue;
      }
      const ref = readRef(tok, headingLine, file, diagnostics);
      if (ref) links.push({ type: current, ref, via: "heading" });
    } else if ((LINK_TYPES as readonly string[]).includes(tok)) {
      current = tok as LinkType;
      skipping = false;
      if (!rule.links.includes(current)) {
        diagnostics.push(msg.E006_notAllowedFrom(at, current, nodeType));
        current = null;
        skipping = true;
      }
    } else if (current) {
      // A word where a reference was expected, e.g. `serves I1` instead of `serves @I1`.
      diagnostics.push(msg.E003_malformed(at, tok));
    } else {
      diagnostics.push(msg.E006_unknownLink(at, tok));
      skipping = true;
    }
  }

  // Body: fields (valid keys only, outside code blocks) and prose (D-007).
  const fields: Field[] = [];
  const proseLines: string[] = [];
  const bodyLines: string[] = [];
  const firstSeen = new Map<string, number>();
  for (let ln = headingLine + 1; ln <= endLine; ln++) {
    const line = lines[ln - 1] ?? "";
    bodyLines.push(line);
    const m = codeLines.has(ln) ? null : FIELD_RE.exec(line);
    const key = m?.[1];
    if (m && key !== undefined && key in rule.fields) {
      const value = m[2] ?? "";
      const repeatable = rule.fields[key];
      const prev = firstSeen.get(key);
      if (prev !== undefined && !repeatable) {
        diagnostics.push(msg.E007_repeated({ file, line: ln }, key, prev));
        continue;
      }
      firstSeen.set(key, ln);
      fields.push({ key, value, line: ln });
      if (key === "checked-by") {
        for (const part of value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)) {
          const ref = readRef(part, ln, file, diagnostics);
          if (ref) links.push({ type: "checked-by", ref, via: "field" });
        }
      }
      continue;
    }
    proseLines.push(line);
  }

  // Transclusions in context nodes are implicit `uses` links (C2.5).
  if (nodeType === "context") {
    for (let ln = headingLine + 1; ln <= endLine; ln++) {
      if (codeLines.has(ln)) continue;
      for (const m of (lines[ln - 1] ?? "").matchAll(TRANSCLUDE_RE)) {
        const ref = readRef(m[1]!, ln, file, diagnostics);
        if (ref) links.push({ type: "uses", ref, via: "transclusion" });
      }
    }
  }

  const node: CapsuleNode = {
    type: nodeType,
    id,
    capsule: capsuleId,
    line: headingLine,
    heading,
    links,
    fields,
    body: trimBlankLines(bodyLines).join("\n"),
    prose: trimBlankLines(proseLines).join("\n"),
  };
  checkFields(node, file, diagnostics);
  return node;
}

function readRef(text: string, line: number, file: string, diagnostics: Diagnostic[]): Ref | null {
  const p = parseAddress(text, { ref: true });
  if (p.ok) return { raw: text, capsule: p.capsule, node: p.node, line };
  if (p.reason === "cross-repo") diagnostics.push(msg.E015({ file, line }, text, p.repo));
  else diagnostics.push(msg.E003_malformed({ file, line }, text));
  return null;
}

function checkFields(node: CapsuleNode, file: string, diagnostics: Diagnostic[]): void {
  const at = { file, line: node.line };
  const get = (k: string) => node.fields.find((f) => f.key === k);
  const required = (k: string, hint: string) => {
    if (!get(k)) diagnostics.push(msg.E007_missing(at, node.type, node.id, k, hint));
  };
  switch (node.type) {
    case "check":
      required("run", "a check without a `run` command can't prove anything.");
      break;
    case "prompt":
      required(
        "file",
        "a prompt node must point to the prompt file the app uses, so changes to it are tracked.",
      );
      break;
    case "example":
      if (!node.links.some((l) => l.type === "shows"))
        diagnostics.push(msg.E007_noShows(at, node.id));
      break;
  }
  const scope = get("scope");
  if (scope && scope.value !== "tree" && scope.value !== "own") {
    diagnostics.push(
      msg.E007_invalid({ file, line: scope.line }, "scope", scope.value, "`tree` or `own`"),
    );
  }
  const timeout = get("timeout");
  if (timeout && !/^[1-9][0-9]*$/.test(timeout.value)) {
    diagnostics.push(
      msg.E007_invalid(
        { file, line: timeout.line },
        "timeout",
        timeout.value,
        "a whole number of seconds, e.g. `120`",
      ),
    );
  }
  const review = get("review-by");
  if (review && !isIsoDate(review.value)) {
    diagnostics.push(
      msg.E007_invalid(
        { file, line: review.line },
        "review-by",
        review.value,
        "a date like `2027-06-01`",
      ),
    );
  }
  const tripwire = get("tripwire");
  if (tripwire) {
    const p = parseAddress(tripwire.value, { ref: true });
    if (!p.ok && p.reason === "cross-repo")
      diagnostics.push(msg.E015({ file, line: tripwire.line }, tripwire.value, p.repo));
    else if (!p.ok)
      diagnostics.push(msg.E003_malformed({ file, line: tripwire.line }, tripwire.value));
  }
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function trimBlankLines(ls: string[]): string[] {
  let a = 0;
  let b = ls.length;
  while (a < b && ls[a]!.trim() === "") a++;
  while (b > a && ls[b - 1]!.trim() === "") b--;
  return ls.slice(a, b);
}

function walk(node: Root | RootContent, visit: (n: Root | RootContent) => void): void {
  visit(node);
  if ("children" in node) for (const c of node.children) walk(c, visit);
}

export function isValidCapsuleId(id: string): boolean {
  return CAPSULE_ID_RE.test(id);
}
