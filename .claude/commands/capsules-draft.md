---
description: Draft capsules for this project (or one area) from the code, Git history and docs, for a human to approve
argument-hint: "[area]"
---

Draft capsules for this project: plain-language records of what each part is for, the rules it must keep, and how those rules are checked. Area to focus on, if any: $ARGUMENTS

Work as the `capsules-drafter` sub-agent if it exists: it may write `.capsules/` but never app code.

1. Read the format first: the `capsules` skill, `.capsules/root.md`, `.capsules/config.yaml` and `.capsules/permissions.yaml`.
2. Learn what the app is for: the README, `CLAUDE.md`, `AGENTS.md`, OpenSpec or other spec files, the folder layout, the main entry points, the tests, and recent Git history (`git log --oneline -50`).
3. Propose a small tree: one area capsule per real part of the product (nest with folders: `.capsules/billing.md`, `.capsules/billing/invoices.md`), and concern capsules in `.capsules/_concerns/` for things that cut across parts (for example `payments`, `pii`, `auth`). Give each capsule `covers:` globs so every app file has exactly one home.
4. For each capsule write a few `intent` nodes (why it exists, in plain words), `contract` nodes that serve them, and one concrete `example` per contract.
5. Add `check` nodes **only for commands that already exist and pass** (an existing test file or script). Never invent a check. A contract with no real check yet stays without one; capsules reports it (W103).
6. Record important past choices as `decision` nodes with `rejected:` options, when the code, comments or Git history show them.
7. Run `capsules lock`, `capsules compile` and `capsules check --no-run`, and fix every error.
8. Then stop and show the human, in plain language, **only the intents and the examples** for each capsule, and ask them to approve or correct them. Don't commit until they approve.
