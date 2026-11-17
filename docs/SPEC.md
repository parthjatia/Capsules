<!-- Copied from Part C of CLAUDE.md by `npm run spec:sync`. Do not edit here; edit CLAUDE.md. -->

# PART C: The v0.1 spec

> Keep `docs/SPEC.md` identical to this part. If the code needs the spec to change, propose the change to Parth first.

## C1. Folder layout in a user's repo

```text
repo/
├── src/ ...                          # the app: NEVER modified by capsules
├── .capsules/
│   ├── config.yaml                   # settings (C4)
│   ├── permissions.yaml              # owners, roles, agents, scopes (C5)
│   ├── capsules.lock                 # pinned hashes (C7); written by the tool, committed
│   ├── approvals.lock                # what an owner approved (C18.4); written by the tool, committed
│   ├── _proposals/                   # agents' proposed changes and notes (C18.3), committed
│   ├── installed.json                # every file capsules created or changed (for remove)
│   ├── .gitignore                    # ignores _cache/ inside .capsules only
│   ├── root.md                       # root capsule: the whole product
│   ├── billing.md                    # area capsule "billing" (child of root)
│   ├── billing/
│   │   └── invoices.md               # area capsule "billing.invoices" (child of billing)
│   ├── web.md
│   ├── users.md
│   ├── _concerns/
│   │   ├── pii.md                    # concern capsule "pii"
│   │   └── payments.md               # concern capsule "payments"
│   └── _cache/                       # NOT committed: index, sessions, last check, map
├── .claude/                          # only our marked files and merged hook entries (C11)
└── .cursor/rules/capsules-*.mdc      # only if Cursor is enabled
```

Rules:
- **Capsule ids come from paths.** `.capsules/root.md` → `root`. `.capsules/billing.md` → `billing`. `.capsules/billing/invoices.md` → `billing.invoices`. `.capsules/_concerns/pii.md` → `pii`.
- **Parents.** The parent of `a.b` is `a`; the parent of a top-level capsule is `root`. A folder `billing/` without `billing.md` is error `E013`.
- **Reserved.** Names starting with `_` are reserved for the tool. Concern ids must not equal a top-level area id (error `E012`).
- **Ids** are lowercase letters, digits and `-`, separated by `.`. A capsule file name that isn't a valid id (for example `Billing.md` or `a.b.md`) is error `E020`; nest with folders, not dots.
- **`.capsules/root.md` is required** (error `E023` if missing).
- **Project root.** The project root is the nearest folder, from the current folder up to the Git top level, that contains `.capsules/`. In a normal repo that is the repository root; in a monorepo or the demo app (`examples/billing-demo`) it can be a subfolder. `git ls-files` runs from the project root, and every path is relative to it (D-008).

## C2. Capsule file format

A capsule file is Markdown with YAML front matter, then one `##` heading per node.

```markdown
---
title: Invoices
owners: [parth]
covers:
  - src/billing/invoices/**
  - prompts/invoice-agent.md
excludes: []
status: active            # active | draft (draft capsules never block)
---

# Invoices

## intent I1
Each customer is charged exactly once per billing period, net of refunds.

## contract C1 serves @I1
Never create two invoices for the same customer and period.
checked-by: @no-duplicates

## example E1 shows @C1
Customer A, period 2026-03, two CreateInvoice calls -> one invoice.
checked-by: @no-duplicates

## check no-duplicates
run: npm test -- invoices.duplicates
files: tests/invoices/duplicates.test.ts

## assumption A3
Fewer than 1,000 invoices per minute.
review-by: 2027-06-01

## decision D7 serves @C1 assumes @A3 supersedes @D3
Use Stripe for invoice creation.
rejected: own ledger (3 weeks of work, no audit trail)

## context idempotency derived-from @D7
Stripe idempotency keys are built from customer_id + period.
Always pass both. {{ @C1 }}

## prompt invoice-agent
file: prompts/invoice-agent.md

## code create-invoice implements @C1
src/billing/invoices/create.ts#createInvoice
```

### C2.1 Front matter keys

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `title` | string | yes | Human name |
| `owners` | list of human keys from `permissions.yaml` | no (inherits from parent) | Who approves intent and contracts |
| `covers` | list of globs, repo-relative, `/` separators | area: no; concern: yes | Files this capsule describes |
| `excludes` | list of globs | no | Subtracted from `covers` |
| `status` | `active` or `draft` | no (default `active`) | Draft capsules report but never block: errors found in a draft capsule's file are reported as warnings (D-008) |

### C2.2 Heading grammar

```text
## <type> <id>( <link-type> <ref>(, <ref>)*)*
```

- `<ref>` is `@<node-id>` (same capsule) or `@<capsule-id>#<node-id>` (another capsule).
- **Reserved repo prefix.** `@<repo>:<capsule-id>#<node-id>` (for example `@payments-service:billing#C3`) is reserved for future cross-repo links. `<repo>` uses the same characters as an id segment. v0.1 parses it and rejects it with `E015`. The `:` character is therefore never allowed inside a capsule or node id. This applies everywhere an address appears: heading links, `checked-by:`, `tripwire:`, `{{ @ref }}` transclusions, and CLI arguments such as `capsules why <address>` (which exit `64` with the same message).
- Body **fields** are `key: value` lines. A line is a field only if, on its own line, it starts with a key that is **valid for that node type** (C2.3; for example `checked-by`, `run`, `files`, `rejected`), immediately followed by `:`. Fields may appear anywhere in the body, before or after the prose. Any other `word: text` line stays prose. Lines inside code blocks (fenced or indented) are never fields. Blank lines directly under the heading are ignored, so Markdown formatters can't change a capsule's meaning. Fields may repeat where noted.
- `checked-by:` may appear as a field or as a heading link. Both mean the same thing.

### C2.3 Node types

