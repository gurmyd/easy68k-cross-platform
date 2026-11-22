// What a running program does with files, sound, the printer, serial ports and the network in a
// browser (ARCHITECTURE.md 1.3.6 rows "Sound (two players), files, file dialog (task 58), printer
// (task 10)" and "Serial ports (tasks 40-43), network (tasks 100-107)"; 1.4 notes 2, 37, 46; 3.7,
// 3.8.4; trap15-a §7, tasks 10, 40, 50-59; trap15-b §11, §12). Owner: X2.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type App } from '../fixtures';
import { execute, expectOutputLine, expectReg, expectState, program, reg, switchMode, tool } from './sim';

const here = dirname(fileURLToPath(import.meta.url));
/** A sound of the official examples (GPL, shipped with the port and in the test corpus). */
const TICK = readFileSync(join(here, '..', '..', 'corpus', 'official', 'tick.wav'));

/** Imports files into My Programs from Editor mode, where the Files panel is. */
async function importInto(app: App, files: { name: string; data: string | Uint8Array }[]): Promise<void> {
  if ((await app.mode()) !== 'editor') await switchMode(app, 'Editor');
  await app.importFiles(files);
}

test('tasks 50-59: a new file is written and read back; names match in any case (note 46); task 59 misses', async ({
  app,
}) => {
  await importInto(app, [{ name: 'data.txt', data: 'xyz' }]);
  await execute(
    app,
    program(
      '    MOVE.B  #50,D0',
      '    TRAP    #15',
      '    LEA     NAME,A1',
      '    MOVE.B  #52,D0',
      '    TRAP    #15',
      '    MOVE.L  D1,D4',
      '    MOVE.W  D0,D5',
      '    LEA     DATA,A1',
      '    MOVE.L  #5,D2',
      '    MOVE.B  #54,D0',
      '    TRAP    #15',
      '    MOVE.L  D4,D1',
      '    MOVE.B  #56,D0',
      '    TRAP    #15',
      '    LEA     NAME,A1',
      '    MOVE.B  #51,D0',
      '    TRAP    #15',
      '    MOVE.L  D1,D4',
      '    LEA     BUF,A1',
      '    MOVE.L  #10,D2',
      '    MOVE.B  #53,D0',
      '    TRAP    #15',
      '    MOVE.L  D2,D6',
      '    MOVE.L  D4,D1',
      '    MOVE.B  #56,D0',
      '    TRAP    #15',
      '    LEA     OTHER,A1',
      '    MOVE.B  #51,D0',
      '    TRAP    #15',
      '    MOVE.L  D1,D4',
      '    LEA     BUF,A1',
      '    MOVE.L  #10,D2',
      '    MOVE.B  #53,D0',
      '    TRAP    #15',
      '    MOVE.L  D2,D3',
      '    MOVE.B  #50,D0',
      '    TRAP    #15',
      '    LEA     MISSING,A1',
      '    MOVE.B  #59,D0',
      '    TRAP    #15',
      '    MOVE.W  D0,D7',
      '    SIMHALT',
      "NAME DC.B   'Out.TXT',0",
      "OTHER DC.B  'DATA.TXT',0",
      "MISSING DC.B 'nothere.txt',0",
      "DATA DC.B   'ABC',13,10",
      'BUF DS.B    16',
    ),
    'fileio.X68',
  );
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expectReg(app, 'D5', '00000000', 'task 52 succeeded');
  await expectReg(app, 'D6', '00000005', 'task 53 read the 5 bytes written');
  await expectReg(app, 'D3', '00000003', 'DATA.TXT opened data.txt');
  expect((await reg(app, 'D7')).slice(4), 'task 59 on a missing file').toBe('0002');
  await switchMode(app, 'Editor');
  // Written data is in the file once the program has closed it (3.8.4).
  expect(Array.from(await app.exportFile('Out.TXT'))).toEqual([0x41, 0x42, 0x43, 0x0d, 0x0a]);
});

