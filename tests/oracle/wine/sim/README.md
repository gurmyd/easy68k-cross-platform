# Simulator driver of the Wine oracle

The scripts that run the official `SIM68K.exe` v5.16.1 under Wine: self-reporting programs started
with `/r`, and execution logs made through the user interface. What they do and how well it works is
in [`docs/porting/official-oracle.md`](../../../../docs/porting/official-oracle.md) section 5.

**Owner: work package T3** (`docs/ARCHITECTURE.md` section 8, 9.4). Work package T1 moved these
files here from `tools/oracle-official/` **unchanged** when it gave the oracle its final layout;
T3 takes them over in wave two, turns them into `run-report.sh`, `run-log.sh` and
`regenerate.mjs` (6.2.2, `npm run oracle:wine:sim`) and replaces this text.

| File                | What                                                                                                          | State after the move                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sim_run.py`        | In the container: runs one program in SIM68K, recipe `selfreport` or `log`                                    | works: the image copies it to `/oracle/sim_run.py`                                                                                                           |
| `sim_proofs.sh`     | In the container: assembles `tests/*.X68` with the official editor and runs both recipes on them              | works: the image copies it to `/oracle/sim_proofs.sh`                                                                                                        |
| `dumplib.X68`       | 68000 include file with the self-report routines (`DMP_OPEN`, `DMP_REGS`, `DMP_MEM`, `DMP_TEXT`, `DMP_CLOSE`) | unchanged                                                                                                                                                    |
| `tests/`            | Test programs: `t*` self-reporting, `l*` for execution logs                                                   | unchanged                                                                                                                                                    |
| `run-sim-proofs.sh` | Host side: starts the container for `sim_proofs.sh`                                                           | **does not run as it is**: it still names the image `easy68k-oracle-official:dev` and the folders `scripts/` and `sim/` beside itself, which no longer exist |

What T3 needs to know:

- The image is `easy68k-oracle-wine` (`npm run oracle:wine:build`). Its `/oracle` folder is flat and
  holds the common helpers (`entry.sh`, `stage.sh`, `xwin.py`), the assembler driver
  (`asm_batch.py`, `merge_manifests.py`, ...) and the two simulator scripts above, so the scripts
  find each other as before. The `Dockerfile` (owned by T1) names the files it copies from `sim/`:
  a script that T3 adds or renames needs one more name on that `COPY` line.
- Until `run-sim-proofs.sh` is rewritten, the proofs run with the image's own scripts like this
  (from the repository root; in Git Bash set `MSYS_NO_PATHCONV=1` and use `cygpath -w` paths):

  ```sh
  mkdir -p build/oracle-wine/sim
  docker run --rm --init \
    --mount type=bind,source="$PWD/reference/official-extracted",target=/mnt/official,readonly \
    --mount type=bind,source="$PWD/tests/oracle/wine/sim",target=/mnt/sim,readonly \
    --mount type=bind,source="$PWD/build/oracle-wine",target=/mnt/out \
    easy68k-oracle-wine /oracle/sim_proofs.sh
  ```

- `../common/docker.mjs` has what a `regenerate.mjs` for the simulator needs on the host: the check
  of the official folder, the check that the image was built from the scripts of the working tree,
  bind mounts that work on Windows, and containers that are removed when the run is interrupted.
  `../asm/regenerate.mjs` shows its use.
- `../asm/regenerate.mjs --file prog.X68` (or `../asm/run.sh`) assembles a test program with the
  official editor when a `.S68` made by the official assembler is wanted.
