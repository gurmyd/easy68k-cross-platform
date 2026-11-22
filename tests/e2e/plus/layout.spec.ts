// Panels that can be moved and docked (ARCHITECTURE-PLUS P3.1; P5 N9 acceptance "panels moved in
// both modes survive a reload"). Owner: N9. The same scenario runs with the network cut after the
// first load in offline.spec.ts.

import { ANNOUNCE } from '../../../app/src/ui/dock/texts';
import { expect, test } from '../fixtures';
import { dockAnnouncement, movePanel } from '../fixtures/plus';
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
