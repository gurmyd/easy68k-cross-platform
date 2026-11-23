// The short scenario of N9 for the dock (ARCHITECTURE-PLUS P3.1.4, P3.1.6; P5 N9 acceptance "panels
// moved in both modes survive a reload"). Owner: N9. Run online by layout.spec.ts and with the
// network cut after the first load by offline.spec.ts.
//
// Every move is made as a student without a mouse makes it: `Move Panel To...` (Window menu in
// Editor mode, View menu in Simulator mode) and its dialog. Where a panel is, is read from the boxes
// of the panels' regions (`data-e68-panel`), what a person sees on the screen.

import { expect, test } from '@playwright/test';
import { ANNOUNCE } from '../../../app/src/ui/dock/texts';
import type { App } from '../fixtures';
import { dockAnnouncement, movePanel, regionBox, switchMode } from '../fixtures/plus';

export type Box = NonNullable<Awaited<ReturnType<typeof regionBox>>>;

/** The boxes of panels of the shown mode; fails when one is not shown. */
export async function boxes(app: App, panels: readonly string[]): Promise<Record<string, Box>> {
  const out: Record<string, Box> = {};
  for (const panel of panels) {
    const box = await regionBox(app, panel);
    expect(box, `the panel ${panel} is shown`).not.toBeNull();
    out[panel] = box!;
  }
  return out;
}

/** Editor mode with Files at the right edge: Files right of the Editor and of Messages. */
async function filesAtRight(app: App): Promise<boolean> {
  const b = await boxes(app, ['files', 'editor', 'messages']);
  return b.files!.left >= b.editor!.right && b.files!.left >= b.messages!.right;
}

/** Simulator mode with Messages below Output: in the right column, under Output. */
async function messagesBelowOutput(app: App): Promise<boolean> {
  const b = await boxes(app, ['registers', 'listing', 'messages', 'output']);
  return (
    b.messages!.top >= b.output!.bottom &&
    b.messages!.left >= b.listing!.right &&
    Math.abs(b.messages!.left - b.output!.left) <= 1 &&
    // Listing takes the height of the left column that Messages had.
    b.listing!.bottom > b.messages!.top
  );
}

/** The `Lock Layout` item of a menu as drawn: checked or not. */
export async function lockChecked(app: App, menu: 'Window' | 'View'): Promise<boolean | null> {
  const entry = (await app.menuEntries(menu)).find((item) => item.caption === 'Lock Layout');
  return entry?.checked ?? null;
}

/** Moves a panel in each mode, reloads, and finds both arrangements as they were left. */
export async function movedPanelsSurviveReload(app: App, reload: () => Promise<void>): Promise<void> {
  await test.step("today's arrangement first: Files at the left, Editor above Messages, locked", async () => {
    const start = await boxes(app, ['files', 'editor', 'messages']);
    expect(start.files!.right).toBeLessThanOrEqual(start.editor!.left);
    expect(start.editor!.bottom).toBeLessThanOrEqual(start.messages!.top);
    expect(await lockChecked(app, 'Window'), 'Lock Layout is on by default (D2)').toBe(true);
  });

  await test.step('Editor mode: Files to the right edge of the window', async () => {
    await movePanel(app, 'Window', 'Files', { edge: 'Right' });
    await expect.poll(() => filesAtRight(app)).toBe(true);
    await expect.poll(() => dockAnnouncement(app, 'editor')).toBe(ANNOUNCE.edge('Files', 'right'));
    // A move keeps the lock (P3.1.4) and the panel's visibility (P1.1 rule 4).
    expect(await lockChecked(app, 'Window')).toBe(true);
    await expect(app.toolbarButton('app.files.toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  await test.step('Simulator mode: Messages beside Output, below it', async () => {
    await switchMode(app, 'Simulator');
    const before = await boxes(app, ['registers', 'listing', 'messages', 'output']);
    expect(before.messages!.right, 'by default Messages is in the left column').toBeLessThanOrEqual(
      before.output!.left,
    );
    await movePanel(app, 'View', 'Messages', { beside: 'Output', side: 'Below' });
    await expect.poll(() => messagesBelowOutput(app)).toBe(true);
    await expect.poll(() => dockAnnouncement(app, 'simulator')).toBe(ANNOUNCE.beside('Messages', 'Output', 'below'));
    expect(await lockChecked(app, 'View')).toBe(true);
    // The hidden tool panels stay hidden (P1.1 rule 4).
    expect(await regionBox(app, 'memory')).toBeNull();
    expect(await regionBox(app, 'hardware')).toBeNull();
  });

  await test.step('after a reload both arrangements are back', async () => {
    await reload();
    expect(await app.mode()).toBe('editor');
    await expect.poll(() => filesAtRight(app), { message: 'Editor mode: Files at the right edge' }).toBe(true);
    await switchMode(app, 'Simulator');
    await expect.poll(() => messagesBelowOutput(app), { message: 'Simulator mode: Messages below Output' }).toBe(true);
    expect(await regionBox(app, 'memory')).toBeNull();
    expect(await lockChecked(app, 'View')).toBe(true);
    await switchMode(app, 'Editor');
    await expect.poll(() => filesAtRight(app)).toBe(true);
  });
}
