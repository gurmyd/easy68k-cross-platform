// "The same text gives the same pixels under Node, Chromium and WebKit" (SH3 acceptance,
// ARCHITECTURE.md 9.2; 3.5.1: text pixels come from data files only).
//
// Two scenarios draw a screen full of text and return its pixels and their hash:
// - `runDirectScenario` calls the text screen directly;
// - `runEngineScenario` runs the 68000 program `PIXEL_PROGRAM` on the real simulator engine, whose
//   text and graphics host parts are the real OutputDevice.
//
// Each draws on the parts it is given. By default those are the synthetic fonts on the test
// surface: pixel-scenario.test.ts runs both that way under Node and compares the hashes with
// `EXPECTED_HASHES`, and check-text.mjs runs both in Chromium and WebKit and compares them with the
// Node run. check-text.mjs also runs both on `realParts`: the real drawing surface with the fonts
// of app/public/fonts, loaded as the application loads them.
//
// The engine helpers are passed in (core/ may not import engine/, 3.1). Never imported by the
// application.
//
// Owner: SH3.

import type { Bytes, GlyphProvider, SimEngine, SimHostParts, SurfaceApi } from '../../../contracts';
import { OutputDevice } from '../io';
import { Surface } from '../surface/surface';
import { bytesOf, createTextRig, hashPixels, ManualScheduler, rowText } from './testing';
import { TextScreen } from './text-screen';

export { hashPixels } from './testing';

/** The hashes both scenarios must give in every environment. A change of the text screen, the glyph
 *  provider or the synthetic fonts that changes pixels changes these; that is then deliberate. */
export const EXPECTED_HASHES = {
  direct: { screen: '35872d6e', back: '52d69d47' },
  engine: { screen: '8703d622', back: '8703d622' },
} as const;

export interface ScenarioResult {
  width: number;
  height: number;
  /** What the user sees: the back buffer with the prompt cell over it. One pixel per element, as in `PixelBuffer`. */
  screen: Uint32Array;
  /** Hash of `screen`. */
  screenHash: string;
  /** Hash of the back buffer alone. */
  backHash: string;
  /** The visible rows of the shadow array, right-trimmed. */
  rows: string[];
  /** Cursor and grid at the end. */
  state: { row: number; col: number; textCols: number; textRows: number; colWidth: number; rowHeight: number };
}

/** What a scenario draws on: a text screen and its output device over a surface, and the scheduler of the prompt. */
export interface ScenarioParts {
  surface: SurfaceApi;
  scheduler: ManualScheduler;
  text: TextScreen;
  /** The `text` and `graphics` host parts over `text` and `surface`. */
  device: OutputDevice;
}

/** The parts as the application composes them: the real drawing surface, 640 x 480, and the given fonts. */
export function realParts(glyphs: GlyphProvider): ScenarioParts {
  const surface = new Surface(640, 480);
  const scheduler = new ManualScheduler();
  const text = new TextScreen({
    surface,
    glyphs,
    scheduler,
    outputLog: () => {},
    beep: () => {},
    show: () => {},
  });
  const device = new OutputDevice({
    surface,
    text,
    show: () => {},
    bringToFront: () => {},
    setFullScreen: () => {},
  });
  return { surface, scheduler, text, device };
}

function resultOf(rig: ScenarioParts): ScenarioResult {
  const { back, overlay } = rig.surface;
  const screen = back.data.slice();
  if (overlay) {
    for (let y = 0; y < overlay.height; y++) {
      for (let x = 0; x < overlay.width; x++) {
        const [sx, sy] = [overlay.x + x, overlay.y + y];
        if (sx >= 0 && sx < back.width && sy >= 0 && sy < back.height) {
          screen[sy * back.width + sx] = overlay.pixels[y * overlay.width + x] as number;
        }
      }
    }
  }
  const { row, col, textCols, textRows, colWidth, rowHeight } = rig.text.state;
  return {
    width: back.width,
    height: back.height,
    screen,
    screenHash: hashPixels(screen),
    backHash: hashPixels(back.data),
    rows: Array.from({ length: textRows }, (_, r) => rowText(rig.text, r).trimEnd()),
    state: { row, col, textCols, textRows, colWidth, rowHeight },
  };
}

// Colours, $00BBGGRR.
const WHITE = 0xffffff;
const YELLOW = 0x00ffff;
const GREEN = 0x00c000;
const NAVY = 0x800000;
const BLACK = 0x000000;

