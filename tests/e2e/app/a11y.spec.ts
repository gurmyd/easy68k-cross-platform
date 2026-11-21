// Accessibility scan of each mode and each dialog (ARCHITECTURE.md 2.11, 6.6, 6.9 item 8: no
// "serious" or "critical" finding of @axe-core/playwright). Owner: X1.
//
// Dialogs of wave-2 features (E4, E5, E6) are scanned once their package has landed
// (fixtures/pending.ts).

import { AxeBuilder } from '@axe-core/playwright';
import { crlf, expect, requirePackage, test, type App } from '../fixtures';

/**
 * Findings that are not failures of this suite, each with its reason (errata X1 entry 8). A node
 * matches when its rule is `rule` and its HTML matches `html`. Anything else serious or critical
 * fails the test.
 */
const ALLOWED: { rule: string; html: RegExp; owner: string; reason: string }[] = [
  {
    // Syntax colours are the original's (2.8: the Auto preset in the light theme, the presets and
    // custom colours chosen by the user), so their contrast against the editor background is
    // the original's too, quirks included: Macro/Other (unknown, $808000 olive) and Structure Error
    // (error, red) on white are below 4.5:1. Fidelity comes first (section 0), and the user can
    // change them. Only colour contrast is allowed, only on text drawn in a syntax colour: the
    // editor's syntax spans (also in the Assembler Status dialog's source line, with the error
    // squiggle) and the element samples of Editor Options > Colors.
    rule: 'color-contrast',
    html: /class="[^"]*\b(e68-syntax__\w+|e68-squiggle\b[^"]*)"|data-element="/,
    owner: 'E3, E4, E5 (by design, 2.8)',
    reason: 'text drawn in a syntax colour of the original',
  },
  {
    // A known defect of SH4's Output panel, not of the suites: the scrolling viewport of the
    // Simulator's text window cannot take the keyboard focus. Reported to SH4 (X1 result of verify
    // round 1); remove this entry when SH4 has repaired it (the test then still passes).
    rule: 'scrollable-region-focusable',
    html: /class="[^"]*\be68-output__viewport\b/,
    owner: 'SH4',
    reason: 'the Output panel viewport is not focusable (known defect, reported to SH4)',
  },
];

/** Whether a finding's node is one of ALLOWED, and which. */
function allowedFor(rule: string, html: string): (typeof ALLOWED)[number] | undefined {
  return ALLOWED.find((entry) => entry.rule === rule && entry.html.test(html));
}

/** Runs axe on the page (or a part) and returns the serious and critical findings, described. */
async function serious(app: App, include?: string): Promise<string[]> {
  // The Help panel's frame holds the original help pages in a sandbox without scripts (2.7): axe
  // cannot run inside it (it would wait for the frame until the test times out), and its content
  // is the original's, not the port's interface. The panel around it is scanned.
  let builder = new AxeBuilder({ page: app.page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('.e68-help__frame');
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  const found: string[] = [];
  for (const v of result.violations) {
    if (v.impact !== 'serious' && v.impact !== 'critical') continue;
    const nodes = v.nodes.filter((n) => {
      const allowed = allowedFor(v.id, n.html);
      if (allowed)
        test.info().annotations.push({
          type: 'allowed axe finding',
          description: `${v.id} on ${n.target.join(' ')}: ${allowed.reason} (${allowed.owner})`,
        });
      return !allowed;
    });
    if (nodes.length === 0) continue;
    found.push(
      `${v.id} (${v.impact}, ${nodes.length}): ${nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`,
    );
  }
  return found;
}

test('the allowed findings are exactly the syntax colours and the known Output panel defect', () => {
  expect(allowedFor('color-contrast', '<span class="e68-syntax__unknown">X</span>')).toBeDefined();
  expect(
    allowedFor('color-contrast', '<span class="e68-squiggle e68-squiggle--error" title="ERROR">B</span>'),
  ).toBeDefined();
  expect(allowedFor('color-contrast', '<span data-element="error" style="color: red">x</span>')).toBeDefined();
  expect(allowedFor('color-contrast', '<button class="e68-button">OK</button>')).toBeUndefined();
  expect(allowedFor('link-name', '<span class="e68-syntax__unknown">X</span>')).toBeUndefined();
  expect(allowedFor('scrollable-region-focusable', '<div class="e68-output__viewport">')).toBeDefined();
  expect(allowedFor('scrollable-region-focusable', '<div class="e68-grid__body">')).toBeUndefined();
});

const mode = (app: App, name: string) =>
  app.page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name }).click();

