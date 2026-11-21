# DV3: run the packaging unit tests on every push

Status: open (for the next gate).

## What

The packaged-app suite (`tests/desktop/packaged`, ARCHITECTURE.md 6.7) runs in `release.yml`
only, on a tag or by hand, because it needs a built and signed `.app`. Its project `unit` needs no
app and no engines: it tests `desktop/scripts` (fuses, architectures, the ad-hoc signing order,
release file names, checksums, release notes), the facts `release.yml` must keep (tag or manual
trigger only, draft only, pinned actions) and the parsers of the harness. Without it in `ci.yml`, a
change that breaks packaging is found only at the next release.

## The change to `.github/workflows/ci.yml`

In the job `check` (ubuntu), after the format check, one step:

```yaml
      - name: Packaging unit tests (DV3)
        if: hashFiles('tests/desktop/packaged/playwright.config.ts') != ''
        run: npx playwright test --config tests/desktop/packaged/playwright.config.ts --project unit
```

It starts no browser and no Electron (connectOverCDP is never called in this project) and takes
about five seconds. It needs only `npm ci`.

Optionally, in a job that has `engine-dist` (for example `desktop-dev`), `--project prebuilt` as
well: it assembles the two programs of checks 3 and 5 with the real assembler.

## No other shared configuration

- `allowScripts` (root `package.json`): no change. Packaging compiles nothing and runs no install
  script (`npmRebuild: false`); serialport's macOS binary comes from its package.
- No new dependency: `electron-builder`, `@electron/fuses` and `@playwright/test` are installed;
  the checks use the system's `codesign`, `lipo`, `plutil`, `osascript`, `open` and `screencapture`.
- `desktop/package.json` keeps `0.0.0`; release.yml gives electron-builder the root version.