/** A screen of text drawn by calling the text screen directly. */
export function runDirectScenario(rig: ScenarioParts = createTextRig()): ScenarioResult {
  const { text, surface, scheduler } = rig;
  const say = (line: string) => text.textOut(bytesOf(line));

  // Row 1: the scroll at the end moves everything up one row.
  text.gotorc(1, 0);
  say('Text screen: the same pixels under Node, Chromium and WebKit');
  text.doCRLF();

  // The seven font names of task 21 at 12 points, as graphics text (task 95) at pixel positions.
  let y = 36;
  for (let number = 1; number <= 7; number++) {
    text.setFontProperties(YELLOW, ((number << 8) | 12) << 16);
    text.drawText(bytesOf(`${number} ${text.state.font.name}: The quick brown fox 0123456789`), 4, y);
    y += text.state.rowHeight + 2;
  }
  // The five styles, a size no atlas has (resampled), a raster size that is a whole multiple.
  ['plain', 'bold', 'italic', 'underline', 'strike-out'].forEach((name, index) => {
    text.setFontProperties(WHITE, 0x030e0000 | (index === 0 ? 0 : 1 << (index - 1)));
    text.drawText(bytesOf(name), 4 + index * 124, y);
  });
  y += text.state.rowHeight + 2;
  text.setFontProperties(GREEN, 0x03140000);
  text.drawText(bytesOf('Courier New 20: resampled'), 4, y);
  y += text.state.rowHeight + 2;
  text.setFontProperties(GREEN, 0x01280000);
  text.drawText(bytesOf('Fixedsys x3'), 4, y);
  y += text.state.rowHeight + 2;

  // The styles of a raster font as Windows simulates them, on a fill colour: the boxes of the bold
  // and the italic text reach beyond their last letter.
  surface.setFillColor(NAVY);
  ['bold', 'italic', 'underline', 'strike-out'].forEach((name, index) => {
    text.setFontProperties(WHITE, 0x01090000 | (1 << index));
    text.drawText(bytesOf(`Fixedsys ${name}`), 4 + index * 160, y);
  });
  surface.setFillColor(BLACK);
  y += text.state.rowHeight + 2;

  // Back to the Options font: cells in a fill colour, control characters, bytes above $7F.
  text.setFontProperties(WHITE, 0);
  surface.setFillColor(NAVY);
  text.gotorc(Math.ceil(y / text.state.rowHeight), 0);
  say('cells have the fill colour\tafter a tab\b\b\bBS erases nothing');
  text.doCRLF();
  text.textOut(Uint8Array.from({ length: 64 }, (_, i) => 0xc0 + i));
  text.doCRLF();
  surface.setFillColor(BLACK);

  // Text wrap, a rectangle scroll, graphics that scroll with the text.
  text.setTextWrap(true);
  say('wrap on: ' + 'abcdefghijklmnopqrstuvwxyz '.repeat(4));
  text.doCRLF();
  text.setTextWrap(false);
  surface.setLineColor(YELLOW);
  surface.line(0, 470, 639, 440);
  text.gotorc(31, 0);
  say('the last row');
  text.charOut(0x0a); // LF on the last row: everything moves up one row
  say(' ... and the row after the scroll');
  text.scrollRect(27, 0, 4, 20, 3);

  // An input prompt: the underscore, over the picture.
  surface.setFillColor(NAVY);
  text.gotorc(29, 40);
  say('input: ');
  text.inputPrompt(2);
  text.inputEcho(0x34, true);
  text.inputEcho(0x32, true);
  scheduler.advance(1000);
  return resultOf(rig);
}

