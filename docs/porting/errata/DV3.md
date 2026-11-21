# Errata of DV3 (macOS packaging and release)

What DV3 found while packaging the desktop app from `docs/ARCHITECTURE.md` 6.7, 7.2, 7.4-7.6 and
section 11: where the document is silent, wrong or contradicts the code, what the repository does,
and why. No entry concerns `app/src/contracts/`, so there is no **Contract** section.

## Corrections to the document

### 1. `desktop:dist` takes `--arm64` or `--x64`, not `--arch arm64` (7.2)

- Says: "`desktop:dist` | signed `.dmg` and `.zip` for one architecture (`--arch arm64` or `x64`)".
- The script passes its arguments to `electron-builder --mac dmg zip --publish never`, whose
  architecture switches are `--arm64` and `--x64` (`--arch` is not one of its options).
- Does: `npm run desktop:dist -- --arm64` / `-- --x64` (release.yml, `desktop/electron-builder.yml`,
  `tests/desktop/packaged/README.md`).

### 2. The six release files have names now (7.4)

- 7.4 names the kinds ("the two `.dmg`, two `.zip`, `engine-dist.zip`, the web zip and
  `SHA256SUMS.txt`"), not the names. They are `EASy68K-<v>-arm64.dmg`, `EASy68K-<v>-x64.dmg`,
  `EASy68K-<v>-arm64-mac.zip`, `EASy68K-<v>-x64-mac.zip`, `engine-dist.zip` (the name
  `tools/fetch-engines.mjs` asks for) and `easy68k-cross-platform-web-<v>.zip` (`easy68k-mac-web-<v>.zip`
  until the repository was renamed; entry 20), in
  `desktop/scripts/release.mjs` `releaseFiles()`; a unit test keeps them equal to the
  `artifactName` patterns of `electron-builder.yml`. `SHA256SUMS.txt` is in the format of
  `shasum -a 256` (`shasum -a 256 -c SHA256SUMS.txt` checks a download).

### 3. Window title of check 2 is read from macOS, not from the page (6.7)

- The desktop platform's `setTitle` sets the native window title through the bridge and leaves
  `document.title` alone (`app/src/platform/desktop.ts`), so the page cannot tell its own title.
  The packaged app has no test hooks (DV2 errata 15). The checks read the window titles with System
  Events (accessibility), which needs the runner's Accessibility permission (granted on GitHub's
  macOS images; not verifiable from here).

## Decisions where the document is silent

### 4. Bundle identifier

- No identifier is given anywhere. The first version used `io.github.easy68k-mac.app`; it was
  replaced before any release by `org.easy68k-port.easy68k`, fixed for good (entry 19).

### 5. A fifth fuse: NODE_OPTIONS off (7.6)

- 7.6 lists `runAsNode` off, `enableNodeCliInspectArguments` off, `onlyLoadAppFromAsar` on, ASAR
  integrity on. DV3 also switches `EnableNodeOptionsEnvironmentVariable` off: with it on,
  `NODE_OPTIONS=--require /tmp/x.js open EASy68K.app` runs any script in the main process, which
  is what turning `runAsNode` off is meant to prevent. The app reads no Node option from the
  environment. A sixth fuse was added after review (entry 16). Every other fuse keeps Electron's
  default. `desktop/scripts/packaging.mjs` `SHIPPED_FUSES`; check 1 expects all six.

### 6. The web build lies next to the archive, not inside it (7.6, DV2 errata 14)

- `extraResources` copies `app/dist` to `Contents/Resources/app/dist`, the first place
  `desktop/src/main.ts` looks. It is therefore not covered by the ASAR integrity check, but it is
  sealed by the code signature (`codesign --verify --deep --strict` fails after any change to it).
  Inside the archive, DV2's `app://` handler would read it through Electron's archive emulation of
  `fs/promises` (`realpath`, `open` with positional reads for `Range` requests), which nobody has
  run; outside, it reads plain files as in its tests.

### 7. serialport's native module: fetched, then reduced to one architecture (7.6)

