// Assemble Source, the Messages panel, markers, the Assembler Status dialog, include-file messages,
// Execute and Load L68 (ARCHITECTURE.md 1.3.1 Project row, 1.3.2 message-list context menu, 1.3.3
// rows "Assemble", "Assembler Status", "Messages from include files", "Message list", 2.2, 4.9,
// notes 18, 20; editor-ui §7.3, §10, §20.4). Owner: X1. The feature is E5's (wave 2): every test
// waits for it (fixtures/pending.ts). The real assembler engine is part of the production build.

import { TEMPLATE, crlf, expect, requirePackage, test, type App } from '../fixtures';

test.beforeEach(async ({ app }) => {
  await requirePackage(app, 'E5');
});

/**
 * The message list of Editor mode: the grid of its Messages panel. Not the whole panel: the panel
 * also holds the visually hidden log region that reads new messages out to a screen reader (2.11,
 * Q1-3), whose text repeats the rows.
 */
const messages = (app: App) =>
  app.page.locator('[data-e68-workspace="editor"] [data-e68-panel="messages"]').getByRole('grid');

/** Assembles the active document with F9 and returns the status dialog. */
async function assemble(app: App, name: string) {
  await app.focusEditor();
  await app.press('ed.project.assemble');
  const dialog = app.dialog(`Assembler Status - ${name}`);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Opens a source as a named document in My Programs (Import..., then Open). */
async function source(app: App, name: string, lines: string[]): Promise<void> {
  await app.importFiles([{ name, data: crlf(...lines) }]);
  await app.openFile(name);
  await expect.poll(() => app.tabNames()).toContain(name);
}

test('F9 on the template: Warnings 0, Errors 0, Execute enabled; the .L68 and .S68 are written', async ({ app }) => {
  await app.saveAs('tmpl.X68');
  const dialog = await assemble(app, 'tmpl.X68');
  const text = await dialog.innerText();
  expect(text).toMatch(/Warnings:\s*0/);
  expect(text).toMatch(/Errors:\s*0/);
  await expect(app.button(dialog, 'Execute')).toBeEnabled();
  await expect(app.button(dialog, 'Load L68')).toBeEnabled();
  await app.button(dialog, 'Close').click();
  await expect(dialog).toBeHidden();
  await expect(app.treeItem('tmpl.L68')).toBeVisible();
  await expect(app.treeItem('tmpl.S68')).toBeVisible();
  const srec = Buffer.from(await app.exportFile('tmpl.S68')).toString('latin1');
  expect(srec).toMatch(/^S0/);
  // The original always ends with an S8 record holding the 3-byte start address (assembler.md
  // section on .S68 files: `sprintf(sRecord, "S8  %06X", startAddress)`); START is $1000.
  expect(srec).toMatch(/\r\nS804001000EB\r\n$/);
  expect(srec).not.toMatch(/(^|\n)S[79]/);
});

test('F9 on the unnamed start-up document names the dialog after it (untitled1.x68)', async ({ app }) => {
  expect(await app.text()).toBe(TEMPLATE);
  const dialog = await assemble(app, 'untitled1.x68');
  expect(await dialog.innerText()).toMatch(/Errors:\s*0/);
  await expect(app.button(dialog, 'Execute')).toBeEnabled();
  await app.button(dialog, 'Close').click();
});

test('one bad opcode: Errors 1, Execute disabled, one message row; a double-click selects that line', async ({
  app,
}) => {
  await source(app, 'bad.X68', ['    ORG    $1000', 'START:', '    BADOP  D0', '    SIMHALT', '    END    START']);
  const dialog = await assemble(app, 'bad.X68');
  expect(await dialog.innerText()).toMatch(/Errors:\s*1/);
  await expect(app.button(dialog, 'Execute')).toBeDisabled();
  await app.button(dialog, 'Close').click();
  const panel = messages(app);
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Line', { exact: false }).first()).toBeVisible();
  await expect(panel.getByText('Error Message')).toBeVisible();
  const row = panel.getByText('ERROR: Invalid opcode');
  await expect(row).toHaveCount(1);
  // The same row is read out once by the panel's polite log region (2.11; Q1-3).
  await expect(
    app.page.locator('[data-e68-workspace="editor"] [data-e68-panel="messages"] [role=log][aria-live=polite]'),
  ).toHaveText(/^1 assembler message\.\s*Line 3: ERROR: Invalid opcode$/);
  await row.dblclick();
  await expect.poll(async () => (await app.status())[0]).toMatch(/^3: /);
});

test('a source without END: Warnings 1 and the END warning row', async ({ app }) => {
  await source(app, 'noend.X68', ['    ORG    $1000', 'START:', '    SIMHALT']);
  const dialog = await assemble(app, 'noend.X68');
  expect(await dialog.innerText()).toMatch(/Warnings:\s*1/);
  await expect(app.button(dialog, 'Execute')).toBeEnabled();
  await app.button(dialog, 'Close').click();
  await expect(messages(app).getByText('WARNING: END directive missing, starting address not set')).toBeVisible();
});

test('the message list context menu clears the messages (Clear Error Messages)', async ({ app }) => {
  await source(app, 'clear.X68', ['    ORG    $1000', 'START:', '    BADOP', '    END    START']);
  const dialog = await assemble(app, 'clear.X68');
  await app.button(dialog, 'Close').click();
  const row = messages(app).getByText('ERROR: Invalid opcode');
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });
  await app.menuItem(app.openMenuList, 'Clear Error Messages').click();
  await expect(row).toHaveCount(0);
});

