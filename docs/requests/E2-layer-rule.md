# Request from E2: let `features/editor/` import `ui/editor/`; add `check-editor.mjs` to CI (gates)

Background: `docs/porting/errata/E2.md`, entry 1.

## 1. `eslint.config.js`, the layer rule (gate)

Section 8 and 9.2 put the editor component in `app/src/ui/editor/` and the feature that registers it
(panel `editor`, the Edit-menu and Window-menu commands) in `app/src/features/editor/`. The rule
`easy68k/layer-imports` lets `features/<x>/` import `ui/components/` but not `ui/editor/`, and nothing
else may import `ui/editor/` into the application.

Requested: in `layerOf()`, for `features/editor`, add `'ui/editor'` to `allowed` (the same pattern as
`FS_FEATURES` for `fs/`), with a fixture in `tests/lint/import-rules.test.ts` that
`app/src/features/editor/index.ts` may import `../../ui/editor/index` and another feature may not.

Until then `app/src/features/editor/ui-link.ts` reaches the component through
`import.meta.glob('../../ui/editor/index.ts', { eager: true })`, typed by
`features/editor/editor-api.ts`. After the change E2 replaces the file body with
`export { editorUi } from '../../ui/editor';`.

## 2. CI: the browser check of the editor (gate)

`app/src/ui/editor/check-editor.mjs` follows the convention of `check-shell.mjs`
(`--browser chromium|webkit|all`, `--out <dir below build/>`, prints `N of M checks passed`, exits
non-zero on a failure or a console error). Requested: a root script `check:editor`
(`node app/src/ui/editor/check-editor.mjs`) and a step in the job `browser-checks` on Ubuntu, macOS
and Windows.
