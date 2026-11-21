# Request from H1: the port's version and repository for the About boxes (gate; W3)

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
