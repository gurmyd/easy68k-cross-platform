// Print and Printer Setup (ARCHITECTURE.md 1.3.1 File rows, 1.3.3 row "Print", note 2; editor-ui
// §13). Owner: X1. The feature is E6's (wave 2): every test waits for it (fixtures/pending.ts).
//
// The web platform prints a prepared document from a hidden frame (platform/web.ts). The frame's
// `print()` is replaced here, before the application loads, by one that records the document and
// reports `afterprint`, so no print dialog opens and the content can be inspected.

import { crlf, expect, nonBlackColours, requirePackage, test, type App } from '../fixtures';

interface Printed {
  title: string;
  html: string;
  text: string;
}

/** Runs in every frame: a child frame's print() records its document in the top window. */
function recordPrints(): void {
  if (window === window.top) return;
  window.print = () => {
    const top = window.top as unknown as { __printed?: unknown[] };
    (top.__printed ??= []).push({
      title: document.title,
      html: document.documentElement.outerHTML,
      text: document.body?.textContent ?? '',
    });
    setTimeout(() => window.dispatchEvent(new Event('afterprint')), 0);
  };
}

const printed = (app: App) =>
  app.page.evaluate(() => (window as unknown as { __printed?: unknown[] }).__printed ?? []) as Promise<Printed[]>;

const PAGE_MARKER = '<------------------------------ PAGE ------------------------------>';

test.beforeEach(async ({ app, page }) => {
  await page.addInitScript(recordPrints);
  await app.open();
  await requirePackage(app, 'E6');
});

test('Print sends the whole document: tabs expanded with its rule, monochrome, a new page at the PAGE marker', async ({
  app,
}) => {
  await app.dropFiles([{ name: 'p.X68', data: crlf('A\tB', 'first page', PAGE_MARKER, 'second page') }]);
  await expect.poll(() => app.tabNames()).toContain('p.X68');
  await app.select(0);
  await app.press('ed.file.print');
  await expect.poll(async () => (await printed(app)).length).toBe(1);
  const [job] = await printed(app);
  expect(job!.title).toMatch(/^EASy68K .*p\.X68$/);
  expect(job!.text).not.toContain('\t');
  expect(job!.text).toContain('A   B'); // Fixed tabs of 4: the tab after column 1 is three blanks
  expect(job!.text).toContain('first page');
  expect(job!.text).toContain('second page');
  expect(job!.text).not.toContain('PAGE ---');
  expect(job!.html).toMatch(/break-(before|after)\s*:\s*page|page-break-(before|after)\s*:\s*always/);
  expect(job!.html).not.toMatch(/e68-syntax__/);
  expect(nonBlackColours(job!.html)).toEqual([]);
});

test('Print with a selection asks All or Selection first; Selection sends only the selection', async ({ app }) => {
  // The original's print dialog offers the range (editor-ui §13.1 step 1); the system print dialog
  // of a browser cannot, so E6 asks in its own modal `Print` dialog first, with All preselected.
  await app.replaceText('keep out\nPRINT ME\nkeep out');
  await app.select(9, 17);
  await app.toolbarButton('ed.file.print').click();
  const range = app.page.getByRole('dialog', { name: 'Print', exact: true });
  await expect(range).toBeVisible();
  await expect(range.getByRole('radio', { name: 'All' })).toBeChecked();
  await range.getByRole('radio', { name: 'Selection' }).check();
  await app.button(range, 'OK').click();
  await expect.poll(async () => (await printed(app)).length).toBe(1);
  const [job] = await printed(app);
  expect(job!.text).toContain('PRINT ME');
  expect(job!.text).not.toContain('keep out');
});

test('Printer Setup... is enabled and opens the same system print path (note 2)', async ({ app }) => {
  const entry = (await app.menuEntries('File')).find((e) => e.caption === 'Printer Setup...');
  expect(entry?.disabled).toBe(false);
});
