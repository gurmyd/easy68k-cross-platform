# Request of FS2: a root script and a CI entry for the File System Access check

Status: applied at gate I2 round 1 (config), both items: root script `check:fsaccess` and the step "File System Access check (FS2)" of `browser-checks`, group `interface`, on Ubuntu, macOS and Windows; `build/FS2/fsaccess-check/` (without its vite-cache) is uploaded on failure. Run here: 88 of 88.

1. **Root `package.json`** (gates): add

   ```json
   "check:fsaccess": "node app/src/features/files-fsaccess/check-fsaccess.mjs"
   ```

2. **`ci.yml`, job `browser-checks`**: run `npm run check:fsaccess` in the **interface** group on
   Ubuntu, macOS and Windows.

   - It needs no production build (it starts the Vite development server of `app/` on a free port).
   - Since gate I2 it uses both engines when `engine/dist` holds them: a program in the opened
     folder is assembled, executed, and writes a file of its own there. Without them that part is
     skipped with a note, unless `EASY68K_REQUIRE_ENGINES=1`, which makes it run (and fail). Like
     `check:shell`, it ignores the session's `Simulator: ...` console messages when `engine/dist`
     is missing, unless `EASY68K_REQUIRE_ENGINES=1`. The job should therefore download the
     `engine-dist` artifact before it, as it does for the other checks.
   - Chromium runs three passes (the backends on directory handles of the origin private file
     system, the opened folder, a linked file); WebKit runs one (the feature must be absent). It
     uses no keyboard shortcuts, so nothing in it depends on the system's key map. Its timing
     figures (appendFile, how long the user activation took to expire, when the program's file
     reached the folder) are printed, not checked. It has no fixed pauses: the one wait for
     Chromium's transient user activation to expire polls `navigator.userActivation.isActive`
     (up to 60 s).
   - Runtime on this machine: about 30 s for both browsers.
   - Screenshots and `results.json` go to `build/FS2/fsaccess-check` (`--out <dir>` to change).
