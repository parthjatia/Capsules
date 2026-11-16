# Workflows for Parth to install

Agents may not write CI workflows (`edit-config`, D-020): the capsules hook blocks Claude from
editing `.github/workflows/`, so an agent can't switch the guard off. These files are prepared
here instead; Parth reviews them and copies them into place in **his own commit** (no
`Capsule-*` trailers), which makes them an owner's change.

| File           | What it does                          | Changes                                                                                                                                                                                     |
| -------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`       | Replaces `.github/workflows/ci.yml`   | Adds the `partner-install` job (Ubuntu and Windows): builds the partner package and rehearses `docs/PARTNER-INSTALL.md` on a clean copy. `ci-ok` now waits for it too. Nothing else changes |
| `capsules.yml` | New: `.github/workflows/capsules.yml` | Runs the Capsules Action on this repo's pull requests and posts the sticky summary comment (C17). Builds capsules from this repo until it is published                                      |
| `release.yml`  | New: `.github/workflows/release.yml`  | Publishes to npm when a `v*` tag is pushed. Unused until Parth OKs a release: it refuses while `package.json` is `private`                                                                  |

## To install them (one command, from the repo root)

```sh
cp docs/proposed-workflows/ci.yml docs/proposed-workflows/capsules.yml docs/proposed-workflows/release.yml .github/workflows/ && git add .github/workflows && git commit -m "Workflows for M6: partner install job, capsules summary, release (prepared)"
```

Then push. On the next push to the M6 pull request you should see a new check, **partner install**, for Ubuntu and Windows, and a comment from **github-actions** that starts with "**Capsules** found ..." followed by the summary.
