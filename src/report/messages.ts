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
  E010: (changes: string[], more: number, missing: boolean) =>
    make(
      "E010",
      { file: ".capsules/capsules.lock" },
      missing
        ? "There is no lockfile yet (.capsules/capsules.lock)."
        : `The lockfile is out of date: ${changes.join("; ")}${more ? `; and ${more} more` : ""}.`,
      "the lockfile records each rule's fingerprint, which is how capsules notices when something that others depend on has changed.",
      "Run `capsules lock` and commit .capsules/capsules.lock. (`lock` never hides staleness: links stay flagged until someone reviews them.)",
    ),
  E026: (at: At, line: string) =>
    make(
      "E026",
      at,
      `This lockfile line can't be read: "${line.trim()}".`,
      "the lockfile is written by capsules; a damaged line means pinned fingerprints may be lost.",
      "Undo the hand edit (e.g. `git checkout .capsules/capsules.lock`), or delete the file and run `capsules lock`. Deleting it re-pins every link, which clears all staleness, so review stale links first.",
    ),
  W104: (at: At, from: string, linkType: string, to: string, pinned: string, now: string) =>
    make(
      "W104",
      at,
      `Stale link: ${from} ${linkType} ${to}, but ${to} has changed since this link was confirmed (${pinned} -> ${now}).`,
      `${from} was written against an older version of ${to}, so it may no longer be right.`,
      `Review ${from}. If it still holds, run \`capsules refresh ${from}\`. If the change to ${to} was only cosmetic (a typo), an owner runs \`capsules relock --cosmetic ${to}\`.`,
    ),
  W109: (at: At, addr: string, path: string) =>
    make(
      "W109",
      at,
      `Prompt node ${addr} points to ${path}, which does not exist.`,
      "capsules can't track changes to a prompt file it can't find.",
      "Fix the `file:` path, or remove the prompt node if the prompt was deleted.",
    ),
  W110: (at: At, addr: string, path: string, linked: string[]) =>
    make(
      "W110",
      at,
      `Stale prompt: ${path} (prompt node ${addr}) changed since it was locked.`,
      "the app's behaviour depends on this prompt, so the rules about it may need re-checking.",
      `Re-check ${linked.length ? linked.join(", ") : "the contracts this prompt serves"}, then run \`capsules lock\` to record the new version.`,
    ),
  E009: (at: At, addr: string, how: "edited" | "deleted") =>
    make(
      "E009",
      at,
      `Decision ${addr} was ${how}. Decisions are append-only.`,
      "a decision records why things are built this way; rewriting it erases the history that people and agents rely on.",
      `Put ${addr} back as it was, and add a new decision that replaces it, e.g. "## decision D<n> supersedes @${addr.split("#")[1]}".`,
    ),
  E027: (
    unit: string,
    actor: string,
    capsule: string,
    action: string,
    reason: string,
    changed: string[],
    unknownHuman: boolean,
  ) =>
    make(
      "E027",
      {},
      `${unit}, by ${actor}: ${action} in ${capsule} is not allowed (${reason}).\n  changed: ${changed.join("\n           ")}`,
      "permissions.yaml says who may change what, so an agent can't edit parts of the app it has no business touching.",
      `Have someone allowed make this change (an owner of ${capsule}, or an agent whose role and scope include ${action}), or ask an owner to change permissions.yaml.` +
        (unknownHuman
          ? " If you are listed under humans in permissions.yaml, commit with your GitHub noreply address, or add this email to your `emails` list."
          : ""),
    ),
  E028: (capsules: string[], unit: string, code: string[], checks: string[]) =>
    make(
      "E028",
      {},
      [
        "One change touched both code and an existing check that judges it.",
        `  ${capsules.length > 1 ? "capsules:" : "capsule:"} ${capsules.join(", ")}`,
        `  change:  ${unit}`,
        `  code:    ${code.join("\n           ")}`,
        `  check:   ${checks.join("\n           ")}`,
      ].join("\n"),
      "an agent could make a test pass by weakening the test.",
      "put the test change in its own commit from a separate session, and ask an owner to approve it.",
    ),
  E029: (capsule: string, unit: string, rules: string[], intents: string[]) =>
    make(
      "E029",
      {},
      [
        "One change touched both a rule and the intent it serves.",
        `  capsule: ${capsule}`,
        `  change:  ${unit}`,
        `  rule:    ${rules.join(", ")}`,
        `  intent:  ${intents.join(", ")}`,
      ].join("\n"),
      "a rule can be made to fit by quietly rewriting the reason it exists, and no one would see the drift.",
      "change the intent in its own commit and have an owner approve it, then change the rule in a separate commit.",
    ),
  E030: (commit: string, addr: string, who: string, owners: string[]) =>
    make(
      "E030",
      {},
      `${commit} carries "Capsule-Cosmetic: ${addr}", but ${who} doesn't own ${addr.split("#")[0]}.`,
      "a cosmetic mark clears every stale link to a node without review, so only an owner may declare it.",
      `Ask an owner of ${addr.split("#")[0]} (${owners.join(", ") || "none listed"}) to make that change, or remove the trailer and review each stale item with \`capsules refresh\`.`,
    ),
  E031: (at: At, addr: string, run: string, exit: string, output: string) =>
    make(
      "E031",
      at,
      `Check ${addr} failed (${exit}): ${run}${output ? `\n  output (last lines):\n${output}` : ""}`,
      "this check proves a contract, so the contract may be broken.",
      `Fix the code so the check passes. Run it yourself with: ${run}`,
    ),
  E032: (at: At, addr: string, run: string, seconds: number) =>
    make(
      "E032",
      at,
      `Check ${addr} timed out after ${seconds} seconds: ${run}`,
      "a check that never finishes proves nothing, and can hide a hang in the code.",
      "Make the check faster, or raise its limit with a `timeout:` field (seconds) or `checks.timeout-seconds` in config.yaml.",
    ),
  W107: (at: At, file: string, what: string) =>
    make(
      "W107",
      at,
      `Weakened-test signal in ${file}: ${what}.`,
      "removing assertions, skipping tests or deleting a test can make broken code look green.",
      "If this was intended, say why in the pull request and have an owner approve the test change. Otherwise restore the test.",
    ),
  W108: (unit: string, capsule: string, owners: string[], changed: string[]) =>
    make(
      "W108",
      {},
      `${unit} changes ${capsule}, which needs approval from an owner (${owners.join(", ") || "none listed"}).\n  changed: ${changed.join("\n           ")}`,
      "intents, contracts and examples are what humans approve; an owner must see changes to them.",
      `Make sure an owner of ${capsule} approves the pull request. GitHub enforces this through CODEOWNERS and branch protection (capsules never contacts GitHub).`,
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
  relockNeedsCosmetic: () =>
    "relock only declares a change cosmetic, so it needs --cosmetic.\n  fix: run `capsules relock --cosmetic <address>`, e.g. `capsules relock --cosmetic billing#C1`. To re-pin links after reviewing them, use `capsules refresh <address>`.",
  crossRepoArg: (addr: string, repo: string) =>
    `E015  ${addr} is a cross-repo address (repo "${repo}"). Cross-repo links are not supported yet in v0.1.\n  fix: use an address in this repo, like billing#C1.`,
  badAddressArg: (addr: string) =>
    `"${addr}" is not an address.\n  fix: write <capsule>#<node>, for example billing.invoices#C1.`,
  unknownAddressArg: (addr: string) =>
    `There is no node ${addr}.\n  fix: check the spelling; \`capsules explain <file>\` lists the addresses in use.`,
  badBase: (ref: string) =>
    `--base ${ref} doesn't name a commit in this repository.
  fix: use a branch, tag or commit that exists, e.g. --base main. If it only exists on the remote, run \`git fetch\` first.`,
  contextFor: (v: string) =>
    `--for must be builder or judge, not "${v}".\n  fix: use --for builder (the default) or --for judge.`,
  contextBudget: (v: string) =>
    `--budget must be a whole number of tokens, not "${v}".\n  fix: e.g. --budget 4000 (about 16,000 characters).`,
  contextNeedsTarget: () =>
    "capsules context needs a capsule or a file, e.g. `capsules context billing.invoices` or `capsules context src/web/checkout.tsx`.\n  fix: name one, or use --for judge to get the judge's input for the whole change.",
  contextUnknown: (t: string, ids: string[]) =>
    `"${t}" is neither a capsule nor a file in this project.\n  fix: use a file path, or one of: ${ids.join(", ")}.`,
  verdictUnreadable: (f: string, why: string) =>
    `Can't read the verdict file ${f}: ${why}\n  fix: pass a file holding the judge's JSON, e.g. capsules verdict record --file .capsules/_cache/verdict.json.`,
  verdictInvalid: (f: string, issues: string[]) =>
    `The verdict in ${f} doesn't match the verdict format (C13):\n${issues.map((i) => `    ${i}`).join("\n")}\n  fix: ask the judge again; it must answer with only the JSON from its instructions.`,
  verdictNoCommit: (c: string) =>
    `"${c}" doesn't name a commit in this repository.\n  fix: use a commit that exists, e.g. HEAD.`,
  verdictUnknownContracts: (a: string[]) =>
    `The verdict names rules that don't exist here: ${a.join(", ")}.\n  fix: judge only the contracts listed by \`capsules context --for judge\`.`,
  badAgentKind: (a: string, known: string[]) =>
    `"${a}" is not an agent capsules knows.\n  fix: use one or more of: ${known.join(", ")}, separated by commas.`,
  initNeedsConfirm: () =>
    "Nothing was changed. This isn't an interactive terminal, so capsules can't ask.\n  fix: read the plan above, then run the same command with --yes.",
  workNeedsPattern: () =>
    "capsules work needs the capsules to work on, e.g. `capsules work billing.invoices` or `capsules work 'billing.**'`.\n  fix: name a capsule or pattern, or use `capsules work --end` to end the current session.",
  workUnknownAgent: (agent: string, known: string[]) =>
    `${agent} is not listed under agents in .capsules/permissions.yaml.\n  fix: use one of: ${known.join(", ")}.`,
  workNoCapsule: (pattern: string, ids: string[]) =>
    `"${pattern}" matches no capsule.\n  fix: use one of: ${ids.join(", ")} (patterns like billing.** work too).`,
  gitFailed: (args: string, stderr: string) =>
    `git ${args} failed: ${stderr.trim()}\n  fix: check that git is installed and the repository is not corrupted.`,
};

