---
description: Draw the capsules map and explain in plain words what each part of the app is for
argument-hint: "[area]"
---

Explain this project's capsules map to the user in plain words. Don't change any files.

1. Run `capsules map` (it writes `.capsules/_cache/map.html`) and tell the user the path, so they can open it. Then run `capsules map --format json` and read it.
2. Say in a few sentences what the product is for (the root capsule's intents), then each main area: its title, what it is for, and how many rules it keeps. Mention which concerns (for example payments or pii) cut across which areas.
3. Go through "Needs attention" (the `attention` list), most serious first: errors, failing checks, stale rules, unreviewed checks, files with no capsule, assumptions past review. For each, say why it matters and the exact command that fixes it.
4. If the user named an area (`$ARGUMENTS`), focus on it: run `capsules context $ARGUMENTS` and explain its rules, decisions and rejected options.
5. Offer `capsules map --format mermaid` if they want a diagram for a README or pull request.
