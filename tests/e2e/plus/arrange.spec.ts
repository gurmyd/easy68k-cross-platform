// Arranging panels freely, version 1.1 (ARCHITECTURE-PLUS P9; the acceptance of P9.6). Owner: M3.
//
// What a student does and sees, in the production build: a panel made to float from its tab menu,
// moved and sized with the mouse and with the keyboard (the title bar's menu: Move, Size), found
// where it was after a reload, docked again; the same with Lock Layout on and off; the place
// "As a floating window" of Move Panel To...; the four ready-made arrangements of View > Layouts
// with the boxes of the panels compared with what P9.4 says; the toolbar's Arrange Panels against
// the menu's check mark; the tip, once; and a program that draws and waits for a key, whose
// picture and key survive its Output panel floating and docking.
//
// Every text a person reads is copied here from P9 character by character (P9.5), so that a
// difference between the code's texts and the document's fails here. Nothing waits for a time:
// every wait is for what the screen shows.

import { ANNOUNCE } from '../../../app/src/ui/dock/texts';
import { expect, test, type App } from '../fixtures';
import {
  chooseLayout,
  dockAnnouncement,
  dockBox,
  dragBy,
  floatingTitle,
  floatingWindow,
  floatingWindows,
  layoutEntries,
  openWithTip,
  reopen,
  panelTab,
  regionBox,
  screenBox,
  switchMode,
  tabMenu,
  titlePoint,
  windowMenu,
  type ScreenBox,
} from '../fixtures/plus';
import {
  assemble,
  canvas,
  execute,
  expectReg,
  expectState,
  panel,
  pixel,
  program,
  programKeys,
  tool,
  view,
} from '../sim/sim';
import { boxes, lockChecked, type Box } from './arrangement';

// ---- the texts of P9 ------------------------------------------------------------------------------

/** P9.2: the tab menu's new item, a floating window's title bar menu and its button. */
const FLOAT = 'Float';
const WINDOW_MENU = ['Move', 'Size', 'Dock', 'Close'] as const;
const DOCK = 'Dock';
/** P9.2: the place of `Move Panel To...`. */
const AS_FLOATING_WINDOW = 'As a floating window';
/** P9.4: the entries of `View > Layouts`, in order. */
const LAYOUTS = ['Classic', 'Wide Output', 'Output and Hardware Side by Side', 'Floating Tools'] as const;
/** P9.3: the toolbar's button and its tool tip in the Simulator and in the Editor. */
const ARRANGE_PANELS = 'Arrange Panels';
const ARRANGE_TIP_SIMULATOR =
  'Arrange Panels: drag a panel by its tab, or right-click a tab for more (View > Lock Layout)';
const ARRANGE_TIP_EDITOR =
  'Arrange Panels: drag a panel by its tab, or right-click a tab for more (Window > Lock Layout)';
/** P9.3: the tip (its text as P9.9 point 3 gives it) and its two buttons. */
const TIP =
  "You can rearrange this window. Press Arrange Panels to show each panel's tab; then double-click a tab to make the panel float, or drag it to dock it elsewhere. Ready-made layouts are in the View menu.";
/** P9.8 point 3 (b): the button at the right end of every tab strip that is shown (its tool tip). */
const FLOAT_BUTTON = 'Float: make this panel a window of its own';
const TIP_ARRANGE = 'Arrange Panels';
const TIP_GOT_IT = 'Got it';
/** P9.2: the keyboard steps of Move and Size. */
const STEP = 16;
/** P9.2: the smallest floating window. */
const MIN = { width: 160, height: 96 };

/** Whole-pixel boxes on screens that scale: what one pixel of difference allows (P9.2 "within one pixel"). */
const near = (a: number, b: number, slack = 1) => Math.abs(a - b) <= slack;

// ---- helpers --------------------------------------------------------------------------------------

/** The box of a floating window, polled until it is drawn. */
async function windowBox(app: App, title: string): Promise<ScreenBox> {
  await expect(floatingWindow(app, title), `${title} floats`).toBeVisible();
  const box = await screenBox(floatingWindow(app, title));
  expect(box, `${title}'s window is drawn`).not.toBeNull();
  return box!;
}

/**
 * P9.8 point 1 (Floating Tools, tiled): the Hardware window's default size, title bar included, and
 * the top part of it that holds its displays, lamps, switches and push buttons (no window is ever
 * placed over it). Copied from the decision recorded in erratum M2.
 */
const HARDWARE_WINDOW = { width: 540, height: 632 };
const HARDWARE_KEEP = 272;

/**
 * What a student sees, measured as the review did (elementFromPoint on a grid every 4 px): of the
 * Output picture, the share of its points and how many px from its left edge are seen in every row;
 * of the Hardware panel's four device blocks (display, lamps, switches, push buttons), the share of
 * their points that hit the Hardware panel.
 */
async function whatIsSeen(app: App): Promise<{ picture: { share: number; left: number }; devices: number }> {
  return app.page.evaluate(() => {
    const dock = document.querySelector('[data-e68-workspace]:not([hidden]) [data-e68-dock]')!;
    const grid = (box: DOMRect, hits: (element: Element | null) => boolean) => {
      let seen = 0;
      let total = 0;
      let left = 0;
      let open = true;
      for (let x = 2; x < box.width; x += 4) {
        let column = true;
        for (let y = 2; y < box.height; y += 4) {
          total++;
          if (hits(document.elementFromPoint(box.left + x, box.top + y))) seen++;
          else column = false;
        }
        if (open && column) left += 4;
        else open = false;
      }
      return { share: total ? Math.round((1000 * seen) / total) / 10 : 0, left: Math.min(left, Math.round(box.width)) };
    };
    const canvas = dock.querySelector('[data-e68-panel="output"] canvas');
    const hardware = dock.querySelector('[data-e68-panel="hardware"]');
    const picture = canvas ? grid(canvas.getBoundingClientRect(), (hit) => hit === canvas) : { share: 0, left: 0 };
    const blocks = hardware ? Array.from(hardware.querySelectorAll('.e68-hw__devices > .e68-hw__device')) : [];
    const shares = blocks.map(
      (block) => grid(block.getBoundingClientRect(), (hit) => !!hit && hardware!.contains(hit)).share,
    );
    return { picture, devices: shares.length === 4 ? Math.min(...shares) : 0 };
  });
}

/**
 * How far the Hardware panel's own scroll area is scrolled sideways (errata M1 entry 19: a window
 * an arrangement has just placed shows its content from its left edge, whatever the panel showed
 * where it was docked and wherever the keyboard focus is).
 */
async function hardwareSideways(app: App): Promise<number> {
  return app.page.evaluate(async () => {
    // Read after the frames in which a placed window is laid out (a frame, or 100 ms without one).
    for (let i = 0; i < 3; i++) {
      await new Promise<void>((done) => {
        const timer = setTimeout(done, 100);
        requestAnimationFrame(() => {
          clearTimeout(timer);
          done();
        });
      });
    }
    return (
      document.querySelector<HTMLElement>(
        '[data-e68-workspace]:not([hidden]) [data-e68-panel="hardware"] [data-hw-scroll]',
      )?.scrollLeft ?? -1
    );
  });
}

/** Whether two boxes overlap (more than touching). */
const overlap = (a: ScreenBox, b: ScreenBox) =>
  a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

/** Polls a floating window's box until it equals `want`. */
async function expectWindowAt(app: App, title: string, want: ScreenBox, message: string): Promise<void> {
  await expect.poll(() => screenBox(floatingWindow(app, title)), { message }).toEqual(want);
}

