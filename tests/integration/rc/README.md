# The release candidate's evidence (I3)

Section 6.9 of `docs/ARCHITECTURE.md` lists twelve conditions under which version 1.0.0 may be
tagged; the correction notes printed under that list are part of the items. This folder holds what
makes the evidence for each item re-runnable. The verdicts, with the numbers of the last check and
the CI runs read, are in [`docs/integration/rc.md`](../../../docs/integration/rc.md).

## One command

```
npm run check:rc
node tests/integration/rc/fetch-ci.mjs build/rc-logs     # read-only: the CI logs the judges read
npm run check:rc -- --logs build/rc-logs                 # also judge those logs
npm run check:rc -- --browsers [--dist <app build>]      # also the browser walks of items 7 and 12
```

`rc.mjs` first runs the comparisons that items 2 and 5 read, with four Vitest workers: the sim
project of `npm run test:conformance` (with `EASY68K_SIM_REPORT_JSON`, so that the run writes what
it compared and measured) and the files that the unit entries of `tests/parity/matrix.json` name,
each with the Vitest configuration of its folder; their JSON reports go to `--out <folder below
build/>` (default `build/I3/rc`, emptied first). Then it runs every local judge below (about two
minutes in all; item 3 and the comparisons are most of it) and prints one line per item: **holds**, **does not hold**, **not shown yet**, **shown only in CI** (with the
run and the command that judges its log) or **open for a person**. It exits 1 while any item does
not hold, so it is not part of CI: today items 2 and 6 do not hold.

`--logs <folder>` takes job logs saved as `<job id>.log` and the job lists of the runs saved as
`run-<run id>.json`; with them it also judges items 4, 5, 6, 8, 9 and 10 from CI.
`fetch-ci.mjs` writes both with the GitHub CLI (`--gh <path>` when `gh` is not on the PATH), only
reading; by hand:

```
gh api --allow-escape-sequences repos/gurmyd/easy68k-cross-platform/actions/jobs/<id>/logs > <folder>/<id>.log
gh api "repos/gurmyd/easy68k-cross-platform/actions/runs/<id>/jobs?per_page=100" > <folder>/run-<id>.json
```

The run and job ids are in `lib/runs.mjs` (the runs of the commit the check was made on;
`docs/integration/rc.md` names them). For a check on a later commit, put that commit's ids there.

What it needs: `engine/dist` (items 2, 3 and 5), and the reports of the last `npm run
test:conformance` in `build/reports` (item 1; a report older than `tests/corpus/manifest.json`,
`tests/conformance/asm/known-differences.json` or the assembler in `engine/dist` is not judged:
exit 2). Item 1 compares the `site` set only where it was fetched (`node
tools/fetch-site-examples.mjs`, not redistributable); the oracle workflow does that on GitHub.

## Item by item

| Item                       | What proves it                                                                                                                                                                                                                                                                                                                                             | How to run it                                                                                                                                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Assembler                | The conformance reports of `tests/conformance/asm` (corpus and checklist), read against `tests/corpus/manifest.json`, the fixed subset `tests/corpus/option-subset.json` (30 files x 8 options), `known-differences.json` and `docs/DIFFERENCES.md` (a run without an official result is an exception with its cause, erratum T1 26)                       | `npm run test:conformance`, then `node tests/integration/rc/item-01-asm-evidence.mjs`                                                                                                                                                                                                                                             |
| 2 Simulator                | The self-reporting programs and execution logs of `tests/conformance/sim` against their Wine goldens, sorted by the correction note of erratum T3 14 (accepted, unconfirmed, counted against); sim-core 3.16 and the TRAP #15 tasks (interactive ones as erratum T3 11 lists them); the three checklists, each item with tests found by their exact titles | the sim project with `EASY68K_SIM_REPORT_JSON=<sim.json>` and Vitest's JSON reporter (`<vitest.json>`), then `node tests/integration/rc/item-02-sim-evidence.mjs --sim-report <sim.json> --sim-vitest <vitest.json>` (`check:rc` does both); `node tests/integration/rc/item-02-checklists.mjs` (list: `item-02-checklists.json`) |
| 3 Drawing                  | 6.5.1 and 6.5.2 against the GDI captures; 6.5.3 as the architect decided (classes (1), (2), (3) of the note under 6.5.3) on the port's own text screen; 6.5.4's baseline. Browser half and second Windows build: CI                                                                                                                                        | `npx vitest run --config tests/integration/rc/item-03-vitest.config.ts --silent=false`; CI: `check:text`, `check:examples`, `check:surface`, windows-oracles                                                                                                                                                                      |
| 4 Twins                    | The report of `npm run oracle:twins` (CI job windows-oracles, Windows only)                                                                                                                                                                                                                                                                                | `node tests/integration/rc/item-04-twins.mjs --report <windows-oracles log>`                                                                                                                                                                                                                                                      |
| 5 Parity                   | Every row of 1.3 in `tests/parity/matrix.json`; the web-e2e entries in the e2e logs of both browsers, the desktop-e2e entries in the desktop logs; the manual entries' rows in the manual                                                                                                                                                                  | `node tests/integration/rc/item-05-parity.mjs [--web chromium=<log> --web webkit=<log> --desktop <log>] [--unit <vitest json> ...]` (`check:rc` makes and passes the unit reports); sign-off: a person                                                                                                                            |
| 6 Platforms                | The workflows against 7.4; the jobs of the CI runs; the packaged-app checks 1-8 of 6.7 in the release logs                                                                                                                                                                                                                                                 | `node tests/integration/rc/item-06-platforms.mjs [--run ci=<jobs json>] [--mac arm64=<log> --mac x64=<log>]`                                                                                                                                                                                                                      |
| 7 Offline                  | `tests/e2e/app/offline.spec.ts` and `check:pwa` in CI; the manual's first program offline in both browsers                                                                                                                                                                                                                                                 | `node tests/integration/rc/item-07-check-offline.mjs --browser all [--dist <build>]`                                                                                                                                                                                                                                              |
| 8 Accessibility            | The lists of erratum X1 8 (one `ALLOWED` entry, no `KNOWN`); the axe checks of the audit's logs (a failing keyboard-walk check is printed and counts under item 6); `a11y.spec.ts` in the e2e logs                                                                                                                                                         | `node tests/integration/rc/item-08-a11y-lists.mjs [--log <audit log>] [--e2e-log <e2e log>]`; sign-off: a person                                                                                                                                                                                                                  |
| 9 Performance              | `tests/perf/check-perf.mjs` in Chromium on `ubuntu-latest` (CI, a run by hand), judged by the document's rule with the correction note of erratum P1 13                                                                                                                                                                                                    | `node tests/integration/rc/item-09-perf-verdict.mjs <log> --require-ubuntu`                                                                                                                                                                                                                                                       |
| 10 Stability               | The six e2e stability shards of a ci.yml run by hand (20 repetitions in each browser, each log of an Ubuntu runner)                                                                                                                                                                                                                                        | `node tests/integration/rc/item-10-stability.mjs --current <the six logs>`                                                                                                                                                                                                                                                        |
| 11 Open verification items | Every UNVERIFIED of the specs and errata accounted for; each open item a row of its own in part 4 of `docs/DIFFERENCES.md` with the port's chosen behaviour; confirmed items gone from it                                                                                                                                                                  | `node tests/integration/rc/item-11-unverified.mjs [--all]`                                                                                                                                                                                                                                                                        |
| 12 Manual                  | `docs/MANUAL-TEST-MAC.md` against 6.8 and the application; part A walked in both browsers as written; completion: a person on a Mac                                                                                                                                                                                                                        | `node tests/integration/rc/item-12-manual-coverage.mjs`; `node tests/integration/rc/item-12-check-part-a.mjs --browser all [--dist <build>]`                                                                                                                                                                                      |

