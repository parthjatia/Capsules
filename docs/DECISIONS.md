# Decisions

A numbered log of product and spec decisions, and of every change to CLAUDE.md rules.
Newest at the bottom. Entries are never edited, only superseded by a later entry.

---

## D-001: Reserve a `<repo>:` prefix in addresses for future cross-repo links

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** B7, C2.2, C2.6 (new error `E015`)
- **Decision:** `@<repo>:<capsule-id>#<node-id>` (for example `@payments-service:billing#C3`) is reserved. v0.1 parses it and rejects it with `E015` ("cross-repo addresses are not supported yet"). The `:` character may never appear in a capsule or node id. The rule applies to heading links, `checked-by:`, `tripwire:`, `{{ @ref }}` transclusions and CLI address arguments. On the CLI it is a usage error (exit 64).
- **Why:** reserving the syntax now means cross-repo links can ship later without breaking any capsule files written in v0.1.

## D-002: Contracts are always `C<n>`, in concern capsules too

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** C2.3 (clarified), B7, C3 and C7.2 examples (`pii#P1`, `payments#Y1` became `pii#C1`, `payments#C1`)
- **Decision:** the C2.3 id format `C<n>` holds for every contract, whether it is in an area or a concern capsule.
- **Why:** the examples contradicted the table. One rule is simpler for the parser and for people.

## D-003: The default `ignore` no longer contains `*.md`

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** C4
- **Decision:** the default ignore list has `README.md`, `CHANGELOG.md` and `docs/**` instead of `*.md`.
- **Why:** prompts that apps use at runtime are often Markdown (`prompts/invoice-agent.md`). Ignored files get no home capsule (C2.7 step 1), so `*.md` would have stopped prompts from being covered, fingerprinted and protected.

## D-004: Whole-PR change unit for commits without trailers

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** C6.1, I1 (new known limit)
- **Decision:** in CI, all commits in a PR that have no `Capsule-Session` trailer are also checked together as one extra change unit. A V1/V2 violation found only in that unit is an error, or a warning in solo mode. Violations inside one commit stay errors in every mode.
- **Why:** otherwise an agent could skip trailers and split the code change and the test change into two commits, and each would pass on its own. Splitting across two PRs is still possible and is listed in I1.

## D-005: Who writes the lockfile and `installed.json`

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** C5.1, C5.2
- **Decision:** only the tool's own commands write `capsules.lock` and `installed.json`, and hooks block direct edits. `refresh` of links from an intent, contract or example needs the same approval as editing that node. `relock --cosmetic` is owners only, as before.
- **Why:** C5 didn't say, and the lockfile is what makes staleness visible. Hand edits would let anyone hide it.

## D-006: Working agreements recorded from Parth's answers

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** D2, F3, I4
- **Decision:**
  - npm package `@pyscoparth/capsules`, kept `"private": true` in package.json until M6 so it can't be published by accident.
  - GitHub repo `parthjatia/Capsules` (private).
  - License Apache-2.0.
  - Claude may commit, push to non-`main` branches and open PRs. Never publish to npm, tag, release or make the repo public without asking.
- **Follow-ups Parth asked for:**
  - Before M4, verify two claims against the official Claude Code docs and cite the pages: hook input has `agent_type` inside sub-agents, and exit code 1 does not block.
  - In M1, measure hook start-up time against the 150 ms target and report the numbers before choosing a fix.

## D-007: Body fields are read anywhere in a node, by valid key only

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** C2.2
- **Decision:** a line is a field only if it is on its own line and starts with a key valid for that node type (C2.3), followed by `:`. Fields may appear before or after the prose. Any other `word: text` line is prose. Lines inside fenced or indented code blocks are never fields. Blank lines under the heading are ignored.
- **Why:** the C2 example put `checked-by:` after the prose, which contradicted "fields at the start". Markdown formatters such as Prettier insert a blank line under every heading, which must not change a capsule's meaning.

## D-008: Gaps in the spec filled during M1 (PROPOSED, waiting for Parth's OK)

- **Date:** 2026-11-16 · **Status:** implemented as below, but not yet approved. Nothing in CLAUDE.md was changed for these.
- **Choices:**
  1. **Project root = nearest folder with `.capsules/`.** Searched from the current folder up to the Git top level. C1 says `.capsules/` sits at the repo root, and in a normal repo that's the same thing. This lets `examples/billing-demo` (and monorepo packages) have their own `.capsules/`. `git ls-files` runs from that folder, so paths are relative to it.
  2. **Error codes for cases C2.6 doesn't name:**
     - malformed heading, or an id in the wrong format (e.g. `contract X1`) → `E001`
     - a single-value field repeated, or a bad field value (`scope`, `timeout`, `review-by`) → `E007`
     - unknown front matter keys, invalid capsule file names, owners not in `permissions.yaml`, and invalid `config.yaml` / `permissions.yaml` → `E008`
     - missing `.capsules/root.md` → `E013`
  3. **Draft capsules:** errors inside a `status: draft` capsule are reported as warnings, so they never fail `check` (C2.1 "draft capsules never block").
  4. **Unknown keys in `config.yaml` and `permissions.yaml` are errors.** A typo like `weakend-tests: block` must not silently fall back to the default.
- **Why:** each was needed to build M1, and none changes a rule that is already written down.
