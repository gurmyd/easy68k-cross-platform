# N3 request: the model test of the safety net in a CI job of its own

Status: done (N0, second round of the gate of the stage of additions): items 1 and 2 as asked, the
job `history-model` with the two parts as `matrix.seeds` ({ first: 1, last: 1000 } and { first:
1001, last: 2000 }) so that its name says the range; item 3 needs nothing (no job lists `unit` in its
`needs`). `tests/lint/ci-workflow.test.ts` checks both parts and the 200 seeds of `npm test`. Asked
by N3, the history store; for the configuration engineer (`.github/workflows/ci.yml`). Nothing else
changes: the test file already takes the range of seeds from the environment.

## Why

P5 N3: the model test (`app/src/fs/history-model.test.ts`, seeds 1 to 2,000 against
`createHistoryService` and the same seeds against `createMemoryHistoryService`) runs in at most
5 minutes on ubuntu-latest. Inside `npm test` it does not: 419.8 s on ubuntu-latest in run
45020779731 and 530.4 s in run 45024648916 (windows-latest 603.3 s, macos-latest 685.5 s), because
its 4 processes share the runner with the five stress runs and every other test file.

Making the checker faster cannot close that gap. A profile of 80 seeds in one process (store mode,
this PC; `c:\easy64k\build\n3-plus\prof\worker-39104.cpuprofile`) puts 12.8 % of the time in the
checker of the seven properties (`checkHistoryInvariants`, all of it included), about 5 % in making
the test's file contents, and the rest in the system under test: the store and its plans,
fake-indexeddb (its transactions, structured clones and the `DataError` it throws for every record
without a `live` key), deflate of the contents (12.5 %), SHA-256 and the memory file system.
Removing the checker altogether would save at most an eighth. So the seeds have to be split over
runners that do not run the rest of the suite at the same time.

## What to change in `.github/workflows/ci.yml`

1. In the job `unit`, the step `Unit tests` runs 200 seeds of the model test instead of 2,000 (a
   quick pass; the full range runs in the new job):

   ```yaml
         - name: Unit tests
           run: npm test
           env:
             EASY68K_HISTORY_SEEDS: '200'
   ```

2. A new job, beside `unit`, that runs only the model test, seeds 1 to 2,000 in two parts of
   1,000 seeds, each on a runner of its own, in the test's own 4 processes:

   ```yaml
     history-model:
       name: history model (${{ matrix.os }}, seeds ${{ matrix.first }}+1000)
       needs: [plan]
       if: github.event_name != 'schedule'
       strategy:
         fail-fast: false
         matrix:
           os: [ubuntu-latest, windows-latest, macos-latest]
           first: [1, 1001]
       runs-on: ${{ matrix.os }}
       timeout-minutes: 20
       steps:
         - name: Check out
           uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
           with:
             persist-credentials: false
         - name: Set up Node
           uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
           with:
             node-version: '24'
             cache: npm
         - name: Install dependencies
           run: npm ci
         - name: Model test of the safety net (P3.3.1, P5 N3)
           working-directory: app
           run: npx vitest run src/fs/history-model.test.ts
           env:
             CI: '1'
             EASY68K_HISTORY_FIRST: ${{ matrix.first }}
             EASY68K_HISTORY_SEEDS: '1000'
             EASY68K_HISTORY_SHARDS: '4'
   ```

   It needs no engines (the history store does not use them) and no browser. The test prints
   `history model: 1000 seeds in 4 processes in <s> s`, which is the figure to read against
   P5 N3's 5 minutes (each part is half the seeds, so the limit holds for the whole range when each
   part takes at most 5 minutes on a runner of its own).

3. If the job is to be among the required checks, add `history-model` wherever `unit` is listed
   as needed (for example a summary job); nothing else depends on it.

## What N3 verified

- `EASY68K_HISTORY_FIRST=1001 EASY68K_HISTORY_SEEDS=1000 EASY68K_HISTORY_SHARDS=4 CI=1
  npx vitest run src/fs/history-model.test.ts` runs seeds 1,001 to 2,000 in four processes (the
  shards start at `EASY68K_HISTORY_FIRST`), and `EASY68K_HISTORY_SEEDS=200` in `npm test` runs
  seeds 1 to 200 in four processes. The figures measured on this PC are in N3's result of the
  second round.
