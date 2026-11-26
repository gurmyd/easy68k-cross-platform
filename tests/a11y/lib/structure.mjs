// Part "structure" of the accessibility audit: the rules of ARCHITECTURE.md 2.11 that axe-core
// does not judge, checked in the real application. Owner: Q1.
//
//   menu bar    a `menubar` of `menuitem`s; reached with Tab; each menu opens with Down, every item
//               is reached with Down, Right moves to the next menu, a submenu opens with Right,
//               Escape closes; a View command chosen with the keyboard moves the focus into its
//               panel (2.3, 2.10)
//   toolbars    `toolbar` with one tab stop; arrow keys, Home and End move inside; each button's
//               accessible name is its hint (the command table's `hint`)
//   panels      every panel on screen is a `region` named by its title; the tool tabs are a
//               `tablist` whose selected tab controls a tab panel; arrow keys move between tabs
//   live        the message areas of both modes have a polite `log` region; a halt is announced
//   registers   every register field has a label
//   output      the canvas is `role="img"` with a label; the text mirror is a `log` region that
//               changes at most twice a second (measured; the shortest interval is printed)
//   focus       every tab stop of the three modes shows a focus indicator (outline or ring of at
//               least 2 px, or a box shadow) with 3:1 against what is around it
//   colour      a breakpoint differs from an instruction row in shape, not only in colour, and a
//               screen reader is told about it
//   motion      with reduced motion: no interface animation runs, the Memory cursor does not blink;
//               without it the cursor blinks (so that the check is known to see the animation)

/* global document, window, getComputedStyle, MutationObserver, CSS */

import { closeWithin } from '../../browser-checks/ending.mjs';
import { contrastRatio, formatRatio, over, parseColor } from './contrast.mjs';
import { describeFocus, focusOf, newContext, openApp, pressCommand, shoot, tab, waitFor } from './app.mjs';
import { assembleAndExecute } from './scan.mjs';

const setMode = async (page, mode) => {
  await page.evaluate((value) => window.__easy68k.ctx.commands.run('app.mode.set', value), mode);
  await waitFor(page, (value) => window.__easy68k.ctx.store.getState().mode === value, mode, 5000);
};
const run = (page, id, arg) =>
  page.evaluate(
    ([commandId, value]) => {
      void window.__easy68k.ctx.commands.run(commandId, value);
    },
    [id, arg],
  );
/** Moves the focus to the start of the page, as a freshly loaded page has it. */
const focusStart = (page) =>
  page.evaluate(() => {
    // Blurring alone leaves the browser's "sequential focus starting point" where the focus was;
    // a focused element that is not a tab stop, first in the body, puts it at the start.
    let start = document.querySelector('[data-a11y-start]');
    if (!start) {
      start = document.createElement('span');
      start.setAttribute('tabindex', '-1');
      start.setAttribute('data-a11y-start', '');
      document.body.prepend(start);
    }
    start.focus();
  });

