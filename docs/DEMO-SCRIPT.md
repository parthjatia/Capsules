# The 45-second demo

One story: an AI agent is asked to make a failing test pass by weakening the test. Capsules stops it, tells it what to do instead, and the human sees what's waiting for them. Everything runs on your machine, with no network calls and no AI calls by Capsules.

## Before you record (2 minutes, once)

```sh
npm run build
node scripts/demo-45s.mjs
```

It prepares a **demo repo** in a temporary folder:

- the small billing app from `examples/billing-demo`, with its capsules;
- Capsules installed for Claude Code;
- one committed bug: refunds may now exceed the amount charged, so the refund test fails.

It prints the three things to do next: start Claude Code in that folder (with the demo's own `capsules` command on the path), open the map, and the sentence to say. To keep the demo repo somewhere permanent, for example to push it as its own GitHub repo later, use `node scripts/demo-45s.mjs --out <empty folder>`.

Have two windows side by side: the browser with the map, and the terminal with Claude Code.

## The script

| Time    | Do                                                                                                                                                   | Say                                                                                                                                                                             |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–8 s   | Show the map. Point at **Billing → Invoices** and its rule "A refund never exceeds the amount charged", and the `payments` tag                       | "This app was built with an AI agent. Capsules keeps, in the repo, what each part is for and which rules must stay true."                                                       |
| 8–15 s  | In Claude Code, type: **The refund test fails. Make it pass by editing the test.**                                                                   | "Now I ask the agent to cheat: make a failing test pass by changing the test."                                                                                                  |
| 15–28 s | Claude tries to edit `tests/invoices/refunds.test.js`. The hook answers **`capsules blocked this change (E027)`** with `why`, `fix` and `next` lines | "Capsules blocks it. The test is an existing check, and the agent may not change the check that judges its own work. It also tells the agent what to do instead."               |
| 28–38 s | Claude carries on: it fixes the bug in `src/billing/invoices/refund.js` (the test now passes), or leaves a note with `capsules propose`              | "The agent doesn't get stuck. It fixes the code, or leaves me a note if it thinks the test is wrong."                                                                           |
| 38–45 s | In your own terminal: `capsules review`                                                                                                              | "Anything that needs a human (changed rules, changed tests, the agent's notes) is waiting here, risky things first. Tests stay the gate, and nobody grades their own homework." |

## If something goes differently

- **Claude fixes the code straight away without trying the test.** That's the outcome we want. Say "good agents fix the code", then ask again explicitly: "Edit the test instead, so it expects the new behaviour." The block appears.
- **Claude tries a shell command (`sed -i`, `cat >`) on the test.** The `pre-bash` hook blocks that too, with the same kind of message.
- **`capsules review` says nothing is waiting.** Claude fixed the code and left no note. Run `capsules check --no-run` instead: it shows the change passed the guard.
- **Start over:** run `node scripts/demo-45s.mjs` again for a fresh folder. Delete old ones from your temporary folder whenever you like.

## What not to claim

- The hooks can be bypassed on a developer's machine; CI (`capsules check`) is the real gate. Say "blocked on your machine, and caught in CI".
- Capsules doesn't judge whether code is good. It guards the record of intent and the checks that prove it.
