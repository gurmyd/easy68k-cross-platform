// Helpers of the simulator suites (ARCHITECTURE.md 6.6, tests/e2e/sim). Owner: X2.
//
// They build on X1's page object (tests/e2e/fixtures/app.ts) and follow its rules: everything is
// done through the interface of the PRODUCTION build (menus, toolbar, keys, panels, dialogs), and
// what is read is what a user sees:
//
//   registers     the twenty fields of the Registers panel (`input[data-box]`)
//   run state     the first cell of the status bar (`[data-e68-status="run"]`: Stopped, Running,
//                 Halted, Waiting for input, Auto trace, ...)
//   listing       the rows of the Listing panel (`[role=option][data-row]`, with data-pc and data-bp)
//   messages      the rows of the Messages panel that are on screen (the panel follows the last line)
//   output text   the Output panel's text mirror for screen readers (`role=log`), which follows the
//                 text screen at most twice per second (2.11)
//   output pixels the canvas of the Output panel, whose backing store is exactly the surface
//
// Programs are assembled by the real assembler in Editor mode and handed to the simulator with the
// Assembler Status dialog's Execute (1.4 note 20), as a student does.

import { createHash } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import type { KnownCommandId } from '../../../app/src/commands/ids';
import { chordOf, expect, type App } from '../fixtures';

/** Register field numbers (contracts `Box`): D0-D7, A0-A7, US, SS, PC, SR. */
export const BOX = {
  D0: 0,
  D1: 1,
  D2: 2,
  D3: 3,
  D4: 4,
  D5: 5,
  D6: 6,
  D7: 7,
  A0: 8,
  A1: 9,
  A2: 10,
  A3: 11,
  A4: 12,
  A5: 13,
  A6: 14,
  A7: 15,
  US: 16,
  SS: 17,
  PC: 18,
  SR: 19,
} as const;
export type BoxName = keyof typeof BOX;

/** The nine run commands of sim-ui §3.6 and the two log commands, as toolbar command ids. */
export const RUN_COMMANDS = [
  'sim.run.run',
  'sim.run.runToCursor',
  'sim.run.autoTrace',
  'sim.run.stepOver',
  'sim.run.traceInto',
  'sim.run.pause',
  'sim.run.rewind',
  'sim.run.reload',
] as const;

/** Source lines of a program; `END START` and `ORG $1000` are the caller's. */
export type Source = readonly string[];

/** The simulator's workspace. */
export function workspace(app: App): Locator {
  return app.page.locator('[data-e68-workspace="simulator"]');
}

/** A panel of Simulator mode by its id (registers, listing, messages, output, memory, ...). */
export function panel(app: App, id: string): Locator {
  return workspace(app).locator(`[data-e68-panel="${id}"]`);
}

// ---- modes ----------------------------------------------------------------------------------

/** Switches the mode with the mode switch of the title bar (a radio group named Mode). */
export async function switchMode(app: App, mode: 'Editor' | 'Simulator' | 'EASyBIN'): Promise<void> {
  await app.page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: mode, exact: true }).click();
  await expect.poll(() => app.mode()).toBe(mode.toLowerCase());
}

// ---- programs -------------------------------------------------------------------------------

/**
 * Puts `lines` into the start-up document (or, with `name`, saves it first as `name` in My
 * Programs, so that the program's folder and file names are known), assembles it with F9 and
 * checks that it assembled without errors. Returns the Assembler Status dialog, still open.
 */
export async function assemble(app: App, lines: Source, name?: string): Promise<Locator> {
  if ((await app.mode()) !== 'editor') await switchMode(app, 'Editor');
  await app.replaceText(lines.join('\n'));
  if (name) await app.saveAs(name);
  const active = (await app.tabs()).find((tab) => tab.selected)?.name ?? 'untitled1.x68';
  const title = `Assembler Status - ${active}`;
  await app.focusEditor();
  await app.press('ed.project.assemble');
  const dialog = app.dialog(title);
  // The first assembly of a window starts the assembler engine: generous on a loaded machine.
  await expect(dialog, `the dialog "${title}" after F9`).toBeVisible({ timeout: 60_000 });
  const text = await dialog.innerText();
  expect(text, `the program assembles without errors:\n${lines.join('\n')}`).toMatch(/Errors:\s*0/);
  return dialog;
}

