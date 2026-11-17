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

## D-008: Gaps in the spec filled during M1

- **Date:** 2026-11-16 · **Status:** approved by Parth with one change: every error situation that was sharing the closest existing code gets its own code (see item 2). Written into C1, C2.1, C2.6 and C4.
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

## D-009: Node 22 minimum; slimmer CI

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** B14, D3, `package.json` `engines`, CI
- **Decision:** capsules requires Node 22 or later, and CI tests Node 22 and 24 only:
  - Linux runs both 22 and 24.
  - Windows runs 22.
  - macOS runs 22, but only for pull requests into `main` and pushes to `main`.
- **Why:** Node 20 has been end-of-life since April 2026. The macOS rule saves the private repo's free Actions minutes, since macOS minutes cost 10×.

## D-010: Hook speed approach and targets

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** C11, F2
- **Decision:** hooks run from a small separate entry point that loads only hook code, and read a saved index of the parsed capsules from `.capsules/_cache/`. The index is rebuilt only when a capsule or settings file has changed. Targets on a 1,000-file repo: under 150 ms on macOS and Linux, under 300 ms on Windows. Measure again in M4.
- **Why:** M1 measured about 350 ms on Windows for a full load, against 69 ms for bare Node start (see docs/PROGRESS.md).

## D-011: Every borrowed error situation gets its own code

- **Date:** 2026-11-16 · **Approved by:** Parth (his change to D-008 item 2)
- **Changes:** C1, C2.6. This replaces the code mapping in D-008 item 2.
- **Decision:**
  - `E016` heading can't be read (was E001)
  - `E017` id in the wrong format (was E001)
  - `E018` single-value field repeated (was E007)
  - `E019` invalid field value (was E007)
  - `E020` invalid capsule file name (was E008)
  - `E021` owner not in `permissions.yaml` (was E008)
  - `E022` invalid `config.yaml` / `permissions.yaml` (was E008)
  - `E023` missing `.capsules/root.md` (was E013)
  - `E024` unknown link type word (was E006)
  - `E025` reference that can't be read (was E003)
- **Why:** one code per situation makes messages, docs and `--json` consumers unambiguous.

## D-012: Front matter fingerprint uses JSON Canonicalization (RFC 8785)

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** C7.1 step 5
- **Decision:** the `capsule` hash is SHA-256 of the RFC 8785 (JCS) serialisation of the parsed front matter, after CRLF→LF and NFC. Stored as 12 hex characters like node hashes.
- **Why:** "re-serialised YAML" depends on a library's output format, which could change in an update and silently change every fingerprint. JCS is a published standard with a fixed output.

## D-013: `relock --cosmetic` prints the trailer instead of committing

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** C7.3
- **Decision:** `relock --cosmetic <address>` prints the exact `Capsule-Cosmetic: <address>` line to add to the commit message. From M4, the optional commit-msg hook adds it automatically. From M3, CI checks that only an owner used it.
- **Why:** the tool never makes commits on the user's behalf.

## D-014: New codes for M2 situations (following D-011)

- **Date:** 2026-11-16 · **Status:** added under Parth's D-011 rule that each situation gets its own code. Flagged in the M2 PR for review.
- **Changes:** C2.6, C7.4
- **Decision:**
  - `E026` the lockfile can't be read
  - `W109` a prompt node's file doesn't exist
  - `W110` stale prompt (C7.4 described this case but gave it no code)
  - A **missing** lockfile stays `E010` ("out of date"), because the fix is the same: run `capsules lock`.

## D-015: Replaced decisions are left out of stale reports

- **Date:** 2026-11-16 · **Approved by:** Parth (who also approved D-014 as proposed)
- **Changes:** C7.4
- **Decision:** stale links whose source is a decision that another decision `supersedes` are not reported as `W104`, and don't count in `status`. `status`, `check`, `lock`, `refresh` and `relock` print one summary line instead, e.g. `1 replaced decision skipped (billing.invoices#D3, replaced by billing.invoices#D7)`.
- **Why:** a replaced decision is history. Flagging it for review is noise that hides the items that need attention.

