// What checks 6-8 do in the application's window (ARCHITECTURE.md 6.7), step by step, through the
// interface a student uses: the toolbar buttons, the assembler's status dialog, the Simulator
// mode's panels and status bar. The packaged app is a production build without test hooks
// (no window.__easy68k), so everything is read from the page as it is shown.
//
// The functions take a Playwright Page and nothing else, so that the same steps can be rehearsed
// against the development build (Playwright's Electron launcher) on a machine without a Mac.
//
// Owner: DV5.

import type { Locator, Page } from '@playwright/test';
import { registerText } from '../facts';

const SIM = '[data-e68-workspace="simulator"]';
/** A step of the application may take this long on a slow runner before it counts as failed. */
export const STEP_MS = 60_000;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Polls `probe` until it returns a value that is not null; null after `ms`. */
export async function poll<T>(ms: number, probe: () => Promise<T | null> | T | null, every = 100): Promise<T | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const value = await probe();
      if (value !== null) return value;
    } catch {
      // the page may be between two renders
    }
    if (Date.now() > deadline) return null;
    await sleep(every);
  }
}

export const toolbarButton = (page: Page, id: string): Locator =>
  page.locator(`.e68-shell__toolbar [data-command="${id}"]`).first();

/** The shell's status bar of the mode shown. */
export const shellStatus = (page: Page, mode: 'editor' | 'simulator'): Locator =>
  page.locator(`footer.e68-statusbar[data-mode="${mode}"]`);

/** Simulator mode's run state ("Halted", "Running", ...) and PC register field. */
export const runState = (page: Page): Locator => page.locator('[data-e68-status="run"]').first();
export const pcField = (page: Page): Locator => page.locator('.e68-regs input[data-box="18"]').first();

/** Waits until Editor mode shows a document of this name (the shell's status bar names it). */
export async function waitForEditorDocument(page: Page, name: string): Promise<string> {
  const footer = shellStatus(page, 'editor');
  const text = await poll(
    STEP_MS * 1.5,
    async () => {
      const shown = await footer.innerText({ timeout: 2000 });
      return shown.toLowerCase().includes(name.toLowerCase()) ? shown : null;
    },
    250,
  );
  if (text === null) {
    const seen = await page
      .locator('footer.e68-statusbar')
      .allInnerTexts()
      .catch(() => []);
    throw new Error(`Editor mode did not show ${name}; status bars: ${JSON.stringify(seen)}`);
  }
  return text;
}

export interface AssembleStatus {
  title: string;
  errors: string;
  warnings: string;
  executeEnabled: boolean;
}

const statusDialog = (page: Page): Locator => page.locator('[role=dialog].e68-asm-status');

/** Project > Assemble Source with the toolbar button; returns what the status dialog says. */
export async function assembleActive(page: Page): Promise<AssembleStatus> {
  await toolbarButton(page, 'ed.project.assemble').click({ timeout: STEP_MS });
  const dialog = statusDialog(page);
  await dialog.waitFor({ timeout: STEP_MS });
  const footer = dialog.locator('.e68-dialog__footer');
  return {
    title: await dialog.locator('.e68-dialog__title').innerText(),
    errors: await dialog.locator('[data-e68-count=errors]').innerText(),
    warnings: await dialog.locator('[data-e68-count=warnings]').innerText(),
    executeEnabled: await footer.getByRole('button', { name: 'Execute', exact: true }).isEnabled(),
  };
}

/**
 * The status dialog's Execute (the Caution question about the lost debug environment, if asked,
 * answered OK); returns when Simulator mode shows the program with its start address in the PC.
 */
export async function executeFromStatus(page: Page, start: number): Promise<void> {
  const dialog = statusDialog(page);
  await dialog.locator('.e68-dialog__footer').getByRole('button', { name: 'Execute', exact: true }).click();
  await dialog.waitFor({ state: 'detached', timeout: STEP_MS });
  const caution = page.locator('[role=alertdialog]', { hasText: 'debug environment will be lost' });
  if ((await poll(1000, async () => ((await caution.count()) > 0 ? true : null))) === true) {
    await caution.getByRole('button', { name: 'OK' }).click();
  }
  await shellStatus(page, 'simulator').waitFor({ state: 'visible', timeout: STEP_MS });
  const pc = await poll(
    STEP_MS,
    async () => ((await pcField(page).inputValue()) === registerText(start) ? true : null),
    200,
  );
  if (pc === null) {
    throw new Error(
      `after Execute the PC is ${await pcField(page)
        .inputValue()
        .catch(() => '?')}, not ${registerText(start)}; ` +
        `run state "${await runState(page)
          .innerText()
          .catch(() => '?')}"`,
    );
  }
}