/** The accessible name of an element, enough of the algorithm for the controls of this application. */
function accessibleName(element) {
  if (!element) return '';
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const label = element.getAttribute('aria-label');
  if (label) return label.trim();
  if (element.id) {
    const forLabel = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    if (forLabel) return forLabel.textContent.replace(/\s+/g, ' ').trim();
  }
  const wrapping = element.closest('label');
  if (wrapping) return wrapping.textContent.replace(/\s+/g, ' ').trim();
  if (element.getAttribute('title')) return element.getAttribute('title').trim();
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Menu bar of the current mode, by keyboard. */
async function menuBarChecks(page, os, p, report, mode) {
  const facts = await page.evaluate(() => {
    const bar = document.querySelector('.e68-shell__menubar [role=menubar], [role=menubar]');
    if (!bar) return null;
    const titles = [...bar.querySelectorAll(':scope [role=menuitem]')].filter(
      (item) => item.closest('[role=menubar]') === bar,
    );
    return {
      titles: titles.map((item) => item.textContent.trim()),
      popups: titles.every((item) => ['menu', 'true'].includes(item.getAttribute('aria-haspopup') ?? '')),
    };
  });
  if (
    !report.check(
      `${p} ${mode}: the menu bar is a menubar of menuitems with pop-ups`,
      facts?.popups === true,
      JSON.stringify(facts),
    )
  ) {
    return;
  }
  await focusStart(page);
  let reached = null;
  for (let i = 0; i < 12 && !reached; i++) {
    await tab(page, os);
    const onTitle = await page.evaluate(() => document.activeElement?.closest('[role=menubar]') !== null);
    if (onTitle) reached = true;
  }
  if (
    !report.check(
      `${p} ${mode}: Tab from the start of the page reaches the menu bar`,
      reached === true,
      describeFocus(await focusOf(page)),
    )
  ) {
    return;
  }
  // Each menu: Down opens it, Down visits every item, Right goes on to the next menu.
  const visitedMenus = [];
  const problems = [];
  let submenuOpened = null;
  await page.keyboard.press('ArrowDown');
  for (let index = 0; index < facts.titles.length; index++) {
    const menu = await page.evaluate(() => {
      const menus = [...document.querySelectorAll('[role=menu][data-e68-menu]')];
      const top = menus[0];
      if (!top) return null;
      const items = [...top.children].filter((element) => (element.getAttribute('role') ?? '').startsWith('menuitem'));
      return {
        label: top.getAttribute('aria-label') ?? '',
        items: items.map((element) => ({
          text: (element.querySelector('.e68-menu__caption')?.textContent ?? element.textContent).trim(),
          role: element.getAttribute('role'),
          disabled: element.getAttribute('aria-disabled') === 'true',
          submenu: element.getAttribute('aria-haspopup') === 'menu' || element.getAttribute('aria-haspopup') === 'true',
        })),
        focusInMenu: top.contains(document.activeElement),
      };
    });
    if (!menu) {
      problems.push(`menu ${index + 1} (${facts.titles[index]}) did not open`);
      break;
    }
    visitedMenus.push(facts.titles[index]);
    if (!menu.focusInMenu) problems.push(`${facts.titles[index]}: the focus is not in the open menu`);
    if (!menu.items.every((item) => ['menuitem', 'menuitemcheckbox', 'menuitemradio'].includes(item.role))) {
      problems.push(`${facts.titles[index]}: an item has another role`);
    }
    const seen = new Set();
    for (let step = 0; step < menu.items.length + 2; step++) {
      const text = await page.evaluate(() => {
        const element = document.activeElement;
        return (element?.querySelector('.e68-menu__caption')?.textContent ?? element?.textContent ?? '').trim();
      });
      seen.add(text);
      await page.keyboard.press('ArrowDown');
    }
    const missing = menu.items.filter((item) => !seen.has(item.text)).map((item) => item.text);
    if (missing.length) problems.push(`${facts.titles[index]}: Down never reaches ${missing.join(', ')}`);
    // A submenu: Right on its item opens it, Left closes it again.
    const sub = menu.items.find((item) => item.submenu && !item.disabled);
    if (sub && submenuOpened === null) {
      for (let step = 0; step < menu.items.length + 1; step++) {
        const here = await page.evaluate(() =>
          (document.activeElement?.querySelector('.e68-menu__caption')?.textContent ?? '').trim(),
        );
        if (here === sub.text) break;
        await page.keyboard.press('ArrowDown');
      }
      await page.keyboard.press('ArrowRight');
      const opened = await page.evaluate(() => {
        const menus = [...document.querySelectorAll('[role=menu][data-e68-menu]')];
        return menus.length >= 2 && menus[menus.length - 1].contains(document.activeElement);
      });
      submenuOpened = `${facts.titles[index]} > ${sub.text}: ${opened}`;
      if (!opened) problems.push(`${facts.titles[index]} > ${sub.text}: Right does not open the submenu`);
      await page.keyboard.press('ArrowLeft');
    }
    // Right on an item with a submenu opens it; move to a plain item before going on.
    for (let step = 0; step < menu.items.length; step++) {
      const onSubmenu = await page.evaluate(() => Boolean(document.activeElement?.getAttribute('aria-haspopup')));
      if (!onSubmenu) break;
      await page.keyboard.press('ArrowDown');
    }
    if (index < facts.titles.length - 1) await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.press('Escape');
  const closed = await page.evaluate(() => document.querySelectorAll('[role=menu][data-e68-menu]').length === 0);
  report.check(
    `${p} ${mode}: every menu opens from the keyboard and Down reaches every item (${visitedMenus.length} menus)`,
    problems.length === 0 && visitedMenus.length === facts.titles.length,
    problems.slice(0, 4).join('; ') || (submenuOpened ? `submenu ${submenuOpened}` : ''),
  );
  report.check(`${p} ${mode}: Escape closes the menu`, closed);
  await page.keyboard.press('Escape');
}

/** A command chosen in a menu with the keyboard alone (Enter on the item). */
async function chooseByKeyboard(page, os, menuTitle, itemText) {
  await focusStart(page);
  for (let i = 0; i < 12; i++) {
    await tab(page, os);
    if (await page.evaluate(() => document.activeElement?.closest('[role=menubar]') !== null)) break;
  }
  for (let i = 0; i < 10; i++) {
    const title = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    if (title === menuTitle) break;
    await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.press('ArrowDown');
  for (let i = 0; i < 30; i++) {
    const here = await page.evaluate(() =>
      (document.activeElement?.querySelector('.e68-menu__caption')?.textContent ?? '').trim(),
    );
    if (here === itemText) {
      await page.keyboard.press('Enter');
      return true;
    }
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Escape');
  return false;
}

/** Toolbar of the current mode. */
async function toolbarChecks(page, p, report, mode) {
  // The accessible name is the hint with the platform's shortcut appended, as the tool-tip shows
  // it (menus.ts resolveToolbar `label`; 1.3.2), or the reason a disabled button gives instead.
  const facts = await page.evaluate(async (current) => {
    const { resolveToolbar } = await import('/src/commands/menus.ts');
    const { ctx, commands } = window.__easy68k;
    const env = { os: ctx.platform.os, desktop: false, state: ctx.store.getState(), commands };
    const expected = new Map(
      resolveToolbar(current, env)
        .filter((entry) => entry.type === 'button')
        .map((entry) => [entry.id, [entry.label, entry.disabledReason].filter(Boolean)]),
    );
    const bar = document.querySelector(
      `[data-e68-workspace="${current}"] [role=toolbar], .e68-shell__toolbar[role=toolbar], .e68-shell__toolbar [role=toolbar]`,
    );
    if (!bar) return null;
    const buttons = [...bar.querySelectorAll('button[data-command]')];
    const names = buttons.map((button) => {
      const id = button.getAttribute('data-command');
      return { id, name: button.getAttribute('aria-label') ?? button.textContent.trim(), hint: expected.get(id) ?? [] };
    });
    return {
      label: bar.getAttribute('aria-label') ?? bar.getAttribute('aria-labelledby') ?? '',
      stops: buttons.filter((button) => button.tabIndex === 0).length,
      count: buttons.length,
      wrongNames: names.filter((entry) => entry.id !== 'app.theme.set' && !entry.hint.includes(entry.name)),
    };
  }, mode);
  if (
    !report.check(
      `${p} ${mode}: the toolbar is a labelled toolbar`,
      facts !== null && facts.label !== '',
      JSON.stringify(facts?.label),
    )
  )
    return;
  report.check(
    `${p} ${mode}: the toolbar has exactly one tab stop`,
    facts.stops === 1,
    `${facts.stops} of ${facts.count} buttons have tabindex 0`,
  );
  report.check(
    `${p} ${mode}: every toolbar button's accessible name is its hint`,
    facts.wrongNames.length === 0,
    facts.wrongNames.map((entry) => `${entry.id}: "${entry.name}" expected "${entry.hint.join('" or "')}"`).join('; '),
  );
  // Arrow keys move inside; Home and End go to the ends.
  if (facts.count < 2) return;
  await page.locator('[role=toolbar] button[data-command][tabindex="0"]:visible').first().focus();
  const at = () => page.evaluate(() => document.activeElement?.getAttribute('data-command') ?? null);
  const first = await at();
  await page.keyboard.press('ArrowRight');
  const second = await at();
  await page.keyboard.press('End');
  const last = await at();
  await page.keyboard.press('Home');
  const home = await at();
  const inBar = await page.evaluate(() => document.activeElement?.closest('[role=toolbar]') !== null);
  report.check(
    `${p} ${mode}: Right, End and Home move the focus inside the toolbar`,
    inBar && first !== null && second !== null && second !== first && last !== null && home !== null && home !== last,
    `${first} -> Right ${second}, End ${last}, Home ${home}`,
  );
}

/** Panels on screen: named regions; tool tabs. */
async function panelChecks(page, p, report, mode) {
  const facts = await page.evaluate((current) => {
    const { panels } = window.__easy68k;
    const workspace = document.querySelector(`[data-e68-workspace="${current}"]`);
    return [...workspace.querySelectorAll('[data-e68-panel]')]
      .filter((element) => element.closest('[hidden]') === null)
      .map((element) => {
        const id = element.getAttribute('data-e68-panel');
        const labelledBy = element.getAttribute('aria-labelledby');
        const name = labelledBy
          ? (document.getElementById(labelledBy)?.textContent ?? '').trim()
          : (element.getAttribute('aria-label') ?? '').trim();
        return {
          id,
          role: element.getAttribute('role'),
          name,
          title: panels.find(current, id)?.title ?? null,
          inTabs: element.closest('[role=tablist]') !== null || element.getAttribute('role') === 'tabpanel',
        };
      });
  }, mode);
  // A tool panel shown as a tab of the tool group is that tab's `tabpanel` (2.11 "Tool tabs are a
  // tablist"); an element has one role, so it is named by its title the same way.
  const wrong = facts.filter(
    (panel) =>
      !(panel.role === 'region' || (panel.inTabs && panel.role === 'tabpanel')) ||
      panel.name === '' ||
      (panel.title !== null && panel.name !== panel.title),
  );
  report.check(
    `${p} ${mode}: every panel on screen is a region named by its title (${facts.map((panel) => panel.id).join(', ')})`,
    wrong.length === 0,
    JSON.stringify(wrong),
  );
}

async function toolTabChecks(page, p, report) {
  const facts = await page.evaluate(() => {
    const list = document.querySelector('[data-e68-workspace="simulator"] [role=tablist]');
    if (!list) return null;
    const tabs = [...list.querySelectorAll('[role=tab]')];
    const selected = tabs.filter((element) => element.getAttribute('aria-selected') === 'true');
    const controls = selected[0]?.getAttribute('aria-controls');
    const panel = controls ? document.getElementById(controls) : null;
    return {
      tabs: tabs.map((element) => element.textContent.trim()),
      selected: selected.length,
      controlsPanel: panel?.getAttribute('role') === 'tabpanel',
    };
  });
  report.check(
    `${p} simulator: the tool tabs are a tablist whose selected tab controls a tab panel`,
    facts !== null && facts.tabs.length >= 2 && facts.selected === 1 && facts.controlsPanel,
    JSON.stringify(facts),
  );
  if (!facts) return;
  await page.locator('[data-e68-workspace="simulator"] [role=tablist] [role=tab][aria-selected=true]').focus();
  const before = await page.evaluate(() => document.activeElement?.textContent?.trim());
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => ({
    text: document.activeElement?.textContent?.trim(),
    role: document.activeElement?.getAttribute('role'),
  }));
  report.check(
    `${p} simulator: Right moves to the next tool tab`,
    after.role === 'tab' && after.text !== before,
    `${before} -> ${after.text}`,
  );
}

/** The focus indicator of the focused element: a ring of 2 px or more (or a shadow) and its contrast. */
const focusIndicator = (page) =>
  page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return null;
    const background = (start) => {
      // The first opaque background at or above `start`, as a CSS colour.
      for (let node = start; node; node = node.parentElement) {
        const color = getComputedStyle(node).backgroundColor;
        if (color && !/rgba\(0, 0, 0, 0\)|transparent/.test(color)) return color;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    // The element, or an ancestor that draws the ring for it (a wrapper with :focus-within), on
    // the box itself or on a ::before / ::after layer (an inset ring over a scrolling list).
    for (let node = element, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
      for (const pseudo of [null, '::after', '::before']) {
        const style = getComputedStyle(node, pseudo);
        if (pseudo && (style.content === 'none' || style.content === 'normal')) continue;
        const width = parseFloat(style.outlineWidth) || 0;
        if (style.outlineStyle !== 'none' && width > 0) {
          return {
            kind: `outline${pseudo ?? ''}`,
            width,
            color: style.outlineColor,
            around: background(node.parentElement ?? node),
            depth,
          };
        }
        if (style.boxShadow && style.boxShadow !== 'none') {
          const color = /rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8}/i.exec(style.boxShadow)?.[0] ?? '';
          const width = Math.max(0, ...[...style.boxShadow.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])));
          return { kind: `shadow${pseudo ?? ''}`, width, color, around: background(node.parentElement ?? node), depth };
        }
        if (pseudo && style.borderTopStyle !== 'none' && (parseFloat(style.borderTopWidth) || 0) > 0) {
          return {
            kind: `border${pseudo}`,
            width: parseFloat(style.borderTopWidth),
            color: style.borderTopColor,
            around: background(node),
            depth,
          };
        }
      }
    }
    return { kind: 'none' };
  });

