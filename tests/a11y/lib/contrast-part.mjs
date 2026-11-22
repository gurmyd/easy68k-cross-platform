// Part "contrast" of the accessibility audit: the contrast of the colours that are not the
// port's design tokens, with the numbers (ARCHITECTURE.md 2.8 "Contrast", "Editor syntax
// colours"; 2.6 Hardware; section 0 fidelity rule). Owner: Q1.
//
// The original's own colours are part of the fidelity promise: the syntax colours of the Color1
// preset (the light theme's Auto) and of Color2 on the original's white background, the gutter
// dots of the listing, the Hardware panel's LEDs and segments. Where one is below the WCAG AA
// threshold it is printed as a difference from accessibility guidance that follows from
// fidelity (docs/differences/Q1.md), never a failure. The dark theme's Auto palette is the
// port's own (2.8) and must meet 4.5:1: a shortfall there is a defect.
//
// Two sources are compared: the palettes as the code defines them (core/highlight/presets.ts,
// imported in the page) and the colours the browser actually draws in the editor in each theme.

/* global document, window, getComputedStyle */

import { AA, contrastRatio, formatRatio, parseColor, toHex } from './contrast.mjs';
import { newContext, openApp, waitFor } from './app.mjs';
import { assembleAndExecute, PROGRAM } from './scan.mjs';

/** A source with every syntax element (editor-ui §9.2), typed by script: this part reads colours only. */
const ALL_ELEMENTS = [
  '* a comment line',
  'LABEL1   MOVE.L  #1,D0        ; comment after code',
  '         ORG     $1000',
  "TEXT1    DC.B    'a string',0",
  '         IF.L D0 <EQ> #1 THEN',
  '         ENDI',
  '         ENDW',
  '         UNKNOWNOP D1',
  '         END     LABEL1',
];

/** Contrast rows of a palette: element, colour, background, ratio, pass. */
export function paletteRows(name, styles, background, threshold = AA.text) {
  return Object.entries(styles).map(([element, colour]) => {
    const ratio = contrastRatio(colour, background);
    return { palette: name, element, colour, background, ratio, passes: ratio >= threshold, threshold };
  });
}

const show = (row) =>
  `${row.palette.padEnd(26)} ${row.element.padEnd(10)} ${row.colour} on ${row.background}  ${formatRatio(row.ratio).padStart(8)}  ${row.passes ? 'meets' : 'below'} ${row.threshold}:1`;

