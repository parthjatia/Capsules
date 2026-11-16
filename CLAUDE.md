# CLAUDE.md: Capsules

> **Read this whole file before you do anything in this repository.**
> It is the source of truth for what we are building, why, and how we work here.
> If a task would contradict this file, stop and ask Parth first.
> If you change a rule in this file, say so in your reply and log it in `docs/DECISIONS.md`.

---

## 0. How this file is organised

| Part | What it covers | Who it is for |
| --- | --- | --- |
| A | The problem, the idea, and what the critiques taught us | Parth and Claude |
| B | Product decisions frozen for v0.1 | Both |
| C | The v0.1 spec: file formats, rules, commands | Claude (and anyone building) |
| D | Architecture and repo layout | Claude |
| E | Build plan, milestone by milestone | Both |
| F | Testing, quality and shipping | Claude |
| G | How to work with Parth | Claude |
| H | What we are **not** building yet | Both |
| I | Known limits, glossary, references | Both |

**In one sentence:** Capsules is a free, open-source command-line tool that keeps a Git-stored, nested record of what each part of an AI-built app is meant to do. It shows people and agents that record, and it blocks AI agents from quietly breaking it. The tool itself never calls an AI.

---

# PART A: The problem and the idea

## A1. The problem

- AI coding agents now write a large share of code. In Sonar's 2026 survey of over 1,100 developers, AI accounted for 42% of committed code, 96% did not fully trust it, and only 48% always checked it before committing ([Sonar, Jan 2026](https://www.sonarsource.com/company/press-releases/sonar-data-reveals-critical-verification-gap-in-ai-coding/)).
- Founders who code a lot with Claude Code or Cursor can build a complex app in a few hours. Afterwards nobody, human or agent, has a reliable overview of what each part is for.
- Four things break:
  1. **Agents forget.** Each session starts with a context window, not a memory. Agents guess intent and re-suggest ideas that were rejected before.
  2. **Humans lose the overview.** They see diffs, never the shape of the whole.
  3. **Nothing measures drift.** Tests say whether code does what the tests check. Nothing says whether the app still does what it was built for.
  4. **The builder can edit its own judge.** An agent can make a failing test pass by weakening the test. When prompts write prompts and agents edit their own instructions, "all green" stops meaning anything.
- This is a **comprehension and trust** problem, not a code-review problem. Review asks "is this diff OK?" We ask "what is this system, and is it still what we meant?"

## A2. Why existing tools don't solve it

| Tool | What it does well | What it lacks for this job |
| --- | --- | --- |
| CLAUDE.md / AGENTS.md / Cursor rules | One instruction file the agent reads | No structure, no owners, no checks, no fingerprints. It goes stale silently and anyone, including the agent, can edit it |
| OpenSpec, Spec Kit, Kiro | Plan the *next* change as a spec | Flat, not nested. No rules on who may change what, no enforcement after merge |
| Entire, Agent Trace, git-ai | Record *what happened* (which session wrote what) | Don't judge whether it was right, and don't hold what each part is meant to be |
| CodeRabbit, Claude Code Review, Copilot review | Judge one diff at a time | No lasting record of intent to judge against |

**Our gap is enforcement plus a lasting, nested record.** Nobody blocks a merge because a contract broke, an existing test was weakened, or a payments rule was violated by an agent with no business touching payments code. Entire and OpenSpec users are our easiest early users: we import their files and read their records.

## A3. The idea: capsules

- A **capsule** is a small Markdown file describing one part of the software: what it is for, which rules must stay true, how they are checked, and why it is built this way.
- **Area capsules nest** like the product does: root → billing → billing.invoices.
- **Concern capsules cut across** the tree: `pii`, `payments`, `auth`, `logging`. One concern can cover files in many areas.
- Every app file has **exactly one home** (area) capsule and **any number of concerns**. A file must satisfy the rules of its home capsule, every ancestor of it, and every concern that covers it.
- Each capsule has **layers**, and each layer has a different author and change rule:

| Layer | Holds | Written by | May change |
| --- | --- | --- | --- |
| Intent | What this part is for, in plain words | Humans (agents may propose) | Owners only |
| Contracts and examples | Rules that must stay true, plus concrete examples of them | Agents draft, owners approve | Only with owner approval |
| Checks | Commands that prove each contract (tests, scripts) | Agents may *add*; changing existing ones needs approval | Existing checks are protected |
| Decisions | Why it's built this way, what was rejected, what it assumes | Agents, as they work | Append-only: replaced, never edited |
| Context | Background an agent needs: conventions, pitfalls | Agents | Freely |
| Implementation | Code, prompts, configs | Agents | Freely, while all checks pass |

