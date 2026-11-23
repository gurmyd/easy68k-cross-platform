// Panels that can be moved and docked (ARCHITECTURE-PLUS P3.1; P5 N9 acceptance "panels moved in
// both modes survive a reload"). Owner: N9. The same scenario runs with the network cut after the
// first load in offline.spec.ts.

import { ANNOUNCE } from '../../../app/src/ui/dock/texts';
import { expect, test, type App } from '../fixtures';
import { dockAnnouncement, movePanel, switchMode } from '../fixtures/plus';
import { boxes, lockChecked, movedPanelsSurviveReload } from './arrangement';

test('panels moved in Editor mode and in Simulator mode are where they were put after a reload', async ({ app }) => {
  test.setTimeout(180_000);
  await movedPanelsSurviveReload(app, () => app.open());
});

test("Reset Layout puts today's arrangement back after a reload, keeps the panels' visibility and the lock", async ({
  app,
}) => {
  test.setTimeout(180_000);
  const start = await boxes(app, ['files', 'editor', 'messages']);
  const messagesOnTop = async () => {
    const b = await boxes(app, ['messages', 'editor']);
    return b.messages!.bottom <= b.editor!.top;
  };
  await movePanel(app, 'Window', 'Messages', { edge: 'Top' });
  await expect.poll(messagesOnTop).toBe(true);
  await app.open();
  await expect.poll(messagesOnTop, { message: 'the move survived the reload' }).toBe(true);

  await app.chooseMenu('Window', 'Reset Layout');
  await expect.poll(() => dockAnnouncement(app, 'editor')).toBe(ANNOUNCE.reset);
  await expect.poll(() => boxes(app, ['files', 'editor', 'messages'])).toEqual(start);
  expect(await lockChecked(app, 'Window')).toBe(true);
  await expect(app.toolbarButton('app.files.toggle')).toHaveAttribute('aria-pressed', 'true');
  // And the reset is what a reload finds.
  await app.open();
  await expect.poll(() => boxes(app, ['files', 'editor', 'messages'])).toEqual(start);
});

/** The dock's tab of a panel in a mode's workspace (a group shows its strip, P3.1.4). */
const dockTab = (app: App, mode: 'editor' | 'simulator', title: string) =>
  app.page.locator(`[data-e68-workspace="${mode}"]`).getByRole('tab', { name: title, exact: true });

test('Lock Layout off shows every tab strip and keeps a move across a reload; on again hides them and keeps the panels where they are', async ({
  app,
}) => {
  test.setTimeout(240_000);
  const filesRight = async () => {
    const b = await boxes(app, ['files', 'editor', 'messages']);
    return b.files!.left >= b.editor!.right && b.files!.left >= b.messages!.right;
  };

  await test.step('locked by default: no strip where today shows none', async () => {
    expect(await lockChecked(app, 'Window')).toBe(true);
    for (const title of ['Files', 'Editor', 'Messages']) await expect(dockTab(app, 'editor', title)).toHaveCount(0);
  });

  await test.step('Window > Lock Layout unchecks it: every group shows its strip', async () => {
    await app.chooseMenu('Window', 'Lock Layout');
    await expect.poll(() => dockAnnouncement(app, 'editor')).toBe(ANNOUNCE.unlocked);
    expect(await lockChecked(app, 'Window')).toBe(false);
    for (const title of ['Files', 'Editor', 'Messages']) await expect(dockTab(app, 'editor', title)).toBeVisible();
  });

  await test.step('unlocked, Move Panel To... moves Files to the right edge; the move and the lock survive a reload', async () => {
    await movePanel(app, 'Window', 'Files', { edge: 'Right' });
    await expect.poll(filesRight).toBe(true);
    expect(await lockChecked(app, 'Window'), 'a move keeps the lock as it is').toBe(false);
    await app.open();
    await expect.poll(filesRight, { message: 'the move survived the reload' }).toBe(true);
    expect(await lockChecked(app, 'Window'), 'still unlocked after the reload').toBe(false);
    await expect(dockTab(app, 'editor', 'Files')).toBeVisible();
  });

  await test.step('Simulator mode: one lock for both modes; View > Lock Layout checks it again', async () => {
    await switchMode(app, 'Simulator');
    expect(await lockChecked(app, 'View')).toBe(false);
    for (const title of ['Registers', 'Listing', 'Messages', 'Output']) {
      await expect(dockTab(app, 'simulator', title)).toBeVisible();
    }
    await app.chooseMenu('View', 'Lock Layout');
    await expect.poll(() => dockAnnouncement(app, 'simulator')).toBe(ANNOUNCE.locked);
    expect(await lockChecked(app, 'View')).toBe(true);
    for (const title of ['Registers', 'Listing', 'Messages', 'Output']) {
      await expect(dockTab(app, 'simulator', title)).toHaveCount(0);
    }
  });

  await test.step('locked again: Files stays at the right edge, without a strip; Move Panel To... stays enabled', async () => {
    await switchMode(app, 'Editor');
    expect(await lockChecked(app, 'Window')).toBe(true);
    await expect.poll(filesRight).toBe(true);
    for (const title of ['Files', 'Editor', 'Messages']) await expect(dockTab(app, 'editor', title)).toHaveCount(0);
    const move = (await app.menuEntries('Window')).find((item) => item.caption === 'Move Panel To...');
    expect(move?.disabled, 'Move Panel To... is enabled while locked (P3.1.4)').toBe(false);
    await app.open();
    expect(await lockChecked(app, 'Window'), 'locked after the reload').toBe(true);
    await expect.poll(filesRight).toBe(true);
    await expect(dockTab(app, 'editor', 'Files')).toHaveCount(0);
  });
});
