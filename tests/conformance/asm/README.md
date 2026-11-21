# Assembler conformance

The WebAssembly assembler compared with the official `EDIT68K.exe` v5.16.1, file by file
(`docs/ARCHITECTURE.md` 6.1 layer L2, 6.4). Run it with `npm run test:conformance`; it needs
`engine/dist` (`npm run build:engines` or `npm run fetch:engines`) and nothing else: no Docker, no
Wine, no network.

## What is compared

For every program of the corpus (`tests/corpus/manifest.json`) and every option set it has:

1. the source goes through `editorLoad` (`compare.ts`), the model of what the editor does before
   it assembles: trailer lines removed, every line ended with CR LF. The manifest holds the SHA-256
   of the text the official editor really handed to its assembler, captured during the oracle run;
   the test checks the model against it. For the four inputs where Wine's editor does something
   else (`golden/REPORT.md`), the captured text is in the golden folder and is assembled instead;
2. the application's own engine binding (`app/src/engine`) assembles that text with the options of
   the run and, when the official listing is in the repository, with the time of its date line;
3. the result must equal the official one: **byte for byte, the date line included**, for a
   program without undefined symbols. Where the listing reports an undefined symbol, the original
   encodes uninitialised memory; `canonicalListing` and `canonicalSRecord` mask exactly the affected
   statements and S-record data, and the rest must be equal. Error and warning counts must agree.

A run that differs fails its test, unless `known-differences.json` lists it with its reason; a
listed run that starts to match fails too, until its entry is removed.

| File                                             | What                                                                                                                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `corpus.test.ts`                                 | The example sets: `official`, `github-mit`, and `site` when `node tools/fetch-site-examples.mjs` has fetched it (its official outputs are not in the repository; the comparison is by hash)           |
| `checklist.test.ts`                              | The test checklist of `docs/porting/assembler.md` §3.9: one test per item, named after the item, proved by the programs `checklist/checklist.json` names; then the conformance programs no item names |
| `harness.ts`                                     | One comparison (`compareRun`) and the per-file report                                                                                                                                                 |
| `compare.ts`                                     | The editor model, the canonical forms and the comparison; no dependency on any assembler                                                                                                              |
| `known-differences.json`                         | Runs in which the port does not reproduce the official output, with the reason and the owner of the cause                                                                                             |
| `checklist/programs/<name>/prog.X68`             | The checklist programs (with their include files); `checklist/programs.json` gives each its option sets                                                                                               |
| `richedit/*.X68`                                 | Sources that stress the editor's RichEdit round trip (written by `tests/oracle/wine/asm/gen_richedit_stress.py`)                                                                                      |
| `golden/<program id>/<option label>.L68`, `.S68` | What the official program produced, unchanged. `golden/REPORT.md` lists every run without a result and why                                                                                            |

Each test file writes a per-file report to `build/reports/asm-conformance-*.json` and prints its
summary line.

## Where the goldens come from

`npm run oracle:wine:asm` (`tests/oracle/wine/`, needs Docker) runs every program through the
official editor under Wine and rewrites `golden/`, `tests/corpus/manifest.json` and
`golden/REPORT.md`. The weekly workflow `.github/workflows/oracle.yml` does the same and opens a
pull request when something changed. Never edit a golden by hand.

Most checklist programs come from the engine's own test programs (`engine/asm/test/cases.mjs`,
written for this project); the rest were added for items those do not reach. A new program is a
folder under `checklist/programs/` with an entry in `checklist/programs.json` (its option sets)
and, to count for a checklist item, in `checklist/checklist.json`; then regenerate.
