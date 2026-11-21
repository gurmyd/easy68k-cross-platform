// PrinterDevice: the metrics of 3.8.4, jobs, and TRAP #15 task 10 with the real engine.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PrinterMetric, type PrintJob } from '../../contracts';
import { createSimEngine, releaseSimEngine } from '../../engine';
import { assembleProgram } from '../../engine/testing';
import { MemoryBackend } from '../../fs/memory-backend';
import { MemorySyncFiles } from '../../fs/sync/memory';
import { createVfs } from '../../fs/vfs';
import { createHeadlessSession } from '../run/headless';
import { createDeviceDoubles } from '../run/test-kit';
import { PAGE_HEIGHT, PAGE_WIDTH, PrinterDevice, printerCell } from './printer';

const dist = (file: string) => fileURLToPath(new URL(`../../../../engine/dist/${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(dist(file)),
);
it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !enginesBuilt)('engine/dist holds both engines', () => {
  expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run `npm run build:engines` first.');
});

function device(font = { name: 'Courier New', size: 10 }) {
  const jobs: PrintJob[] = [];
  const printer = new PrinterDevice({ font: () => font, submit: (job) => jobs.push(job) });
  return { printer, jobs, font };
}

describe('PrinterDevice', () => {
  it('answers the metrics of 3.8.4: 8.5 x 11 inches at 600 dpi, the cell from the Printer Font', () => {
    const { printer, font } = device();
    expect(printer.printerMetric(PrinterMetric.PageWidth)).toBe(5100);
    expect(printer.printerMetric(PrinterMetric.PageHeight)).toBe(6600);
    // Courier New 10: round(10 * 600 / 72 * 0.6) = 50, round(10 * 600 / 72 * 1.13) = 94.
    expect(printer.printerMetric(PrinterMetric.ColWidth)).toBe(50);
    expect(printer.printerMetric(PrinterMetric.RowHeight)).toBe(94);
    expect(printer.printerMetric(99)).toBe(0);
    // The setting is read at every question (Options > Printer Font).
    font.size = 12;
    printer.fontChanged();
    expect(printer.printerMetric(PrinterMetric.ColWidth)).toBe(60);
    expect(printer.printerMetric(PrinterMetric.RowHeight)).toBe(113);
    expect(printerCell(8)).toEqual({ colWidth: 40, rowHeight: 75 });
    expect([PAGE_WIDTH, PAGE_HEIGHT]).toEqual([5100, 6600]);
  });

  it('collects the characters of one document and submits it at EndDoc', () => {
    const { printer, jobs } = device();
    printer.printerBeginDoc();
    printer.printerTextOut(637, 600, 0x41);
    printer.printerTextOut(687, 600, 0x1c2); // one byte
    expect(jobs).toEqual([]);
    expect(printer.openJob?.chars).toHaveLength(2);
    printer.printerEndDoc();
    expect(jobs).toEqual([
      {
        font: { name: 'Courier New', size: 10 },
        chars: [
          { x: 637, y: 600, ch: 0x41 },
          { x: 687, y: 600, ch: 0xc2 },
        ],
      },
    ]);
    expect(printer.openJob).toBeNull();
  });

  it('a second BeginDoc ends the open job; a reset submits an open job as it stands', () => {
    const { printer, jobs } = device();
    printer.printerBeginDoc();
    printer.printerTextOut(1, 2, 0x58);
    printer.printerBeginDoc();
    expect(jobs).toHaveLength(1);
    printer.printerTextOut(3, 4, 0x59);
    printer.resetToStartup();
    expect(jobs).toHaveLength(2);
    expect(jobs[1]?.chars).toEqual([{ x: 3, y: 4, ch: 0x59 }]);
    printer.resetToStartup();
    expect(jobs).toHaveLength(2); // nothing open: nothing submitted
  });
});

describe.skipIf(!enginesBuilt)('TRAP #15 task 10 with the real engine (needs engine/dist)', () => {
  it('a form feed ends the job; the page logic places the characters on the virtual page', async () => {
    const program = await assembleProgram([
      '        ORG     $1000',
      'START:  LEA     TEXT,A1',
      '        MOVEQ   #10,D0',
      '        TRAP    #15',
      '        LEA     MORE,A1',
      '        MOVEQ   #10,D0',
      '        TRAP    #15',
      '        SIMHALT',
      "TEXT:   DC.B    'AB',13,10,'C',9,'D',0",
      "MORE:   DC.B    'E',12,'F',0",
      '        END     START',
    ]);
    const vfs = createVfs();
    vfs.mount(new MemoryBackend());
    await vfs.writeFile('/memory/demo/print.S68', program.s68);
    const doubles = createDeviceDoubles();
    const session = await createHeadlessSession({
      engines: { create: createSimEngine, release: releaseSimEngine },
      vfs,
      viewFor: () => new MemorySyncFiles(),
      parts: { log: doubles.parts.log, sound: doubles.parts.sound },
      settings: { printerFont: { name: 'Courier New', size: 10 } },
    });
    try {
      await session.controller.open('/memory/demo/print.S68', 'open');
      session.controller.run();
      expect(session.runUntilIdle()).toBe(true);
      // pageLeft = 5100 / 8 = 637, pageTop = 6600 / 11 = 600; cell 50 x 94.
      expect(session.printJobs).toHaveLength(1);
      const job = session.printJobs[0] as PrintJob;
      expect(job.font).toEqual({ name: 'Courier New', size: 10 });
      expect(job.chars).toEqual([
        { x: 637, y: 600, ch: 0x41 },
        { x: 687, y: 600, ch: 0x42 },
        { x: 637, y: 694, ch: 0x43 },
        { x: 937, y: 694, ch: 0x44 }, // tab: four cells, then nextX(): five in all
        { x: 987, y: 694, ch: 0x45 },
      ]);
      // 'F' starts the next document, which stays open until a form feed or a cold start.
      expect(session.printer).toBeInstanceOf(PrinterDevice);
      expect((session.printer as PrinterDevice).openJob?.chars).toEqual([{ x: 637, y: 600, ch: 0x46 }]);
      await session.controller.coldStart();
      expect(session.printJobs).toHaveLength(2);
      expect(session.printJobs[1]?.chars).toEqual([{ x: 637, y: 600, ch: 0x46 }]);
    } finally {
      session.dispose();
    }
  }, 120_000);
});
