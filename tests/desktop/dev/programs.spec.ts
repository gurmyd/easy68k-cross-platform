// Programs opened from a granted folder of the real disk, in the running app (6.7; defect D1,
// docs/porting/errata/W1.md entry 15 and DV2.md entry D1). The desktop main process refuses to list
// anything above the granted roots, and every name looked up with Vfs.resolve on /disk must still
// be found, in any letter case, as on Windows:
//
//   - the program is opened from the command line (5.7), assembled with the toolbar and executed
//     from the status dialog, as a student does it; its source INCLUDEs two files named in another
//     letter case, one in a sub-folder and one through `..` in a sibling folder of a granted parent;
//   - the listing (prog.L68, 4.7) is shown, not the "A matching .L68 file was not found" text, with
//     the PC's row marked; the message area has no "Unable to open .L68 file.";
//   - Run: the program reads a data file it names in another letter case and shows its text and the
//     texts of both included files;
//   - the other callers of Vfs.resolve on /disk: a name in another case, the assembler's INCLUDE
//     collection, and the Files panel's rename (a change of letter case only keeps the file; a name
//     that is taken is refused).
//
// The steps use the toolbar and the dialogs through the functions DV5's packaged checks use
// (../packaged/programs/scenario.ts), so the development suite, which the CI job desktop-dev runs on
// a Mac on every push, sees what the packaged checks see long before a release build.
//
// Owner: DV2 (written in the repair of D1).

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { vpathOfRealPath } from '../../../desktop/src/security';
import {
  assembleActive,
  executeFromStatus,
  messageLines,
  outputRows,
  poll,
  runToHalt,
  waitForEditorDocument,
} from '../packaged/programs/scenario';
import {
  enginesAvailable,
  launchDesktop,
  mainHook,
  removeQuietly,
  startDevServer,
  warmUpDevPage,
  type Desktop,
  type DevServer,
} from './harness';

const crlf = (lines: string[]) => `${lines.join('\r\n')}\r\n`;

/** The source: a data file and two INCLUDEs, each named in another letter case than stored. */
const PROGRAM = crlf([
  '* D1: a data file and two INCLUDEs named in another letter case than on disk',
  '        ORG     $1000',
  'START   LEA     FNAME,A1',
  '        MOVE.B  #51,D0          open DATA.TXT (stored as data.txt)',
  '        TRAP    #15',
  '        MOVE.L  D1,D7',
  '        LEA     BUF,A1',
  '        MOVE.L  #31,D2',
  '        MOVE.B  #53,D0          read',
  '        TRAP    #15',
  '        LEA     BUF,A0',
  '        CLR.B   0(A0,D2.L)',
  '        LEA     BUF,A1',
  '        MOVE.B  #13,D0',
  '        TRAP    #15',
  '        MOVE.L  D7,D1',
  '        MOVE.B  #56,D0          close',
  '        TRAP    #15',
  '        LEA     INCMSG,A1',
  '        MOVE.B  #13,D0',
  '        TRAP    #15',
  '        LEA     LIBMSG,A1',
  '        MOVE.B  #13,D0',
  '        TRAP    #15',
  '        SIMHALT',
  "FNAME   DC.B    'DATA.TXT',0",
  '        INCLUDE ..\\COMMON\\Defs.INC',
  '        INCLUDE LIB\\Msg.Inc',
  'BUF     DS.B    32',
  '        END     START',
]);
const DATA = 'Data file read';
const DEFS = crlf(["INCMSG  DC.B    'Included from common/defs.inc',0"]);
const MSG = crlf(["LIBMSG  DC.B    'Included from lib/msg.inc',0"]);
const NOT_FOUND = 'A matching .L68 file was not found';

let server: DevServer;
let desktop: Desktop;
// realpath: on macOS the temporary folder is a link (/var -> /private/var); the app names the real path.
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'easy68k-programs-e2e-')));
const course = join(scratch, 'Course');
const lab = join(course, 'lab1');
const program = join(lab, 'prog.X68');
const labPath = vpathOfRealPath(lab) as string;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  if (!enginesAvailable()) return;
  mkdirSync(join(lab, 'lib'), { recursive: true });
  mkdirSync(join(course, 'common'));
  writeFileSync(program, PROGRAM, 'latin1');
  writeFileSync(join(lab, 'data.txt'), DATA, 'latin1');
  writeFileSync(join(lab, 'lib', 'msg.inc'), MSG, 'latin1');
  writeFileSync(join(course, 'common', 'defs.inc'), DEFS, 'latin1');
  server = await startDevServer();
  // The command line of 5.7: Editor mode opens the file, and its folder becomes a granted root.
  desktop = await launchDesktop({ devServer: server, args: [program] });
  await warmUpDevPage(desktop.page);
  // The course folder, as if the person had chosen it in the folder dialog: `..\COMMON` is inside it.
  await mainHook(desktop.app, 'grant', course);
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  await desktop?.close();
  await server?.close();
  removeQuietly(scratch);
});

