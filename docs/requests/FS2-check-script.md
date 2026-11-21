# Request of FS2: a root script and a CI entry for the File System Access check

1. **Root `package.json`** (gates): add

   ```json
   "check:fsaccess": "node app/src/features/files-fsaccess/check-fsaccess.mjs"
   ```

2. **`ci.yml`, job `browser-checks`**: run `npm run check:fsaccess` in the **interface** group on
   Ubuntu, macOS and Windows.

   - It needs no production build (it starts the Vite development server of `app/` on a free port).
   - It does not use the engines. Like `check:shell`, it ignores the session's `Simulator: ...`
     console messages when `engine/dist` is missing, unless `EASY68K_REQUIRE_ENGINES=1`.
   - Chromium runs three passes (the backends on directory handles of the origin private file
     system, the opened folder, a linked file); WebKit runs one (the feature must be absent). It
     uses no keyboard shortcuts, so nothing in it depends on the system's key map. Its one timing
     figure (appendFile) is printed, not checked.
   - Runtime on this machine: about 90 s for both browsers (two of them are deliberate waits for
     Chromium's transient user activation to expire).
   - Screenshots and `results.json` go to `build/FS2/fsaccess-check` (`--out <dir>` to change).
