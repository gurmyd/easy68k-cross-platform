# U3: browser check of the Break Points panel

Status: applied at gate I2 round 1 (config), as asked: root script `check:breakpoints` and the step "Break Points check (U3)" of `browser-checks`, group `simulator`, on Ubuntu, macOS and Windows; `build/U3/breakpoints-check/` is uploaded on failure. Run here: 72 of 72 in 283 s.

Please add the root script

    "check:breakpoints": "node app/src/features/breakpoints/check-breakpoints.mjs"

and run it in the job `browser-checks` (group **simulator**) on Ubuntu, macOS and Windows.

- Needs `engine/dist` for part 2 (real engine); without it part 2 is skipped, or fails with
  `EASY68K_REQUIRE_ENGINES=1`.
- Needs no production build (it starts the Vite development server on a free port).
- Options: `--browser chromium|webkit|all`, `--out <dir>` (default `build/U3/breakpoints-check`),
  `--without-engines`.
- It uses clicks, Enter and Escape only, so it does not depend on the operating system's chords.