/** The Simulator with the Memory and Hardware panels shown (Stack stays hidden), and the lock as asked. */
async function simulatorWithTools(app: App, locked: boolean): Promise<void> {
  await switchMode(app, 'Simulator');
  await view(app, 'Memory', 'memory');
  await view(app, 'Hardware', 'hardware');
  expect(await lockChecked(app, 'View'), 'Lock Layout is on by default (D2)').toBe(true);
  if (!locked) {
    await app.chooseMenu('View', 'Lock Layout');
    await expect.poll(() => dockAnnouncement(app, 'simulator')).toBe(ANNOUNCE.unlocked);
    expect(await lockChecked(app, 'View')).toBe(false);
  }
  expect(await regionBox(app, 'stack'), 'the Stack panel is hidden').toBeNull();
}

/**
 * The Hardware panel docked in the tool group under the Output panel, as the default arrangement has
 * it: its tab is in the strip under Output (it need not be the selected tab), and it floats no more.
 */
async function hardwareInToolGroup(app: App): Promise<boolean> {
  if ((await floatingWindow(app, 'Hardware').count()) > 0) return false;
  const output = await regionBox(app, 'output');
  const tab = await screenBox(panelTab(app, 'Hardware'));
  if (!output || !tab) return false;
  return tab.y >= output.bottom - 1 && tab.x >= output.left - 1;
}

/**
 * The box a student sees of a docked panel: its region and, when its group shows a strip, its tab
 * strip above it (the region's top is then lower by the strip's height).
 */
async function groupBox(app: App, id: string, title: string): Promise<Box> {
  const region = await regionBox(app, id);
  expect(region, `the panel ${id} is shown`).not.toBeNull();
  const strip = await screenBox(
    app.page
      .locator('[data-e68-workspace]:not([hidden])')
      .getByRole('tablist')
      .filter({ has: app.page.getByRole('tab', { name: title, exact: true }) }),
  );
  return strip && strip.y < region!.top && strip.x >= region!.left - 1 && strip.x < region!.right
    ? { ...region!, top: strip.y }
    : region!;
}

// ---- floating a panel -----------------------------------------------------------------------------

for (const locked of [true, false]) {
  test(`the Hardware panel floats from its tab menu, moves and sizes with the mouse and the keyboard, is where it was after a reload and docks again (Lock Layout ${locked ? 'on' : 'off'})`, async ({
    app,
  }) => {
    test.setTimeout(240_000);
    await simulatorWithTools(app, locked);
    const dockedHardware = await regionBox(app, 'hardware');
    expect(dockedHardware, 'Hardware is shown in the tool group').not.toBeNull();

    await test.step('Float in the tab menu (a right click on the tab, or Shift+F10 on it)', async () => {
      const items = await tabMenu(app, 'Hardware', FLOAT, locked ? 'mouse' : 'keyboard');
      expect(items, 'the tab menu lists Float before Close').toEqual(expect.arrayContaining([FLOAT, 'Close']));
      expect(items.indexOf(FLOAT)).toBeLessThan(items.indexOf('Close'));
      await expect(floatingWindow(app, 'Hardware')).toBeVisible();
      expect(await floatingWindows(app)).toEqual(['Hardware']);
      // The title bar: the panel's name, Dock, and the panel's x.
      await expect(floatingTitle(app, 'Hardware')).toHaveText('Hardware');
      await expect(floatingWindow(app, 'Hardware').getByRole('button', { name: DOCK, exact: true })).toBeVisible();
      await expect(floatingWindow(app, 'Hardware').getByRole('button', { name: 'Close', exact: true })).toBeVisible();
      // It is not a dialog: the rest of the application stays usable.
      await expect(app.page.getByRole('dialog')).toHaveCount(0);
      // The panel's own content is in the window, above the docked panels.
      const box = await windowBox(app, 'Hardware');
      const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const hit = await app.page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-e68-panel]')?.getAttribute('data-e68-panel'),
        centre,
      );
      expect(hit, 'the window lies above the docked panels').toBe('hardware');
      // Floating changes neither visibility nor the lock (P1.1 rule 4, D8).
      expect(await regionBox(app, 'stack')).toBeNull();
      expect(await regionBox(app, 'memory'), 'Memory is still shown in the tool group').not.toBeNull();
      expect(await lockChecked(app, 'View')).toBe(locked);
    });

    let box: ScreenBox;
    await test.step('the mouse: the title bar moves it, the corners and edges size it, never below 160 by 96', async () => {
      box = await windowBox(app, 'Hardware');
      // (It floated at the top of the dock, P9.8 point 2: it is moved down and to the left.)
      await dragBy(app, await titlePoint(app, 'Hardware'), -120, 60);
      box = { ...box, x: box.x - 120, y: box.y + 60 };
      await expectWindowAt(app, 'Hardware', box, 'dragging the title bar moves the window by as much');

      await dragBy(app, { x: box.x + box.width - 4, y: box.y + box.height - 4 }, 40, 30);
      box = { ...box, width: box.width + 40, height: box.height + 30 };
      await expectWindowAt(app, 'Hardware', box, 'the bottom right corner sizes it; the top left stays');

      await dragBy(app, { x: box.x + 2, y: box.y + box.height / 2 }, 24, 0);
      box = { ...box, x: box.x + 24, width: box.width - 24 };
      await expectWindowAt(app, 'Hardware', box, 'the left edge sizes it; the right edge stays');

      await dragBy(app, { x: box.x + box.width - 4, y: box.y + box.height - 4 }, -2000, -2000);
      await expectWindowAt(app, 'Hardware', { ...box, ...MIN }, 'not smaller than 160 by 96');
      await dragBy(
        app,
        { x: box.x + MIN.width - 4, y: box.y + MIN.height - 4 },
        box.width - MIN.width,
        box.height - MIN.height,
      );
      await expectWindowAt(app, 'Hardware', box, 'sized back with the corner');
    });

    await test.step('the keyboard: the title bar is a Tab stop; its menu; Move and Size by 16 px, with Shift by 1; Enter keeps, Esc restores', async () => {
      // The title bar is focused directly here (windowMenu); that Tab reaches it after the docked
      // panels' last stop is checked by check-dock's floating pass and the accessibility audit.
      const items = await windowMenu(app, 'Hardware', 'Move');
      expect(items, "the title bar's menu").toEqual([...WINDOW_MENU]);
      for (const key of ['ArrowLeft', 'ArrowLeft', 'Shift+ArrowUp', 'ArrowDown']) await app.page.keyboard.press(key);
      const moved = { ...box, x: box.x - 2 * STEP, y: box.y - 1 + STEP };
      await expectWindowAt(app, 'Hardware', moved, 'Move: two steps left, one pixel up, one step down');
      await app.page.keyboard.press('Enter');
      box = moved;

      await windowMenu(app, 'Hardware', 'Move');
      await app.page.keyboard.press('ArrowRight');
      await expectWindowAt(app, 'Hardware', { ...box, x: box.x + STEP }, 'Move: one step right');
      await app.page.keyboard.press('Escape');
      await expectWindowAt(app, 'Hardware', box, 'Esc restores the place');

      await windowMenu(app, 'Hardware', 'Size');
      for (const key of ['ArrowRight', 'Shift+ArrowDown', 'Shift+ArrowDown']) await app.page.keyboard.press(key);
      const sized = { ...box, width: box.width + STEP, height: box.height + 2 };
      await expectWindowAt(app, 'Hardware', sized, 'Size: one step wider, two pixels taller');
      await app.page.keyboard.press('Enter');
      box = sized;

      await windowMenu(app, 'Hardware', 'Size');
      await app.page.keyboard.press('ArrowLeft');
      await app.page.keyboard.press('Escape');
      await expectWindowAt(app, 'Hardware', box, 'Esc restores the size');
      await expect(floatingTitle(app, 'Hardware'), 'the keyboard stays on the title bar').toBeFocused();
    });

    await test.step('after a reload it floats where it was, at the size it had; the lock and the hidden panel are as they were', async () => {
      await reopen(app);
      await switchMode(app, 'Simulator');
      await expectWindowAt(app, 'Hardware', box, 'the window after the reload');
      expect(await floatingWindows(app)).toEqual(['Hardware']);
      expect(await lockChecked(app, 'View')).toBe(locked);
      expect(await regionBox(app, 'stack')).toBeNull();
    });

    await test.step('Dock on the title bar puts it back into the tool group; nothing floats; it is still shown', async () => {
      await floatingWindow(app, 'Hardware').getByRole('button', { name: DOCK, exact: true }).click();
      await expect(floatingWindow(app, 'Hardware')).toHaveCount(0);
      expect(await floatingWindows(app)).toEqual([]);
      await expect.poll(() => hardwareInToolGroup(app), { message: 'Hardware is in the tool group again' }).toBe(true);
      expect(await lockChecked(app, 'View')).toBe(locked);
      expect(await regionBox(app, 'stack')).toBeNull();
      // Docked is what a reload finds.
      await reopen(app);
      await switchMode(app, 'Simulator');
      await expect.poll(() => hardwareInToolGroup(app)).toBe(true);
      expect(await floatingWindows(app)).toEqual([]);
    });
  });
}

