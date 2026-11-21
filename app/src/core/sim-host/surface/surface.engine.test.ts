// The Surface as the `graphics` part of the real simulator engine: a 68000 program draws with
// TRAP #15 tasks 80-96 and reads results back, and the surface ends up exactly as it does when the
// same calls are made directly. This is the path every student program takes: registers ->
// engine (sign extension, low bytes) -> host method -> Surface -> register.
//
// Needs engine/dist (both engines: the program is assembled first).

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { HostIoGraphics } from '../../../contracts';
import { assembleProgram, createTestEngine, runProgram, type RunReport } from '../../../engine/testing';
import { Surface } from './surface';
import { hashPixels } from './testing';

const dist = (file: string) => fileURLToPath(new URL(`../../../../../engine/dist/${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(dist(file)),
);
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

const RESULT = 0x5000;

/** One TRAP #15 call: registers first, then the task number. */
const task = (number: number, ...setup: string[]): string[] => [
  ...setup.map((line) => `        ${line}`),
  `        MOVEQ   #${number},D0`,
  '        TRAP    #15',
];

const PROGRAM: string[] = [
  '        ORG     $1000',
  'START:',
  '* pen red; a pixel given with rubbish in the high words; read it back; read outside the surface',
  ...task(80, 'MOVE.L  #$000000FF,D1'),
  ...task(82, 'MOVE.L  #$1234000A,D1', 'MOVE.L  #$FFFF000C,D2'),
  ...task(83),
  '        MOVE.L  D0,RESULT',
  ...task(83, 'MOVE.W  #-1,D1'),
  '        MOVE.L  D0,RESULT+4',
  '* the line of trap15-b 6.1; task 96 writes the low words only',
  ...task(80, 'MOVE.L  #$00FFFFFF,D1'),
  ...task(84, 'MOVEQ   #0,D1', 'MOVEQ   #0,D2', 'MOVEQ   #8,D3', 'MOVEQ   #4,D4'),
  ...task(96, 'MOVE.L  #$AAAAAAAA,D1', 'MOVE.L  #$BBBBBBBB,D2'),
  '        MOVE.L  D1,RESULT+8',
  '        MOVE.L  D2,RESULT+12',
  '* V5: mode 17, move to (5,5), line to (100,100), task 96 gives (5,5); after mode 16 it gives (100,100)',
  ...task(92, 'MOVEQ   #17,D1'),
  ...task(86, 'MOVEQ   #5,D1', 'MOVEQ   #5,D2'),
  ...task(85, 'MOVEQ   #100,D1', 'MOVEQ   #100,D2'),
  ...task(96),
  '        MOVE.W  D1,RESULT+16',
  '        MOVE.W  D2,RESULT+18',
  ...task(92, 'MOVE.L  #$FFFFFF10,D1'),
  ...task(96),
  '        MOVE.W  D1,RESULT+20',
  '        MOVE.W  D2,RESULT+22',
  '* fill green, pen width 3 and mode 14 by their low bytes, shapes with corners off the surface',
  ...task(81, 'MOVE.L  #$0000FF00,D1'),
  ...task(93, 'MOVE.L  #$00000103,D1'),
  ...task(92, 'MOVE.L  #$0000010E,D1'),
  ...task(87, 'MOVE.W  #-5,D1', 'MOVE.W  #-5,D2', 'MOVE.W  #40,D3', 'MOVE.W  #30,D4'),
  ...task(88, 'MOVE.W  #200,D1', 'MOVE.W  #100,D2', 'MOVE.W  #300,D3', 'MOVE.W  #180,D4'),
  ...task(90, 'MOVE.W  #330,D1', 'MOVE.W  #30,D2', 'MOVE.W  #310,D3', 'MOVE.W  #10,D4'),
  ...task(91, 'MOVE.W  #600,D1', 'MOVE.W  #440,D2', 'MOVE.W  #700,D3', 'MOVE.W  #520,D4'),
  ...task(84, 'MOVE.W  #-20,D1', 'MOVE.W  #470,D2', 'MOVE.W  #660,D3', 'MOVE.W  #-10,D4'),
  ...task(89, 'MOVE.W  #500,D1', 'MOVE.W  #300,D2'),
  ...task(83, 'MOVE.W  #500,D1', 'MOVE.W  #300,D2'),
  '        MOVE.L  D0,RESULT+24',
  ...task(89, 'MOVE.W  #-1,D1', 'MOVE.W  #-1,D2'),
  ...task(94),
  '        SIMHALT',
  `        ORG     $${RESULT.toString(16).toUpperCase()}`,
  'RESULT  DS.L    8',
  '        END     START',
];

/** The same calls, made directly. */
function drawDirectly(surface: Surface): void {
  surface.setLineColor(0x000000ff);
  surface.drawPixel(10, 12);
  surface.getPixel(10, 12);
  surface.getPixel(-1, 12);
  surface.setLineColor(0x00ffffff);
  surface.line(0, 0, 8, 4);
  surface.getXY();
  surface.setDrawingMode(17);
  surface.moveTo(5, 5);
  surface.lineTo(100, 100);
  surface.setDrawingMode(16);
  surface.setFillColor(0x0000ff00);
  surface.setPenWidth(3);
  surface.setDrawingMode(14);
  surface.rectangle(-5, -5, 40, 30);
  surface.ellipse(200, 100, 300, 180);
  surface.unfilledRectangle(330, 30, 310, 10);
  surface.unfilledEllipse(600, 440, 700, 520);
  surface.line(-20, 470, 660, -10);
  surface.floodFill(500, 300);
  surface.floodFill(-1, -1);
  surface.formPaint();
}

/** A surface as the `graphics` host part. Task 95 (drawText) belongs to the text screen (SH3). */
function asGraphics(surface: Surface): HostIoGraphics {
  return {
    setLineColor: (color) => surface.setLineColor(color),
    setFillColor: (color) => surface.setFillColor(color),
    drawPixel: (x, y) => surface.drawPixel(x, y),
    getPixel: (x, y) => surface.getPixel(x, y),
    line: (x1, y1, x2, y2) => surface.line(x1, y1, x2, y2),
    lineTo: (x, y) => surface.lineTo(x, y),
    moveTo: (x, y) => surface.moveTo(x, y),
    rectangle: (x1, y1, x2, y2) => surface.rectangle(x1, y1, x2, y2),
    ellipse: (x1, y1, x2, y2) => surface.ellipse(x1, y1, x2, y2),
    floodFill: (x, y) => surface.floodFill(x, y),
    unfilledRectangle: (x1, y1, x2, y2) => surface.unfilledRectangle(x1, y1, x2, y2),
    unfilledEllipse: (x1, y1, x2, y2) => surface.unfilledEllipse(x1, y1, x2, y2),
    setDrawingMode: (mode) => surface.setDrawingMode(mode),
    setPenWidth: (width) => surface.setPenWidth(width),
    formPaint: () => surface.formPaint(),
    drawText: () => {},
    getXY: () => surface.getXY(),
  };
}

it.runIf(enginesRequired && !enginesBuilt)('engine/dist holds both engines (EASY68K_REQUIRE_ENGINES=1)', () => {
  expect.fail(
    'EASY68K_REQUIRE_ENGINES is 1 but engine/dist lacks an engine: run `npm run build:engines` first. ' +
      'Without the variable the tests of the surface on the real engine are skipped.',
  );
});

describe.skipIf(!enginesBuilt)('the Surface as the graphics part of the real engine (needs engine/dist)', () => {
  let surface: Surface;
  let report: RunReport;
  let memory: Uint8Array;

  const long = (offset: number) => new DataView(memory.buffer, memory.byteOffset).getUint32(offset);
  const word = (offset: number) => new DataView(memory.buffer, memory.byteOffset).getInt16(offset);

  beforeAll(async () => {
    surface = new Surface(640, 480);
    const program = await assembleProgram(PROGRAM);
    const test = await createTestEngine({ graphics: asGraphics(surface) });
    test.engine.load(program.s68, program.l68, { name: 'surface.S68' });
    report = runProgram(test.engine);
    memory = test.engine.memory.slice(RESULT, RESULT + 32);
    test.release();
  }, 120_000);

  it('the program runs to its end', () => {
    expect(report).toMatchObject({ reason: 'stopped', halted: true });
  });

  it("the engine's reset leaves the surface in the start-up state before the program draws", async () => {
    // a second engine on a fresh surface: creating it and loading a program run initSim()
    const fresh = new Surface(640, 480);
    fresh.setDrawingMode(14);
    fresh.setDrawingMode(17);
    fresh.setPenWidth(9);
    fresh.setLineColor(0x123456);
    fresh.setFillColor(0x654321);
    const test = await createTestEngine({ graphics: asGraphics(fresh) });
    test.release();
    expect(fresh.state).toMatchObject({
      penColor: 0xffffff,
      fillColor: 0x000000,
      penWidth: 1,
      penMode: 4,
      doubleBuffer: false,
    });
  }, 120_000);

  it('task 83 gives the pixel in D0.L, and $FFFFFFFF outside the surface', () => {
    expect(long(0)).toBe(0x000000ff);
    expect(long(4)).toBe(0xffffffff);
    expect(long(24)).toBe(0x0000ff00); // the flood-filled background, read back: black xor green
  });

  it('task 96 gives the window pen in D1.W and D2.W and leaves the high words', () => {
    expect(long(8)).toBe(0xaaaa0008);
    expect(long(12)).toBe(0xbbbb0004);
  });

  it('V5: the window pen lags while double buffering and catches up at mode 16', () => {
    expect([word(16), word(18)]).toEqual([5, 5]);
    expect([word(20), word(22)]).toEqual([100, 100]);
  });

  it('the surface has the pixels and the state of the same calls made directly', () => {
    const direct = new Surface(640, 480);
    drawDirectly(direct);
    expect(surface.state).toEqual(direct.state);
    expect(surface.state).toMatchObject({ penWidth: 3, penMode: 14, fillColor: 0x00ff00, doubleBuffer: false });
    expect(hashPixels(surface.back)).toBe(hashPixels(direct.back));
    // the pixel of task 82 at the low words of D1 and D2: red, then xor-ed with the rectangle's green
    expect(surface.getPixel(10, 12)).toBe(0x00ffff);
  });
});
