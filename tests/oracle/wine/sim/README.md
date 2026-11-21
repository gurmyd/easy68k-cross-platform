# Simulator driver of the Wine oracle

The scripts that run the **official** `SIM68K.exe` v5.16.1 under Wine (layer L4 of
`docs/ARCHITECTURE.md` 6.1, 6.2.2) and record what it produced for the simulator conformance
programs in `tests/conformance/sim/`. The official programs run only inside the container; their
outputs are facts about the original and are committed as goldens. Owner: work package T3.

## Use

Needs what `../README.md` describes (Docker, `npm run oracle:wine:build`, the official
distribution in `reference/official-extracted/`, Node 24). From the repository root:

```sh
npm run oracle:wine:sim                                     # every program, 4 containers (about an hour)
node tests/oracle/wine/sim/regenerate.mjs --containers 6    # at most 6 (each container gets one CPU)
node tests/oracle/wine/sim/regenerate.mjs --only trap15-a/a1 --only logs/l0
node tests/oracle/wine/sim/regenerate.mjs --check           # change nothing, exit 1 on a difference
node tests/oracle/wine/sim/regenerate.mjs --report          # rewrite golden/REPORT.md only (no Docker)
bash tests/oracle/wine/sim/run-report.sh my/prog.X68 "/e"   # one program of your own, self-reporting
bash tests/oracle/wine/sim/run-log.sh my/prog.S68 2+out     # one execution log (and output log)
npx vitest run --config tests/conformance/sim/vitest.config.ts   # the port against the goldens
```

A run writes, below `tests/conformance/sim/golden/`:

- `<suite>/<program>.result.bin` - the file a self-reporting program wrote;
- `<suite>/<program>.OutLog.txt` - the text-output log of a Run (`outlog` recipe);
- `<suite>/<program>.log<N>[o].RunLog.txt.gz` - the execution log of an Auto Trace, log type N
  (gzipped: logs are large and repetitive), and `.log<N>o.OutLog.txt` with `+out`;
- `manifest.json` - per program the SHA-256 of the source, of the official `.S68` and of the
  official `.L68` with its date line masked, and per recipe the status, the time it took, the
  number of logged instructions and the SHA-256 of every artifact after masking its date line;
- `REPORT.md` - the counts and every run without an official result, with the reason.

A golden is rewritten only when its masked content changed, so a regeneration on another machine
changes nothing but `manifest.json`'s date. Work files of a run (job list, one log per container,
every output, screenshots of failed runs) are in `build/oracle-wine/sim/<run>/`.

## The recipes

Each program says in its first comment block what is run (`tests/conformance/sim/programs.ts`):

| Recipe             | What the driver does in the container (`sim_batch.py`, `sim_run.py`)                                                                                                                                                                    | What is collected                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `report` (default) | writes the shipped `sim68K.dat` (exceptions and bit field from the switches), starts `SIM68K.exe prog.S68 /r [/e] [/b]`, waits until `result.bin` ends in `END-OF-DUMP`, kills the simulator                                            | `result.bin`                            |
| `outlog`           | `sim68K.dat` with output-log byte 1, start without `/r`, Ctrl+F4 (Log Start), F9, wait for `Current Log Stopped.`, Enter, Alt+F4                                                                                                        | `<name>_OutLog.txt`                     |
| `log:N[+out]`      | `sim68K.dat` with exec-log byte N (and output-log byte 1), `1$disable display`, interval 10; start without `/r`; Options > Auto Trace Options > OK (applies the interval); Ctrl+F4; F10; wait for `Current Log Stopped.`, Enter, Alt+F4 | `<name>_RunLog.txt` (and `_OutLog.txt`) |

Before any of them the program is assembled by the official `EDIT68K.exe` with the shipped
`settings.dat` (`asm_batch.assemble_one`, the routine T1's assembler oracle uses), once per program.
A program that is given as an `.S68` (`run-report.sh`, `run-log.sh`) is run as it is.

## Files

| File                          | Where it runs | What                                                                                                                                                               |
| ----------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `regenerate.mjs`              | host          | `npm run oracle:wine:sim`: plans the jobs, runs the containers (`../common/docker.mjs`), hashes and stores the results; `--file` for one program                   |
| `regenerate.test.mjs`         | host          | its unit tests (no Docker); run by `npm run test:conformance`                                                                                                      |
| `run-report.sh`, `run-log.sh` | host          | one program with one recipe (6.2.2); call `regenerate.mjs --file`                                                                                                  |
| `sim_corpus.sh`               | container     | stages the official folder and the programs, runs one shard of the job list                                                                                        |
| `sim_batch.py`                | container     | per job: assemble once, fresh run folder, one recipe of `sim_run.py`, collect                                                                                      |
| `sim_run.py`                  | container     | the two recipes of official-oracle.md 5.1 and 5.2, unchanged since they were proven there                                                                          |
| `sim_proofs.sh`               | container     | the first proof run of official-oracle.md 5.1/5.2; superseded by the above and kept only because the `Dockerfile` (T1) names it (docs/requests/T3-oracle-image.md) |

The image is not rebuilt for a change of these scripts: `regenerate.mjs` mounts this folder
read-only at `/mnt/sim-driver` and runs `sim_corpus.sh` and `sim_batch.py` from there.
`sim_batch.py` imports `asm_batch.py` and `xwin.py` from the image's `/oracle`.

## What the oracle cannot show, and what it shows differently from Windows

- Wine is not Windows. GDI under Wine has no `Fixedsys` raster font: the default output font gets
  an 11 x 14 cell (grid 58 x 34 instead of 80 x 32). Programs that depend on the grid are therefore
  compared with the port running with the same cell (`WINE_CELLS` in
  `tests/conformance/sim/harness.ts`); Windows' cells are layer L5 (T2). Pixels of text and of
  diagonal lines and ellipses are Wine's, so the programs read back only colours of flat areas.
- Everything that needs a person: keys, the mouse, the Hardware window's buttons, Rewind, the
  file dialog of task 58, sound you can hear. The programs that settle the Windows-only questions
  are in `tests/conformance/windows-confirm/` (6.8).
- Timing: nothing that a program can observe of the clock is compared (task 8 only as a
  comparison, task 23 only as a delay).
- The C library is the Borland run-time linked into `SIM68K.exe`, so file buffering and the
  `fread`/`fwrite` edge cases are the original's; the file system below it is Wine's.

## Speed (this PC, one CPU per container, 6 containers, 2026-11-21)

Assembling one program takes about 15 s, a self-reporting run 10 to 40 s (the dump routines execute
tens of thousands of instructions), an Auto Trace 8 to 12 instructions per second (official-oracle.md
5.2 measured 61-72 without the CPU limit). The whole suite took 59 minutes, most of it the two
longest logs (`l24`, 18,183 instructions, and `l25`, 10,918); `regenerate.mjs` now deals the slowest
programs out first so that they run in parallel. `golden/manifest.json` has the time of every run.
