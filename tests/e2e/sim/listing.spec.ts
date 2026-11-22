// The Listing panel and simple PC breakpoints (ARCHITECTURE.md 1.3.5 rows "Gutter context menu",
// "Listing pane", "Horizontal scroll bar", "Current instruction", "Gutter dots", "Single click ...",
// "Load sequence, listing lookup, *[sim68k]...", "Drag and drop of an .S68"; 1.3.7 row "Simple PC
// breakpoints"; 1.4 notes 33, 39; sim-ui §6, §8.2, §8.4). Owner: X2.

import { expect, test, type App } from '../fixtures';
import {
  answer,
  chooseInMyPrograms,
  execute,
  expectReg,
  expectState,
  gutter,
  listing,
  listingRow,
  listingRows,
  messages,
  panel,
  pcRowText,
  program,
  reg,
  selectedRowText,
  switchMode,
  tool,
  step,
  pressInListing,
} from './sim';

const STEPS = program(
  '    MOVE.L  #1,D1',
  '    MOVE.L  #2,D2',
  '    MOVE.L  #3,D3',
  '    MOVE.L  #4,D4',
  '    SIMHALT',
);

/** The breakpoint state of the row with `text`: on, off or none (not an instruction row). */
async function breakpointOf(app: App, text: string): Promise<string> {
  return (await listingRow(app, text).getAttribute('data-bp')) ?? 'none';
}

test('the listing shows the raw .L68 rows under the original heading; tabs at 8-column stops', async ({ app }) => {
  await execute(app, STEPS, 'raw.X68');
  await expect(panel(app, 'listing')).toContainText(
    ' Address  --------Code---------   Line -----------Source----------->>',
  );
  const rows = await listingRows(app).allTextContents();
  expect(rows[0]).toMatch(/^00001000 Starting Address$/);
  expect(rows[1]).toBe('Assembler used: EASy68K Editor/Assembler v5.16.01');
  expect(rows[2]).toMatch(/^Created On: /);
  expect(rows).toContain('No errors detected');
  expect(rows).toContain('SYMBOL TABLE INFORMATION');
  // The assembler expands the source's tabs itself (with the editor's tab size), so a listing with
  // tab characters is made by hand: the raw .L68 with tabs in its last row, loaded with its .S68.
  await switchMode(app, 'Editor');
  const s68 = await app.exportFile('raw.S68');
  const l68 = Buffer.from(await app.exportFile('raw.L68')).toString('latin1');
  await app.importFiles([
    { name: 'tabbed.S68', data: s68 },
    { name: 'tabbed.L68', data: `${l68}a\tbcdefghij\tk\r\n` },
  ]);
  await switchMode(app, 'Simulator');
  await app.chooseMenu('File', 'Open...');
  await chooseInMyPrograms(app, 'Open', 'tabbed.S68', 'Open');
  await expect(listingRows(app).last()).toHaveText(`a${' '.repeat(7)}bcdefghij${' '.repeat(7)}k`);
});

test('green dots on instruction rows only; a click sets a red breakpoint and Run stops there', async ({ app }) => {
  await execute(app, STEPS);
  expect(await breakpointOf(app, 'MOVE.L  #3,D3')).toBe('off');
  expect(await breakpointOf(app, 'No errors detected')).toBe('none');
  expect(await breakpointOf(app, 'Assembler used')).toBe('none');
  await gutter(listingRow(app, 'MOVE.L  #3,D3')).click();
  expect(await breakpointOf(app, 'MOVE.L  #3,D3')).toBe('on');
  const address = (await listingRow(app, 'MOVE.L  #3,D3').textContent())!.trim().slice(0, 8);
  await tool(app, 'sim.run.run');
  await expectReg(app, 'PC', address);
  await expectState(app, 'Stopped');
  expect(await reg(app, 'D2')).toBe('00000002');
  expect(await reg(app, 'D3')).toBe('00000000');
  // `break point at %04x`: lower-case hex.
  await expect.poll(() => messages(app)).toContain(`break point at ${parseInt(address, 16).toString(16)}`);
  // Run again continues from the breakpoint (the instruction on it executes first).
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expectReg(app, 'D4', '00000004');
  // A second click clears it.
  await gutter(listingRow(app, 'MOVE.L  #3,D3')).click();
  expect(await breakpointOf(app, 'MOVE.L  #3,D3')).toBe('off');
});

test('the gutter context menu clears all PC breakpoints', async ({ app }) => {
  await execute(app, STEPS);
  await gutter(listingRow(app, 'MOVE.L  #2,D2')).click();
  await gutter(listingRow(app, 'MOVE.L  #4,D4')).click();
  expect(await breakpointOf(app, 'MOVE.L  #2,D2')).toBe('on');
  await gutter(listingRow(app, 'MOVE.L  #1,D1')).click({ button: 'right' });
  await app.menuItem(app.openMenuList, 'Clear All PC Breakpoints').click();
  expect(await breakpointOf(app, 'MOVE.L  #2,D2')).toBe('off');
  expect(await breakpointOf(app, 'MOVE.L  #4,D4')).toBe('off');
  expect(await breakpointOf(app, 'MOVE.L  #1,D1')).toBe('off');
});