/**
 * Whether focusing the element changes what is on screen around it: a picture of the element
 * (or, for an element that is not drawn, such as the Output panel's hidden keyboard field, of
 * its panel) with the focus and without it. The ring of a control can be drawn in many ways;
 * the pixels show whether one is there at all.
 */
async function focusChangesPixels(page) {
  const clip = await page.evaluate(() => {
    const element = document.activeElement;
    let box = element.getBoundingClientRect();
    if (box.width < 4 || box.height < 4) {
      box = (element.closest('[data-e68-panel]') ?? element).getBoundingClientRect();
    }
    const x = Math.max(0, box.left - 4);
    const y = Math.max(0, box.top - 4);
    return {
      x,
      y,
      width: Math.min(window.innerWidth - x, box.width + 8),
      height: Math.min(window.innerHeight - y, box.height + 8),
    };
  });
  if (clip.width < 1 || clip.height < 1) return false;
  const focused = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  await page.evaluate(() => {
    window.__a11yRefocus = document.activeElement;
    document.querySelector('[data-a11y-start]')?.focus();
  });
  const unfocused = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  await page.evaluate(() => window.__a11yRefocus?.focus({ focusVisible: true }));
  return !focused.equals(unfocused);
}

/** Tab through every stop of the current mode and judge each focus indicator. */
async function focusVisibleChecks(page, os, p, report, mode) {
  await focusStart(page);
  const seen = new Set();
  const missing = [];
  const weak = [];
  const drawnOtherwise = [];
  const panels = new Set();
  let stops = 0;
  for (let i = 0; i < 70; i++) {
    await tab(page, os);
    const focus = await focusOf(page);
    if (focus.what === 'body') continue;
    // The element itself, not its description: several fields can read alike.
    const identity = await page.evaluate(() => {
      window.__a11yIds ??= new WeakMap();
      const element = document.activeElement;
      if (!window.__a11yIds.has(element)) {
        window.__a11yCount = (window.__a11yCount ?? 0) + 1;
        window.__a11yIds.set(element, `e${window.__a11yCount}`);
      }
      return window.__a11yIds.get(element);
    });
    const key = `${describeFocus(focus)} [${identity}]`;
    if (seen.has(identity)) break;
    seen.add(identity);
    if (focus.panel) panels.add(focus.panel);
    stops++;
    // Keyboard focus is shown on :focus-visible; Tab gives exactly that. Some controls set their
    // focus class a moment later (the editor's `cm-focused`).
    await page.waitForTimeout(80);
    const indicator = await focusIndicator(page);
    if (!indicator || indicator.kind === 'none') {
      // No ring in the styles: then at least the pixels must change (the contrast is not measured).
      if (await focusChangesPixels(page)) drawnOtherwise.push(key);
      else missing.push(key);
      continue;
    }
    const color = parseColor(indicator.color);
    const around = parseColor(indicator.around);
    if (color && around) {
      const ratio = contrastRatio(color.a < 1 ? over(color, { ...around, a: 1 }) : color, { ...around, a: 1 });
      if (indicator.width < 2 || ratio < 3)
        weak.push(`${key}: ${indicator.kind} ${indicator.width}px ${formatRatio(ratio)}`);
    }
  }
  report.check(
    `${p} ${mode}: every tab stop shows a focus indicator (${stops} stops; panels ${[...panels].join(', ')})`,
    missing.length === 0,
    missing.slice(0, 6).join('; '),
  );
  if (drawnOtherwise.length) {
    console.log(
      `        focus shown without an outline or shadow (pixels change; contrast not measured): ${drawnOtherwise.join('; ')}`,
    );
  }
  report.check(
    `${p} ${mode}: every focus indicator is at least 2 px with 3:1 against its surroundings`,
    weak.length === 0,
    weak.slice(0, 6).join('; '),
  );
}