## D-016: Approvals are enforced by GitHub; the cosmetic owner check reads the event file

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** C5.2, C8, C2.6 (W108 wording)
- **Decision:** GitHub enforces owner approvals through CODEOWNERS and branch protection. `capsules check` reports changes that need approval (`W108`), but never contacts GitHub (B1). For the `Capsule-Cosmetic` owner check (`E030`), capsules reads the pull request author from the GitHub Actions event file (`GITHUB_EVENT_PATH`), which is a local file. Outside GitHub Actions it uses the commit author.
- **Future option (not v0.1):** the GitHub Action wrapper, not the CLI, may later read PR approvals through the GitHub API using the job's token, and pass them to the CLI as a local file.

## D-017: Identifying the human behind a commit

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** C5 (example), new C5.3
- **Decision:** a commit author's email maps to a human in `permissions.yaml` in this order:
  1. GitHub noreply addresses (`<id>+<handle>@users.noreply.github.com`) map to the human with that `github` handle automatically.
  2. Otherwise, a match in that human's optional `emails` list.
  3. Unknown authors act as `default`.
- `permissions.yaml` carries a comment that listed emails are public if the repo is public.

## D-018: Default base for `capsules check`

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** new C6.4
- **Decision:** without `--base`, capsules looks for a base in this order:
  1. In GitHub Actions, the PR's real base from the local event file.
  2. Otherwise the remote's default branch.
  3. With no remote, local `main`.
  4. Otherwise uncommitted changes only.
     The base is the merge base with `HEAD`. Uncommitted changes are always one extra change unit.

## D-019: M3 codes and interpretations

- **Date:** 2026-11-16 · **Approved by:** Parth, apart from point 8, which D-020 replaces.
- **Codes:**
  - `E027` not allowed by permissions
  - `E028` one rule V1
  - `E029` one rule V2
  - `E030` `Capsule-Cosmetic` used by a non-owner
  - `E031` check failed
  - `E032` check timed out
- **Interpretations** (D-019.1 to D-019.11):
  1. A changed **assumption** needs `propose-contracts` (owner approval), because decisions rest on it. Adding one stays `add-decisions`.
  2. A **prompt** node is classed with `edit-context`. The prompt file it points to is app code (`edit-code`).
  3. "Unreviewed" new checks (C6.2) are a report-only list in `check` output and `--json`. They are not a warning code, because they clear once the PR is merged with an owner's approval.
  4. `W108` is a warning in every mode, because GitHub, not capsules, enforces the approval (D-016).
  5. **Uncommitted changes** are made by the person in `git config user.email` (the author of the next commit), mapped as in C5.3. Sessions (M4) will take precedence.
  6. **No history yet:** in a repo with no commits there is nothing to compare against, so the history-based checks (permissions, one rule, E009, W107) are skipped. Validation still runs.
  7. **V2 needs an existing intent:** adding a new intent together with the contracts that serve it is how a capsule is born, so only a **modified or deleted** intent counts. The contract or example may be added, changed or removed.
  8. ~~**Ignored files** are outside the guard.~~ Replaced by D-020: ignored files need no capsule and are not code, but CI workflows and `.capsules/config.yaml` are `edit-config` (owners only).
  9. **Affected capsules** (C9.1) also include a capsule whose own file changed, so changing a check node runs it.
  10. **Merge commits** are skipped (`git log --no-merges`); their content belongs to the commits they merge.
  11. **Merged findings:** when the same code and check break the one rule for several capsules (for example an area and a concern), one `E028` names all of them.

## D-020: CI workflows are protected like config.yaml

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** C5.1, C5.2 step 1
- **Decision:** a change to `.github/workflows/**` or `.capsules/config.yaml` is `edit-config`, which only owners may do (no role grants it by default). An agent's commit, or a commit by someone who isn't an owner, is `E027`. Other ignored files (for example `docs/**`) stay outside the guard.
- **Why:** an agent that can edit the CI workflow can switch the guard off, for example by deleting the `capsules check` step.
- **On this repo:** workflow changes go in their own commit, for an owner to approve in the PR review.

