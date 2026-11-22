# N10: run the guide's text check in CI, and tell the lint test it is not a browser check

Status: open. Filed by N10 for the gate's configuration engineer (ci.yml and tests/lint are not
N10's).

## What is wrong

N10 added `tools/check-guide-strings.mjs` (the user guide's section "Beyond the original" quotes only
texts of the code) and its unit test `tools/check-guide-strings.test.mjs`, with the root script
`check:guide` (`node tools/check-guide-strings.mjs && node --test tools/check-guide-strings.test.mjs`).
It starts no browser and needs no engine; it takes about 10 s.

1. No job of `.github/workflows/ci.yml` runs it.
2. `npm run lint` is red because of it: `tests/lint/ci-workflow.test.ts` takes every
   `tools/check-*.mjs` for a browser check that must be in the plan step's table, and fails with
   `tools/check-guide-strings.mjs is in the plan step's table` (AssertionError: expected [ ...(39) ]
   to include 'tools/check-guide-strings.mjs'). It is not a browser check, and `OWN_JOBS` does not
   fit it either (that entry wants the root script to be exactly `node <file>` and a workflow line
   `npm run <script> -- `).

## What is asked

1. In `ci.yml`, job `check`, right after the step `Documents (DOC1)`:

   ```yaml
         # docs/requests/N10-check-guide.md: every caption and text that docs/USER-GUIDE.md quotes in
         # "Beyond the original" is a text of the stage's texts.ts files or of commands/specs.ts.
         # Node only, no browser, ~10 s.
         - name: Guide texts (N10)
           if: ${{ !cancelled() && hashFiles('tools/check-guide-strings.mjs') != '' }}
           run: npm run check:guide
   ```

   and in the head comment, after the row `check: documents`:

   ```yaml
   #   check: guide texts         tools/check-guide-strings.mjs        (npm run check:guide, N10)
   ```

2. In `tests/lint/ci-workflow.test.ts`, leave the tools that are not browser checks out of
   `checkScripts()`, for example:

   ```ts
   /** tools/check-*.mjs that start no browser: a step of the job `check` runs them. */
   const NOT_BROWSER_CHECKS: Record<string, string> = { 'tools/check-guide-strings.mjs': 'check:guide' };
   ```

   with `checkScripts().filter((file) => !(file in OWN_JOBS) && !(file in NOT_BROWSER_CHECKS))`, and a
   test that each such root script exists and that `ci.yml` has `run: npm run <script>`.

Until both are done, `npm run lint` fails with the one assertion above, and nothing else of the
package's checks depends on it.