/** The 68000 program of the engine scenario: text tasks 0-25, graphics text and a scroll. */
export const PIXEL_PROGRAM: readonly string[] = [
  '        ORG     $1000',
  '* row 1: the scroll at the end moves everything up one row',
  'START:  MOVE.W  #$0001,D1',
  '        MOVEQ   #11,D0',
  '        TRAP    #15',
  '        LEA     TITLE,A1',
  '        MOVEQ   #13,D0',
  '        TRAP    #15',
  '* every font of task 21 at 12 points: its number in D3',
  '        MOVEQ   #1,D3',
  'FONTS:  MOVE.L  D3,D2',
  '        LSL.L   #8,D2',
  '        OR.B    #12,D2',
  '        SWAP    D2',
  '        MOVE.L  #$0000FFFF,D1',
  '        MOVEQ   #21,D0',
  '        TRAP    #15',
  '* ... shown as graphics text (task 95) at x = 4, y = 22 * number + 14',
  '        LEA     SAMPLE,A1',
  '        MOVEQ   #4,D1',
  '        MOVE.L  D3,D2',
  '        MULU    #22,D2',
  '        ADD.W   #14,D2',
  '        MOVEQ   #95,D0',
  '        TRAP    #15',
  '        ADDQ.L  #1,D3',
  '        CMP.L   #8,D3',
  '        BNE     FONTS',
  '* bold red Courier New 18, then back to the Options font',
  '        MOVE.L  #$000000FF,D1',
  '        MOVE.L  #$03120001,D2',
  '        MOVEQ   #21,D0',
  '        TRAP    #15',
  '        MOVE.W  #$0007,D1',
  '        MOVEQ   #11,D0',
  '        TRAP    #15',
  '        LEA     BOLD,A1',
  '        MOVEQ   #13,D0',
  '        TRAP    #15',
  '        MOVE.L  #$00FFFFFF,D1',
  '        MOVEQ   #0,D2',
  '        MOVEQ   #21,D0',
  '        TRAP    #15',
  '* numbers: tasks 3, 15, 20',
  '        MOVE.L  #$00800000,D1',
  '        MOVEQ   #81,D0',
  '        TRAP    #15',
  '        MOVE.W  #$0014,D1',
  '        MOVEQ   #11,D0',
  '        TRAP    #15',
  '        MOVE.L  #-12345,D1',
  '        MOVEQ   #3,D0',
  '        TRAP    #15',
  '        MOVEQ   #32,D1',
  '        MOVEQ   #6,D0',
  '        TRAP    #15',
  '        MOVE.L  #$DEADBEEF,D1',
  '        MOVEQ   #16,D2',
  '        MOVEQ   #15,D0',
  '        TRAP    #15',
  '        MOVEQ   #42,D1',
  '        MOVEQ   #8,D2',
  '        MOVEQ   #20,D0',
  '        TRAP    #15',
  '* a line of keyboard input, echoed',
  '        LEA     ASK,A1',
  '        MOVEQ   #14,D0',
  '        TRAP    #15',
  '        LEA     BUFFER,A1',
  '        MOVEQ   #2,D0',
  '        TRAP    #15',
  '* graphics text with control bytes, a line, and a scroll on the last row',
  '        MOVE.L  #$00000000,D1',
  '        MOVEQ   #81,D0',
  '        TRAP    #15',
  '        LEA     DRAWN,A1',
  '        MOVE.W  #300,D1',
  '        MOVE.W  #330,D2',
  '        MOVEQ   #95,D0',
  '        TRAP    #15',
  '        MOVEQ   #0,D1',
  '        MOVE.W  #460,D2',
  '        MOVE.W  #639,D3',
  '        MOVE.W  #430,D4',
  '        MOVEQ   #84,D0',
  '        TRAP    #15',
  '        MOVE.W  #$001F,D1',
  '        MOVEQ   #11,D0',
  '        TRAP    #15',
  '        LEA     LAST,A1',
  '        MOVEQ   #13,D0',
  '        TRAP    #15',
  '        MOVE.L  #$00190000,D1',
  '        MOVE.L  #$00050014,D2',
  '        MOVEQ   #3,D3',
  '        MOVEQ   #25,D0',
  '        TRAP    #15',
  '        SIMHALT',
  "TITLE   DC.B    'A 68000 program on the real engine: the same pixels everywhere',0",
  "SAMPLE  DC.B    'The quick brown fox jumps over 0123456789',0",
  "BOLD    DC.B    'bold, red, Courier New 18',0",
  "ASK     DC.B    ' input: ',0",
  "DRAWN   DC.B    'task 95',9,' with',13,10,' control bytes',0",
  "LAST    DC.B    'the last row scrolls',0",
  'BUFFER  DS.B    80',
  '        END     START',
];

/** The keys typed into the one keyboard wait of `PIXEL_PROGRAM`. */
export const PIXEL_PROGRAM_KEYS = ['EASy68K\b\b\b68k\r'];

/** The helpers of app/src/engine/testing.ts that the engine scenario needs. */
export interface EngineHelpers {
  createTestEngine(parts: Partial<SimHostParts>): Promise<{ engine: SimEngine; release(): void }>;
  runProgram(engine: SimEngine, script?: { keys?: string[] }): { reason: string; halted: boolean };
}

/** Runs `PIXEL_PROGRAM` (as assembled: `s68`) on the real engine with the real output device. */
export async function runEngineScenario(
  helpers: EngineHelpers,
  s68: Bytes,
  rig: ScenarioParts = createTextRig(),
): Promise<ScenarioResult> {
  const test = await helpers.createTestEngine({ text: rig.device, graphics: rig.device });
  try {
    test.engine.load(s68, null, { name: 'pixels.S68' });
    const report = helpers.runProgram(test.engine, { keys: [...PIXEL_PROGRAM_KEYS] });
    if (!report.halted) throw new Error(`The pixel program did not run to its end (${report.reason})`);
    return resultOf(rig);
  } finally {
    test.release();
  }
}

/** The colour of the first pixel that differs between two screens, for a failure message. */
export function firstDifference(a: Uint32Array, b: Uint32Array, width: number): string | null {
  if (a.length !== b.length) return `sizes differ: ${a.length} and ${b.length} pixels`;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      const hex = (pixel: number) => (pixel & 0xffffff).toString(16).padStart(6, '0');
      return `pixel (${i % width}, ${Math.floor(i / width)}): ${hex(a[i] as number)} and ${hex(b[i] as number)}`;
    }
  }
  return null;
}