## D-021: A test-maintainer agent may propose changes to existing checks

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** C5 example, C5.1
- **Decision:** a new action, `propose-checks`, lets an agent modify or delete existing checks, flagged for owner approval in CI (`W108`, a warning in every mode). A new role, `maintainer` (`add-checks`, `propose-checks`), and agent, `test-maintainer`, use it. The role has no `edit-code`, so the agent can't touch app code (`E027`). It must work in its own session: the one rule (V1) blocks a test change in the same commit, `Capsule-Session` or Claude Code session as a code change. `change-checks` stays humans-only unless explicitly granted. An agent whose role has `propose-checks` but not `change-checks` uses it automatically.
- **Why:** with the hooks in place no agent could ever fix a test. This gives a narrow, reviewed way to do it.

## D-022: A macOS job that never got a runner doesn't fail a pull request

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** `.github/workflows/ci.yml` (no spec change)
- **Decision:** a final `ci-ok` job sums up the run. On pull requests, a macOS job that was cancelled before running any step (no runner was free) is reported as skipped, not failed. Every other failure, timeout or cancellation fails `ci-ok`. macOS still runs, and must pass, on pushes to main.
- **Why:** GitHub's macOS runners are sometimes unavailable for 15 minutes, which showed a red check on PR #5 although no test had run.

## D-023: M4 is split into M4a and M4b

- **Date:** 2026-11-16 · **Approved by:** Parth
- **M4a:** `compile` (Claude Code, Cursor, AGENTS.md), the hooks (`pre-edit`, `pre-bash`, `stop`) with the fast entry point and saved index (D-010), sessions (`capsules work`), the `commit-msg` trailer command, `E011` in `check`, the `test-maintainer` agent (D-021), and this repo's root capsule made `active`.
- **M4b:** `init`, `remove`, `doctor`, `installed.json` and the settings merge, the optional `commit-msg` Git hook (`--git-hooks`), `capsules context`, the commands, the judge and drafter sub-agents, the skill, and `verdict`.
- **Also decided:** `init` installs the `commit-msg` Git hook only with `--git-hooks` (I4). Cursor gets compiled rule files only in v0.1; Cursor hooks come later (I4).

## D-024: Facts checked against the Claude Code and Cursor docs, and what they changed

