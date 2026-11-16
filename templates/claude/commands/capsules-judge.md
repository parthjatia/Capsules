---
description: Ask the read-only capsules-judge sub-agent whether this branch kept each rule it touches
argument-hint: "[base]"
---

Judge the changes on this branch against the capsule rules they touch. Base to compare with, if given: $ARGUMENTS

1. Run `capsules context --for judge --json` (add `--base <base>` if a base was given) and save its output.
2. Hand that output to the `capsules-judge` sub-agent, unchanged. Don't add your own opinion of the change: the judge must see only the rules and the diff.
3. The judge answers with JSON in the verdict format. Save it to a file in `.capsules/_cache/` (for example `.capsules/_cache/verdict.json`) and run `capsules verdict record --file <that file>`.
4. Show the human each rule with its verdict (kept, broken or unsure), the reason and the evidence. Verdicts are advice: tests and `capsules check` decide what blocks.
