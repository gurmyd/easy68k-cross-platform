Status: accepted as asked at gate I1 (contracts engineer, W1). `contracts/features.ts` has `BuildFacts { version; repository }` and the optional `AppContext.build?: BuildFacts`; the shell's bootstrap fills it. H1 reads `ctx.build?.version` and `ctx.build?.repository` in place of `portVersionFromTitle(document.title)` and `DEFAULT_REPOSITORY`. Details: `docs/porting/errata/W1.md`, entry 11.

Status (shell part, W3): done at gate I1. `bootstrap()` sets `ctx.build` (frozen `{ version, repository }`) from `BootstrapEnv.version` and the new `BootstrapEnv.repository`, which `main.tsx` takes from `buildInfo`; `Application.build` is the same object. check-shell.mjs reads it in the page.

# Request from H1: the port's version and repository for the About boxes (gate; W3)

Status (configuration part): applied in gate I1 round 1, nothing to change: `tools/build-info.mjs` already writes `version` (root package.json) and `repository` (GITHUB_REPOSITORY, else the origin remote) into `app/src/build-info.ts` at every dev-server start, build and typecheck, and `main.tsx` imports it. The `AppContext.build` field is for the contracts engineer (type) and the shell engineer (bootstrap).

The About boxes show the port's version and link to its repository, and the editor's `Check` button
asks the latest release of that repository (ARCHITECTURE.md 1.4 note 11, 10.2 O-14: "nothing is
hard-coded"). A feature may not import `app/src/build-info.ts` (3.1), and `AppContext` has no field
for it.

Today: H1 reads the version from the window title ("... - unofficial port <version>", built by
`windowTitle` in `bootstrap.ts`) and uses `gurmyd/easy68k-mac` as the repository
(`DEFAULT_REPOSITORY`, `core/help/about.ts`).

Request (W3, at the gate): add `build: { version: string; repository: string | null }` to
`AppContext` (contracts/features.ts, filled by `bootstrap` from `buildInfo`). H1 then replaces
`portVersionFromTitle(document.title)` and `DEFAULT_REPOSITORY` in `features/help/AboutDialog.tsx`
with it; the change is two lines.