- **Date:** 2026-11-16 · **Status:** facts verified on 2026-11-16; spec wording updated to match. Flagged in the M4a PR for review.
- **Sources:**
  - [Claude Code hooks](https://code.claude.com/docs/en/hooks): common input fields; PreToolUse input; exit code output; Stop input and decision control; JSON output (`systemMessage`).
  - [Claude Code memory, `.claude/rules/`](https://code.claude.com/docs/en/memory): path-specific rules.
  - [Cursor rules](https://cursor.com/docs/context/rules).
- **Confirmed:**
  1. Exit code 2 blocks and Claude sees stderr as the reason; exit 1 does not block.
  2. `agent_type` is present inside a sub-agent, and also when the session was started with `--agent`.
  3. `tool_input.file_path` is always absolute (backslashes on Windows).
  4. Rule files in `.claude/rules/` are found recursively. A `paths` list scopes a rule; rules without it load at launch.
  5. Cursor project rules must be `.mdc`, and `globs` is one comma-separated string.
- **What changed in the spec:**
  1. The generated-file marker goes right after the front matter, because both tools read front matter only at the very top.
  2. The Stop hook reports through a JSON `systemMessage`.
  3. `check` reports `E011` only once agent files are installed.
  4. The hooks apply the one rule per Claude Code session or `capsules work` session.
- **Interpretations:**
  1. In a hook, an existing check is a check file that exists on disk and wasn't created earlier in the same session.
  2. Writes through Bash to protected paths (`.capsules/`, existing check files, generated files, CI workflows) are blocked for every agent, with a pointer to the Edit and Write tools, which capsules can check precisely.
  3. A hook records an allowed edit when it allows it. If the tool call is then rejected, the session remembers a change that didn't happen, which can only make the hook stricter.

## D-025: Private repos on GitHub Free can't block merges

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** C8, README (known limits)
- **Decision:** branch protection and required CODEOWNERS reviews aren't available for private repositories on GitHub Free. There, GitHub can't require checks or owner approvals, so capsules reports problems in CI but can't block merges; the agent hooks still block live. When this repo becomes public, make `ci-ok` a required check on `main`.
- **Also decided:** Claude does its own work on this repo inside a capsules session (`capsules work … --agent default`), so its commits carry `Capsule-*` trailers and the guard treats that work as an agent's, not Parth's.

## D-026: Hooks go in settings.local.json for now; agents may not edit Claude Code settings

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** C5.1, C5.2, C11, C15 (`init`)
- **Decision:**
  1. `init` merges our hooks into `.claude/settings.local.json`, pointing at the capsules that ran `init` on this machine. Each person runs `init` once; CI stays the shared gate. `init` adds the file to `.git/info/exclude`, because Claude Code only keeps it out of Git when Claude Code creates it ([settings docs](https://code.claude.com/docs/en/settings)).
  2. `.claude/settings.json` and `.claude/settings.local.json` are `edit-config`, humans only, in the hooks (`pre-edit`, `pre-bash`) and in CI, so an agent can't remove its own guard.
  3. After we publish: `init --shared` writes the hooks into the committed `.claude/settings.json`, calling a globally installed `capsules` (`npm install -g @pyscoparth/capsules`). Not `npx`, which would add 0.2 to 0.4 s to every edit.
- **Docs checked (2026-11-16):** [sub-agents](https://code.claude.com/docs/en/sub-agents) (`.claude/agents/`, `name`, `description`, `tools` as a comma-separated string; hooks get `name` as `agent_type`), [slash commands](https://code.claude.com/docs/en/slash-commands) (`.claude/commands/*.md` still works; skills are preferred for new work), [skills](https://code.claude.com/docs/en/skills) (`.claude/skills/<name>/SKILL.md`, `description` recommended), [settings](https://code.claude.com/docs/en/settings) (`settings.local.json` is per machine, hooks reload live, lists merge across files).
- **Interpretations:**
  1. The C12 command files stay in `.claude/commands/` as the spec says; they still work. Moving them to skills is a later option.
  2. `.capsules/installed.json` is committed and holds nothing machine-specific: each file `init` created (with its Git blob hash, so `remove` can tell whether you changed it), the folders it created, which agent files it generated, and whether it created `AGENTS.md`. What is per machine (the settings file's bytes before the merge, the `.git/info/exclude` line, the commit-msg hook) is recorded in `.capsules/_cache/installed-local.json`. If that cache is lost, `remove` still finds our hooks by their command and takes them out. `remove` puts a merged file back byte for byte when nothing else changed in it.
  3. `init` never overwrites a file it didn't create: an existing `.git/hooks/commit-msg` or workflow file is left alone and reported.
  4. `/capsules-map` waits for M5, when `capsules map` exists.
  5. `capsules context --for judge` works without a target: it lists the contracts that apply to every changed file, plus the diff. The context pack's warnings come first (C16 lists them last in the table, but says "warnings first").
  6. When `init` can't find a GitHub noreply address in the Git settings, it says that the owner's commits won't be recognised yet, and how to fix it (C5.3). It never writes an email into `permissions.yaml`.

## D-027: The map's summary line, needs-attention list, concern tags and --open

- **Date:** 2026-11-16 · **Approved by:** Parth
- **Changes:** C14, C15 (`map`)
- **Decision:**
  1. The page starts with a one-line summary (`5 areas · 2 concerns · 9 rules · 0 stale · checks not run yet`), then a **Needs attention** list (errors, stale rules, failing checks, unreviewed checks, orphan files, assumptions past review), each linking to its capsule in the tree.
  2. Each area in the tree shows the concerns that reach its files as coloured tags, linking to the concern.
  3. `capsules map` writes the file and prints its path; `--open` also opens it in the default browser.
- **Interpretations:**
  1. "Stale" in the summary counts stale links plus stale prompts (C7.4): each is one thing someone must review.
  2. Unreviewed checks are worked out the way `capsules check` does (new check files added together with code since the base, C6.2); `--base <ref>` picks the base. Each links to the capsule whose check names that file most specifically (for example `web`'s `tests/web/**` over `root`'s `tests/**`).
  3. Errors are listed too, because the map may be incomplete while the capsules have errors. Assumptions past review are listed because they need a human decision.
  4. "Orphans nearby" puts each orphan with the area that is home to most files in the same folder, or `root`.
  5. Check status: `checks passed` only when every check passed in the last `capsules check`; `checks passed (4 of 6 run)` when some weren't run; `N checks failed` otherwise; `checks not run yet` with no results.
  6. Determinism: the page holds no timestamps, durations or absolute paths; tested across two copies of the repo in different folders.

## D-028: pre-bash follows `cd`, subshells and Git Bash paths

- **Date:** 2026-11-16 · **Approved by:** Parth (M6 item 1)
- **Changes:** none to the spec text; an interpretation of C11 (`pre-bash`)
- **Decision:** `pre-bash` works out which folder each write happens in. It follows `cd`, `pushd` and `popd` (and their PowerShell forms), subshells, `NAME=value` variables, `~`, and a bare `cd` going home. An edit inside another folder, such as a temporary copy of the demo, is no longer mistaken for this repo's capsules (the false positive in `docs/DOGFOOD.md`).
- **Interpretations:**
  1. When the folder can't be known (`cd -`, an unknown `$VAR`, backticks or `$(…)`), writes are checked as if they happened in the hook's `cwd`, which is the safe side.
  2. On Windows, Git Bash paths like `/c/Users/...` are read as `C:/Users/...`. Before this, such a path let a write to a protected file through.

## D-029: `capsules check --summary <file>` writes the pull request summary

- **Date:** 2026-11-16 · **Approved by:** Parth (M6 item 3)
- **Changes:** C15 (`check`), C17
- **Decision:** `capsules check --ci --summary <file>` also writes the C17 summary as Markdown. The GitHub Action (`action/action.yml`) posts it as one comment, found again by its first line `<!-- capsules-summary -->` and updated on every push. capsules itself still makes no network request (B1); the Action posts the comment with GitHub's `gh` tool.
- **Interpretations:**
  1. "Capsules:" lists the capsules the change touches: capsule files edited, and the home and concerns of each changed file. Ancestors are not listed.
  2. The summary never prints an email address, because a pull request comment is visible to everyone who can see the pull request.
  3. Agents may not write CI workflows (D-020), so the workflows that use the Action are prepared in `docs/proposed-workflows/`, and Parth copies them into `.github/workflows/` in his own commit.
  4. The release workflow uses npm trusted publishing ([npm docs](https://docs.npmjs.com/trusted-publishers), checked 2026-11-16): `id-token: write`, npm 11.5.1 or later, no stored token. It refuses while `package.json` is `private`.

## D-030: Automatic sessions from a SessionStart hook

- **Date:** 2026-11-17 · **Approved by:** Parth (M6a item 1)
- **Changes:** C8, C11, new C18.1
- **Decision:** a `SessionStart` hook opens one capsules session per Claude Code session (agent `default`, or the `claude --agent` name). It passes the session to Claude's later shell commands through `CLAUDE_ENV_FILE`, so trailers are right without `capsules work`.
- **Docs checked (2026-11-17):** [hooks](https://code.claude.com/docs/en/hooks). SessionStart runs on `startup`, `resume`, `clear`, `compact` and `fork`. It receives `source` and optionally `model`, `agent_type` ("present when you start Claude Code with `claude --agent <name>`") and `session_title`. It can't block. Its plain stdout is added as context Claude can see. "SessionStart hooks have access to the `CLAUDE_ENV_FILE` environment variable, which provides a file path where you can persist environment variables for the shell commands Claude runs later in the session."
- **Interpretations:**
  1. The session id comes from Claude Code's `session_id` (`cc-` plus 16 hex characters of its SHA-256), so a resumed or compacted session keeps its session and its one-rule tracking.
  2. An automatic session never becomes the repo's "current" session. This fixes the clash found while planning the `test-maintainer` step: two Claude Code windows each get their own session.
  3. `capsules work` inside an automatic session narrows it rather than starting a new one.

## D-031: End-of-task fast checks; tests at end of task are v1

- **Date:** 2026-11-17 · **Approved by:** Parth (M6a item 3, light version)
- **Changes:** C11 (`Stop`), new C18.2, Part H
- **Decision:** the Stop report also runs `capsules check --no-run`'s checks against the base: one rule, permissions, decisions, staleness, weakened-test signals and lock. It reports what CI would fail on and says `run capsules check to run your tests`. Running the tests at the end of every task moves to v1.

## D-032: `capsules propose` and `.capsules/_proposals/`

- **Date:** 2026-11-17 · **Approved by:** Parth (M6a items 6 and 7)
- **Changes:** C1, C5.1, C15, new C18.3, Part H
- **Decision:** agents never change intents, contracts, examples or existing checks to finish a task. They propose with `capsules propose`, which writes a note to `.capsules/_proposals/`, and the note appears in `capsules review`. Applying a proposal automatically moves to v1: a human or the drafter applies it.
- **Interpretations:**
  1. Proposal files are committed, so they reach the pull request and survive a lost cache.
  2. Any role but `judge` may create one; changing or deleting an existing one is owners only.

## D-033: `capsules review` and `approvals.lock`

- **Date:** 2026-11-17 · **Approved by:** Parth (M6a item 4; `approvals.lock` approved as designed)
- **Changes:** C1, C2.6 (`E033`, `E034`), C5.1, C6.2, C15, new C18.4
- **Decision:** `capsules review` lists everything waiting for a human. Risky items come first, in full; routine items follow, one line each. An approval pins the exact version approved in the tool-written `.capsules/approvals.lock`. "Approve all" (`--routine`) never includes a rule, intent, example or check. Approving is humans only: the command refuses inside an agent's shell, and CI checks that each change to `approvals.lock` comes from an owner (`E033`).
- **Interpretations:**
  1. An approval holds only for the hash it pins: if the rule or test changes again, it is waiting for review again.
  2. An approved item gets no `W108`, and an approved new check is no longer "unreviewed".
  3. The local refusals can be bypassed by an agent with a shell, so CI and CODEOWNERS (`capsules codeowners` now lists `approvals.lock`) are the gate (B13, I1).

## D-034: Gentle mode for new installs; the 7-day reminder is v1

- **Date:** 2026-11-17 · **Approved by:** Parth (M6a item 5)
- **Changes:** C2.6 (`W111`), C4 (`mode`), C15 (`mode`), new C18.5, Part H
- **Decision:** `mode: gentle` turns only two kinds of `E027` into warnings (`W111`): an agent working outside its scope, and an agent editing a file covered by a concern it is barred from. Weakening or deleting existing checks, the one rule, edits to the guard, and changes to intents and contracts stay blocked in every mode. New installs start gentle; a missing `mode` means strict, so existing installs don't change. `capsules mode strict` switches, and is humans only.
- **Interpretations:**
  1. "What strict mode would have blocked" is kept on this machine (`_cache/gentle-log.jsonl`) and printed by `capsules mode`.
  2. The suggestion after 7 days, counted from the Git date of the install commit, moves to v1.

## D-035: Starter checks from approved examples

- **Date:** 2026-11-17 · **Approved by:** Parth (M6a item 2)
- **Changes:** C6.2, C12 (`/capsules-draft`), new C18.6
- **Decision:** when an app has few or no tests, `/capsules-draft` may write a few new tests, only for examples the human approved. Check files added by a `drafter` session stay "unreviewed" until an owner approves them in `capsules review`.

## D-036: When blocked, keep going

- **Date:** 2026-11-17 · **Approved by:** Parth (M6a item 7)
- **Changes:** C11 (block messages), C10 and C12 (agent files), new C18.7
- **Decision:** every block message ends with the next step. The agent doesn't try another way around the block, carries on with the rest of the task, and, if a test or rule looks wrong, leaves a proposal with `capsules propose`.

## D-037: M6 is split into M6a (zero friction) and M6b (ship)

- **Date:** 2026-11-17 · **Approved by:** Parth
- **Changes:** Part E, Part I4
- **Decision:** M6a is the zero-friction set (C18), built in the order 1, 7, 6, 4, 5, 2, 3, plus the work already on the `m6` branch: the pre-bash fix, the partner package, and the GitHub Action with the sticky summary. M6b is the release workflow, the README, the demo repo, the 45-second demo script, and the partner package rebuilt with M6a.
- **Also recorded (I4):** the commit-msg hook stays opt-in (`--git-hooks`). The demo concerns are auth, payments and pii; Parth will ask the design partners which matter most.
