# Progress

## Done

### M0: Scaffold

- TypeScript (strict, ESM) project `@pyscoparth/capsules`, bundled with tsup into `dist/cli.js`.
- `--version` and `--help` work. Exit codes follow C15.
- Tests for no network/no AI, SPEC.md sync, version and the CLI.
- CI on Ubuntu, macOS and Windows.
- Decisions D-001 to D-006 are logged.
- Merged into `main` (PR #1).

### M1: Read and explain

- **Parser** (`src/core/parse.ts`): front matter, `##` node headings, links, fields read anywhere by valid key (D-007), transclusions, and file:line positions.
- **Validation codes:**
  - E001–E008 and E012–E015 are errors.
  - W101, W102, W103, W105 and W106 are warnings.
  - E009–E011, W104, W107 and W108 belong to M2 to M4.
- **Membership** (`src/core/membership.ts`): each file's home capsule (the deepest one wins), the concerns covering it, orphans, and two-home conflicts.
- **Commands:**
  - `capsules explain <file>`
  - `capsules status` (counts, orphans, assumptions past review)
  - `capsules check --no-run`
  - All three support `--json`.
- **Demo app:** `examples/billing-demo` has 5 area capsules, 2 concerns, a working app and 7 passing tests.
- **Tests:** 79 tests (unit and end-to-end, using real temporary Git repos).
- **CI:** also validates this repo's own `.capsules/` and runs the demo app's tests.
- Merged into `main` (PR #3), with decisions D-008 to D-011.

### M2: Fingerprints and staleness (in review, waiting for Parth's go)

- **Fingerprints** (`src/core/hash.ts`): the frozen C7.1 pipeline for nodes; RFC 8785 JSON Canonicalization for front matter (D-012). The exact values are pinned in tests and cross-checked with Python.
- **Lockfile** (`src/core/lock.ts`): `.capsules/capsules.lock` in the C7.2 format, sorted, LF only, byte-identical on every run and OS.
- **Commands**, all with `--dry-run` and `--json`:
  - `capsules lock` pins new links and never re-pins existing ones (B12).
  - `capsules refresh <address>` re-pins links from a reviewed node.
  - `capsules relock --cosmetic <address>` re-pins links to a node and prints the `Capsule-Cosmetic:` line for the commit message (D-013).
- **Staleness:**
  - `status` shows the lock state, stale links and changed prompts.
  - `check` reports `E010` (lock out of date), `W104` (stale link; an error with `stale-links: block`), `W109` (prompt file missing), `W110` (stale prompt) and `E026` (unreadable lockfile).
- **Safety:** `lock` refuses to write while capsules have errors, or when the lockfile can't be read, so pins are never lost silently.
- **Lockfiles** are committed for this repo and the demo. CI fails if either goes out of date.
- **Tests:** 127 (unit and end-to-end), including F1 scenario 3 and the determinism checks.

## Speed measurements (M1, as asked in D-006)

Setup: 1,012 tracked files, 12 capsules, Windows 11, Node 24, median of 10–15 runs.

| What                                                | Time    | Target                   |
| --------------------------------------------------- | ------- | ------------------------ |
| Bare Node start (`node -e 0`)                       | 69 ms   | n/a (the floor)          |
| `git ls-files` alone                                | 31 ms   | n/a                      |
| `capsules --version`                                | 154 ms  | n/a                      |
| `capsules check --no-run`                           | 346 ms  | under 1 s: **met**       |
| `capsules explain <file>`                           | 360 ms  | n/a                      |
| A hook would cost about the same as `explain` today | ~350 ms | under 150 ms: **missed** |

Where the time goes: Node itself takes about 70 ms. Loading our 1.5 MB bundle (Markdown parser, YAML, zod) takes about 85 ms. Reading and validating every capsule plus `git ls-files` take about 200 ms. Linux and macOS usually start Node about twice as fast as Windows.

Options for the hook (Parth chose option 1, see D-010):

1. **Recommended: a small separate hook entry point plus a cached index.** `capsules hook` loads only a tiny file. It reads the parsed index from `.capsules/_cache/`, which C11 already asks for, and re-parses only when a capsule file's timestamp or size changes. Expected cost is Node start plus about 20–40 ms, roughly 100 ms on Windows.
2. **Load command code only when it's needed**, inside the one bundle. This is simpler, but it saves only the 85 ms of loading. A hook would still parse everything, at about 250 ms.
3. **Relax the target**, for example to 300 ms on Windows. This is the least work, but agents will feel the delay on every edit.

## Next

- **M3: Guard in CI.** Checks runner, the one rule, append-only decisions (E009), weakened-test signals, permissions via trailers, `check --base`, and the owner check for `Capsule-Cosmetic` (D-013).

## How to demo M2

In `examples/billing-demo`, change the wording of invoice contract C1 in `.capsules/billing/invoices.md`, then run:

```sh
node ../../dist/cli.js status
```

You should see `lock: out of date`, then 4 stale links: everything that points to `billing.invoices#C1`, plus one line saying replaced decision D3 was skipped (D-015). Undo the edit (`git checkout .capsules/billing/invoices.md`) and status is clean again.

## How to demo M1

```sh
cd examples/billing-demo
node ../../dist/cli.js explain src/web/checkout.tsx
```

You should see the checkout page's home (`web`), parents (`root`), concerns (`payments, pii`) and the five rules that apply. Run `npm run build` in the repo root first if `dist/` is missing.

## Decided since M1

- D-008: approved, with each error situation getting its own code (D-011, E016 to E025).
- Hook speed: option 1, with targets of 150 ms on macOS/Linux and 300 ms on Windows; measure again in M4 (D-010).
- Node 22+, and CI tests Node 22 and 24; macOS runs only for main (D-009).
- Front matter fingerprint uses RFC 8785 (D-012); `relock --cosmetic` prints the trailer (D-013).
- New codes E026, W109, W110 approved (D-014); replaced decisions are skipped in stale reports, with one summary line (D-015).

## Open questions for Parth

1. The remaining I4 questions: whether `init` installs the commit-msg hook by default, which concerns the design partners care about most, and Cursor support beyond compiled rules.

## Notes

- Dev-only tools carry `npm audit` advisories: esbuild's dev server on Windows, and minimatch inside typescript-eslint. `npm audit --omit=dev` reports 0 vulnerabilities.
- esbuild (dev tool) has an install script. The "no install scripts" rule (D3) is enforced for runtime dependencies, which are what users install, and the M1 libraries all pass it.
