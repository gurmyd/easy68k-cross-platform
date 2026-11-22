// Run control in the real application (ARCHITECTURE.md 1.3.4 Run menu and Search menu, 1.3.5 rows
// "Enabled/disabled state machine", "Run, Run To Cursor, ...", "Message area", "Find dialog",
// "Cycle counter"; 1.4 notes 22, 23, 24; sim-ui §3.6, §5, §6.4, §6.7, §7, §9). Owner: X2.

import { expect, test, type App } from '../fixtures';
import {
  cycles,
  execute,
  expectReg,
  expectState,
  listingRow,
  messages,
  panel,
  pcRowText,
  program,
  reg,
  runState,
  selectedRowText,
  tool,
  step,
  pressInListing,
} from './sim';

/** A call to a subroutine between two plain instructions, then SIMHALT. */
const CALL = program(
  '    MOVE.L  #$12345678,D0',
  '    BSR     SUB',
  '    MOVE.L  #$33333333,D2',
  '    SIMHALT',
  'SUB MOVE.L  #$22222222,D1',
  '    RTS',
);

/** A loop that never ends. */
const LOOP = program('    MOVEQ   #0,D1', 'LOOP ADDQ.L  #1,D1', '    BRA     LOOP');

/** Reads a variable into D1, then increments it in memory: shows whether memory was kept. */
const COUNTER = program('    MOVE.W  COUNT,D1', '    ADDQ.W  #1,COUNT', '    SIMHALT', 'COUNT DC.W  0');

/** The address column of a listing row (its first eight characters). */
async function addressOf(app: App, text: string): Promise<string> {
  const row = (await listingRow(app, text).textContent()) ?? '';
  return row.trim().slice(0, 8);
}

/** The traced-instruction lines of the message area. */
async function traced(app: App): Promise<string[]> {
  return (await messages(app)).filter((line) => line.startsWith('PC='));
}

