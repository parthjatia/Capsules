# Progress

## Done

### M0: Scaffold

- TypeScript (strict, ESM) project `@pyscoparth/capsules`, bundled with tsup into `dist/cli.js`.
- `--version` and `--help` work. Exit codes follow C15.
- Tests for no network/no AI, SPEC.md sync, version and the CLI.
- CI on Ubuntu, macOS and Windows.
- Decisions D-001 to D-006 are logged.
- Branch `m0-scaffold` is pushed. I couldn't open the PR because `gh` isn't logged in on this machine.

### M1: Read and explain (in review, waiting for Parth's go)

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

- **M2: Lock and freshness.** Hash pipeline (C7.1), `lock`, `refresh`, `relock --cosmetic`, and staleness in `status` and `check`.

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

## Open questions for Parth

1. The remaining I4 questions: whether `init` installs the commit-msg hook by default, which concerns the design partners care about most, and Cursor support beyond compiled rules.

## Notes

- Dev-only tools carry `npm audit` advisories: esbuild's dev server on Windows, and minimatch inside typescript-eslint. `npm audit --omit=dev` reports 0 vulnerabilities.
- esbuild (dev tool) has an install script. The "no install scripts" rule (D3) is enforced for runtime dependencies, which are what users install, and the M1 libraries all pass it.