| Type | Id format | Allowed links | Fields | Notes |
| --- | --- | --- | --- | --- |
| `intent` | `I<n>` | none | none | Plain words, one idea |
| `contract` | `C<n>` (in area and concern capsules alike) | `serves` (intent), `checked-by` (check) | `scope: tree\|own` (default `tree`) | `tree`: applies to this capsule's files and all its descendants' files |
| `example` | `E<n>` | `shows` (contract, required), `checked-by` | none | What humans approve |
| `check` | slug | none | `run` (required), `files` (globs, repeatable), `timeout` (seconds), `cwd` | `files` = where the test lives, used for protection |
| `decision` | `D<n>` | `serves`, `supersedes` (decision), `assumes` (assumption) | `rejected` (repeatable) | Append-only (C6.3) |
| `assumption` | `A<n>` | none | `tripwire` (ref to a check), `review-by` (YYYY-MM-DD) | v0.1 only reports; no live metrics |
| `context` | slug | `uses`, `derived-from` | none | May contain `{{ @ref }}` transclusions |
| `prompt` | slug | `uses` | `file` (required, path to a prompt the app uses at runtime) | We hash the file; we **never** rewrite it |
| `code` | slug | `implements` (contract) | none | Body lines are `path` or `path#symbol`; v0.1 checks only that the path exists |

### C2.4 Link types (8 in v0.1)

| Link | From → To | Meaning |
| --- | --- | --- |
| `serves` | contract → intent; decision → contract or intent | Why this exists |
| `checked-by` | contract or example → check | How it's proven |
| `shows` | example → contract | A concrete case of a rule |
| `implements` | code → contract | Where the rule lives in code |
| `uses` | context or prompt → any node | Quotes or depends on it |
| `assumes` | decision → assumption | Rests on this fact |
| `derived-from` | context → decision or any node | Where this knowledge came from |
| `supersedes` | decision → decision | Replaces an older decision |

### C2.5 Transclusion

- `{{ @ref }}` inside a `context` node inserts the target node's body when compiling agent files (C10).
- Each transclusion counts as an implicit `uses` link, so it shows up in staleness.
- The context node's own hash uses the raw text, with the placeholder.

### C2.6 Validation codes

Errors (`E`) fail `capsules check`. Warnings (`W`) are reported only.

| Code | Meaning |
| --- | --- |
| E001 | Unknown node type |
| E002 | Duplicate node id in one capsule |
| E003 | Reference points to nothing |
| E004 | A file has two home capsules that are not ancestor and descendant |
| E005 | Cycle in `supersedes` or `derived-from` |
| E006 | Link type not allowed between these node types |
| E007 | Required field missing (for example a check without `run`) |
| E008 | Front matter invalid |
| E009 | An existing decision node was edited (append-only) |
| E010 | Lockfile out of date (run `capsules lock`) |
| E011 | Generated agent file out of date (run `capsules compile`) |
| E012 | Concern id collides with a top-level area id |
| E013 | Folder without its capsule file |
| E014 | Concern covers no files |
| E015 | Cross-repo address (`<repo>:capsule#node`) is reserved and not supported yet in v0.1. Fix: point to a capsule in this repo, or remove the link until cross-repo links ship |
| E016 | Node heading can't be read (empty, no id after the type, or a reference with no link type before it) |
| E017 | Node id has the wrong format for its type (for example `contract X1`; see C2.3) |
| E018 | A single-value field appears more than once in a node (for example two `run:` lines) |
| E019 | A field value is invalid (`scope` not `tree`/`own`, `timeout` not a whole number, `review-by` not a date) |
| E020 | Capsule file name is not a valid capsule id |
| E021 | A capsule owner is not listed under `humans` in `permissions.yaml` |
| E022 | `config.yaml` or `permissions.yaml` is invalid, including unknown keys |
| E023 | `.capsules/root.md` is missing |
| E024 | Unknown link type word in a heading |
| E025 | A reference can't be read (not `@node` or `@capsule#node`) |
| E026 | `capsules.lock` can't be read (a line doesn't match the C7.2 format) |
| E027 | A change is not allowed by `permissions.yaml` (role, scope, `blocked-by`, or an unknown agent) |
| E028 | The one rule, V1: one change touched code and an existing check that judges it (C6.2) |
| E029 | The one rule, V2: one change touched a contract or example and the intent it serves (C6.2) |
| E030 | `Capsule-Cosmetic` was used by someone who doesn't own that capsule (C8) |
| E031 | A check command failed |
| E032 | A check command timed out |
| W101 | Tracked file has no home capsule (orphan); see `ignore` in config |
| W102 | Contract has no `serves` intent |
| W103 | Contract or example has no check |
| W104 | Stale link (C7.4) |
| W105 | Assumption past its `review-by` date |
| W106 | `code` path does not exist |
| W107 | Weakened-test signal (C9) |
| W108 | Change needs owner approval; GitHub enforces it through CODEOWNERS (D-016) |
| W109 | A `prompt` node's `file` does not exist |
| W110 | Stale prompt: the prompt file changed since it was locked (C7.4) |
| E033 | `approvals.lock` was changed by someone who doesn't own every capsule it approves for (C18.4) |
| E034 | `approvals.lock` or a proposal file can't be read (C18.3, C18.4) |
| W111 | Gentle mode: this would be blocked in strict mode (agent scope or a `blocked-by` concern; C18.5) |
| W112 | A proposal is waiting for an owner (C18.3); see `capsules review` |

Every message says what's wrong, where (file:line), why it matters, and the exact fix, in plain English.

### C2.7 Home and concern resolution

1. List tracked files with `git ls-files`, minus `config.ignore`.
2. For each file, find the area capsules whose `covers` matches and `excludes` doesn't.
3. If several match and they form one ancestor chain, the **deepest** wins (`billing.invoices` beats `billing`). Otherwise it's `E004`.
4. No match → `W101`. The file is treated as belonging to `root` for permissions.
5. Concerns: every concern whose `covers` matches applies.
6. Rules that apply to a file: its home capsule's contracts, plus every ancestor's contracts with `scope: tree`, plus every covering concern's contracts.

## C3. Example output of `capsules explain`