test("the Dock item of the title bar's menu docks the window from the keyboard; Close in it hides the panel as its x does", async ({
  app,
}) => {
  test.setTimeout(180_000);
  await simulatorWithTools(app, true);
  await tabMenu(app, 'Hardware', FLOAT, 'keyboard');
  await expect(floatingWindow(app, 'Hardware')).toBeVisible();
  await windowMenu(app, 'Hardware', DOCK);
  await expect(floatingWindow(app, 'Hardware')).toHaveCount(0);
  await expect.poll(() => hardwareInToolGroup(app)).toBe(true);

  await tabMenu(app, 'Memory', FLOAT, 'keyboard');
  await expect(floatingWindow(app, 'Memory')).toBeVisible();
  await windowMenu(app, 'Memory', 'Close');
  await expect(floatingWindow(app, 'Memory')).toHaveCount(0);
  expect(await regionBox(app, 'memory'), 'Close hides the panel').toBeNull();
  // Shown again, it floats where it was (P9.2: hidden while it floats, it floats again when shown).
  await view(app, 'Memory', 'memory');
  await expect(floatingWindow(app, 'Memory')).toBeVisible();
});

test('Dock puts the Output panel back where it was docked: the whole right column', async ({ app }) => {
  test.setTimeout(120_000);
  await switchMode(app, 'Simulator');
  // Unlocked, so that the Output panel shows its tab (locked, it has no strip, as in 1.0.0).
  await app.chooseMenu('View', 'Lock Layout');
  await expect(panelTab(app, 'Output')).toBeVisible();
  const before = await boxes(app, ['registers', 'listing', 'messages', 'output']);
  await tabMenu(app, 'Output', FLOAT);
  await expect(floatingWindow(app, 'Output')).toBeVisible();
  await floatingWindow(app, 'Output').getByRole('button', { name: DOCK, exact: true }).click();
  await expect(floatingWindow(app, 'Output')).toHaveCount(0);
  await expect
    .poll(() => boxes(app, ['registers', 'listing', 'messages', 'output']), {
      message: 'P9.2: Dock goes back to the place it was docked at last',
    })
    .toEqual(before);
});

test('unlocked, a tab dragged onto the toolbar makes its panel float there', async ({ app }) => {
  test.setTimeout(120_000);
  // Unlocked (View > Lock Layout unchecked), Memory and Hardware shown in the tool group.
  await simulatorWithTools(app, false);
  const tab = await screenBox(panelTab(app, 'Hardware'));
  const toolbar = await screenBox(app.page.locator('.e68-shell [role=toolbar]').first());
  expect(tab, "the Hardware panel's tab is drawn").not.toBeNull();
  expect(toolbar, 'the toolbar is drawn').not.toBeNull();
  const from = { x: tab!.x + tab!.width / 2, y: tab!.y + tab!.height / 2 };
  const to = { x: toolbar!.x + toolbar!.width / 2, y: toolbar!.y + toolbar!.height / 2 };
  // As a hand does it: pressed, a first small move that starts the drag, then on to the toolbar.
  const mouse = app.page.mouse;
  await mouse.move(from.x, from.y);
  await mouse.down();
  await mouse.move(from.x + 8, from.y + 8, { steps: 4 });
  await mouse.move(to.x, to.y, { steps: 12 });
  await mouse.move(to.x + 1, to.y + 1, { steps: 2 });
  await mouse.up();
  await expect.poll(() => floatingWindows(app), 'the Hardware panel floats').toEqual(['Hardware']);
  const window = await screenBox(floatingWindow(app, 'Hardware'));
  expect(window, 'its window is drawn').not.toBeNull();
  // "there": its title bar is under the pointer's column (24 px to the left of where the tab was
  // let go), moved down into the dock's bounds, whose top it keeps (errata M1 8).
  const dropX = to.x + 1;
  expect(
    Math.abs(window!.x - (dropX - 24)),
    `the window's left edge ${window!.x} is 24 px left of ${dropX}`,
  ).toBeLessThanOrEqual(2);
  expect(window!.y, "the window's top is the dock's top").toBe((await dockBox(app)).y);
  await floatingWindow(app, 'Hardware').getByRole('button', { name: DOCK, exact: true }).click();
  await expect.poll(() => floatingWindows(app)).toEqual([]);
});

// ---- Move Panel To... (P9.2) ----------------------------------------------------------------------

test('Move Panel To... has the place "As a floating window", locked or not', async ({ app }) => {
  test.setTimeout(180_000);
  await simulatorWithTools(app, true);
  await app.chooseMenu('View', 'Move Panel To...');
  const dialog = app.dialog('Move Panel');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Panel:', exact: true }).selectOption({ label: 'Hardware' });
  await dialog.getByRole('radio', { name: AS_FLOATING_WINDOW, exact: true }).check();
  await app.button(dialog, 'OK').click();
  await expect(dialog).toBeHidden();
  await expect(floatingWindow(app, 'Hardware')).toBeVisible();
  expect(await lockChecked(app, 'View'), 'the lock is kept').toBe(true);
  // A floating panel is no target of a move; it can be docked from the dialog by another place.
  await app.chooseMenu('View', 'Move Panel To...');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Panel:', exact: true }).selectOption({ label: 'Hardware' });
  await dialog.getByRole('radio', { name: 'Beside', exact: true }).check();
  await dialog.getByRole('combobox', { name: 'Beside panel', exact: true }).selectOption({ label: 'Output' });
  await dialog.getByRole('combobox', { name: 'Side', exact: true }).selectOption({ label: 'Right' });
  await app.button(dialog, 'OK').click();
  await expect(dialog).toBeHidden();
  await expect(floatingWindow(app, 'Hardware')).toHaveCount(0);
  await expect
    .poll(async () => {
      const b = await boxes(app, ['output', 'hardware']);
      return b.hardware!.left >= b.output!.right - 1;
    })
    .toBe(true);
});

