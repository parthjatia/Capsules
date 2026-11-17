# Capsules

> Status: early development (milestone M5). Not published yet.

Capsules is a free, open-source command-line tool that keeps a Git-stored, nested record of what each part of an AI-built app is meant to do. It shows that record to people and to agents, and it blocks AI agents from quietly breaking it.

**The tool itself never calls an AI and never makes network requests.**

- **Understand:** `capsules map` and `capsules explain <file>` show what each part is for, how parts nest, and which concerns (payments, PII, auth) cut across which files.
- **Protect:** hooks and CI stop agents from weakening existing tests, editing protected rules, or touching parts they have no permission for.
- **Remember:** decisions and rejected options are kept, and agents see them before they work.

## When a rule changes: stale links

Every rule, check and decision has a fingerprint, recorded in `.capsules/capsules.lock`. When you change the wording of a rule, everything that points to it becomes **stale**: written against the old version, so someone should look again. `capsules status` lists those items.

- **The meaning changed:** review each stale item. Update it if needed, then confirm it with `capsules refresh <address>`, for example `capsules refresh billing.invoices#D7`. Do this once per item.
- **Only a typo or formatting changed:** an owner runs `capsules relock --cosmetic <address>` on the rule itself, then adds the `Capsule-Cosmetic: <address>` line it prints to the commit message.

> **`--cosmetic` is only for typos and formatting.** If the meaning changed, even slightly, don't use it. It clears every stale item at once without anyone reviewing them. Review each stale item and use `capsules refresh` instead.

`capsules lock` records new fingerprints but never clears staleness, so running it can't hide a change by accident. Replaced decisions (ones another decision `supersedes`) are history, so they are skipped, with a one-line note.

## The guard: `capsules check`

`capsules check` compares your branch with its base (the pull request's base in GitHub Actions, otherwise `main`). It refuses a change when:

- **One change edits code and also weakens an existing test that judges it** (`E028`). Adding _new_ tests alongside code is fine.
- **One change edits a rule and the intent it serves** (`E029`).
- **An existing decision is edited or deleted** instead of replaced (`E009`).
- **An agent or person changes something `permissions.yaml` doesn't allow** (`E027`). Agents are named by the `Capsule-Agent:` commit trailer.

It also warns when a test looks weakened (`W107`), and then runs the checks of the capsules your change affects. Trailers can be forged, so for real protection also require owner approval on GitHub (CODEOWNERS and branch protection). In CI, check out full history (`fetch-depth: 0`).

Try it: `node scripts/demo-m3.mjs` (after `npm run build`).

## Agents: rules and hooks

`capsules compile` turns your capsules into rule files your agent reads: `.claude/rules/` for Claude Code, scoped to the files each capsule covers, plus `.cursor/rules/` and an `AGENTS.md` block if you enable them. Commit them, and never edit them by hand.

Claude Code hooks then check every edit as it happens:

- `capsules hook pre-edit` blocks an edit that `permissions.yaml` doesn't allow, an edit to an existing decision, or a test change in a session that already changed the code the test judges.
- `capsules hook pre-bash` blocks obvious shell writes to protected files.
- `capsules hook session-start` opens a capsules session for each Claude Code session by itself, so its commits are labelled.
- `capsules hook stop` tells you at the end of a turn what CI would fail on (the one rule, permissions, decisions, stale links), and reminds the agent to run `capsules check` for the tests.

A blocked edit comes back to the agent with the reason and the fix. Hooks can be bypassed on your machine, so CI (`capsules check`) stays the real gate. `capsules work <capsules> --agent <name>` limits a session to some capsules and labels its commits.

Try it: `node scripts/demo-m4a.mjs` (after `npm run build`).

## Zero friction: propose, review, gentle mode

- **When blocked, the agent keeps going.** Every block message says so, and the agent leaves a note instead of fighting the block: `capsules propose <rule or test file> --why "<reason>"`.
- **`capsules review`** shows everything waiting for you: changed rules and tests in full first, routine items one line each. `capsules review approve r1 r2` approves them (written to `.capsules/approvals.lock`); `--routine` never approves a rule or a test. Run it in your own terminal: agents are refused, and CI checks an owner made the commit.
- **Gentle mode** (the default for new installs): an agent working outside its area only gets a warning, while weakening tests, the one rule and rule changes stay blocked. `capsules mode` lists what strict mode would have blocked; `capsules mode strict` switches.
- **Starter checks:** if your app has few tests, `/capsules-draft` can write a few new ones for the examples you approved. They stay unreviewed until you approve them.

Try it: `node scripts/demo-m6a.mjs` (after `npm run build`).

## Install and remove

```sh
capsules init            # shows every file it will create or change, then asks
capsules doctor          # proves your app builds and tests exactly as before
capsules remove          # undoes everything init did (--all also deletes .capsules/)
```

`init` adds a starter `.capsules/`, the Claude Code commands `/capsules-draft`, `/capsules-work` and `/capsules-judge`, a read-only judge sub-agent, a drafter sub-agent and a skill, and merges the hooks into `.claude/settings.local.json` (your settings are kept, and the file stays out of Git). It never touches app code, `package.json` or build settings.

Other commands:

- `capsules context <capsule or file>` prints what an agent should know before working there: the rules, inherited rules, concerns and rejected options. `--budget 4000` keeps it short.
- `capsules context --for judge` gives the judge the diff and the contracts to judge. `capsules verdict record --file verdict.json` stores its verdicts as Git notes; `capsules verdict show` prints them. Verdicts are advice; they never block.
- `capsules codeowners` prints suggested CODEOWNERS lines.

## The map

```sh
capsules map --open      # one offline web page: .capsules/_cache/map.html
```

It starts with a summary line and a **Needs attention** list (stale rules, failing and unreviewed checks, files with no capsule), then a file search that answers like `capsules explain`, the tree of areas with their concerns as coloured tags, and the concerns. It makes no network requests. `capsules map --format mermaid` prints a diagram for a README or pull request; `--format json` prints the whole graph. In Claude Code, `/capsules-map` explains the map in plain words.

## Known limits

- **Private repos on GitHub Free can't block merges.** Branch protection and required owner reviews (CODEOWNERS) aren't available there, so GitHub can't require checks or approvals. Capsules still reports every problem in CI, and the agent hooks still block bad edits as they happen, but a merge can go ahead anyway. On a public repo, or a paid plan, make the CI summary job a required check.
- **Commit trailers can be forged**, and hooks can be bypassed on your own machine. CI, plus owner approval where GitHub supports it, is the real gate.

## Develop

Requires Node 22 or later.

```sh
npm install
npm test          # builds, then runs all tests
npx . --version   # runs the local CLI
```

The full specification is in [docs/SPEC.md](docs/SPEC.md), decisions in [docs/DECISIONS.md](docs/DECISIONS.md), and progress in [docs/PROGRESS.md](docs/PROGRESS.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