```text
$ capsules explain src/web/checkout.tsx
file:      src/web/checkout.tsx
home:      web                       (covers: src/web/**)
parents:   root
concerns:  payments, pii
rules:     web#C1, root#C1, payments#C1, payments#C2, pii#C1
checks:    web#checkout-e2e, payments#no-double-charge, pii#no-pii-logs
may edit:  default, capsules-drafter (context only)
blocked:   frontend-agent (concern: payments), billing-agent (outside its scope)
decisions: web#D2 (rejected: client-side tax calculation)
```

## C4. `config.yaml`

Missing keys take the defaults below. **Unknown keys are errors** (`E022`), in `config.yaml` and `permissions.yaml` alike: a typo such as `weakend-tests: block` must never silently fall back to a weaker default (D-008).

```yaml
format: 0.1
agents: [claude-code]              # claude-code | cursor | agents-md
ignore:                            # files that need no capsule
  - ".capsules/**"
  - ".claude/**"
  - ".cursor/**"
  - ".github/**"
  - "README.md"                    # not "*.md": prompts like prompts/*.md need a home (DECISIONS D-003)
  - "CHANGELOG.md"
  - "docs/**"
  - "**/package-lock.json"
  - "**/pnpm-lock.yaml"
  - "**/yarn.lock"
checks:
  files:                           # what counts as a check file (protected when existing)
    - "tests/**"
    - "**/*.test.*"
    - "**/*.spec.*"
    - "**/test_*.py"
    - "**/*_test.go"
  timeout-seconds: 300
one-rule:
  new-checks-with-code: allow      # allow | block
mode: strict                       # strict | gentle (new installs start gentle, C18.5)
weakened-tests: warn               # off | warn | block
stale-links: warn                  # warn | block
ci:
  mode: report                     # report | block (start in report)
hooks:
  on-error: open                   # open = never brick the agent if our hook crashes
rules:
  max-chars: 6000                  # per compiled agent rule file
build:                             # used only by `capsules doctor`
  command: "npm run build"
  test: "npm test"
  outputs: ["dist/**", "build/**", ".next/**"]
```

## C5. `permissions.yaml`

```yaml
format: 0.1
solo: true
humans:
  # emails: optional. If this repo is public, every email listed here is public too.
  parth: { github: "<github-handle>", owns: ["**"], emails: [] }
roles:
  builder:
    may: [edit-code, add-checks, edit-context, add-decisions]
  drafter:
    may: [edit-context, add-decisions, add-checks,
          propose-intent, propose-contracts, propose-examples]
  judge:
    may: [read]
  maintainer:                      # changes existing tests, never app code (D-021)
    may: [add-checks, propose-checks]
agents:                            # names match Claude Code sub-agent names where possible
  default:         { role: builder, capsules: ["**"] }
  billing-agent:   { role: builder, capsules: ["billing", "billing.**"] }
  frontend-agent:  { role: builder, capsules: ["web", "web.**"], blocked-by: [payments, pii] }
  capsules-judge:  { role: judge,   capsules: ["**"] }
  capsules-drafter: { role: drafter, capsules: ["**"] }
  test-maintainer: { role: maintainer, capsules: ["**"] }   # run it in its own session
```

### C5.1 Actions

| Action | Covers |
| --- | --- |
| `edit-code` | Implementation files and `code` nodes |
| `add-checks` | New check files, new `check` nodes, or purely additive lines in existing check files |
| `change-checks` | Modifying or deleting existing checks. Humans only, unless explicitly granted |
| `propose-checks` | Modify or delete existing checks, flagged for owner approval in CI (`W108`, a warning in every mode). Granted to the `maintainer` role (`test-maintainer` agent), which may not edit app code. The one rule still applies, so it must work in its own session (D-021) |
| `edit-context` | `context` nodes |
| `add-decisions` | New `decision` and `assumption` nodes. Existing decisions are immutable for everyone |
| `propose-intent`, `propose-contracts`, `propose-examples` | Change those nodes. CI then requires owner approval (warning in solo mode) |
| (anyone but `judge`) | **New** files in `.capsules/_proposals/` (C18.3). Changing or deleting an existing proposal is owners only |
| `edit-permissions`, `edit-config` | Humans only. `edit-config` covers `.capsules/config.yaml`, CI workflows (`.github/workflows/**`) and Claude Code's project settings (`.claude/settings.json`, `.claude/settings.local.json`), so an agent can't switch the guard off (D-020, D-026) |
| (none) | Generated agent files: only `capsules compile` writes them |
| (none) | Tool-written files `capsules.lock`, `approvals.lock` and `installed.json`: only the tool's own commands write them (`lock`, `refresh`, `relock`, `init`, `remove`, `review approve`). Hooks block direct edits. `refresh` of links **from** an intent, contract or example needs the same approval as editing that node (`propose-*`); `relock --cosmetic` is owners only |

Owners may do everything in capsules they own. Humans who aren't owners act as `default`.

### C5.2 Resolving one edit

Input: file `F`, actor `A` (agent name or human), and its role `R`, `capsules` patterns `S` and `blocked-by` list `B`.

1. **Classify the change:**
   - `F` is `.capsules/config.yaml`, under `.github/workflows/`, or `.claude/settings.json` or `.claude/settings.local.json` → `edit-config`, owners only, even though `.github/**` and `.claude/**` are in `ignore` (D-020, D-026). `F` is `.capsules/permissions.yaml` → `edit-permissions`.
   - `F` matches `checks.files` or a check's `files`, and existed at the base → existing check (`change-checks`, or `add-checks` if purely additive).
   - `F` is new and a check file → `add-checks`.
   - `F` is under `.capsules/` → parse before and after, diff the nodes, and map each changed node to its action. Front matter changes need `propose-contracts`.
   - `F` is a generated file → only `capsules compile` may write it.
   - `F` is `.capsules/capsules.lock` or `.capsules/installed.json` → no direct edits; only the tool's commands write them (C5.1).
   - Otherwise → `edit-code`.
