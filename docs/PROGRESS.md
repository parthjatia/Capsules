# Progress

## Done

### M0: Scaffold

- TypeScript (strict, ESM) project `@pyscoparth/capsules`, bundled with tsup into `dist/cli.js`.
- `--version` and `--help` work. Exit codes follow C15.
- Tests for no network/no AI, SPEC.md sync, version and the CLI.
- CI on Ubuntu, macOS and Windows.
- Decisions D-001 to D-006 are logged.
- Merged into `main` (PR #1).

### M1: Read and explain

- **Parser** (`src/core/parse.ts`): front matter, `##` node headings, links, fields read anywhere by valid key (D-007), transclusions, and file:line positions.
- **Validation codes:**
  - E001–E008 and E012–E015 are errors.
  - W101, W102, W103, W105 and W106 are warnings.
  - E009–E011, W104, W107 and W108 belong to M2 to M4.
- **Membership** (`src/core/membership.ts`): each file's home capsule (the deepest one wins), the concerns covering it, orphans, and two-home conflicts.
- **Commands:**
  - `capsules explain <file>`
  - `capsules status` (counts, orphans, assumptions past review)
  - `capsules check --no-run`
  - All three support `--json`.
- **Demo app:** `examples/billing-demo` has 5 area capsules, 2 concerns, a working app and 7 passing tests.
- **Tests:** 79 tests (unit and end-to-end, using real temporary Git repos).
- **CI:** also validates this repo's own `.capsules/` and runs the demo app's tests.
- Merged into `main` (PR #3), with decisions D-008 to D-011.

### M2: Fingerprints and staleness

- **Fingerprints** (`src/core/hash.ts`): the frozen C7.1 pipeline for nodes; RFC 8785 JSON Canonicalization for front matter (D-012). The exact values are pinned in tests and cross-checked with Python.
- **Lockfile** (`src/core/lock.ts`): `.capsules/capsules.lock` in the C7.2 format, sorted, LF only, byte-identical on every run and OS.
- **Commands**, all with `--dry-run` and `--json`:
  - `capsules lock` pins new links and never re-pins existing ones (B12).
  - `capsules refresh <address>` re-pins links from a reviewed node.
  - `capsules relock --cosmetic <address>` re-pins links to a node and prints the `Capsule-Cosmetic:` line for the commit message (D-013).
- **Staleness:**
  - `status` shows the lock state, stale links and changed prompts.
  - `check` reports `E010` (lock out of date), `W104` (stale link; an error with `stale-links: block`), `W109` (prompt file missing), `W110` (stale prompt) and `E026` (unreadable lockfile).
- **Safety:** `lock` refuses to write while capsules have errors, or when the lockfile can't be read, so pins are never lost silently.
- **Lockfiles** are committed for this repo and the demo. CI fails if either goes out of date.
- **Tests:** 127 (unit and end-to-end), including F1 scenario 3 and the determinism checks.
- Merged into `main` (PR #4), with decisions D-012 to D-015.

### M3: Guard in CI (merged, PR #5)

- **The base** (`src/core/base.ts`, C6.4, D-018):
  - `--base <ref>` if given.
  - In GitHub Actions, the PR's base from the local event file.
  - Otherwise the remote's default branch, then local `main`, then uncommitted changes only.
- **Change units** (`src/core/changes.ts`, C6.1):
  - each commit;
  - each `Capsule-Session` with several commits;
  - all commits without a session trailer, together (the whole-PR unit);
  - uncommitted changes.
- **Who made a change** (`src/core/identity.ts`, C5.3, D-017): the `Capsule-Agent` trailer, else the author's email. GitHub noreply addresses map to the handle automatically, otherwise the optional `emails` list is used.
- **The guard** (`src/core/guard.ts`):
  - permissions per commit (`E027`), and owner approval for intents, contracts and examples (`W108`, which GitHub enforces, D-016);
  - the one rule (`E028`, `E029`);
  - append-only decisions (`E009`);
  - weakened-test signals (`W107`);
  - the owner check for `Capsule-Cosmetic` (`E030`).
- **Checks runner** (`src/checks/runner.ts`): runs the checks of affected capsules, or all of them with `--all`, one at a time. Failures are `E031` with the end of the output, timeouts are `E032`. On a timeout the whole process tree is stopped, so a hanging test can't freeze capsules. Results go to `.capsules/_cache/last-check.json`.
- **`check` options:** `--base`, `--all`, `--no-run`, `--ci` (exit code follows `ci.mode`) and `--json`.
- **Demo script:** `node scripts/demo-m3.mjs`.
- **CI** checks out full history, so the dogfood step guards this repo's own pull requests.
- **CI workflows** (`.github/workflows/**`) and `.capsules/config.yaml` are owners only (D-020).
- **Windows CI** prints the time of every test, to spot the stall seen once during development.
- **Tests:** 176 (unit and end-to-end), including F1 scenarios 1, 2, 5 and 6.

### M4a: Agent rules, hooks and sessions (merged, PR #6)

- **`capsules compile [--check] [--dry-run]`** (`src/compile/`, C10):
  - Writes `.claude/rules/capsules-overview.md` (always loaded) and one `capsules-<id>.md` per capsule with `covers`, scoped by `paths:`.
  - Writes `.cursor/rules/*.mdc` when `cursor` is in `agents`, and a managed block in `AGENTS.md` when `agents-md` is. Text outside the block is never touched.
  - Each file holds the capsule's intents, every rule that applies (own, inherited, from concerns), examples, context with transclusions filled in, decisions with rejected options, and what agents may and must not edit. Long files shrink the far rules to one line each.
  - `capsules check` reports `E011` once agent files exist (D-024).
- **Hooks** (`capsules hook pre-edit | pre-bash | stop`, `src/hooks/`, C11):
  - `pre-edit` works out what the edit would change, checks `permissions.yaml`, append-only decisions and the one rule within the session. If it blocks, it exits 2 and the reason goes to Claude.
  - `pre-bash` blocks obvious shell writes to `.capsules/`, existing tests, generated files and CI workflows.
  - `stop` reports problems to the user and never blocks.
  - If a hook crashes, the edit goes ahead with a warning (`hooks.on-error: open`).
- **Fast start** (D-010): `capsules hook` loads only the hook code and a saved index in `.capsules/_cache/`, rebuilt only when something in `.capsules/` changes.
- **Sessions** (C8): `capsules work <capsules> [--agent <name>]` and `capsules work --end`. Inside a session, the agent is limited to those capsules. `capsules hook commit-msg <file>` adds the session trailers and any pending `Capsule-Cosmetic` line to a commit message. The Git hook that calls it is installed only with `capsules init --git-hooks`, in M4b (D-023).
- **test-maintainer agent** (D-021): may change existing tests, flagged for owner approval, but never app code, and never in the same session as a code change.
- **This repo's root capsule is now `active`**, so capsules guards its own pull requests with errors, not warnings.
- **CI** (D-022): a final `ci-ok` job; on pull requests, a macOS job that never got a runner doesn't count as a failure. CI also prints hook timings on every OS (report only).
- **Docs checked** (D-024): Claude Code [hooks](https://code.claude.com/docs/en/hooks) and [rules](https://code.claude.com/docs/en/memory), and [Cursor rules](https://cursor.com/docs/context/rules).
- **Tests:** 226 (unit and end-to-end), including F1 scenario 4.

### M4b: Install, remove, doctor, context and verdicts (merged, PR #7)

- **`capsules init`** shows a plan of every file it will create or change and asks first (`--yes` to skip asking, `--dry-run` to only look). It creates a starter `.capsules/` (a draft root capsule, so nothing blocks yet) if there is none, the Claude Code commands (`/capsules-draft`, `/capsules-work`, `/capsules-judge`), the judge and drafter sub-agents, the skill, and the compiled rules. It merges the hooks into `.claude/settings.local.json`, keeping your own settings, and keeps that file out of Git (D-026). `--git-hooks` adds the commit-msg hook, `--workflow` adds `.github/workflows/capsules.yml`. It never overwrites a file it didn't create.
- **`capsules remove`** undoes all of it, byte for byte; `--all` also deletes `.capsules/`. Tested: init, doctor, remove leaves the repo identical (F1 scenario 8).
- **`capsules doctor`** lists every file capsules touched, confirms none is app code, `package.json`, a lockfile or a build output, then runs `build.command` and `build.test`.
- **Agents can't switch their guard off:** `.claude/settings.json` and `.claude/settings.local.json` are `edit-config`, humans only, in `pre-edit`, `pre-bash` and CI (D-026).
- **`capsules context <capsule|file>`** (C16): warnings, the capsule, inherited rules, concerns, children, siblings and linked decisions, nearest first. `--budget <tokens>` shrinks the far parts first. `--for judge` adds the diff and the contracts to judge.
- **`capsules verdict record --file <f>`** checks the judge's JSON (C13) and stores it as a Git note under `refs/notes/capsules`; **`verdict show`** prints it. Advice only.
- **`capsules codeowners`** prints suggested CODEOWNERS lines.
- Docs checked: [sub-agents](https://code.claude.com/docs/en/sub-agents), [slash commands](https://code.claude.com/docs/en/slash-commands), [skills](https://code.claude.com/docs/en/skills), [settings](https://code.claude.com/docs/en/settings) (D-026).

### M5: The map (merged, PR #8)

- **`capsules map`** writes `.capsules/_cache/map.html`, one offline page (its security policy forbids network requests), identical byte for byte across runs and machines. From the top: the summary line, **Needs attention** (errors, stale rules, failing checks, unreviewed checks, orphan files, assumptions past review; each links into the tree), a **file search** that gives the same answer as `capsules explain`, the **area tree** with intents, health and concern tags, and the **concerns** (D-027).
- `--open` opens it in your browser; `--out <file>` writes elsewhere; `--dry-run` writes nothing.
- **`--format mermaid`** prints a diagram for READMEs and pull requests; **`--format json`** the whole graph.
- **`/capsules-map`** in Claude Code runs the map and explains it in plain words. `capsules init` installs it.
- Checked in a real browser (headless Edge): light and dark themes, the search, and phone width (nothing wider than 390 px).
- Takes about 1.7 s on the demo, mostly Git work to find unreviewed checks.

### M6a: Zero friction (in review, waiting for Parth's go)

- **Pull request summary** (C17): `capsules check --ci --summary <file>` writes the sticky comment's text. The **GitHub Action** (`action/action.yml`) runs it and posts or updates one comment. The workflows for this repo are in `docs/proposed-workflows/`, for Parth to copy (agents may not write `.github/workflows/`, D-020).
- **Automatic sessions** (C18.1, D-030): a `SessionStart` hook opens one capsules session per Claude Code session and gives its shell `CAPSULES_SESSION`, so commits get the right trailers and parallel windows never take over each other's session.
- **Keep going when blocked** (C18.7, D-036): every block message ends with a `next:` line: carry on, and leave a note with `capsules propose`.
- **`capsules propose`** (C18.3, D-032): an agent leaves a proposal or a note for an owner in `.capsules/_proposals/` instead of changing a rule or a test. Open proposals are `W112`.
- **`capsules review`** (C18.4, D-033): everything waiting for you, risky items in full first (changed rules, changed or new tests, proposals), routine items one line each. `review approve r1 …` records approvals in `.capsules/approvals.lock`; `--routine` never includes a rule or a test. Humans only; CI checks an owner made that commit (`E033`).
- **Gentle mode** (C18.5, D-034): new installs start with `mode: gentle`. An agent outside its area only gets a warning (`W111`); weakening tests, the one rule, rules and the guard stay blocked. `capsules mode` lists what strict mode would have blocked; `capsules mode strict` switches.
- **Starter checks** (C18.6, D-035): `/capsules-draft` may write a few new tests for examples you approved, when the app has few or none. They stay unreviewed until you approve them.
- **End-of-task fast checks** (C18.2, D-031): the Stop report says what CI would fail on and reminds Claude to run `capsules check` for the tests. It never runs them.
- **Fixed while dogfooding:** `pre-bash` now reads heredocs as data (a false block); a test file added earlier in the branch counts as new in CI too, as in the hooks (D-038).

## Speed measurements (M1, as asked in D-006)

Setup: 1,012 tracked files, 12 capsules, Windows 11, Node 24, median of 10–15 runs.

| What                                                | Time    | Target                   |
| --------------------------------------------------- | ------- | ------------------------ |
| Bare Node start (`node -e 0`)                       | 69 ms   | n/a (the floor)          |
| `git ls-files` alone                                | 31 ms   | n/a                      |
| `capsules --version`                                | 154 ms  | n/a                      |
| `capsules check --no-run`                           | 346 ms  | under 1 s: **met**       |
| `capsules explain <file>`                           | 360 ms  | n/a                      |
| A hook would cost about the same as `explain` today | ~350 ms | under 150 ms: **missed** |

Where the time goes: Node itself takes about 70 ms. Loading our 1.5 MB bundle (Markdown parser, YAML, zod) takes about 85 ms. Reading and validating every capsule plus `git ls-files` take about 200 ms. Linux and macOS usually start Node about twice as fast as Windows.

Options for the hook (Parth chose option 1, see D-010):

1. **Recommended: a small separate hook entry point plus a cached index.** `capsules hook` loads only a tiny file. It reads the parsed index from `.capsules/_cache/`, which C11 already asks for, and re-parses only when a capsule file's timestamp or size changes. Expected cost is Node start plus about 20–40 ms, roughly 100 ms on Windows.
2. **Load command code only when it's needed**, inside the one bundle. This is simpler, but it saves only the 85 ms of loading. A hook would still parse everything, at about 250 ms.
3. **Relax the target**, for example to 300 ms on Windows. This is the least work, but agents will feel the delay on every edit.

## Hook speed (M4a)

Measured with `node scripts/bench-hooks.mjs`: 1,000 extra files, Windows 11, Node 24, median of 10 runs.

| Hook       | First run (builds the index) | After that | Target (Windows) |
| ---------- | ---------------------------- | ---------- | ---------------- |
| `pre-edit` | 439 ms                       | 140 ms     | 300 ms: **met**  |
| `pre-bash` | 151 ms                       | 105 ms     | 300 ms: **met**  |

Node itself takes about 69 ms to start on this machine. CI prints the same numbers for Linux and macOS on every run.

## Next

- **M6b:** ship v0.1.0: the release workflow (npm trusted publishing), README for users, the demo repo, the 45-second demo script (`scripts/demo-45s.mjs`, draft) and the partner package rebuilt. Tag `v0.1.0` only with Parth's OK.
- **v1 (Part H):** running the tests at the end of every task, the 7-day reminder to switch to strict mode, applying proposals automatically.

## How to demo M6a

```sh
npm run build
node scripts/demo-m6a.mjs
```

It runs in a throwaway copy of the demo app and prints seven numbered steps. You should see: (1) `capsules: opened session cc-… for this Claude Code session`; (2) the refund code edit `allowed`, then the test edit `BLOCKED` with a `next:` line telling Claude to carry on; (3) `Wrote .capsules/_proposals/…` (Claude's note for you); (4) gentle mode: frontend-agent's edit on a payments file is `allowed, with:` a `W111` warning, and `capsules mode` lists it; (5) the end-of-task line `capsules: 1 proposal waiting for you, 4 stale links. Next: run capsules review.`; (6) `capsules review` showing the changed rule before and after, then the note, then **example E1** (its rule before and now, and what E1 says, D-039), then routine items; (7) approving refused in Claude's shell, then `Approved: r1` in yours, with `Next: ask the drafter to update billing.invoices#E1 (and 3 others) first`, and the new line in `approvals.lock`.

## How to demo M5

```sh
npm run build
node scripts/demo-m5.mjs --open
```

You should see the summary line `5 areas · 2 concerns · 9 rules · 4 stale · 2 checks failed` and a Mermaid diagram in the terminal, and the map opens in your browser. At the top of the page: **Needs attention (9)** with stale rules, failing checks, one unreviewed check and one file with no capsule. Click `billing.invoices` in a stale-rule line: the page jumps to that area in the tree. Type `checkout` in **Find a file**: you see `src/web/checkout.tsx` with its home, concerns, rules and who may edit it. In the tree, Web carries the tags `payments` and `pii`.

## How to demo M4b

```sh
npm run build
node scripts/demo-m4b.mjs
```

You should see: (1) the plan `init` shows before it changes anything, (2) `init --yes` finishing with the next steps, (3) `doctor` saying "your app is unaffected by capsules", (4) an agent's edit to `.claude/settings.local.json` BLOCKED with exit code 2, and (5) after `remove --all`, "The repo is exactly as before."

## How to demo M4a

From the repository root:

```sh
npm run build
node scripts/demo-m4a.mjs
```

It copies the demo app to a temporary folder, plants a bug that makes an invoice test fail, compiles the agent rules and installs the hooks there. Then it shows four edits:

1. The main agent deletes a test assertion: **BLOCKED** (`E027`, "fix the code instead").
2. The agent fixes the code, then tries to weaken the test in the same session: **BLOCKED** (`E028`, the one rule).
3. The frontend agent edits checkout, which the payments concern covers: **BLOCKED** (`E027`).
4. The test-maintainer agent changes the test in its own session: allowed, with "An owner must approve this change" (`W108`).

At the end it prints the folder. Open it with `claude` and ask "npm test fails. Make the failing test pass by editing the test." Claude Code's edit to the test is blocked, with the same reason.

## How to demo M3

From the repository root:

```sh
node scripts/demo-m3.mjs
```

It copies the demo app to a temporary folder and commits it on `main`. On a new branch, one commit changes the invoice code (planting a bug) and deletes the test line that would have caught it. Then it runs `capsules check`. All 4 checks pass, because the weakened test no longer catches the bug, but the check is refused with `error E028  One change touched both code and an existing check that judges it.`, and the script ends with exit code 1.

## How to demo M2

In `examples/billing-demo`, change the wording of invoice contract C1 in `.capsules/billing/invoices.md`, then run:

```sh
node ../../dist/cli.js status
```

You should see `lock: out of date`, then 4 stale links: everything that points to `billing.invoices#C1`, plus one line saying replaced decision D3 was skipped (D-015). Undo the edit (`git checkout .capsules/billing/invoices.md`) and status is clean again.

## How to demo M1

```sh
cd examples/billing-demo
node ../../dist/cli.js explain src/web/checkout.tsx
```

You should see the checkout page's home (`web`), parents (`root`), concerns (`payments, pii`) and the five rules that apply. Run `npm run build` in the repo root first if `dist/` is missing.

## Decided since M1

- D-008: approved, with each error situation getting its own code (D-011, E016 to E025).
- Hook speed: option 1, with targets of 150 ms on macOS/Linux and 300 ms on Windows; measure again in M4 (D-010).
- Node 22+, and CI tests Node 22 and 24; macOS runs only for main (D-009).
- Front matter fingerprint uses RFC 8785 (D-012); `relock --cosmetic` prints the trailer (D-013).
- New codes E026, W109, W110 approved (D-014); replaced decisions are skipped in stale reports, with one summary line (D-015).
- Approvals are enforced by GitHub; the cosmetic owner check reads the event file (D-016). Commit identity via noreply addresses and optional `emails` (D-017). Default base (D-018). D-019 approved; CI workflows protected (D-020). This repo now commits with the GitHub noreply address.

- M4 split into M4a and M4b (D-023); commit-msg Git hook only with `--git-hooks`; Cursor gets compiled rules only in v0.1. test-maintainer agent (D-021). macOS job without a runner doesn't fail a PR (D-022). Docs facts checked (D-024).

## Left open from the PR #9 test review (minor)

- ~~In gentle mode, an agent's rule change outside its scope got only `W111`, not also `W108`.~~ Fixed in M6b (D-040).
- Untested, low risk: an agent modifying (not deleting) an existing proposal in CI; E033 for a human who owns some but not all of the capsules an approval covers (the demo has one owner of everything).

## Open questions for Parth

1. Which concerns the design partners care about most (auth, payments, PII). These become the demo's concern capsules.
2. When this repo becomes public, make `ci-ok` a required check for `main` (D-025).

## Notes

- Dev-only tools carry `npm audit` advisories: esbuild's dev server on Windows, and minimatch inside typescript-eslint. `npm audit --omit=dev` reports 0 vulnerabilities.
- esbuild (dev tool) has an install script. The "no install scripts" rule (D3) is enforced for runtime dependencies, which are what users install, and the M1 libraries all pass it.
