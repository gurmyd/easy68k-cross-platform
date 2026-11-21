// The scenario of integration gate I1 (ARCHITECTURE.md 9.3) under Node: the real assembler, the real
// simulator engine, the real run controller and the real host parts of wave 1, composed by the
// headless session of 6.4 (core/run/headless.ts), with virtual time and no user interface.
//
//   load a prebuilt .S68 and .L68 - run to the halt with text output - type into a task 2 prompt -
//   pause, step, trace - memory, stack and hardware follow
//
// and beyond its letter: every official example, a program that waits for a key, a program that
// draws, Rewind and run again, Close and open again.
//
// The browser half (the same scenario through the real interface, in Chromium and WebKit) is
// check-wave1.mjs. Owner: I1.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Reg } from '../../../app/src/contracts';
import {
  OFFICIAL_EXAMPLES,
  TUTORIAL1_OUTPUT,
  advanceUntil,
  assembleExample,
  assembleOwn,
  corpusBytes,
  exampleBytes,
  headlessWith,
  registersOf,
  runHeadless,
  screenText,
  typeText,
  type Assembled,
  type OwnProgram,
} from './fixtures';

const dist = (file: string) => fileURLToPath(new URL(`../../../engine/dist/${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(dist(file)),
);
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !enginesBuilt)('engine/dist holds both engines', () => {
  expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run `npm run build:engines` first.');
});

/** Every test here runs the real engines; on a busy machine one can take seconds. */
const LONG = 120_000;

const hex = (value: number, digits = 8) => (value >>> 0).toString(16).toUpperCase().padStart(digits, '0');
/** The big-endian long word at an address of the simulator's memory. */
const longAt = (memory: Uint8Array, address: number) =>
  [...memory.subarray(address, address + 4)].reduce((value, byte) => value * 256 + byte, 0);

describe.skipIf(!enginesBuilt)('wave 1 scenario, headless (needs engine/dist)', { timeout: LONG }, () => {
  const examples = new Map<string, Assembled>();
  const own = new Map<OwnProgram, Assembled>();

  beforeAll(async () => {
    for (const name of OFFICIAL_EXAMPLES) examples.set(name, await assembleExample(name));
    for (const name of ['prompt', 'keywait', 'draw', 'counter', 'hardware'] as const) {
      own.set(name, await assembleOwn(name));
    }
  }, LONG);

  const example = (name: string): Assembled => examples.get(name) as Assembled;
  const program = (name: OwnProgram): Assembled => own.get(name) as Assembled;

  it('the shipped examples are the official ones of the corpus, byte for byte, and assemble without errors', () => {
    for (const name of OFFICIAL_EXAMPLES) {
      expect(Buffer.from(exampleBytes(name)).equals(Buffer.from(corpusBytes(name))), name).toBe(true);
      expect(example(name).s68.length, name).toBeGreaterThan(0);
      expect(example(name).l68.length, name).toBeGreaterThan(0);
    }
  });

  it('tutorial1: loads with its listing, runs to the halt and prints its four lines', async () => {
    const { session, path } = await headlessWith(example('tutorial1.X68'));
    try {
      const { controller } = session;
      await controller.open(path, 'open');
      expect(controller.program?.path).toBe(path);
      expect(controller.program?.hasListing).toBe(true);
      expect(session.messages()).toContain('.S68 file read successful');
      expect(session.engine.getRegister(Reg.PC)).toBe(0x1000);
      // The listing: the rows of the .L68, and the row of the start address is highlighted.
      expect(session.listing.rows.length).toBeGreaterThan(90);
      const highlighted = session.listing.rows[controller.snapshot.highlight] ?? '';
      expect(highlighted.startsWith('00001000  123C 0003')).toBe(true);

      controller.run();
      expect(session.runUntilIdle()).toBe(true);
      expect(controller.snapshot.halted).toBe(true);
      expect(screenText(session)).toEqual(TUTORIAL1_OUTPUT);
      const registers = registersOf(session);
      expect(registers.d[1]).toBe(68020); // the last number the program displayed through D1
      expect(registers.d[2]).toBe(520);
      expect(registers.d[3]).toBe(68020);
      // sum2 (a word of the program's storage) received 520: memory follows the program.
      const sum2 = session.listing.rows.find((row) => /\bsum2\s+ds\.w/i.test(row)) ?? '';
      const address = Number.parseInt(sum2.slice(0, 8), 16);
      expect([...session.engine.memory.subarray(address, address + 2)]).toEqual([0x02, 0x08]);
      expect(session.reports).toEqual([]);
    } finally {
      session.dispose();
    }
  });

  it('a task 2 prompt takes what is typed and the program goes on', async () => {
    const outcome = await runHeadless(program('prompt'), { typed: ['Ada\n'] });
    expect(outcome.end).toBe('halted');
    // What is typed is drawn but not stored in the text array (simIOu.cpp; text-screen.ts inputEcho).
    expect(outcome.text).toEqual(['What is your name?', 'Hello, Ada']);
    expect((outcome.registers.d[7] ?? -1) & 0xffff).toBe(3); // the length task 2 returned
    expect(outcome.reports).toEqual([]);
  });

  it('a task 2 prompt without input keeps waiting', async () => {
    const outcome = await runHeadless(program('prompt'), { seconds: 2 });
    expect(outcome.end).toBe('waiting for input');
    expect(outcome.text).toEqual(['What is your name?']);
  });

  it('a program that waits for a key goes on at the key', async () => {
    const outcome = await runHeadless(program('keywait'), { typed: ['k'] });
    expect(outcome.end).toBe('halted');
    expect(outcome.text).toEqual(['Press a key: k - you pressed k']);
    expect((outcome.registers.d[6] ?? -1) & 0xff).toBe('k'.charCodeAt(0));
  });

  it('pause, trace into, step over: registers, listing highlight, stack and memory follow', async () => {
    const { session, path } = await headlessWith(program('counter'));
    try {
      const { controller, engine } = session;
      await controller.open(path, 'open');
      controller.run();
      session.time.advance(200);
      expect(controller.phase).toBe('running');
      controller.pause();
      expect(advanceUntil(session, () => controller.phase === 'idle')).toBe(true);
      const paused = engine.getRegister(Reg.D0) >>> 0;
      expect(paused).toBeGreaterThan(1000);
      session.time.advance(200);
      expect(engine.getRegister(Reg.D0) >>> 0).toBe(paused); // nothing executes after Pause

      const rowOf = (text: RegExp) => session.listing.rows.findIndex((row) => text.test(row));
      const bsrRow = rowOf(/\bBSR\s+SUB/);
      const subRow = rowOf(/^\S+\s+\S+.*\bSUB:\s+MOVE\.L/);
      const bsrAddress = session.listing.addressOf(bsrRow) as number;
      const subAddress = session.listing.addressOf(subRow) as number;

      // Trace Into until the program is at the BSR: the highlight is the row of the PC every time.
      for (let i = 0; i < 8 && engine.getRegister(Reg.PC) !== bsrAddress; i++) {
        controller.traceInto();
        advanceUntil(session, () => controller.phase === 'idle');
        expect(session.listing.addressOf(controller.snapshot.highlight)).toBe(engine.getRegister(Reg.PC));
      }
      expect(engine.getRegister(Reg.PC)).toBe(bsrAddress);
      const stackBefore = engine.getRegister(Reg.A7) >>> 0;

      // Trace Into enters the subroutine: the return address is on the stack.
      controller.traceInto();
      advanceUntil(session, () => controller.phase === 'idle');
      expect(engine.getRegister(Reg.PC)).toBe(subAddress);
      expect(engine.getRegister(Reg.A7) >>> 0).toBe(stackBefore - 4);
      const returnAddress = longAt(engine.memory, stackBefore - 4);
      expect(returnAddress).toBe(bsrAddress + 4); // BSR with a 16-bit displacement is four bytes
      expect(controller.snapshot.boxes[18]).toBe(hex(subAddress)); // Box.PC

      // Back at the BSR one round later, Step Over runs the whole subroutine.
      for (let i = 0; i < 12 && engine.getRegister(Reg.PC) !== bsrAddress; i++) {
        controller.traceInto();
        advanceUntil(session, () => controller.phase === 'idle');
      }
      expect(engine.getRegister(Reg.PC)).toBe(bsrAddress);
      controller.stepOver();
      advanceUntil(session, () => controller.phase === 'idle');
      expect(engine.getRegister(Reg.PC)).toBe(bsrAddress + 4);
      expect(engine.getRegister(Reg.A7) >>> 0).toBe(stackBefore);

      // The next instruction stores the counter: memory follows.
      const countRow = rowOf(/\bCOUNT:\s+DS\.L/);
      const countAddress = session.listing.addressOf(countRow) as number;
      controller.traceInto();
      advanceUntil(session, () => controller.phase === 'idle');
      const stored = longAt(engine.memory, countAddress);
      expect(stored).toBe(engine.getRegister(Reg.D0) >>> 0);
      expect(session.reports).toEqual([]);
    } finally {
      session.dispose();
    }
  });

  it('hardware: the display, the LEDs and the switches follow the program and the panel', async () => {
    const { session, path } = await headlessWith(program('hardware'));
    try {
      const { controller } = session;
      await controller.open(path, 'open');
      controller.run();
      session.time.advance(200);
      let view = session.hardware.view(session.engine);
      expect([...view.seg7Bytes.slice(0, 2)]).toEqual([0x06, 0x5b]);
      // A click on toggle switch 0, as the Hardware panel posts it: the program copies it to the LEDs.
      controller.post({ kind: 'switchClick', bit: 0 });
      session.time.advance(200);
      view = session.hardware.view(session.engine);
      expect(session.engine.memory[0xe00010]).toBe(0x01);
      expect(session.engine.memory[0xe00012]).toBe(0x01);
      controller.pause();
      advanceUntil(session, () => controller.phase === 'idle');
      expect(session.reports).toEqual([]);
    } finally {
      session.dispose();
    }
  });

  it('a program that draws: the pixels are on the surface', async () => {
    const { session, path } = await headlessWith(program('draw'));
    try {
      const { controller, surface } = session;
      await controller.open(path, 'open');
      controller.run();
      expect(session.runUntilIdle()).toBe(true);
      expect(controller.snapshot.halted).toBe(true);
      expect(hex(surface.getPixel(100, 80), 6)).toBe('0000FF'); // inside the rectangle: red fill
      expect(hex(surface.getPixel(40, 80), 6)).toBe('00FF00'); // its left edge: green pen
      expect(hex(surface.getPixel(400, 200), 6)).toBe('FF0000'); // on the line: blue pen
      expect(hex(surface.getPixel(320, 400), 6)).toBe('FFFFFF'); // the pixel
      expect(hex(surface.getPixel(600, 440), 6)).toBe('000000'); // the background
    } finally {
      session.dispose();
    }
  });

  it('Rewind and run again: the same output once more, not twice', async () => {
    const { session, path } = await headlessWith(example('tutorial1.X68'));
    try {
      const { controller } = session;
      await controller.open(path, 'open');
      controller.run();
      session.runUntilIdle();
      controller.rewind();
      advanceUntil(session, () => controller.phase === 'idle', 1000);
      // sim-ui 9.9 and 9.10: registers cleared, PC at the start, the I/O window cleared. The
      // original's `halt` flag is not touched by initSim() (it is cleared by the next run).
      expect(session.engine.getRegister(Reg.PC)).toBe(0x1000);
      expect(session.engine.getRegister(Reg.D2)).toBe(0);
      expect(screenText(session)).toEqual([]);
      expect(controller.snapshot.halted).toBe(true);
      controller.run();
      expect(session.runUntilIdle()).toBe(true);
      expect(controller.snapshot.halted).toBe(true);
      expect(screenText(session)).toEqual(TUTORIAL1_OUTPUT);
      expect(registersOf(session).d[3]).toBe(68020);
    } finally {
      session.dispose();
    }
  });

  it('Close and open again, then another program in the same session', async () => {
    const { session, vfs, path } = await headlessWith(example('tutorial1.X68'));
    try {
      const { controller } = session;
      await controller.open(path, 'open');
      controller.run();
      session.runUntilIdle();
      await controller.close();
      // sim-ui 8.5: Close empties the listing; the program stays in memory and Reload stays possible.
      expect(controller.program?.hasListing).toBe(false);
      expect(session.listing.rows.length).toBe(0);
      await controller.open(path, 'open');
      controller.run();
      expect(session.runUntilIdle()).toBe(true);
      expect(screenText(session).slice(-4)).toEqual(TUTORIAL1_OUTPUT);

      // A second program over the first, without closing.
      const prompt = program('prompt');
      await vfs.writeFile('/memory/wave1/prompt.S68', prompt.s68);
      await vfs.writeFile('/memory/wave1/prompt.L68', prompt.l68);
      await controller.open('/memory/wave1/prompt.S68', 'open');
      expect(controller.program?.path).toBe('/memory/wave1/prompt.S68');
      controller.run();
      expect(advanceUntil(session, () => controller.phase === 'waitInput')).toBe(true);
      typeText(session, 'Grace\n');
      expect(session.runUntilIdle()).toBe(true);
      expect(screenText(session).slice(-1)).toEqual(['Hello, Grace']);
      expect(session.reports).toEqual([]);
    } finally {
      session.dispose();
    }
  });

  it('a second program opened over a rewound first one: the listing marks the row of its PC, or none', async () => {
    // Fails while the engine keeps the first program's ItemIndex across the load (docs/integration/wave1.md).
    const { session, vfs, path } = await headlessWith(example('tutorial1.X68'));
    try {
      const { controller } = session;
      await controller.open(path, 'open');
      controller.run();
      session.runUntilIdle();
      controller.rewind();
      advanceUntil(session, () => controller.phase === 'idle', 1000);
      const second = example('tutorial2.X68');
      await vfs.writeFile(`/memory/wave1/${second.s68Name}`, second.s68);
      await vfs.writeFile(`/memory/wave1/${second.l68Name}`, second.l68);
      await controller.open(`/memory/wave1/${second.s68Name}`, 'open');
      const row = controller.snapshot.highlight;
      const pc = hex(session.engine.getRegister(Reg.PC));
      // sim-ui §6.4 and errata U1.md entry 8: the PC row, or no row at all (-1); never another row.
      expect(
        row === -1 || (session.listing.rows[row] ?? '').startsWith(pc),
        `row ${row}: ${session.listing.rows[row]}`,
      ).toBe(true);
    } finally {
      session.dispose();
    }
  });

  it('every official example loads and runs for five seconds without a failure of the session', async () => {
    const table: string[] = [];
    for (const name of OFFICIAL_EXAMPLES) {
      const extraFiles = Object.fromEntries(
        ['0.wav', '1.wav', 'chime.wav', 'roger.wav', 'tick.wav', 'tock.wav'].map((wav) => [wav, exampleBytes(wav)]),
      );
      const outcome = await runHeadless(example(name), { seconds: 5, extraFiles });
      table.push(
        `${name.padEnd(20)} ${outcome.end.padEnd(18)} PC=${hex(outcome.registers.pc)} ` +
          `text=${JSON.stringify(outcome.text.slice(0, 4))}${outcome.text.length > 4 ? ` (+${outcome.text.length - 4} rows)` : ''}` +
          `${outcome.alerts.length ? ` alerts=${JSON.stringify(outcome.alerts)}` : ''}` +
          `${outcome.reports.length ? ` REPORTS=${JSON.stringify(outcome.reports)}` : ''}`,
      );
      expect(outcome.reports, name).toEqual([]);
    }
    console.log(`official examples, five seconds of virtual time each:\n${table.join('\n')}`);
  });
});
