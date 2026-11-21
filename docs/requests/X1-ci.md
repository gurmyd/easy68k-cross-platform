# X1: CI for the end-to-end suites

Status: open (for gate I2).

## 1. The existing job `e2e` fits; nothing to change there

The job (`.github/workflows/ci.yml`, `e2e`) runs `npm run build` and then
`npm run test:e2e -- --project ${{ matrix.browser }}` on ubuntu, macOS and Windows. X1's
`tests/playwright.config.ts` keeps that contract: with `CI` set it serves the existing `app/dist`
(no second build), on a free port it picks itself, with `tests/e2e/fixtures/serve.mjs` (Vite's
preview server with `app/vite.config.ts`). The report and results still go to
`tests/playwright-report/` and `tests/test-results/`, the paths the upload step already names.
The job needs `engine/dist` only because `npm run build` puts the engines into the build; the
suites themselves do not read `engine/dist`.

## 2. Requested: a stability job for 6.9 item 10 (20 repetitions on ubuntu-latest)

The acceptance of X1 and 6.9 item 10 ask for 20 repetitions in a row without a failure on
`ubuntu-latest` in each browser. No job runs that. Proposed, after `e2e` in `ci.yml`:

```yaml
  e2e-stability:
    name: e2e stability (ubuntu-latest, ${{ matrix.browser }}, 20 repetitions)
    needs: [plan, engines]
    # Too long for every push (about 20 times the e2e job): manual runs, the weekly schedule,
    # and pushes that change tests/e2e/**.
    if: needs.plan.outputs.e2e == 'true' && (github.event_name == 'workflow_dispatch' || github.event_name == 'schedule' || contains(join(github.event.commits.*.modified, ' '), 'tests/e2e/'))
    strategy:
      fail-fast: false
      matrix:
        browser: [chromium, webkit]
    runs-on: ubuntu-latest
    timeout-minutes: 300
    steps: # the same steps as e2e up to "Production build", then:
      - name: End-to-end tests, 20 repetitions
        run: npm run test:e2e -- --project ${{ matrix.browser }} --repeat-each=20
```

with the same artifact upload on failure. If the schedule guard of `plan` sets `e2e=false` on
scheduled runs (it does today, line 197), the weekly run needs that guard to leave `e2e` alone for
this job, or the job should run on `workflow_dispatch` only.

## 3. Requested: a root script for local runs against a scratch build (optional)

`"test:e2e:dist": "playwright test --config tests/playwright.config.ts"` with `E2E_DIST` documented
is not needed (the variable works with `npm run test:e2e` already); listed only so the gate can
decline it knowingly.
