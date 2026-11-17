---
name: capsules
description: The capsules format in .capsules/ (intents, contracts, examples, checks, decisions, context), addresses like billing#C1, the one rule, and what agents must never edit. Use before reading or writing any file in .capsules/, or when a capsules hook blocks an edit.
---

# Capsules

This project records what each part of the app is for in `.capsules/`. Each capsule is one Markdown file. Tools: `capsules explain <file>`, `capsules context <capsule|file>`, `capsules check --no-run`.

## Files and ids

- `.capsules/root.md` is the whole product (`root`). `.capsules/billing.md` is `billing`; `.capsules/billing/invoices.md` is `billing.invoices` (nest with folders, never dots in names).
- `.capsules/_concerns/pii.md` is the concern `pii`: it cuts across areas.
- Each app file has exactly one home area (the deepest capsule whose `covers:` globs match it) and any number of concerns. It must keep the rules of its home, of every ancestor (`scope: tree` rules), and of every concern covering it.

## A capsule file

```markdown
---
title: Invoices
owners: [parth]
covers:
  - src/billing/invoices/**
status: active
---

## intent I1

Each customer is charged exactly once per billing period.

## contract C1 serves @I1

Never create two invoices for the same customer and period.
checked-by: @no-duplicates

## example E1 shows @C1

Customer A, period 2026-03, two CreateInvoice calls -> one invoice.

## check no-duplicates

run: npm test -- invoices.duplicates
files: tests/invoices/duplicates.test.ts

## decision D7 serves @C1

Use an idempotency key per customer and period.
rejected: own ledger (3 weeks of work, no audit trail)

## context idempotency derived-from @D7

Always pass both customer_id and period. {{ @C1 }}
```

Node types: `intent` (I1), `contract` (C1), `example` (E1), `check` (slug, needs `run:`), `decision` (D1), `assumption` (A1, optional `review-by:`), `context` (slug), `prompt` (slug, `file:`), `code` (slug, lines of `path` or `path#symbol`).

Links go in the heading: `serves`, `checked-by`, `shows`, `implements`, `uses`, `assumes`, `derived-from`, `supersedes`. References are `@C1` (same capsule) or `@billing#C1` (another capsule). `{{ @ref }}` in a context node quotes that node.

## Who may change what

| Layer                                                                     | Rule                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Intents, contracts, examples                                              | Agents may propose; an owner approves in the pull request           |
| Existing checks (check nodes and test files)                              | Never weaken or delete them. Adding new tests is fine               |
| Decisions                                                                 | Append-only. To change one, add a new decision that `supersedes` it |
| Context, code                                                             | Agents may edit freely, while all checks pass                       |
| `config.yaml`, `permissions.yaml`, `.claude/settings*.json`, CI workflows | Humans only                                                         |
| `capsules.lock`, `installed.json`, generated `capsules-*` rule files      | Only capsules' own commands write them                              |

## The one rule

No single change or session may change both code and an existing check that judges it, nor both a rule and the intent it serves. Nobody grades their own homework. If a test looks wrong, leave a note with `capsules propose <address or test file> --why "<reason>"` and carry on: a human, or the `test-maintainer` agent in its own session, changes it.

## After changing a capsule

Run `capsules lock`, then `capsules compile`, then `capsules check --no-run`. When a hook blocks you, read its `why`, `fix` and `next` lines and follow them. Don't try another way around the hook; carry on with the rest of the task.

At the end of a task you may **add** decisions and context. Intents, rules, examples and checks you only **propose**, with `capsules propose <address> --why "<reason>"` and, if you have one, `--text "<new text>"`. The owner sees it in `capsules review`.
