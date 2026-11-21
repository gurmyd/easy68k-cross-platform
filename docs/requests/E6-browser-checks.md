# Request from E6: run the Find/Replace and Print browser checks in CI (gate I2)

Status: applied at gate I2 round 1 (config): root scripts `check:find` and `check:print`, the steps "Find and Replace check (E6)" and "Print check (E6)" of `browser-checks`, group `interface`; `build/E6/find-check/` and `build/E6/print-check/` are uploaded on failure. Run here: 68 of 68 and 52 of 52.

E6's acceptance (ARCHITECTURE.md 9.4) is "the items of editor-ui §20.6 with note 7; print document:
tabs expanded with the document's rule, page break at the marker line, monochrome, selection or
all". The unit tests (`features/find/*.test.ts`, `features/print/print.test.ts`,
`core/print/print.test.ts`) check every rule under Node with E1's real document service. What only a
browser shows - real keys through the dispatcher into the modeless dialogs, the editor taking the
focus after a match, the message box, and the print document as a browser lays it out - is in two
scripts in E6's own folders, by the wave-zero convention:

```
node app/src/features/find/check-find.mjs   [--browser chromium|webkit|all] [--out <dir>] [--keys mac|windows]
node app/src/features/print/check-print.mjs [--browser chromium|webkit|all] [--out <dir>] [--keys mac|windows]
```

Each starts the Vite development server of `app/` on a free port (`hmr: false`, `watch: null`),
drives headless Chromium and WebKit, reads every chord it presses from the application's chord
table (`chordsOn()`, the key map of the system it runs on: Cmd on a Mac), fails on any console or
page error, writes screenshots below `build/E6/` and prints `N of M checks passed`. `check-print`
opens no print dialog: it replaces `Platform.print` in the page with a recorder and then loads the
recorded page on its own, in print media (in Chromium it also counts the pages of its PDF). Its
last step lets the web platform's real print path run (the hidden frame of `platform/web.ts`) and
replaces only `print()` inside that frame, so no dialog opens there either.

Neither needs `engine/dist`, a production build, fonts, or anything specific to Windows. Both belong
to the group **interface**. They wait for effects (at most 15 s per step), with no fixed pauses.

Run here (Windows 11), gate I2: `check-find` 70 of 70 (35 per browser), `check-print` 52 of 52 (26
per browser); with `--keys mac` (the macOS key map) 86 of 86 and 56 of 56.

Requests:

1. **Root `package.json`**: scripts
   `"check:find": "node app/src/features/find/check-find.mjs"` and
   `"check:print": "node app/src/features/print/check-print.mjs"`.
2. **`ci.yml`**: run `npm run check:find` and `npm run check:print` in the job `browser-checks`
   (Ubuntu, macOS, Windows; Chromium and WebKit), group `interface`, and add `build/E6/find-check/`
   and `build/E6/print-check/` to the uploaded screenshots of that job.

Nothing else is asked for: no dependency, no configuration change.
