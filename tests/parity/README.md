# Parity matrix

Owner: X2. ARCHITECTURE.md 6.6 and 6.9 item 5.

`matrix.json` lists every row of the parity tables of ARCHITECTURE.md 1.3 (1.3.1 to 1.3.8; 1.3.8
holds the rows of `docs/porting/easybin.md` 21.4) and of the table of added commands in 1.5
(section `1.5`), each with what verifies it:

```json
{
  "section": "1.3.4",
  "original": "Run > `&Run`",
  "id": "`sim.run.run`",
  "status": "=",
  "verifiedBy": [
    { "kind": "web-e2e", "file": "tests/e2e/sim/run.spec.ts", "test": "Run to SIMHALT: ..." },
    { "kind": "manual", "item": "Browser shortcut table" }
  ]
}
```

`section` and `original` are copied from the document (the first cell of the row, exactly). The first
entry of `verifiedBy` is the row's kind; further entries add evidence.

| `kind`          | Names                                                                                | Runs                                       |
| --------------- | ------------------------------------------------------------------------------------ | ------------------------------------------ |
| `web-e2e`       | `file` under `tests/e2e/` and the `test` title as written in the source              | every push, Chromium and WebKit, three OSs |
| `desktop-e2e`   | `file` under `tests/desktop/` and the `test` title                                   | the desktop jobs                           |
| `unit`          | a unit or conformance test `file` (with an optional `test`), or a conformance folder | every push                                 |
| `manual`        | `item`: words of an item of ARCHITECTURE.md 6.8 (`docs/MANUAL-TEST-MAC.md`)          | before each release                        |
| `browser-check` | a `check-<name>.mjs` script (never a row's first entry; errata X2 entry 2)           | every push, the browser-checks job         |

A test title written with a template literal (one test per menu, for example) is named as the source
writes it: `${title}: the original's items in order, ...`.

## The unit test

`npx vitest run --config tests/parity/vitest.config.ts` (also part of `npm run test:conformance`).
It fails when

- a row of the documents is missing from the matrix, appears twice, or the matrix has a row the
  documents do not have (a row whose text changed in the document counts as both);
- a row has no verification, or its first entry is a `browser-check`;
- an entry names a file that does not exist, a file where its kind does not live, a test title that
  the file does not have, or a manual item that 6.8 does not contain;
- a test of `tests/e2e/sim` is named by no row (every simulator test is accounted for);
- a simulator or EASyBIN row (1.3.4 to 1.3.8) is not verified first by a `web-e2e` test with a
  title (a rule of `checkMatrix` itself, so every user of the function gets it).

Every problem is printed with its row, so a failure can be read from the CI log alone.

## Keeping it up to date

- A `web-e2e` entry names a test that runs in Chromium and in WebKit on all three systems (6.9 item 5:
  every such entry passes in both). A test that skips itself somewhere (the system clipboard, which
  Playwright grants in Chromium alone; a test of the host's key map only) is not an entry: the row
  names tests that run everywhere and mentions the other one in its `note` (errata X2 entry 11). The
  unit test cannot see skips; `tests/integration/rc/item-05-parity.mjs --web <browser>=<log>` reads
  them from the CI logs of the e2e jobs.
- A test renamed or moved: change the entries that name it (the unit test says which).
- A row added to 1.3 or to the added commands of 1.5: add it here with its verification.
- A finding (a test that is an expected failure because the feature is wrong) keeps its entry and
  says so in the row's `note`; when the owner repairs it, the test reports "expected to fail, but
  passed": delete its `test.fail` line and the note.
