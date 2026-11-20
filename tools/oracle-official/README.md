# Official EASy68K oracle (Wine in Docker)

Scripts that make the **official** EASy68K v5.16.1 Windows binaries (`EDIT68K.exe`,
`SIM68K.exe`) produce ground truth unattended, inside a Linux container with 32-bit
Wine, a virtual X display (Xvfb) and xdotool. Results, reliability caveats and
timings are in [`docs/porting/official-oracle.md`](../../docs/porting/official-oracle.md).

The binaries are **not** in this directory or in the image. They are mounted read-only
from `reference/official-extracted/` (unpacked from the official installer, see
`docs/porting/ground-truth.md`) and copied to a writable folder inside the container,
because both programs rewrite their settings file beside the EXE on exit.
Never run them on the Windows host.

## Layout

| Path | What |
|---|---|
| `Dockerfile` | Debian 12 + `wine32` (Wine 8.0) + Xvfb + xdotool + ImageMagick + Python 3; a 32-bit Wine prefix created at build time |
| `run-asm-corpus.sh` | Host: assemble the example corpus in N parallel containers, default and expansion options, merge manifests |
| `run-sim-proofs.sh` | Host: assemble `sim/tests/*.X68` with the official editor, then run both simulator recipes |
| `compare_cli.py` | Host: compare the official outputs with the v5.15.4 command-line port and classify every difference |
| `sim/dumplib.X68` | 68000 include file: self-report routines (`DMP_OPEN`, `DMP_REGS`, `DMP_MEM`, `DMP_TEXT`, `DMP_CLOSE`) |
| `sim/tests/` | Test programs: `t*` self-reporting, `l*` for execution logs |
| `scripts/entry.sh` | Container entry point: starts Xvfb on `:99`, then runs the command |
| `scripts/stage.sh` | Copies the official program folder (and optionally the corpus) to writable places |
| `scripts/xwin.py` | Window helpers: find windows by title, send keys, screenshots, kill Wine processes |
| `scripts/asm_batch.py` | Assembles a list of sources with EDIT68K and captures the text the assembler received |
| `scripts/richedit_check.py` | Expected-buffer model and the comparison used by `asm_batch.py` |
| `scripts/sim_run.py` | Runs one program in SIM68K: `selfreport` or `log` recipe |
| `scripts/asm_corpus.sh`, `scripts/sim_proofs.sh` | In-container drivers used by the two host scripts |
| `scripts/gen_richedit_stress.py` | Writes synthetic sources that stress the editor's RichEdit round trip |
| `scripts/merge_manifests.py` | Merges per-container manifests into `manifest.json` |

## Exact commands

All host commands are for Git Bash on Windows (Docker Desktop, linux/amd64 engine), run
from the repository root. `MSYS_NO_PATHCONV=1` is set inside the scripts; set it yourself
when you type `docker` commands with container paths in Git Bash. On macOS/Linux the same
scripts work (`cygpath` is simply not used).

Build the image (about 2 minutes, 2.4 GB):

```bash
docker build -t easy68k-oracle-official:dev tools/oracle-official
```

Assemble the whole corpus (`reference/examples`, 488 `.X68`), shipped default options and
expansion options (macros, structured, constants expanded), 8 containers in parallel
(about 19 minutes wall time on a 20-core machine):

```bash
bash tools/oracle-official/run-asm-corpus.sh 8
# re-run only some sources (their records in manifest.json are replaced):
ASM_TIMEOUT=3600 bash tools/oracle-official/run-asm-corpus.sh 2 build/ground-truth/retry-list.txt
```

Compare with the v5.15.4 command-line oracle (needs `build/oracle/asm-cli-5.15.4/bin/asy68k.exe`,
see `docs/porting/toolchain.md` section 4):

```bash
python tools/oracle-official/compare_cli.py --jobs 10
```

Simulator recipes on the test programs (about 6 minutes):

```bash
bash tools/oracle-official/run-sim-proofs.sh
```

Interactive use (one container, scripts mounted so edits take effect without a rebuild):

```bash
export MSYS_NO_PATHCONV=1
docker run -d --init --name oracle-dev \
  -v "$(cygpath -w reference/official-extracted):/mnt/official:ro" \
  -v "$(cygpath -w tools/oracle-official/scripts):/oracle:ro" \
  -v "$(cygpath -w build/ground-truth):/mnt/out" \
  easy68k-oracle-official:dev sleep infinity
docker exec oracle-dev /oracle/stage.sh
# put a program in /work/p, then:
docker exec -w /work/p oracle-dev bash -c 'ls prog.X68 > /tmp/l && python3 /oracle/asm_batch.py --corpus /work/p --list /tmp/l --out /mnt/out/mine'
docker exec -w /work/p oracle-dev python3 /oracle/sim_run.py selfreport prog.S68 --dump prog_dump.txt --out /mnt/out/mine
docker exec -w /work/p oracle-dev python3 /oracle/sim_run.py log prog.S68 --exec-log 2 --out-log 1 --drive autotrace --out /mnt/out/mine
docker rm -f oracle-dev
```

Always pass `--init` to `docker run` when the container lives for more than one command:
Wine leaves zombie processes that only an init process reaps.

## Simulator recipes in one paragraph each

**Self-report (recommended).** Include `sim/dumplib.X68` in the test program, call
`DMP_OPEN` / `DMP_REGS` / `DMP_MEM` / `DMP_TEXT` / `DMP_CLOSE`, end with `SIMHALT`.
`sim_run.py selfreport prog.S68 --dump name.txt [--args "/e /b"] [--exceptions 0|1]
[--bitfield 0|1] [--screenshot out.png]` starts `SIM68K.exe prog.S68 /r`, waits until the
file ends with `END-OF-DUMP`, optionally screenshots the output window, and kills the
simulator. About 1.3 s to the dump, 7 s per run including Wine start and clean-up.

**Execution log through the UI.** `sim_run.py log prog.S68 --exec-log 1|2|3 [--out-log 1]
--drive autotrace|step|run` writes `sim68K.dat` (log type bytes, auto-trace interval,
"disable display update"), starts without `/r`, applies the interval through
Options > Auto Trace Options... > OK, presses Ctrl+F4 (Log Start), then F10 (Auto Trace), F7
per instruction (Trace Into) or F9 (Run, text-output log only), presses Enter on
"Current Log Stopped." and exits with Alt+F4. Collects `<name>_RunLog.txt` and
`<name>_OutLog.txt`. Auto Trace reaches about 60-70 instructions per second, Trace Into about
5 per second.

## Outputs (git-ignored)

```
build/ground-truth/corpus-list.txt                    the 488 sources (corpus-relative)
build/ground-truth/asm/<default|expand>/manifest.json one record per source (see doc)
build/ground-truth/asm/<options>/<source path>/       <name>.L68, <name>.S68, <name>.received.txt
build/ground-truth/asm/<options>/_screenshots/        screen at every failure / stray window
build/ground-truth/cli-compare/<options>/report.json  official vs v5.15.4 CLI, classified
build/ground-truth/richedit-stress/default/           synthetic RichEdit stress results
build/ground-truth/sim/                               simulator proofs (asm/, selfreport/, log/, results.jsonl)
```

Nothing under `build/ground-truth` may be committed: it contains outputs derived from
`reference/examples/site`, which may not be redistributed.
