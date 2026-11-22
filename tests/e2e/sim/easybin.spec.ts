// EASyBIN mode (ARCHITECTURE.md 1.3.8 and its extension in docs/porting/easybin.md 21.4; 1.4 note 26;
// easybin.md §2, §5-§16). Owner: X2.
//
// The S-record of easybin.md 10.4 (the fixture `asm-hello.S68` of app/src/core/easybin/fixtures) is
// loaded and saved again; the file EASyBIN writes must be the one easybin.md 11.3 gives.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator } from '@playwright/test';
import { expect, test, type App, type KeyMap } from '../fixtures';
import { answer, switchMode, typeInto } from './sim';

const here = dirname(fileURLToPath(import.meta.url));
const HELLO = readFileSync(join(here, '..', '..', '..', 'app', 'src', 'core', 'easybin', 'fixtures', 'asm-hello.S68'));

/** What Save S-Record writes for HELLO with From 001000, To 001023 (easybin.md 11.3). */
const SAVED =
  'S0210000535245434F5244202020313143524541544544204259204541535942494E2C\r\n' +
  'S123100043F900001010103C000E4E4FFFFFFFFF48656C6C6F2C204541537942494EE9FC2D\r\n' +
  'S10610207F1F002B\r\n' +
  'S70500001000EA\r\n';

type Row = [caption: string, windows?: string, mac?: string];
const MENUS: Record<string, Row[]> = {
  File: [
    ['&New'],
    ['&Open S-Record...', 'Ctrl+O', 'Cmd+O'],
    ['Open &Binary...', 'Ctrl+B', 'Cmd+B'],
    ['Save S-&Record...', 'Ctrl+R', 'Ctrl+R'],
    ['&Save Binary...', 'Ctrl+S', 'Cmd+S'],
    ['E&xit'],
  ],
  Help: [['&EASyBIN Help'], ['&About EASyBIN']],
};
const plain = (caption: string) => caption.replace(/&(.)/g, '$1');
const shortcutOn = (row: Row, keys: KeyMap) => (keys === 'mac' ? row[2] : row[1]) ?? '';

const workspace = (app: App) => app.page.locator('[data-e68-workspace="easybin"]');
const field = (app: App, name: string) => workspace(app).getByLabel(name, { exact: true });
const output = (app: App, label: string) =>
  workspace(app)
    .getByRole('status')
    .or(workspace(app).locator('output'))
    .filter({
      has: app.page.locator(':scope'),
    })
    .and(workspace(app).getByLabel(label, { exact: true }));

/** The text of the memory area, one string per row. */
async function memoryRows(app: App): Promise<string[]> {
  return (await workspace(app).getByRole('group', { name: 'Memory' }).innerText()).split('\n').filter((l) => l.trim());
}

