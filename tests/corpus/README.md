# Test corpus

The 68000 programs the port is tested with (`docs/ARCHITECTURE.md` 6.3), and what the official
EASy68K v5.16.1 produced for each of them.

| Set | What | In the repository | Licence |
|---|---|---|---|
| `official` | The 10 `.X68` and 6 `.wav` files that ship with EASy68K v5.16.1 (`Examples\`), by Chuck Kelly | `official/` | GPL (`official/License.txt`; the distribution's `readme.txt` puts all its files under it) |
| `github-mit` | [pacman-mc68000](https://github.com/andreumassanet/pacman-mc68000) at `13ca2bcd` (24 `.X68`) and [68k-assembly-learning](https://github.com/sbs-henrywrightson/68k-assembly-learning) at `28859a1e` (18 `.X68`), each with its licence file and README | `github/` | MIT |
| `conformance` | Programs written for this project: the assembler checklist and the RichEdit stress files | `../conformance/asm/` | GPL-2.0-or-later |
| `site` | 134 `.X68` from the example pages of the EASy68K web site | **no**: addresses and hashes only (`site-examples.json`) | none that allows redistribution (`docs/porting/ground-truth.md` 3.2) |

The files of `official/` and `github/` are byte copies (`.gitattributes` keeps them so); nothing in
them is edited. Of the two GitHub repositories only the `.X68` files, the licence and the README
were taken; `GAME/GFX.X68` of pacman-mc68000 (2.4 MB of data) is there because `MAIN.X68`
includes it.

## Files

- `manifest.json` - every program: `id`, `set`, `origin`, `licence`, the source file with its
  SHA-256, the folder whose files it may INCLUDE, flags (`richedit-sensitive`, `needs-include`,
  `interactive`), and for every option set (`runs`) what the official `EDIT68K.exe` produced:
  status, error and warning counts, the SHA-256 of the text the editor handed to its assembler and
  of the canonical `.L68` and `.S68`. It is written by `tests/oracle/wine/asm/regenerate.mjs`
  (`npm run oracle:wine:asm`); do not edit it by hand.
- `option-subset.json` - the fixed subset of `docs/ARCHITECTURE.md` 6.9 item 1: 30 programs of
  the tracked sets, each assembled besides its other runs with each of the eight assembler options
  switched alone from its shipped value (runs `nolist`, `nosrec`, `nowar`, `nocre`, `mex`, `sex`,
  `cex`, `nobit`; `SINGLE_OPTION_SETS` in `tests/oracle/wine/asm/settings.ts`). Each entry says
  why the program is there; `regenerate.mjs` plans the runs from this list.
- `index.ts` - reads the manifest and hands out a program's files. Use it from any test:
  `loadManifest()`, `programAvailable(program)`, `readProgram(program)` (the files by the names
  INCLUDE and INCBIN use), `sourcePath`, `goldenDirectory`.
- `site-examples.json` - the 77 archives of the site that unpack: URL, SHA-256, and the SHA-256 of
  every file inside. `node tools/fetch-site-examples.mjs` downloads them into
  `build/corpus-local/` (git-ignored) and checks every byte against this list.
- `manifest.test.ts`, `fetch-site-examples.test.mjs` - run with `npm run test:conformance`. They
  check the manifest against the files, and that no file of the `site` set is in the repository.

The official outputs of the tracked sets are in `tests/conformance/asm/golden/`; those of the
`site` set never leave the machine that produced them (`build/golden-local/`).

`interactive` is a guess made from the source text (a keyboard or mouse task number loaded into
D0); a program that names the task by a symbol is not caught.

The checkout of a third project that may exist under `reference/examples/github/` is not part of
the corpus and is not read by anything (6.3).

## Adding a program

Put the file into `official/`, `github/<repository>/` (with the repository's licence file) or the
conformance folders, only if its licence allows redistribution; then run
`npm run oracle:wine:asm -- --only <part of the id>` (needs Docker, see `tests/oracle/wine/`) and
commit the manifest, the report and the new files under `tests/conformance/asm/golden/`.