/** Compiled agent files (C10). */
export const compileMsg = {
  E011: (file: string, how: "differs" | "missing" | "extra") =>
    make(
      "E011",
      { file },
      how === "missing"
        ? `Generated agent file ${file} is missing.`
        : how === "extra"
          ? `Generated agent file ${file} belongs to no capsule any more.`
          : `Generated agent file ${file} is out of date.`,
      "agents read these files to learn the rules; an out-of-date file teaches them old rules.",
      "Run `capsules compile` and commit the result. Never edit generated files by hand.",
    ),
};

/** Messages the hooks print (C11). Claude reads a block reason as the reason it can't proceed. */
export const hookMsg = {
  blocked: (code: string, what: string, lines: [string, string][], why: string, fix: string) =>
    [
      `capsules blocked this change (${code}): ${what}`,
      ...lines.map(([k, v]) => `  ${(k + ":").padEnd(9)}${v}`),
      `  why:     ${why}`,
      `  fix:     ${fix}`,
    ].join("\n") + "\n",
  notAllowedWhy:
    "permissions.yaml says who may change what, so an agent can't change parts it has no business touching.",
  notAllowedFix: (action: string) =>
    action === "change-checks"
      ? "leave existing tests as they are and fix the code instead. If the test itself is wrong, say so and stop: a human, or the test-maintainer agent in its own session, can change it."
      : action === "edit-config" || action === "edit-permissions"
        ? "don't change this file; ask a human owner to make the change."
        : `ask a human owner, or an agent whose role and scope include ${action}, to make this change.`,
  v1Why: "an agent could make a test pass by weakening the test.",
  v1Fix:
    "don't change the test in this session. Fix the code so the existing test passes. If the test is wrong, say so: the test-maintainer agent can change it in a separate session, with owner approval.",
  v2Why:
    "a rule can be made to fit by quietly rewriting the reason it exists, and no one would see the drift.",
  v2Fix:
    "change the intent and the rule in separate sessions, and have an owner approve the intent change.",
  decisionWhy:
    "a decision records why things are built this way; rewriting it erases the history people and agents rely on.",
  decisionFix: (addr: string) =>
    `leave ${addr} as it is and add a new decision that supersedes it, e.g. "## decision D<n> supersedes @${addr.split("#")[1]}".`,
  generatedWhy: "this file is generated from .capsules/, so hand edits would be overwritten.",
  generatedFix: "change the capsule in .capsules/ instead, then run `capsules compile`.",
  toolFileWhy: "only capsules' own commands write this file, so its fingerprints can be trusted.",
  toolFileFix:
    "use `capsules lock`, `capsules refresh <address>` or `capsules relock --cosmetic <address>` instead.",
  bashWhy:
    "capsules can only check edits made with the Edit and Write tools; shell writes to protected files skip those checks.",
  bashFix:
    "make the change with the Edit or Write tool so capsules can check it, or ask a human to make it.",
  approval: (what: string) =>
    `capsules: ${what}. An owner must approve this change in the pull request (W108).`,
  crashed: (detail: string, open: boolean) =>
    `capsules hook failed: ${detail}\n` +
    (open
      ? "The change was allowed (hooks.on-error: open). This is a bug in capsules; CI still checks the change.\n"
      : "The change was blocked (hooks.on-error: closed). This is a bug in capsules; set hooks.on-error to open to continue.\n"),
};
