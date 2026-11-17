---
description: Start a scoped capsules work session on a capsule, read its context, and follow it
argument-hint: "<capsule> [agent]"
---

Start work on the capsule `$0` (as agent `$1` if given, otherwise `default`).

1. Run `capsules work "$0" --agent <agent>` (use `default` when no agent was given). This limits the session to that capsule and labels the commits.
2. Run `capsules context $0` and read all of it before changing anything: the intents, the rules that must stay true, the decisions and the options that were rejected. Don't re-suggest a rejected option.
3. Do the task. Keep every rule listed. Never weaken or delete an existing test to make it pass: fix the code. If a test itself looks wrong, run `capsules propose <test file> --why "<reason>"` and carry on. If a hook blocks an edit, don't try another way around it; carry on with the rest.
4. If the work changes what a part is for, or one of its rules, propose it: `capsules propose <address> --why "<reason>"` `--text "<new text>"`. An owner sees it in `capsules review`. You may add new decisions and context yourself; to change a decision, add a new one that `supersedes` it.
5. Before finishing: `capsules lock`, `capsules compile` if a capsule changed, and `capsules check`. Commit with the `Capsule-*` trailers that `capsules work` printed (the commit-msg hook adds them if installed).
6. End the session with `capsules work --end`.