/** File > New X68 Source File in Editor mode: the next program goes into a document of its own. */
export async function newDocument(app: App): Promise<void> {
  if ((await app.mode()) !== 'editor') await switchMode(app, 'Editor');
  const before = (await app.tabs()).length;
  await app.chooseMenu('File', 'New X68 Source File');
  await expect.poll(async () => (await app.tabs()).length).toBe(before + 1);
}

/**
 * Assembles `lines` and starts it in the simulator with Execute: Simulator mode, the program loaded
 * and not running (1.4 note 20). Waits until the listing shows the program and the run commands are
 * enabled.
 */
export async function execute(app: App, lines: Source, name?: string): Promise<void> {
  const dialog = await assemble(app, lines, name);
  await app.button(dialog, 'Execute').click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => app.mode()).toBe('simulator');
  await expect(listingRows(app).first()).toBeVisible();
  await expect(app.toolbarButton('sim.run.run')).toBeEnabled();
  await expect(app.toolbarButton('sim.run.traceInto')).toBeEnabled();
}

// ---- registers ------------------------------------------------------------------------------

export function register(app: App, box: BoxName): Locator {
  return panel(app, 'registers').locator(`input[data-box="${BOX[box]}"]`);
}

/** The text of a register field (8 hex digits, 16 binary digits for SR). */
export async function reg(app: App, box: BoxName): Promise<string> {
  return register(app, box).inputValue();
}

/** Waits until a register shows `text`. */
export async function expectReg(app: App, box: BoxName, text: string, message?: string): Promise<void> {
  await expect(register(app, box), message ?? `${box}=`).toHaveValue(text);
}

/**
 * Types `digits` into a masked field from its first position, as a user does after clicking at its
 * left end: the field is focused by the keyboard (a register field then selects its whole text,
 * 4.4), Home puts the caret before the first digit, and each digit overwrites one position.
 */
export async function typeInto(field: Locator, digits: string): Promise<void> {
  await field.focus();
  await expect(field).toBeFocused();
  await field.press('Home');
  await field.pressSequentially(digits);
}

/** The cycle counter's text. */
export async function cycles(app: App): Promise<string> {
  return (await panel(app, 'registers').locator('[data-cycles]').textContent()) ?? '';
}

// ---- run state ------------------------------------------------------------------------------

/** The status bar's run state (Stopped, Running, Halted, Waiting for input, Auto trace, ...). */
export function runState(app: App): Locator {
  return app.page.locator('[data-e68-status="run"]');
}

/** Waits for the run state. */
export async function expectState(app: App, state: string | RegExp): Promise<void> {
  await expect(runState(app)).toHaveText(state);
}

/** Runs a command with its toolbar button. */
export async function tool(app: App, id: string): Promise<void> {
  const button = app.toolbarButton(id);
  await expect(button, `toolbar button ${id}`).toBeEnabled();
  await button.click();
}

/**
 * Trace Into or Step Over with its key, as a user steps: when the command is enabled again (a key
 * pressed while the previous step still runs does nothing, sim-ui §3.6), and waits until the PC
 * field shows the next instruction.
 */
export async function step(
  app: App,
  id: 'sim.run.traceInto' | 'sim.run.stepOver' = 'sim.run.traceInto',
): Promise<void> {
  await expect(app.toolbarButton(id), `${id} is enabled before the step`).toBeEnabled();
  const before = await reg(app, 'PC');
  await app.press(id);
  await expect.poll(() => reg(app, 'PC'), { message: `${id} moved the PC from ${before}` }).not.toBe(before);
}