2. **Find the capsules:** the home of `F` (C2.7), or the capsule whose file is being edited.
3. **Allow only if** `R` allows the action, **and** the home capsule matches a pattern in `S`, **and** none of `F`'s concerns is in `B`.
4. `propose-*` actions are allowed locally, then flagged for owner approval in CI (`W108`, unless an owner made the change). **GitHub enforces the approval** through CODEOWNERS and branch protection; capsules never contacts GitHub (B1), so it reports and GitHub blocks (D-016).
5. A change not allowed by steps 1 to 3 is `E027`.

### C5.3 Who made a commit (D-017)

- A commit with a `Capsule-Agent` trailer is made by that agent. An agent name not listed under `agents` is not allowed to change anything (`E027`).
- A commit without trailers is a human commit. The author's email identifies the human:
  1. GitHub noreply addresses (`<id>+<handle>@users.noreply.github.com` or `<handle>@users.noreply.github.com`) map automatically to the human whose `github` is that handle (case-insensitive).
  2. Otherwise, the human whose optional `emails` list contains the address (case-insensitive).
  3. Otherwise the author is unknown and acts as `default`.
- A human is an **owner** of capsule `X` if they are in `X`'s `owners` (or the nearest ancestor's), or one of their `owns` patterns matches `X`. Owners may do everything in capsules they own; other humans act as `default`.

## C6. The one rule (exact)

### C6.1 Change unit

A **change unit** is one commit. In CI, it is also all commits in the pull request that share the same `Capsule-Session` trailer. Commits without trailers are treated as human commits, checked per commit.

**Whole-PR unit (no trailers).** In CI, all commits in the pull request that have **no** `Capsule-Session` trailer are also checked together as one extra change unit. This stops an agent from dodging V1 or V2 by leaving out trailers and splitting the code change and the test change into separate commits. A violation found only in this whole-PR unit is an error, or a warning in solo mode (a human may legitimately fix code and a test in one PR). Violations inside a single commit stay errors in every mode.

### C6.2 Violations

For each capsule `X` in a change unit:

- **V1, code and its judge.** The unit touches implementation files whose home is `X`, or which a concern `K` covers. It also **modifies or deletes an existing check** that judges `X`: a check node in `X` or in `K`, a check linked by `checked-by` from `X`'s contracts, or an existing check file covered by `X`.
  - Adding new checks is not a violation (`one-rule.new-checks-with-code: allow`), but new checks are marked "unreviewed" until a human or a separate session confirms them. Starter checks written by a `drafter` session are unreviewed too (C18.6). An owner's approval in `approvals.lock` (C18.4) clears the mark.
- **V2, rule and its reason.** The unit changes a contract or example in `X` and also changes an intent that contract `serves`.
- V1 is reported as `E028` and V2 as `E029`.
- **Solo mode never relaxes V1 or V2.**

Message style:

```text
error  One change touched both code and an existing check that judges it.
  capsule: billing.invoices
  code:    src/billing/invoices/create.ts
  check:   tests/invoices/duplicates.test.ts (existing test, 2 assertions removed)
  why:     an agent could make a test pass by weakening the test.
  fix:     put the test change in its own commit from a separate session,
           and ask an owner to approve it.
```

### C6.3 Append-only decisions

- An existing `decision` node's hash must never change (`E009`).
- To change a decision, add a new one that `supersedes` it.
- Deleting a decision node is also `E009`.

### C6.4 The base (D-018)

`capsules check` compares against a base commit. Without `--base`:

1. In GitHub Actions, the pull request's base, read from the local event file (`GITHUB_EVENT_PATH`; no network): its `base.sha` if that commit exists locally, otherwise `origin/<base.ref>`.
2. Otherwise the remote's default branch (`origin/HEAD`, else `origin/main`).
3. With no remote, the local `main` branch if it exists.
4. Otherwise only uncommitted changes are checked.

The base is the merge base of `HEAD` and that ref. Uncommitted changes are always checked too, as one more change unit. CI must check out full history (for example `fetch-depth: 0`) for 1 to work.

## C7. Hashes and the lockfile

### C7.1 Node hash pipeline (frozen)

1. Build the canonical text:
   ```text
   <type> <id>
   <link-type> <fully-qualified-target>      (one line per link, sorted by link type, then target)
   ---
   <normalised body>
   ```
   Body fields count as part of the body, in their original order.
2. Normalise:
   - convert CRLF and CR to LF
   - apply Unicode NFC
   - strip trailing whitespace on every line
   - drop leading and trailing blank lines
   - collapse runs of blank lines to one
3. Take SHA-256 of the UTF-8 bytes, as lowercase hex, and **store the first 12 characters**.
4. Display the shortest unique prefix of at least 4 characters, like Git.
5. Front matter gets its own `capsule` hash. Convert CRLF and CR to LF, apply Unicode NFC, and parse the front matter as YAML 1.2. Serialise the parsed value with the **JSON Canonicalization Scheme ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785))**, then hash as in step 3. Comments, key order, quoting and indentation therefore never change the hash, and no library's output format can (D-012).

### C7.2 Lockfile format: `.capsules/capsules.lock`

Line-based, sorted, LF line endings, trailing newline. Records are sorted by kind (`capsule`, `node`, `link`, `file`), then lexically.

```text
# capsules.lock v1. Generated by `capsules lock`. Do not edit by hand.
capsule billing.invoices 5b2e90c1d7aa
node billing.invoices#C1 contract a91f2c81d0b4
node pii#C1 contract 3c07aa12e9f1
link billing.invoices#D7 serves billing.invoices#C1 a91f2c81d0b4
link billing.invoices#idempotency uses billing.invoices#C1 a91f2c81d0b4
file billing.invoices#invoice-agent prompts/invoice-agent.md 8d3f0e1a9b27c4d6e5f8a0b1c2d3e4f5a6b7c8d9
```

The last field of a `link` record is the hash of the target **at the moment the link was pinned**. `file` records use Git's blob hash (`git hash-object`).

### C7.3 Commands that write the lock