/** Live regions, register labels, the Output panel's canvas and text mirror. */
async function semanticsChecks(page, p, report) {
  const facts = await page.evaluate(() => {
    const live = (selector) => {
      const root = document.querySelector(selector);
      if (!root) return null;
      return [...root.querySelectorAll('[role=log], [aria-live]')].some(
        (element) =>
          element.getAttribute('aria-live') !== 'off' &&
          (element.getAttribute('role') === 'log' || element.getAttribute('aria-live') === 'polite'),
      );
    };
    const canvas = document.querySelector('[data-e68-panel="output"] canvas');
    const mirror = document.querySelector('[data-e68-panel="output"] [role=log]');
    return {
      editorMessages: live('[data-e68-workspace="editor"] [data-e68-panel="messages"]'),
      simMessages: live('[data-e68-workspace="simulator"] [data-e68-panel="messages"]'),
      canvas: canvas ? { role: canvas.getAttribute('role'), label: canvas.getAttribute('aria-label') ?? '' } : null,
      mirror: mirror
        ? { live: mirror.getAttribute('aria-live') ?? '(role log: polite)', label: mirror.getAttribute('aria-label') }
        : null,
    };
  });
  report.check(
    `${p} the Messages panel of Editor mode has a polite log region for the assembler's messages`,
    facts.editorMessages === true,
    `${facts.editorMessages}`,
  );
  report.check(
    `${p} the Messages panel of Simulator mode has a polite log region`,
    facts.simMessages === true,
    `${facts.simMessages}`,
  );
  report.check(
    `${p} the Output canvas has role img and a label`,
    facts.canvas?.role === 'img' && facts.canvas.label !== '',
    JSON.stringify(facts.canvas),
  );
  report.check(
    `${p} the Output panel's text mirror is a polite log region`,
    facts.mirror !== null && facts.mirror.live !== 'off' && facts.mirror.live !== 'assertive',
    JSON.stringify(facts.mirror),
  );
  const fields = await page.locator('[data-e68-panel="registers"] input').all();
  const unlabelled = [];
  for (const field of fields) {
    if ((await field.evaluate(accessibleName)) === '')
      unlabelled.push((await field.evaluate((input) => input.outerHTML)).slice(0, 80));
  }
  const count = fields.length;
  report.check(
    `${p} every register field has a label (${count} fields)`,
    count >= 19 && unlabelled.length === 0,
    unlabelled.slice(0, 3).join(' | '),
  );
}

