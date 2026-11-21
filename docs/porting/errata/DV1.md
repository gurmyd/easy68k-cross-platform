# Errata and notes of DV1 (offline, install, Pages)

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

## 4. Requests the worker leaves to the network

Anything that is not a GET for a file of the list under the scope: `sw.js` itself, source maps,
`https://api.github.com` (the update check of the About box, 7.5), other origins. A navigation to
the scope itself (`/easy68k-mac/`, with any query such as `?open=` or `?example=`) is answered with
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

- The base path comes from `actions/configure-pages` (`base_path`, `/easy68k-mac` for the project
  site, empty for a user site) plus `/`, as `EASY68K_BASE`; O-14's "nothing is hard-coded" holds
  for forks too.
- The build job needs `pages: read` (configure-pages reads the site's settings) besides `contents:
  read`; the deploy job has `pages: write` and `id-token: write` (7.4).
- It refuses to deploy unless `engines.yml` reports both engines: the previous deployment stays
  online rather than being replaced by a site that cannot assemble.
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