// ---- the ready-made arrangements (P9.4) -------------------------------------------------------------

/** The left column of the Simulator: Registers above the Listing, at the left of the dock. */
function leftColumn(b: Record<string, Box>, dock: ScreenBox): void {
  expect(near(b.registers!.left, dock.x, 1), 'Registers at the left edge').toBe(true);
  expect(b.registers!.bottom, 'Registers above the Listing').toBeLessThanOrEqual(b.listing!.top + 1);
  expect(near(b.listing!.left, b.registers!.left), 'the Listing under Registers').toBe(true);
}

for (const locked of [true, false]) {
  test(`View > Layouts: each of the four arrangements puts the panels where P9.4 says, keeps a hidden panel hidden and the lock (Lock Layout ${locked ? 'on' : 'off'})`, async ({
    app,
  }) => {
    test.setTimeout(300_000);
    await simulatorWithTools(app, locked);
    expect(await layoutEntries(app), 'View > Layouts has the four entries').toEqual([...LAYOUTS]);
    const dock = await dockBox(app);
    const bottom = dock.y + dock.height;
    const right = dock.x + dock.width;
    const classic = await boxes(app, ['registers', 'listing', 'messages', 'output', 'hardware']);

    const after = async (caption: string) => {
      await chooseLayout(app, caption);
      expect(await lockChecked(app, 'View'), `${caption} keeps the lock`).toBe(locked);
      expect(await regionBox(app, 'stack'), `${caption} keeps Stack hidden`).toBeNull();
    };

    /** What a student sees of the panels now: each docked one with its tab strip, `id` -> box. */
    const seen = async () => {
      // Hardware and Memory may be tabs of one group: each is selected (View menu) before it is read.
      await app.chooseMenu('View', 'Memory');
      const memory = await groupBox(app, 'memory', 'Memory');
      await app.chooseMenu('View', 'Hardware');
      const hardware = await groupBox(app, 'hardware', 'Hardware');
      return {
        registers: await groupBox(app, 'registers', 'Registers'),
        listing: await groupBox(app, 'listing', 'Listing'),
        messages: await groupBox(app, 'messages', 'Messages'),
        output: await groupBox(app, 'output', 'Output'),
        memory,
        hardware,
      };
    };
    const rule = (name: string, ok: boolean) => (ok ? [] : [name]);

    await test.step('Wide Output: Output the whole height of the right column; the tool panels one group below the Listing; Messages under the left column', async () => {
      await after('Wide Output');
      expect(await floatingWindows(app)).toEqual([]);
      const b = await seen();
      expect(
        [
          ...rule('Output from the top', near(b.output.top, b.registers.top, 1)),
          ...rule('Output to the bottom', near(b.output.bottom, bottom, 1)),
          ...rule('Output at the right edge', near(b.output.right, right, 1)),
          ...rule('the tool group below the Listing', b.hardware.top >= b.listing.bottom - 1),
          ...rule('the tool group in the left column', b.hardware.right <= b.output.left + 1),
          ...rule('the tool group as wide as the Listing', near(b.hardware.left, b.listing.left)),
          ...rule(
            'Memory and Hardware in one group',
            near(b.memory.top, b.hardware.top) && near(b.memory.left, b.hardware.left),
          ),
          ...rule('Messages below the tool group', b.messages.top >= b.hardware.bottom - 1),
          ...rule('Messages in the left column', b.messages.right <= b.output.left + 1),
          ...rule('Messages at the bottom', near(b.messages.bottom, bottom, 1)),
        ],
        JSON.stringify(b),
      ).toEqual([]);
      leftColumn(b, dock);
    });

    await test.step('Output and Hardware Side by Side: Hardware in a column of its own at the right of Output, both at full height; the other tool panels below the Listing', async () => {
      await after('Output and Hardware Side by Side');
      expect(await floatingWindows(app)).toEqual([]);
      const b = await seen();
      expect(
        [
          ...rule('Hardware right of Output', b.hardware.left >= b.output.right - 1),
          ...rule('Hardware at the right edge', near(b.hardware.right, right, 1)),
          ...rule('Hardware from the top', near(b.hardware.top, b.registers.top, 1)),
          ...rule('Output from the top', near(b.output.top, b.registers.top, 1)),
          ...rule('Hardware to the bottom', near(b.hardware.bottom, bottom, 1)),
          ...rule('Output to the bottom', near(b.output.bottom, bottom, 1)),
          ...rule('Output right of the left column', b.output.left >= b.listing.right - 1),
          ...rule('Memory below the Listing', b.memory.top >= b.listing.bottom - 1),
          ...rule('Memory in the left column', b.memory.right <= b.output.left + 1),
          ...rule('Messages in the left column', b.messages.right <= b.output.left + 1),
        ],
        JSON.stringify(b),
      ).toEqual([]);
      leftColumn(b, dock);
    });

    await test.step('Floating Tools (P9.8 point 1): the tool panels shown float side by side from the top right; the docked panels keep the dock left of them', async () => {
      await after('Floating Tools');
      // In the order Hardware, Memory; Stack, Break Points and Log have their places while hidden.
      await expect.poll(() => floatingWindows(app)).toEqual(['Hardware', 'Memory']);
      const b = await boxes(app, ['registers', 'listing', 'messages', 'output']);
      const hardware = await windowBox(app, 'Hardware');
      const memory = await windowBox(app, 'Memory');
      const kept = { ...hardware, height: HARDWARE_KEEP };
      expect(
        [
          ...rule(
            'Hardware in the top right corner of the dock',
            near(hardware.x + hardware.width, right, 1) && near(hardware.y, dock.y, 1),
          ),
          ...rule('Hardware at its default height', near(hardware.height, HARDWARE_WINDOW.height, 1)),
          ...rule('Hardware no wider than its default', hardware.width <= HARDWARE_WINDOW.width + 1),
          ...rule('Memory not over the Hardware displays and switches', !overlap(memory, kept)),
          ...rule(
            'Memory inside the dock',
            memory.x >= dock.x - 1 && memory.x + memory.width <= right + 1 && memory.y + memory.height <= bottom + 1,
          ),
          ...rule('Memory right of the Output panel', memory.x >= b.output!.right - 1),
          // The docked panels: the left column, then the Output panel up to the windows.
          ...rule(
            'Registers, Listing and Messages in the left column',
            near(b.registers!.left, dock.x, 1) &&
              near(b.listing!.left, dock.x, 1) &&
              near(b.messages!.bottom, bottom, 1),
          ),
          ...rule(
            'Output from the top to the bottom',
            near(b.output!.top, classic.output!.top) && near(b.output!.bottom, bottom, 1),
          ),
          ...rule('Output right of the left column', b.output!.left >= b.listing!.right - 1),
          ...rule('Output ends where the windows begin', near(b.output!.right, hardware.x, 2)),
        ],
        JSON.stringify({ now: b, hardware, memory, dock }),
      ).toEqual([]);
      // The step before left the Hardware panel scrolled sideways in its narrow column (View >
      // Hardware revealed its first address field there) and the focus in that field: the window
      // shows its content from its left edge all the same, with nothing scrolled back by the test.
      expect(await hardwareSideways(app), 'the Hardware window shows its left edge').toBe(0);
      const seenNow = await whatIsSeen(app);
      expect(seenNow.devices, 'the Hardware displays, lamps, switches and push buttons are seen').toBe(100);
      expect(seenNow.picture.left, 'at least the left 400 px of the Output picture are seen').toBeGreaterThanOrEqual(
        400,
      );
      // A hidden panel shown later floats too, in the place it was given while hidden: inside the
      // dock, not over the Hardware displays.
      await view(app, 'Stack', 'stack');
      await expect(floatingWindow(app, 'Stack')).toBeVisible();
      await expect.poll(() => floatingWindows(app)).toEqual(['Hardware', 'Memory', 'Stack']);
      const stack = await windowBox(app, 'Stack');
      expect(!overlap(stack, kept) && stack.x + stack.width <= right + 1, JSON.stringify(stack)).toBe(true);
      await floatingWindow(app, 'Stack').getByRole('button', { name: 'Close', exact: true }).click();
      await expect(floatingWindow(app, 'Stack')).toHaveCount(0);
      expect(await regionBox(app, 'stack')).toBeNull();
    });
    await test.step('Classic: the default arrangement again, nothing floats', async () => {
      await after('Classic');
      await expect.poll(() => floatingWindows(app)).toEqual([]);
      await app.chooseMenu('View', 'Hardware');
      await expect
        .poll(() => boxes(app, ['registers', 'listing', 'messages', 'output', 'hardware']), {
          message: 'Classic is the default arrangement',
        })
        .toEqual(classic);
    });

    await test.step('an arrangement is kept across a reload', async () => {
      await after('Wide Output');
      await app.chooseMenu('View', 'Hardware');
      const before = await boxes(app, ['registers', 'listing', 'messages', 'output', 'hardware']);
      await reopen(app);
      await switchMode(app, 'Simulator');
      await app.chooseMenu('View', 'Hardware');
      await expect.poll(() => boxes(app, ['registers', 'listing', 'messages', 'output', 'hardware'])).toEqual(before);
      expect(await lockChecked(app, 'View')).toBe(locked);
    });
  });
}

