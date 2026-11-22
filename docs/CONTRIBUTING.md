# Contributing

Thank you for helping. This page explains how the project is organised, how to build and test it,
and the rules a change must follow. How to get a working copy and run the first tests is in the
[README](../README.md), section "For contributors: build and test"; start there.

## The one rule that matters most

**Anything a student's program can observe must match EASy68K v5.16.1 for Windows, quirks
included**: what a source file assembles to, the `.L68` and `.S68` files, what each instruction
does, cycle counts, the TRAP #15 tasks, the pixels a program draws, the log files. Defects of the
original's windows and dialogs that cannot change a program's results may be fixed. Every
deliberate difference, of either kind, is written down (see "Differences and corrections" below).

That is why the assembler and the simulator are not rewritten: they are the original's C++ sources,
compiled to WebAssembly with a small, documented set of patches. Application code never computes
what the engines compute.

## How the project is organised

| Folder | What is there |
|---|---|
| `engine/asm`, `engine/sim` | The original assembler and simulator sources, the patches the port needs (`PATCHES.md` in each folder says which and why), the build script and the engines' own tests. `npm run build:engines` writes `engine/dist/`, which is not in Git. |
| `app/` | The web application: TypeScript and React, built with Vite. |
| `app/src/contracts` | The interfaces between the parts of the application. Parts talk to each other only through these. |
| `app/src/core` | Logic that runs without a browser (documents, settings files, the simulator's host devices, the run controller, highlighting, ...). Everything here is tested under Node. |
| `app/src/engine` | The binding to the two WebAssembly engines. `docs/ENGINE-BINDING.md` explains it. |
| `app/src/features/<name>` | One feature each (editor, assemble, run, output, memory, help, ...): its commands, panels and dialogs. |
| `app/src/ui/components` | The component kit; `npm run dev` and then `/?gallery` shows every component. |
| `app/src/commands` | The menus, toolbars and keyboard shortcuts of the three modes, as tables. |
| `app/public` | The original's help pages, its example programs, and the fonts. |
| `desktop/` | The macOS app: Electron around the same web build, with real disk access and the serial and network tasks. |
| `tests/` | Conformance tests against the official program (`tests/conformance`), end-to-end tests in real browsers (`tests/e2e`), integration scenarios (`tests/integration`), the desktop app's tests (`tests/desktop`), and the tools that produce reference results (`tests/oracle`). |
| `tools/` | Scripts behind the npm commands. |
| `docs/` | The design (`ARCHITECTURE.md`), the specifications of the original (`docs/porting`), and the documents for users and contributors. |

`docs/ARCHITECTURE.md` is the design that all of this follows. Read its section 0 (ground rules)
before you change code, and the section of the part you change. The specifications in `docs/porting/`
describe what the original does, with citations of its source code.

## Building and running

| Command | What it does |
|---|---|
| `npm ci` | Installs the exact tool versions of `package-lock.json`. Use it instead of `npm install`. |
| `npm run setup:emsdk` | Installs Emscripten 7.0.0 into `.toolchain/emsdk` (once). |
| `npm run build:engines` | Compiles both engines into `engine/dist/`. Needed after a change under `engine/`. |
| `npm run dev` | Starts the application at a local address. Changes to `app/` appear at once. |
| `npm run build` | Builds the published web version into `app/dist/`; `npm run preview` serves it. |
| `npm test` | The unit tests of the application (Vitest, under Node, no browser). |
| `npm run typecheck`, `npm run lint`, `npm run format:check` | TypeScript, ESLint (including the rule that keeps the layers apart) and Prettier. |
| `npm run test:conformance` | The engines against the committed results of the official program. |
| `npm run test:integration` | Whole scenarios of the application under Node, with the real engines. |
| `npm run test:e2e` | The end-to-end tests in Chromium and WebKit (after `npx playwright install chromium webkit` and `npm run build`). |
| `npm run check:<name>` | One browser check per part of the application (about thirty; `package.json` lists them). Each starts the development server on a free port, drives Chromium and WebKit, and prints `N of M checks passed`. |
| `npm run desktop:dev` | The macOS app from source. It opens a window. |
| `npm run desktop:test -- dev` | The desktop app's tests (on a Mac). |
| `npm run desktop:dist -- --arm64` (or `-- --x64`) | Builds the Mac app's `.dmg` and `.zip` (on a Mac). |

Without Emscripten, `npm run fetch:engines` downloads `engine/dist` from the latest GitHub release. No
release exists yet, so for now the engines have to be built.

On Windows, every command works in PowerShell and in Git Bash. In Git Bash, a command that passes a
path beginning with `/` to a Windows program may need `MSYS_NO_PATHCONV=1` in front of it.

The reference results of the official EASy68K come from running it under Wine in Docker
(`npm run oracle:wine:build`, `oracle:wine:asm`, `oracle:wine:sim`). You do not need this to work
on the application: the results are committed. The official program is never run directly on a
developer's machine.

## Rules for a change

- **Tests.** Logic goes into plain functions or models that can be tested under Node; the test sits
  next to the code (`x.ts`, `x.test.ts`). Anything that needs a real browser gets a browser check or
  an end-to-end test, not a unit test. A test that takes a second or more gets an explicit time
  limit. A test that needs `engine/dist` skips when it is missing but fails when
  `EASY68K_REQUIRE_ENGINES=1` is set (the continuous integration sets it); copy the check from
  `app/src/contracts/contracts.test.ts`.
- **Layers.** `core` and `contracts` never touch the page or the browser's storage. A feature does
  not import `engine`, `fs` or `platform`; it gets what it needs through the application context.
  `npm run lint` enforces this.
- **Exact texts.** Captions, messages and file formats that the specifications quote are used
  exactly, including double spaces and the original's spelling mistakes.
- **Bytes.** Files and engine data are bytes; text on disk is Windows-1252 with CR LF.
- **Keyboard shortcuts** come from the tables in `app/src/commands`; never write a key into a
  feature. A shortcut must work on Windows, Linux and macOS (Cmd on a Mac).
- **No new dependency** without discussing it first in an issue. The runtime dependencies are a short,
  closed list.
- **Nothing may assume Windows.** The continuous integration runs on Windows, macOS and Linux, and a
  test must give the same result on each.
- **Formatting**: run `npx prettier --write <your files>` before you commit.

## Differences and corrections

- A deliberate difference from the original goes into `docs/differences/<part>.md`, and from there into
  [DIFFERENCES.md](DIFFERENCES.md), which the application shows as Help > Differences from EASy68K.
  After changing `docs/DIFFERENCES.md`, run `npm run import:help` (it needs the original help files in
  `reference/`, which are not in the repository) or ask a maintainer to.
- A mistake in a specification (`docs/porting/*.md`) or in `docs/ARCHITECTURE.md` is written into
  `docs/porting/errata/<part>.md`: what the document says, what the original's source says, with a
  citation. The errata are merged into the documents from time to time.
- A behaviour that cannot be settled from the source is marked UNVERIFIED in the specification; the
  port does what the specification recommends, and it is listed in part 4 of `docs/DIFFERENCES.md`.

## Pull requests

- Keep a pull request to one subject. Say what it changes, why, and how you tested it (the commands
  and what they printed).
- The continuous integration (`.github/workflows/ci.yml`) runs the type check, lint and the format
  check on Linux; the unit tests, the engines' suites, the browser checks and the end-to-end tests
  on Linux, macOS and Windows; and the conformance tests on Linux and macOS. All must pass.
- A manual run of the continuous integration (Actions > ci > Run workflow) adds two jobs that a push
  does not run. The performance job runs the whole of `npm run check:perf`; its verdicts in Chromium
  on ubuntu-latest decide item 9 of `docs/ARCHITECTURE.md` 6.9. The stability job (input
  `e2e_stability`, ticked by default; item 10) runs the end-to-end suites with `--repeat-each=20`,
  split with Playwright's `--shard` into six jobs: Chromium in 2, WebKit in 4. The shards of one
  browser together run every test exactly 20 times, and the item passes only if all six jobs pass.
- Everything a person has to check on a real Mac is in [MANUAL-TEST-MAC.md](MANUAL-TEST-MAC.md);
  if your change adds such a thing, add it there.
- Releases are drafted by `.github/workflows/release.yml` from a tag `v<version>` and published by a
  maintainer after the manual test. The notes of a release are generated by
  `desktop/scripts/release.mjs`; [CHANGELOG.md](../CHANGELOG.md) collects what changed.

## Licence

The project is under the GNU General Public License, version 2 or (at your option) any later
version, like EASy68K itself. By contributing you agree that your contribution is published under the
same licence. Do not add material whose licence does not allow that, and do not copy anything from
the `reference/` folder that a maintainer may have locally: much of it may not be redistributed.
