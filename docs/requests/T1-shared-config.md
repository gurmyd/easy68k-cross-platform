# T1: requests for shared configuration

Status: open (for integration gate I1).

T1 moved the Wine oracle from `tools/oracle-official/` to `tests/oracle/wine/` (section 8) and
deleted the old folder. Nothing below blocks T1's work: every check passes today. The requests
remove leftovers and say what the gate may want to wire.

## 1. Leftovers that name `tools/oracle-official/` (root files, owner W0 > gates)

The folder no longer exists; these lines are dead. The new location needs no replacement entry:
its scripts and documents are formatted and linted like the rest of `tests/`, and the root
`.gitattributes` already covers them (`/tests/** text=auto eol=lf`, `/tests/**/*.X68 -text`,
`/tests/**/golden/** -text`, `/tests/corpus/** -text`).

| File | Line | Change |
|---|---|---|
| `.prettierignore` | `/tools/oracle-official/` and "the oracle of the official binaries" in the comment above it | remove |
| `eslint.config.js` | `'tools/oracle-official/**',` in `ignores` | remove |
| `.editorconfig` | `[{engine,reference,tools/oracle-official}/**]` | `[{engine,reference}/**]` |
| `.gitattributes` | the comment "the engines (engine/**) and the oracle under tools/oracle-official/ carry original sources ..." and "(and of `engine/asm`, `tools/oracle-official`)" | drop the oracle from the sentence |

`eslint.config.js` also ignores `tests/oracle/asm-cli/run-asy68k.mjs` ("moved verbatim from
build/oracle by W0; T1 owns it"). Keep that line: the file is still the verbatim runner.

## 2. Documents that name the old paths (owner: their authors / DOC1)

`docs/porting/official-oracle.md` (throughout), `docs/porting/ground-truth.md` (the update note of
section 4) and `docs/porting/errata/W0.md` entry 4 name `tools/oracle-official/` and the image
`easy68k-oracle-official:dev`. `docs/porting/errata/T1.md` entry 1 has the table of old and new
names for DOC1 to merge.

## 3. CI

- `ci.yml` needs no change for T1: `tests/conformance/asm/vitest.config.ts` exists now, so the
  `conformance` job (ubuntu, macos) starts to run `npm run test:conformance`. It needs
  `engine-dist` (the job already downloads it and sets `EASY68K_REQUIRE_ENGINES`), Node 24, and
  nothing else. T1 has no browser check and adds no `check-*.mjs` script.
- `oracle.yml` is T1's own file (weekly and manual). It reuses `engines.yml` and only the action
  versions `ci.yml` already pins. The repository setting "Allow GitHub Actions to create and
  approve pull requests" must be on for its `propose` job to open a pull request; without it the
  job fails at `gh pr create` and the changed goldens are still in the run's artifact
  `oracle-changed`.
- The job `conformance` of `ci.yml` runs on ubuntu and macos only. The suite also passes on Windows
  (that is where it was written); the gate may add `windows-latest` to its matrix if it wants the
  byte comparison on all three systems.

## 4. No dependency was added

Everything T1 wrote uses Node's own modules (`node:zlib` for the archives, `node:crypto`), the
pinned Vitest and Docker. Nothing was added to a `package.json`.
