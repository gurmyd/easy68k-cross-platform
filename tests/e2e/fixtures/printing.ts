// Printing without a print dialog. Owner: X1.
//
// The web platform prints a prepared document from a hidden frame (app/src/platform/web.ts): it
// focuses the frame, calls its `print()` and removes the frame on `afterprint`. Test automation
// cannot answer a print dialog, and headless browsers differ: Chromium reports `afterprint` at once,
// Playwright's WebKit returns from `print()` without it, so the platform ends the print by its other
// signs (about 1 s after `print()` returns when the page never lost the focus; errata W3.md entry 44;
// before that entry, by a 60-second fallback). `recordPrints` replaces `print()` in every child frame by
// one that records the document in the top window and then reports `afterprint`, as a browser does
// when its dialog closes, so every browser behaves the same and the printed content can be read.

import type { Page } from '@playwright/test';

/** One document handed to the browser's print(). */
export interface Printed {
  title: string;
  html: string;
  text: string;
}

/** Runs in every frame: a child frame's print() records its document in the top window. */
function recordPrintsInFrame(): void {
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

/** Installs the recording print() for every frame created from now on in this page. */
export async function recordPrints(page: Page): Promise<void> {
  await page.addInitScript(recordPrintsInFrame);
}

/**
 * Waits until no print is under way: the platform's hidden print frame is gone and the top document
 * has the keyboard focus again (the print feature gives it back, app/src/features/print/focus.ts).
 * A key pressed before that goes to the print frame, not to the page (errata/E6.md). The frame is
 * in the page as soon as the print command has run (Platform.print appends it synchronously), so
 * this is the moment to call it, after the key that printed. It polls on a timer, not on animation
 * frames, which GitHub's macOS runner at times does not deliver.
 */
export async function printsSettled(page: Page, timeout = 15_000): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector('iframe[srcdoc][aria-hidden="true"]') === null && document.hasFocus(),
    undefined,
    { polling: 50, timeout },
  );
}

/** The documents printed so far, in order. */
export function printed(page: Page): Promise<Printed[]> {
  return page.evaluate(() => (window as unknown as { __printed?: Printed[] }).__printed ?? []);
}
