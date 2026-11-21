// Syntax highlighting in the real editor (ARCHITECTURE.md 1.3.3 row "Syntax highlighting", 2.4,
// 2.8, note 19; editor-ui §9, §20.1). Owner: X1. The algorithm's vectors are unit tests of E3;
// here: that the editor shows them, in the Auto preset's colours of each theme, on every line at
// once, and not in list documents.

import { crlf, expect, test, type App } from '../fixtures';

/** The text of each highlighted run of a line, with its element (class e68-syntax__<element>). */
async function runs(app: App, line: number): Promise<[string, string][]> {
  return app
    .content()
    .locator('.cm-line')
    .nth(line)
    .evaluate((element) =>
      [...element.querySelectorAll('[class*="e68-syntax__"]')].map((span) => [
        /e68-syntax__(\w+)/.exec(span.className)?.[1] ?? '',
        span.textContent ?? '',
      ]),
    ) as Promise<[string, string][]>;
}

const colourOf = (app: App, element: string) =>
  app
    .content()
    .locator(`.e68-syntax__${element}`)
    .first()
    .evaluate((span) => getComputedStyle(span).color);

test('lines of editor-ui §20.1 are coloured by element as soon as they are shown', async ({ app }) => {
  await app.replaceText(
    [
      '* comment',
      'START:  ORG    $1000   set origin',
      "    MOVE.B  #'A',D0     load char",
      '    IF D0 <EQ> #1 THE',
      "MSG     DC.B    'Hello',0     text",
    ].join('\n'),
  );
  await expect.poll(() => runs(app, 0)).toEqual([['comment', '* comment']]);
  const second = await runs(app, 1);
  expect(second).toContainEqual(['label', 'START:']);
  expect(second).toContainEqual(['directive', 'ORG']);
  expect(second.some(([element, text]) => element === 'comment' && text.includes('set origin'))).toBe(true);
  expect(await runs(app, 2)).toContainEqual(['text', "'A'"]);
  expect((await runs(app, 3)).some(([element]) => element === 'error')).toBe(true);
  const fifth = await runs(app, 4);
  expect(fifth).toContainEqual(['label', 'MSG']);
  expect(fifth).toContainEqual(['text', "'Hello'"]);
});

test('the Auto preset uses the original colours in the light theme and the dark set in the dark theme (2.8)', async ({
  app,
}) => {
  await app.replaceText('START:  ORG    $1000   set origin');
  await app.toolbarButton('app.theme.set').click();
  await app.menuItem(app.openMenuList, 'Light').click();
  await expect(app.page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => colourOf(app, 'comment')).toBe('rgb(0, 0, 255)');
  expect(await colourOf(app, 'label')).toBe('rgb(128, 0, 128)');
  expect(await colourOf(app, 'directive')).toBe('rgb(0, 128, 0)');

  await app.toolbarButton('app.theme.set').click();
  await app.menuItem(app.openMenuList, 'Dark').click();
  await expect(app.page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => colourOf(app, 'comment')).toBe('rgb(108, 182, 255)'); // #6CB6FF
  expect(await colourOf(app, 'label')).toBe('rgb(210, 168, 255)'); // #D2A8FF
  expect(await colourOf(app, 'directive')).toBe('rgb(107, 196, 109)'); // #6BC46D
});

test('a long source is highlighted to its last line, without scrolling (note 19)', async ({ app }) => {
  const lines = Array.from({ length: 400 }, (_, i) => `L${i}      NOP     comment ${i}`);
  await app.dropFiles([{ name: 'long.X68', data: crlf(...lines) }]);
  await expect.poll(() => app.tabNames()).toContain('long.X68');
  await app.select((await app.text()).length);
  await expect(app.content().locator('.cm-line', { hasText: 'L399' }).locator('.e68-syntax__label')).toHaveText('L399');
});

test('list documents (.L68, .S68) are not highlighted', async ({ app }) => {
  await app.dropFiles([
    {
      name: 'p.L68',
      data: crlf('00001000                             1  * comment', '00001000  4E71       2  START  NOP'),
    },
    { name: 'p.S68', data: crlf('S00600004844521B', 'S9030000FC') },
  ]);
  await expect.poll(() => app.tabNames()).toEqual(['untitled1.x68', 'p.L68', 'p.S68']);
  await expect(app.content().locator('[class*="e68-syntax__"]')).toHaveCount(0);
  await app.tab('p.L68').click();
  await expect.poll(() => app.text()).toContain('* comment');
  await expect(app.content().locator('[class*="e68-syntax__"]')).toHaveCount(0);
});
