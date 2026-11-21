// The pixel scenarios under Node (SH3 acceptance: "the same text gives the same pixels under Node,
// Chromium and WebKit"). The hashes are fixed in pixel-scenario.ts; check-text.mjs runs the same
// scenarios in the two browsers and compares.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assembleProgram, createTestEngine, runProgram } from '../../../engine/testing';
import {
  EXPECTED_HASHES,
  firstDifference,
  PIXEL_PROGRAM,
  runDirectScenario,
  runEngineScenario,
} from './pixel-scenario';
import { hashPixels } from './testing';

const dist = (file: string) => fileURLToPath(new URL(`../../../../../engine/dist/${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(dist(file)),
);
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

describe('the direct scenario', () => {
  it('gives the fixed pixels', () => {
    const result = runDirectScenario();
    expect({ screen: result.screenHash, back: result.backHash }).toEqual(EXPECTED_HASHES.direct);
    expect([result.width, result.height]).toEqual([640, 480]);
  }, 60_000);

  it('gives the same pixels every time', () => {
    const first = runDirectScenario();
    const second = runDirectScenario();
    expect(firstDifference(first.screen, second.screen, first.width)).toBeNull();
  }, 60_000);

  it('draws what it says: text, a prompt cell over the picture, a scrolled screen', () => {
    const result = runDirectScenario();
    expect(result.rows[0]).toBe('Text screen: the same pixels under Node, Chromium and WebKit');
    expect(result.rows.some((row) => row.includes('BS erases nothing'))).toBe(true);
    expect(result.rows[30]).toBe(' the last row'); // moved up by the scroll, then right by the rectangle scroll
    expect(result.rows[31]).toContain('... and the row after the scroll');
    expect(result.state).toMatchObject({ row: 29, col: 49, textCols: 80, textRows: 32 });
    // the prompt cell is on the screen but not in the back buffer
    expect(result.screenHash).not.toBe(result.backHash);
    // a good part of the screen has ink
    const black = result.screen.reduce((count, pixel) => count + (pixel === 0xff000000 ? 1 : 0), 0);
    expect(black).toBeLessThan(640 * 480 * 0.95);
    expect(black).toBeGreaterThan(640 * 480 * 0.5);
  }, 60_000);
});

describe('hashPixels', () => {
  it('is FNV-1a over the four bytes of every pixel, low byte first', () => {
    expect(hashPixels(new Uint32Array(0))).toBe('811c9dc5'); // the offset basis
    // one pixel with the bytes 61 00 00 00: the hash of "a" (e40c292c) taken on over three zero bytes
    let expected = 0xe40c292c;
    for (let i = 0; i < 3; i++) expected = Math.imul(expected, 0x01000193) >>> 0;
    expect(hashPixels(Uint32Array.of(0x61))).toBe(expected.toString(16).padStart(8, '0'));
    expect(hashPixels(Uint32Array.of(1, 2))).not.toBe(hashPixels(Uint32Array.of(2, 1)));
  });
});

it.runIf(enginesRequired && !enginesBuilt)('engine/dist holds both engines (EASY68K_REQUIRE_ENGINES=1)', () => {
  expect.fail(
    'EASY68K_REQUIRE_ENGINES is 1 but engine/dist does not hold both engines: ' +
      'run `npm run build:engines` first. Without the variable the engine tests are skipped.',
  );
});

describe.skipIf(!enginesBuilt)('the engine scenario (needs engine/dist)', () => {
  it('the 68000 program gives the fixed pixels', async () => {
    const program = await assembleProgram(PIXEL_PROGRAM);
    const result = await runEngineScenario({ createTestEngine, runProgram }, program.s68);
    expect({ screen: result.screenHash, back: result.backHash }).toEqual(EXPECTED_HASHES.engine);
    expect(result.rows[0]).toBe('A 68000 program on the real engine: the same pixels everywhere');
    // the typed line is echoed on the screen but is not in the shadow array (trap15-a §3.7)
    expect(result.rows.join('\n')).not.toContain('EASy68k');
    expect(result.rows.some((row) => row.includes('-12345 DEADBEEF      42 input:'))).toBe(true);
  }, 60_000);
});
