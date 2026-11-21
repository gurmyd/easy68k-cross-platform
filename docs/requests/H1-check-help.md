# Request from H1: run the Help browser check in CI (gates)

H1's acceptance includes items that only a browser can show: the pages render in the sandboxed
frame with their images, special characters display correctly in Chromium and WebKit, the
Help drawer appears in every mode, the About boxes, Examples. Unit tests run under Node without a
DOM, so H1 wrote the check as a script in its own folder, modelled on `check-shell.mjs`:

```
node app/src/features/help/check-help.mjs [--browser chromium|webkit|all] [--out <dir>]
```

Requests:

1. **Root `package.json`** (gates): `"check:help": "node app/src/features/help/check-help.mjs"`.
2. **`ci.yml`** (gates): run `npm run check:help` in the job `browser-checks`, next to `check:shell`.

The script uses `window.__easy68k` (development builds only) to read the store, and routes the
request to `api.github.com` of the update check through Playwright, so it needs no network.