- **The one rule:** a single change, or a single agent session, may never both change an *existing* check and the code that check judges. The same applies to a contract and the intent it serves. In plain words: no one grades their own homework.
- **Git does the storing.** Capsules are plain files committed with the code. History, branches and time travel come from Git. We add only a lockfile of hashes and a cache that can be deleted at any time.
- **The tool makes no AI calls.** It is deterministic: it reads files, follows links, compares hashes, runs the user's own test commands, and blocks edits. Anything that needs thinking (drafting capsules, writing the map's words, judging whether a change kept a contract) is done by **the user's own agent** (Claude Code, Cursor, Codex) through commands the tool installs.

## A4. What the critiques taught us, and how the design answers them

| Critique | Our answer in v0.1 |
| --- | --- |
| The judge is still the builder | Existing checks are protected from builder sessions. The one rule works per *session*, not per pull request. The judge runs as a separate, read-only sub-agent. Tests stay the hard gate; the AI judge is advice |
| Approval fatigue: people click "approve" without reading | Humans approve only intent, contracts and examples, which are a handful per capsule. Everything else is automatic |
| Solo founders are owner and parent owner at once | `solo: true` turns "needs a second person" into a warning. Still blocked: one session touching both code and an existing check |
| Hidden checks leak and annoy | Not in v0.1. Hidden checks come later, in a paid vault outside the repo |
| Software isn't a tree | Concern capsules cut across the tree, and file membership is set by patterns, not folders |
| Fingerprints flag typos as changes | Owners can mark a change as cosmetic (`capsules relock --cosmetic`), so dependents aren't flagged |
| Agents "refreshing" stale items drift the record toward the code | Agents may refresh context and implementation only, never contracts or existing checks |
| Two pull requests per feature means people switch it off | No two-PR rule. Builders may add **new** tests alongside code; only changing or deleting **existing** checks is protected |
| 70% of this exists already (CODEOWNERS, branch protection) | We build on top of them. `capsules codeowners` generates the lines, and we add what they can't do: agent-aware sessions, concerns, staleness and weakened-test detection |
| The scope is about 10 products | v0.1 is one CLI with a small, finished scope (Part E). Everything else is in Part H |
| This category has a graveyard (UML, DOORS, ADRs) | The bet is that agents keep the links current at near-zero cost. v0.1 exists to test exactly that on real repos |
| It must not affect the app | All files live in `.capsules/` plus clearly marked agent files. No app code, `package.json` or build config is touched. `capsules doctor` proves it and `capsules remove` undoes it |

## A5. Who it's for and how it makes money (context only)

- **First users:** startup founders who code heavily with Claude Code or Cursor. Parth knows several; they are the design partners.
- **v0.1 is free and open source** (format, CLI, GitHub Action, agent files).
- **Later, paid:** a hosted vault for hidden checks, scheduled heavy checks, history and dashboards across repos, and signed audit exports for regulated companies. None of this is in v0.1, and **no v0.1 code may depend on a server we run.**

## A6. The three promises of v0.1

1. **Understand.** `capsules map` and `capsules explain` show what each part is for, how parts nest, and which concerns cut across which files.
2. **Protect.** Hooks and CI stop agents from weakening existing checks, editing protected layers, or touching capsules they have no permission for.
3. **Remember.** Decisions and rejected options are kept, agents see them before working, and the lockfile shows exactly when context has gone out of date.

---

# PART B: Product decisions frozen for v0.1

Change these only with Parth's agreement, and log every change in `docs/DECISIONS.md`.

