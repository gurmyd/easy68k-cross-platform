# Packaged-app checks (ARCHITECTURE.md 6.7)

`npm run desktop:test -- packaged` checks the built `EASy68K.app`: the bundle that goes into the
`.dmg` and the `.zip`, with its fuses set and its ad-hoc signature, never a relaxed copy. In CI they
run in `.github/workflows/release.yml`, job `mac-arm64` on `macos-15` and job `mac-x64` on
`macos-15-intel`, right after `npm run desktop:dist`.

On a Mac, from the repository root (engine/dist must exist):

```
npm run desktop:dist -- --arm64        # or --x64 on an Intel Mac
npm run desktop:test -- packaged
```

The checks start the app normally, so its windows appear on the screen and take the focus while
they run; the process that runs them needs the Accessibility permission for System Events
(System Settings > Privacy & Security > Accessibility), which GitHub's macOS images grant.

## Why not Playwright's Electron launcher

It needs Node's inspector, which the fuse `EnableNodeCliInspectArguments` switches off. The harness
(`harness.ts`) starts the app's own binary with `--remote-debugging-port=0
--user-data-dir=<temporary folder>`, reads the port from the `DevToolsActivePort` file Chromium
writes there (or from its "DevTools listening on" log line) and attaches with
`chromium.connectOverCDP`. What the page cannot show - the native window title, the question before
quitting, minimising - is read and done through System Events (JavaScript for Automation). Every
process is ended by its process id.

## Projects and files

| Project / file                  | What it checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Check of 6.7 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `unit`: `unit.spec.ts`          | The logic of `desktop/scripts` (fuses, architectures, signing order), of `release.yml` (triggers, draft only, pinned actions, file names, checksums, notes) and of this harness. Runs on every system, without an app.                                                                                                                                                                                                                                                                                                                                                | -            |
| `prebuilt`: `prebuilt.setup.ts` | Assembles `tutorial1.X68` (the official example the app ships) and `delay300` (`prebuilt.ts`) with the real assembler engine into `build/desktop-packaged/prebuilt/`. Nothing prebuilt is committed.                                                                                                                                                                                                                                                                                                                                                                  | -            |
| `bundle.spec.ts`                | `codesign --verify --deep --strict` passes; the signature is ad hoc, without the hardened runtime, and every nested item has its own valid signature; the bundle holds both engines (six files), every file of `app/public/help`, `fonts` and `examples` byte for byte, `app.asar` with its integrity hash in `Info.plist`, the three file types and the port's version; the main binary and every `.node` file (unpacked from the archive) have exactly the architecture of the build; `npx @electron/fuses read` shows the fuses.                                   | 1            |
| `launch.spec.ts`                | Started with `EASY68K_APP_DIST`, `EASY68K_DEV_SERVER_URL` and `EASY68K_DESKTOP_TEST_WINDOWS` set, the app ignores them (it shows `app://easy68k/index.html` in a visible window); no Content Security Policy violation in Chromium's log of the first load nor in a watched second load, and the policy refuses an inline script; both engines assemble and load a program; the native window title is `EASy68K Editor/Assembler v5.16.01 - unofficial port <version>`; `window.easy68kDesktop` has exactly `DESKTOP_BRIDGE_KEYS`; no `require`, `process`, `module`. | 2            |
| `association.spec.ts`           | `open -n -a EASy68K.app tutorial1.S68 --args --remote-debugging-port=<p> --user-data-dir=<tmp>`: Simulator mode, PC at the start address, the listing shown, not running (the PC stays), the window title ends with `tutorial1.S68 - unofficial port <version>`.                                                                                                                                                                                                                                                                                                      | 3            |
| `quit.spec.ts`                  | Typing makes the new document Modified; quitting (`app.quit()`, as the Quit menu item) shows the sheet "Leave EASy68K?" with Leave and Stay; Stay (the cancel button) keeps the process, the window and the page, still Modified.                                                                                                                                                                                                                                                                                                                                     | 4            |
| `minimise.spec.ts`              | `delay300.S68` from the command line; F9; once Running, the window is minimised; Halted within 3.5 s of F9 (best of up to three fresh starts, every figure printed), and the program's own task 8 clock says 300 to 350 hundredths.                                                                                                                                                                                                                                                                                                                                   | 5            |
| `programs/**`                   | Checks 6-8 (owner DV5), in the project `packaged` of this configuration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 6-8          |

`harness.ts` (starting, attaching, System Events), `facts.ts` (pure parsers, tested by
`unit.spec.ts`) and `prebuilt.ts` are shared with DV5.

## Environment

| Variable                   | Meaning                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EASY68K_PACKAGED_APP`     | The `.app` to check (relative paths from the repository). Default: `desktop/release/mac-arm64/EASy68K.app` on Apple silicon, `desktop/release/mac/EASy68K.app` on Intel. |
| `EASY68K_EXPECTED_ARCH`    | `arm64` or `x64` (default: from the folder name, else Node's architecture). Set it to `x64` to check an Intel build under Rosetta 2.                                     |
| `EASY68K_EXPECT_SIGNATURE` | `adhoc` (default) or `developer-id` (release.yml with the optional signing secrets, section 11).                                                                         |
| `EASY68K_REQUIRE_ENGINES`  | `1` in CI: a missing `engine/dist` fails `prebuilt` (it fails without the engines anyway).                                                                               |

Results, logs of every app start, screenshots (the page; the whole screen for the quit question)
and the prebuilt programs go to `build/desktop-packaged/`, which release.yml uploads as
`desktop-packaged-results-<arch>`.

## Running the unit project anywhere

```
npx playwright test --config tests/desktop/packaged/playwright.config.ts --project unit --project prebuilt
```

The `packaged` project skips its checks on Windows and Linux with the reason.
