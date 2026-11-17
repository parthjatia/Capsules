# Capsules

> **Status:** v0.1 release candidate. Not published to npm yet. Design partners get a test package and [an install guide](docs/PARTNER-INSTALL.md).

**Capsules keeps a short, Git-stored record of what each part of your AI-built app is for, and stops AI agents from quietly breaking it.**

You built an app with Claude Code or Cursor in days. Now nobody, you or the agent, has a reliable picture of what each part is meant to do. Agents forget between sessions. They re-suggest ideas you already rejected. And when a test fails, an agent can make it pass by weakening the test. Capsules fixes that with plain files in your repo and a few checks:

- **Understand:** a map of your app's parts, what each is for and which rules must stay true.
- **Protect:** an agent can't weaken an existing test, edit a rule without your approval, or switch off its own checks. It is blocked as it works, and caught again in CI.
- **Remember:** past decisions and rejected options are kept, and agents read them before they work.

**Capsules never calls an AI and never makes a network request.** Anything that needs thinking (drafting the record, judging a change) is done by your own agent, through commands Capsules installs. Nothing about your code leaves your computer.

## What it looks like

Your agent is asked to fix a failing test, and tries to edit the test:

```text
capsules blocked this change (E027): default may not do this: the builder role of default doesn't include change-checks.
  capsule: billing.invoices
  change:  changed existing check tests/invoices/refunds.test.js
  why:     permissions.yaml says who may change what, so an agent can't change parts it has no business touching.
  fix:     leave existing tests as they are and fix the code instead. If the test itself looks wrong, propose a change (capsules propose <test file> --why ...).
  next:    don't try another way around this block. Carry on with the rest of the task.
```

The agent fixes the code instead, or leaves you a note. Later, in your own terminal:

```text
$ capsules review
capsules review: 1 item to read, 2 routine.

Read these (rules, intents, examples, tests and proposals):

--  Note from default about tests/invoices/refunds.test.js
      why: The refund limit may need to allow partial refunds.
```

## Five-minute start

You need Node 22 or later, Git, and (for the agent parts) Claude Code. Commit your work first, so you can see exactly what Capsules adds.

```sh
capsules init            # prints every file it will create or change, then asks
capsules doctor          # proves your app builds and tests exactly as before
```

Then, in Claude Code:

```text
/capsules-draft
```

Claude reads your code and docs and drafts the record: the areas of your app (billing, web, users…) and the concerns that cut across them (payments, personal data, auth…). It then shows you **what each part is for** and **one concrete example per rule**, in plain words, for you to approve or correct. That's the only part that needs you. Finish with:

```sh
capsules lock && capsules compile && capsules check --no-run
capsules map --open      # one offline page: your app's parts, rules and what needs attention
```

Commit `.capsules/` and the new files under `.claude/`. To undo everything at any time: `capsules remove` (add `--all` to delete `.capsules/` too).

Until Capsules is on npm, install the test package as the [partner guide](docs/PARTNER-INSTALL.md) says. After release it will be `npx @pyscoparth/capsules init`.

## How it works

A **capsule** is a small Markdown file in `.capsules/` about one part of your app. **Area capsules** nest like your product does (`root` → `billing` → `billing.invoices`). **Concern capsules** (`.capsules/_concerns/payments.md`) cut across areas. Every file has one home area, and any number of concerns. `covers:` patterns say which files belong where.

Each capsule has layers, and each layer has its own rule for who may change it:

| Layer          | Holds                                         | Who may change it                                         |
| -------------- | --------------------------------------------- | --------------------------------------------------------- |
| Intent         | What this part is for, in plain words         | You (agents may propose)                                  |
| Contracts      | Rules that must stay true, with examples      | Agents draft; you approve                                 |
| Checks         | The tests that prove each rule                | Agents may add new ones; changing existing ones needs you |
| Decisions      | Why it's built this way, what was rejected    | Agents add; never edited, only replaced                   |
| Context        | Conventions and pitfalls an agent should know | Agents, freely                                            |
| Implementation | Your code                                     | Agents, freely, while all checks pass                     |