- `capsules lock`: updates `capsule`, `node` and `file` records. Adds `link` records for new links, pinned to the current target hash, and removes records for deleted links. **It never re-pins an existing link.**
- `capsules refresh <address>`: re-pins the links **from** that node, after its author has updated it.
- `capsules relock --cosmetic <address>`: re-pins every link **to** that node, declaring the change cosmetic. The tool never makes commits. It prints the exact line `Capsule-Cosmetic: <address>` to add to the commit message; from M4 the optional `commit-msg` hook adds it automatically. Owners only: CI checks, from M3, that the commit carrying the trailer was approved by an owner of that capsule (D-013).

### C7.4 Staleness

- **Stale link:** the pinned hash ≠ the target's current hash (`W104`, or an error if `stale-links: block`). Links **from a replaced decision** (one that another decision `supersedes`) are not reported, because they are history, not something to review. Reports print one summary line instead, for example `1 replaced decision skipped (billing.invoices#D3, replaced by billing.invoices#D7)` (D-015).
- **Stale prompt:** a `file` record's blob hash ≠ the current blob hash (`W110`). Contracts about that prompt need re-checking. A `prompt` node whose `file` doesn't exist is `W109`.
- **Out-of-date lock:** `capsule`, `node` or `file` records ≠ current (`E010`). CI fails until someone runs `capsules lock`.

## C8. Sessions, agent identity and commit trailers

