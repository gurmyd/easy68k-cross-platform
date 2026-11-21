// Browser check of the help, the About boxes and the examples (ARCHITECTURE.md 9.2, H1 acceptance).
// Owner: H1.
//
//   node app/src/features/help/check-help.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite development server of app/ on a free port and drives the real application in
// headless Chromium and WebKit (Playwright). It checks what unit tests under Node cannot show:
//
//   - F1 and Help > Help open the Help drawer in every mode; the page is in a frame with
//     sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" (no scripts);
//   - pages render with their images (also the ones whose file names the import re-cased) and
//     with their special characters (credits.htm, fileio.htm) in UTF-8;
//   - the contents tree opens pages, the filter narrows it, Back and Forward work, links inside
//     the pages are handled by the panel (web addresses go to the system's browser);
//   - F1 in the editor looks up the selection or the word at the caret; ed.help.context is
//     enabled only while the editor has the focus; F1 in Simulator mode;
//   - Escape and the Close button hide the drawer;
//   - both About boxes: the original texts, the port's notice, the update check (answered from a
//     route, so that no network is needed), OK and Escape;
//   - Help > Examples... copies the ten programs and six sounds into /browser/Examples, byte for
//     byte, once; Help > Differences from EASy68K;
//   - the panel and the About box in the light and the dark theme (screenshots below build/).
//
// Screenshots go to build/help-check (git-ignored). Exit code 0 = everything passed. It uses
// window.__easy68k, which exists in development builds only (main.tsx).

/* global console, process, document, window, getSelection, NodeFilter, fetch, setTimeout, TextEncoder, TextDecoder, getComputedStyle -- browser globals are used inside page.evaluate() callbacks, which run in the page */

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../..');
const repoRoot = resolve(appRoot, '..');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'help-check')));
mkdirSync(outDir, { recursive: true });

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

let baseUrl = '';
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

// --- helpers --------------------------------------------------------------------------

async function openApp(browser) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.setDefaultTimeout(60000);
  await page.goto(baseUrl, { timeout: 240000 });
  await page.waitForSelector('.e68-shell', { timeout: 240000 });
  await page.waitForFunction(() => window.__easy68k !== undefined);
  return { context, page, errors };
}

const setMode = (page, mode) => page.locator(`.e68-modeswitch [data-mode="${mode}"]`).click();
const run = (page, id, arg) => page.evaluate(([c, a]) => window.__easy68k.ctx.commands.run(c, a), [id, arg]);
const helpVisible = (page) =>
  page
    .locator('[data-e68-panel="help"] .e68-help')
    .count()
    .then((n) => n > 0);

/** The frame of the Help panel, once it shows a page whose address ends with `suffix`. */
async function helpFrame(page, suffix) {
  await page.waitForSelector('.e68-help__frame');
  await page
    .waitForFunction(
      ([end]) => {
        const element = document.querySelector('.e68-help__frame');
        let href;
        try {
          href = element.contentWindow.location.href;
        } catch {
          return false;
        }
        return decodeURIComponent(href).endsWith(end) && element.contentDocument.readyState === 'complete';
      },
      [suffix],
      { timeout: 15000 },
    )
    .catch(() => {});
  // Playwright's own frame object is not used: it can go stale when the frame navigates. `locator`
  // finds elements in the frame as it is now; `evaluate` runs a function with the frame's document
  // as its `document` (the frame is same-origin, so the page may read it).
  const frameLocator = page.frameLocator('.e68-help__frame');
  return {
    locator: (...selectorArgs) => frameLocator.locator(...selectorArgs),
    evaluate: (fn) =>
      page.evaluate(
        async ([source]) => {
          const doc = document.querySelector('.e68-help__frame').contentDocument;
          return await new Function('document', `return (${source})()`)(doc);
        },
        [fn.toString()],
      ),
  };
}

const frameUrl = (page) =>
  page.evaluate(() => {
    try {
      return decodeURIComponent(document.querySelector('.e68-help__frame').contentWindow.location.href);
    } catch {
      return '';
    }
  });

async function menuItem(page, menu, label) {
  await page
    .locator('.e68-shell__menubar [role=menuitem]')
    .filter({ hasText: new RegExp(`^${menu}$`) })
    .click();
  await page.locator('[role=menu] [role=menuitem]').filter({ hasText: label }).first().click();
}