for (const size of [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
]) {
  test(`Floating Tools at ${size.width} by ${size.height}, Hardware and Memory shown: what P9.8 point 1 promises is seen`, async ({
    app,
  }) => {
    test.setTimeout(180_000);
    await app.page.setViewportSize(size);
    await simulatorWithTools(app, true);
    await chooseLayout(app, 'Floating Tools');
    await expect.poll(() => floatingWindows(app)).toEqual(['Hardware', 'Memory']);
    const hardware = await windowBox(app, 'Hardware');
    const memory = await windowBox(app, 'Memory');
    // At 1366 by 768 the Hardware window is narrower than its content (P9.10 point 1) and the focus
    // is in its first address field, at its right (View > Hardware put it there): the window shows
    // its content from its left edge all the same (errata M1 entry 19). Nothing is scrolled back.
    expect(await hardwareSideways(app), 'the Hardware window shows its left edge').toBe(0);
    const seen = await whatIsSeen(app);
    expect(seen.devices, "the Hardware panel's displays, lamps, switches and push buttons are uncovered").toBe(100);
    if (size.width >= 1920) {
      expect(
        overlap(hardware, memory),
        `neither window covers the other: ${JSON.stringify({ hardware, memory })}`,
      ).toBe(false);
      expect(seen.picture, 'the whole Output picture at 100 % is uncovered').toEqual({ share: 100, left: 640 });
    } else {
      expect(seen.picture.left, 'at least the left 400 px of the Output picture are uncovered').toBeGreaterThanOrEqual(
        400,
      );
      // The left edge is held by rule, not for a time (errata M1 entry 19; GitHub's Ubuntu runner
      // put the focus back later than this PC does, run 45825817588): the page gives the focus to a
      // field that the window cuts at its right, as the dock does after a move. The panel reveals
      // the field at once; with no action of a person the window is back at its left edge.
      const cut = await app.page.evaluate(() => {
        const area = document.querySelector<HTMLElement>(
          '[data-e68-workspace]:not([hidden]) [data-e68-panel="hardware"] [data-hw-scroll]',
        )!;
        const edge = area.getBoundingClientRect().left + area.clientLeft + area.clientWidth;
        const field = Array.from(area.querySelectorAll<HTMLInputElement>('input')).find(
          (input) => !input.disabled && input.tabIndex >= 0 && input.getBoundingClientRect().right > edge,
        );
        if (!field) return null;
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        field.focus();
        return { revealedBy: area.scrollLeft };
      });
      expect(cut, 'a field of the Hardware window is cut at its right edge').not.toBeNull();
      expect(cut!.revealedBy, 'the panel reveals a field that gets the focus').toBeGreaterThan(0);
      expect(await hardwareSideways(app), 'the focus put back by the page leaves the left edge shown').toBe(0);
      // A person's key ends the hold: a field reached with Tab is revealed and stays revealed.
      await app.page.keyboard.press('Shift+Tab');
      await app.page.keyboard.press('Tab');
      expect(await hardwareSideways(app), 'a field reached with Tab is revealed').toBeGreaterThan(0);
    }
  });
}

// ---- the second review's corrections (P9.9) ---------------------------------------------------------

/** The left edge of the shown dock's Registers panel and every scroll offset above the floating windows. */
async function dockSteady(app: App): Promise<{ registersLeft: number; scrolled: string[] }> {
  return app.page.evaluate(() => {
    const dock = document.querySelector('[data-e68-workspace]:not([hidden]) [data-e68-dock]')!;
    const registers = dock.querySelector('[data-e68-panel="registers"]')!.getBoundingClientRect();
    const scrolled: string[] = [];
    for (const window of Array.from(dock.querySelectorAll('.flexlayout__tab[data-e68-float]'))) {
      for (let element: Element | null = window; element; element = element.parentElement) {
        if (element.scrollLeft !== 0 || element.scrollTop !== 0) {
          scrolled.push(`${element.className} ${element.scrollLeft},${element.scrollTop}`);
        }
      }
    }
    const page = document.scrollingElement!;
    if (page.scrollLeft !== 0 || page.scrollTop !== 0) scrolled.push(`document ${page.scrollLeft},${page.scrollTop}`);
    return { registersLeft: Math.round(registers.left), scrolled: [...new Set(scrolled)] };
  });
}

test('P9.9 point 1: a window pushed past the right edge, clicked and tabbed into, never scrolls the docked panels', async ({
  app,
}) => {
  test.setTimeout(180_000);
  await app.page.setViewportSize({ width: 1366, height: 768 });
  await simulatorWithTools(app, true);
  await chooseLayout(app, 'Floating Tools');
  await expect.poll(() => floatingWindows(app)).toEqual(['Hardware', 'Memory']);
  // The reviewer's steps: the Hardware title dragged far to the right, a click on it, Tab into the panel.
  await dragBy(app, await titlePoint(app, 'Hardware'), 3000, 0);
  const pushed = await windowBox(app, 'Hardware');
  expect(pushed.x, 'the window lies partly outside, cut at the edge').toBeGreaterThan(1366 - pushed.width);
  // (The room kept for the windows follows the window to the edge, P9.9 point 4: measured from here.)
  const before = await boxes(app, ['registers', 'listing', 'messages', 'output']);
  await floatingTitle(app, 'Hardware').click({ position: { x: 24, y: 15 } });
  await expect(floatingTitle(app, 'Hardware')).toBeFocused();
  expect(await dockSteady(app)).toEqual({ registersLeft: 0, scrolled: [] });
  await app.page.keyboard.press('Tab');
  await expect
    .poll(() =>
      app.page.evaluate(() => document.activeElement?.closest('[data-e68-panel]')?.getAttribute('data-e68-panel')),
    )
    .toBe('hardware');
  expect(await dockSteady(app)).toEqual({ registersLeft: 0, scrolled: [] });
  expect(await boxes(app, ['registers', 'listing', 'messages', 'output']), 'nothing docked moved').toEqual(before);
  // Memory docked from its title bar: the docked arrangement changes (Memory joins it), never scrolls.
  await floatingWindow(app, 'Memory').getByRole('button', { name: DOCK, exact: true }).click();
  await expect.poll(() => floatingWindows(app)).toEqual(['Hardware']);
  expect(await dockSteady(app)).toEqual({ registersLeft: 0, scrolled: [] });
  expect((await boxes(app, ['registers'])).registers!.left).toBe(before.registers!.left);
});