- **Claude Code sub-agents.** Hook input includes `agent_type` when a hook fires inside a sub-agent, or when the session was started with `claude --agent <name>` ([hooks docs, common input fields](https://code.claude.com/docs/en/hooks)). If it matches a key in `permissions.agents`, that's the actor (D-024).
- **Main session:** `capsules work <capsule-pattern> [--agent <name>]` writes `.capsules/_cache/sessions/<id>.json` with `{id, agent, role, capsules, started}` and makes it the current session. `capsules work --end` closes it. The environment variable `CAPSULES_SESSION=<id>` selects a session when several run in parallel.
- **Automatic sessions (C18.1):** a `SessionStart` hook opens one session per Claude Code session, so `capsules work` is only needed to narrow the scope.
- **No session:** the actor is `default`.
- **The one rule in hooks (D-024).** Within one Claude Code session (`session_id`), or one `capsules work` session when there is one, the hooks remember which code, checks, intents and contracts were changed, and block the edit that would break V1 or V2. Sub-agents share their parent's `session_id`, so a `test-maintainer` sub-agent can't change a test in the same session that changed the code.
- **Commit trailers**, added by the optional `commit-msg` Git hook from the current session, or by the agent following the installed commands:
  ```text
  Capsule-Session: 7f3c…
  Capsule-Agent: billing-agent
  Capsule-Role: builder
  Capsule-Scope: billing.**
  ```
- CI reads the trailers. **They can be forged**, so changes to protected layers also need owner approval on GitHub (CODEOWNERS plus branch protection). `capsules codeowners` prints the suggested lines.
- **Private repos on GitHub Free (D-025).** Branch protection and required CODEOWNERS reviews aren't available there, so GitHub can't require checks or owner approvals. Capsules still reports every problem in CI, but it can't block a merge. The agent hooks still block live. Once a repo is public (or on a paid plan), make the CI summary job (`ci-ok` in this repo) a required check.
- **`Capsule-Cosmetic` owner check (D-013, D-016).** For every commit carrying `Capsule-Cosmetic: <address>`, the person who made it must own that capsule, or it is `E030`. In GitHub Actions, that person is the pull request's author, read from the local event file. Elsewhere, it is the commit author (C5.3). An address that names no node is `E003`.

## C9. Checks and weakened-test signals

### C9.1 Running checks

- Each `check` has `run:` (a shell command), plus optional `cwd`, `timeout` (default `checks.timeout-seconds`) and `files`.
- `capsules check` runs the checks of **affected capsules**:
  - capsules whose covered files changed versus the base
  - their ancestors (for `scope: tree` contracts)
  - concerns covering changed files

  `--all` runs every check.
- Exit code 0 means pass. Checks run sequentially by default, for readable output and determinism.
- Results go to `.capsules/_cache/last-check.json`, which the map and status read.
- **Security note for docs:** check commands run with the pull request's code, exactly like any CI script.

### C9.2 Weakened-test signals (deterministic heuristics; `weakened-tests: warn` by default)

In a diff versus the base, per existing check file:

- the file was deleted
- the number of lines matching assertion patterns went down (`assert`, `expect(`, `should`, `t.Error`, `require.`, `XCTAssert`)
- skip markers were added (`.skip(`, `xit(`, `xdescribe(`, `test.todo(`, `@pytest.mark.skip`, `t.Skip(`, `@Ignore`, `@Disabled`)
- a check node's `run:` command changed (also a protected-layer change)

Patterns are configurable in `config.yaml` under `weakened-tests-patterns` (optional). Every report names the file, the line and the pattern.

## C10. Compiled agent files (`capsules compile`)

Generated files start with `<!-- Generated by capsules from .capsules/. Do not edit. Run: capsules compile -->`. Files that need front matter (Claude Code `paths`, Cursor `globs`) put it first and the marker line right after it, because both tools only read front matter at the very top (D-024).

| Agent | Files we write | Scoping |
| --- | --- | --- |
| Claude Code | `.claude/rules/capsules-overview.md` (no `paths`, always loaded); `.claude/rules/capsules-<capsule-id>.md` with front matter `paths:` = the capsule's `covers` | Claude Code loads path-scoped rules only when working on matching files ([docs](https://code.claude.com/docs/en/claude-md.md)) |
| Cursor | `.cursor/rules/capsules-overview.mdc` (`alwaysApply: true`); `.cursor/rules/capsules-<id>.mdc` with `description`, `globs:` (one comma-separated string) and `alwaysApply: false` | Project rules must use `.mdc`; `globs` is a comma-separated string ([Cursor rules docs](https://cursor.com/docs/context/rules), D-024) |
| AGENTS.md (Codex and others) | A managed block between `<!-- capsules:begin -->` and `<!-- capsules:end -->`, only if `agents-md` is enabled | No path scoping: the block tells the agent to run `capsules explain <file>` and `capsules context <file>` |

Each per-capsule rule file contains, in this order:

1. title and intents
2. contracts that apply: its own, inherited ones and those from concerns, with addresses
3. examples
4. context, with transclusions resolved
5. decisions in brief, with **rejected options** called out
6. "What you may edit / must not edit / how to propose a change", taken from permissions

If a file would exceed `rules.max-chars`, the far content (ancestors) shrinks to one line each, deterministically.

`capsules compile --check` exits non-zero if any generated file differs from what it would generate (`E011`). `capsules check` reports `E011` once agent files have been installed, that is when `installed.json` or any generated file exists (D-024). A capsule with no `covers` (often `root`) gets no per-capsule file; its rules reach agents through inheritance and the overview.

## C11. Agent hooks (Claude Code first)

Installed by merging into `.claude/settings.local.json` (D-026): Claude Code's per-machine project settings, kept out of Git. The hook commands point at the capsules that ran `init` on this machine, so they stay fast; each person runs `init` once, and CI is the shared gate. Because `init` creates that file itself, it also lists it in `.git/info/exclude` (Claude Code only does this for files it creates). **Never overwrite** the user's settings: keep their hooks, add ours, and record exactly what we added in `installed.json`. Once capsules is published, `init --shared` will offer shared hooks in `.claude/settings.json` that call a globally installed `capsules` (`npm install -g`), not `npx`, so hooks stay fast. Both settings files are `edit-config`: the hooks block agent edits to them, so an agent can't remove its own guard.

| Event and matcher | Command | Behaviour |
| --- | --- | --- |
| `PreToolUse`, `Edit\|Write\|MultiEdit\|NotebookEdit` | `capsules hook pre-edit` | Simulate the edit, classify it (C5.2), check permissions and the one rule for the current session. Block with a clear reason if not allowed |
| `PreToolUse`, `Bash` | `capsules hook pre-bash` | Best effort: block obvious writes to protected paths (`rm`, `sed -i`, `>`, `mv` into `.capsules/`, check files, generated files). Otherwise allow |
| `SessionStart` | `capsules hook session-start` | Opens this Claude Code session's capsules session (C18.1). Never blocks |
| `Stop` | `capsules hook stop` | Report only: validation errors, stale links, orphans, what CI's fast checks would fail on (one rule, permissions, decisions; C18.2), open proposals, and the suggested next command, shown to the user as a JSON `systemMessage`. Always exit 0 in v0.1, and never `decision: block` |

Hook protocol facts (verify against [Claude Code hooks docs](https://code.claude.com/docs/en/hooks) before building):

- Input is JSON on stdin, with `tool_name`, `tool_input` (for example `file_path`, `content`, `old_string`, `new_string`, `replace_all`), `session_id`, `cwd`, and `agent_type` inside sub-agents. `file_path` is always absolute. Verified against the [hooks docs](https://code.claude.com/docs/en/hooks) on 2026-11-16 (D-024).
- **To block: write the reason to stderr and exit with code 2.** Claude sees the stderr text as the reason. Exit code 1 does **not** block; it shows a hook error notice and the action goes ahead ([hooks docs, exit code output](https://code.claude.com/docs/en/hooks)).
- Hooks must be fast. Target on a 1,000-file repo: **under 150 ms on macOS and Linux, under 300 ms on Windows** (Node starts more slowly there). To get there, hooks run from a **small separate entry point** that loads only hook code, and read a **saved index** of the parsed capsules from `_cache/`. The index is rebuilt only when a capsule or settings file has changed (D-010).
- If our hook crashes: with `on-error: open`, print a warning and exit 1, which shows the error and continues. With `closed`, exit 2. Never leave the user's agent stuck because of our bug.

## C12. Agent commands, skill and judge

Installed under `.claude/` (verify the current Claude Code formats for commands, skills, plugins and sub-agents before building):

| File | Purpose |
| --- | --- |
| `.claude/commands/capsules-draft.md` → `/capsules-draft [area]` | The agent reads code, Git history, the README and existing CLAUDE.md, AGENTS.md or OpenSpec files. It proposes a capsule tree and concerns, writes `.capsules/*.md` as the `capsules-drafter` agent, runs `capsules check --no-run`, and then shows the human the **intents and examples in plain language** for approval. It never invents checks; checks must point to real commands. When the app has few or no tests, it may write a few starter checks, only for examples the human approved, only as new test files (C18.6) |
| `.claude/commands/capsules-work.md` → `/capsules-work <capsule>` | Runs `capsules work`, reads `capsules context <capsule>`, and follows it |
| `.claude/commands/capsules-judge.md` → `/capsules-judge [base]` | Runs `capsules context --for judge --base <ref>` and hands the output to the `capsules-judge` sub-agent. It receives a verdict per contract and runs `capsules verdict record` |
| `.claude/commands/capsules-map.md` → `/capsules-map` | Runs `capsules map` and explains it in plain words |
| `.claude/agents/capsules-judge.md` | A sub-agent with `tools: Read, Grep, Glob` only ([sub-agent docs](https://code.claude.com/docs/en/subagents)). Its prompt: judge each listed contract against the change as kept, broken or unsure, with reasons and file:line evidence. Never suggest fixes; output JSON matching C13 |
| `.claude/agents/capsules-drafter.md` | Drafts capsules and has no permission to edit code (enforced by permissions and hooks) |
| `.claude/skills/capsules/SKILL.md` | Teaches the format in two or three pages: node types, links, addresses, the one rule, and what never to edit |

## C13. Verdicts (stored as Git notes)

```json
{
  "format": "0.1",
  "commit": "<sha>",
  "base": "<sha>",
  "judge": { "agent": "claude-code", "subagent": "capsules-judge" },
  "results": [
    { "contract": "billing.invoices#C1", "verdict": "kept",
      "reason": "Idempotency key still built from customer_id + period.",
      "evidence": ["src/billing/invoices/create.ts:42"] }
  ]
}
```

- `capsules verdict record --file <json>` validates the JSON with zod and appends it as a Git note on the commit, under `refs/notes/capsules`.
- `capsules verdict show [commit]` prints the verdicts.
- Notes aren't pushed by default. Document `git push origin refs/notes/capsules`; the GitHub Action fetches them.
- Verdicts are advice. They **never** block in v0.1.

## C14. The map (`capsules map`)

- `--format html` (default) writes one self-contained file to `.capsules/_cache/map.html`: inline CSS and plain JS, **no network requests**, deterministic ordering.
- It shows, from the top (D-027):
  - a one-line summary, for example `6 areas · 2 concerns · 14 rules · 1 stale · checks passed`
  - **Needs attention**: errors, stale rules, failing checks, unreviewed checks, orphan files and assumptions past review, each linking to its place in the tree
  - a search box over files: type a path and see its `explain` result
  - the area tree with titles and intents, and the concerns that reach each area as coloured tags
  - concerns, and which capsules and files they cover
  - per capsule: number of contracts, check status from `last-check.json`, stale links, orphans nearby
- The page carries a Content-Security-Policy that forbids every network request. No timestamps and no machine paths, so the same files give the same bytes on every machine.
- `capsules map` prints the file's path and the summary line. `--open` also opens it in the default browser (a local file; no network).
- `--format mermaid` prints a Mermaid graph, for READMEs and pull requests.
- `--format json` prints the full graph for other tools.

## C15. CLI reference

Exit codes: `0` OK · `1` problems found (errors, failing checks, violations) · `2` used only by `capsules hook` to block · `64` usage error · `70` internal error.

| Command | What it does |
| --- | --- |
| `capsules init [--agents …] [--yes] [--git-hooks] [--workflow]` | Shows a plan of every file it will create or change, asks to confirm, then creates `.capsules/` (keeping one that exists), compiles agent files, merges hooks into `.claude/settings.local.json` (C11), and installs commands, sub-agents and the skill. Optionally adds the commit-msg hook and `.github/workflows/capsules.yml`. Writes `installed.json` |
| `capsules check [--base <ref>] [--all] [--no-run] [--ci] [--summary <file>] [--json]` | Validate → lock up to date → compiled files up to date → permissions and the one rule on the diff → append-only decisions → weakened-test signals → run checks for affected capsules |
| `capsules status` | Stale links, stale prompts, orphans, unreviewed checks, assumptions past review, last check results |
| `capsules explain <file>` | Home, parents, concerns, rules, checks, who may edit, related decisions |
| `capsules context <capsule\|file> [--budget <tokens>] [--for judge\|builder]` | Prints the context pack (C16). Tokens are estimated as characters ÷ 4 |
| `capsules impact <address>` | Everything that depends on a node |
| `capsules why <address>` | Decisions behind a node, with rejected options |
| `capsules lock` · `refresh <address>` · `relock --cosmetic <address>` | Lockfile (C7.3) |
| `capsules work <pattern> [--agent <name>]` · `work --end` | Sessions (C8, C18.1) |
| `capsules propose <address\|check-file> --why <reason> [--text <new text>]` | Leave a proposal or a note for an owner (C18.3) |
| `capsules review [--base <ref>]` · `review approve <id…>` · `review approve --routine` · `review done <proposal>` | Everything waiting for a human (C18.4). Approving is humans only |
| `capsules mode [strict\|gentle]` | Show or set `mode` (C18.5). Humans only |
| `capsules compile [--check]` | Agent files (C10) |
| `capsules hook <pre-edit\|pre-bash\|stop>` | Called by agent hooks only |
| `capsules verdict record --file <f>` · `verdict show [commit]` | Verdicts (C13) |
| `capsules map [--format html\|mermaid\|json] [--out <f>] [--open]` | The map (C14) |
| `capsules codeowners` | Prints suggested CODEOWNERS lines for `.capsules/**` (including `approvals.lock`) and check files |
| `capsules doctor` | Proves we don't affect the app: lists every file we touched (from `installed.json`), confirms none is in `build.outputs` or app code, confirms `package.json` is unchanged by us, then runs `build.command` and `build.test` and reports the results |
| `capsules remove [--yes]` | Removes everything in `installed.json`, un-merges our hook entries, and removes the AGENTS.md block. Leaves `.capsules/` unless `--all` |

Every command supports `--json`, with a versioned schema (`"format": "0.1"`). Text output contains no colours unless the output is a terminal, and no timestamps unless asked for.

## C16. Context pack (`capsules context`)

Assembled by distance, nearest first. When over budget, the far rings shrink first.

| Distance | Content |
| --- | --- |
| The capsule itself | Everything |
| Ancestors up to root | Intents and `scope: tree` contracts, one line each |
| Concerns covering its files | Contracts and context |
| Children | Contracts and interfaces (`code` nodes) |
| Siblings and `uses` targets | Titles and contracts, one line each |
| Linked decisions | Reasons and rejected options |
| Warnings first | Stale links, failing checks, assumptions past review |

`--for judge` adds the diff versus `--base`, and the list of contracts to judge (C13).

## C17. Pull request summary (GitHub Action)

```text
Capsules: billing.invoices, web
Intent:     no change
Contracts:  + billing.invoices#C4 "A refund never exceeds the amount charged" (needs owner approval)
Decisions:  + billing.invoices#D9 (supersedes D7)
Checks:     12 pass, 0 fail | Policy: OK | Stale: 2 (run `capsules status`)
Warnings:   1 skipped test added in tests/invoices/refunds.test.ts
```

It is posted as one sticky comment and updated on each push. It is computed only from the diff and the check results, with no AI involved.

## C18. Zero friction (M6a, D-030 to D-036)

### C18.1 Automatic sessions (D-030)

- `capsules init` also adds a `SessionStart` hook: `capsules hook session-start`. Claude Code runs it when a session starts, resumes, is cleared or compacted; it gets `session_id`, `source`, and `agent_type` when Claude Code was started with `claude --agent <name>` ([hooks docs, SessionStart](https://code.claude.com/docs/en/hooks)). It can't block.
- It opens (or, on resume, reopens) a work session whose id is derived from the Claude Code `session_id`: `cc-` plus the first 16 hex characters of its SHA-256. The agent is `agent_type` if `permissions.agents` lists it, otherwise `default`; the scope is that agent's `capsules`.
- It writes `export CAPSULES_SESSION=<id>` to `CLAUDE_ENV_FILE`, so every shell command Claude runs later in that session, including `git commit` and the commit-msg hook, uses this session's trailers ([hooks docs](https://code.claude.com/docs/en/hooks)). It does **not** become the repo's "current" session, so parallel Claude Code windows never take over each other's session.
- The edit hooks find the session from `session_id`, so the one rule is tracked per Claude Code session exactly as before (D-024).
- `capsules work <pattern> [--agent <name>]` run inside such a session narrows that same session (same id, same tracking) instead of starting a new one.
- Its stdout tells Claude, in two lines, which session and role it has and to run `capsules explain <file>` before changing a file.

### C18.2 End-of-task fast checks (D-031)

The `Stop` report also runs, against the base (C6.4), the parts of `capsules check` that need no tests: validation, lock, compiled files, permissions and the one rule, append-only decisions, weakened-test signals. It reports anything CI would fail on, and says `run capsules check to run your tests` when the working tree has uncommitted code changes. It never runs check commands. Running the tests at the end of a task is v1 (Part H).

### C18.3 Proposals (D-032)

- `capsules propose <address|check-file> --why <reason> [--text <new text>]` writes one new file to `.capsules/_proposals/`. Agents use it to propose a change to an intent, contract, example or check, or to leave a note that a test looks wrong, instead of editing it or stopping.
- File name: `<capsule>--<node-or-file-slug>--<n>.md`, with the next free `<n>`. Content: front matter `{target, kind: change|new|note, by, session}`, then `## why` and, with `--text`, `## suggested text`. No timestamps.
- Any role but `judge` may create a proposal. Changing or deleting an existing proposal is owners only (E027). Proposals never change a rule: an owner, or the drafter on an owner's instruction, applies the text, then runs `capsules review done <proposal>` to remove the file. Applying a proposal automatically is v1 (Part H).
- `capsules check` and `status` report each open proposal as `W112`.

### C18.4 `capsules review` and `approvals.lock` (D-033)

- `capsules review` lists everything waiting for a human, in plain words, versus the base (C6.4) plus uncommitted changes:
  1. **In full, first (risky):** changed or new intents, contracts and examples (old and new text), changed or deleted existing checks (the diff), new checks still unreviewed (the check and its file), and open proposals (the reason and suggested text).
  2. **One line each, last (routine):** stale links, stale prompts, assumptions past review, orphans, new decisions and context.
- Each item has a short id (`r1`, `r2`, …). `capsules review approve <id…>` approves those items; `capsules review approve --routine` approves only the routine items and never a rule, intent, example or check. Approving a stale link re-pins that one link. Approving a risky item records it in `approvals.lock`.
- `.capsules/approvals.lock` is tool-written, line-based, sorted, LF:
  ```text
  # approvals.lock v1. Written by `capsules review approve`. Do not edit by hand.
  node billing.invoices#C4 a91f2c81d0b4
  file billing.invoices#refunds tests/invoices/refunds.test.js 8d3f0e1a9b27c4d6e5f8a0b1c2d3e4f5a6b7c8d9
  ```
  An approval holds only while the node's hash (or the file's blob hash) is the one approved. An approved item no longer appears in `review`, is no longer "unreviewed", and gets no `W108`.
- **Humans only.** `review approve`, `review done` and `mode` refuse to run when `CAPSULES_SESSION` or `CLAUDECODE` is set (inside an agent's shell); `pre-bash` blocks them too; direct edits to `approvals.lock` are blocked like `capsules.lock`. In CI, each commit that changes `approvals.lock` must be made by an owner of every capsule whose records it adds or changes (C5.3, as for `Capsule-Cosmetic`), or it is `E033`. An agent with a shell can get around the local refusals; CI and CODEOWNERS are the gate (B13).

### C18.5 Gentle mode (D-034)

- `mode: gentle` turns only these `E027`s into `W111` warnings, in the hooks and in CI: an edit outside the agent's `capsules` scope, and an edit to a file covered by one of its `blocked-by` concerns.
- Everything else stays blocked in every mode: changing or deleting existing checks, the one rule (V1, V2), append-only decisions, edits to the guard (`edit-config`, `edit-permissions`, tool-written and generated files), changes to intents, contracts and examples without `propose-*`, and unknown agents.
- `init` writes `mode: gentle` into a **new** `config.yaml`; a missing `mode` means `strict`, so existing installs don't change.
- Hooks record each `W111` in `.capsules/_cache/gentle-log.jsonl` (this machine only). `capsules mode` prints the mode and that list ("what strict mode would have blocked"); `capsules mode strict` sets `mode: strict` in `config.yaml`, keeping its comments. Humans only (C18.4).
- The reminder after 7 days (counted from the Git date of the commit that added `.capsules/config.yaml`) is v1 (Part H).

### C18.6 Starter checks (D-035)

When the app has few or no tests, `/capsules-draft` may write a few starter checks: only for examples the human approved, only as **new** test files using the app's existing test runner (or Node's built-in `node --test` for JavaScript with none), each with a `check` node whose `run:` is a real command. Check files added by a session whose role is `drafter` are "unreviewed" until an owner approves them (C18.4).

### C18.7 When blocked, keep going (D-036)

Every hook block message ends with what to do next: don't try another way around the block; carry on with the rest of the task; if a test or rule looks wrong, run `capsules propose <it> --why "<reason>"`. The compiled agent files, the skill and the commands say the same.
