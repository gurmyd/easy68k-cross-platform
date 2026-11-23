# N3 requests: two optional members of `HistoryService`, and the model test in CI

Status: item 1 done at the gate (the contract has both members; N4 reads them without a cast);
item 2 no change (the unit job runs the file as it is; a separate step only if the job grows too
slow); item 3 done at the gate (`TEST_ONLY_FILE_PACKAGES` in `eslint.config.js` with its cases in
`tests/lint/import-rules.test.ts`; the directive in `fs/history-memory.ts` is gone) (N3, the
history store).

## 1. For the contracts engineer: `unreadable?()` and `unavailableDetail?()`

P3.3.7 gives two texts the History and Trash dialogs (N4) show:

- `<n> entries could not be read.` above the list, where `<n>` is the number of records that did not
  parse;
- `The history cannot be read (<detail>). Your files are not affected.` when the history is
  unavailable.

`HistoryService` (P4.4, `app/src/contracts/history.ts`) has no member that gives `<n>` or
`<detail>`. The store has both. Suggested addition, optional so that nothing else changes:

```ts
  /** Records that did not parse, skipped and counted (P3.3.7). */
  unreadable?(): number;
  /** Why the history is unavailable in this window, for P3.3.7's `<detail>`; null when it is not. */
  unavailableDetail?(): string | null;
```

`fs/history-db.ts` implements both today (on the object `createHistoryService` returns), so N4 can
use them as soon as the contract has them; until then N4 can only show the texts without the
number and the detail, or read them with a cast.

## 2. For the configuration engineer: the model test's processes

`app/src/fs/history-model.test.ts` runs seeds 1 to 2,000 when `CI` is set, split over 4 child
processes (`EASY68K_HISTORY_SHARDS`, default 4 in CI) that each run the same file on a range of
seeds. Nothing needs to change in the configuration for that; but the unit-test job will have four
more busy processes for some minutes while this file runs. If that slows the job too much, a
separate CI step running only this file (`npx vitest run src/fs/history-model.test.ts` from `app/`,
with `CI=1`) and `EASY68K_HISTORY_SEEDS=200` for the main `npm test` would keep the full run
without slowing the rest.

Gate round, measured by CI (run 45020779731, snapshot 6c97dfb, the unit jobs' logs): inside
`npm test`, where the model test's 4 processes share the runner with the stress runs and every other
test file, the full model test took **419.8 s on ubuntu-latest** (P5 N3 asks for at most 5 minutes),
341.5 s on windows-latest and 718.5 s on macos-latest; the five stress runs together took 471.6 s on
ubuntu-latest (limit 10 minutes: met), 409.1 s on windows-latest and 755.2 s on macos-latest. The
ubuntu figure for the model test is over its limit only because it shares four vCPUs with the rest
of the suite; the separate CI step of this item (the model test alone, `CI=1`, after `npm test`,
which then runs it with `EASY68K_HISTORY_SEEDS=200`) is what lets the figure be read against the
limit. The same holds for `src/core/history/stress.test.ts`.

## 3. Still open from N0: `fake-indexeddb` in `fs/history-memory.ts`

`docs/requests/N0.md` section 7 item 1. N3 imports it with an `eslint-disable-next-line
easy68k/layer-imports` and its reason (errata N3); the allowance in `eslint.config.js` would let the
directive go.