/**
 * Presses a command's chord with the keyboard in the Listing panel. After Run the Output panel has
 * the keyboard (trap15-a §3.9), where the port's added Shift+F<n> chords - the first chords of Rewind
 * and Reload on the macOS key map - belong to the program (K3, 2.9.4); a user clicks the listing first.
 */
export async function pressInListing(app: App, id: KnownCommandId): Promise<void> {
  // A chord of a disabled command does nothing; the state that enables it may be a frame away.
  const button = app.toolbarButton(id);
  if ((await button.count()) > 0) await expect(button, `${id} is enabled before its chord`).toBeEnabled();
  await listing(app).focus();
  await app.press(id);
}

/** The enabled state of every run command's toolbar button, in toolbar order. */
export async function enabledCommands(app: App): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};
  for (const id of RUN_COMMANDS) result[id] = await app.toolbarButton(id).isEnabled();
  return result;
}

// ---- listing --------------------------------------------------------------------------------

export function listing(app: App): Locator {
  return panel(app, 'listing').locator('[role=listbox]');
}

export function listingRows(app: App): Locator {
  return listing(app).locator('[role=option]');
}

/** The listing row whose text contains `text` (the first one). */
export function listingRow(app: App, text: string | RegExp): Locator {
  return listingRows(app).filter({ hasText: text }).first();
}

/** The text of the listing row that carries the PC marker, or null. */
export async function pcRowText(app: App): Promise<string | null> {
  const row = listingRows(app).and(app.page.locator('[data-pc="true"]'));
  return (await row.count()) > 0 ? ((await row.first().textContent()) ?? '').trim() : null;
}

/** The text of the selected listing row, or null. */
export async function selectedRowText(app: App): Promise<string | null> {
  const row = listingRows(app).and(app.page.locator('[aria-selected="true"]'));
  return (await row.count()) > 0 ? ((await row.first().textContent()) ?? '').trim() : null;
}

/** The breakpoint gutter of a listing row. */
export function gutter(row: Locator): Locator {
  return row.locator('.e68-listing__gutter');
}

// ---- messages and output --------------------------------------------------------------------

/** The lines of the Messages panel that are on screen (the panel follows the last line). */
export async function messages(app: App): Promise<string[]> {
  return panel(app, 'messages').locator('[role=listitem]').allTextContents();
}

/** The Output panel's text, one string per line, trailing blanks removed. */
export async function outputText(app: App): Promise<string[]> {
  const rows = await panel(app, 'output')
    .locator('[role=log][aria-label="Text of the Output panel"] > div')
    .allTextContents();
  return rows.map((row) => row.replace(/\s+$/, ''));
}

/** Waits until the Output panel's text contains a line that matches. */
export async function expectOutputLine(app: App, line: string | RegExp): Promise<void> {
  await expect
    .poll(
      async () => (await outputText(app)).some((text) => (typeof line === 'string' ? text === line : line.test(text))),
      {
        message: `a line ${String(line)} in the Output panel`,
      },
    )
    .toBe(true);
}

/** The program's keyboard: the Output panel's hidden field. */
export function programKeys(app: App): Locator {
  return panel(app, 'output').locator('textarea[data-e68-keys="program"]');
}

/** The canvas of the Output panel. */
export function canvas(app: App): Locator {
  return panel(app, 'output').locator('canvas.e68-output__canvas');
}

