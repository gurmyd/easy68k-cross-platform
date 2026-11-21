# Request from SH4: run the Output panel's browser check in CI (gate I1)

Status: applied in gate I1 round 1 (items 1 and 2; item 3 is for X2). Root script `check:output` and the step "Output panel check (SH4)" of `browser-checks`, group `simulator`; it runs also without engine-dist, since the script skips (or, with EASY68K_REQUIRE_ENGINES=1, fails) by itself.

SH4's acceptance (ARCHITECTURE.md 9.2) asks for tests "with the real engine and the real panel in
Chromium and WebKit": each rule of 2.9.4, dead keys and composition, key repeat, paste, the canvas
backing size at device pixel ratios 1 and 2, and deferred, refused and externally ended full
screen. Unit tests run under Node without a DOM, and `tests/e2e/sim` belongs to X2, so, following
the convention of `app/src/ui/shell/check-shell.mjs`, SH4 wrote a script in its own folder:

```
node app/src/features/output/check-output.mjs [--browser chromium|webkit|all] [--out <dir>]
```

It starts the Vite dev server of `app/` on a free port (hot reload off and a dependency cache of
its own, so that files other packages save meanwhile cannot reload the page), opens
`app/src/features/output/testing/harness.html` and drives the real shell with the real Output
panel and the real simulator engine in headless Chromium and WebKit. The surface, the text screen
and the run controller in that page are the doubles of `app/src/features/output/testing/`, so the
script does not depend on SH1, SH3 or SH8; 68000 programs record what they observe, and the script
reads their memory. It checks, with the Windows and with the macOS key map where they differ:

1. the panel: header strip, backing store = surface size at device pixel ratios 1 and 2,
   whole-number zoom with sharp pixel blocks on screen, task 33 resizing, the prompt overlay, the
   text mirror, collapse and `View > Output Window`, an axe-core scan (WCAG 2.0/2.1 A and AA);
2. keys (2.9.4), with real held keys: F9; F2, F4, Shift+F2; F5; Tab; Ctrl+O / Cmd+O; Alt+Enter with
   a key-down interrupt and real full screen; after task 24 the eleven shortcuts, Find, and the
   release chord;
3. text: a held letter repeats, Backspace / Ctrl+H / Ctrl+I, dead-key sequences in the Windows and
   in the macOS form, composed text, and in Chromium a composition through the browser's own
   input-method interface;
4. paste: `HELLO` into a task 5 loop gives `HO`, two lines into task 2, LF line ends, 300
   characters give 254, an empty clipboard, Ctrl+V is `$16`;
5. focus: nothing posted on focus loss, `ioActivated` on focus, key-ups restored when Meta is
   released;
6. mouse: surface coordinates at 200 % zoom, the shift bits, the left button's capture outside the
   surface, double-click, right click without a context menu;
7. full screen: by the button with the real Fullscreen API, a message box above the full-screen
   surface, ended by the browser, deferred (four pages whose user gesture is left to run out, 8
   s), dropped, refused with the original's box, and the desktop app's window-level full screen.

Screenshots go to `build/output-check/` (git-ignored). It prints `N of M checks passed` and exits
non-zero on a failure, on a console or page error, and on a pass that breaks off. It needs
`engine/dist` (without it: skipped, or a failure when `EASY68K_REQUIRE_ENGINES=1`) and only the
pinned development dependencies (`vite`, `@playwright/test`, `@axe-core/playwright`). On the SH4
machine (Windows 11): 427 of 427 checks pass in both browsers; a run takes a little over two
minutes on a quiet machine and up to nine while fourteen other packages are being built on it.

Not covered on that machine, because it is a Windows host: the real Cmd+V of the macOS key map
makes no browser fire `paste` there (the script reports what the browser did and checks only that
the key-down is not cancelled); on the macOS runner it should.

Requested:

1. A root script `check:output` = `node app/src/features/output/check-output.mjs`.
2. A step `npm run check:output` in the CI job `browser-checks` (Ubuntu, macOS, Windows), where
   the Playwright browsers and `engine/dist` are present.
3. X2 (optional): when `tests/e2e/sim` exists with the real session, it may take these checks over
   against the production build; the doubles of `features/output/testing/` are then not needed.

Nothing else is requested: no dependency, no configuration change.

## Since gate I1, round 1 (nothing new is requested)

The script has one more group, `app`: after the harness groups it opens the application itself
(`index.html` on the same dev server) and repeats the acceptance list with the real session - the
real drawing surface, text screen, fonts and run controller - one page per browser, every program
after the first loaded by a cold start. It needs nothing more than before for that: `engine/dist`,
as `check:run` and `check:sim-main` do (the dev server writes `app/src/build-info.ts` itself when
it starts). Other changes of the round: the deferred full-screen checks no longer sleep a fixed time (the page
reports on its console when a request arrived), a pass at device pixel ratio 1.5, Ctrl+@, the
refusal box without an icon, the chords with further modifiers, the desktop app's full screen
ended by the system. On the SH4 machine (Windows 11, busy with the other packages of the gate):
525 of 525 checks pass in both browsers; two whole runs took 176 s and 274 s. The root script and
the CI step stay as they are.
