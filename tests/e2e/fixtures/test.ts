// The Playwright fixtures of the end-to-end suites (ARCHITECTURE.md 6.6). Owner: X1.
//
//   import { test, expect } from '../fixtures';
//   test('...', async ({ app }) => { ... });
//
// - `keys`     the key map the page is given (option; default: the host system's, fixtures/keys.ts).
//              `test.use({ keys: 'mac' })` runs a file with the other key map, for the commands the
//              application's dispatcher handles; the browser's own editing keys follow the real system.
// - `context`  every page of the context gets the chosen `navigator.platform` and the helper
//              `viewIn()` (fixtures/app.ts) before the application's code runs.
// - `app`      the application, opened at the start page in a fresh browser profile (a new context
//              per test: empty storage, no drafts, default settings). At the end of the test it must
//              have logged no console error and thrown no uncaught exception, in any of its windows.

import { test as base, expect } from '@playwright/test';
import { App } from './app';
import { hostKeyMap, navigatorPlatformOf, pretendPlatform, type KeyMap } from './keys';

/** Runs in every page: `viewIn(root)` finds the CodeMirror view of the document inside `root`. */
function installViewIn(): void {
  type Tile = { root?: { view?: unknown }; view?: unknown };
  (globalThis as unknown as { viewIn: (root: Element) => unknown }).viewIn = (root: Element) => {
    const content = root.matches('.cm-content') ? root : root.querySelector('.cm-content');
    if (!content) throw new Error('viewIn: no editor (.cm-content) in this element');
    // EditorView.findFromDOM of @codemirror/view 6.43: the content element's tile knows its root view.
    const holder = content as unknown as { cmTile?: Tile; cmView?: Tile };
    const tile = holder.cmTile ?? holder.cmView;
    const view = tile?.root?.view ?? tile?.view;
    if (!view) throw new Error('viewIn: the editor element carries no CodeMirror view');
    return view;
  };
}

/**
 * Console messages that are the intended result of the design, not errors of the application.
 * Each names the section that makes it so.
 */
export const EXPECTED_CONSOLE: readonly RegExp[] = [
  // 2.7: the Help panel shows the original pages in a sandboxed frame without scripts; Chromium and
  // WebKit log every script of those pages that the sandbox stops.
  /^Blocked script execution in '[^']*\/help\/[^']*' because the document's frame is sandboxed/,
];

interface Fixtures {
  keys: KeyMap;
  app: App;
}

export const test = base.extend<Fixtures>({
  keys: [hostKeyMap(), { option: true }],

  context: async ({ context, keys }, use) => {
    await context.addInitScript(pretendPlatform, navigatorPlatformOf(keys));
    await context.addInitScript(installViewIn);
    await use(context);
  },

  app: async ({ page, keys }, use) => {
    const app = new App(page, keys);
    await app.open();
    expect(await app.os(), 'the application uses the key map the test gave it').toBe(keys);
    await use(app);
    // Windows opened by the test (App.openWindow) are checked too.
    const errors = app.family.flatMap((w) => w.errors).filter((text) => !EXPECTED_CONSOLE.some((re) => re.test(text)));
    expect(errors, 'console errors and uncaught exceptions in the page').toEqual([]);
  },
});

export { expect };