/** The size of the surface (the canvas's backing store) and a hash of its pixels. */
export async function surface(app: App): Promise<{ width: number; height: number; hash: string; colours: number }> {
  const data = await canvas(app).evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext('2d');
    if (!context) throw new Error('the Output canvas has no 2d context');
    const image = context.getImageData(0, 0, element.width, element.height);
    // RGB only, as a string of bytes: the alpha channel of an opaque canvas is always 255.
    const rgb = new Uint8Array((image.data.length / 4) * 3);
    const colours = new Set<number>();
    for (let i = 0, j = 0; i < image.data.length; i += 4, j += 3) {
      rgb[j] = image.data[i]!;
      rgb[j + 1] = image.data[i + 1]!;
      rgb[j + 2] = image.data[i + 2]!;
      if (colours.size < 64) colours.add((image.data[i]! << 16) | (image.data[i + 1]! << 8) | image.data[i + 2]!);
    }
    let text = '';
    for (let i = 0; i < rgb.length; i += 0x8000) text += String.fromCharCode(...rgb.subarray(i, i + 0x8000));
    return { width: element.width, height: element.height, bytes: btoa(text), colours: colours.size };
  });
  const hash = createHash('sha256').update(Buffer.from(data.bytes, 'base64')).digest('hex');
  return { width: data.width, height: data.height, hash, colours: data.colours };
}

/** The colour of one pixel of the surface as `#rrggbb`. */
export async function pixel(app: App, x: number, y: number): Promise<string> {
  return canvas(app).evaluate(
    (element: HTMLCanvasElement, [px, py]) => {
      const [r, g, b] = element.getContext('2d')!.getImageData(px, py, 1, 1).data;
      return `#${[r, g, b].map((v) => v!.toString(16).padStart(2, '0')).join('')}`;
    },
    [x, y] as const,
  );
}

// ---- panels and dialogs ---------------------------------------------------------------------

/** Shows a tool panel with its View menu entry and waits for it. */
export async function view(app: App, caption: string, id: string): Promise<Locator> {
  await app.chooseMenu('View', caption);
  const shown = panel(app, id);
  await expect(shown, `View > ${caption} shows the panel ${id}`).toBeVisible();
  return shown;
}

/**
 * Chooses `name` in My Programs in the open file dialog `title` and presses `button`. The dialogs of
 * the simulator start in the folder of the loaded program, which for an unsaved document is not My
 * Programs, so "Look in" goes there first.
 */
export async function chooseInMyPrograms(
  app: App,
  title: string,
  name: string,
  button: 'Open' | 'Save',
): Promise<void> {
  const dialog = app.page.getByRole('dialog', { name: title, exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Look in:').selectOption({ label: 'My Programs' });
  await app.fileDialogName(dialog, name, button);
  await expect(dialog).toBeHidden();
}

/** Answers the message box on top with `button` and returns its text. */
export async function answer(app: App, button: string, title?: string): Promise<string> {
  const box = title ? app.dialog(title) : app.messageBox;
  await expect(box).toBeVisible();
  const text = await app.boxText(box);
  const target = app.button(box, button);
  // Once seen in WebKit on a loaded machine (1 of 496): the box was shown, but the click waited 45 s
  // for its button to become "stable". The keyboard does what the click does, without that wait.
  await target.click({ timeout: 10_000 }).catch(async () => {
    await target.focus();
    await target.press('Enter');
  });
  await expect(box).toBeHidden();
  return text;
}

/**
 * Presses the first chord of a command on the page's key map, like `App.press`, also for the chords
 * the macOS key map writes with `Option` (`Ctrl+Option+O`, `Option+Return`): Option is the Alt key,
 * and the letter is pressed by its position (rule K6).
 */
export async function pressCommand(app: App, id: KnownCommandId): Promise<void> {
  const chord = chordOf(id, app.keys).replace(/\bOption\b/g, 'Alt');
  await app.pressChord(chord);
}

/** Presses a key with a hold, so that a polling program sees it (6.6, "hold keys and buttons"). */
export async function hold(page: Page, key: string, until: () => Promise<unknown>): Promise<void> {
  await page.keyboard.down(key);
  try {
    await until();
  } finally {
    await page.keyboard.up(key);
  }
}

/** Lines of a program with ORG $1000 and END START around `body`; START labels the first line. */
export function program(...body: string[]): string[] {
  return ['    ORG    $1000', 'START:', ...body, '    END    START'];
}
