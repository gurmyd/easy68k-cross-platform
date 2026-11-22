// Logging: the Log Output dialog, Log Start and Log Stop, both logs, the file-exists dialog, the
// LOGGING label, automatic stops and the Log panel (ARCHITECTURE.md 1.3.4 rows "Log Start", "Log
// Stop", "Log Output..."; 1.3.5 row "Toolbar"; 1.3.7 rows "Log Output dialog", "Log Start, Log File
// Options, Log Stop, LOGGING, automatic stops", "Execution log and output log formats"; 1.4 notes 25,
// 41, 42; sim-ui §13; trap15-a §3.11). Owner: X2.

import { expect, test, type App } from '../fixtures';
import { answer, execute, expectState, panel, program, switchMode, tool, view, step, pressInListing } from './sim';

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
  await pressInListing(app, 'sim.run.logStop');
  await expect(logging(app)).toHaveCount(0);

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
