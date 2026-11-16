# Progress

## Done

### M0: Scaffold (in review, waiting for Parth's go)

- TypeScript (strict, ESM) project `@pyscoparth/capsules`, bundled with tsup into `dist/cli.js`.
- `capsules --version` and `capsules --help` work. Unknown options exit 64, crashes exit 70 (C15).
- Tests (vitest):
  - **no network, no AI:** fails if `src/` imports `http`, `https`, `net`, an AI SDK or telemetry, or if any runtime dependency has an install script.
  - **spec sync:** fails if `docs/SPEC.md` differs from Part C of CLAUDE.md.
  - **version:** the version in code matches `package.json`.
  - **CLI end-to-end:** runs the real built file.
- CI on GitHub Actions: lint, format, typecheck, spec sync, tests and `npx . --version`, on Ubuntu, macOS and Windows.
- Spec decisions D-001 to D-006 applied and logged in `docs/DECISIONS.md`.
- Our own `.capsules/` folder with config, permissions and a first root capsule. M1 will validate it.

## Next

- **M1: Read and explain.** Parser, validation codes, membership, `explain`, `status` (orphans), `check --no-run`, and the `examples/billing-demo` app.
- In M1: measure hook start-up time on a 1,000-file repo and report the numbers to Parth before choosing a fix (D-006).

## How to demo M0

```sh
npx . --version
```

You should see `0.0.0`.

## Open questions for Parth

1. **Node 20 has been end-of-life since April 2026.** The newest test and build tools (vitest 5, tsup 9) need Node 22 or later, so M0 uses the previous versions (vitest 4, tsup 8) to keep the promised "Node 20+". Recommendation: raise the minimum to Node 22 (changes B14). That needs your yes.
2. **Where do body fields go? (needed for M1.)** C2.2 says fields like `checked-by:` come at the **start** of a node's body, and the first other line starts free text. But the C2 example puts `checked-by:` **after** the text ("Never create two invoices…" then `checked-by: @no-duplicates`). Also, common Markdown formatters (Prettier) insert a blank line under every heading. Recommendation: a known field is read anywhere in the body if it sits on its own line, and blank lines right under the heading are ignored. That keeps the examples valid and survives formatters. Needs your yes because it changes C2.2.
3. The remaining I4 questions: whether `init` installs the commit-msg hook by default, which concerns the design partners care about most, and Cursor support beyond compiled rules. These are needed before M6.

## Notes

- Dev-only tools carry two `npm audit` advisories: esbuild's dev server on Windows, and minimatch inside typescript-eslint. Neither ships to users, and `npm audit --omit=dev` reports 0 vulnerabilities.
- esbuild (dev tool) has an install script. The "no install scripts" rule (D3) is enforced for runtime dependencies, which are what users install.
