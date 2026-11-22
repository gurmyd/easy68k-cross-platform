// Task 92 with every value 0-255, held to Windows' own GDI (errata SH1.md, "Drawing modes above 15").
//
// SIM68K.exe stores the low byte of D1 as the pen mode, and the VCL passes PenModes[mode] to
// SetROP2: a word of its 16-entry table, or for 18-255 a word of whatever data follows the table in
// the executable (trap15-b 5.4). T2's capture program measured on Windows 11 what GDI does with
// those words, and with raw values 0-32 and a few large ones (tests/conformance/gdi/golden/
// modes.json, "modesAbove15"; tests/oracle/gdi-capture/capture.cpp): SetROP2 never refuses a value,
// it keeps the low byte (GetROP2 reads it back) and draws operation ((byte - 1) AND 15) + 1. Wine's
// SetROP2 refuses everything outside 1-16 instead, which is why trap15-b/b06-modes-above-15 differs
// from its golden (made under Wine).
//
// Owner: SH1.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MODE_TABLE } from './rop';
import { Surface } from './surface';

const MODES = new URL('../../../../../tests/conformance/gdi/golden/modes.json', import.meta.url);

interface Drawn {
  pixel: number;
  line: number;
  end: number;
}
interface Measured {
  returned: number;
  error: number;
  after: number;
  as: number;
  onBlack: Drawn;
  onColour: Drawn;
}
interface ModesFile {
  modesAbove15: {
    setRop2: (Measured & { value: number })[];
    task92: (Measured & { mode: number; word: number })[];
  };
}

const spots = JSON.parse(readFileSync(MODES, 'utf8')) as ModesFile;

/** The 256 words at $005270B4 in SIM68K.exe v5.16.1 (PenModes and what follows it; capture.cpp). */
const PEN_MODE_WORDS: readonly number[] = [
  1, 16, 11, 6, 13, 4, 14, 5, 12, 3, 15, 2, 9, 8, 7, 10, 0, 0, 0, 0, 0, 0, 772, 37008, 772, 37008, 0, 0, 128, 0, 32768,
  0, 32896, 0, 0, 128, 128, 128, 32768, 128, 32896, 128, 49344, 192, 255, 0, 65280, 0, 65535, 0, 0, 255, 255, 255,
  65280, 255, 65535, 255, 0, 0, 0, 0, 0, 0, 37556, 72, 36865, 37008, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 21, 0, 2, 0, 3, 0,
  20, 0, 512, 0, 2, 0, 16, 0, 4, 0, 128, 0, 256, 0, 1, 0, 32, 0, 8, 0, 64, 0, 0, 0, 1, 0, 2, 0, 0, 0, 0, 128, 1, 0, 6,
  0, 3, 0, 4, 0, 7, 0, 3, 0, 1, 0, 7, 0, 3, 0, 0, 0, 2, 0, 0, 0, 1, 0, 32646, 0, 32761, 0, 32651, 0, 32650, 0, 32648, 0,
  32762, 0, 32763, 0, 32764, 0, 32765, 0, 32767, 0, 32766, 0, 32514, 0, 32516, 0, 32644, 0, 32642, 0, 32645, 0, 32643,
  0, 32640, 0, 32513, 0, 32515, 0, 32512, 0, 2, 0, 0, 0, 1, 0, 0, 0, 17310, 81, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 53592, 71, 36864, 37008, 151, 87, 0, 0, 0, 128, 0, 0, 2, 0, 1, 0, 36864, 37008, 0, 0, 0, 37008, 1, 0, 2, 0, 4, 0,
  8, 0, 16, 0, 256, 0, 512, 0, 1024, 0, 2048, 0, 4096, 0, 8192, 0, 16384, 0, 32768, 0,
];

/** GDI's ROP2 code of each VCL mode 0-15 (the first 16 words). */
const ROP2_OF_MODE = PEN_MODE_WORDS.slice(0, 16);

/** The operation (R2_BLACK = 1 ... R2_WHITE = 16) Windows' GDI draws for a SetROP2 value. */
function gdiOperation(value: number): number {
  return (((value & 0xff) - 1) & 15) + 1;
}

const RED = 0x0000ff; // $00BBGGRR
const BACKGROUND = 0x336699;

/** What SIM68K.exe does in the capture: task 92 with 4, task 92 with `mode`, task 82, task 85. */
function drawWithMode(mode: number, background: number): Drawn {
  const surface = new Surface(8, 3);
  surface.setDrawingMode(4);
  surface.setLineColor(background);
  surface.setFillColor(background);
  surface.rectangle(0, 0, 7, 2);
  surface.setLineColor(RED);
  surface.setDrawingMode(mode);
  surface.drawPixel(1, 1);
  surface.moveTo(3, 1);
  surface.lineTo(6, 1);
  return { pixel: surface.getPixel(1, 1), line: surface.getPixel(4, 1), end: surface.getPixel(6, 1) };
}

describe('drawing modes 0-255 against Windows GDI (modes.json)', () => {
  it('the capture measured what the comments say: SetROP2 keeps the low byte and refuses nothing', () => {
    const rows = spots.modesAbove15.setRop2;
    expect(rows.length).toBeGreaterThanOrEqual(33);
    for (const row of rows) {
      expect(row.returned, `SetROP2(${row.value}) returns the previous ROP2, R2_COPYPEN`).toBe(13);
      expect(row.error).toBe(0);
      expect(row.after, `GetROP2 after SetROP2(${row.value})`).toBe(row.value & 0xff);
      expect(row.as, `SetROP2(${row.value}) draws`).toBe(gdiOperation(row.value));
    }
  });

  it('the capture used the words SIM68K.exe passes, and GDI drew them as the rule says', () => {
    for (const row of spots.modesAbove15.task92) {
      expect(row.word, `PenModes word of mode ${row.mode}`).toBe(PEN_MODE_WORDS[row.mode]);
      expect(row.as, `mode ${row.mode}`).toBe(gdiOperation(row.word));
    }
  });

  it('the surface draws every measured mode exactly as Windows did (pixel, line, end point)', () => {
    const rows = spots.modesAbove15.task92;
    expect(rows.map((row) => row.mode)).toEqual(expect.arrayContaining([18, 19, 20, 21, 22, 23]));
    for (const row of rows) {
      expect(drawWithMode(row.mode, 0x000000), `mode ${row.mode} on black`).toEqual(row.onBlack);
      expect(drawWithMode(row.mode, BACKGROUND), `mode ${row.mode} on $336699`).toEqual(row.onColour);
    }
  });

  it('every value 0-255 except 16 and 17 draws the operation GDI gives its PenModes word', () => {
    for (let value = 0; value < 256; value++) {
      if (value === 16 || value === 17) continue;
      const operation = gdiOperation(PEN_MODE_WORDS[value] as number);
      expect(ROP2_OF_MODE[MODE_TABLE[value] as number], `mode ${value}`).toBe(operation);
    }
  });

  it('b06: modes 20, 22, 18, 19, 21 and 23 draw red on black as white, inverted, white, white, white, white', () => {
    const drawn = [20, 22, 18, 19, 21, 23].map((mode) => drawWithMode(mode, 0x000000).pixel);
    expect(drawn).toEqual([0xffffff, 0xffff00, 0xffffff, 0xffffff, 0xffffff, 0xffffff]);
  });
});
