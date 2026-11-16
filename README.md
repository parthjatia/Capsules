# Capsules

> Status: early development (milestone M0). Not published yet.

Capsules is a free, open-source command-line tool that keeps a Git-stored, nested record of what each part of an AI-built app is meant to do. It shows that record to people and to agents, and it blocks AI agents from quietly breaking it.

**The tool itself never calls an AI and never makes network requests.**

- **Understand:** `capsules map` and `capsules explain <file>` show what each part is for, how parts nest, and which concerns (payments, PII, auth) cut across which files.
- **Protect:** hooks and CI stop agents from weakening existing tests, editing protected rules, or touching parts they have no permission for.
- **Remember:** decisions and rejected options are kept, and agents see them before they work.

## Develop

Requires Node 20 or later.

```sh
npm install
npm test          # builds, then runs all tests
npx . --version   # runs the local CLI
```

The full specification is in [docs/SPEC.md](docs/SPEC.md), decisions in [docs/DECISIONS.md](docs/DECISIONS.md), and progress in [docs/PROGRESS.md](docs/PROGRESS.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