/**
 * A program that prints a growing number on each line without end, for the text mirror's rate
 * (the lines differ, so every update of the mirror changes its text).
 */
const PRINT_LOOP = [
  '    ORG    $1000',
  'START:',
  'AGAIN:',
  '    ADDQ.L #1,D1',
  '    MOVE.B #3,D0',
  '    TRAP   #15',
  '    LEA    CRLF,A1',
  '    MOVE.B #14,D0',
  '    TRAP   #15',
  '    BRA    AGAIN',
  'CRLF DC.B $D,$A,0',
  '    END    START',
];

/** The text mirror changes at most twice a second (2.11), measured while a program prints without end. */
async function mirrorRateCheck(page, p, report) {
  if (!(await assembleAndExecute(page, PRINT_LOOP))) {
    report.check(`${p} the printing program is loaded`, false);
    return;
  }
  const runs = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.evaluate(() => {
      window.__mirrorTimes = [];
      const mirror = document.querySelector('[data-e68-panel="output"] [role=log]');
      window.__mirrorObserver?.disconnect();
      window.__mirrorObserver = new MutationObserver(() => window.__mirrorTimes.push(performance.now()));
      window.__mirrorObserver.observe(mirror, { childList: true, subtree: true, characterData: true });
    });
    await run(page, 'sim.run.run');
    await page.waitForTimeout(3000);
    await run(page, 'sim.run.pause');
    await waitFor(page, () => window.__easy68k.ctx.store.getState().sim.phase === 'idle', null, 10_000);
    const times = await page.evaluate(() => {
      window.__mirrorObserver.disconnect();
      // Mutations of one update arrive together: count groups more than 50 ms apart.
      const groups = [];
      for (const time of window.__mirrorTimes)
        if (groups.length === 0 || time - groups[groups.length - 1] > 50) groups.push(time);
      return groups;
    });
    const gaps = times.slice(1).map((time, index) => time - times[index]);
    runs.push({ updates: times.length, shortest: gaps.length ? Math.round(Math.min(...gaps)) : null });
    if (times.length >= 2) break;
  }
  console.log(
    `        text mirror while printing for 3 s: ${runs.map((r) => `${r.updates} updates, shortest gap ${r.shortest} ms`).join('; ')}`,
  );
  const best = runs.find((r) => r.updates >= 2) ?? runs[runs.length - 1];
  report.check(
    `${p} the text mirror follows the output, at most twice a second`,
    best.updates >= 2 && best.shortest !== null && best.shortest >= 400,
    `${best.updates} updates in 3 s, shortest gap ${best.shortest} ms`,
  );
}