## Showing that a judge fails when its item is broken

Several judges take a copy of their input through an environment variable, so that a broken input
can be tried without touching the repository:

| Variable                        | Judge               | Example                                                                                                               |
| ------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `EASY68K_RC_DIFFERENCES=<file>` | items 1, 2, 11      | a copy of `docs/DIFFERENCES.md` without an exception or a part-4 row, or with a row's third cell emptied              |
| `EASY68K_RC_REPORTS=<folder>`   | item 1              | copies of the conformance reports dated before the manifest                                                           |
| `EASY68K_RC_KNOWN_SIM=<file>`   | item 2              | a copy of `known-differences.json` with an `unconfirmed` field removed, or without `a51` and `a52`                    |
| `--sim-report <file>`           | item 2              | a copy of the comparison's report with a measured difference removed, or of a partial run                             |
| `--unit <file>`                 | item 5              | a copy of the sim project's Vitest report without the test of one program of `logs`                                   |
| `EASY68K_RC_PORTING=<folder>`   | item 11             | a copy of `docs/porting` with a new "unverified" statement                                                            |
| `EASY68K_RC_CHECKLISTS=<file>`  | item 2 (checklists) | a proof whose title is only the start of the real one                                                                 |
| `EASY68K_RC_SPOIL=<suite>`      | item 3              | moves one reference's pen by a pixel in memory (a text suite of 6.5.3 or a primitive suite of 6.5.1, such as `lines`) |
| `EASY68K_RC_MANUAL=<file>`      | item 12 (part A)    | a manual without the Caution box                                                                                      |
| `EASY68K_RC_WORKFLOWS=<folder>` | item 6              | a copy of `.github/workflows` with a job of 7.4 on another runner                                                     |

The judges that read logs (items 4, 5, 8, 9, 10, and 6 with `--run` and `--mac`) are shown to fail
on a copy of a log with one result changed (a red cross on a named test, a failing `axe` check, a
smaller instruction count, a runner image other than Ubuntu for items 9 and 10).

## Files

- `rc.mjs`: the entry point (`npm run check:rc`).
- `fetch-ci.mjs`: downloads, read-only, the CI logs and job lists that `--logs` judges.
- `lib/runs.mjs`: the CI runs and jobs of the check.
- `item-NN-*.mjs`, `item-03-drawing.test.ts` with `item-03-vitest.config.ts`: one judge per item, each
  with a header that says what it proves and how to run it.
- `item-02-checklists.json`: the three checklists of item 2, item by item, with their proofs.
- `item-07-12-lib.mjs`: the server and page helpers of the two browser walks.
- `lib/test-titles.mjs`: finds a test or check by its exact title (item 2; item 5 has its own exact match).

None of these starts a browser unless it is a browser walk (items 7 and 12, after the project's
`check-<name>.mjs` convention: a static server on a free port, headless Chromium and WebKit,
screenshots below `build/`).
