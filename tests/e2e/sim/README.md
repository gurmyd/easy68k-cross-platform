# Simulator and EASyBIN suites

Owner: X2. ARCHITECTURE.md 6.6 (`tests/e2e/sim/`), 9.6 X2. They follow the rules of
`tests/e2e/fixtures/README.md` (X1's harness): the production build, a fresh profile per test, no
console errors, everything through the interface, keys from the command tables on the host's key map,
no fixed pauses.

| File                  | Rows of 1.3                                                                       |
| --------------------- | --------------------------------------------------------------------------------- |
| `run.spec.ts`         | Run menu, Search menu, state machine, message area, Find, cycle counter           |
| `menus.spec.ts`       | menu bar, toolbar, View and Help, F1, the panel cycle, option check items         |
| `registers.spec.ts`   | the Registers panel and its editing rules                                         |
| `listing.spec.ts`     | the Listing panel, PC breakpoints, `*[sim68k]` directives                         |
| `memory.spec.ts`      | the Memory and Stack panels                                                       |
| `input.spec.ts`       | keyboard and mouse input of a running program, paste, task 24                     |
| `output.spec.ts`      | the Output panel: surface, sizes, wrap, fonts, full screen                        |
| `hardware.spec.ts`    | the Hardware panel                                                                |
| `breakpoints.spec.ts` | advanced breakpoints                                                              |
| `log.spec.ts`         | logging                                                                           |
| `files.spec.ts`       | files, task 58, sound, printer, serial and network in a browser                   |
| `startup.spec.ts`     | command line, Open / Open Data / Close, drop, Execute (4.7.1), windows, shut-down |
| `options.spec.ts`     | option dialogs, `sim68K.dat`, what is remembered, Exit                            |
| `easybin.spec.ts`     | EASyBIN mode (1.3.8 and easybin.md 21.4)                                          |
| `sim.ts`              | the helpers: assemble and Execute, registers, run state, listing, output          |

`tests/parity/matrix.json` names, for every row, the test that verifies it; its unit test fails when
a test here is named by no row.

## How the suites read the simulator

The production build has no page object, so the suites read what a user sees:

- **registers**: the twenty fields of the Registers panel. They show the CPU at a stop, not while a
  program runs (sim-ui §4.2): read them after the run state says `Stopped` or `Halted`.
- **run state**: the first cell of the status bar (`Stopped`, `Running`, `Halted`, `Waiting for
input`, `Waiting`, `Auto trace`).
- **listing**: the rows of the Listing panel, with `data-pc` and `data-bp`; a row is found by a
  regular expression when its text could also match a lower-case directive row (`hasText` with a
  string ignores case).
- **output**: the text mirror of the Output panel (the text shadow array, so the echo of typed input,
  which the original draws without storing, is not in it), and the canvas for pixels.

Programs are assembled by the real assembler from the start-up document (or a document of its own,
`newDocument`), saved under a name when the test needs files beside it, and started with Execute.
A test that reloads the page saves its program first, or the reload would offer it as a draft.

## Expected failures (findings)

A test of a feature that is wrong is kept and marked `test.fail(true, '<owner>: <defect>')` with the
evidence in a comment. When the owner repairs the feature, the test reports "expected to fail, but
passed": then delete the line. The findings are listed in `docs/porting/errata/X2.md`; both are
repaired, and no test is an expected failure now.
