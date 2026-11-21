# CPU catalogue: the 68000 single-step suite on the EASy68K core

Work package T4 (ARCHITECTURE.md 6.1 layer L7, 6.2.4). The catalogue itself, with every class of
deviation and its count, is `docs/porting/cpu-deviations.md`. Part of easy68k-cross-platform, an unofficial
port of EASy68K. GPL-2.0-or-later.

| File                             | What                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `suite.json`                     | The suite: SingleStepTests/680x0, folder `68000/v1`, pinned commit; every file with size, git blob SHA-1 and SHA-256                                                     |
| `fetch-suite.mjs`                | Downloads the suite into `build/singlestep/` (never committed: it has no licence) and checks each file                                                                   |
| `singlestep.mjs`                 | Turns a suite file into a simulator-twin script, reads the transcript back, compares with the expected final states, names the class of each deviation                   |
| `catalogue.mjs`                  | Per-file analysis, the themes, the baseline (read, write, compare)                                                                                                       |
| `baseline.json`                  | The frozen outcome: per file the number of tests, of deviating tests, the count per class and a SHA-256 over "test index, class" - counts, class names and hashes only   |
| `run-catalogue.mjs`              | Runs the whole suite through the WebAssembly simulator and compares with the baseline; writes `build/cpu-catalogue/report.md`                                            |
| `run-singlestep.mjs`             | The same check only (no `--write-baseline`); skips without `engine/dist` unless `EASY68K_REQUIRE_ENGINES=1`. Run weekly on Linux by the job `singlestep` of `oracle.yml` |
| `*.test.mjs`, `vitest.config.ts` | Unit tests (project `cpu` of `npm run test:conformance`); `baseline.test.mjs` is the baseline check                                                                      |

## Commands

```
node tests/conformance/cpu/fetch-suite.mjs                     # download / verify the suite (about 200 MB)
node tests/conformance/cpu/run-catalogue.mjs                   # compare with baseline.json (about 4 minutes)
node tests/conformance/cpu/run-catalogue.mjs --only DIVS,ABCD  # some files only
node tests/conformance/cpu/run-catalogue.mjs --from-baseline   # the report from baseline.json, no suite needed
node tests/conformance/cpu/run-catalogue.mjs --write-baseline  # after a deliberate change of the core
node tests/conformance/cpu/run-singlestep.mjs                  # the check of oracle.yml's job singlestep
EASY68K_SINGLESTEP=1 npm run test:conformance                  # the same baseline check under Vitest
```

`npm run oracle:twins` (tests/oracle/native-twin) runs the same scripts through the native
simulator twins as well, requires identical transcripts, and checks the baseline on every run; in
CI it fetches the suite itself.

## Why a deviation is not a failure

The suite describes a real 68000; the port must behave like EASy68K (ARCHITECTURE.md section 0),
so every deviation found here is kept. What fails is a _change_: if any test's outcome differs from
the baseline, the core's behaviour changed, and that needs a reason (and then a new baseline and an
update of docs/porting/cpu-deviations.md).
