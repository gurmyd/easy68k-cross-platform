Status: done (applied by the engineer closing round I3, DOC1: package.json script check:stop-buttons; ci.yml header table, plan output, guards table, browser-checks step in group simulator after the SH7 step, screenshot paths).

# T3: run the new browser check `tests/conformance/sim/check-stop-buttons.mjs` in CI

## What was added

`tests/conformance/sim/check-stop-buttons.mjs` (owner T3) checks hardware §13 item 21's "dark-maroon
look" in a browser: a program whose first instruction is `STOP #$2000` runs with exceptions off, and
all seven IRQ buttons and Reset must be disabled with background and border colours
`rgb(64, 0, 0)` (#400000), in Chromium and WebKit, light and dark theme (errata T3 entries 12 and
13). It follows the convention of `check-shell.mjs`: Vite on a free port, `--browser
chromium|webkit|all`, `--out <dir>` (default `build/T3/stop-buttons`), prints "N of M checks
passed", exit 1 on a failure or a console error. It needs engine/dist and fails without it (with a
message), so its step should be guarded like `check:run`.

Run on this PC (Windows 11, 2026-11-22): `node tests/conformance/sim/check-stop-buttons.mjs
--browser all`: 20 of 20 checks passed (Chromium 159, WebKit 27.2).

## What is asked (configuration engineer)

Until this is done, `npm run lint` fails in `tests/lint/ci-workflow.test.ts` ("... is in the plan
step's table"), so the script should not be committed without these changes:

1. Root `package.json`: `"check:stop-buttons": "node tests/conformance/sim/check-stop-buttons.mjs"`.
2. `.github/workflows/ci.yml`:
   - the header's table: `stop_buttons  tests/conformance/sim/check-stop-buttons.mjs  T3`;
   - `plan` outputs: `stop_buttons: ${{ steps.guards.outputs.stop_buttons }}`;
   - the `checks=` table of the step `guards`: `stop_buttons    tests/conformance/sim/check-stop-buttons.mjs`;
   - a step in `browser-checks`, group `simulator`, after "Hardware panel check (SH7)":
     ```yaml
     - name: STOP buttons check (T3, hardware 21)
       if: ${{ !cancelled() && matrix.group == 'simulator' && needs.plan.outputs.stop_buttons == 'true' && needs.engines.outputs.available == 'asm sim' }}
       timeout-minutes: 15
       run: npm run check:stop-buttons
     ```
   - the screenshot upload paths: `build/T3/stop-buttons/` and `!build/T3/stop-buttons/vite-cache/`.
