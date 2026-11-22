# Errata and notes of DV1 (offline, install, Pages)

> **Merge status (DOC1, 2026-11-21; completed in its repair round 1).** Every entry of this file has been read. Merged into the documents, each place marked "erratum DV1 <n>" or naming this file: 1, 7 (ARCHITECTURE.md 7.4); 2, 3, 4 (ARCHITECTURE.md 7.5); 6, 12 (ARCHITECTURE.md 5.7); 8 (ARCHITECTURE.md 10.2 (O-7)). Nothing to merge, because no statement of a document is wrong or missing: 5 (contract entry, granted at gate I1 (`ToastOptions`); `app/src/contracts/` is the authority); 9, 10, 11 (records of the browser check and of gate rounds).

Where DV1's work differs from, or adds to, ARCHITECTURE.md (sections 1.1, 5.7, 7.4-7.6, 9.4).

## 1. The build step runs outside the Vite configuration (until gate I1)

7.4 says `pages.yml` builds `app` with the base path and uploads it. A service worker whose file
list comes from the build output needs a step after the build, and `app/vite.config.ts` and
`app/index.html` are frozen. So:

- `app/src/features/pwa/build/pwa-build.mjs` is the step: tags in `index.html` (manifest, icons,
  theme colour, `<meta name="easy68k-service-worker" content="sw.js">`), the precache list
  (every file of the output except `sw.js` and `*.map`, with size and SHA-256), and `sw.js` (the
  bundled `app/src/sw.ts` with the list in front of it). It is idempotent.
- `pages.yml` runs it as `node app/src/features/pwa/build/finish-build.mjs app/dist` after
  `npm run build`. `docs/requests/DV1-vite-plugin.md` asks the gate to add `pwaPlugin()` to the
  Vite configuration, which runs the same step at the end of every production build.
- Until then, `npm run build` everywhere else (CI `e2e`, `desktop-dev`, `release.yml`'s web zip,
  the desktop packages) produces a build without manifest link and without worker. It works; it is
  only not installable and not available offline.
- The tags are added to the built `index.html`, not to the source `app/index.html`, so the
  development server has no manifest link either (nothing to install while developing, and no
  worker: the meta tag is what makes `features/pwa` register one).
- Gate I1: the configuration engineer added `pwaPlugin()` to `app/vite.config.ts`, so every
  production build is now finished (CI `e2e`, `desktop-dev`, `release.yml`, the desktop packages
  too; the desktop app still registers no worker, 7.6 and `register.ts`). `pages.yml` keeps
  `finish-build.mjs` as an idempotent safety net. Since round 2, `check-pwa.mjs` checks that
  `vite build` alone (with the real configuration) wrote `sw.js` and the tags.

## 2. "Versioned by the build hash" (7.5)

The version is the first 20 hex digits of a SHA-256 over the worker's bundled code and the
precache list (paths, sizes, hashes). It changes exactly when a file of the site or the worker's
code changes; the cache is named `easy68k-v-<version>`.

## 3. How "never mix files of two versions" is kept (7.5, task text)

- Installation fetches each file with `cache: 'no-cache'` and stores it only if its size and
  SHA-256 equal the list's; one mismatch (a deployment in progress, a stale proxy) fails the whole
  installation and removes the partial cache; the browser tries again at the next visit. Files
  whose hash is unchanged are copied from the previous version's cache instead of downloaded (the
  14 MB of fonts are not fetched again for a change of one script).
- The first installation does not claim the page that registered it (no `clients.claim()`): that
  page keeps the files it loaded from the network. Its next load is served by the worker.
- A new version waits (no automatic `skipWaiting`). Every page sees `A new version is available.`
  with `Reload`; only `Reload` sends the waiting worker the message to take over, and only the page
  that pressed it reloads. Other open pages get the notice and keep running.
- The worker records which version each page was loaded with (in a small cache,
  `easy68k-clients`, so that it survives the worker being stopped) and answers each page from its
  own version's cache. An older version's cache is deleted once no open page uses it (checked at
  activation and at every navigation; a page is forgotten no earlier than 10 s after it was
  recorded, because the page a navigation creates does not exist yet while the navigation is
  answered).
- Remaining mix: a help page opened in an iframe by a page of the old version after the new version
  took over is a navigation and is answered by the new version (a navigation request carries no
  client id of the page that contains the frame). Help pages change rarely; noted, not solved.
  Gate I1 review: accepted. Routing by the `Referer` was considered and rejected: the old and the
  new page have the same URL (`index.html`), so the referrer cannot tell their versions apart in
  exactly the case where the mix happens (both open). A real fix needs the help panel (H1) to put a
  version marker into the frame's URL, which the page does not know today; not worth it for static
  pages that change rarely.