/** A halt is announced (2.11), and breakpoints differ in shape and are told to a screen reader. */
async function haltAndBreakpointChecks(page, p, report) {
  const halting = [
    '    ORG    $1000',
    'START:',
    '    MOVEQ  #5,D0',
    '    ADD.L  D0,D0',
    '    SIMHALT',
    '    END    START',
  ];
  if (!(await assembleAndExecute(page, halting))) {
    report.check(`${p} the halting program is loaded`, false);
    return;
  }
  await page.evaluate(() => {
    window.__announced = [];
    window.__liveObserver?.disconnect();
    window.__liveObserver = new MutationObserver(() => {
      for (const element of document.querySelectorAll('[role=log], [role=status], [role=alert], [aria-live]')) {
        if (element.getAttribute('aria-live') === 'off') continue;
        const text = element.textContent.trim();
        if (text) window.__announced.push(text);
      }
    });
    window.__liveObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  // Breakpoint shapes, on the row of ADD.L, with the keyboard (Space in the Listing).
  await page.locator('[data-e68-panel="listing"] [role=listbox]').focus();
  const target = await page.evaluate(() => {
    const row = [...document.querySelectorAll('[data-e68-panel="listing"] [role=option]')].find((element) =>
      /ADD\.L/.test(element.textContent),
    );
    return row ? Number(row.getAttribute('data-row')) : -1;
  });
  const selected = await page.evaluate(() => window.__easy68k.ctx.store.getState().sim.selectedRow);
  for (let i = 0; i < Math.abs(target - selected); i++)
    await page.keyboard.press(target > selected ? 'ArrowDown' : 'ArrowUp');
  await page.keyboard.press('Space');
  const dots = await page.evaluate((row) => {
    const on = document.querySelector(`[data-e68-panel="listing"] [data-row="${row}"] .e68-listing__dot--on`);
    const off = document.querySelector('[data-e68-panel="listing"] [data-bp="off"] .e68-listing__dot');
    const option = document.querySelector(`[data-e68-panel="listing"] [data-row="${row}"]`);
    const describedBy = option?.getAttribute('aria-describedby');
    const spoken = [
      option?.getAttribute('aria-label') ?? option?.textContent ?? '',
      describedBy ? (document.getElementById(describedBy)?.textContent ?? '') : '',
      option?.getAttribute('aria-description') ?? '',
    ].join(' ');
    return {
      on: on ? getComputedStyle(on).backgroundColor : null,
      off: off ? getComputedStyle(off).backgroundColor : null,
      spoken: spoken.replace(/\s+/g, ' ').trim(),
    };
  }, target);
  const onFill = dots.on ? parseColor(dots.on) : null;
  const offFill = dots.off ? parseColor(dots.off) : null;
  report.check(
    `${p} a breakpoint dot is filled and an instruction dot is not (shape, not only colour)`,
    onFill !== null && offFill !== null && onFill.a >= 0.99 && offFill.a <= 0.5,
    `breakpoint ${dots.on}, instruction ${dots.off}`,
  );
  report.check(
    `${p} a row with a breakpoint says so to a screen reader`,
    /break\s*point/i.test(dots.spoken),
    `the row is read as "${dots.spoken.slice(0, 90)}"`,
  );
  await page.keyboard.press('Space');
  // Run to the halt; something polite says so.
  await pressCommand(page, 'sim.run.run');
  const halted = await waitFor(page, () => window.__easy68k.ctx.sim.controller.snapshot.halted === true, null, 20_000);
  await page.waitForTimeout(1200);
  const announced = await page.evaluate(() => {
    window.__liveObserver.disconnect();
    return [...new Set(window.__announced)];
  });
  report.check(
    `${p} a halt is announced by a live region`,
    halted && announced.some((text) => /halt/i.test(text)),
    `halted ${halted}; live regions said: ${JSON.stringify(announced.slice(-4)).slice(0, 200)}`,
  );
}

/** Reduced motion: nothing of the interface moves; the Memory cursor does not blink. */
async function motionChecks(browser, os, baseUrl, p, report) {
  const results = {};
  for (const motion of ['reduce', 'no-preference']) {
    const context = await newContext(browser, os, { reducedMotion: motion });
    const { page } = await openApp(context, baseUrl);
    try {
      await setMode(page, 'simulator');
      await run(page, 'sim.view.memory');
      await page.waitForSelector('[data-e68-panel="memory"] .e68-memory__rows');
      await page.locator('[data-e68-panel="memory"] .e68-memory__rows').focus();
      await page.waitForTimeout(1200);
      results[motion] = await page.evaluate(() => {
        const cursor = document.querySelector('.e68-memory__cursor');
        return {
          cursor: cursor ? getComputedStyle(cursor).animationName : null,
          running: document
            .getAnimations()
            .filter((animation) => animation.playState === 'running')
            .map(
              (animation) =>
                `${animation.animationName ?? animation.constructor.name} on ${animation.effect?.target?.className ?? '?'}`,
            ),
        };
      });
    } finally {
      await closeWithin(context);
    }
  }
  report.check(
    `${p} reduced motion: no interface animation runs and the Memory cursor does not blink`,
    results.reduce.cursor === 'none' && results.reduce.running.length === 0,
    JSON.stringify(results.reduce),
  );
  report.check(
    `${p} without reduced motion the Memory cursor blinks (the check sees the animation)`,
    results['no-preference'].cursor !== null && results['no-preference'].cursor !== 'none',
    JSON.stringify(results['no-preference']),
  );
}

/**
 * Version 1.1 (ARCHITECTURE-PLUS P9.2; M1): a floating window open. The Hardware panel is made to
 * float from its tab menu with the keyboard (Shift+F10, Float). The window is a region named
 * `Hardware, floating`, not a dialog; its title bar is a named Tab stop that opens a menu; its
 * buttons are named; the panels on screen keep their roles and names; the tool tabs that stay are
 * a tablist; every tab stop still shows a focus indicator.
 */
async function floatingWindowChecks(page, os, p, report) {
  const tab = page.locator('[id="flexlayout-tabbutton-simulator:hardware"]');
  await tab.focus();
  await page.keyboard.press('Shift+F10');
  const item = page.locator('[role=menu] [role^=menuitem]', { hasText: /^Float$/ });
  await item.first().waitFor({ timeout: 5000 });
  // Chosen with the keyboard: the arrows down to Float (the menu focuses its first item), Enter.
  for (let i = 0; i < 12; i++) {
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    if (focused === 'Float') break;
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Enter');
  await page.waitForSelector('.flexlayout__tab[data-e68-float="hardware"]', { timeout: 5000 });
  await page.waitForTimeout(300);
  const facts = await page.evaluate(() => {
    const window = document.querySelector('.flexlayout__tab[data-e68-float="hardware"]');
    const title = window?.querySelector('[data-e68-float-title]');
    const buttons = [...(window?.querySelectorAll('[data-e68-float-bar] button') ?? [])];
    return {
      role: window?.getAttribute('role'),
      name: window?.getAttribute('aria-label'),
      dialog:
        window?.closest('[role=dialog],[role=alertdialog]') !== null || window?.getAttribute('aria-modal') !== null,
      titleRole: title?.getAttribute('role'),
      titleName: title?.textContent?.trim(),
      titleTabStop: title?.tabIndex === 0,
      titlePopup: title?.getAttribute('aria-haspopup'),
      buttons: buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim() ?? ''),
    };
  });
  report.check(
    `${p} a floating window is a region named "Hardware, floating", not a dialog`,
    facts.role === 'region' && facts.name === 'Hardware, floating' && !facts.dialog,
    JSON.stringify(facts),
  );
  report.check(
    `${p} its title bar is a named Tab stop that opens a menu; its buttons are named`,
    facts.titleRole === 'button' &&
      facts.titleName === 'Hardware' &&
      facts.titleTabStop &&
      facts.titlePopup === 'menu' &&
      facts.buttons.length === 2 &&
      facts.buttons.every((text) => text !== ''),
    JSON.stringify(facts),
  );
  await page.locator('[data-e68-float-title="hardware"]').focus();
  await page.keyboard.press('Shift+F10');
  const menu = await page
    .locator('[role=menu] [role^=menuitem]')
    .evaluateAll((elements) => elements.map((element) => element.textContent.trim()))
    .catch(() => []);
  await page.keyboard.press('Escape');
  report.check(
    `${p} the title bar's menu by keyboard (Shift+F10): Move, Size, Dock, Close`,
    JSON.stringify(menu) === JSON.stringify(['Move', 'Size', 'Dock', 'Close']),
    JSON.stringify(menu),
  );
  await panelChecks(page, p, report, 'simulator');
  await toolTabChecks(page, p, report);
  await focusVisibleChecks(page, os, p, report, 'simulator with a floating window');
}

export async function structurePart({ browser, name, os, baseUrl, report, outDir, enginesPresent }) {
  // The Windows key map in the light theme, the macOS key map in the dark one: the focus
  // indicators are judged in both themes.
  const theme = os === 'mac' ? 'dark' : 'light';
  const p = `${name}/${os} ${theme}:`;
  console.log(`\n[${name}, ${os} key map, ${theme} theme: structure of 2.11]`);
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context, baseUrl);
  try {
    await page.evaluate((value) => window.__easy68k.ctx.commands.run('app.theme.set', value), theme);
    for (const mode of ['editor', 'simulator', 'easybin']) {
      await setMode(page, mode);
      await menuBarChecks(page, os, p, report, mode);
      await toolbarChecks(page, p, report, mode);
      await panelChecks(page, p, report, mode);
      await focusVisibleChecks(page, os, p, report, mode);
    }
    // View > Memory chosen with the keyboard: the panel shows, its tab is selected, it has the focus.
    await setMode(page, 'simulator');
    const chosen = await chooseByKeyboard(page, os, 'View', 'Memory');
    await page.waitForTimeout(300);
    const focus = await focusOf(page);
    report.check(
      `${p} View > Memory chosen with the keyboard moves the focus into the Memory panel`,
      chosen && focus.panel === 'memory',
      describeFocus(focus),
    );
    for (const panel of ['stack', 'hardware', 'breakpoints', 'log']) await run(page, `sim.view.${panel}`);
    await page.waitForTimeout(200);
    await panelChecks(page, p, report, 'simulator');
    await toolTabChecks(page, p, report);
    await focusVisibleChecks(page, os, p, report, 'simulator with the tool panels');
    await shoot(page, outDir, `${name}-${os}-structure-simulator`);
    await floatingWindowChecks(page, os, p, report);
    await shoot(page, outDir, `${name}-${os}-structure-simulator-floating`);
    await page.locator('[data-e68-float-dock="hardware"]').click();
    await page.waitForTimeout(300);
    await semanticsChecks(page, p, report);
    if (enginesPresent) {
      await haltAndBreakpointChecks(page, p, report);
      await mirrorRateCheck(page, p, report);
    } else {
      report.note(`${p} halt, breakpoint and text-mirror checks skipped: engine/dist is missing`);
    }
    report.check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await closeWithin(context);
  }
  await motionChecks(browser, os, baseUrl, p, report);
}
