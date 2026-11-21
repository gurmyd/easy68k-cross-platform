# Request of T4: native twins and the single-step suite in CI

Status: applied in gate I1 round 1, with one difference: the cache is split into `actions/cache/restore`, a step `node tests/conformance/cpu/fetch-suite.mjs --quiet` and `actions/cache/save` (when the restore missed and the fetch succeeded), so that the suite is saved even when another step of `windows-oracles` fails (actions/cache saves only on a green job). The report upload is as asked. Each oracle step now runs even when an earlier one failed. Optional item (EASY68K_SINGLESTEP in `conformance`) declined: it repeats on two more systems what `windows-oracles` checks, at 200 MB of download per system. Gate I1 round 2: `.github/workflows/oracle.yml` (step "Restore the single-step data") uses the same key, `singlestep-${{ hashFiles('tests/conformance/cpu/suite.json') }}` in place of `hashFiles('tests/conformance/cpu/**')`, so that both workflows share one cache entry and a change of another T4 file does not download the suite again (committed in c4d3dfa; it was missing from the configuration engineer's round-2 report).

## What already works without a change

`.github/workflows/ci.yml` has had the step "Native twins (T4)" in the job `windows-oracles` since
wave 0, guarded by `tests/oracle/native-twin/run.mjs`. That file now exists, so on every push the
job runs `npm run oracle:twins` on `windows-latest`, which:

1. builds with MSVC (32-bit x86; `vswhere` finds the runner's Visual Studio, any version) the
   simulator twin at `/O2` and `/Od` and the four assembler twins (patched and unpatched sources,
   `/O2` and `/Od`); the unpatched assembler sources are fetched from the author's GitHub
   repository at a pinned commit and checked against their SHA-256, because `reference/` is not in
   the checkout;
2. because `CI=true`: builds the assembler engine's own twins (`engine/asm/native/build.mjs`) and
   runs `node --test engine/asm/test/native.test.mjs` (its unpatched half is skipped, see
   docs/porting/errata/T4.md, item 5);
3. compares every twin with `engine/dist` on the engine's test programs, on every `.X68` under
   `tests/` and on the simulator scripts;
4. because `CI=true`: downloads the 68000 single-step suite (about 200 MB, 124 files, checked
   against `tests/conformance/cpu/suite.json`) into `build/singlestep/`, runs it through the wasm
   simulator and both simulator twins, and checks the frozen baseline
   `tests/conformance/cpu/baseline.json`;
5. writes `build/native-twin/report.md` and appends it to the job summary; exit code 1 on any
   difference.

## What is requested

Two additions to the job `windows-oracles`, both for the T4 step only:

1. **Cache the single-step suite**, so that each run does not download 200 MB from
   raw.githubusercontent.com (rate limits; time). Insert before the step "Native twins (T4)":

   ```yaml
      - name: Restore the 68000 single-step suite (T4)
        if: needs.plan.outputs.twins == 'true'
        uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
        with:
          path: build/singlestep
          key: singlestep-${{ hashFiles('tests/conformance/cpu/suite.json') }}
   ```

   (`fetch-suite.mjs` verifies every cached file again and downloads only what is missing or
   wrong, so a stale or partial cache cannot pass.)

2. **Keep the report and the transcripts of a failure.** Insert after the step "Native twins (T4)":

   ```yaml
      - name: Upload the native-twin report (T4)
        if: always() && needs.plan.outputs.twins == 'true'
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: native-twin-report
          path: |
            build/native-twin/report.md
            build/native-twin/work/sim/runs/
          if-no-files-found: ignore
          retention-days: 14
   ```

   (`build/native-twin/work/sim/runs/` holds only the transcripts of scripts that differed; on
   success it is empty.)

Time: measured locally (see the T4 result) the CI-equivalent run takes about 15 to 20 minutes on a
loaded 16-thread PC; the job's limit of 90 minutes is shared with the GDI capture and the
command-line assembler oracle. If that becomes tight, the single-step part can move to its own
step with `node tests/conformance/cpu/run-catalogue.mjs` (wasm only, about 4 minutes) and
`run.mjs --no-singlestep`.

No new dependency, no install script, no root script.

## Optional

`EASY68K_SINGLESTEP=1` in the job `conformance` together with the same cache step would also run
`tests/conformance/cpu/baseline.test.mjs` on Linux and macOS (about 4 minutes; it needs the suite,
which that job would then fetch with `node tests/conformance/cpu/fetch-suite.mjs --quiet`). This
adds nothing the Windows job does not already check except "the same on another OS".
