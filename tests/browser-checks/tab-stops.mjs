// How many stops a walk with Tab has on the system a check runs on (errata SH7 entry 12).
//
// Chromium everywhere, and Playwright's WebKit on Windows and Linux, stop at every control. Safari's
// engine on a Mac, with the system's default setting ("Keyboard navigation" off), stops only at text
// fields, lists and elements with an explicit tabindex (tests/a11y/lib/keys.mjs isSafariTabStop):
// the Hardware panel has 49 stops on Windows and 14 on a Mac. A check that walks through a panel
// with Tab therefore cannot hold one number of stops; it asks here how many the walk has on its
// system.
//
// Not covered: a group of radio buttons is one stop in every browser (the panels walked today have
// none); a browser may add stops of its own (Chromium makes a scrolling box without controls a
// stop), which is why the figure is a least number and not an exact one.

/* global document -- used inside page callbacks, which run in the page */

import { isSafariTabStop } from '../a11y/lib/keys.mjs';

/** What Tab can reach at all. */
const CONTROLS = 'input, select, textarea, button, a[href], [tabindex], [contenteditable]';

/** Whether Tab stops at a plain button here (Safari on a Mac does not; Playwright's WebKit elsewhere does). */
export async function buttonsAreTabStops(browser) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent('<input id="a"><button id="b">b</button><input id="c">');
    await page.focus('#a');
    await page.keyboard.press('Tab');
    return (await page.evaluate(() => document.activeElement?.id)) === 'b';
  } finally {
    await context.close();
  }
}

/**
 * The stops of a walk that starts on a region's control and presses Tab (backward: Shift+Tab) until
 * the focus leaves the region. `controls` are the region's controls that Tab can reach, in document
 * order, each with `safari` (whether Safari on a Mac stops at it); `start` is the index of the one
 * that has the focus (-1: none, the walk has no stop). The start counts whatever it is (a check
 * puts the focus there itself); after it only what the system's Tab stops at.
 * @param {{ safari: boolean }[]} controls
 * @param {number} start
 * @param {boolean} backward
 * @param {boolean} buttonsStop whether Tab stops at every control (false: Safari's rule)
 */
export function stopsOfWalk(controls, start, backward, buttonsStop) {
  if (start < 0 || start >= controls.length) return 0;
  const rest = backward ? controls.slice(0, start) : controls.slice(start + 1);
  return 1 + rest.filter((control) => buttonsStop || control.safari).length;
}

/**
 * The least number of stops a walk must have: where Tab stops at every control, the number counted
 * in the page and never less than `floor` (the figure the check held before, counted on Windows);
 * where it follows Safari's rule, the number that rule gives.
 * @param {{ everywhere: number, safari: number }} need
 * @param {boolean} buttonsStop
 * @param {number} floor
 */
export function stopsRequired(need, buttonsStop, floor) {
  return buttonsStop ? Math.max(floor, need.everywhere) : need.safari;
}

/**
 * Read in the page, with the focus on the control the walk starts from: how many stops the walk
 * through `region` (a selector) has where Tab stops at every control, and how many by Safari's rule.
 * @returns {Promise<{ everywhere: number, safari: number }>}
 */
export async function tabStopsFromFocus(page, region, backward = false) {
  const handles = await page.locator(region).first().locator(CONTROLS).elementHandles();
  const controls = [];
  let start = -1;
  for (const handle of handles) {
    const facts = await handle.evaluate((element) => ({
      reachable: !element.disabled && element.tabIndex >= 0 && element.checkVisibility({ visibilityProperty: true }),
      focused: element === document.activeElement,
    }));
    if (facts.reachable) {
      if (facts.focused) start = controls.length;
      controls.push({ safari: await handle.evaluate(isSafariTabStop) });
    }
    await handle.dispose();
  }
  return {
    everywhere: stopsOfWalk(controls, start, backward, true),
    safari: stopsOfWalk(controls, start, backward, false),
  };
}