test('P9.9 point 2: Floating Tools at 1920 by 1080 with all five tool panels shown: no window covers another', async ({
  app,
}) => {
  test.setTimeout(180_000);
  await app.page.setViewportSize({ width: 1920, height: 1080 });
  await simulatorWithTools(app, true);
  await view(app, 'Stack', 'stack');
  await view(app, 'Break Points', 'breakpoints');
  await view(app, 'Log', 'log');
  await chooseLayout(app, 'Floating Tools');
  await expect.poll(() => floatingWindows(app)).toEqual(['Hardware', 'Memory', 'Stack', 'Break Points', 'Log']);
  const titles = ['Hardware', 'Memory', 'Stack', 'Break Points', 'Log'];
  const windows = await Promise.all(titles.map((title) => windowBox(app, title)));
  const dock = await dockBox(app);
  const pairs: string[] = [];
  for (let i = 0; i < windows.length; i++) {
    const a = windows[i]!;
    expect(
      a.x >= dock.x - 1 && a.y >= dock.y - 1 && a.x + a.width <= dock.x + dock.width + 1,
      `${titles[i]} inside the dock`,
    ).toBe(true);
    expect(a.y + a.height, `${titles[i]} inside the dock`).toBeLessThanOrEqual(dock.y + dock.height + 1);
    for (let j = i + 1; j < windows.length; j++) if (overlap(a, windows[j]!)) pairs.push(`${titles[i]}/${titles[j]}`);
  }
  expect(pairs, JSON.stringify(windows)).toEqual([]);
  // Hardware and Memory in the room at the right; the Hardware displays, lamps and switches seen.
  expect((await whatIsSeen(app)).devices).toBe(100);
});

test('P9.9 point 4: the room kept for the windows shrinks to the columns that still hold one, when a drag ends; a reload keeps it; Reset Layout clears it', async ({
  app,
}) => {
  test.setTimeout(240_000);
  await app.page.setViewportSize({ width: 1920, height: 1080 });
  await simulatorWithTools(app, true);
  await chooseLayout(app, 'Floating Tools');
  await expect.poll(() => floatingWindows(app)).toEqual(['Hardware', 'Memory']);
  const dock = await dockBox(app);
  const right = dock.x + dock.width;
  const hardware = await windowBox(app, 'Hardware');
  const memory = await windowBox(app, 'Memory');
  const outputRight = async () => (await regionBox(app, 'output'))!.right;
  expect(near(await outputRight(), memory.x, 2), 'the docked panels end where the windows begin').toBe(true);
  // Memory dragged out to the left: while the button is down nothing docked moves.
  const from = await titlePoint(app, 'Memory');
  const mouse = app.page.mouse;
  await mouse.move(from.x, from.y);
  await mouse.down();
  await mouse.move(from.x - 600, from.y - 100, { steps: 6 });
  await mouse.move(from.x - (memory.x - dock.x) + 20, from.y - 100, { steps: 6 });
  expect(near(await outputRight(), memory.x, 2), 'nothing jumps while a window is dragged').toBe(true);
  await mouse.up();
  await expect
    .poll(outputRight, { message: 'the room shrinks to the Hardware column when the drag ends' })
    .toBeGreaterThanOrEqual(hardware.x - 2);
  expect(near(await outputRight(), hardware.x, 2)).toBe(true);
  // A reload keeps what was there.
  const kept = await outputRight();
  await reopen(app);
  await switchMode(app, 'Simulator');
  await expect.poll(outputRight).toBe(kept);
  await expect(floatingTitle(app, 'Hardware'), 'the Hardware window is drawn after the reload').toBeVisible();
  await expect.poll(() => screenBox(floatingTitle(app, 'Hardware'))).not.toBeNull();
  // Hardware dragged down and to the left as well: no window in the room; no empty strip is left.
  await dragBy(app, await titlePoint(app, 'Hardware'), -(hardware.x - dock.x) + 300, 40);
  await expect.poll(outputRight, { message: 'the docked panels take the whole dock' }).toBe(right);
  // Floating Tools again keeps a room; Reset Layout clears it and docks every window.
  await chooseLayout(app, 'Floating Tools');
  await expect.poll(outputRight).toBeLessThan(right - 100);
  await app.chooseMenu('View', 'Reset Layout');
  await expect.poll(() => floatingWindows(app)).toEqual([]);
  await expect.poll(outputRight).toBe(right);
});

// ---- what gives way on a small screen (P9.10) -------------------------------------------------------

/** Whether a floating window lies over a docked panel's box. */
const over = (window: ScreenBox, box: Box) =>
  window.x < box.right - 0.5 &&
  box.left < window.x + window.width - 0.5 &&
  window.y < box.bottom - 0.5 &&
  box.top < window.y + window.height - 0.5;

for (const size of [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
]) {
  test(`P9.10 point 2: Floating Tools at ${size.width} by ${size.height} with all five tool panels shown: no window lies over the registers, the listing or the message area`, async ({
    app,
  }) => {
    test.setTimeout(180_000);
    await app.page.setViewportSize(size);
    await simulatorWithTools(app, true);
    await view(app, 'Stack', 'stack');
    await view(app, 'Break Points', 'breakpoints');
    await view(app, 'Log', 'log');
    await chooseLayout(app, 'Floating Tools');
    const titles = ['Hardware', 'Memory', 'Stack', 'Break Points', 'Log'];
    await expect.poll(() => floatingWindows(app)).toEqual(titles);
    const windows = await Promise.all(titles.map((title) => windowBox(app, title)));
    const left = await boxes(app, ['registers', 'listing', 'messages']);
    const covering: string[] = [];
    for (const [i, window] of windows.entries()) {
      for (const [id, box] of Object.entries(left)) if (over(window, box)) covering.push(`${titles[i]} over ${id}`);
    }
    expect(covering, JSON.stringify({ windows, left })).toEqual([]);
    // The Hardware window's displays, lamps and switches stay uncovered, seen from its left edge
    // without a scroll back (errata M1 entry 19).
    expect(await hardwareSideways(app), 'the Hardware window shows its left edge').toBe(0);
    expect((await whatIsSeen(app)).devices).toBe(100);
  });
}

