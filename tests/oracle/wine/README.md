# The official EASy68K under Wine (oracle)

Scripts that make the **official** EASy68K v5.16.1 Windows programs (`EDIT68K.exe`, `SIM68K.exe`)
produce ground truth unattended, inside a Linux container with 32-bit Wine, a virtual X display
(Xvfb) and xdotool. This is layer L2 (assembler) and L4 (simulator) of the test strategy
(`docs/ARCHITECTURE.md` 6.1, 6.2.2). How well it works, what it cannot do and how long it takes is
measured in [`docs/porting/official-oracle.md`](../../../docs/porting/official-oracle.md).

The official programs are **not** in this folder, not in the repository and not in the Docker
image. They are unpacked into `reference/official-extracted/` (git-ignored), mounted read-only into
the container and copied to a writable folder there, because both programs rewrite their settings
file beside the EXE when they exit. They never run on the host.

## From nothing to goldens

Needs Docker (a linux/amd64 engine) and Node 24. Run from the repository root.

```sh
node tests/oracle/wine/common/fetch-official.mjs   # official distribution -> reference/official-extracted (once)
npm run oracle:wine:build                           # docker build -t easy68k-oracle-wine tests/oracle/wine (3 minutes)
npm run oracle:wine:asm                             # the tracked corpus through EDIT68K.exe (about 15 minutes)
npm run test:conformance                            # the WebAssembly assembler against the results
```

`fetch-official.mjs` downloads `http://www.easy68k.com/files/EASy68K.zip`, checks its SHA-256
(`docs/porting/ground-truth.md` section 2) and unpacks it; the oracle refuses to run with programs
that do not have the SHA-256 of v5.16.1.

`npm run oracle:wine:asm` is `asm/regenerate.mjs`. It assembles every program of the tracked sets
(`tests/corpus/official`, `tests/corpus/github`, the conformance programs of
`tests/conformance/asm`) with every option set the program has, and then rewrites

- `tests/conformance/asm/golden/<program id>/<option label>.L68` and `.S68` (a file is replaced
  only when it changed in more than its date line),
- `tests/corpus/manifest.json` (hashes, counts and status of every run),
- `tests/conformance/asm/golden/REPORT.md` (every run without a result, and why).

Useful variants (`node tests/oracle/wine/asm/regenerate.mjs --help` is the comment at its top):

```sh
node tests/oracle/wine/asm/regenerate.mjs --only official/ --containers 2   # some programs
node tools/fetch-site-examples.mjs                                           # the site set (not redistributable)
node tests/oracle/wine/asm/regenerate.mjs --sets site                        # ... its results: hashes in the manifest, files in build/golden-local/
node tests/oracle/wine/asm/regenerate.mjs --sets site --check                # change nothing, exit 1 on a difference
bash tests/oracle/wine/asm/run.sh my/prog.X68 [settings.dat] [out-dir]       # one file of your own
```

A run refuses to start when the image was built from other scripts than the ones in the working
tree (rebuild it), and it removes its containers when it is interrupted. Work files are in
`build/oracle-wine/asm/<run>/`: the job list, one log per container, the raw outputs and a
screenshot of every failure.

## Layout

| Path                                    | What                                                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`                            | Debian 12 + `wine32` (Wine 8.0) + Xvfb + xdotool + ImageMagick + Python 3; a 32-bit Wine prefix created at build time; the scripts below copied into one flat folder, `/oracle` |
| `common/entry.sh`                       | Container entry point: starts Xvfb on `:99`, then runs the command                                                                                                              |
| `common/stage.sh`                       | Copies the official program folder (and the sources) to writable places inside the container                                                                                    |
| `common/xwin.py`                        | Window helpers: find windows by title, send keys, screenshots, kill Wine processes                                                                                              |
| `common/docker.mjs`                     | Host side: checks the official folder and the image, starts and removes containers                                                                                              |
| `common/fetch-official.mjs`             | Host side: downloads and unpacks the official distribution                                                                                                                      |
| `common/unzip.ts`, `common/make-zip.ts` | A zip reader for the downloads (and a zip writer for its tests)                                                                                                                 |
| `asm/regenerate.mjs`                    | Host side: `npm run oracle:wine:asm` (plan, containers, manifest, goldens, report)                                                                                              |
| `asm/run.sh`                            | Host side: one file through `EDIT68K.exe` (calls `regenerate.mjs --file`)                                                                                                       |
| `asm/settings.ts`                       | Builds the `settings.dat` that selects the assembler options of a run                                                                                                           |
| `asm/asm_batch.py`                      | In the container: drives `EDIT68K.exe` (F9, Alt+C, Alt+F4) and captures the text the assembler received                                                                         |
| `asm/asm_corpus.sh`                     | In the container: stages the files and runs one shard of a job list                                                                                                             |
| `asm/richedit_check.py`                 | The model of the text the editor hands to its assembler, used by `asm_batch.py`                                                                                                 |
| `asm/gen_richedit_stress.py`            | Wrote `tests/conformance/asm/richedit/*.X68`, sources that stress the editor's RichEdit round trip                                                                              |
| `asm/merge_manifests.py`                | Merges per-container manifests (used by the simulator proofs)                                                                                                                   |
| `sim/`                                  | The simulator driver. Owned by work package T3; see `sim/README.md`                                                                                                             |

Tests of the host-side code are next to it (`*.test.ts`, `*.test.mjs`) and run with
`npm run test:conformance`; they need neither Docker nor the official programs.

## How one program is assembled

`asm_batch.py`, per source (details and measurements: official-oracle §3.1):

1. write `settings.dat` (the options of the run) beside the copied `EDIT68K.exe`;
2. create an empty `EASy68Ks.tmp` beside the source and a hard link to it elsewhere: the editor
   saves its buffer to that file before assembling and deletes it afterwards, and the link keeps
   exactly the bytes the assembler read;
3. start `wine EDIT68K.exe Z:\...\prog.X68` in the source's folder, wait for the editor window;
4. F9; wait for `Assembler Status`; **Alt+C** (Close) - never Enter, which would press Execute;
5. Alt+F4, answer `n` to a save prompt, wait for the process, kill it if it stays;
6. collect `prog.L68`, `prog.S68` and the captured text.

Any window that is not expected is screenshot, dismissed and recorded; a crash of the official
program is recorded with the Wine error line. Known limits (official-oracle §3.2, §3.4): a source
above about 1 MB takes more than an hour to load and is not tried unless `--large` is given; the
official program crashes on a macro that calls itself without end and on a macro line that expands
beyond 255 characters, and it shows an access-violation box for a 4,000-character line.

## Interactive use

```sh
docker run -d --init --name oracle-dev \
  --mount type=bind,source="$PWD/reference/official-extracted",target=/mnt/official,readonly \
  --mount type=bind,source="$PWD/build/oracle-wine/dev",target=/mnt/out \
  easy68k-oracle-wine sleep infinity
docker exec oracle-dev /oracle/stage.sh
# put a program in /work/p inside the container, then:
docker exec -w /work/p oracle-dev bash -c 'ls prog.X68 > /tmp/l && python3 /oracle/asm_batch.py --corpus /work/p --list /tmp/l --out /mnt/out/mine'
docker rm -f oracle-dev
```

In Git Bash on Windows set `MSYS_NO_PATHCONV=1` first and give Windows paths (`cygpath -w`) as
mount sources. Always pass `--init` when a container lives for more than one command: Wine leaves
zombie processes that only an init process reaps.