- 7.6: "built or fetched for each architecture". `@serialport/bindings-cpp` 13.0.0 ships one N-API
  binary for both Mac architectures (`prebuilds/darwin-x64+arm64`), and N-API binaries do not
  depend on the Electron version. Nothing is compiled: `npmRebuild: false`,
  `buildDependenciesFromSource: false`, so packaging runs no install script (the root
  `allowScripts` needs no change). `after-pack.mjs` reduces every `.node` file to the architecture
  being built with `lipo -thin` (written to a new file beside it, checked with `lipo -archs` and
  renamed over the original: lipo is not documented to accept its input as its output), so that "every `.node` file has the expected architecture" (check
  1) holds literally; a `.node` file without that architecture stops the build. The binaries of
  other systems (Linux, Windows, Android) and the C++ sources are left out of the app.
- DV4 (wave 3) will import serialport from `desktop/src`; until then nothing loads the module, and
  only check 1 looks at it.

### 8. Order of afterPack, fuses and signature (7.6)

- electron-builder runs, in this order, the afterPack hook, its own fuse step (`electronFuses`)
  and its own signing. 7.6 wants the ad-hoc signature "in an afterPack step after the fuses are
  set", so `after-pack.mjs` does all three itself (native modules, fuses, signature) and
  `electron-builder.yml` has no `electronFuses` and `mac.identity: null`. The signing order is
  `.node` and `.dylib` files, loose helper executables (`chrome_crashpad_handler`, `ShipIt`), the
  frameworks, the helper apps, the app (`packaging.mjs` `adHocSigningOrder`), each with
  `codesign --force --sign - --timestamp=none`; then `codesign --verify --deep --strict`.