test('Load L68 opens the listing in a new, uncoloured tab', async ({ app }) => {
  await app.saveAs('list.X68');
  const dialog = await assemble(app, 'list.X68');
  await app.button(dialog, 'Load L68').click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => app.tabNames()).toEqual(['list.X68', 'list.L68']);
  await expect(app.content().locator('[class*="e68-syntax__"]')).toHaveCount(0);
  expect(await app.text()).toContain('Assembler used: EASy68K Editor/Assembler v5.16.01');
});

test('Execute switches to Simulator mode with the program loaded and not running (note 20)', async ({ app, page }) => {
  await app.saveAs('exec.X68');
  const dialog = await assemble(app, 'exec.X68');
  await app.button(dialog, 'Execute').click();
  await expect.poll(() => app.mode()).toBe('simulator');
  const listing = page.locator('[data-e68-panel="listing"]');
  await expect(listing).toContainText('SIMHALT');
  await expect(app.toolbarButton('sim.run.run')).toBeEnabled();
  // Pause is enabled in every state (sim-ui.md, the toolbar and Run menu tables), so it says
  // nothing here; "not running" shows as Run and Trace Into being enabled.
  await expect(app.toolbarButton('sim.run.traceInto')).toBeEnabled();
  await expect(app.toolbarButton('sim.run.pause')).toBeEnabled();
});

test('messages of an include file open that file; the assembled document stays active (note 18)', async ({ app }) => {
  await app.importFiles([{ name: 'inc.X68', data: crlf('* included', '    BADOP') }]);
  await source(app, 'main.X68', ['    ORG    $1000', "START:  INCLUDE 'inc.X68'", '    SIMHALT', '    END    START']);
  const dialog = await assemble(app, 'main.X68');
  expect(await dialog.innerText()).toMatch(/Errors:\s*1/);
  await app.button(dialog, 'Close').click();
  await expect.poll(() => app.tabNames()).toContain('inc.X68');
  expect((await app.tabs()).find((tab) => tab.selected)?.name).toBe('main.X68');
  await app.tab('inc.X68').click();
  await expect(messages(app).getByText('ERROR: Invalid opcode')).toBeVisible();
});

test('Auto Save on: a modified named document is saved before assembling (E4 and E5)', async ({ app, page }) => {
  await requirePackage(app, 'E4');
  await app.saveAs('auto.X68');
  await app.chooseMenu('Options', 'Assembler Options...');
  const options = app.dialog('EASy68K Assembler Options');
  await options.getByRole('checkbox', { name: 'Auto Save Modified Source Before Assembling', exact: true }).check();
  await app.button(options, 'OK').click();
  await app.select(0);
  await page.keyboard.type('* saved first\n');
  const dialog = await assemble(app, 'auto.X68');
  await app.button(dialog, 'Close').click();
  expect((await app.status())[1]).toBe('');
  expect(Buffer.from(await app.exportFile('auto.X68')).toString('latin1')).toMatch(/^\* saved first\r\n/);
});

test('Auto Save off (default): the stored file stays as it was, the outputs follow the edited text', async ({
  app,
  page,
}) => {
  await app.saveAs('noauto.X68');
  const stored = Buffer.from(await app.exportFile('noauto.X68'));
  await app.select(0);
  await page.keyboard.type('* only in the editor\n');
  const dialog = await assemble(app, 'noauto.X68');
  await app.button(dialog, 'Close').click();
  expect((await app.status())[1]).toBe('Modified');
  expect(Buffer.from(await app.exportFile('noauto.X68')).equals(stored)).toBe(true);
  expect(Buffer.from(await app.exportFile('noauto.L68')).toString('latin1')).toContain('* only in the editor');
});