test.describe('a program opened from a granted folder of the disk', () => {
  test.describe.configure({ mode: 'serial' });

  test('assembles with both INCLUDEs found; Execute shows its listing with the PC row marked', async () => {
    test.skip(!enginesAvailable(), 'engine/dist is missing (npm run build:engines or fetch:engines)');
    test.setTimeout(300_000);
    const { page } = desktop;
    console.log(`program folder: ${labPath}`);
    console.log(`granted roots: ${JSON.stringify(await mainHook<string[]>(desktop.app, 'roots'))}`);
    console.log(`editor status bar: ${JSON.stringify(await waitForEditorDocument(page, 'prog.X68'))}`);
    const status = await assembleActive(page);
    console.log(`assembler status dialog: ${JSON.stringify(status)}`);
    expect(status, 'the status dialog: both INCLUDEs found').toMatchObject({
      errors: '0',
      warnings: '0',
      executeEnabled: true,
    });
    const listingFile = readFileSync(join(lab, 'prog.L68'), 'latin1');
    expect(listingFile).toContain('Included from common/defs.inc');
    expect(listingFile).toContain('Included from lib/msg.inc');

    await executeFromStatus(page, 0x1000);
    const rows = page.locator('.e68-listing__row');
    await expect(rows.first()).toBeAttached({ timeout: 30_000 });
    const first = (await rows.first().innerText()).trim();
    console.log(`first listing row: ${JSON.stringify(first)}`);
    expect(first.startsWith(NOT_FOUND), 'the listing, not the "not found" text').toBe(false);
    const pcRow = page.locator('.e68-listing__row[data-pc="true"]');
    await expect(pcRow, 'the PC row is marked').toHaveCount(1, { timeout: 30_000 });
    const marked = await pcRow.innerText();
    console.log(`marked row: ${JSON.stringify(marked)}`);
    expect(marked).toMatch(/00001000\s.*START\s+LEA\s+FNAME,A1/);
    const messages = await messageLines(page);
    console.log(`message area after Execute: ${JSON.stringify(messages)}`);
    expect(messages.lines).not.toContain('Unable to open .L68 file.');
  });

  test('Run: the data file named in another letter case is read, and the included texts are shown', async () => {
    test.skip(!enginesAvailable(), 'engine/dist is missing (npm run build:engines or fetch:engines)');
    test.setTimeout(300_000);
    const { page } = desktop;
    const state = await runToHalt(page);
    // The Output panel shows the text screen once per display frame, which a hidden window on a
    // loaded machine may deliver late: wait for the rows (the last rows seen are printed).
    const want = [DATA, 'Included from common/defs.inc', 'Included from lib/msg.inc'];
    let rows: string[] = [];
    await poll(
      30_000,
      async () => {
        rows = await outputRows(page);
        return JSON.stringify(rows) === JSON.stringify(want) ? rows : null;
      },
      250,
    );
    const messages = await messageLines(page);
    console.log(`run state: ${state}; output rows: ${JSON.stringify(rows)}`);
    console.log(`message area after Run: ${JSON.stringify(messages)}`);
    expect(state).toBe('Halted');
    expect(rows).toEqual(want);
    expect(messages.lines).not.toContain('Unable to open .L68 file.');
    expect(desktop.errors, 'console errors of the page').toEqual([]);
  });
});

test('the other callers of Vfs.resolve find names on /disk in any letter case', async () => {
  test.skip(!enginesAvailable(), 'engine/dist is missing (npm run build:engines or fetch:engines)');
  test.setTimeout(180_000);
  writeFileSync(join(lab, 'case.txt'), 'keep me', 'latin1');
  writeFileSync(join(lab, 'other.txt'), 'other', 'latin1');
  const result = await desktop.page.evaluate(async (dir: string) => {
    const { ctx } = window.__easy68k;
    const { collectFiles } = await import(String('/src/features/assemble/collect.ts'));
    const { renameEntry } = await import(String('/src/features/files/store.ts'));
    const main = `${dir}/prog.X68`;
    const collected = await collectFiles(ctx.vfs, main, await ctx.vfs.readFile(main));
    const outcome = async (run: () => Promise<unknown>) => {
      try {
        return `ok ${String(await run())}`;
      } catch (error) {
        return `error ${(error as Error).message}`;
      }
    };
    return {
      // The source, not the listing: this test must not depend on the assembly of the first one.
      source: await ctx.vfs.resolve(dir, 'PROG.x68'),
      data: await ctx.vfs.resolve(dir, 'Data.Txt'),
      include: await ctx.vfs.resolve(dir, '..\\COMMON\\Defs.INC'),
      missing: await ctx.vfs.resolve(dir, 'missing.L68'),
      above: await ctx.vfs.resolve(dir, '..\\..'),
      includes: collected.includes,
      caseOnly: await outcome(() => renameEntry(ctx.vfs, `${dir}/case.txt`, 'CASE.TXT')),
      taken: await outcome(() => renameEntry(ctx.vfs, `${dir}/other.txt`, 'Case.Txt')),
    };
  }, labPath);
  console.log(`resolve on /disk: ${JSON.stringify(result)}`);
  const coursePath = vpathOfRealPath(course) as string;
  expect(result.source).toBe(`${labPath}/prog.X68`);
  expect(result.data).toBe(`${labPath}/data.txt`);
  expect(result.include).toBe(`${coursePath}/common/defs.inc`);
  expect(result.missing).toBeNull();
  // The folder above the course folder is not granted: refused, so not found.
  expect(result.above).toBeNull();
  expect(result.includes).toEqual([`${coursePath}/common/defs.inc`, `${labPath}/lib/msg.inc`]);
  expect(result.caseOnly).toBe(`ok ${labPath}/CASE.TXT`);
  expect(result.taken).toBe('error "Case.Txt" already exists.');
  const names = readdirSync(lab);
  console.log(`program folder after the renames: ${JSON.stringify(names.sort())}`);
  expect(names).toContain('CASE.TXT');
  expect(names).not.toContain('case.txt');
  expect(readFileSync(join(lab, 'CASE.TXT'), 'latin1')).toBe('keep me');
  expect(readFileSync(join(lab, 'other.txt'), 'latin1')).toBe('other');
});