## 4. Requests the worker leaves to the network

Anything that is not a GET for a file of the list under the scope: `sw.js` itself, source maps,
`https://api.github.com` (the update check of the About box, 7.5), other origins. A navigation to
the scope itself (`/easy68k-cross-platform/`, with any query such as `?open=` or `?example=`) is answered with
`index.html`. URL paths are compared with percent-escapes decoded, so `Quick Reference.htm` and
`Quick%20Reference.htm` are the same file. Range requests get the whole file (only `fetch()` reads
the shipped `.wav` examples; the Output panel plays programs' sounds from `blob:` URLs).

## 5. Contract

`DialogService.toast(text, action?)` (3.12.4) has no duration. W2's `Toast` closes itself after
8 s unless it has the pointer or the focus (`ToastItem.duration`, 0 = stays), and W3's
`ToastEntry` does not pass a duration on. An update notice that disappears after 8 s is easily
missed, so `features/pwa` shows it again every hour while a new version waits (and at every start
of a page while one waits). Proposal for W1/W3: `toast(text, action?, options?: { duration?: number
})`, `ToastEntry.duration` passed to `ToastStack`; `features/pwa` would then pass `duration: 0`.
Filed at gate I1 as `docs/requests/DV1-toast-duration.md`. Until it is applied, `check-pwa.mjs`
records the notice's appearance in each page and keeps the pointer on it, so a slow machine does
not lose the notice before the check presses `Reload`.

Gate I1, round 2: the contract has `ToastOptions { duration? }` and the shell passes it on.
`features/pwa` now shows the notice with `{ duration: 0 }`: it stays until `Reload` or the close
button. The hourly repeat of the notice is gone; the hourly `registration.update()` stays. A
notice the student closed comes again at the next start of a page while a version still waits
(the toast contract tells the caller nothing about a dismissal). `check-pwa.mjs` keeps recording
the notice and resting the pointer on it; that is harmless and keeps the check independent of the
duration.

## 6. Not done: file handlers of the installed app (5.7)

5.7 lists "Web, installed app: file handlers in the manifest for `.x68`, `.l68`, `.s68`
(Chromium)", and W3's erratum (`Platform.onOpenFiles` on the web) assigns the launch queue to
`features/pwa`. The manifest has no `file_handlers` yet, deliberately: a launched file arrives as a
`FileSystemFileHandle` outside the virtual file system, while `Platform.onOpenFiles` and
`DocumentService.open` take `VPath`s. Opening it needs a decision the document does not make
(copy it into `/browser`, and where; or mount a one-file backend; how a later Save writes back) and
belongs with FS2's File System Access backend. Declaring the handlers before something consumes the
launch queue would open an empty window for every double-clicked file. Left for gate I1 to assign.

## 7. pages.yml details

- The base path comes from `actions/configure-pages` (`base_path`, `/easy68k-cross-platform` for the project
  site, empty for a user site) plus `/`, as `EASY68K_BASE`; O-14's "nothing is hard-coded" holds
  for forks too.
- The build job needs `pages: read` (configure-pages reads the site's settings) besides `contents:
  read`; the deploy job has `pages: write` and `id-token: write` (7.4).
- It refuses to deploy unless `engines.yml` reports both engines: the previous deployment stays
  online rather than being replaced by a site that cannot assemble.
- Trying the build step by hand in Git Bash on Windows needs `MSYS_NO_PATHCONV=1`: MSYS rewrites
  `EASY68K_BASE=/easy68k-cross-platform/` into `C:/Program Files/Git/easy68k-cross-platform/` otherwise (noted in the
  header of `pages.yml`; `check-pwa.mjs` passes the variable itself and is not affected).
- Actions pinned by commit like ci.yml: `actions/configure-pages` v6.0.0
  (`45bfe0192ca1faeb007ade9deae92b16b8254a0d`), `actions/upload-pages-artifact` v5.0.0
  (`fc324d3547104276b827a68afc52ff2a11cc49c9`), `actions/deploy-pages` v5.0.1
  (`368f82528645a54fb793d4d04e342629a3f51346`), resolved with `git ls-remote` on 2026-11-21; the
  others as in ci.yml.

## 8. Icons (O-7)

`app/public/icons/` is original work of this project (GPL-2.0-or-later like the rest): a chip in a
dual in-line package with "68K" in seven-segment figures, on the accent colour of the light theme,
drawn from rectangles and polygons only (`features/pwa/icons/icon-art.mjs`). Nothing is taken from
the original's icon. `make-icons.mjs` writes the two SVG files and renders the PNG files (32, 180,
192, 512, maskable 512) with `@napi-rs/canvas`.

## 9. Installation criteria in the browser check (gate I1)

The install prompt cannot be driven by Playwright. Since gate I1, `check-pwa.mjs` checks in both
browsers that the served manifest has a name, a start URL, standalone display and PNG icons of 192
and 512 pixels, and in Chromium asks the browser itself through the DevTools protocol:
`Page.getAppManifest` must report the linked manifest's URL, no critical parse error, standalone
display, the start URL of the site and every icon. `Page.getInstallabilityErrors` is not used: in
Playwright's headless Chromium (159.0.8154.6) it answers `[]` even for a page with no manifest at
all (tried with a scratch page), so it proves nothing. WebKit has no such interface; Safari's "Add
to Dock" and Chromium's real install prompt were not tried.

## 10. pwaPlugin() after a failed build (gate I1, round 2)

Vite (rolldown) calls `closeBundle` after a failed build too. `pwaPlugin()` then ran the step on
an output folder without `index.html` and threw `pwa-build: ... index.html does not exist`, which
replaced the build's own error in the report (seen when another package's file did not parse:
the real `PARSE_ERROR` was hidden). The plugin now notes an error from `buildEnd` or the
`closeBundle` argument and leaves a failed build alone; `pwa-build.test.ts` covers both paths.

## 11. pwaPlugin() under `vite build --watch` (gate I1, round 3)

The flag that round 2 added ("this build failed") was set in `buildEnd(error)` and never cleared.
Under `vite build --watch` one plugin object serves every rebuild, so the rebuild after the error
was fixed would have ended without `sw.js` and without the manifest tags. `buildStart()` now clears
it. `pwa-build.test.ts` "finishes a successful rebuild that follows a failed build (watch mode)"
failed before the change (the second build's `index.html` had no service-worker meta tag) and
passes after it. The project makes no watch builds today, so nothing a user sees changed.

## 12. Gate I2 round 1: file handlers still waiting, now for one contract member

Entry 6 stands, with a narrower reason. FS2 now has the step a launched file needs
(`LinkedBackend.link(handle)` makes a `/linked/...` path that saves back), but `features/pwa` may not
import `app/src/fs`, and no contract reaches it. Filed as `docs/requests/DV1-launch-files.md`
(W1 first, then FS2, then DV1). X1's manifest test fails until then. The repository's new name
(easy68k-cross-platform) is now used in `check-pwa.mjs` (the sub-path it serves under), the tests'
example URLs, `sw.ts`'s comment and `pages.yml`'s comments; the build still takes the sub-path from
`EASY68K_BASE` only.

## 13. File handlers of the installed app (5.7): done

Entries 6 and 12 are settled. FS2's `upload` provider has `linkFileHandle` (FS2 erratum 14), so the
launch queue has its consumer:

- `app/public/manifest.webmanifest` declares
  `"file_handlers": [{ "action": "./", "accept": { "text/plain": [".x68", ".l68", ".s68"] } }]`.
- `features/pwa/launch.ts` sets the consumer of `window.launchQueue` on the web platform (none in
  the desktop app, and nothing where the browser has no launch queue). After the other features'
  `init()` it links each file through `ctx.fileDialogs.linkFileHandle` and opens them as the desktop
  association does (5.7): `.X68`, `.L68` and any other name in Editor mode as documents, in order;
  the first `.S68` in Simulator mode with the origin `association` (a fresh simulator, loaded, not
  run), as `features/run`'s `openAssociatedFiles` takes only the first. A file that cannot be
  linked is named in a toast, `"<name>" could not be opened.` (the port's own text).
- Tests: `launch.test.ts` (the rules, the toast, the consumer set only on the web and run after
  `init()`, the manifest's handlers); X1's `tests/e2e/app/launch.spec.ts` gives the page a launch
  queue with a real `FileSystemFileHandle` of the origin's private file system in Chromium and
  checks the opened document, its status line and that Save writes back. Not tried: a real
  installation and a double-click in a file manager (on the manual list; Playwright cannot install
  an app).
