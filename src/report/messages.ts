// Every user-facing diagnostic lives here (F2). Each one says: what is wrong, where,
// why it matters, and the exact fix, in plain English.

export type Severity = "error" | "warning";

export interface Diagnostic {
  code: string;
  severity: Severity;
  /** Project-relative path with `/` separators. */
  file?: string;
  line?: number;
  message: string;
  why: string;
  fix: string;
}

export interface At {
  file?: string;
  line?: number;
}

function make(code: string, at: At, message: string, why: string, fix: string): Diagnostic {
  const severity: Severity = code.startsWith("W") ? "warning" : "error";
  const d: Diagnostic = { code, severity, message, why, fix };
  if (at.file !== undefined) d.file = at.file;
  if (at.line !== undefined) d.line = at.line;
  return d;
}

const NODE_TYPE_LIST =
  "intent, contract, example, check, decision, assumption, context, prompt, code";

export const msg = {
  E001_unknownType: (at: At, type: string) =>
    make(
      "E001",
      at,
      `Unknown node type "${type}".`,
      "capsules only understands its nine node types, so this section would be silently ignored.",
      `Start the heading with one of: ${NODE_TYPE_LIST}. For example: "## contract C1 serves @I1".`,
    ),
  E016: (at: At, heading: string, problem: string) =>
    make(
      "E016",
      at,
      `Heading "## ${heading}" can't be read: ${problem}.`,
      "a node whose heading can't be read has no address, so nothing can link to it or check it.",
      'Use the form "## <type> <id> <link-type> @<ref>", for example "## decision D2 serves @C1".',
    ),
  E017: (at: At, type: string, id: string, expected: string) =>
    make(
      "E017",
      at,
      `"${id}" is not a valid id for a ${type} node (expected ${expected}).`,
      "ids follow a fixed format so addresses like billing#C1 are unambiguous.",
      `Rename it to match ${expected}, for example "## ${type} ${exampleId(type)}".`,
    ),
  E002: (at: At, capsule: string, id: string, firstLine: number) =>
    make(
      "E002",
      at,
      `Node id "${id}" is used twice in capsule ${capsule} (first on line ${firstLine}).`,
      `the address ${capsule}#${id} must point to exactly one node.`,
      "Give one of them a new id. If it replaces an old decision, add a new decision that `supersedes` it.",
    ),
  E003: (at: At, ref: string, detail: string) =>
    make(
      "E003",
      at,
      `Reference ${ref} points to nothing: ${detail}.`,
      "a broken link means a rule, check or decision is no longer connected to what it protects.",
      "Fix the spelling, or point it at an existing node. `capsules explain <file>` lists the addresses in use.",
    ),
  E025: (at: At, ref: string) =>
    make(
      "E025",
      at,
      `"${ref}" is not a valid reference.`,
      "a reference that can't be read points to nothing.",
      'Write "@<node-id>" for this capsule, or "@<capsule-id>#<node-id>" for another one, e.g. "@billing#C1".',
    ),
  E004: (at: At, file: string, capsules: string[]) =>
    make(
      "E004",
      at,
      `${file} has more than one home capsule: ${capsules.join(", ")}.`,
      "every file needs exactly one home, so it's clear whose rules and owners apply to it.",
      "Narrow one capsule's `covers`, add the file to its `excludes`, or nest one capsule inside the other. If it is a cross-cutting rule, use a concern capsule in .capsules/_concerns/ instead.",
    ),
  E005: (at: At, linkType: string, cycle: string[]) =>
    make(
      "E005",
      at,
      `\`${linkType}\` links form a loop: ${cycle.join(" -> ")}.`,
      `${linkType === "supersedes" ? "a decision can't replace itself" : "knowledge can't be derived from itself"}, so the history becomes meaningless.`,
      `Remove one of the \`${linkType}\` links in the loop.`,
    ),
  E006: (at: At, linkType: string, fromType: string, toType: string, allowed: string) =>
    make(
      "E006",
      at,
      `A \`${linkType}\` link can't go from a ${fromType} to a ${toType}.`,
      "each link type means one specific thing, and capsules relies on that to find stale and unchecked rules.",
      `\`${linkType}\` links are allowed ${allowed}.`,
    ),
  E024: (at: At, word: string) =>
    make(
      "E024",
      at,
      `"${word}" is not a link type.`,
      "unknown link words are ambiguous and would be ignored.",
      "Use one of: serves, checked-by, shows, implements, uses, assumes, derived-from, supersedes.",
    ),
  E006_notAllowedFrom: (at: At, linkType: string, fromType: string) =>
    make(
      "E006",
      at,
      `A ${fromType} node can't have a \`${linkType}\` link.`,
      "each node type allows only certain links (C2.3).",
      `Remove the \`${linkType}\` link from this ${fromType}.`,
    ),
  E007_missing: (at: At, type: string, id: string, field: string, hint: string) =>
    make(
      "E007",
      at,
      `${type} ${id} is missing its required \`${field}\`.`,
      hint,
      `Add a line "${field}: ..." to the node body.`,
    ),
  E007_noShows: (at: At, id: string) =>
    make(
      "E007",
      at,
      `example ${id} doesn't say which contract it shows.`,
      "an example only means something next to the rule it illustrates; it's what owners approve.",
      `Add the link to the heading: "## example ${id} shows @C1".`,
    ),
  E019: (at: At, field: string, value: string, expected: string) =>
    make(
      "E019",
      at,
      `\`${field}: ${value}\` is not valid (expected ${expected}).`,
      "capsules can't use a field value it can't read.",
      `Change it to ${expected}.`,
    ),
  E018: (at: At, field: string, firstLine: number) =>
    make(
      "E018",
      at,
      `\`${field}\` appears more than once (first on line ${firstLine}).`,
      "this field holds one value, so a second one makes it unclear which applies.",
      `Keep one \`${field}:\` line.`,
    ),
  E008: (at: At, problem: string) =>
    make(
      "E008",
      at,
      `Front matter is invalid: ${problem}.`,
      "the front matter says which files the capsule covers and who owns it; without it the capsule can't protect anything.",
      'Start the file with a "---" block, e.g. "---\\ntitle: Billing\\ncovers:\\n  - src/billing/**\\n---".',
    ),
  E022: (at: At, problem: string) =>
    make(
      "E022",
      at,
      `Settings file is invalid: ${problem}.`,
      "capsules can't apply settings it can't read, and guessing could weaken protection.",
      "Fix the value, or delete the key to use the default (see docs/SPEC.md, C4 and C5).",
    ),
  E012: (at: At, id: string, areaFile: string) =>
    make(
      "E012",
      at,
      `Concern "${id}" has the same id as the top-level area capsule in ${areaFile}.`,
      `the address ${id}#C1 would be ambiguous.`,
      `Rename the concern file, for example .capsules/_concerns/${id}-rules.md.`,
    ),
  E013: (at: At, folder: string, expectedFile: string) =>
    make(
      "E013",
      at,
      `Folder ${folder}/ has no capsule file ${expectedFile}.`,
      "capsules nested in that folder would have no parent, so their place in the tree is unclear.",
      `Create ${expectedFile} with a title and covers, or move the nested capsules up.`,
    ),
  E014: (at: At, id: string) =>
    make(
      "E014",
      at,
      `Concern "${id}" covers no tracked files.`,
      "a concern that covers nothing protects nothing; its covers patterns are probably wrong.",
      "Fix the `covers` patterns so they match files listed by `git ls-files`.",
    ),
  E015: (at: At, ref: string, repo: string) =>
    make(
      "E015",
      at,
      `${ref} is a cross-repo address (repo "${repo}"). Cross-repo links are not supported yet in v0.1.`,
      "the `<repo>:` prefix is reserved so cross-repo links can be added later without breaking files.",
      "Point to a capsule in this repo, or remove the link until cross-repo links ship.",
    ),
  E020: (at: At, stem: string) =>
    make(
      "E020",
      at,
      `The file name "${stem}" is not a valid capsule id.`,
      "a capsule's id comes from its file name, and every address (like billing#C1) depends on it.",
      "Rename the file using lowercase letters, digits and -. Nest capsules with folders, not dots: .capsules/billing/invoices.md.",
    ),
  E021: (at: At, owner: string) =>
    make(
      "E021",
      at,
      `Owner "${owner}" is not listed under \`humans\` in .capsules/permissions.yaml.`,
      "only listed humans can approve changes; an unknown owner means nobody can.",
      `Add "${owner}" under \`humans\` in .capsules/permissions.yaml, or fix the spelling in \`owners\`.`,
    ),
  E023: (at: At) =>
    make(
      "E023",
      at,
      "The root capsule .capsules/root.md is missing.",
      "every area capsule nests under root, so without it the tree has no top.",
      'Create .capsules/root.md with front matter, e.g. "---\\ntitle: My app\\n---", and an intent describing the whole product.',
    ),
  W101: (file: string) =>
    make(
      "W101",
      { file },
      `${file} has no home capsule (orphan).`,
      "nobody has said what this file is for, so agents have no rules for it. It is treated as part of root.",
      "Add it to a capsule's `covers`, or to `ignore` in .capsules/config.yaml if it needs no capsule.",
    ),
  W102: (at: At, addr: string) =>
    make(
      "W102",
      at,
      `Contract ${addr} has no \`serves\` intent.`,
      "a rule without a reason is hard to judge and easy to delete.",
      `Link it to the intent it protects, e.g. "## contract ... serves @I1".`,
    ),
  W103: (at: At, kind: string, addr: string) =>
    make(
      "W103",
      at,
      `${kind === "contract" ? "Contract" : "Example"} ${addr} has no check.`,
      "nothing proves it still holds, so it can break silently.",
      'Add "checked-by: @<check-id>" pointing to a check node with a real test command.',
    ),
  W105: (at: At, addr: string, date: string) =>
    make(
      "W105",
      at,
      `Assumption ${addr} was due for review on ${date}.`,
      "decisions that rest on it may no longer be right.",
      "Confirm it and move `review-by` forward, or add a new decision that supersedes the ones assuming it.",
    ),
  W106: (at: At, addr: string, path: string) =>
    make(
      "W106",
      at,
      `Code node ${addr} points to ${path}, which does not exist.`,
      "the link from the rule to the code that implements it is broken.",
      "Update the path, or remove the line if the code was deleted.",
    ),
};

export function exampleId(type: string): string {
  switch (type) {
    case "intent":
      return "I1";
    case "contract":
      return "C1";
    case "example":
      return "E1";
    case "decision":
      return "D1";
    case "assumption":
      return "A1";
    default:
      return "my-" + type;
  }
}

/** Generic errors that are not tied to a validation code. */
export const errors = {
  notGitRepo: (cwd: string) =>
    `capsules must run inside a Git repository, and ${cwd} is not in one.\n  fix: run it from your project folder, or run \`git init\` first.`,
  noCapsulesFolder: (cwd: string) =>
    `No .capsules/ folder found in ${cwd} or any parent folder up to the Git repository root.\n  fix: run capsules from your project, or create .capsules/ (\`capsules init\` arrives in M4).`,
  outsideProject: (path: string, root: string) =>
    `${path} is outside the project at ${root}.\n  fix: pass a path inside the project.`,
  gitFailed: (args: string, stderr: string) =>
    `git ${args} failed: ${stderr.trim()}\n  fix: check that git is installed and the repository is not corrupted.`,
};