test('the 101st breakpoint: Breakpoint Limit Reached!', async ({ app, page }) => {
  test.setTimeout(180_000);
  await execute(app, program(...Array.from({ length: 101 }, () => '    NOP'), '    SIMHALT'));
  // Keyboard of the listing (docs/differences/U1.md): arrows move the selection, Space toggles.
  const first = listingRow(app, /00001000 {2}4E71/);
  await first.click();
  await listing(app).focus();
  for (let i = 0; i < 100; i++) {
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
  }
  await expect.poll(async () => listingRows(app).and(page.locator('[data-bp="on"]')).count()).toBeGreaterThan(0);
  await page.keyboard.press('Space');
  expect(await answer(app, 'OK')).toBe('Breakpoint Limit Reached!');
  expect(await listing(app).locator('[aria-selected="true"]').getAttribute('data-bp')).toBe('off');
});

test('a click selects a row; a double-click on an instruction row puts its address into the PC field', async ({
  app,
}) => {
  await execute(app, STEPS);
  const row = listingRow(app, 'MOVE.L  #3,D3');
  await row.click();
  expect(await selectedRowText(app)).toContain('#3,D3');
  expect(await pcRowText(app)).toContain('#1,D1');
  await row.dblclick();
  const address = (await row.textContent())!.trim().slice(0, 8);
  await expectReg(app, 'PC', address);
  await step(app);
  await expectReg(app, 'D3', '00000003');
  expect(await reg(app, 'D1')).toBe('00000000');
});

test('*[sim68k]break sets a breakpoint on the next instruction row; Rewind and Reload keep breakpoints', async ({
  app,
}) => {
  await execute(app, [
    '    ORG    $1000',
    'START:',
    '    MOVE.L  #1,D1',
    '*[sim68k]break',
    '    MOVE.L  #2,D2',
    '    MOVE.L  #3,D3',
    '    SIMHALT',
    '    END    START',
  ]);
  expect(await breakpointOf(app, 'MOVE.L  #2,D2')).toBe('on');
  await gutter(listingRow(app, 'MOVE.L  #3,D3')).click();
  await tool(app, 'sim.run.run');
  await expectReg(app, 'D1', '00000001');
  expect(await reg(app, 'D2')).toBe('00000000');
  await pressInListing(app, 'sim.run.rewind');
  expect(await breakpointOf(app, 'MOVE.L  #3,D3')).toBe('on');
  await pressInListing(app, 'sim.run.reload');
  await expect.poll(() => messages(app)).toContain('.S68 file read successful');
  expect(await breakpointOf(app, 'MOVE.L  #2,D2')).toBe('on');
  expect(await breakpointOf(app, 'MOVE.L  #3,D3')).toBe('on');
});

test('*[sim68k]bitfield turns on bit-field instructions; *[sim68k]simhalt_off makes FFFF FFFF an illegal opcode', async ({
  app,
}) => {
  await execute(app, [
    '*[sim68k]bitfield',
    '*[sim68k]simhalt_off',
    '    ORG    $1000',
    'START:',
    '    MOVE.L  #1,D1',
    '    SIMHALT',
    '    END    START',
  ]);
  await expect(app.page.locator('[data-e68-status="bitField"]')).toHaveText('bit field on');
  // A regular expression: a string would also match the lower-case directive row (hasText ignores case).
  const simhalt = parseInt((await listingRow(app, /SIMHALT$/).textContent())!.trim().slice(0, 8), 16);
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expect
    .poll(() => messages(app))
    .toContain(`Line 1111 Emulator exception occurred at location ${simhalt.toString(16)}. Execution halted`);
});

test('the listing scrolls sideways with its heading (note 33)', async ({ app }) => {
  // Finding for U1 (features/sim-main): the heading strip is only as wide as its own text, so its
  // scrollLeft stays 0 while the rows scroll (measured: rows 200, heading 0) and the column titles
  // no longer stand over their columns. Expected to fail until U1 repairs it; then delete this line.
  test.fail(true, 'U1: the listing heading does not scroll with the rows');
  await execute(app, program(`    MOVE.L  #1,D1   * ${'x'.repeat(300)}`, '    SIMHALT'));
  const list = listing(app);
  const heading = panel(app, 'listing').locator('.e68-listing__heading');
  await list.evaluate((element) => {
    element.scrollLeft = 200;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => list.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const positions = async () => ({
    list: await list.evaluate((e) => e.scrollLeft),
    heading: await heading.evaluate((e) => e.scrollLeft),
  });
  await expect
    .poll(async () => {
      const p = await positions();
      return p.heading === p.list ? 'same' : JSON.stringify(p);
    })
    .toBe('same');
});

test('the PC row is selected and marked; after SIMHALT the row after it is selected (highlight rule)', async ({
  app,
}) => {
  await execute(app, program('    MOVE.L  #1,D1', '    SIMHALT', 'DATA DC.W  $1234'));
  expect(await selectedRowText(app)).toContain('#1,D1');
  expect(await pcRowText(app)).toContain('#1,D1');
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  // The PC is past SIMHALT, on a data row: it is selected because the program halted (sim-ui §6.4).
  await expect.poll(() => selectedRowText(app)).toContain('DATA DC.W');
});
