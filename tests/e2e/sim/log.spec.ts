// Logging: the Log Output dialog, Log Start and Log Stop, both logs, the file-exists dialog, the
// LOGGING label, automatic stops and the Log panel (ARCHITECTURE.md 1.3.4 rows "Log Start", "Log
// Stop", "Log Output..."; 1.3.5 row "Toolbar"; 1.3.7 rows "Log Output dialog", "Log Start, Log File
// Options, Log Stop, LOGGING, automatic stops", "Execution log and output log formats"; 1.4 notes 25,
// 41, 42; sim-ui §13; trap15-a §3.11). Owner: X2.

import { expect, test, type App } from '../fixtures';
import {
  answer,
  execute,
  expectState,
  panel,
  program,
  switchMode,
  tool,
  typeInto,
  view,
  step,
  pressInListing,
} from './sim';

const NAME = 'logme';

/** Two traced instructions, text output, then SIMHALT (which stops the log). */
const PROGRAM = program(
  '    MOVE.L  #$11,D1',
  '    MOVE.L  #$22,D2',
  '    LEA     TEXT,A1',
  '    MOVE.B  #13,D0',
  '    TRAP    #15',
  '    SIMHALT',
  "TEXT DC.B   'logged text',0",
);

const logging = (app: App) => app.page.locator('.e68-shell__toolbar').getByText('LOGGING', { exact: true });

/** Options > Log Output...: chooses the two log types and confirms. */
async function chooseLogTypes(app: App, exec: string, output: string): Promise<void> {
  await app.chooseMenu('Options', 'Log Output...');
  const dialog = app.dialog('Log Output');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Execution Log File Name:')).toHaveValue(new RegExp(`${NAME}_RunLog\\.txt$`));
  await expect(dialog.getByLabel('Output Log File Name:')).toHaveValue(new RegExp(`${NAME}_OutLog\\.txt$`));
  await dialog.getByRole('radio', { name: exec, exact: true }).check();
  await dialog.getByRole('radio', { name: output, exact: true }).check();
  await app.button(dialog, 'OK').click();
  await expect(dialog).toBeHidden();
}

/** The text of a file of My Programs, read with the Files panel's Export... in Editor mode. */
async function fileText(app: App, name: string): Promise<string> {
  await switchMode(app, 'Editor');
  const text = Buffer.from(await app.exportFile(name)).toString('latin1');
  await switchMode(app, 'Simulator');
  return text;
}

test('both logs: Log Start shows LOGGING; SIMHALT stops the log with the original box; the files hold the log', async ({
  app,
}) => {
  await execute(app, PROGRAM, `${NAME}.X68`);
  await expect(app.toolbarButton('sim.run.logStart')).toBeDisabled();
  await chooseLogTypes(app, 'Instruction only', 'Text Only');
  await expect(app.toolbarButton('sim.run.logStart')).toBeEnabled();
  await pressInListing(app, 'sim.run.logStart');
  await expect(logging(app)).toBeVisible();
  await expect(app.toolbarButton('sim.run.logStop')).toBeEnabled();
  await expect(app.toolbarButton('sim.run.logStart')).toBeDisabled();
  await step(app);
  await step(app);
  await tool(app, 'sim.run.run');
  expect(await answer(app, 'OK', 'Information')).toBe('Current Log Stopped.');
  await expectState(app, 'Halted');
  await expect(logging(app)).toHaveCount(0);
  // The Log panel (added, note 42) shows the tail of both files.
  const log = await view(app, 'Log', 'log');
  await expect(log).toContainText('logged text');

  const run = await fileText(app, `${NAME}_RunLog.txt`);
  expect(run).toMatch(/^EASy68K execution log file: .+\r\n\r\n/);
  // Only traced instructions are logged (sim-ui §13.4): the two MOVEs, not the run to SIMHALT.
  expect(run).toContain('MOVE.L  #$11,D1');
  expect(run).toContain('MOVE.L  #$22,D2');
  expect(run).not.toContain('TRAP    #15');
  const out = await fileText(app, `${NAME}_OutLog.txt`);
  expect(out).toMatch(/^EASy68K output log file: .+\r\n\r\nlogged text\n$/);
});

test('Log File Options: Append adds to an existing log, Replace starts it again, Cancel does not log (note 41)', async ({
  app,
}) => {
  await execute(app, PROGRAM, `${NAME}.X68`);
  await chooseLogTypes(app, 'Instruction only', 'Text Only');
  await pressInListing(app, 'sim.run.logStart');
  await expect(logging(app)).toBeVisible();
  await step(app);
  await pressInListing(app, 'sim.run.logStop');
  await expect(logging(app)).toHaveCount(0);
  await expect(app.toolbarButton('sim.run.logStop')).toBeDisabled();
  // Log Stop closed the log: the step after it is not in the file.
  await step(app);
  const stopped = await fileText(app, `${NAME}_RunLog.txt`);
  expect(stopped).toContain('MOVE.L  #$11,D1');
  expect(stopped).not.toContain('MOVE.L  #$22,D2');

  await pressInListing(app, 'sim.run.logStart');
  const options = app.dialog('Log File Options');
  await expect(options).toBeVisible();
  await expect(options).toContainText('Execution Log File exists!');
  await app.button(options, 'Append').click();
  await expect(options).toContainText('Output Log File exists!');
  await app.button(options, 'Replace').click();
  await expect(options).toBeHidden();
  await expect(logging(app)).toBeVisible();
  await pressInListing(app, 'sim.run.logStop');
  await expect(logging(app)).toHaveCount(0);
  expect((await fileText(app, `${NAME}_RunLog.txt`)).match(/EASy68K execution log file: /g)).toHaveLength(2);
  expect((await fileText(app, `${NAME}_OutLog.txt`)).match(/EASy68K output log file: /g)).toHaveLength(1);

  await pressInListing(app, 'sim.run.logStart');
  await expect(options).toBeVisible();
  await app.button(options, 'Cancel').click();
  // Cancel of either question means logging does not start (1.4 note 41).
  if (await options.isVisible()) await app.button(options, 'Cancel').click();
  await expect(options).toBeHidden();
  await expect(logging(app)).toHaveCount(0);
  await expect(app.toolbarButton('sim.run.logStart')).toBeEnabled();
  await expect(app.toolbarButton('sim.run.logStop')).toBeDisabled();
});

