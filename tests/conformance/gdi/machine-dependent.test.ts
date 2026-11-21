// What `npm run oracle:gdi` leaves out of the comparison because it depends on the Windows at hand
// (tests/oracle/gdi-capture/machine-dependent.ts), checked against a real capture of another Windows:
// golden/windows-10.0.26100/ holds files of the gdi-capture-run artifact of CI run 44919519853
// (GitHub's Windows Server runner, build 10.0.26100; the references come from 10.0.26300). Runs on
// every system. Owner: T2.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { describeAtlas } from '../../oracle/gdi-capture/describe-difference';
import {
  canonicalAtlas,
  canonicalMetrics,
  canonicalSpots,
  OTHER_FONT_BYTES,
} from '../../oracle/gdi-capture/machine-dependent';
import { judge, type Records } from '../../oracle/gdi-capture/windows-policy';
import { FALLBACK_BYTES } from './cases';
import { FONTS_DIR } from './fonts';
import { GOLDEN_DIR } from './golden';
import { decodeAtlas } from './pix';

const RUNNER_DIR = `${GOLDEN_DIR}windows-10.0.26100/`;
const RUNNER = '10.0.26100 cp1252 96dpi';
const REF = '10.0.26300 cp1252 96dpi';
const ATLASES = [
  'Courier-16.bin',
  'Courier-16-i.bin',
  'Courier-16-u.bin',
  'Fixedsys-15.bin',
  'Fixedsys-15-i.bin',
  'Fixedsys-15-s.bin',
];

const runnerBytes = (file: string) => new Uint8Array(readFileSync(RUNNER_DIR + file));
const referenceBytes = (file: string) => new Uint8Array(readFileSync(`${FONTS_DIR}bitmap/${file}`));

/** A copy of an atlas file with the first row of byte `ch`'s glyph inverted in its first column. */
function flipPixel(bytes: Uint8Array, ch: number, row: number): Uint8Array {
  const atlas = decodeAtlas(bytes);
  const glyphBytes = Math.ceil(atlas.glyphWidth / 8) * atlas.cellHeight;
  const copy = bytes.slice();
  const at = 9 + 256 + ch * glyphBytes + row * Math.ceil(atlas.glyphWidth / 8);
  copy[at] = (copy[at] as number) ^ 0x80;
  return copy;
}