/** The Registers panel's Cycles count as shown, or null when it is not a number ("Overflow"). */
export async function cyclesShown(page: Page): Promise<bigint | null> {
  const text = (await page.locator(`${SIM} .e68-regs__cycles[data-cycles]`).first().innerText()).trim();
  return /^\d+$/.test(text) ? BigInt(text) : null;
}

/**
 * Run with the toolbar button; returns "Halted" once the program has run to its end, or what was
 * seen last. The end is the halt AFTER instructions were executed: the run state Halted and the
 * Cycles count above the one before the click. A run state alone is not enough: a Run given while
 * a load ends is kept and carried out afterwards (errata SH8.md entries 47 and 48), and a state
 * that is not "Running" says nothing about whether the Run has happened yet.
 */
export async function runToHalt(page: Page, ms = STEP_MS): Promise<string> {
  const before = (await cyclesShown(page).catch(() => null)) ?? 0n;
  await toolbarButton(page, 'sim.run.run').click({ timeout: STEP_MS });
  const halted = await poll(
    ms,
    async () => {
      if ((await runState(page).innerText()) !== 'Halted') return null;
      const after = await cyclesShown(page);
      return after === null || after > before ? 'Halted' : null; // "Overflow" has run, too
    },
    100,
  );
  if (halted !== null) return halted;
  const state = await runState(page)
    .innerText()
    .catch(() => '?');
  const cycles = await cyclesShown(page).catch(() => null);
  return state === 'Halted' ? `Halted, but the Cycles count is ${cycles ?? '?'} as before the Run (${before})` : state;
}

/** Trace Into with the toolbar button; returns the PC once it has moved away from `from`. */
export async function traceInto(page: Page, from: string): Promise<string> {
  await toolbarButton(page, 'sim.run.traceInto').click({ timeout: STEP_MS });
  const moved = await poll(STEP_MS / 2, async () => {
    const pc = await pcField(page).inputValue();
    return pc !== from ? pc : null;
  });
  if (moved === null) throw new Error(`Trace Into did not move the PC from ${from}`);
  return moved;
}

/**
 * The lines of Simulator mode's message area as rendered, and how many lines the list holds (its
 * virtual height over the row height). Only the visible rows are rendered; for the programs of
 * these checks the list is short enough to be shown whole, and `total` says whether it was.
 */
export async function messageLines(page: Page): Promise<{ lines: string[]; total: number }> {
  return page
    .locator(`${SIM} [data-e68-panel="messages"] .e68-messages__list`)
    .first()
    .evaluate((list) => {
      const rows = [...list.querySelectorAll<HTMLElement>('[role=listitem]')];
      const sizer = list.querySelector<HTMLElement>('.e68-vlist__sizer');
      const rowHeight = rows[0]?.getBoundingClientRect().height ?? 0;
      const total = rowHeight > 0 && sizer ? Math.round(sizer.getBoundingClientRect().height / rowHeight) : rows.length;
      return { lines: rows.map((row) => row.textContent ?? ''), total };
    });
}

/** The text rows of the Output panel as shown (trailing blanks removed). */
export async function outputRows(page: Page): Promise<string[]> {
  const rows = await page
    .locator(`${SIM} [data-e68-panel="output"] [role=log] > div`)
    .evaluateAll((elements) => elements.map((element) => (element.textContent ?? '').replace(/[\s\0]+$/, '')));
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  return rows;
}

export interface CanvasPixels {
  width: number;
  height: number;
  /** The canvas's size on the page, in CSS pixels. */
  shownWidth: number;
  shownHeight: number;
  rgba: Uint8Array;
}

/** The pixels of the Output panel's canvas (its backing store: one canvas pixel per surface pixel). */
export async function outputCanvas(page: Page): Promise<CanvasPixels> {
  const canvas = page.locator(`${SIM} [data-e68-panel="output"] canvas.e68-output__canvas`).first();
  const read = await canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const context = target.getContext('2d');
    if (!context) throw new Error('the Output canvas has no 2D context');
    const { width, height } = target;
    const data = context.getImageData(0, 0, width, height).data;
    let text = '';
    for (let offset = 0; offset < data.length; offset += 0x8000) {
      text += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
    }
    const box = target.getBoundingClientRect();
    return { width, height, shownWidth: box.width, shownHeight: box.height, base64: btoa(text) };
  });
  return {
    width: read.width,
    height: read.height,
    shownWidth: read.shownWidth,
    shownHeight: read.shownHeight,
    rgba: new Uint8Array(Buffer.from(read.base64, 'base64')),
  };
}