test('Trace Into executes one instruction, reports it in the message area and follows it in the listing', async ({
  app,
}) => {
  await execute(app, CALL);
  expect(await pcRowText(app)).toMatch(/^00001000 .*MOVE\.L\s+#\$12345678,D0/);
  await step(app);
  await expectReg(app, 'D0', '12345678');
  // The mnemonic is the core's table entry as it is, padded (sim-ui §7.1, `inst_arr[i].name`).
  await expect.poll(async () => (await messages(app)).at(-1)).toMatch(/^PC=00001000 {2}Code=203C {2}MOVEL\s*$/);
  const bsr = await addressOf(app, 'BSR     SUB');
  await expectReg(app, 'PC', bsr);
  expect(await pcRowText(app)).toContain('BSR     SUB');
  // Trace Into enters the subroutine.
  await step(app);
  await expectReg(app, 'PC', await addressOf(app, 'SUB MOVE.L'));
  expect(await reg(app, 'D1')).toBe('00000000');
  await expectState(app, 'Stopped');
});

test('Step Over runs a subroutine at full speed and stops on the instruction after the call', async ({ app }) => {
  await execute(app, CALL);
  await step(app, 'sim.run.stepOver');
  await expectReg(app, 'D0', '12345678');
  await step(app, 'sim.run.stepOver');
  await expectReg(app, 'PC', await addressOf(app, 'MOVE.L  #$33333333,D2'));
  await expectReg(app, 'D1', '22222222');
  expect(await reg(app, 'D2')).toBe('00000000');
  // The subroutine's instructions are not traced (sim-ui §9.5).
  expect(await traced(app)).toHaveLength(2);
});

test('Run to SIMHALT: Halted, five run commands off with the halted hint; Pause enables them again (note 22)', async ({
  app,
}) => {
  await execute(app, CALL);
  await expectState(app, 'Stopped');
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expectReg(app, 'D2', '33333333');
  // The busy state of sim-ui §3.6: Run, Run To Cursor, Auto Trace, Step Over, Trace Into are off.
  for (const id of [
    'sim.run.run',
    'sim.run.runToCursor',
    'sim.run.autoTrace',
    'sim.run.stepOver',
    'sim.run.traceInto',
  ]) {
    await expect(app.toolbarButton(id), `${id} after SIMHALT`).toBeDisabled();
  }
  // The tool-tip of the disabled buttons is their accessible description.
  await expect(app.toolbarButton('sim.run.run')).toHaveAccessibleDescription(
    /Program halted\. Rewind or Reload to run it again\./,
  );
  // Open and Reload stay enabled in the port (1.4 note 22), Pause and Rewind as in the original.
  for (const id of ['sim.file.open', 'sim.run.pause', 'sim.run.rewind', 'sim.run.reload']) {
    await expect(app.toolbarButton(id), `${id} after SIMHALT`).toBeEnabled();
  }
  // The halt adds no message (sim-ui §9.12).
  expect((await messages(app)).filter((line) => /halt/i.test(line))).toEqual([]);
  await tool(app, 'sim.run.pause');
  await expectState(app, 'Stopped');
  await expect(app.toolbarButton('sim.run.run')).toBeEnabled();
  await expect(app.toolbarButton('sim.run.traceInto')).toBeEnabled();
});

test('Pause stops a running program where it is; Run continues from there', async ({ app }) => {
  await execute(app, LOOP);
  await tool(app, 'sim.run.run');
  await expectState(app, 'Running');
  await expect(app.toolbarButton('sim.run.traceInto')).toBeDisabled();
  await app.press('sim.run.pause');
  await expectState(app, 'Stopped');
  const first = parseInt(await reg(app, 'D1'), 16);
  expect(first, 'the loop counted while it ran').toBeGreaterThan(0);
  await tool(app, 'sim.run.run');
  await expectState(app, 'Running');
  await tool(app, 'sim.run.pause');
  await expectState(app, 'Stopped');
  expect(parseInt(await reg(app, 'D1'), 16), 'Run continued with the kept D1').toBeGreaterThan(first);
});

test('Run To Cursor runs to the selected row and stops before it', async ({ app }) => {
  await execute(app, CALL);
  await listingRow(app, 'MOVE.L  #$33333333,D2').click();
  expect(await selectedRowText(app)).toContain('#$33333333');
  await app.press('sim.run.runToCursor');
  await expectReg(app, 'PC', await addressOf(app, 'MOVE.L  #$33333333,D2'));
  await expectState(app, 'Stopped');
  await expectReg(app, 'D1', '22222222');
  expect(await reg(app, 'D2')).toBe('00000000');
});

test('Run To Cursor on a row without an address: the original box, and no run (note 23)', async ({ app }) => {
  await execute(app, CALL);
  await listingRow(app, 'No errors detected').click();
  await app.press('sim.run.runToCursor');
  const box = app.messageBox;
  await expect(box).toBeVisible();
  expect(await app.boxText(box)).toBe('Selected line does not have a valid address.');
  await app.button(box, 'OK').click();
  await expect(box).toBeHidden();
  // The original runs anyway after the box; the port does not (1.4 note 23).
  await expectState(app, 'Stopped');
  await expectReg(app, 'PC', '00001000');
  expect(await reg(app, 'D0')).toBe('00000000');
});

test('Auto Trace traces one instruction per tick until Pause, which enables the commands (note 24)', async ({
  app,
}) => {
  await execute(app, LOOP);
  await app.press('sim.run.autoTrace');
  await expect.poll(async () => (await traced(app)).length).toBeGreaterThanOrEqual(3);
  await expect(runState(app)).toHaveText(/Auto trace|Running/);
  await app.press('sim.run.pause');
  await expectState(app, 'Stopped');
  const lines = await traced(app);
  expect(lines[0]).toMatch(/^PC=00001000 {2}Code=7200 {2}\S/);
  // Every traced line is an instruction of the loop.
  for (const line of lines) expect(line).toMatch(/^PC=0000100[0-4] {2}Code=[0-9A-F]{4} {2}\S/);
  await expect(app.toolbarButton('sim.run.run')).toBeEnabled();
  await expect(app.toolbarButton('sim.run.traceInto')).toBeEnabled();
});

test('Rewind keeps memory and resets the registers; Reload loads the program afresh', async ({ app }) => {
  await execute(app, COUNTER);
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expectReg(app, 'D1', '00000000');
  await pressInListing(app, 'sim.run.rewind');
  await expectState(app, 'Stopped');
  await expectReg(app, 'PC', '00001000');
  await expectReg(app, 'D1', '00000000');
  await expectReg(app, 'SR', '0010000000000000');
  await expectReg(app, 'US', '00FF0000');
  await expectReg(app, 'SS', '01000000');
  expect(await cycles(app)).toBe('0');
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expectReg(app, 'D1', '00000001', 'after Rewind the variable keeps the value the first run wrote');
  await pressInListing(app, 'sim.run.reload');
  await expectState(app, 'Stopped');
  await expect.poll(() => messages(app)).toContain('.S68 file read successful');
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expectReg(app, 'D1', '00000000', 'after Reload the variable is the loaded 0 again');
});

test('the message area of a load: the S0 line and the success line, cleared by the next load', async ({ app }) => {
  await execute(app, CALL);
  const loaded = ['S0 = 68KPROG   20CREATED BY EASY68K', '.S68 file read successful'];
  await expect.poll(() => messages(app)).toEqual(loaded);
  await step(app);
  await expect.poll(async () => (await messages(app)).length).toBe(3);
  await pressInListing(app, 'sim.run.reload');
  await expect.poll(() => messages(app)).toEqual(loaded);
});

test('Go to PC selects the current instruction again after another row was clicked', async ({ app }) => {
  await execute(app, CALL);
  await step(app);
  await expectReg(app, 'PC', await addressOf(app, 'BSR     SUB'));
  await listingRow(app, 'SIMHALT').click();
  expect(await selectedRowText(app)).toContain('SIMHALT');
  await app.press('sim.search.gotoPC');
  await expect.poll(() => selectedRowText(app)).toContain('BSR     SUB');
});

test('Find: case-insensitive over the whole row, Find (F3) for the next hit, no wrap', async ({ app, page }) => {
  await execute(app, CALL);
  await app.press('sim.search.find');
  const dialog = app.dialog('Find');
  await expect(dialog).toBeVisible();
  const field = dialog.getByLabel('Find what:');
  const button = dialog.getByRole('button', { name: /^Find\s+\(F3\)$/ });
  await expect(button).toBeDisabled();
  await field.fill('move.l');
  await button.click();
  await expect.poll(() => selectedRowText(app)).toContain('#$12345678');
  await button.click();
  await expect.poll(() => selectedRowText(app)).toContain('#$33333333');
  // F3 in the dialog searches on.
  await field.focus();
  await page.keyboard.press('F3');
  await expect.poll(() => selectedRowText(app)).toContain('#$22222222');
  // No further hit: the selection stays.
  await page.keyboard.press('F3');
  await page.keyboard.press('F3');
  expect(await selectedRowText(app)).toContain('#$22222222');
  await app.button(dialog, 'Cancel').click();
  await expect(dialog).toBeHidden();
});

test('Clear Cycles sets the counter to 0; a step counts again', async ({ app }) => {
  await execute(app, CALL);
  expect(await cycles(app)).toBe('0');
  await step(app);
  await expect.poll(() => cycles(app)).toBe('12');
  await panel(app, 'registers').getByRole('button', { name: 'Clear Cycles' }).click();
  await expect.poll(() => cycles(app)).toBe('0');
  await step(app);
  await expect.poll(() => cycles(app)).not.toBe('0');
});
