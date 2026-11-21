# Request from E3: run the highlighter's browser check in CI (gate I1)

Status: applied in gate I1 round 1 (both items): root script `check:highlight` and the step "Syntax highlighting check (E3)" of `browser-checks`, group `interface`. Run here: 54 of 54 checks passed.

E3's acceptance (ARCHITECTURE.md 9.2) includes "every preset; list documents not highlighted; a
10,000-line document highlights its viewport in under 5 ms". The colours a browser really draws and
the time of a viewport pass in a browser cannot be checked by the unit tests under Node, so, by the
wave-zero convention, the browser half is a script in E3's own folder:

```
node app/src/features/highlight/check-highlight.mjs [--browser chromium|webkit|all] [--out <dir>]
```

It starts the Vite dev server of `app/` on a free port chosen by the operating system (with
`hmr: false` and `watch: null`, so edits elsewhere in the tree cannot reload the page), opens the
application in headless Chromium and WebKit, and checks: the eight elements in every preset and
both themes, list documents (no marks; stored background and black text under a stored preset),
settings changes reaching open views, typing, the 5 ms viewport figure, and the highlighter inside
the real editor component (E2's `DocumentEditor`) including a document that changes kind. It fails
on any console or page error, writes screenshots to `build/E3/highlight-check/` (git-ignored) and
prints `N of M checks passed`. It uses only the pinned development dependencies (`vite`,
`@playwright/test`); it does not need `engine/dist`, fonts, or anything specific to Windows.

Requests:

1. **Root `package.json`**: a script `"check:highlight": "node app/src/features/highlight/check-highlight.mjs"`.
2. **`ci.yml`**: run `npm run check:highlight` in the job `browser-checks` (Ubuntu, macOS, Windows;
   Chromium and WebKit).

Nothing else is asked for: no dependency, no configuration change.
