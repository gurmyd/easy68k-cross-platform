# Request of M2 (version 1.1): run check-arrange in CI

Status: open (for the gate's configuration engineer; M2 does not edit `.github/workflows/ci.yml`).

`app/src/features/layout/check-arrange.mjs` (root script `check:arrange`, already in the root
`package.json`) is the browser check of ARCHITECTURE-PLUS P9.3 and P9.4. Until `ci.yml` names it,
`tests/lint/ci-workflow.test.ts` fails with "app/src/features/layout/check-arrange.mjs is in the
plan step's table" (`npm run lint`).

Its pass `program` runs a 68000 program, so it needs `engine/dist` (without it the pass is skipped
with a note, and with `EASY68K_REQUIRE_ENGINES=1` the check fails): group `simulator`, with the
engines' condition, like `check:sim-main`.

1. The plan step's comment table, after the row of `additions` (the stage of additions):

       #       arrange       app/src/features/layout/check-arrange.mjs          M2

2. The plan step's `checks` table, after `additions`:

       arrange         app/src/features/layout/check-arrange.mjs

3. The plan job's outputs, after `additions`:

       arrange: ${{ steps.guards.outputs.arrange }}

4. A step of the job `browser-checks`, after the other `simulator` checks:

       - name: Arrange check (M2)
         if: ${{ !cancelled() && matrix.group == 'simulator' && needs.plan.outputs.arrange == 'true' && needs.engines.outputs.available == 'asm sim' }}
         timeout-minutes: 20
         run: npm run check:arrange

5. The uploaded artifact's paths, beside `build/dock-check/`:

       build/arrange-check/
       !build/arrange-check/vite-cache/

The check took 111 s on this PC for both browsers and all passes (270 of 270); 20 minutes leaves
room for GitHub's slower macOS runner.
