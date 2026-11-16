# billing-demo

A tiny app used to demo capsules: invoices, checkout, users and their tests.
Its `.capsules/` folder describes what each part is for.

```sh
npm test                                     # the app's own tests (node --test)
npx capsules explain src/web/checkout.tsx    # what applies to the checkout page
npx capsules status                          # capsules, files and orphans
npx capsules check --no-run                  # validate the capsules
```

From this repository, run the local build instead of `npx capsules`:
`node ../../dist/cli.js explain src/web/checkout.tsx`.
