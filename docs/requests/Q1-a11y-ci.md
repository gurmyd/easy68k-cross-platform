# Q1: the accessibility audit in CI

Status: applied in the round that prepares gate I3 (config), all three items. (1) Root script
`check:a11y`. (2) `browser-checks` has a fourth group, `accessibility`, on Ubuntu, macOS and Windows
(job limit 75 minutes): the steps "Accessibility audit in Chromium (Q1)" and "... in WebKit (Q1)",
`npm run check:a11y -- --browser <b>`, 30 minutes each, guarded by the plan output `a11y`;
`build/Q1/a11y-check/` is in the failure upload (errata W0.md entry 9). (3) `a11y/vitest.config.ts` is
in `PROJECT_GLOBS` of `tests/vitest.workspace.ts` (35 tests passed here). Run here with
`EASY68K_REQUIRE_ENGINES=1`, both browsers, about 19 minutes: 1216 of 1220, 4 failed, all the same
cause: the dialog `desktop-devices.serialPorts` (DV4, merged after the audit was written) has no route
in `tests/a11y/lib/scan.mjs` ("every dialog the features register has a route in the audit", "every
registered dialog was scanned (24)", in each browser). That is for Q1 (a route in `ROUTES`, opened by
the command docs/requests/DV4-serial-ports-command.md asks W3 for); until then the group
`accessibility` is red. Every known defect Q1-1 to Q1-6 printed "seems repaired" in both browsers:
Q1 removes their `KNOWN_CHECKS` entries.

Q1 delivers `tests/a11y/check-a11y.mjs` (the browser half of the audit) and
`tests/a11y/vitest.config.ts` (unit tests of its logic under Node). Neither runs anywhere yet,
because the root `package.json`, `tests/vitest.workspace.ts` and `ci.yml` are frozen.

## 1. A root script

In the root `package.json`, next to the other browser checks:

```json
"check:a11y": "node tests/a11y/check-a11y.mjs",
```

It takes the same options as the other checks (`--browser chromium|webkit|all`, `--out <dir>`)
and one more, `--only scan,structure,contrast,walk-edit,walk-run`. It starts its own Vite dev
server on a free port, needs only the pinned development dependencies (`@playwright/test`,
`@axe-core/playwright`, `vite`) and `engine/dist`, prints "N of M checks passed" and exits
non-zero on any failure. It honours `EASY68K_REQUIRE_ENGINES=1`.

## 2. The job `browser-checks`

Add `npm run check:a11y` to the job `browser-checks` of `.github/workflows/ci.yml`, on Ubuntu,
macOS and Windows, as for the other thirty checks. Nothing in it assumes Windows: keys come from
`chordsOn()` in the page, Tab on the macOS key map follows Safari's default rule (on GitHub's
macOS runner WebKit already behaves that way; elsewhere the script presses Tab again where Safari
would have skipped a button), no fixed port, screenshots only under `build/`.

Duration on this development PC (Windows 11, loaded by other engineers' jobs): the whole check in
both browsers took about half an hour (1062 checks); the scan alone about 5.5 minutes per browser.
If a job limit is tight, the parts can be split over steps with `--only`.

## 3. The unit tests of `tests/a11y/lib`

`tests/vitest.workspace.ts` collects `conformance/*/vitest.config.ts` and
`parity/vitest.config.ts`. Please add `a11y/vitest.config.ts` to `PROJECT_GLOBS`, so that
`npm run test:conformance` runs the 34 tests of `tests/a11y/lib/*.test.mjs` (contrast arithmetic,
chord spelling for Playwright, the Safari Tab rule, the classification of axe findings, the
report's tally). Until then: `npx vitest run --config tests/a11y/vitest.config.ts`.