test('the Log Output dialog: Cancel keeps the earlier choice; the memory range shows only for the third type', async ({
  app,
}) => {
  await execute(app, PROGRAM, `${NAME}.X68`);
  await app.chooseMenu('Options', 'Log Output...');
  const dialog = app.dialog('Log Output');
  const types = await dialog
    .getByRole('radio')
    .evaluateAll((radios) =>
      radios.map((r) => r.getAttribute('aria-label') ?? r.closest('label')?.textContent?.trim() ?? ''),
    );
  expect(types).toEqual([
    'Disabled',
    'Instruction only',
    'Instruction and Registers',
    'Instruction, Registers and Memory',
    'Disabled',
    'Text Only',
  ]);
  await expect(dialog.getByText('Memory Range to Log')).toHaveCount(0);
  await dialog.getByRole('radio', { name: 'Instruction, Registers and Memory' }).check();
  await expect(dialog.getByText('Memory Range to Log')).toBeVisible();
  await app.button(dialog, 'Cancel').click();
  await expect(app.toolbarButton('sim.run.logStart')).toBeDisabled();
  await app.chooseMenu('Options', 'Log Output...');
  await expect(dialog.getByRole('radio', { name: 'Disabled' }).first()).toBeChecked();
  await app.button(dialog, 'Cancel').click();
  await expect(panel(app, 'listing')).toBeVisible();
});

test('log type 3: memory and register blocks before each traced instruction; Rewind notes only after the dialog saw the type (sim-ui §13.5)', async ({
  app,
}) => {
  await execute(app, PROGRAM, `${NAME}.X68`);
  // The dialog is shown while both types are still Disabled: the notes' snapshot is 0 (the quirk).
  await app.chooseMenu('Options', 'Log Output...');
  const dialog = app.dialog('Log Output');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: 'Instruction, Registers and Memory', exact: true }).check();
  await dialog.getByRole('radio', { name: 'Text Only', exact: true }).check();
  // Two rows of memory from the program's first instruction.
  await typeInto(dialog.getByLabel('From:'), '00001000');
  await typeInto(dialog.getByLabel('Bytes'), '20');
  await app.button(dialog, 'OK').click();
  await expect(dialog).toBeHidden();
  await pressInListing(app, 'sim.run.logStart');
  await expect(logging(app)).toBeVisible();
  await step(app);
  await pressInListing(app, 'sim.run.rewind');
  await expect(app.toolbarButton('sim.run.traceInto')).toBeEnabled();
  await pressInListing(app, 'sim.run.logStop');
  await expect(logging(app)).toHaveCount(0);
  const first = await fileText(app, `${NAME}_RunLog.txt`);
  expect(first).not.toContain('Reset Program Pressed');
  // Type 3: a blank line and memory rows of 16 bytes, a blank line and the four register lines, then
  // the instruction line, all before the instruction executes (sim-ui §13.4).
  expect(first).toMatch(/\r?\n\r?\n00001000: (?:[0-9A-F]{2} ){16}[^\r\n]{16}\r?\n00001010: /);
  expect(first).toMatch(
    new RegExp(
      [
        '',
        '',
        'D0=00000000 D4=00000000 A0=00000000 A4=00000000    T_S__INT___XNZVC',
        'D1=00000000 D5=00000000 A1=00000000 A5=00000000 SR=0010000000000000',
        'D2=00000000 D6=00000000 A2=00000000 A6=00000000 US=00FF0000',
        'D3=00000000 D7=00000000 A3=00000000 A7=01000000 SS=01000000',
        'PC=00001000  Code=',
      ].join('\\r?\\n'),
    ),
  );

  // Shown again with the types set, the dialog takes the snapshot: now Rewind writes its note in both
  // logs.
  await app.chooseMenu('Options', 'Log Output...');
  await expect(dialog).toBeVisible();
  await app.button(dialog, 'Cancel').click();
  await expect(dialog).toBeHidden();
  await pressInListing(app, 'sim.run.logStart');
  const options = app.dialog('Log File Options');
  await expect(options).toBeVisible();
  await app.button(options, 'Append').click();
  await expect(options).toContainText('Output Log File exists!');
  await app.button(options, 'Append').click();
  await expect(options).toBeHidden();
  await expect(logging(app)).toBeVisible();
  await pressInListing(app, 'sim.run.rewind');
  await expect(app.toolbarButton('sim.run.traceInto')).toBeEnabled();
  await pressInListing(app, 'sim.run.logStop');
  await expect(logging(app)).toHaveCount(0);
  const note = /\r?\n\*{5} Reset Program Pressed \*{5}\r?\n/g;
  const run = await fileText(app, `${NAME}_RunLog.txt`);
  expect(run.match(note)).toHaveLength(1);
  expect(run.indexOf('Reset Program Pressed')).toBeGreaterThan(run.lastIndexOf('EASy68K execution log file: '));
  const out = await fileText(app, `${NAME}_OutLog.txt`);
  expect(out.match(note)).toHaveLength(1);
});