- Optional Developer ID (section 11): when release.yml finds the secrets `MAC_CERTIFICATE_P12`,
  `MAC_CERTIFICATE_PASSWORD` and `MAC_SIGN_IDENTITY`, it passes `-c.mac.identity=...` with the
  hardened runtime and `desktop/build/entitlements.mac.plist`; `after-pack.mjs` then sets the fuses
  only and electron-builder signs and, with `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and
  `APPLE_TEAM_ID`, notarises. Check 1 then expects a Developer ID signature
  (`EASY68K_EXPECT_SIGNATURE=developer-id`). This path has never run (no certificate exists).

### 9. One version number: the tag must equal the root package.json (7.5)

- `desktop/package.json` says `0.0.0` and is frozen; electron-builder takes the app's version from
  it. release.yml passes `-c.extraMetadata.version=<root version>`, so the app
  (`CFBundleShortVersionString`), its file names and the window title (build-info) carry the same
  number. A tag push fails at once unless the tag is `v<root version>` (`release.mjs version`):
  bump the root `package.json` first, then tag. A manual run releases the root version as
  `v<version>`.

### 10. Check 3 command line (6.7)

- The harness runs exactly `open -n -a <app> <file> --args --remote-debugging-port=<p>
  --user-data-dir=<tmp>`, with a free port found beforehand, plus `--stdout <log> --stderr <log>`
  (macOS `open` options, so that the app's log is kept) and `--enable-logging` after `--args`. If
  this `open` refuses `--stdout`, the plain command is used.

### 11. Check 4: the question's cancel button is "Stay"; Quit is app.quit() through the bridge

- 6.7: "Quit with a modified document: the prompt appears; Cancel keeps the app running". The
  prompt is DV2's native sheet "Leave EASy68K?" with **Leave** and **Stay** (DV2 errata 12); Stay
  is its cancel button, so the check presses Stay.
- Quit is `app.quit()`, which is also what the application menu's Quit item (role `quit`) calls; the
  check reaches it through `window.easy68kDesktop.quit()` rather than by clicking the menu, because
  the menu bar is shared by every app on the runner. Cmd+Q itself and the native menu are on the
  manual list (6.8).
- The sheet is read and answered through System Events (needs the Accessibility permission). The
  document is modified by real typing, which also gives the page the user activation without
  which Chromium asks nothing before unloading.
- "Modified" is read from the editor's own status row (`.e68-editor__cell--modified`,
  `app/src/ui/editor/EditorStatusBar.tsx`). The first version read the shell's `footer.e68-statusbar`,
  which in Editor mode shows only the document's name; that failed check 4 on both runners in the
  first GitHub run (44938122931: `Received string: "untitled1.x68"`), while the screenshot of check
  2 showed both rows.

### 12. Check 5: how "finishes within 3.5 s" is measured (6.7, 4.5.5)

- From the moment F9 is sent to the moment the status bar says `Halted`, which the page itself
  notes with a MutationObserver (no timer and no frame involved, so neither a minimised window
  nor the check's own System Events calls delay the reading); the window is minimised through
  System Events (`AXMinimized`) as soon as the status bar says `Running`, and the check requires
  that macOS reported it minimised and that this happened before the program finished. The program measures the delay itself with task 8 and leaves the hundredths in
  D7; the check also requires 300 to 350 there. Best of up to three runs, each in a new app; every
  figure is printed. (CDP's `Browser.setWindowBounds`, which can minimise a Chrome window, belongs
  to Chrome's browser layer, which Electron does not include; not tried.)
- Known defect 4 of the gate (the status bar says Halted after Rewind and after opening a program)
  would make the first poll see `Halted` before F9 in a window that had run a program before. Every
  run starts a new app, which has run nothing, and the check requires `Running` before it waits for
  `Halted`.

### 13. The web zip uses the relative base (7.4)

- The web zip of a release is built with the default base `./` (`app/vite.config.ts`), so that it
  works from any folder of any web server; the Pages deployment uses the repository's sub-path
  (`pages.yml`, DV1).

### 14. Where the checks write

- `build/desktop-packaged/` (test results, report, logs of every app start, screenshots, the
  prebuilt programs), next to DV2's `build/desktop-dev/`; release.yml uploads it as
  `desktop-packaged-results-<arch>`.

### 15. electron-builder and the npm workspace

- Seen on this PC (Windows, an unpacked `--win dir` build made only to inspect the archive):
  electron-builder's npm collector finds no dependencies when it lists from `desktop/`
  (`depCount=0`), then searches from the repository root and finds serialport and its tree there.
  The archive then held `dist/*.js` (no source maps), `package.json` and serialport with its tree
  (`serialport`, thirteen `@serialport/*` packages, `debug`, `ms`, `node-gyp-build`); the whole
  `@serialport/bindings-cpp` package was unpacked next to it, with only the
  `prebuilds/darwin-x64+arm64` binary. The second search is slow on a loaded machine.
- For DV4: electron-builder flattened the tree. `@serialport/bindings-cpp` 13.0.0 has its own
  `node_modules` (`debug`, `@serialport/parser-readline` 12.0.0), which is not in the archive; in
  the app it resolves `debug` and `@serialport/parser-readline` to the top-level copies (the latter
  13.0.0). Nothing loads serialport yet; DV4's checks on the packaged app are the first to load it.

### 16. A sixth fuse: file:// privileges off (7.6; added after review)

- `GrantFileProtocolExtraPrivileges` is on in a stock Electron (seen with `npx @electron/fuses
  read` on Electron 45.4.1). It gives pages loaded from `file://` privileges beyond those of an
  ordinary web page. The app loads only `app://` (`desktop/src/protocol.ts`; no `loadFile` and no
  `file://` URL in `desktop/src`), so DV3 switches it off. 7.6 does not name it; this is hardening
  in the spirit of entry 5. Checked on this PC: `flipFuses` with `SHIPPED_FUSES` on a copy of
  `electron.exe`, then `@electron/fuses read`, showed all six as intended. Check 1 expects it off.
  The unit project fails if `desktop/src` ever loads a `file://` page (then this fuse must be
  reconsidered with DV2's owner).

### 17. Minimum macOS: Electron's own, not a fixed 12.0 (1.1; corrected after review)

- The first version set `mac.minimumSystemVersion: '12.0'` and printed "macOS 12 or later" in
  every release note. That number was not checked against Electron 45 (Chromium 156), which may
  well need a newer macOS; an `LSMinimumSystemVersion` below Electron's own would let macOS start
  an app that then fails. `electron-builder.yml` now sets none, so the app keeps the
  `LSMinimumSystemVersion` of Electron's own `Info.plist` (app-builder-lib 26 `macPackager.js`
  writes the key only when `minimumSystemVersion` is set).
- release.yml reads the value from the built bundle (`plutil -extract LSMinimumSystemVersion`),
  passes it from the mac job to the publish job (`minimum_macos`) and `release.mjs notes` prints it
  ("macOS <n> or later"). Check 1 asserts that it is a version, that it is not below the `minos`
  of the main binary and of Electron Framework (`otool -l`), and, when electron-builder's Electron
  download is in `~/Library/Caches/electron`, that it equals the `Info.plist` of that unmodified
  `Electron.app`.
- 1.1 says the app runs "on macOS"; it names no version, so nothing in the document changes. The
  README's system requirement should be taken from the first release notes, not written by hand.
- Measured in the first GitHub run (44938122931), on both architectures: `LSMinimumSystemVersion`
  13.0, equal to the stock Electron 45.4.1 `Info.plist`; `minos` 13.0 of the main binary and of
  Electron Framework. The app needs **macOS 13 (Ventura) or later**.

### 18. desktop/scripts import console and process (no change to eslint.config.js)

- `eslint.config.js` gives Node's globals to `desktop/**/*.{ts,mts}` only, not to the `.mjs`
  scripts of `desktop/scripts`. The first version widened that pattern in the root configuration,
  which is frozen; the change is reverted. The scripts now import `console` and `process` from
  `node:console` and `node:process`, which lints clean under the configuration as it is.
  `docs/requests/DV3-eslint-node-globals.md` asks the gate to widen the pattern so that the
  imports can go; nothing depends on it. The first version had also left an untracked self-test for
  the widened pattern in `tests/lint/node-globals.test.ts` (a gate path), which failed
  `npm run lint` once the pattern was reverted; it is removed, and its text is in the request.

### 19. The bundle identifier, fixed for good: `org.easy68k-port.easy68k` (decided before the first release)

- The first version used `io.github.easy68k-mac.app`. The repository was renamed from
  `easy68k-mac` to `easy68k-cross-platform` before any release, which showed that a name taken from
  the repository can go stale. The identifier is now `org.easy68k-port.easy68k`, in
  `desktop/electron-builder.yml` (`appId`) and `desktop/scripts/packaging.mjs` (`BUNDLE_ID`); a unit
  test keeps the two equal, and check 1 compares the signed bundle's `CFBundleIdentifier` and code
  signing identifier with `BUNDLE_ID`.
- Why it can never change after the first release: macOS keys by it the app's preferences file
  (`~/Library/Preferences/<id>.plist`, where Chromium and AppKit keep, for example, the last folder
  of the open and save panels), its saved window state (`~/Library/Saved Application State/<id>.savedState`),
  its caches below `~/Library/Caches` and `~/Library/HTTPStorages`, the person's "Open With > Change
  All" choice for `.X68`, `.L68` and `.S68` in Launch Services, and any privacy permission the
  person grants. A new identifier would make macOS treat the next version as a different app and
  leave all of that behind. (Electron's own user-data folder, which holds the app's settings and
  the files of its disk backend, follows `productName`: `~/Library/Application Support/EASy68K`,
  `app.getPath('userData')`. It does not depend on the identifier, and `productName` must not
  change either.)
- Why this one: it names the product and says that this is a port; it contains neither the
  repository's name (renamed once already, and the same app is now one of several deliveries) nor
  a person or an account; and it does not use the domain of the original EASy68K (`easy68k.com`),
  which would suggest that the original's author publishes it. Reverse-DNS form with a domain the
  project would have to keep is not needed: an identifier only has to be unique, and for a
  Developer ID signature later (section 11) Apple registers any identifier nobody else has taken.
- Electron derives the helper apps' identifiers from it (`org.easy68k-port.easy68k.helper`,
  `.helper.Renderer`, ...).

### 20. release.yml yields SHA256SUMS.txt on every run; the downloads are checked; the web zip's name

- 9.4's acceptance asks that "the release job produces the six artifacts and the checksum file". The
  first version wrote `SHA256SUMS.txt` only in the `publish` job, which a build-and-test run (manual,
  `draft_release` unticked) skips, so such a run had no checksum file. A `checksums` job now runs on
  every run: it checks that the six files are there (`release.mjs checksums`), verifies the sums
  with `sha256sum -c`, writes the notes, prints each file's size and the sums into the run summary,
  and uploads `SHA256SUMS.txt` (artifact `release-checksums`) and `notes.md` (artifact
  `draft-notes`). `publish` needs it, downloads the same files, only checks them
  (`release.mjs verify`: exactly the six files, and a `SHA256SUMS.txt` that lists exactly them with
  their hashes) and creates the draft. It writes no new sums, so the draft carries what the
  `checksums` job showed.
- `desktop/scripts/check-downloads.mjs` runs in each mac job before the packaged checks: the app
  inside the `.zip` (unpacked with `ditto`, as Archive Utility does) and inside the `.dmg` (mounted
  read-only) must pass `codesign --verify --deep --strict` and have the CDHash of the bundle the
  checks start, so the downloads are the tested bundle; the `.dmg` must hold the link to
  `/Applications` the install steps mention. It prints Gatekeeper's assessment of a quarantined copy
  (`spctl --assess`, `syspolicy_check distribution`) as evidence for the first-start text; that is
  information, not a pass or fail.
- The web zip is `easy68k-cross-platform-web-<version>.zip` (the project's name after the rename on
  2026-11-21); the four app files keep the product name `EASy68K`.
### 21. First runs on GitHub's Mac runners (release.yml, manual, `draft_release` unticked)

- Run 44938122931 (commit fdabb2b, the package as reviewed): `version`, `engines`, `web` passed; on
  `macos-15` (arm64) and `macos-15-intel` (x64) `npm run desktop:dist` built, thinned serialport's
  `.node` (`x86_64 arm64 -> arm64` / `-> x86_64`), set the six fuses and signed ad hoc (15 items,
  `codesign --verify --deep --strict` passed). Packaged suite: 46 of 47 passed on each; check 4
  failed only because it read the wrong status bar (entry 11). Checks 1, 2, 3 and 5 passed against
  the fused, ad-hoc signed bundle the first time.
- Run 44938987022 (commit b83af54): every job passed except `publish`, skipped as intended. 51 of
  51 packaged-suite tests on each architecture (35 unit, 1 prebuilt, 15 checks 1-5). Check 4 saw the
  sheet "Leave EASy68K?" / "Changes you made may not be saved." with Stay and Leave. Check 5: 3149 ms
  (arm64) and 3379 ms (x64) from F9 to Halted, window minimised 333 ms and 743 ms after F9, the
  program's own clock 301 and 302 hundredths, each in the first attempt. The page's
  `document.visibilityState` stays `visible` while minimised (`backgroundThrottling: false`). Sizes:
  `EASy68K-<v>-arm64.dmg` 123,208,226 bytes, `-arm64-mac.zip` 119,759,537, `-x64.dmg` 129,079,052,
  `-x64-mac.zip` 125,636,363, the web zip 5,054,860, `engine-dist.zip` 110,508.
- Run 44939698734 (commit 2c99d22, after the gate's restart, read job by job): every job passed
  except `publish`, skipped as intended; 51 of 51 on each architecture, none skipped (35 unit,
  1 prebuilt, 15 packaged: check 1 is the seven tests of `bundle.spec.ts`, check 2 the five of
  `launch.spec.ts`, check 3 `association.spec.ts`, check 4 `quit.spec.ts`, check 5
  `minimise.spec.ts`). Check 5: 3200 ms (arm64) and 3462 ms (x64) from F9 to Halted, minimised
  536 ms and 1431 ms after F9, the program's clock 301 and 300 hundredths, first attempt each. The
  Intel runner's margin under the 3.5 s limit is small (38 ms this run, 121 ms the run before);
  the program itself takes 3.00 s, so the rest is the app's start of the run and the reading of
  the status bar on a slow runner. If it ever fails there, read the printed figures before
  touching the limit: 4.5.5 fixes it. Download sizes (bytes): `EASy68K-0.0.0-arm64.dmg`
  123,211,188, `-arm64-mac.zip` 119,759,555, `-x64.dmg` 129,078,649, `-x64-mac.zip` 125,636,345,
  `easy68k-cross-platform-web-0.0.0.zip` 5,054,839, `engine-dist.zip` 110,508, `SHA256SUMS.txt`
  549; `sha256sum -c` OK for all six in the `checksums` job. The downloads' CDHash equals the
  tested bundle's (arm64 `8090a158...`, x64 `f2a8e735...`).
- `syspolicy_check distribution` also printed "Internal Xprotect Error: One or more files in your
  application triggered an Xprotect error" on both runners. It reads as a failure of the scan on
  the runner, not a detection (no malware name is given, and the same app passes Gatekeeper's
  signature checks except notarisation); it could not be examined further there. The manual test
  (6.8) should note whether a real Mac shows any XProtect message.