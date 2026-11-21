Status: applied at the wave-0 gate, with two differences. (1) The suite runs in CI in the job `browser-checks` (ubuntu, macOS and Windows), not in the `e2e` job, as `npm run check:engine-browsers` (tools/check-engine-browsers.mjs: both browsers, `EASY68K_REQUIRE_BROWSERS=1`); `build/reports/engine-binding-browsers.json` is uploaded as the artifact `engine-binding-browsers-<os>`. (2) `browser.test.ts` now runs only when `EASY68K_BROWSERS` is set; unset (a plain `npm test`) it is skipped with the reason shown, so that parallel test runs start no browsers. Item 2: `eslint.config.js` allows `@playwright/test` and `vite` for `app/src/engine/browser.test.ts` only, and the file uses plain imports and the packages' types. Item 3: `@playwright/test` 1.65.1 is in `app`'s devDependencies (the lockfile changed only by that workspace entry and the root's `hasInstallScript`).

# Request from W4: shared configuration for the engine binding's browser tests (gates)

W4's acceptance (ARCHITECTURE.md 9.1) requires tests in Chromium and WebKit: the engine's fixtures,
200 release / create cycles and 500 assemblies. The only test files W4 owns are
`app/src/engine/*.test.ts` (section 8), so the suite is a Vitest file,
`app/src/engine/browser.test.ts`: it builds the binding with Vite's JavaScript API (the
application's own `vite.config.ts`), serves the build with the policy of 7.6, and drives headless
Chromium and WebKit through Playwright. It uses only packages that are already in the lockfile.
Background: `docs/porting/errata/W4.md`, entry 2.

It works today without any of the changes below. They make it run in CI and remove a workaround.

## 1. `ci.yml`: run the suite where the browsers are (needed for CI coverage)

The `unit` job installs no browser, so the suite is skipped there. The `e2e` job has the browser of
its matrix entry, `engine/dist` and three operating systems. Please add one step to the `e2e` job,
before or after "End-to-end tests":

```yaml
      - name: Engine binding in the browser (W4)
        run: npm test -- src/engine/browser.test.ts
        env:
          EASY68K_BROWSERS: ${{ matrix.browser }}
          EASY68K_REQUIRE_BROWSERS: '1'
```

- `EASY68K_BROWSERS` runs only the browser of the matrix entry; `EASY68K_REQUIRE_BROWSERS=1` turns
  "browser not installed" from a skip into a failure.
- The step needs no production build of the application (it builds its own page into a temporary
  folder) and takes about 8 seconds for Chromium and 18 for WebKit on the Windows machine it was
  written on. Both commands were run there as written, with the two variables set.
- The `e2e` job runs only when `tests/e2e/**/*.spec.ts` or `tests/a11y/**/*.spec.ts` exist (the
  `plan` guard). Until X1 delivers the first spec, the suite runs on developers' machines only. If
  it should run in CI before that, the guard `e2e` could also become true when
  `app/src/engine/browser.test.ts` exists.

The suite writes its memory figures to `build/reports/engine-binding-browsers.json`; uploading that
file as an artifact of the job would keep the record the acceptance asks for ("with the memory use
recorded at the start and the end").

## 2. `eslint.config.js`: let this one test import Playwright and Vite (removes a workaround)

`easy68k/layer-imports` allows a unit test the runtime packages, `vitest`, `fake-indexeddb` and
`node:*`. `browser.test.ts` therefore loads its two tools with `import(name)` from a variable and
declares the few types it uses itself. With

```js
const isTestPackage = (name) =>
  name === 'vitest' || name === 'fake-indexeddb' || name.startsWith('node:') ||
  name === '@playwright/test' || name === 'vite';
```

(or the same two names allowed only for `app/src/engine/browser.test.ts`) the file can use plain
imports and the packages' own types. W2's gallery check (`docs/requests/W2-gallery-check.md`) uses
the same two packages from a script.

## 3. `app/package.json`: declare `@playwright/test` (tidiness)

The test resolves `@playwright/test` through the root `node_modules`, where the `tests` workspace
puts it. Listing it in the `devDependencies` of `app` as well (same version, no lockfile change
beyond the workspace entry) would say so.

## 4. Nothing else

No new dependency, no change to `vite.config.ts`, `vitest.config.ts`, `tsconfig` or the lockfile is
needed by W4. One note for whoever changes `app/vite.config.ts`: `browser.test.ts` builds with that
file, so a plugin that requires an HTML entry (as `easy68k-csp` does: it reads `index.html` back)
must keep working when the build's input is a script and `index.html` is emitted by another plugin.