for (const theme of ['Light', 'Dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ app }) => {
      await app.toolbarButton('app.theme.set').click();
      await app.menuItem(app.openMenuList, theme).click();
      await expect(app.page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
    });

    test('Editor mode with a source document and a list document', async ({ app }) => {
      await app.dropFiles([{ name: 'p.L68', data: crlf('00001000  4E71   1  NOP') }]);
      await expect.poll(() => app.tabNames()).toContain('p.L68');
      await app.tab('untitled1.x68').click();
      expect(await serious(app)).toEqual([]);
    });

    test('Simulator mode with the tool panels', async ({ app }) => {
      await mode(app, 'Simulator');
      await expect.poll(() => app.mode()).toBe('simulator');
      for (const panel of ['Memory', 'Stack', 'Hardware']) await app.chooseMenu('View', panel);
      expect(await serious(app)).toEqual([]);
    });

    test('EASyBIN mode', async ({ app }) => {
      await mode(app, 'EASyBIN');
      await expect.poll(() => app.mode()).toBe('easybin');
      expect(await serious(app)).toEqual([]);
    });
  });
}

test.describe('dialogs', () => {
  test('the About box of Editor mode', async ({ app }) => {
    await app.chooseMenu('Help', 'About');
    await expect(app.dialog('About EASy68K')).toBeVisible();
    expect(await serious(app)).toEqual([]);
  });

  test('the Open File dialog', async ({ app }) => {
    await app.press('ed.file.open');
    await expect(app.dialog('Open File')).toBeVisible();
    expect(await serious(app)).toEqual([]);
  });

  test('the Save As dialog', async ({ app }) => {
    await app.chooseMenu('File', 'Save As...');
    await expect(app.dialog('Save As')).toBeVisible();
    expect(await serious(app)).toEqual([]);
  });

  test('the close prompt', async ({ app, page }) => {
    await app.select(0);
    await page.keyboard.type('x');
    await app.chooseMenu('File', 'Close File');
    await expect(app.messageBox).toBeVisible();
    expect(await serious(app)).toEqual([]);
  });

  test('the Help panel', async ({ app, page }) => {
    await app.chooseMenu('Help', 'Help');
    await expect(page.locator('[data-e68-panel="help"]')).toBeVisible();
    expect(await serious(app)).toEqual([]);
  });

  test('the About box and the Open dialog of Simulator mode', async ({ app, page }) => {
    await mode(app, 'Simulator');
    await expect.poll(() => app.mode()).toBe('simulator');
    await app.chooseMenu('Help', 'About Sim68K');
    const about = page.locator('[role=dialog][aria-modal=true]').last();
    await expect(about).toBeVisible();
    expect(await serious(app), 'About Sim68K').toEqual([]);
    await page.keyboard.press('Escape');
    await expect(about).toBeHidden();
    await app.toolbarButton('sim.file.open').click();
    const open = page.locator('[role=dialog][aria-modal=true]').last();
    await expect(open).toBeVisible();
    expect(await serious(app), 'Simulator Open').toEqual([]);
    await page.keyboard.press('Escape');
  });

  test('Find and Replace (E6)', async ({ app, page }) => {
    await requirePackage(app, 'E6');
    await app.focusEditor();
    await app.press('ed.edit.find');
    await expect(app.dialog('Find')).toBeVisible();
    expect(await serious(app), 'Find').toEqual([]);
    await app.button(app.dialog('Find'), 'Cancel').click();
    await app.chooseMenu('Edit', 'Find And Replace...');
    await expect(app.dialog('Replace')).toBeVisible();
    expect(await serious(app), 'Replace').toEqual([]);
    await page.keyboard.press('Escape');
  });

  test('Assembler Options, Editor Options and Import/Export Settings (E4)', async ({ app, page }) => {
    await requirePackage(app, 'E4');
    await app.chooseMenu('Options', 'Assembler Options...');
    const assembler = app.dialog('EASy68K Assembler Options');
    await expect(assembler).toBeVisible();
    expect(await serious(app), 'Assembler Options').toEqual([]);
    await app.button(assembler, 'Cancel').click();
    await app.chooseMenu('Options', 'Editor Options...');
    const editor = app.dialog('EASy68K Editor Options');
    await expect(editor).toBeVisible();
    for (const tab of ['General', 'Colors']) {
      await editor.getByRole('tab', { name: tab }).click();
      expect(await serious(app), `Editor Options, ${tab}`).toEqual([]);
    }
    await app.button(editor, 'Cancel').click();
    await app.chooseMenu('Options', 'Import/Export Settings...');
    await expect(page.locator('[role=dialog]').last()).toBeVisible();
    expect(await serious(app), 'Import/Export Settings').toEqual([]);
  });

  test('the Assembler Status dialog and the Messages panel (E5)', async ({ app }) => {
    await requirePackage(app, 'E5');
    await app.replaceText(crlf('    ORG    $1000', 'START:', '    BADOP', '    END    START').replace(/\r/g, ''));
    await app.focusEditor();
    await app.press('ed.project.assemble');
    const status = app.dialog('Assembler Status - untitled1.x68');
    await expect(status).toBeVisible();
    expect(await serious(app), 'Assembler Status').toEqual([]);
    await app.button(status, 'Close').click();
    expect(await serious(app), 'Messages panel').toEqual([]);
  });
});