/** Loads a page of the help and reports on its images and text. */
async function pageFacts(page, target) {
  await run(page, 'ed.help.help', target);
  const frame = await helpFrame(page, target);
  return frame.evaluate(async () => {
    const images = Array.from(document.images);
    await Promise.all(
      images.map((image) =>
        image.complete ? null : new Promise((done) => ((image.onload = done), (image.onerror = done))),
      ),
    );
    return {
      title: document.title,
      charset: document.characterSet,
      images: images.length,
      broken: images.filter((image) => !(image.naturalWidth > 0)).map((image) => image.getAttribute('src')),
      text: document.body.textContent,
    };
  });
}

/** An axe scan (WCAG 2.0/2.1 A and AA) of what the panel draws; the original's pages in the frame are not ours to judge. */
async function scan(page, label) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('.e68-help__frame')
    .analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const describe = (list) =>
    list.map(
      (v) =>
        v.id +
        ' (' +
        v.impact +
        ', ' +
        v.nodes.length +
        '): ' +
        v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | '),
    );
  check('axe ' + label + ': no serious finding', serious.length === 0, describe(serious).join('; '));
  const other = result.violations.filter((v) => !serious.includes(v));
  if (other.length) console.log('        minor findings: ' + describe(other).join('; '));
}

// --- the checks -------------------------------------------------------------------------