/** Chooses `name` in My Programs in the open file dialog `title`. */
async function choose(app: App, title: string, name: string, button: 'Open' | 'Save'): Promise<void> {
  const dialog = app.page.getByRole('dialog', { name: title, exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Look in:').selectOption({ label: 'My Programs' });
  await app.fileDialogName(dialog, name, button);
  await expect(dialog).toBeHidden();
}

/** Imports HELLO as hello.S68, switches to EASyBIN and opens it with File > Open S-Record... */
async function openHello(app: App): Promise<void> {
  await app.importFiles([{ name: 'hello.S68', data: new Uint8Array(HELLO) }]);
  await switchMode(app, 'EASyBIN');
  await app.chooseMenu('File', 'Open S-Record...');
  await choose(app, 'Open', 'hello.S68', 'Open');
  const text = await answer(app, 'OK', 'EASyBIN');
  // The S0 description ends with its own line feed (easybin.md 10.3, `s0str += "\n"`).
  expect(text.trimEnd()).toBe(
    'S Record loaded successfully.\n\nS0 description record contains:\nS0 = 68KPROG   20CREATED BY EASY68K',
  );
}

async function readOnly(app: App, label: string): Promise<string> {
  return ((await output(app, label).textContent()) ?? '').replace(/\s/g, '');
}

test.describe('menus', () => {
  for (const [title, rows] of Object.entries(MENUS)) {
    test(`${title}: the items of EASyBIN v2.5.0 with this key map's shortcuts`, async ({ app }) => {
      await switchMode(app, 'EASyBIN');
      const entries = (await app.menuEntries(title)).slice(0, rows.length);
      expect(entries.map((e) => e.caption)).toEqual(rows.map(([caption]) => plain(caption)));
      expect(entries.map((e) => e.shortcut)).toEqual(rows.map((row) => shortcutOn(row, app.keys)));
    });
  }
});

test('Open S-Record fills memory and the S-Record File group; the window title is the file', async ({ app }) => {
  await openHello(app);
  await expect(field(app, 'Start Address')).toHaveValue('00001000');
  expect(await readOnly(app, 'Last Address:')).toBe('$00001022');
  expect(await readOnly(app, 'Length:')).toBe('$000023');
  await expect(field(app, 'Address')).toHaveValue('001000');
  await expect(field(app, 'First Address')).toHaveValue('001000');
  await expect(field(app, 'Length of the binary files')).toHaveValue('000023');
  await expect.poll(async () => (await memoryRows(app))[0]).toMatch(/43 F9 00 00 10 10 10 3C 00 0E 4E 4F FF FF FF FF/);
  await expect.poll(() => app.page.title()).toContain('hello.S68');
});

test('Save S-Record asks S-Record Creation and writes the records of easybin.md 11.3', async ({ app }) => {
  await openHello(app);
  await typeInto(field(app, 'From'), '001000');
  await typeInto(field(app, 'To'), '001023');
  await app.chooseMenu('File', 'Save S-Record...');
  expect(await answer(app, 'Yes', 'S-Record Creation')).toBe(
    'S-Record file information:\n\nFrom:$001000  To:$001023\nStart Address:$00001000\n\nCreate S-Record?',
  );
  await choose(app, 'Save As', 'saved.S68', 'Save');
  await switchMode(app, 'Editor');
  await expect.poll(async () => Buffer.from(await app.exportFile('saved.S68')).toString('latin1')).toBe(SAVED);
});

test('Save Binary writes First Address for Length bytes; Open Binary loads them at First Address', async ({ app }) => {
  await openHello(app);
  await app.chooseMenu('File', 'Save Binary...');
  await choose(app, 'Save As', 'hello.bin', 'Save');
  await switchMode(app, 'Editor');
  const bytes = await app.exportFile('hello.bin');
  expect(bytes.length).toBe(0x23);
  expect(Buffer.from(bytes).subarray(0, 4).toString('hex').toUpperCase()).toBe('43F90000');
  await switchMode(app, 'EASyBIN');
  await app.chooseMenu('File', 'New');
  await answer(app, 'OK', 'Caution');
  await expect.poll(async () => (await memoryRows(app))[0]).toMatch(/FF FF FF FF/);
  await typeInto(field(app, 'First Address'), '002000');
  await app.chooseMenu('File', 'Open Binary...');
  await choose(app, 'Open', 'hello.bin', 'Open');
  await typeInto(field(app, 'Address'), '002000');
  await expect.poll(async () => (await memoryRows(app))[0]).toMatch(/43 F9 00 00 10 10/);
});

test('New asks Caution: Cancel keeps memory, OK fills it with FF and resets the fields', async ({ app }) => {
  await openHello(app);
  await app.chooseMenu('File', 'New');
  expect(await answer(app, 'Cancel', 'Caution')).toBe('The current environment will be lost, click OK to continue.');
  await expect.poll(async () => (await memoryRows(app))[0]).toMatch(/43 F9/);
  await app.chooseMenu('File', 'New');
  await answer(app, 'OK', 'Caution');
  await expect(field(app, 'Start Address')).toHaveValue('00000000');
  await expect(field(app, 'Address')).toHaveValue('000000');
  await typeInto(field(app, 'Address'), '001000');
  await expect.poll(async () => (await memoryRows(app))[0]).toMatch(/FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF FF/);
});

test('the Address field rounds a typed address down to a multiple of 16 (easybin.md 6.1)', async ({ app }) => {
  // The original undoes a last digit other than 0 at once (Address1Change). Found by this test and
  // repaired in features/easybin (errata X2.md entry 5): the field kept showing 003005.
  await switchMode(app, 'EASyBIN');
  await typeInto(field(app, 'Address'), '003005');
  await expect(field(app, 'Address')).toHaveValue('003000');
  await expect.poll(async () => (await memoryRows(app))[0]).toMatch(/^00003000:/);
  // A digit other than 0 in the last place but one stays: 003010 after 00301F.
  await typeInto(field(app, 'Address'), '00301F');
  await expect(field(app, 'Address')).toHaveValue('003010');
});

test('the memory area: typing hex, the Address field, Row and Page buttons', async ({ app, page }) => {
  await switchMode(app, 'EASyBIN');
  await typeInto(field(app, 'Address'), '003000');
  await expect(field(app, 'Address')).toHaveValue('003000');
  const area = workspace(app).getByRole('group', { name: 'Memory' });
  await area.focus();
  await page.keyboard.type('A5');
  await expect.poll(async () => (await memoryRows(app))[0]).toMatch(/A5 FF/);
  await workspace(app).getByRole('button', { name: 'Row down' }).click();
  await expect(field(app, 'Address')).toHaveValue('003010');
  await workspace(app).getByRole('button', { name: 'Row up' }).click();
  await expect(field(app, 'Address')).toHaveValue('003000');
  await workspace(app).getByRole('button', { name: 'Page down' }).click();
  await expect(field(app, 'Address')).not.toHaveValue('003000');
});

test('Copy and Fill: From / To, Size and the fill byte', async ({ app }) => {
  await openHello(app);
  await typeInto(field(app, 'From'), '001000');
  await typeInto(field(app, 'To'), '004000');
  await typeInto(field(app, 'Size'), '000004');
  await workspace(app).getByRole('button', { name: 'Copy', exact: true }).click();
  await typeInto(field(app, 'Address'), '004000');
  await expect.poll(async () => (await memoryRows(app))[0]).toMatch(/43 F9 00 00 FF/);
  await typeInto(field(app, 'From'), '004001');
  await typeInto(field(app, 'To'), '004002');
  await typeInto(field(app, 'Fill byte'), '77');
  await workspace(app).getByRole('button', { name: 'Fill', exact: true }).click();
  await expect.poll(async () => (await memoryRows(app))[0]).toMatch(/43 77 77 00 FF/);
});

test('Help: EASyBIN Help opens easybin.htm; About EASyBIN shows the original texts and the notice', async ({ app }) => {
  await switchMode(app, 'EASyBIN');
  await app.chooseMenu('Help', 'EASyBIN Help');
  const frame = app.page.locator('[data-e68-panel="help"] iframe');
  await expect
    .poll(async () => (await (await frame.first().elementHandle())?.contentFrame())?.url() ?? '')
    .toMatch(/easybin\.htm/i);
  await app.chooseMenu('Help', 'About EASyBIN');
  const about = app.dialog('About EASyBIN');
  await expect(about).toBeVisible();
  await expect(about).toContainText('By: Chuck Kelly');
  await expect(about).toContainText('www.easy68k.com');
  await expect(about).toContainText(/unofficial/i);
  await app.button(about, 'OK').click();
  await expect(about).toBeHidden();
});

test('Binary Input/Output Split: 1, 2 or 4 files, and the File Split digits follow', async ({ app }) => {
  await switchMode(app, 'EASyBIN');
  const split = workspace(app).getByRole('radiogroup');
  const radios = await split.getByRole('radio').allTextContents();
  expect(radios.length).toBe(3);
  await expect(workspace(app).getByLabel('File Split: 1 file(s)')).toBeAttached();
  await split.getByRole('radio').nth(1).check();
  await expect(workspace(app).getByLabel('File Split: 2 file(s)')).toBeAttached();
  await split.getByRole('radio').nth(2).check();
  await expect(workspace(app).getByLabel('File Split: 4 file(s)')).toBeAttached();
  // New resets the split to one file (easybin.md 9 step 4).
  await app.chooseMenu('File', 'New');
  await answer(app, 'OK', 'Caution');
  await expect(workspace(app).getByLabel('File Split: 1 file(s)')).toBeAttached();
});

test('F1 in the About box opens the credits page (easybin.md 15)', async ({ app, page }) => {
  await switchMode(app, 'EASyBIN');
  await app.chooseMenu('Help', 'About EASyBIN');
  const about = app.dialog('About EASyBIN');
  await expect(about).toBeVisible();
  await page.keyboard.press('F1');
  const frame = app.page.locator('[data-e68-panel="help"] iframe');
  await expect
    .poll(async () => (await (await frame.first().elementHandle())?.contentFrame())?.url() ?? '')
    .toMatch(/credits\.htm/i);
  if (await about.isVisible()) await app.button(about, 'OK').click();
});

test('the fields follow the layout in the Tab order (easybin.md Q18)', async ({ app }) => {
  await switchMode(app, 'EASyBIN');
  const order = await workspace(app)
    .locator('input:not([type=radio])')
    .evaluateAll((inputs) => inputs.map((input) => input.getAttribute('aria-label')));
  expect(order).toEqual([
    'Start Address',
    'First Address',
    'Length of the binary files',
    'From',
    'To',
    'Size',
    'Fill byte',
    'Address',
  ]);
});

test('File > Exit ends the application as the other modes do (easybin.md 19 item 4)', async ({ app }) => {
  await switchMode(app, 'EASyBIN');
  await app.chooseMenu('File', 'Exit');
  await expect(app.page.getByText('You can close this tab.')).toBeVisible();
});

test('a file dropped on EASyBIN opens it (easybin.md 1.4)', async ({ app }) => {
  await switchMode(app, 'EASyBIN');
  await app.dropFiles([{ name: 'dropped.S68', data: new Uint8Array(HELLO) }], '[data-e68-workspace="easybin"]');
  await answer(app, 'OK', 'EASyBIN');
  await expect(field(app, 'Start Address')).toHaveValue('00001000');
  await expect.poll(() => app.page.title()).toContain('dropped.S68');
});

void ((_: Locator) => undefined);
