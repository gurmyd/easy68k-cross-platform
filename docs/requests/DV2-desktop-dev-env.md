# Request of DV2: `npm run desktop:dev` must not inherit `ELECTRON_RUN_AS_NODE`

Status: applied in gate I1 round 2. `tools/desktop-dev.mjs` builds the child's environment with `electronDevEnv()` from the new `tools/desktop-dev-env.mjs`, which drops `ELECTRON_RUN_AS_NODE` (in any spelling, for Windows) and sets `EASY68K_DEV_SERVER_URL`; both `spawn` calls use it. Test: `tests/lint/desktop-dev-env.test.ts` (part of `npm run lint`). `desktop:dev` itself was not started (it opens a window).

**File:** `tools/desktop-dev.mjs` (W0 > gates).

**Problem.** When the shell that runs `npm run desktop:dev` has `ELECTRON_RUN_AS_NODE` set (some
tool hosts and editor terminals set it; the agent environment of this machine has
`ELECTRON_RUN_AS_NODE=1`), the script passes it on to Electron in `{ ...process.env, ... }`.
Electron then runs `desktop/dist/main.js` as plain Node, and the app stops at once with
`Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')`, because the
`electron` module is not the Electron API in that mode. `tests/desktop/dev/harness.ts` already
deletes the variable from the environment it gives Electron; `desktop:dev` does not. Seen in gate
I1 round 1 (DV2 report, item 5): `desktop:dev` worked only after the variable was removed by hand.

**Change asked for.** In both `spawn` calls of `tools/desktop-dev.mjs`, build the child's
environment without the variable, for example:

```js
const env = { ...process.env, EASY68K_DEV_SERVER_URL: url };
delete env.ELECTRON_RUN_AS_NODE;
```

Nothing in `desktop/` changes.