async function drawerPass(browser, name) {
  const p = `${name}:`;
  const { context, page, errors } = await openApp(browser);

  // F1 with the focus on the page frame: the help, not a context lookup.
  check(`${p} the drawer is closed at the start`, !(await helpVisible(page)));
  await page.locator('.e68-shell__body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('F1');
  await page.waitForSelector('[data-e68-panel="help"] .e68-help');
  const frame = await helpFrame(page, '/help/main.htm');
  check(
    `${p} F1 opens the Help drawer at the introduction`,
    (await frameUrl(page)).endsWith('/help/main.htm'),
    await frameUrl(page),
  );
  check(
    `${p} the page is in a frame without scripts (sandbox without allow-scripts)`,
    (await page.locator('.e68-help__frame').getAttribute('sandbox')) ===
      'allow-same-origin allow-popups allow-popups-to-escape-sandbox',
  );
  const intro = await frame.evaluate(() => ({ title: document.title, charset: document.characterSet }));
  check(
    `${p} the introduction is "Easy68k Introduction", read as UTF-8`,
    intro.title === 'Easy68k Introduction' && intro.charset === 'UTF-8',
    JSON.stringify(intro),
  );
  check(
    `${p} the drawer is a region named Help`,
    (await page.locator('section[role=region][aria-label="Help"]').count()) === 1,
  );

  // Pages with images, including the ones whose references the import re-cased.
  for (const target of [
    'BasicOperation.htm',
    'options.htm',
    'SIMHELP/BasicOperation.htm',
    'SIMHELP/AdvBreakpoints.htm',
    'SIMHELP/SimOptions.htm',
    'StrucControl/If.htm',
    'Reference/68ks1e.htm',
  ]) {
    const facts = await pageFacts(page, target);
    check(`${p} ${target}: all ${facts.images} images load`, facts.broken.length === 0, facts.broken.join(', '));
  }
  const withImages = await pageFacts(page, 'SIMHELP/AdvBreakpoints.htm');
  check(
    `${p} SIMHELP/AdvBreakpoints.htm has the images that were re-cased (3 of them)`,
    withImages.images >= 3 && withImages.broken.length === 0,
  );
  await page.screenshot({ path: join(outDir, `${name}-help-simulator-page.png`) });

  // Special characters.
  const credits = await pageFacts(page, 'credits.htm');
  check(
    `${p} credits.htm shows "Jimmy Mårdell"`,
    credits.text.includes('Jimmy Mårdell'),
    JSON.stringify(credits.text.match(/Jimmy.{0,10}/)?.[0]),
  );
  const fileio = await pageFacts(page, 'fileio.htm');
  check(`${p} fileio.htm shows no-break spaces, no mojibake`, fileio.text.includes(' ') && !/[�Â]/.test(fileio.text));
  const ref = await pageFacts(page, 'Reference/68ks4d.htm');
  check(`${p} Reference/68ks4d.htm (MOVE) renders`, ref.text.length > 500 && !/[�Â]/.test(ref.text), ref.title);
  await page.screenshot({ path: join(outDir, `${name}-help-credits.png`) });
  await run(page, 'ed.help.help', 'credits.htm');
  await helpFrame(page, 'credits.htm');
  await page.screenshot({
    path: join(outDir, `${name}-help-credits-frame.png`),
    clip: await page.locator('[data-e68-panel="help"]').boundingBox(),
  });

  check(`${p} the drawer: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function navigationPass(browser, name) {
  const p = `${name}:`;
  const { context, page, errors } = await openApp(browser);
  await run(page, 'ed.help.help');
  await helpFrame(page, '/help/main.htm');
  await page.waitForSelector('.e68-help__tree [role=treeitem]');
  const items = await page.locator('.e68-help__tree [role=treeitem]').count();
  check(`${p} the contents tree has the eleven books at the top`, items === 11, `${items} rows`);

  // The tree: open a book, choose a page.
  await page.locator('.e68-help__tree [role=treeitem]', { hasText: /^\s*Credits$/ }).click();
  await helpFrame(page, 'credits.htm');
  check(`${p} choosing "Credits" in the tree shows credits.htm`, (await frameUrl(page)).endsWith('/help/credits.htm'));
  check(
    `${p} the current page is marked in the tree`,
    (await page.locator('.e68-help__tree [aria-selected=true]').innerText()).trim() === 'Credits',
  );
  await page.locator('.e68-help__tree [role=treeitem]', { hasText: 'Simulator Operation' }).click();
  const expanded = await page
    .locator('.e68-help__tree [role=treeitem]', { hasText: 'Simulator Operation' })
    .getAttribute('aria-expanded');
  check(`${p} clicking a book opens it`, expanded === 'true');

  // Keyboard in the tree.
  await page.locator('.e68-help__tree [role=treeitem]').first().focus();
  await page.keyboard.press('End');
  const last = await page.evaluate(() => document.activeElement.textContent);
  await page.keyboard.press('Home');
  const first = await page.evaluate(() => document.activeElement.textContent.trim());
  check(`${p} Home and End move through the tree`, first === 'Introduction' && last.length > 0, `${first} / ${last}`);
  await page.keyboard.press('Enter');
  await helpFrame(page, '/help/main.htm');
  check(`${p} Enter on "Introduction" shows main.htm`, (await frameUrl(page)).endsWith('/help/main.htm'));

  // The filter.
  await page.getByLabel('Filter the contents by title').fill('directive');
  const filtered = await page.locator('.e68-help__tree [role=treeitem]').allInnerTexts();
  check(
    `${p} the filter keeps the titles that match (and the books above them)`,
    filtered.length > 0 && filtered.length < items + 20 && filtered.some((t) => /directive/i.test(t)),
    filtered.slice(0, 4).join(' | '),
  );
  await page.getByLabel('Filter the contents by title').fill('no such title anywhere');
  check(
    `${p} a filter that matches nothing says so`,
    (await page.locator('.e68-help__note').innerText()).includes('No page has that title'),
  );
  await page.getByLabel('Filter the contents by title').fill('');

  // Back and Forward.
  await run(page, 'ed.help.help', 'credits.htm');
  await helpFrame(page, 'credits.htm');
  await run(page, 'ed.help.help', 'options.htm');
  await helpFrame(page, 'options.htm');
  await page.getByRole('button', { name: 'Back' }).click();
  await helpFrame(page, 'credits.htm');
  check(`${p} Back returns to the previous page`, (await frameUrl(page)).endsWith('/help/credits.htm'));
  await page.getByRole('button', { name: 'Forward' }).click();
  await helpFrame(page, 'options.htm');
  check(`${p} Forward goes on again`, (await frameUrl(page)).endsWith('/help/options.htm'));
  check(
    `${p} the browser's own history is not used (the page itself did not navigate)`,
    (await page.evaluate(() => window.history.length)) <= 2,
  );

  // Links inside a page.
  await run(page, 'ed.help.help', 'credits.htm');
  const frame = await helpFrame(page, 'credits.htm');
  await frame.locator('a', { hasText: 'GNU General Public Use License' }).click();
  await helpFrame(page, 'GNU General Public License.htm');
  check(
    `${p} an internal link (with %20 in it) opens the page in the panel`,
    (await frameUrl(page)).endsWith('/help/GNU General Public License.htm'),
    await frameUrl(page),
  );
  await page.getByRole('button', { name: 'Back' }).click();
  const credits = await helpFrame(page, 'credits.htm');
  // A web link of a page opens in a new tab: the page's own target="_blank" with the sandbox's
  // allow-popups. The request is answered from a route, so that no network is needed.
  await context.route('http://www.easy68k.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>easy68k</title>' }),
  );
  const external = context.waitForEvent('page', { timeout: 8000 }).catch(() => null);
  await credits.locator('a[href^="http://www.easy68k.com"]').click();
  const externalPage = await external;
  await externalPage?.waitForURL(/easy68k/, { timeout: 8000 }).catch(() => {});
  const externalUrl = externalPage?.url() ?? null;
  await externalPage?.close();
  await context.unroute('http://www.easy68k.com/**');
  check(
    `${p} a web link opens in a new tab, the frame stays`,
    externalUrl !== null &&
      externalUrl.startsWith('http://www.easy68k.com') &&
      (await frameUrl(page)).endsWith('credits.htm'),
    String(externalUrl),
  );

  // The PDF link of the Quick Reference opens in a new tab.
  await run(page, 'ed.help.help', 'Quick Reference.htm');
  const quick = await helpFrame(page, 'Quick Reference.htm');
  // The browser asks for the PDF: the link's own target="_blank" opens a new tab (which a headless
  // browser turns into a download), and the frame itself stays on the page.
  let pdfRequested = false;
  context.on('request', (request) => {
    if (/EASy68KQuickRef\.pdf/.test(request.url())) pdfRequested = true;
  });
  await quick.locator('a[href$=".pdf"]').click();
  for (let waited = 0; !pdfRequested && waited < 8000; waited += 100) await page.waitForTimeout(100);
  check(`${p} the Quick Reference PDF is requested in a new tab, not in the frame`, pdfRequested);
  check(`${p} the frame did not leave the page`, (await frameUrl(page)).endsWith('Quick Reference.htm'));

  // Escape and Close.
  await page.getByRole('button', { name: 'Contents' }).focus();
  await page.keyboard.press('Escape');
  check(`${p} Escape in the panel hides it`, !(await helpVisible(page)));
  await run(page, 'ed.help.help');
  await page.waitForSelector('[data-e68-panel="help"] .e68-help');
  await page.getByRole('button', { name: 'Close Help' }).click();
  check(`${p} the Close button hides the drawer`, !(await helpVisible(page)));

  // WebKit logs "Blocked script execution" when Playwright puts its own query script into the
  // script-less frame (frame.locator above). The panel attaches nothing to the frame, and the
  // pass that only reads the frame through the page (drawerPass) has no such message.
  const unexpected = errors.filter(
    (text) => !/Blocked script execution in .* frame is sandboxed|ac-archive\.css/.test(text),
  );
  check(`${p} navigation: no console or page errors`, unexpected.length === 0, unexpected.slice(0, 3).join(' | '));
  await context.close();
}

