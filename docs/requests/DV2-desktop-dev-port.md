# Request of DV2: `npm run desktop:dev` on a free port

Status: open

**File:** `tools/desktop-dev.mjs` (W0 > gates).

**Problem.** The script starts the Vite dev server with `app/vite.config.ts`, which fixes
`server.port: 5173` with `strictPort: true`. On a machine where another dev server already uses
5173 (several work packages run at once), `desktop:dev` fails; and the wave rules ask every server
to take a free port it finds itself. DV2 therefore did not run `npm run desktop:dev` on the shared
machine; the dev-server mode of the main process (`EASY68K_DEV_SERVER_URL`) is exercised by
`tests/desktop/dev` (disk, menu and windows specs) through a dev server on a free port.

**Change asked for.** In `tools/desktop-dev.mjs`, create the server with
`server: { port: 0, strictPort: false }` (or `port: 5173, strictPort: false`, which falls back to the
next free port) and keep passing `server.resolvedUrls.local[0]` as `EASY68K_DEV_SERVER_URL`, as it
does now. Nothing in `desktop/` depends on the port.

**Also (optional).** The CI job `desktop-dev` could upload `build/desktop-dev/test-results` and
`build/desktop-dev/report` as an artifact when it fails (the Playwright configuration writes them
there).