test('P9.10 point 3: the room is given back when the windows left in it fill less than half of its height, and comes back by the same rule', async ({
  app,
}) => {
  test.setTimeout(240_000);
  await app.page.setViewportSize({ width: 1920, height: 1080 });
  await simulatorWithTools(app, true);
  await chooseLayout(app, 'Floating Tools');
  await expect.poll(() => floatingWindows(app)).toEqual(['Hardware', 'Memory']);
  const dock = await dockBox(app);
  const right = dock.x + dock.width;
  const memory = await windowBox(app, 'Memory');
  const outputRight = async () => (await regionBox(app, 'output'))!.right;
  expect(near(await outputRight(), memory.x, 2), 'the docked panels end where the windows begin').toBe(true);
  // The review's case: the Hardware window dragged left by 400 px (and down by 80). Memory alone is
  // left in the room: 356 of the dock's 993 px. While the button is down nothing docked moves.
  const from = await titlePoint(app, 'Hardware');
  const mouse = app.page.mouse;
  await mouse.move(from.x, from.y);
  await mouse.down();
  await mouse.move(from.x - 200, from.y + 40, { steps: 4 });
  await mouse.move(from.x - 400, from.y + 80, { steps: 4 });
  expect(near(await outputRight(), memory.x, 2), 'nothing moves while the button is held').toBe(true);
  await mouse.up();
  await expect
    .poll(outputRight, { message: 'the docked panels take the whole dock: no empty block beside the Output panel' })
    .toBe(right);
  // A reload keeps it.
  await reopen(app);
  await switchMode(app, 'Simulator');
  await expect(floatingTitle(app, 'Hardware'), 'the Hardware window is drawn after the reload').toBeVisible();
  await expect.poll(() => screenBox(floatingTitle(app, 'Hardware'))).not.toBeNull();
  await expect.poll(outputRight).toBe(right);
  // Dragged back: Hardware and Memory lie in the room and fill more than half of its height again.
  await dragBy(app, await titlePoint(app, 'Hardware'), 400, -80);
  await expect.poll(outputRight, { message: 'the room comes back' }).toBeLessThan(right - 100);
  expect(near(await outputRight(), memory.x, 2), 'as it was').toBe(true);
});

test('P9.8 point 3: a double click on a tab floats its panel, on a title bar docks it, and the Float button of a strip floats its selected panel, all locked', async ({
  app,
}) => {
  test.setTimeout(180_000);
  await simulatorWithTools(app, true);
  // The Float button at the right end of the tool group's strip, after its tabs.
  const strip = app.page.locator('[data-e68-workspace]:not([hidden]) .flexlayout__tabset_tabbar_outer').filter({
    has: app.page.getByRole('tab', { name: 'Hardware', exact: true }),
  });
  const button = strip.getByRole('button', { name: FLOAT_BUTTON, exact: true });
  await expect(button).toBeVisible();
  await expect(button).toHaveAccessibleName(FLOAT_BUTTON);
  // A single click selects a tab at once and floats nothing.
  await panelTab(app, 'Memory').click();
  await expect(panelTab(app, 'Memory')).toHaveAttribute('aria-selected', 'true');
  expect(await floatingWindows(app)).toEqual([]);
  // A double click floats it; the layout stays locked.
  await panelTab(app, 'Memory').dblclick();
  await expect.poll(() => floatingWindows(app)).toEqual(['Memory']);
  expect(await lockChecked(app, 'View')).toBe(true);
  // P9.8 point 2: it appears at the top right of the dock, not over the strip it came from.
  const dock = await dockBox(app);
  const memory = await windowBox(app, 'Memory');
  const stripBox = await screenBox(strip);
  expect(
    near(memory.x + memory.width, dock.x + dock.width, 1) && near(memory.y, dock.y, 1),
    JSON.stringify(memory),
  ).toBe(true);
  expect(overlap(memory, stripBox!), 'not over the strip it came from').toBe(false);
  // The Float button floats the strip's selected panel (now Hardware), over no other window.
  await button.click();
  await expect.poll(() => floatingWindows(app)).toEqual(['Memory', 'Hardware']);
  expect(overlap(await windowBox(app, 'Memory'), await windowBox(app, 'Hardware'))).toBe(false);
  // A double click on a title bar docks the window.
  await floatingTitle(app, 'Hardware').dblclick();
  await expect.poll(() => floatingWindows(app)).toEqual(['Memory']);
  await floatingTitle(app, 'Memory').dblclick();
  await expect.poll(() => floatingWindows(app)).toEqual([]);
  expect(await lockChecked(app, 'View')).toBe(true);
});

test('View > Layouts is in the Simulator only; Reset Layout docks every floating panel', async ({ app }) => {
  test.setTimeout(180_000);
  // The Editor has no View menu; its Window menu has no Layouts either.
  const editorWindow = await app.menuEntries('Window');
  expect(editorWindow.map((entry) => entry.caption)).not.toContain('Layouts');
  await simulatorWithTools(app, true);
  await chooseLayout(app, 'Floating Tools');
  await expect.poll(() => floatingWindows(app)).toEqual(['Hardware', 'Memory']);
  await app.chooseMenu('View', 'Reset Layout');
  await expect.poll(() => dockAnnouncement(app, 'simulator')).toBe(ANNOUNCE.reset);
  await expect.poll(() => floatingWindows(app)).toEqual([]);
  await expect.poll(() => hardwareInToolGroup(app)).toBe(true);
});

// ---- the toolbar's button (P9.3) ------------------------------------------------------------------

test("the toolbar's Arrange Panels is Lock Layout inverted, in both modes, with its tool tip", async ({ app }) => {
  test.setTimeout(180_000);
  const button = app.toolbarButton('app.layout.lock');
  for (const mode of ['Editor', 'Simulator'] as const) {
    if (mode === 'Simulator') await switchMode(app, 'Simulator');
    const menu = mode === 'Editor' ? 'Window' : 'View';
    await expect(button, `${mode}: the button is in the toolbar`).toBeVisible();
    await expect(button).toHaveAccessibleName(ARRANGE_PANELS);
    await expect(button).toHaveText(ARRANGE_PANELS);
    // Its tool tip, which a person sees when the pointer rests on it, describes it.
    await expect(button).toHaveAccessibleDescription(mode === 'Editor' ? ARRANGE_TIP_EDITOR : ARRANGE_TIP_SIMULATOR);
    await button.hover();
    await expect(
      app.page.getByText(mode === 'Editor' ? ARRANGE_TIP_EDITOR : ARRANGE_TIP_SIMULATOR, { exact: true }),
    ).toBeVisible();
    await app.page.mouse.move(0, 0);
    // It comes after every button the toolbar had (the theme button at the far right is not one of them).
    const order = await app.page.locator('.e68-shell__toolbar [data-command]').evaluateAll((buttons) =>
      buttons
        .filter((b) => (b as HTMLElement).checkVisibility())
        .map((b) => b.getAttribute('data-command'))
        .filter((id) => id !== 'app.theme.set'),
    );
    expect(order.at(-1), `${mode}: Arrange Panels is at the end of the toolbar (${order.join(', ')})`).toBe(
      'app.layout.lock',
    );
    expect(await lockChecked(app, menu)).toBe(true);
    await expect(button, 'not pressed while the layout is locked').toHaveAttribute('aria-pressed', 'false');
    await button.click();
    await expect(button, 'pressed: the tabs can be dragged').toHaveAttribute('aria-pressed', 'true');
    expect(await lockChecked(app, menu), `${menu} > Lock Layout is unchecked`).toBe(false);
    await expect(panelTab(app, mode === 'Editor' ? 'Files' : 'Registers'), 'every strip is shown').toBeVisible();
    await app.chooseMenu(menu, 'Lock Layout');
    await expect(button, 'the menu item locks again: not pressed').toHaveAttribute('aria-pressed', 'false');
    expect(await lockChecked(app, menu)).toBe(true);
  }
});

// ---- the tip (P9.3) --------------------------------------------------------------------------------

/** The tip of P9.3, found by its text. */
const tipOf = (app: App) => app.page.getByText(TIP, { exact: true });
/** The polite live region that holds the tip. */
const tipRegion = (app: App) => app.page.getByRole('status').filter({ has: tipOf(app) });
/** A button of the tip. */
const tipButton = (app: App, caption: string) => tipRegion(app).getByRole('button', { name: caption, exact: true });

