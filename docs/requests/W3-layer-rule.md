# Request from W3: the layer rule and features that need `fs/`, `engine/` or `platform/` (gates, W1)

Found while writing the bootstrap (ARCHITECTURE.md 3.12.3). Not needed by W3 itself; it concerns
the packages that replace W3's stubs, and is written down here so that the gate can decide once
instead of each package finding it alone. Background: `docs/porting/errata/W3.md`, entries 10
and 11.

The rule of 3.1, enforced by `easy68k/layer-imports`: `features/<x>/` imports `contracts/`,
`core/`, `state/`, `commands/`, `ui/components/`. It may not import `fs/`, `engine/` or
`platform/`. Three kinds of feature code need something from those folders:

| Who | Needs | What W3 did |
|---|---|---|
| SH8, `features/run/session.ts` | `createSimEngine`, `releaseSimEngine` (`engine/index.ts`); `CachedSyncFiles` (`fs/sync/cached.ts`) for `ProgramFilesDeps.viewFor` | The bootstrap passes both: `createSimSession(ctx, env)`, `SimSessionEnv` in `app/src/state/services.ts` (`env.engines.create` / `.release`, `env.createCachedSyncFiles(deps)`). No rule change needed. |
| FS1, `fs/browser-backend.ts` | to be mounted at start | `main.tsx` calls `createStartupBackends(platform)` of every `fs/*-backend.ts` that exports it. No rule change needed. |
| DV2, `platform/desktop.ts` | to be chosen at start | `main.tsx` calls its `createDesktopPlatform()` when `window.easy68kDesktop` exists. No rule change needed. |
| FS2, `features/files-fsaccess/**` | to construct an `fsaccess` backend from a directory handle the user picked, at run time, and mount it (`ctx.vfs.mount`) | Nothing: a feature cannot construct a class of `fs/`. |
| FS1, `features/files/**` | `fs/zip.ts` for Export and Import | Nothing. |

Requests:

1. **`eslint.config.js`** (gates): allow `features/files/` and `features/files-fsaccess/` to
   import `fs/` (they are the user-interface halves of FS1's and FS2's own `fs/` files). The
   alternative that needs no rule change is a function handed in by the bootstrap for each case,
   as for the session; W3 will add those on request, but more parameters on service factories are
   worse than one line in the rule.
2. **W1, `app/src/contracts/features.ts`**: take over `SimEngineFactory`, `SimSessionEnv` and
   `ServiceFactories` from `app/src/state/services.ts`, and say in 3.12.3 that the factory is
   `createSimSession(ctx, env)`.
3. **3.12.3 of the document** (architect): name who mounts backends and who chooses the platform
   (today: `main.tsx`, by the two export names above).