test('task 58 shows the file dialog with the program title; OK returns the path, Cancel returns 0', async ({ app }) => {
  await importInto(app, [{ name: 'pick.txt', data: 'p' }]);
  const lines = program(
    '    MOVE.L  #0,D1',
    '    LEA     TITLE,A1',
    '    MOVE.L  #0,A2',
    '    LEA     PATH,A3',
    '    MOVE.B  #58,D0',
    '    TRAP    #15',
    '    MOVE.L  D1,D7',
    '    LEA     PATH,A1',
    '    MOVE.B  #13,D0',
    '    TRAP    #15',
    '    SIMHALT',
    "TITLE DC.B  'Pick a file',0",
    'PATH DCB.B  256,0',
  );
  await execute(app, lines, 'dialog.X68');
  await tool(app, 'sim.run.run');
  const dialog = app.dialog('Pick a file');
  await expect(dialog).toBeVisible();
  await expect(app.page.locator('[data-e68-status="run"]')).toHaveText('Waiting');
  await app.fileDialogName(dialog, 'pick.txt', 'Open');
  await expectState(app, 'Halted');
  await expectReg(app, 'D7', '00000001');
  await expectOutputLine(app, /pick\.txt$/);
  // Cancel: D1 = 0.
  await tool(app, 'sim.run.rewind');
  await tool(app, 'sim.run.run');
  await expect(dialog).toBeVisible();
  await app.button(dialog, 'Cancel').click();
  await expectState(app, 'Halted');
  await expectReg(app, 'D7', '00000000');
});

test('the standard player: busy while a sound plays, free again by time with no audio output (H6)', async ({ app }) => {
  await importInto(app, [{ name: 'tick.wav', data: new Uint8Array(TICK) }]);
  await execute(
    app,
    program(
      '    LEA     SND,A1',
      '    MOVE.B  #70,D0',
      '    TRAP    #15',
      '    MOVE.W  D0,D5',
      '    LEA     SND,A1',
      '    MOVE.B  #70,D0',
      '    TRAP    #15',
      '    MOVE.W  D0,D6',
      'WAIT LEA    SND,A1',
      '    MOVE.B  #70,D0',
      '    TRAP    #15',
      '    TST.W   D0',
      '    BEQ     WAIT',
      '    SIMHALT',
      "SND DC.B    'tick.wav',0",
    ),
    'sound.X68',
  );
  await tool(app, 'sim.run.run');
  // The headless browser plays nothing (its audio context is suspended without a user gesture);
  // the busy flag must clear by the sound's duration all the same, or the loop never ends.
  await expectState(app, 'Halted');
  await expectReg(app, 'D5', '00000001', 'the first play started');
  await expectReg(app, 'D6', '00000000', 'the second found the player busy');
});

test('task 10 prints into a print job that the Printer Output dialog offers (note 2)', async ({ app }) => {
  await execute(
    app,
    program(
      '    LEA     TEXT,A1',
      '    MOVE.B  #10,D0',
      '    TRAP    #15',
      '    SIMHALT',
      "TEXT DC.B   'printed line',13,10,12,0",
    ),
  );
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  const dialog = app.dialog('Printer Output');
  if (!(await dialog.isVisible())) await app.chooseMenu('File', 'Printer Setup...');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('option')).toHaveCount(1);
  await expect(dialog).toContainText('printed line');
  await app.button(dialog, 'Discard').click();
  await expect(dialog.getByRole('option')).toHaveCount(0);
});

test('serial and network tasks in a browser give the original "not available" results (note 37)', async ({ app }) => {
  await execute(
    app,
    program(
      '    LEA     PORT,A1',
      '    MOVE.L  #40,D0',
      '    TRAP    #15',
      '    MOVE.L  D0,D6',
      '    MOVE.L  #100,D0',
      '    MOVE.L  #0,D1',
      '    TRAP    #15',
      '    MOVE.L  D0,D7',
      '    SIMHALT',
      "PORT DC.B   'COM1',0",
    ),
  );
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expectReg(app, 'D6', '00000002');
  await expectReg(app, 'D7', '276B0002');
});
