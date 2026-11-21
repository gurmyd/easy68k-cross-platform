# Request from DV1: finish every production build for offline use (gate I1)

Status: applied in gate I1 round 1. `app/vite.config.ts` imports `pwaPlugin` and lists `pwaPlugin() as unknown as Plugin` after `cspPlugin()`. Checked: `vite build` writes `sw.js` (429 files) and the tags after the policy meta; a second run of `finish-build.mjs` on that output changes no byte; the dev server and `npm test` are unaffected.

The web app works offline through a service worker whose list of files is produced from the build
output (ARCHITECTURE.md 1.1, 7.5). The step that does it is DV1's
`app/src/features/pwa/build/pwa-build.mjs`: after `vite build` it adds the manifest, icon, theme
and `<meta name="easy68k-service-worker" content="sw.js">` tags to `dist/index.html`, lists every
file of the output except `sw.js` and source maps with size and SHA-256, bundles `app/src/sw.ts`
into `dist/sw.js` and puts that list in front of it. Without the meta tag the page registers no
worker, so a build without the step is a working build that is not available offline.

`app/vite.config.ts` is frozen, so today the step runs as a separate command: `pages.yml` calls
`node app/src/features/pwa/build/finish-build.mjs app/dist` after `npm run build`, and DV1's browser
check does the same. Every other production build - `npm run build` in the `e2e` and
`desktop-dev` jobs, the web zip of `release.yml`, `desktop:pack` and `desktop:dist` - has no
manifest link and no `sw.js`.

## The change

`app/vite.config.ts` (two lines):

```ts
import { pwaPlugin } from './src/features/pwa/build/pwa-build.mjs';
```

and in `plugins`:

```ts
  plugins: [react(), buildInfoPlugin(), cspPlugin() as Plugin, pwaPlugin() as unknown as Plugin],
```

`pwa-build.d.mts` types the module, so no `@ts-expect-error` is needed; the plugin is typed loosely
(`PwaPlugin`) because `features/` may not import from `vite`, hence the cast, as for `cspPlugin`.

What the plugin does: `apply: 'build'`, and in `closeBundle` (`order: 'post'`, sequential) it runs
the same `finishPwaBuild(outDir)` as the command. It does not touch the development server or the
Vitest configuration (which merges the Vite configuration; a plugin with `apply: 'build'` is not
used there). It runs after `easy68k-csp` has written and checked `index.html`, and puts its tags
after the policy, before `</head>`.

Verified by DV1 without editing the file: a `vite build` with `configFile: app/vite.config.ts` and
`plugins: [pwaPlugin()]` added through the JavaScript API wrote `index.html` with the six tags after
the policy meta and `sw.js` with 429 files in its list (`build/DV1/try-plugin.mjs`, scratch).

## After it is applied

- The step in `pages.yml` may stay: it is idempotent (a second run writes the same bytes).
- The desktop app's `app/dist` then contains `sw.js` and the manifest. Nothing changes there:
  `features/pwa` registers no worker when `platform.kind` is `desktop` (7.6), and the `app://`
  handler serves the files as before (`.webmanifest` should be in DV2's extension table as
  `application/manifest+json` if the page's manifest link is to load without a refusal; an
  unknown extension is refused, which only costs the manifest, not the app).