async function contextPass(browser, name) {
  const p = `${name}:`;
  const { context, page, errors } = await openApp(browser);

  // A stand-in for the editor region (the editor component may not be there yet): the same
  // attributes and CodeMirror's line class, outside React's tree.
  await page.evaluate(() => {
    const region = document.createElement('div');
    region.setAttribute('data-e68-panel', 'editor');
    region.setAttribute('id', 'fake-editor');
    region.contentEditable = 'true';
    region.tabIndex = 0;
    region.style.cssText =
      'position:fixed;left:10px;bottom:10px;width:300px;height:60px;background:#fff;color:#000;z-index:1';
    region.innerHTML =
      '<div class="cm-line">  MOVE.L D0,D1</div><div class="cm-line"> ORG $1000</div><div class="cm-line">  FOO D0</div>';
    document.body.append(region);
  });
  // The fake editor has no document behind it, so the document service's selection is switched off:
  // F1 then reads the page's selection, as it does for a stand-in service without selection().
  await page.evaluate(() => {
    window.__easy68k.ctx.documents.selection = undefined;
  });
  const enabled = () => page.evaluate(() => window.__easy68k.ctx.commands.isEnabled('ed.help.context'));
  check(`${p} ed.help.context is disabled while the editor does not have the focus`, !(await enabled()));

  const caretIn = (line, offset) =>
    page.evaluate(
      ([index, at]) => {
        const element = document.getElementById('fake-editor');
        element.focus();
        const node = element.children[index].firstChild;
        getSelection().collapse(node, at);
      },
      [line, offset],
    );
  const selectIn = (line, from, to) =>
    page.evaluate(
      ([index, a, b]) => {
        const element = document.getElementById('fake-editor');
        element.focus();
        const node = element.children[index].firstChild;
        const range = document.createRange();
        range.setStart(node, a);
        range.setEnd(node, b);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      },
      [line, from, to],
    );
  const expectPage = async (label, suffix) => {
    await helpFrame(page, suffix);
    const url = await frameUrl(page);
    check(`${p} ${label}`, url.endsWith(suffix), url.slice(url.indexOf('/help/')));
  };

  await caretIn(0, 4); // inside MOVE
  check(`${p} ed.help.context is enabled while the editor has the focus`, await enabled());
  await page.keyboard.press('F1');
  await expectPage('F1 with the caret in "MOVE" opens the MOVE reference page', '/help/Reference/68ks4d.htm');

  await selectIn(1, 1, 4); // "ORG"
  await page.keyboard.press('F1');
  await expectPage('F1 with "ORG" selected opens the ORG directive page', '/help/Directives/org.htm');

  await caretIn(0, 2); // after two blanks: the character before the caret is white space
  await page.keyboard.press('F1');
  await expectPage('F1 after a blank opens the introduction', '/help/main.htm');

  // The very start of the document: the original does nothing (editor-ui 15.3).
  await page.getByRole('button', { name: 'Close Help' }).click();
  await caretIn(0, 0);
  await page.keyboard.press('F1');
  await page.waitForTimeout(300);
  check(`${p} F1 at the very start of the document does nothing`, !(await helpVisible(page)));

  await caretIn(2, 4); // inside FOO, which is not a keyword
  await page.keyboard.press('F1');
  await expectPage('F1 on a word that is not a keyword opens the introduction', '/help/main.htm');

  await page.evaluate(() => {
    document.getElementById('fake-editor').remove();
    delete window.__easy68k.ctx.documents.selection; // the real service again
  });
  await page.locator('.e68-shell__body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('F1');
  check(`${p} F1 with the focus elsewhere is Help > Help`, (await frameUrl(page)).endsWith('/help/main.htm'));
  await page.getByRole('button', { name: 'Close Help' }).click();

  // The real editor (CodeMirror), when the application has one: F1 in the template's SIMHALT line.
  const line = page.locator('[data-e68-panel="editor"] .cm-line', { hasText: 'SIMHALT' });
  if ((await line.count()) > 0) {
    // Put the caret into the middle of the word SIMHALT, the way a click would (the editor follows
    // the page's selection), and give the editor the focus.
    await page.evaluate(() => {
      const content = document.querySelector('[data-e68-panel="editor"] .cm-content');
      content.focus();
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent.indexOf('SIMHALT');
        if (at >= 0) {
          getSelection().collapse(node, at + 3);
          return;
        }
      }
    });
    // The editor follows the page's selection on the next selectionchange event: wait for it.
    await page.waitForFunction(() => {
      const { documents } = window.__easy68k.ctx;
      const id = documents.active().id;
      return documents
        .text(id)
        .slice(documents.selection(id).caret - 3)
        .startsWith('SIMHALT');
    });
    check(
      `${p} ed.help.context is enabled in the real editor`,
      await page.evaluate(() => window.__easy68k.ctx.commands.isEnabled('ed.help.context')),
    );
    await page.keyboard.press('F1');
    await expectPage(
      'F1 in the real editor on SIMHALT opens the SIMHALT directive page',
      '/help/Directives/simhalt.htm',
    );
    await page.getByRole('button', { name: 'Close Help' }).click();
    // The caret at the very start of the document: F1 does nothing (editor-ui 15.3).
    await page.evaluate(() => {
      const content = document.querySelector('[data-e68-panel="editor"] .cm-content');
      content.focus();
      const first = document.createTreeWalker(content.querySelector('.cm-line'), NodeFilter.SHOW_TEXT).nextNode();
      getSelection().collapse(first ?? content.querySelector('.cm-line'), 0);
    });
    // The editor follows the page's selection on the next selectionchange event: wait for it.
    await page.waitForFunction(() => {
      const { documents } = window.__easy68k.ctx;
      return documents.selection(documents.active().id).caret === 0;
    });
    await page.keyboard.press('F1');
    await page.waitForTimeout(300);
    check(`${p} F1 at the very start of the real editor's document does nothing`, !(await helpVisible(page)));
  } else {
    console.log('        (the application has no editor yet: the check of the real editor is skipped)');
  }

  // The drawer serves every mode.
  for (const mode of ['simulator', 'easybin', 'editor']) {
    await setMode(page, mode);
    await run(page, mode === 'simulator' ? 'sim.help.help' : 'ed.help.help');
    await page.waitForSelector('[data-e68-panel="help"] .e68-help');
    const regions = await page.locator('[data-e68-panel="help"]').count();
    check(
      `${p} the Help drawer appears in ${mode} mode`,
      regions === 1 && (await helpVisible(page)),
      `${regions} region(s)`,
    );
    if (mode === 'simulator') {
      await helpFrame(page, '/help/SIMHELP/BasicOperation.htm');
      check(
        `${p} Sim68K Help opens the simulator's page`,
        (await frameUrl(page)).endsWith('/help/SIMHELP/BasicOperation.htm'),
      );
      await page.locator('.e68-shell__body').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('F1');
      await helpFrame(page, '/help/SIMHELP/BasicOperation.htm');
      check(
        `${p} F1 in Simulator mode shows the simulator help`,
        (await frameUrl(page)).endsWith('/help/SIMHELP/BasicOperation.htm'),
      );
    }
  }
  check(`${p} context: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

const EDITOR_ABOUT_TEXTS = [
  'EASy68K Editor/Assembler v5.16.01',
  'The author of this software assumes no liabilty of its functionality and is not responsible for misuse by the user.  Use at your own risk.  This application is distributed under the GNU general public use license.',
  'GUI design: Tim Larson',
  'Original assembler code: Paul McKee',
  'Modifications and New Features: Charles Kelly',
  'www.easy68k.com',
  'Post comments and bug reports to the EASy68K forum.',
];
const SIM_ABOUT_TEXTS = [
  'EASy68K Simulator v5.16.1',
  'GUI implemenation: Charles Kelly',
  'Original simulator code: Paul McKee',
  'Simulator code modification: Charles Kelly, Eric Nelson',
  'www.easy68k.com',
  'Use the EASy68K forum to submit bug reports.',
  'EASy68K is distributed under the GNU general public use license. See Help for more information.',
  'The author of this software assumes no liability for its functionality and is not responsible for damages, losses or liabilities as a result of using this software.  Use at your own risk.',
];

async function aboutPass(browser, name) {
  const p = `${name}:`;
  const { context, page, errors } = await openApp(browser);
  await page.evaluate(() => {
    window.__opened = [];
    window.__easy68k.ctx.platform.openExternal = (url) => window.__opened.push(url);
  });

  for (const theme of ['light', 'dark']) {
    await run(page, 'app.theme.set', theme);
    await page.waitForFunction((value) => document.documentElement.getAttribute('data-theme') === value, theme);
    await menuItem(page, 'Help', /^About$/);
    const dialog = page.locator('[role=dialog]');
    await dialog.waitFor();
    const title = await dialog.locator('.e68-dialog__title').innerText();
    const lines = await dialog.locator('.e68-about p').allInnerTexts();
    const exact = EDITOR_ABOUT_TEXTS.every((text) => lines.includes(text));
    check(
      `${p} ${theme}: the editor's About box has the original title and texts, letter for letter`,
      title === 'About EASy68K' && exact,
      `${title}; missing: ${EDITOR_ABOUT_TEXTS.filter((t) => !lines.includes(t)).join(' | ')}`,
    );
    check(
      `${p} ${theme}: it adds the port's notice, version and repository link`,
      lines.some((t) => /unofficial web and macOS port/.test(t)) &&
        lines.some((t) => /unofficial port of EASy68K/.test(t)) &&
        lines.some((t) => /github\.com\/.+\/.+/.test(t)),
    );
    await page.screenshot({ path: join(outDir, `${name}-about-editor-${theme}.png`) });
    await scan(page, `${name} ${theme} editor About box`);

    if (theme === 'light') {
      // The update check, answered from a route.
      for (const [tag, expected] of [
        ['v0.0.0', 'Up to date'],
        ['v9.9.9', 'Update available'],
      ]) {
        await page.route('https://api.github.com/**', (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ tag_name: tag }),
            headers: { 'access-control-allow-origin': '*' },
          }),
        );
        await dialog.getByRole('button', { name: 'Check' }).click();
        await page
          .waitForFunction((text) => document.querySelector('.e68-about__answer')?.textContent === text, expected, {
            timeout: 8000,
          })
          .catch(() => {});
        const answer = await dialog.locator('.e68-about__answer').innerText();
        check(`${p} Check answers "${expected}" for release ${tag}`, answer === expected, answer);
        await page.unroute('https://api.github.com/**');
      }
      await page.route('https://api.github.com/**', (route) => route.abort());
      await dialog.getByRole('button', { name: 'Check' }).click();
      await page
        .waitForFunction(() => document.querySelector('.e68-about__answer')?.textContent === 'Network error', null, {
          timeout: 8000,
        })
        .catch(() => {});
      check(
        `${p} Check answers "Network error" when the request fails`,
        (await dialog.locator('.e68-about__answer').innerText()) === 'Network error',
      );
      await page.unroute('https://api.github.com/**');
      await dialog.locator('a', { hasText: 'www.easy68k.com' }).click();
      check(
        `${p} the link opens http://www.easy68k.com in the system's browser`,
        (await page.evaluate(() => window.__opened)).includes('http://www.easy68k.com'),
      );
      await page.keyboard.press('Escape');
      check(`${p} Escape closes the About box`, (await page.locator('[role=dialog]').count()) === 0);
      await menuItem(page, 'Help', /^About$/);
      await page.getByRole('button', { name: 'OK' }).click();
      check(`${p} OK closes the About box`, (await page.locator('[role=dialog]').count()) === 0);
    } else {
      await page.getByRole('button', { name: 'OK' }).click();
    }

    await setMode(page, 'simulator');
    await menuItem(page, 'Help', /About/);
    const sim = page.locator('[role=dialog]');
    await sim.waitFor();
    const simTitle = await sim.locator('.e68-dialog__title').innerText();
    const simLines = await sim.locator('.e68-about p').allInnerTexts();
    check(
      `${p} ${theme}: the simulator's About box has the original title and texts`,
      simTitle === 'About EASy68K Simulator' && SIM_ABOUT_TEXTS.every((text) => simLines.includes(text)),
      `${simTitle}; missing: ${SIM_ABOUT_TEXTS.filter((t) => !simLines.includes(t)).join(' | ')}`,
    );
    check(
      `${p} ${theme}: the simulator's box has no update check`,
      (await sim.getByRole('button', { name: 'Check' }).count()) === 0,
    );
    await page.screenshot({ path: join(outDir, `${name}-about-sim-${theme}.png`) });
    await page.keyboard.press('Escape');
    await setMode(page, 'editor');
  }
  // The aborted request of the update check is logged by the browser; that is the check's own doing.
  const unexpected = errors.filter((text) => !/ERR_FAILED|api.github.com/.test(text));
  check(`${p} About: no console or page errors`, unexpected.length === 0, unexpected.slice(0, 3).join(' | '));
  await context.close();
}