**The one rule:** a single change, or a single agent session, may never change both the code and an existing test that judges it, or both a rule and the reason it exists. Nobody grades their own homework.

Git does the storing. Capsules adds a lockfile of fingerprints (`capsules.lock`), so when a rule's wording changes, everything that points at it shows up as **stale** until someone looks again.

## Day to day

- **Claude Code hooks** check every edit as it happens, open a session for each Claude Code session, and give a one-line report at the end of each task (what CI would fail on, notes waiting for you, and a reminder to run your tests).
- **When blocked, the agent keeps going.** If it thinks a test or rule is wrong, it leaves a note (`capsules propose`) instead of changing it.
- **`capsules review`** lists everything waiting for you: changed rules and tests in full, with before and after; examples that still describe an old rule; the agent's notes; then routine items one line each. `capsules review approve r1 r2` approves items; `--routine` never approves a rule, an example or a test. Run it in your own terminal (agents are refused) and commit `.capsules/approvals.lock`.
- **Gentle mode** is the default for new installs: an agent working outside its area gets a warning instead of a block. Weakening tests, the one rule, rule changes and switching off the checks are blocked from day one. `capsules mode` lists what strict mode would have blocked; `capsules mode strict` switches.
- **If something goes wrong:** `capsules log` lists every block, warning and note on your machine; `capsules log --false-alarm <n>` marks a wrong one; `capsules pause` lets edits through (still logged) for up to 24 hours, then turns itself back on; `capsules stats` counts the week; `capsules report` writes one file to share, and shows it to you first.
- **Explain any file:** `capsules explain src/web/checkout.tsx` shows its area, concerns, the rules it must keep, who may edit it, and related decisions. `capsules context <area>` prints what an agent should read before working there.

## In CI

`capsules check` compares your branch with its base and fails when:

- one change edits code and also weakens an existing test that judges it (`E028`);
- one change edits a rule and the intent it serves (`E029`);
- an existing decision is edited instead of replaced (`E009`);
- an agent changes something `permissions.yaml` doesn't allow (`E027`), including its own guard (settings, workflows, the lockfiles);
- an approval in `approvals.lock` wasn't made by an owner (`E033`).

It warns when a test looks weakened (`W107`), and then runs the tests of the parts your change affects. The GitHub Action runs it on every pull request and posts one summary comment:

```yaml
permissions: { contents: read, pull-requests: write }
steps:
  - uses: actions/checkout@v5
    with: { fetch-depth: 0 }
  - uses: actions/setup-node@v5
    with: { node-version: 22 }
  - uses: parthjatia/Capsules/action@v0.1
```

`capsules codeowners` prints CODEOWNERS lines, so GitHub also requires an owner's review for rule and test changes.

## Honest limits

- **Hooks can be bypassed on your own machine**, and commit trailers (which name the agent) can be forged. CI, plus owner review on GitHub, is the real gate.
- **The shell check is best effort.** File edits are checked exactly; clever shell commands can get past the live check, and CI catches them.
- **Private repos on GitHub Free can't block merges** (no branch protection or required reviews there). Capsules still reports every problem; make its check required on a public repo or a paid plan.
- **The judge is usually the same kind of model as the builder**, in a fresh read-only session. Its verdicts are advice. Tests block.
- **Fingerprints see wording, not meaning.** A typo fix makes things stale; an owner can mark it cosmetic (`capsules relock --cosmetic`).

## Try the demos

After `npm install && npm run build` in this repo:

- `node scripts/demo-45s.mjs`: a demo repo to open in Claude Code, and the [45-second demo script](docs/DEMO-SCRIPT.md).
- `node scripts/demo-m6a.mjs`: sessions, notes, gentle mode and `capsules review`, step by step, no Claude needed.
- `node scripts/demo-m5.mjs --open`: the map.

## Develop

```sh
npm install
npm test          # builds, then runs all tests
npx . --version   # the local CLI
```

The full specification is in [docs/SPEC.md](docs/SPEC.md), decisions in [docs/DECISIONS.md](docs/DECISIONS.md), progress in [docs/PROGRESS.md](docs/PROGRESS.md), and real-use findings in [docs/DOGFOOD.md](docs/DOGFOOD.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