describe('the other-font bytes are what differs on another Windows, and nothing else is left out', () => {
  it('are $00 and the fallback-font bytes of cases.ts, as in capture.cpp', () => {
    expect([...OTHER_FONT_BYTES]).toEqual([0, ...FALLBACK_BYTES]);
    const cpp = readFileSync(new URL('../../oracle/gdi-capture/capture.cpp', import.meta.url), 'utf8');
    expect(cpp).toContain('static bool otherFontByte(int c) { return c <= 8 || c == 11 || (c >= 14 && c <= 27); }');
    const fromCpp = Array.from({ length: 256 }, (_, c) => c).filter((c) => c <= 8 || c === 11 || (c >= 14 && c <= 27));
    expect(fromCpp).toEqual([...OTHER_FONT_BYTES]);
  });

  it.each(ATLASES)('%s of Windows Server 10.0.26100 equals the reference except in the other-font bytes', (file) => {
    const runner = decodeAtlas(runnerBytes(file));
    const reference = decodeAtlas(referenceBytes(file));
    expect(canonicalAtlas(runner, true)).toBe(canonicalAtlas(reference, true));
    const description = describeAtlas(reference, runner, OTHER_FONT_BYTES);
    expect(description[0]).toBe('every glyph and advance of the face itself is equal');
  });

  it("the strict form still sees the runner's other-font glyphs (so --all and the log show them)", () => {
    const differing = ATLASES.filter(
      (file) =>
        canonicalAtlas(decodeAtlas(runnerBytes(file)), false) !==
        canonicalAtlas(decodeAtlas(referenceBytes(file)), false),
    );
    // Courier 9x16 differs in every style; Fixedsys 8x15 too. (Courier 8x13 plain did not.)
    expect(differing).toEqual(ATLASES);
  });

  it('a changed pixel or advance of a byte the face draws is a difference; an other-font pixel is not', () => {
    const file = 'Courier-16.bin';
    const reference = canonicalAtlas(decodeAtlas(referenceBytes(file)), true);
    const runner = runnerBytes(file);
    expect(canonicalAtlas(decodeAtlas(flipPixel(runner, 0x41, 3)), true)).not.toBe(reference);
    expect(canonicalAtlas(decodeAtlas(flipPixel(runner, 0x01, 3)), true)).toBe(reference);
    const advance = runner.slice();
    advance[9 + 0x05] = (advance[9 + 0x05] as number) + 1; // the advance of $05, an other-font byte
    expect(canonicalAtlas(decodeAtlas(advance), true)).not.toBe(reference);
  });

  it("the italic rule explains every byte the face draws in the runner's italic atlases", () => {
    // capture.cpp decides ruleHolds without the other-font bytes; with them, CI run 44919519853
    // reported "ruleHolds": false for Courier italic 9x16 (and 12x20, 15x25, Fixedsys italic 8x15).
    for (const [plainFile, italicFile] of [
      ['Courier-16.bin', 'Courier-16-i.bin'],
      ['Fixedsys-15.bin', 'Fixedsys-15-i.bin'],
    ] as const) {
      const native = decodeAtlas(runnerBytes(plainFile));
      const italic = decodeAtlas(runnerBytes(italicFile));
      const at = (a: typeof native, ch: number, x: number, y: number) =>
        x < 0 || y < 0 || x >= a.glyphWidth || y >= a.cellHeight ? 0 : a.glyph(ch)[y * a.glyphWidth + x] ? 1 : 0;
      const h = italic.cellHeight;
      const width = Math.max(native.glyphWidth, italic.glyphWidth) + h;
      const failing: number[] = [];
      for (let ch = 0; ch < 256; ch++) {
        let same = italic.advances[ch] === native.advances[ch];
        for (let y = 0; y < h && same; y++)
          for (let x = 0; x < width && same; x++)
            if (at(native, ch, x - (((h - 1) >> 1) - (y >> 1)), y) !== at(italic, ch, x, y)) same = false;
        if (!same) failing.push(ch);
      }
      expect(failing.length, italicFile).toBeGreaterThan(0); // the other-font boxes are not sheared
      expect(
        failing.filter((ch) => !OTHER_FONT_BYTES.includes(ch)),
        italicFile,
      ).toEqual([]);
    }
  });

  it("the runner's spots.json equals the reference apart from the theme and the other-font cells", () => {
    const runner = readFileSync(`${RUNNER_DIR}spots.json`, 'utf8');
    const reference = readFileSync(`${GOLDEN_DIR}spots.json`, 'utf8');
    expect(canonicalSpots(runner, false)).toBe(canonicalSpots(reference, false));
    expect(canonicalSpots(runner, false, false)).not.toBe(canonicalSpots(reference, false, false));
    const changed = JSON.parse(runner) as { controlBytes: { byte: number; cellRight: number; pen: number }[] };
    const entry = (b: number) => changed.controlBytes.find((e) => e.byte === b);
    entry(0x01)!.pen += 1;
    expect(canonicalSpots(JSON.stringify(changed), false)).not.toBe(canonicalSpots(reference, false));
    entry(0x01)!.pen -= 1;
    entry(0x0c)!.cellRight += 1; // $0C is drawn from the face (8 pixels of cell)
    expect(canonicalSpots(JSON.stringify(changed), false)).not.toBe(canonicalSpots(reference, false));
  });

  it("the runner's metrics.json equals the reference once ruleHolds is decided without the other-font bytes", () => {
    const runnerText = gunzipSync(readFileSync(`${RUNNER_DIR}metrics.json.gz`)).toString('utf8');
    const reference = canonicalMetrics(readFileSync(`${FONTS_DIR}metrics.json`, 'utf8'), true);
    // As captured by the old program: four cells marked "ruleHolds": false, a real difference.
    expect(canonicalMetrics(runnerText, true)).not.toBe(reference);
    const runner = JSON.parse(runnerText) as {
      fonts: Record<string, Record<string, number[][]>>;
      raster: { cells: { ruleHolds?: boolean }[] };
    };
    expect(runner.raster.cells.filter((c) => c.ruleHolds === false)).toHaveLength(4);
    // What the current capture.cpp writes there (the italic test above shows the rule holds).
    for (const cell of runner.raster.cells) delete cell.ruleHolds;
    expect(canonicalMetrics(JSON.stringify(runner), true)).toBe(reference);
    expect(canonicalMetrics(JSON.stringify(runner), false)).not.toBe(
      canonicalMetrics(readFileSync(`${FONTS_DIR}metrics.json`, 'utf8'), false),
    );
    // The metric table is compared in full.
    (runner.fonts['Courier'] as Record<string, number[][]>)['plain']![10]![0]! += 1;
    expect(canonicalMetrics(JSON.stringify(runner), true)).not.toBe(reference);
  });

  it('the committed record of 10.0.26100 accepts no difference', () => {
    const records = JSON.parse(
      readFileSync(new URL('../../oracle/gdi-capture/other-windows.json', import.meta.url), 'utf8'),
    ) as Records;
    const pass = judge({ machine: RUNNER, reference: REF, differences: [], records });
    expect(pass.fail).toBe(false);
    expect(pass.lines.join('\n')).toContain('reviewed by T2');
    const fail = judge({
      machine: RUNNER,
      reference: REF,
      differences: [{ path: 'app/public/fonts/bitmap/Courier-16.bin', fingerprint: '0123456789abcdef' }],
      records,
    });
    expect(fail.fail).toBe(true);
    expect(fail.lines.join('\n')).toContain('NEW       app/public/fonts/bitmap/Courier-16.bin');
  });
});