test.describe('the tip', () => {
  // A browser driven by a test sees the tip only with `?arrange-tip=1` in the address (errata M2),
  // so that the suites of 1.0.0 see the window they always saw. These tests open, and reload, every
  // window with it: what they show is what a person's browser shows.
  test.beforeEach(async ({ app }) => {
    await openWithTip(app);
  });

  test('appears once, the first time the Simulator is shown; Got it closes it for good, also after a reload', async ({
    app,
  }) => {
    test.setTimeout(180_000);
    await expect(tipOf(app), 'not in the Editor').toHaveCount(0);
    await switchMode(app, 'Simulator');
    await expect(tipOf(app)).toBeVisible();
    // It is announced politely and takes no keyboard focus.
    await expect(tipRegion(app)).toHaveCount(1);
    await expect(tipRegion(app)).toHaveAttribute('aria-live', 'polite');
    expect(
      await tipRegion(app).evaluate((region) => region.contains(document.activeElement)),
      'the tip does not take the focus',
    ).toBe(false);
    // Above the status bar.
    const notice = await screenBox(tipOf(app));
    const status = await screenBox(app.page.locator('.e68-statusbar'));
    expect(notice!.y + notice!.height).toBeLessThanOrEqual(status!.y + 1);
    await tipButton(app, TIP_GOT_IT).click();
    await expect(tipOf(app)).toHaveCount(0);
    expect(await lockChecked(app, 'View'), 'Got it leaves the lock on').toBe(true);
    await switchMode(app, 'Editor');
    await switchMode(app, 'Simulator');
    await expect(tipOf(app), 'not again in this window').toHaveCount(0);
    await openWithTip(app);
    await switchMode(app, 'Simulator');
    await expect(app.page.locator('[data-e68-workspace="simulator"]')).toBeVisible();
    await expect(tipOf(app), 'never again after a reload').toHaveCount(0);
  });

  test('its Arrange Panels unlocks the layout and closes it for good', async ({ app }) => {
    test.setTimeout(180_000);
    await switchMode(app, 'Simulator');
    await expect(tipOf(app)).toBeVisible();
    await tipButton(app, TIP_ARRANGE).click();
    await expect(tipOf(app)).toHaveCount(0);
    expect(await lockChecked(app, 'View'), 'the layout is unlocked').toBe(false);
    await expect(app.toolbarButton('app.layout.lock')).toHaveAttribute('aria-pressed', 'true');
    await expect(panelTab(app, 'Registers')).toBeVisible();
    await openWithTip(app);
    await switchMode(app, 'Simulator');
    await expect(app.page.locator('[data-e68-workspace="simulator"]')).toBeVisible();
    await expect(tipOf(app), 'never again after a reload').toHaveCount(0);
  });

  test('does not appear while a program runs or waits for input; it comes when none runs', async ({ app }) => {
    test.setTimeout(240_000);
    // A program saved in My Programs (its .S68 beside it), started in a second window by the web
    // command line with the run switch, so that the Simulator is first shown with a program running.
    const dialog = await assemble(app, WAITS_FOR_A_KEY, 'tipwait.X68');
    await app.button(dialog, 'Close').click();
    await expect(dialog).toBeHidden();
    const other = await app.openWindow('?arrange-tip=1&open=/browser/tipwait.S68&run=1');
    await expect.poll(() => other.mode()).toBe('simulator');
    await expectState(other, 'Waiting for input');
    await expect(tipOf(other), 'no tip while the program waits for input').toHaveCount(0);
    await canvas(other).click();
    await expect(programKeys(other)).toBeFocused();
    await other.page.keyboard.press('Z');
    await expectState(other, 'Halted');
    await expect(tipOf(other), 'the tip comes once no program runs').toBeVisible();
    await tipButton(other, TIP_GOT_IT).click();
    await expect(tipOf(other)).toHaveCount(0);
    // The setting is per browser profile: the first window does not show it either.
    await switchMode(app, 'Simulator');
    await expect(app.page.locator('[data-e68-workspace="simulator"]')).toBeVisible();
    await expect(tipOf(app)).toHaveCount(0);
  });
});

// ---- a program's state (P9.2: "a panel that floats keeps what it shows") -------------------------

/** Draws a green rectangle, waits for one key with task 5, keeps it in D7 and halts. */
const WAITS_FOR_A_KEY = program(
  '    MOVE.L  #$0000FF00,D1',
  '    MOVE.B  #80,D0',
  '    TRAP    #15',
  '    MOVE.B  #81,D0',
  '    TRAP    #15',
  '    MOVE.W  #100,D1',
  '    MOVE.W  #100,D2',
  '    MOVE.W  #199,D3',
  '    MOVE.W  #149,D4',
  '    MOVE.B  #87,D0',
  '    TRAP    #15',
  '    MOVE.B  #5,D0',
  '    TRAP    #15',
  '    CLR.L   D7',
  '    MOVE.B  D1,D7',
  '    SIMHALT',
);

test('a program that draws and waits for a key: the picture and the key survive its Output panel floating and docking', async ({
  app,
}) => {
  test.setTimeout(300_000);
  await execute(app, WAITS_FOR_A_KEY);
  await tool(app, 'sim.run.run');
  await expectState(app, 'Waiting for input');
  await expect.poll(() => pixel(app, 150, 120), { message: 'the green rectangle' }).toBe('#00ff00');

  // The Output panel has no strip while the layout is locked (as in 1.0.0): unlock to reach its tab.
  await app.chooseMenu('View', 'Lock Layout');
  expect(await lockChecked(app, 'View')).toBe(false);
  await tabMenu(app, 'Output', FLOAT);
  await expect(floatingWindow(app, 'Output')).toBeVisible();
  await expect(floatingWindow(app, 'Output').locator('canvas.e68-output__canvas')).toBeVisible();
  await expectState(app, 'Waiting for input');
  expect(await pixel(app, 150, 120), 'the picture is kept in the floating window').toBe('#00ff00');
  expect(await pixel(app, 99, 120)).toBe('#000000');

  // Moved with the mouse while the program waits: nothing of the program changes.
  // (It floated at the top of the dock, P9.8 point 2: it is moved down and to the left.)
  const box = await windowBox(app, 'Output');
  await dragBy(app, await titlePoint(app, 'Output'), -60, 40);
  await expectWindowAt(app, 'Output', { ...box, x: box.x - 60, y: box.y + 40 }, 'the Output window moved');
  await expectState(app, 'Waiting for input');
  expect(await pixel(app, 150, 120)).toBe('#00ff00');

  // The key: a click into the floating Output panel gives it the keyboard, as docked.
  await canvas(app).click();
  await expect(programKeys(app)).toBeFocused();
  await app.page.keyboard.press('Z');
  await expectState(app, 'Halted');
  await expectReg(app, 'D7', '0000005A');

  // Docked again: the same picture.
  await floatingWindow(app, 'Output').getByRole('button', { name: DOCK, exact: true }).click();
  await expect(floatingWindow(app, 'Output')).toHaveCount(0);
  await expect(panel(app, 'output').locator('canvas.e68-output__canvas')).toBeVisible();
  expect(await pixel(app, 150, 120), 'the picture after Dock').toBe('#00ff00');
  const b = await boxes(app, ['listing', 'output']);
  expect(b.output!.left, 'Output is in the right column again').toBeGreaterThanOrEqual(b.listing!.right - 1);
});
