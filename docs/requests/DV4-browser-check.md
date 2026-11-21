# DV4: the browser check of desktop-devices (for the gate)

Status: open. The script exists and passes; only its root script and its CI step are missing.

`app/src/features/desktop-devices/check-desktop-devices.mjs` proves in headless Chromium and
WebKit that the web build still gives a 68000 program the values of note 37 (1.4) for every
serial and network task (9.6 DV4, last acceptance item). It follows the convention of
`app/src/ui/shell/check-shell.mjs` (free port, `--browser`, `--out`, "N of M checks passed",
exit code). Asked for:

1. Root `package.json`, beside the other checks:
   `"check:desktop-devices": "node app/src/features/desktop-devices/check-desktop-devices.mjs"`
2. `.github/workflows/ci.yml`: the same script in the job `browser-checks` (Ubuntu, macOS,
   Windows), like the thirty that are there.

No new dependency. It needs engine/dist (both engines) and honours `EASY68K_REQUIRE_ENGINES=1`.