export async function contrastPart({ browser, name, baseUrl, report, enginesPresent }) {
  const p = `${name} contrast:`;
  console.log(`\n[${name}: contrast of the original's colours and of the dark Auto palette]`);
  const context = await newContext(browser, 'windows');
  const { page, errors } = await openApp(context, baseUrl);
  try {
    // 1. The palettes as defined.
    const palettes = await page.evaluate(async () => {
      const presets = await import('/src/core/highlight/presets.ts');
      const hex = (styles) =>
        Object.fromEntries(Object.entries(styles).map(([key, style]) => [key, presets.colorRefToHex(style.color)]));
      return {
        color1: hex(presets.COLOR1_STYLES),
        color2: hex(presets.COLOR2_STYLES),
        dark: hex(presets.AUTO_DARK.styles),
        darkBackground: presets.colorRefToHex(presets.AUTO_DARK.background),
        lightBackground: presets.colorRefToHex(presets.AUTO_LIGHT.background),
      };
    });
    const fidelity = [
      ...paletteRows('Color1 = Auto, light theme', palettes.color1, palettes.lightBackground),
      ...paletteRows('Color2', palettes.color2, palettes.lightBackground),
    ];
    const own = paletteRows('Auto, dark theme (port)', palettes.dark, palettes.darkBackground);
    console.log('        syntax colours as defined (WCAG 2 contrast, AA for normal text):');
    for (const row of [...fidelity, ...own]) console.log(`          ${show(row)}`);
    const below = fidelity.filter((row) => !row.passes);
    report.note(
      `${p} ${below.length} syntax colours of the original are below 4.5:1 on its white background (fidelity; docs/differences/Q1.md): ${below
        .map((row) => `${row.palette} ${row.element} ${row.colour} ${formatRatio(row.ratio)}`)
        .join(', ')}`,
    );
    const ownBelow = own.filter((row) => !row.passes);
    report.check(
      `${p} the dark theme's Auto syntax colours (the port's own, 2.8) meet 4.5:1 on ${palettes.darkBackground}`,
      ownBelow.length === 0,
      ownBelow.map((row) => `${row.element} ${row.colour} ${formatRatio(row.ratio)}`).join(', '),
    );

    // 2. What the editor draws, in each theme.
    await page.evaluate(
      (text) => {
        const id = window.__easy68k.ctx.store.getState().documents.activeId;
        const view = document.querySelector(`[data-e68-document="${id}"]`).e68View;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      },
      `${ALL_ELEMENTS.join('\n')}\n`,
    );
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => window.__easy68k.ctx.commands.run('app.theme.set', value), theme);
      await waitFor(page, (value) => document.documentElement.getAttribute('data-theme') === value, theme, 5000);
      await page.waitForTimeout(300);
      const drawn = await page.evaluate(() => {
        const background = (start) => {
          for (let node = start; node; node = node.parentElement) {
            const color = getComputedStyle(node).backgroundColor;
            if (color && !/rgba\(0, 0, 0, 0\)|transparent/.test(color)) return color;
          }
          return 'rgb(255, 255, 255)';
        };
        const byClass = {};
        for (const span of document.querySelectorAll('[data-e68-workspace="editor"] [class*="e68-syntax__"]')) {
          const element = /e68-syntax__(\w+)/.exec(span.className)?.[1];
          if (!element || byClass[element]) continue;
          byClass[element] = { colour: getComputedStyle(span).color, background: background(span) };
        }
        return byClass;
      });
      const rows = Object.entries(drawn).map(([element, { colour, background }]) => {
        const fg = parseColor(colour);
        const bg = parseColor(background);
        const ratio = contrastRatio(fg, { ...bg, a: 1 });
        return {
          palette: `drawn, ${theme} theme`,
          element,
          colour: toHex(fg),
          background: toHex(bg),
          ratio,
          passes: ratio >= AA.text,
          threshold: AA.text,
        };
      });
      console.log(`        syntax colours as the editor draws them, ${theme} theme:`);
      for (const row of rows) console.log(`          ${show(row)}`);
      const expected = theme === 'light' ? palettes.color1 : palettes.dark;
      const mismatched = rows.filter(
        (row) => expected[row.element] && expected[row.element].toUpperCase() !== row.colour,
      );
      report.check(
        `${p} ${theme} theme: the editor draws the Auto palette of 2.8 (${rows.length} elements seen)`,
        rows.length >= 5 && mismatched.length === 0,
        mismatched.map((row) => `${row.element} drawn ${row.colour}, defined ${expected[row.element]}`).join(', '),
      );
    }

    // 3. The listing's gutter dots (graphics, 3:1) and the Hardware panel's lights (2.6, fidelity).
    const tokens = await page.evaluate(() => {
      const value = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      const theme = () => ({
        surface: value('--c-surface'),
        selection: value('--c-selection'),
        on: value('--c-bp-on'),
        off: value('--c-bp-off'),
        onEdge: value('--c-bp-on-edge'),
        offEdge: value('--c-bp-off-edge'),
      });
      const out = {};
      for (const name of ['light', 'dark']) {
        document.documentElement.setAttribute('data-theme', name);
        out[name] = theme();
      }
      return out;
    });
    const graphics = [];
    for (const [theme, t] of Object.entries(tokens)) {
      for (const [what, colour] of [
        ['breakpoint dot fill', t.on],
        ['breakpoint dot edge', t.onEdge],
        ['instruction dot fill', t.off],
        ['instruction dot edge', t.offEdge],
      ]) {
        for (const [where, background] of [
          ['row', t.surface],
          ['selected row', t.selection],
        ]) {
          if (!parseColor(colour) || !parseColor(background)) continue;
          const ratio = contrastRatio(colour, background);
          graphics.push({
            palette: `listing, ${theme}, ${where}`,
            element: what,
            colour,
            background,
            ratio,
            passes: ratio >= AA.graphics,
            threshold: AA.graphics,
          });
        }
      }
    }
    console.log('        listing gutter (interface graphics, 3:1; a dot passes when its fill or its edge does):');
    for (const row of graphics) console.log(`          ${show(row)}`);
    const dotFails = [];
    for (const [theme] of Object.entries(tokens)) {
      for (const dot of ['breakpoint', 'instruction']) {
        for (const where of ['row', 'selected row']) {
          const rows = graphics.filter(
            (row) => row.palette === `listing, ${theme}, ${where}` && row.element.startsWith(dot),
          );
          if (rows.length && !rows.some((row) => row.passes)) dotFails.push(`${dot} dot, ${theme}, ${where}`);
        }
      }
    }
    report.check(
      `${p} each gutter dot reaches 3:1 by its fill or its edge, in both themes`,
      dotFails.length === 0,
      dotFails.join(', '),
    );
    const hardware = [
      ['segment or LED on', '#FF0000', 'display #000000'],
      ['segment or LED off', '#400000', 'display #000000'],
      ['LED on', '#FF0000', 'LED panel #808080'],
      ['LED off', '#400000', 'LED panel #808080'],
      ['on against off', '#FF0000', '#400000'],
    ].map(([what, colour, background]) => {
      const bg = /#[0-9A-F]{6}/i.exec(background)[0];
      const ratio = contrastRatio(colour, bg);
      return {
        palette: 'Hardware (2.6, original)',
        element: what,
        colour,
        background: bg,
        ratio,
        passes: ratio >= AA.graphics,
        threshold: AA.graphics,
      };
    });
    console.log('        Hardware panel (2.6: #FF0000 on, #400000 off, black and grey panels in both themes):');
    for (const row of hardware) console.log(`          ${show(row)}`);
    report.note(
      `${p} Hardware panel colours of the original below 3:1 (fidelity; docs/differences/Q1.md): ${hardware
        .filter((row) => !row.passes)
        .map((row) => `${row.element} ${row.colour} on ${row.background} ${formatRatio(row.ratio)}`)
        .join(', ')}`,
    );
    // 4. The listing's text (axe cannot decide it: the gutter strip is a gradient behind the rows).
    if (enginesPresent && (await assembleAndExecute(page, PROGRAM))) {
      const listing = [];
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => window.__easy68k.ctx.commands.run('app.theme.set', value), theme);
        await waitFor(page, (value) => document.documentElement.getAttribute('data-theme') === value, theme, 5000);
        await page.waitForTimeout(200);
        const drawn = await page.evaluate(() => {
          const surface = getComputedStyle(document.documentElement).getPropertyValue('--c-surface').trim();
          return [...document.querySelectorAll('[data-e68-panel="listing"] [role=option]')].slice(0, 12).map((row) => {
            const text = row.querySelector('.e68-listing__text');
            const bg = getComputedStyle(row).backgroundColor;
            return {
              selected: row.getAttribute('aria-selected') === 'true',
              colour: getComputedStyle(text).color,
              background: /rgba\(0, 0, 0, 0\)|transparent/.test(bg) ? surface : bg,
            };
          });
        });
        for (const where of [false, true]) {
          const row = drawn.find((item) => item.selected === where);
          if (!row) continue;
          const fg = parseColor(row.colour);
          const bg = parseColor(row.background);
          const ratio = contrastRatio(fg, { ...bg, a: 1 });
          listing.push({
            palette: `listing text, ${theme}`,
            element: where ? 'selected' : 'row',
            colour: toHex(fg),
            background: toHex(bg),
            ratio,
            passes: ratio >= AA.text,
            threshold: AA.text,
          });
        }
      }
      console.log('        listing text as drawn:');
      for (const row of listing) console.log(`          ${show(row)}`);
      report.check(
        `${p} the listing's text meets 4.5:1 on a row and on the selected row, in both themes`,
        listing.length === 4 && listing.every((row) => row.passes),
        listing.map((row) => `${row.palette} ${row.element} ${formatRatio(row.ratio)}`).join(', '),
      );
    }
    report.check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await context.close();
  }
}
