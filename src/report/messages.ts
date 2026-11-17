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
  W111: (
    unit: string,
    who: string,
    capsule: string,
    action: string,
    reason: string,
    what: string[],
  ) =>
    make(
      "W111",
      {},
      `${unit}, by ${who}: ${action} in ${capsule} would be blocked in strict mode (${reason}): ${what.join(", ")}.`,
      "gentle mode lets agents work outside their scope while you get used to capsules; strict mode would refuse this.",
      "nothing to do now. When the warnings look right, run `capsules mode strict` in your own terminal.",
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
  E033: (
    commit: string,
    who: string,
    items: { key: string; capsule: string }[],
    owners: string[],
  ) =>
    make(
      "E033",
      { file: ".capsules/approvals.lock" },
      `${commit} changes approvals.lock, but ${who} doesn't own ${[...new Set(items.map((i) => i.capsule))].join(", ")}: ${items
        .map((i) => i.key)
        .join(", ")}.`,
      "an approval tells everyone an owner read and accepted a rule or a test; only an owner may give it.",
      `Remove those lines from the commit, and ask an owner (${owners.join(", ") || "none listed"}) to run \`capsules review approve\` themselves.`,
    ),
  E034: (file: string, line: number, text: string) =>
    make(
      "E034",
      { file, line },
      `${file} can't be read: line ${line} doesn't match the approvals.lock format ("${text.slice(0, 60)}").`,
      "if the approvals can't be read, nothing counts as approved, so every rule and test change looks unreviewed.",
      "Restore the file from Git (`git checkout -- .capsules/approvals.lock`); only `capsules review approve` should write it.",
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
  mapFormat: (v: string) =>
    `--format must be html, mermaid or json, not "${v}".\n  fix: use --format html (the default), --format mermaid or --format json.`,
  mapOpenNeedsHtml: () =>
    "--open only works with the HTML map.\n  fix: drop --open, or use --format html (the default).",
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
const KEEP_GOING =
  'don\'t try another way around this block. Carry on with the rest of the task. If a test or rule looks wrong, leave a note for an owner: capsules propose <address or test file> --why "<reason>".';

export const hookMsg = {
  blocked: (code: string, what: string, lines: [string, string][], why: string, fix: string) =>
    [
      `capsules blocked this change (${code}): ${what}`,
      ...lines.map(([k, v]) => `  ${(k + ":").padEnd(9)}${v}`),
      `  why:     ${why}`,
      `  fix:     ${fix}`,
      `  next:    ${KEEP_GOING}`,
    ].join("\n") + "\n",
  /** C18.7 (D-036): every block ends with how to carry on. */
  keepGoing: KEEP_GOING,
  sessionStarted: (id: string, agent: string, role: string, scope: string[], reopened: boolean) =>
    `capsules: ${reopened ? "continuing" : "opened"} session ${id} for this Claude Code session, as ${agent} (role ${role}, capsules ${scope.join(", ")}).\n` +
    'Before changing a file, run `capsules explain <file>`. Never weaken an existing test; if one looks wrong, run `capsules propose <test file> --why "<reason>"` and carry on.\n',
  sessionNoDefault: () =>
    "capsules: permissions.yaml has no `default` agent, so no session was opened. Edits are checked as `default` and will be refused until it is added.\n",
  notAllowedWhy:
    "permissions.yaml says who may change what, so an agent can't change parts it has no business touching.",
  notAllowedFix: (action: string) =>
    action === "change-checks"
      ? "leave existing tests as they are and fix the code instead. If the test itself looks wrong, propose a change (capsules propose <test file> --why ...): a human, or the test-maintainer agent in its own session, can change it."
      : action === "edit-config" || action === "edit-permissions"
        ? "don't change this file; ask a human owner to make the change."
        : `ask a human owner, or an agent whose role and scope include ${action}, to make this change.`,
  v1Why: "an agent could make a test pass by weakening the test.",
  v1Fix:
    "don't change the test in this session. Fix the code so the existing test passes. If the test is wrong, propose a change (capsules propose <test file> --why ...): the test-maintainer agent can change it in a separate session, with owner approval.",
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
  humansOnlyWhy:
    "approving a rule or a test, removing a proposal and switching the mode are an owner's decisions; an agent can't make them.",
  humansOnlyFix:
    "tell the user what you'd like approved; they run `capsules review` and approve it in their own terminal.",
  gentle: (what: string) =>
    `capsules (gentle mode, W111): allowed, but strict mode would block this: ${what}. Run \`capsules mode\` to see the list.`,
  approval: (what: string) =>
    `capsules: ${what}. An owner must approve this change in the pull request (W108).`,
  crashed: (detail: string, open: boolean) =>
    `capsules hook failed: ${detail}\n` +
    (open
      ? "The change was allowed (hooks.on-error: open). This is a bug in capsules; CI still checks the change.\n"
      : "The change was blocked (hooks.on-error: closed). This is a bug in capsules; set hooks.on-error to open to continue.\n"),
};

/** `capsules map` (C14). */
/** `capsules mode` (C18.5). */
export const modeMsg = {
  show: (mode: string, log: { date: string; agent: string; file: string; reason: string }[]) => {
    const head =
      mode === "gentle"
        ? "capsules mode: gentle. Agents working outside their scope, or on a concern they are barred from, only get a warning (W111). Everything else is blocked as in strict mode."
        : "capsules mode: strict. Every permission problem is blocked.";
    if (!log.length)
      return `${head}\nOn this machine, nothing would have been blocked by strict mode yet.\n`;
    const shown = log.slice(-20);
    return (
      `${head}\n\nWhat strict mode would have blocked on this machine (${log.length}${log.length > 20 ? `, last 20 shown` : ""}):\n` +
      shown.map((e) => `  ${e.date}  ${e.agent}  ${e.file}: ${e.reason}`).join("\n") +
      "\n\nTo switch, run in your own terminal: capsules mode strict\n"
    );
  },
  bad: (v: string) =>
    `"${v}" is not a mode.\n  fix: use capsules mode strict, or capsules mode gentle.`,
  already: (m: string) => `capsules mode is already ${m}. Nothing changed.\n`,
  couldNotSet: () =>
    "capsules couldn't change the mode line in .capsules/config.yaml safely, so nothing was written.\n  fix: set `mode: strict` (or gentle) in that file by hand.",
  set: (was: string, now: string, logged: number, dry: boolean) =>
    `${dry ? "Would set" : "Set"} mode: ${now} in .capsules/config.yaml (was ${was}).` +
    (now === "strict" && logged
      ? ` The ${logged} change${logged === 1 ? "" : "s"} listed by \`capsules mode\` would now be blocked.`
      : "") +
    "\nCommit .capsules/config.yaml yourself: only an owner may change it (edit-config).\n",
};

/** `capsules review` (C18.4). */
export const reviewMsg = {
  humansOnly: (cmd: string) =>
    `error  ${cmd} is for humans, and this looks like an agent's shell (CAPSULES_SESSION or CLAUDECODE is set).\n` +
    "  why:  an approval tells everyone an owner read and accepted the change; an agent can't give it.\n" +
    "  fix:  run it in your own terminal, outside Claude Code. CI also checks that an owner made the commit (E033).\n",
  approveWhat: () =>
    "error  Say what to approve: capsules review approve r1 r2 …, or --routine for the routine items.\n  fix:  run `capsules review` to see the items and their ids.\n",
  reviewFirst: () =>
    "error  Run `capsules review` first, so you approve exactly what you have read.\n",
  unknownId: (id: string) =>
    `${id}: no such item in the last \`capsules review\`. Run it again to see the ids.`,
  gone: (id: string, key: string) =>
    `${id}: ${key.replace(/^\w+ /, "")} isn't waiting any more (already approved, or the change was undone).`,
  changedSince: (id: string, title: string) =>
    `${id}: "${title}" changed after you reviewed it, so it was not approved. Run \`capsules review\` and read it again.`,
  approved: (
    done: string[],
    problems: string[],
    approvals: boolean,
    lock: boolean,
    notMine: string[],
    dry: boolean,
    next: string[] = [],
  ) => {
    const out: string[] = [];
    if (done.length)
      out.push(`${dry ? "Would approve" : "Approved"}:`, ...done.map((d) => `  ${d}`));
    if (problems.length)
      out.push(...(done.length ? [""] : []), "Not approved:", ...problems.map((p) => `  ${p}`));
    const files = [
      approvals ? ".capsules/approvals.lock" : "",
      lock ? ".capsules/capsules.lock" : "",
    ].filter(Boolean);
    if (files.length && !dry)
      out.push(
        "",
        `Commit ${files.join(" and ")} yourself (not from an agent): CI checks that an owner made that commit (E033).`,
      );
    if (notMine.length)
      out.push(
        "",
        `Note: your Git email isn't an owner of ${notMine.join(", ")} in permissions.yaml, so CI will reject this approval (E033).`,
      );
    if (next.length) out.push("", ...next);
    return out.join("\n") + "\n";
  },
  updateFirst: (rule: string, update: string[], others: number) => {
    const more = update.length - 1 + others;
    return (
      `Next: ask the drafter to update ${update[0]}${more ? ` (and ${more} other${more === 1 ? "" : "s"})` : ""} first, to match ${rule}.\n` +
      "  Then run `capsules review` again: each one shows the new rule next to what it says, for you to approve."
    );
  },
  noProposal: (id: string) =>
    `error  There is no proposal ${id}.\n  fix:  run \`capsules review\` to see the open proposals and their names.\n`,
  removed: (file: string, dry: boolean) =>
    `${dry ? "Would remove" : "Removed"} ${file}. Commit that yourself; CI checks an owner removed it.\n`,
};

/** `capsules propose` and proposal files (C18.3). */
export const proposalMsg = {
  needsWhy: () =>
    'capsules propose needs a reason.\n  fix: add --why "<what looks wrong and why>", e.g. capsules propose tests/invoices/refunds.test.js --why "it expects the old refund limit".',
  readOnlyRole: (agent: string, role: string) =>
    `${agent} (role ${role}) is read-only, so it can't leave proposals.\n  fix: report what you found in your answer instead.`,
  unknownCapsule: (id: string) =>
    `There is no capsule "${id}".\n  fix: run \`capsules status\` to see the capsules, or name a file instead.`,
  newNeedsText: (addr: string) =>
    `${addr} doesn't exist yet, so a proposal for it needs the text.\n  fix: add --text "<the new rule, intent or example>".`,
  unknownTarget: (t: string) =>
    `"${t}" is neither an address (capsule#node) nor a file in this project.\n  fix: name a rule like billing#C1, or a test file like tests/invoices/refunds.test.js.`,
  wrote: (file: string, target: string, kind: string, dry: boolean) =>
    `${dry ? "Would write" : "Wrote"} ${file} (${kind === "note" ? "a note" : kind === "new" ? "a proposed new item" : "a proposed change"} for ${target}).\n` +
    "Nothing else changed. An owner sees it in `capsules review`; carry on with the rest of the task.\n",
  unreadable: (file: string, why: string) => `The proposal ${file} can't be read: ${why}.`,
  unreadableWhy: "a proposal no one can read can't be reviewed.",
  unreadableFix:
    "fix the file (front matter with target and kind, then a `## why` section), or remove it with `capsules review done <proposal>`.",
  waiting: (target: string, kind: string, by: string) =>
    `${kind === "note" ? "A note" : "A proposal"} about ${target} from ${by} is waiting for an owner.`,
  waitingWhy:
    "an agent thinks a rule, an intent or a test should change, and only an owner can decide.",
  waitingFix: (id: string) =>
    `run \`capsules review\` to read it. Apply it or not, then remove it with \`capsules review done ${id}\`.`,
};

export const mapMsg = {
  wrote: (path: string, summary: string, opening: boolean) =>
    `Wrote the capsules map: ${path}\n  ${summary}\n` +
    (opening
      ? "Opening it in your browser. It works offline and makes no network requests.\n"
      : "Open it in a browser (or run `capsules map --open`). It works offline and makes no network requests.\n"),
  dryRun: (path: string) =>
    `Dry run: would write the capsules map to ${path}. Nothing was changed.\n`,
};
