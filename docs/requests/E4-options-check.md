# E4: run the Options browser check in CI

E4's acceptance list names the dialogs themselves ("every control and text of both dialogs",
"Cancel restores everything"), which unit tests under Node reach only through their models. Following
the convention of wave zero, the browser part is a script in E4's folder:

    node app/src/features/options/check-options.mjs [--browser chromium|webkit|all] [--out <dir>]

It starts the Vite dev server of `app/` on a free port (its own Vite cache below `build/E4/`, no
file watching, no hot reload), drives headless Chromium and WebKit with the real shell, document
service, editor, file dialogs (FS1) and help (H1), prints `N of M checks passed`, exits non-zero on
any failure or console error, and writes screenshots and `results.json` only below
`build/E4/options-check` (or `--out`). It needs only the pinned development dependencies
(`@playwright/test`, `@axe-core/playwright`, `vite`); it needs neither `engine/dist` nor a
production build. It assumes no system: the only keys it presses are Escape, Tab and F1, and it
waits for conditions, never for fixed times. On this PC under the load of the other engineers:
114 of 114 checks in 551 seconds for both browsers (the passes open three contexts with two
windows each; most of the time is the development server compiling modules for each new page).

Requested:

1. Root `package.json`: `"check:options": "node app/src/features/options/check-options.mjs"`.
2. `ci.yml`, job `browser-checks` (Ubuntu, macOS, Windows), group **interface**: a step
   `npm run check:options`; screenshots `build/E4/options-check/` uploaded on failure.

The check prints one note instead of a check: F1 in the modeless Assembler Options dialog, which
depends on `docs/requests/E4-dialog-help-key.md` (shell). When that is applied the note can become
a check.
