# X3: run the whole-program pixel check in CI

Status: applied in the round that prepares gate I3 (config), as asked: root script `check:examples` (no
`--browser`), the step "Whole-program pixel check (X3)" of `browser-checks`, group `simulator`, on Ubuntu,
macOS and Windows, guarded by the plan output `examples` and by both engines; `build/X3/check/` is in the
failure upload. Run here: 309 of 309 checks passed. `tests/lint/ci-workflow.test.ts` now fails when a
`check-*.mjs` under `app/src` or `tests` has no root script or no CI step.

Package: X3 (whole-program pixel regression). Requested change: shared configuration (root
`package.json`, `.github/workflows/ci.yml`), which X3 may not edit.

## What

1. A root script:

       "check:examples": "node tests/conformance/examples/check-examples.mjs"

   (no `--browser`: the script's default is both browsers, like the other checks).

2. One step `npm run check:examples` in the job `browser-checks` of `ci.yml`, on Ubuntu, macOS and
   Windows, with a failure upload of `build/X3/check/` (the screenshots).

Nothing else is needed for the Vitest half: `tests/vitest.workspace.ts` already picks up
`tests/conformance/examples/vitest.config.ts` (project `examples`), so `npm run test:conformance` on Ubuntu and
macOS runs `examples.test.ts` and `units.test.ts` (no browser, about ten seconds, `EASY68K_REQUIRE_ENGINES`
honoured).

## Why

6.5.4 asks for the same hash in Chromium and WebKit and a screenshot that shows exactly the pixels. The result
is proven on Windows only (Playwright's WebKit build there, 309 of 309 checks); the claim "the same on every
operating system" needs the check on the Ubuntu and macOS runners, where WebKit is a different build and a
platform's colour management could change a screenshot. If a screenshot differs there, the check prints the
number of differing pixels and the first index; that would be a finding about the page or the browser, not a
reason to loosen the comparison.

The check takes about one minute per browser on this PC. It needs engine/dist (the job already has it).
