# Capsules

> Status: early development (milestone M0). Not published yet.

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