| # | Decision | Why |
| --- | --- | --- |
| B1 | **The tool never calls an AI and never makes network requests.** No LLM SDKs, no telemetry, no update checks | Trust, privacy, no model bills; deterministic output |
| B2 | **The judge is the user's own agent**, run as a separate read-only sub-agent. Its verdict is advice; tests block | No AI calls of our own (B1); honest about same-model limits |
| B3 | **Git is the only storage.** No database. Everything except the lockfile can be rebuilt from files | Plug and play; no new tracking system |
| B4 | **All capsule files live in one folder, `.capsules/`, at the repo root.** This changes V2, which had one `CAPSULE.md` per source folder | Nothing can be picked up by bundlers, docs generators or static-site builds |
| B5 | **Never touch app code, `package.json`, lockfiles or build config.** Every file we create or change is recorded in `.capsules/installed.json` and can be removed | "Must not affect normal functionality" |
| B6 | **Area capsules nest by their folders inside `.capsules/`. Concern capsules live in `.capsules/_concerns/`.** Membership comes from `covers:` patterns | Nesting stays simple; concerns cut across freely |
| B7 | **Addresses are `capsule#node`**, for example `billing.invoices#C1` or `pii#P1` | Unambiguous; dots belong to capsule ids |
| B8 | **Permissions live in `.capsules/permissions.yaml`** (this replaces V2's `capsule.policy`) | One clear place for roles, agents, scopes and owners |
| B9 | **The one rule is defined exactly as in C6**, per commit and per agent session | Enforceable without AI |
| B10 | **Solo mode** (`solo: true`) turns "needs another person's approval" into a warning, but never relaxes the one rule | Most first users are solo or tiny teams |
| B11 | **The hash pipeline is frozen** (C7): SHA-256 of a normalised node, stored as 12 hex characters | Identical on macOS, Linux and Windows |
| B12 | **`capsules lock` never silently re-pins a link.** Only `refresh` or `relock --cosmetic` do | Staleness can't be hidden by accident |
| B13 | **CI is the real gate.** Agent hooks and Git hooks are helpful, but can be bypassed | Honest security model |
| B14 | **TypeScript on Node 20+, published to npm** (`npx`), plus a GitHub Action | Fastest path; same route as OpenSpec |
| B15 | **The map is part of v0.1**, generated deterministically from the files | Understanding is the original idea and gives value on day one |
| B16 | **Language-agnostic.** Checks are shell commands. Language-specific logic exists only in optional weakened-test patterns | Works for any stack |

---

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
- **Ids** are lowercase letters, digits and `-`, separated by `.`.

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
| `status` | `active` or `draft` | no (default `active`) | Draft capsules report but never block |

### C2.2 Heading grammar

```text
## <type> <id>( <link-type> <ref>(, <ref>)*)*
```

- `<ref>` is `@<node-id>` (same capsule) or `@<capsule-id>#<node-id>` (another capsule).
- Body **fields** are `key: value` lines at the start of the body. The first line that isn't a known field starts free text. Fields may repeat where noted.
- `checked-by:` may appear as a field or as a heading link. Both mean the same thing.

### C2.3 Node types

| Type | Id format | Allowed links | Fields | Notes |
| --- | --- | --- | --- | --- |
| `intent` | `I<n>` | none | none | Plain words, one idea |
| `contract` | `C<n>` | `serves` (intent), `checked-by` (check) | `scope: tree\|own` (default `tree`) | `tree`: applies to this capsule's files and all its descendants' files |
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
| W101 | Tracked file has no home capsule (orphan); see `ignore` in config |
| W102 | Contract has no `serves` intent |
| W103 | Contract or example has no check |
| W104 | Stale link (C7.4) |
| W105 | Assumption past its `review-by` date |
| W106 | `code` path does not exist |
| W107 | Weakened-test signal (C9) |
| W108 | Change needs owner approval (solo mode) |

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
rules:     web#C1, root#C1, payments#Y1, payments#Y2, pii#P1
checks:    web#checkout-e2e, payments#no-double-charge, pii#no-pii-logs
may edit:  default, capsules-drafter (context only)
blocked:   frontend-agent (concern: payments), billing-agent (outside its scope)
decisions: web#D2 (rejected: client-side tax calculation)
```

## C4. `config.yaml`

```yaml
format: 0.1
agents: [claude-code]              # claude-code | cursor | agents-md
ignore:                            # files that need no capsule
  - ".capsules/**"
  - ".claude/**"
  - ".cursor/**"
  - ".github/**"
  - "*.md"
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
  parth: { github: "<github-handle>", owns: ["**"] }
roles:
  builder:
    may: [edit-code, add-checks, edit-context, add-decisions]
  drafter:
    may: [edit-context, add-decisions, add-checks,
          propose-intent, propose-contracts, propose-examples]
  judge:
    may: [read]
agents:                            # names match Claude Code sub-agent names where possible
  default:         { role: builder, capsules: ["**"] }
  billing-agent:   { role: builder, capsules: ["billing", "billing.**"] }
  frontend-agent:  { role: builder, capsules: ["web", "web.**"], blocked-by: [payments, pii] }
  capsules-judge:  { role: judge,   capsules: ["**"] }
  capsules-drafter: { role: drafter, capsules: ["**"] }
```

### C5.1 Actions

| Action | Covers |
| --- | --- |
| `edit-code` | Implementation files and `code` nodes |
| `add-checks` | New check files, new `check` nodes, or purely additive lines in existing check files |
| `change-checks` | Modifying or deleting existing checks. Humans only, unless explicitly granted |
| `edit-context` | `context` nodes |
| `add-decisions` | New `decision` and `assumption` nodes. Existing decisions are immutable for everyone |
| `propose-intent`, `propose-contracts`, `propose-examples` | Change those nodes. CI then requires owner approval (warning in solo mode) |
| `edit-permissions`, `edit-config` | Humans only |
| (none) | Generated agent files: only `capsules compile` writes them |

Owners may do everything in capsules they own. Humans who aren't owners act as `default`.

### C5.2 Resolving one edit

Input: file `F`, actor `A` (agent name or human), and its role `R`, `capsules` patterns `S` and `blocked-by` list `B`.

1. **Classify the change:**
   - `F` matches `checks.files` or a check's `files`, and existed at the base → existing check (`change-checks`, or `add-checks` if purely additive).
   - `F` is new and a check file → `add-checks`.
   - `F` is under `.capsules/` → parse before and after, diff the nodes, and map each changed node to its action. Front matter changes need `propose-contracts`.
   - `F` is a generated file → only `capsules compile` may write it.
   - Otherwise → `edit-code`.
2. **Find the capsules:** the home of `F` (C2.7), or the capsule whose file is being edited.
3. **Allow only if** `R` allows the action, **and** the home capsule matches a pattern in `S`, **and** none of `F`'s concerns is in `B`.
4. `propose-*` actions are allowed locally, then flagged for owner approval in CI.

## C6. The one rule (exact)

### C6.1 Change unit

A **change unit** is one commit. In CI, it is also all commits in the pull request that share the same `Capsule-Session` trailer. Commits without trailers are treated as human commits, checked per commit.

### C6.2 Violations

For each capsule `X` in a change unit:

- **V1, code and its judge.** The unit touches implementation files whose home is `X`, or which a concern `K` covers. It also **modifies or deletes an existing check** that judges `X`: a check node in `X` or in `K`, a check linked by `checked-by` from `X`'s contracts, or an existing check file covered by `X`.
  - Adding new checks is not a violation (`one-rule.new-checks-with-code: allow`), but new checks are marked "unreviewed" until a human or a separate session confirms them.
- **V2, rule and its reason.** The unit changes a contract or example in `X` and also changes an intent that contract `serves`.
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
5. Front matter gets its own `capsule` hash: the normalised YAML, re-serialised with sorted keys.

### C7.2 Lockfile format: `.capsules/capsules.lock`

Line-based, sorted, LF line endings, trailing newline. Records are sorted by kind (`capsule`, `node`, `link`, `file`), then lexically.

```text
# capsules.lock v1. Generated by `capsules lock`. Do not edit by hand.
capsule billing.invoices 5b2e90c1d7aa
node billing.invoices#C1 contract a91f2c81d0b4
node pii#P1 contract 3c07aa12e9f1
link billing.invoices#D7 serves billing.invoices#C1 a91f2c81d0b4
link billing.invoices#idempotency uses billing.invoices#C1 a91f2c81d0b4
file billing.invoices#invoice-agent prompts/invoice-agent.md 8d3f0e1a9b27c4d6e5f8a0b1c2d3e4f5a6b7c8d9
```

The last field of a `link` record is the hash of the target **at the moment the link was pinned**. `file` records use Git's blob hash (`git hash-object`).

### C7.3 Commands that write the lock

- `capsules lock`: updates `capsule`, `node` and `file` records. Adds `link` records for new links, pinned to the current target hash, and removes records for deleted links. **It never re-pins an existing link.**
- `capsules refresh <address>`: re-pins the links **from** that node, after its author has updated it.
- `capsules relock --cosmetic <address>`: re-pins every link **to** that node, declaring the change cosmetic. Owners only; adds a `Capsule-Cosmetic: <address>` trailer to the commit.

### C7.4 Staleness

- **Stale link:** the pinned hash ≠ the target's current hash (`W104`, or an error if `stale-links: block`).
- **Stale prompt:** a `file` record's blob hash ≠ the current blob hash. Contracts about that prompt need re-checking.
- **Out-of-date lock:** `capsule`, `node` or `file` records ≠ current (`E010`). CI fails until someone runs `capsules lock`.

## C8. Sessions, agent identity and commit trailers

- **Claude Code sub-agents.** Hook input includes `agent_type` when a hook fires inside a sub-agent ([source](https://blakecrosley.com/blog/claude-code-hooks-explained)). If it matches a key in `permissions.agents`, that's the actor.
- **Main session:** `capsules work <capsule-pattern> [--agent <name>]` writes `.capsules/_cache/sessions/<id>.json` with `{id, agent, role, capsules, started}` and makes it the current session. `capsules work --end` closes it. The environment variable `CAPSULES_SESSION=<id>` selects a session when several run in parallel.
- **No session:** the actor is `default`.
- **Commit trailers**, added by the optional `commit-msg` Git hook from the current session, or by the agent following the installed commands:
  ```text
  Capsule-Session: 7f3c…
  Capsule-Agent: billing-agent
  Capsule-Role: builder
  Capsule-Scope: billing.**
  ```
- CI reads the trailers. **They can be forged**, so changes to protected layers also need owner approval on GitHub (CODEOWNERS plus branch protection). `capsules codeowners` prints the suggested lines.

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

Generated files start with `<!-- Generated by capsules from .capsules/. Do not edit. Run: capsules compile -->`.

| Agent | Files we write | Scoping |
| --- | --- | --- |
| Claude Code | `.claude/rules/capsules-overview.md` (no `paths`, always loaded); `.claude/rules/capsules-<capsule-id>.md` with front matter `paths:` = the capsule's `covers` | Claude Code loads path-scoped rules only when working on matching files ([docs](https://code.claude.com/docs/en/claude-md.md)) |
| Cursor | `.cursor/rules/capsules-overview.mdc` (`alwaysApply: true`); `.cursor/rules/capsules-<id>.mdc` with `globs:` | Verify the current Cursor rule format before building |
| AGENTS.md (Codex and others) | A managed block between `<!-- capsules:begin -->` and `<!-- capsules:end -->`, only if `agents-md` is enabled | No path scoping: the block tells the agent to run `capsules explain <file>` and `capsules context <file>` |

Each per-capsule rule file contains, in this order:

1. title and intents
2. contracts that apply: its own, inherited ones and those from concerns, with addresses
3. examples
4. context, with transclusions resolved
5. decisions in brief, with **rejected options** called out
6. "What you may edit / must not edit / how to propose a change", taken from permissions

If a file would exceed `rules.max-chars`, the far content (ancestors) shrinks to one line each, deterministically.

`capsules compile --check` exits non-zero if any generated file differs from what it would generate (`E011`).

## C11. Agent hooks (Claude Code first)

Installed by merging into `.claude/settings.json`. **Never overwrite** the user's settings: keep their hooks, add ours, and record exactly what we added in `installed.json`.

| Event and matcher | Command | Behaviour |
| --- | --- | --- |
| `PreToolUse`, `Edit\|Write\|MultiEdit\|NotebookEdit` | `capsules hook pre-edit` | Simulate the edit, classify it (C5.2), check permissions and the one rule for the current session. Block with a clear reason if not allowed |
| `PreToolUse`, `Bash` | `capsules hook pre-bash` | Best effort: block obvious writes to protected paths (`rm`, `sed -i`, `>`, `mv` into `.capsules/`, check files, generated files). Otherwise allow |
| `Stop` | `capsules hook stop` | Report only: validation errors, stale links, orphans, and the suggested next command. Always exit 0 in v0.1 |

Hook protocol facts (verify against [Claude Code hooks docs](https://code.claude.com/docs/en/hooks) before building):

- Input is JSON on stdin, with `tool_name`, `tool_input` (for example `file_path`, `content`, `old_string`, `new_string`), `session_id`, `cwd`, and `agent_type` inside sub-agents.
- **To block: write the reason to stderr and exit with code 2.** Exit code 1 does **not** block ([source](https://blakecrosley.com/blog/claude-code-hooks-explained)).
- Hooks must be fast. Target under 150 ms on a 1,000-file repo; cache the parsed index in `_cache/`.
- If our hook crashes: with `on-error: open`, print a warning and exit 1, which shows the error and continues. With `closed`, exit 2. Never leave the user's agent stuck because of our bug.

## C12. Agent commands, skill and judge

Installed under `.claude/` (verify the current Claude Code formats for commands, skills, plugins and sub-agents before building):

| File | Purpose |
| --- | --- |
| `.claude/commands/capsules-draft.md` → `/capsules-draft [area]` | The agent reads code, Git history, the README and existing CLAUDE.md, AGENTS.md or OpenSpec files. It proposes a capsule tree and concerns, writes `.capsules/*.md` as the `capsules-drafter` agent, runs `capsules check --no-run`, and then shows the human the **intents and examples in plain language** for approval. It never invents checks; checks must point to real commands |
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
- It shows:
  - the area tree with titles and intents
  - concerns, and which capsules and files they cover
  - per capsule: number of contracts, check status from `last-check.json`, stale links, orphans nearby
  - a search box over files: type a path and see its `explain` result
- `--format mermaid` prints a Mermaid graph, for READMEs and pull requests.
- `--format json` prints the full graph for other tools.

## C15. CLI reference

Exit codes: `0` OK · `1` problems found (errors, failing checks, violations) · `2` used only by `capsules hook` to block · `64` usage error · `70` internal error.

| Command | What it does |
| --- | --- |
| `capsules init [--agents …] [--yes] [--git-hooks] [--workflow]` | Shows a plan of every file it will create or change, asks to confirm, then creates `.capsules/`, compiles agent files, merges hooks, and installs commands and agents. Optionally adds the commit-msg hook and `.github/workflows/capsules.yml`. Writes `installed.json` |
| `capsules check [--base <ref>] [--all] [--no-run] [--ci] [--json]` | Validate → lock up to date → compiled files up to date → permissions and the one rule on the diff → append-only decisions → weakened-test signals → run checks for affected capsules |
| `capsules status` | Stale links, stale prompts, orphans, unreviewed checks, assumptions past review, last check results |
| `capsules explain <file>` | Home, parents, concerns, rules, checks, who may edit, related decisions |
| `capsules context <capsule\|file> [--budget <tokens>] [--for judge\|builder]` | Prints the context pack (C16). Tokens are estimated as characters ÷ 4 |
| `capsules impact <address>` | Everything that depends on a node |
| `capsules why <address>` | Decisions behind a node, with rejected options |
| `capsules lock` · `refresh <address>` · `relock --cosmetic <address>` | Lockfile (C7.3) |
| `capsules work <pattern> [--agent <name>]` · `work --end` | Sessions (C8) |
| `capsules compile [--check]` | Agent files (C10) |
| `capsules hook <pre-edit\|pre-bash\|stop>` | Called by agent hooks only |
| `capsules verdict record --file <f>` · `verdict show [commit]` | Verdicts (C13) |
| `capsules map [--format html\|mermaid\|json] [--out <f>]` | The map (C14) |
| `capsules codeowners` | Prints suggested CODEOWNERS lines for `.capsules/**` and check files |
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

---

# PART D: Architecture and repo layout

## D1. How data flows

```text
.capsules/*.md ─┐
config.yaml     ├─► parse ─► model ─► resolve links ─► membership (git ls-files + globs)
permissions.yaml┘                          │
                                           ▼
                              graph index (_cache, rebuildable)
            ┌──────────────┬──────────────┼───────────────┬──────────────┐
            ▼              ▼              ▼               ▼              ▼
         hash/lock    permissions +    checks runner    compile        map / explain
         staleness    one rule (diff)  + heuristics     (agent files)  / context / impact
            │              │              │               │
            └──────────────┴───────┬──────┴───────────────┘
                                   ▼
                         report (text / json) ─► CLI, hooks, GitHub Action
```

## D2. Source layout of this repo

```text
capsules/
├── CLAUDE.md                 # this file
├── README.md                 # for users: what, why, 5-minute start
├── LICENSE                   # Apache-2.0 (to confirm with Parth)
├── package.json              # name: @<npm-handle>/capsules, bin: capsules
├── tsconfig.json
├── src/
│   ├── cli/                  # commander setup; one file per command
│   ├── core/
│   │   ├── parse.ts          # front matter + mdast → nodes, with file:line positions
│   │   ├── model.ts          # types: Capsule, Node, Link, Address
│   │   ├── resolve.ts        # addresses, links, transclusion
│   │   ├── membership.ts     # globs → home + concerns per file
│   │   ├── hash.ts           # C7.1 pipeline
│   │   ├── lock.ts           # read/write/diff capsules.lock
│   │   ├── permissions.ts    # C5 resolution
│   │   └── onerule.ts        # C6 change units and violations
│   ├── git/                  # thin wrapper over the git CLI
│   ├── checks/               # runner.ts, heuristics.ts
│   ├── compile/              # claude.ts, cursor.ts, agentsmd.ts
│   ├── hooks/                # pre-edit.ts, pre-bash.ts, stop.ts
│   ├── install/              # init.ts, remove.ts, doctor.ts, manifest.ts, settings-merge.ts
│   ├── map/                  # html.ts (template), mermaid.ts, json.ts
│   └── report/               # text.ts, json.ts, messages.ts (all user-facing wording)
├── templates/                # commands, sub-agents, skill, workflow, rules overview
├── action/action.yml         # GitHub Action wrapper around `capsules check --ci`
├── docs/
│   ├── SPEC.md               # Part C, kept identical
│   ├── DECISIONS.md          # numbered log of decisions and changes
│   └── PROGRESS.md           # done / next / how to demo
├── test/
│   ├── unit/
│   ├── e2e/                  # creates temp git repos, runs the real CLI
│   └── fixtures/
├── examples/billing-demo/    # tiny app with invoices, checkout, users, tests and capsules
└── .capsules/                # we use capsules on this repo itself
```

## D3. Stack and dependency rules

- **Runtime:** Node 20+ LTS, TypeScript `strict`, ESM.
- **Libraries** (small, popular, no install scripts):
  - `commander` (CLI)
  - `unified`, `remark-parse`, `remark-frontmatter` (Markdown)
  - `yaml`
  - `picomatch` (globs)
  - `zod` (schemas)
- **Git and checks:** spawn the `git` CLI and check commands with Node's `child_process`.
- **Build and test:** `tsup` to bundle, `vitest` to test, `eslint` and `prettier` to lint and format.
- **Forbidden dependencies:** any LLM or AI SDK (`openai`, `@anthropic-ai/sdk`, `langchain`, `ai`, and similar), any HTTP client, any telemetry, any package with a `postinstall` script. A test in `test/unit/no-network.test.ts` fails if `src/` imports `http`, `https`, `net`, `fetch` or a forbidden package.
- **Paths:** always use `/` internally. Convert on Windows at the edges.

---

# PART E: Build plan

Each milestone must be a finished, demoable product. **Don't start the next milestone until Parth has seen the demo and said go.**

| # | Milestone | Done when | Demo for Parth |
| --- | --- | --- | --- |
| M0 | Scaffold | Repo, CI (lint, test, build on ubuntu, macos, windows), `capsules --version`, `docs/SPEC.md`, `docs/PROGRESS.md`, our own `.capsules/` | `npx . --version` prints a version |
| M1 | Read and explain | Parser, validation codes, membership, `explain`, `status` (orphans), `check --no-run` | In `examples/billing-demo`: `capsules explain src/web/checkout.tsx` shows its home, concerns and rules |
| M2 | Lock and freshness | Hash pipeline, `lock`, `refresh`, `relock --cosmetic`, staleness in `status` and `check` | Edit the text of contract C1, run `capsules status`, and see exactly which items are now stale |
| M3 | Guard in CI | Checks runner, the one rule, append-only decisions, weakened-test signals, permissions via trailers, `check --base`, JSON output | One commit that changes code and removes an assertion from an existing test → `capsules check` fails with the plain message from C6.2 |
| M4 | Agent integration | `compile`, hooks, sessions, commands, judge and drafter sub-agents, skill, `verdict`, `init`, `remove`, `doctor`, `installed.json` | In Claude Code, ask "make the failing test pass by editing the test" → the hook blocks it and explains why. `capsules doctor` shows the app builds and tests the same |
| M5 | Map | HTML, Mermaid and JSON formats | Open `map.html`: the tree, concerns and a working file search |
| M6 | Ship v0.1.0 | GitHub Action with sticky summary, release workflow, README, demo repo, a 45-second demo script | Parth approves → tag `v0.1.0` (never without his OK) |

**First real test after M4:** install on Parth's own app and two design partners' repos for two weeks. Track:

- bad edits blocked
- weakened tests caught
- judge verdicts that turned out right
- whether agents keep capsules current without being asked
- whether anything about the app changed (it must not)

---

# PART F: Testing, quality and shipping

## F1. Tests

- **Unit tests** for parse, hash, lock, membership, permissions and the one rule. Write them **before** the code for these modules.
- **End-to-end tests** create temporary Git repos with scripted commits and run the built CLI. Required scenarios:
  1. a code change plus an assertion removed from an existing test in one commit → V1 error
  2. contract and its intent changed in one commit → V2 error
  3. contract text changed → dependents stale (`W104`); `relock --cosmetic` clears them
  4. `frontend-agent` edits a file covered by `payments` → `hook pre-edit` exits 2 with a reason
  5. a skip marker added → `W107`
  6. an existing decision edited → `E009`
  7. two unrelated capsules cover one file → `E004`
  8. `init` → `doctor` → `remove` leaves the repo byte-identical to before, apart from `.capsules/` if kept
- **Hook tests** feed recorded JSON on stdin and assert the exit code and stderr.
- **Determinism:** run `lock` twice and expect identical bytes. A CRLF copy of a fixture must give identical hashes. Map HTML output must be identical across runs.
- **Cross-OS** CI matrix: ubuntu, macos, windows.

## F2. Quality bars

- `capsules check --no-run` takes under 1 second on a 1,000-file repo. Hooks take under 150 ms.
- Every user-facing message lives in `src/report/messages.ts` and follows the four-part style: what, where, why it matters, fix.
- No command changes anything without saying so first. `--dry-run` works on every writing command.
- No timestamps or random values in committed files. Session ids live only in `_cache` and in trailers.

## F3. Versioning and shipping

- SemVer for the CLI. The file format is versioned separately (`format: 0.1`).
- **npm:** publish from GitHub Actions on a `v*` tag, using npm trusted publishing (check current npm docs). Users run `npx @<npm-handle>/capsules init`.
- **GitHub Action:** `uses: <github-handle>/capsules/action@v0.1`, which runs `capsules check --ci` and posts the C17 summary.
- **Claude Code plugin:** package the commands, sub-agents, skill and hooks as a plugin installable from the GitHub repo (check the current plugin and marketplace format first).
- **Never publish, tag, push or open public issues without Parth's explicit OK.**

---

# PART G: How to work with Parth

- **Parth is not a programmer.** Before each task, say in two or three plain sentences what you'll do and why. After it, say what changed and give **one command he can run** and **what he should see**.
- **Work in small steps.** One milestone at a time, tests green before moving on. Keep `docs/PROGRESS.md` current: done, next, how to demo, open questions.
- **Spec first.** If the code needs a spec change, propose it in plain words, wait for a yes, then update this file, `docs/SPEC.md` and `docs/DECISIONS.md` together.
- **Don't guess tool behaviour.** For Claude Code, Cursor, GitHub Actions or npm specifics, read the current official docs and cite the page in the pull request or progress note.
- **Explain trade-offs as choices.** When there's a real choice, offer two or three options with a recommendation, rather than picking silently.
- **Protect Parth's other projects.** Only work inside this repo. Never install global tools, change his shell config or touch other folders without asking.
- **Prove "doesn't affect the app" often.** Run the demo app's build and tests before and after every install-related change.
- **Dogfood.** This repo has its own `.capsules/`. Use `capsules work` for your own sessions once M4 exists.

---

# PART H: Not in v0.1 (and why later)

| Feature | Why later |
| --- | --- |
| Hidden checks vault (paid, outside the repo) | Needs a server; charge only once teams trust the visible checks |
| Check strength from planted bugs | Needs AI and sandboxes; noisy; later as a job the user's own agent runs |
| Rebuild fidelity and intent round trip | Most expensive; only meaningful once capsules are rich |
| Live tripwires on production metrics | Breaks "just files in Git"; v0.1 has `review-by` dates only |
| MCP server | Compiled rules plus CLI commands are enough for v0.1; add when users ask |
| Cross-repo graph, dashboards, history service | Paid product; needs real teams first |
| Language server and editor plugin | Nice to have; not needed to prove value |
| Custom Git merge driver for capsule files | Wait for real merge pain |
| Signed audit exports and regulatory policy packs | Enterprise; later |
| Cursor and Codex hooks | Claude Code first; Cursor rules are compiled already |
| Our own AI anything | Never in the open-source tool (B1) |

---

# PART I: Known limits, glossary, references

## I1. Known limits we accept in v0.1 (say these honestly in the README)

- **Read limits are soft on a local machine.** An agent with a shell can open any file. Secrets and hidden checks must not live in the repo.
- **`pre-bash` is best effort.** Clever shell commands can bypass it. CI is the gate.
- **Trailers can be forged.** Protected layers also need owner approval on GitHub.
- **The judge is usually the same model family as the builder,** in a fresh read-only context. That's better than self-review, but not independent. Tests block; verdicts advise.
- **Weakened-test signals are heuristics.** They warn by default.
- **Fingerprints see wording, not meaning.** Use `relock --cosmetic` for typo fixes. Code that depends on a rule without a reference isn't tracked; the judge and the checks cover it.

## I2. Glossary

| Term | Meaning |
| --- | --- |
| Capsule | One Markdown file in `.capsules/` describing a part of the software |
| Area capsule | A capsule in the nested tree (root → billing → billing.invoices) |
| Concern capsule | A capsule in `_concerns/` that cuts across areas (pii, payments) |
| Node | One `##` section of a capsule: intent, contract, example, check, decision, assumption, context, prompt or code |
| Address | `capsule#node`, for example `billing.invoices#C1` |
| Home | The single area capsule a file belongs to |
| Covers | Glob patterns that say which files a capsule describes |
| Lockfile | `.capsules/capsules.lock`: pinned hashes of nodes, links and prompt files |
| Stale | A link whose target changed after it was pinned |
| The one rule | No single change or session both changes an existing check and the code it judges (or a contract and its intent) |
| Session | A scoped piece of agent work: which agent, which role, which capsules |
| Judge | The user's own agent, run read-only, writing verdicts per contract |
| Verdict | kept, broken or unsure, per contract, stored as a Git note |
| Solo mode | Approval needs become warnings; the one rule still holds |

## I3. References

- Our earlier docs: [Capsules V1](https://claude.ai/artifact/Sg25eJRXJCKSfHNEjpMyuh) · [Capsules V2](https://claude.ai/artifact/Ek9VCxACcvtMqSZDQRpjdt) · [Whiteboard: how it works, like Git](https://claude.ai/artifact/BUfUVk1PnYbmENQkt93Qk3). Where these differ from this file, **this file wins** (see Part B, especially B4 and B8).
- Claude Code hooks: <https://code.claude.com/docs/en/hooks> · guide: <https://code.claude.com/docs/en/hooks-guide>
- Claude Code sub-agents: <https://code.claude.com/docs/en/subagents>
- Claude Code CLAUDE.md and path-scoped rules: <https://code.claude.com/docs/en/claude-md.md> · memory and imports: <https://docs.anthropic.com/en/docs/claude-code/memory>
- Hook exit codes explained (exit 1 does not block): <https://blakecrosley.com/blog/claude-code-hooks-explained>
- Sonar 2026 State of Code survey: <https://www.sonarsource.com/company/press-releases/sonar-data-reveals-critical-verification-gap-in-ai-coding/>
- Mutation-guided LLM tests at Meta (for the later check-strength feature): <https://arxiv.org/abs/2501.12862>
- OpenSpec: <https://github.com/Fission-AI/openspec> · Entire CLI: <https://github.com/entireio/cli>

## I4. Open questions for Parth (decide before M6)

- [ ] npm package name and GitHub handle to publish under
- [ ] License: Apache-2.0 (recommended for its patent grant) or MIT
- [ ] Should `init` install the commit-msg Git hook by default, or only with `--git-hooks`?
- [ ] Which concerns do the design partners care about most (auth, payments, PII)? These become the demo's concern capsules
- [ ] Do we support Cursor in v0.1 beyond compiled rules?