async function examplesPass(browser, name) {
  const p = `${name}:`;
  const { context, page, errors } = await openApp(browser);
  await menuItem(page, 'Help', /^Examples/);
  await page.waitForFunction(
    async () => {
      const { vfs } = window.__easy68k.ctx;
      const manifest = await (await fetch('examples/manifest.json')).json();
      for (const file of manifest.files) if ((await vfs.stat(`/browser/Examples/${file.name}`)) === null) return false;
      return true;
    },
    null,
    { timeout: 30000 },
  );
  const facts = await page.evaluate(async () => {
    const { vfs } = window.__easy68k.ctx;
    let list = [];
    let listError = '';
    // The listing of a folder can trail the writes by a moment; give it ten seconds.
    for (let waited = 0; waited <= 10000; waited += 250) {
      try {
        list = (await vfs.list('/browser/Examples')).map((entry) => entry.name).sort();
        listError = '';
        if (list.length >= 16) break;
      } catch (error) {
        listError = String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const manifest = await (await fetch('examples/manifest.json')).json();
    const same = [];
    for (const file of manifest.files) {
      const served = new Uint8Array(await (await fetch(`examples/${encodeURIComponent(file.name)}`)).arrayBuffer());
      const stored = await vfs.readFile(`/browser/Examples/${file.name}`);
      same.push(
        served.length === stored.length && served.every((byte, i) => byte === stored[i]) && served.length === file.size,
      );
    }
    return {
      list,
      listError,
      expected: manifest.files.map((file) => file.name).sort(),
      allSame: same.every(Boolean),
      count: same.length,
    };
  });
  check(
    `${p} Help > Examples... copies the ten programs and six sounds into /browser/Examples`,
    facts.list.length === 16 && JSON.stringify(facts.list) === JSON.stringify(facts.expected),
    facts.listError || facts.list.join(','),
  );
  check(`${p} the copies are byte for byte what the server holds`, facts.allSame && facts.count === 16);
  check(
    `${p} the Files panel is shown`,
    await page.evaluate(
      () =>
        window.__easy68k.ctx.settings.get().app.layout.panels.files?.visible === true ||
        document.querySelector('[data-e68-panel="files"]') !== null,
    ),
  );
  await page.evaluate(async () => {
    await window.__easy68k.ctx.vfs.writeFile('/browser/Examples/fileio.X68', new TextEncoder().encode('mine'));
  });
  await run(page, 'app.help.examples');
  await page.waitForTimeout(500);
  const kept = await page.evaluate(async () =>
    new TextDecoder().decode(await window.__easy68k.ctx.vfs.readFile('/browser/Examples/fileio.X68')),
  );
  check(`${p} a second Examples... does not overwrite the user's folder`, kept === 'mine');

  await menuItem(page, 'Help', /^Differences from EASy68K/);
  const frame = await helpFrame(page, '/help/Port/differences.htm');
  const title = await frame.evaluate(() => document.title);
  check(
    `${p} Help > Differences from EASy68K opens the generated page`,
    (await frameUrl(page)).endsWith('/help/Port/differences.htm') && /Differences/.test(title),
    title,
  );

  check(`${p} examples: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function themePass(browser, name) {
  const p = `${name}:`;
  for (const theme of ['light', 'dark']) {
    const { context, page, errors } = await openApp(browser);
    await run(page, 'app.theme.set', theme);
    await page.waitForFunction((value) => document.documentElement.getAttribute('data-theme') === value, theme);
    await run(page, 'ed.help.help');
    await helpFrame(page, '/help/main.htm');
    await page.locator('.e68-help__tree [role=treeitem]', { hasText: 'Assembler Commands' }).click();
    await page.screenshot({ path: join(outDir, `${name}-drawer-${theme}.png`) });
    const colours = await page.evaluate(() => {
      const bar = getComputedStyle(document.querySelector('.e68-help__bar')).backgroundColor;
      const body = getComputedStyle(document.querySelector('.e68-help')).backgroundColor;
      return { bar, body };
    });
    check(
      `${p} ${theme}: the panel around the page follows the theme`,
      colours.body !== colours.bar || theme === 'light',
      JSON.stringify(colours),
    );
    await scan(page, `${name} ${theme} Help drawer`);
    check(`${p} ${theme}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  }
}

// --- run -------------------------------------------------------------------------------

async function main() {
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    // No file watching and no hot reload: while other people edit the sources, a reload in the
    // middle of a check would fail it for a reason that is not the page's.
    server: { port: 5231, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5231;
  baseUrl = `http://127.0.0.1:${port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);

  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      try {
        console.log(`\n[${name}, drawer and pages]`);
        await drawerPass(browser, name);
        console.log(`\n[${name}, navigation]`);
        await navigationPass(browser, name);
        console.log(`\n[${name}, context help and modes]`);
        await contextPass(browser, name);
        console.log(`\n[${name}, About boxes]`);
        await aboutPass(browser, name);
        console.log(`\n[${name}, examples and differences]`);
        await examplesPass(browser, name);
        console.log(`\n[${name}, themes]`);
        await themePass(browser, name);
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  process.exit(failures ? 1 : 0);
}

await main();
