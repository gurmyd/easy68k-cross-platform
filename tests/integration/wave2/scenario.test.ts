// The scenario of integration gate I2 (ARCHITECTURE.md 9.5) under Node: the APPLICATION, built by
// bootstrap with the real document service, the real Assemble, Run, Listing, Log, Break Points and
// Find features, the real assembler and simulator engines, the real run controller and host parts
// (ProgramFiles over the cached view of the browser store, LogService, SoundDevice), with virtual
// time. Commands run through the command registry as the menus run them; dialogs are answered
// through the dialog service as a student's click answers them.
//
//   every official example: opened, F9, the official .L68 and .S68, Execute, Run to its end or its
//   first input, compared with the headless session of wave 1 - edit, assemble and Execute three
//   times, each Execute a cold start - settings export and import with the original's files -
//   logging with both logs against the official logs - a program that writes and reads a file - a
//   program that plays sounds - a breakpoint that stops a run - find and replace before assembling
//
// and beyond its letter: a program with an error (the message, the correction), a program that
// includes a file from the store.
//
// The browser half (the same scenario through the real interface, in Chromium and WebKit) is
// check-wave2.mjs. Owner: I2.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Reg, SimOption, type Bytes, type DocumentState } from '../../../app/src/contracts';
import { documentRegistryOf } from '../../../app/src/core/documents/service';
import type { StatusDialogProps } from '../../../app/src/features/assemble/assemble';
import { findModelOf } from '../../../app/src/features/find/model';
import { LOG_OUTPUT_DIALOG_ID } from '../../../app/src/features/log/model';
import { exportBytes, importBytes } from '../../../app/src/features/options/transfer';
import { simMainOf } from '../../../app/src/features/sim-main/model';
import { MESSAGE_DIALOG_ID } from '../../../app/src/state/dialogs';
import { compareOutputs, createdOn, describeVerdict } from '../../conformance/asm/compare';
import { runHeadless, type Assembled } from '../wave1/fixtures';
import {
  CORRECTED_LINE,
  ERROR_LINE,
  ERROR_PROGRAM,
  ERROR_TEXT,
  EXAMPLE_FILES,
  FILE_NAME,
  FILE_PROGRAM,
  FILE_TEXT,
  INCLUDE_LIB,
  INCLUDE_MAIN,
  INCLUDE_OUTPUT,
  LOG_PROGRAM,
  OFFICIAL_EXAMPLES,
  REPLACE_AFTER,
  REPLACE_BEFORE,
  REPLACE_FIND,
  REPLACE_PROGRAM,
  REPLACE_WITH,
  answer,
  boxes,
  crlf,
  dialogs,
  exampleBytes,
  latin1,
  logProgramSource,
  maskLog,
  officialLogs,
  officialOutputs,
  outputText,
  penOutput,
  penProgram,
  shippedSettingsFile,
  startApplication,
  until,
  wavMs,
  type ScenarioApp,
} from './fixtures';

const dist = (file: string) => fileURLToPath(new URL(`../../../engine/dist/${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(dist(file)),
);
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !enginesBuilt)('engine/dist holds both engines', () => {
  expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run `npm run build:engines` first.');
});

/** Every test here runs the real engines; on a busy machine one can take a minute. */
const LONG = 300_000;
const STATUS_DIALOG = 'asm.status';
const hex = (value: number, digits = 8) => (value >>> 0).toString(16).toUpperCase().padStart(digits, '0');
const bytesOf = (text: string): Bytes => Uint8Array.from(text, (ch) => ch.charCodeAt(0));

/* ------------------------------------------------------------------ what a student does */

async function writeText(s: ScenarioApp, path: string, text: string): Promise<void> {
  await s.app.ctx.vfs.writeFile(path, bytesOf(text));
}

async function openDocument(s: ScenarioApp, path: string): Promise<DocumentState> {
  const doc = await s.app.ctx.documents.open(path);
  if (!doc) throw new Error(`the document service did not open ${path}`);
  return doc;
}

/** F9 (ed.project.assemble) on the active document; resolves with the status dialog's props. */
async function assemble(s: ScenarioApp): Promise<{ status: StatusDialogProps; close(result: string): Promise<void> }> {
  const done = s.app.ctx.commands.run('ed.project.assemble');
  const shown = await until(s, () => dialogs(s).some((dialog) => dialog.id === STATUS_DIALOG), 60_000);
  if (!shown) throw new Error(`no status dialog; boxes: ${JSON.stringify(boxes(s))}`);
  const status = dialogs(s).find((dialog) => dialog.id === STATUS_DIALOG)?.props as StatusDialogProps;
  return {
    status,
    async close(result) {
      answer(s, STATUS_DIALOG, result);
      await done;
    },
  };
}

/**
 * The status dialog's Execute. Answers the `Caution` question with OK when the old program still
 * runs or waits (note 20). Resolves when the new program is loaded and the controller idle.
 */
async function execute(s: ScenarioApp, close: (result: string) => Promise<void>, sRecord: string): Promise<void> {
  const closed = close('execute');
  await until(
    s,
    () =>
      boxes(s).some((box) => box.startsWith('Caution')) ||
      (s.app.ctx.sim.controller.program?.path === sRecord && s.app.ctx.sim.controller.phase === 'idle'),
    30_000,
  );
  if (boxes(s).some((box) => box.startsWith('Caution'))) answer(s, MESSAGE_DIALOG_ID, 'OK');
  await closed;
  const loaded = await until(
    s,
    () => s.app.ctx.sim.controller.program?.path === sRecord && s.app.ctx.sim.controller.phase === 'idle',
    30_000,
  );
  if (!loaded) throw new Error(`Execute did not load ${sRecord}: ${JSON.stringify(s.app.ctx.sim.controller.program)}`);
}

type End = 'halted' | 'stopped' | 'waiting for input' | 'still running' | 'waiting';

/** Run (sim.run.run) until the program halts, stops or waits for input, or `ms` of virtual time pass. */
async function runProgram(s: ScenarioApp, ms = 5000, answerBoxes = true): Promise<{ end: End; boxes: string[] }> {
  const seen: string[] = [];
  const before = s.app.ctx.sim.engine.stepCount;
  await s.app.ctx.commands.run('sim.run.run');
  const controller = s.app.ctx.sim.controller;
  await until(
    s,
    () => {
      for (const box of boxes(s)) if (!seen.includes(box)) seen.push(box);
      if (answerBoxes && boxes(s).length > 0) answer(s, MESSAGE_DIALOG_ID, 'OK');
      if (s.app.ctx.sim.engine.stepCount === before) return false;
      return controller.phase === 'idle' || controller.phase === 'waitInput';
    },
    ms,
  );
  // An engine box (a halt with a log) can come with the halt itself.
  await until(s, () => false, 64);
  for (const box of boxes(s)) if (!seen.includes(box)) seen.push(box);
  if (answerBoxes) while (boxes(s).length > 0) answer(s, MESSAGE_DIALOG_ID, 'OK');
  const end: End =
    controller.phase === 'idle'
      ? controller.snapshot.halted
        ? 'halted'
        : 'stopped'
      : controller.phase === 'waitInput'
        ? 'waiting for input'
        : controller.phase === 'running'
          ? 'still running'
          : 'waiting';
  return { end, boxes: seen };
}

/** Stops whatever runs, the way a student does before the next program: Pause. */
async function pause(s: ScenarioApp): Promise<void> {
  if (s.app.ctx.sim.controller.phase !== 'idle') await s.app.ctx.commands.run('sim.run.pause');
  await until(s, () => s.app.ctx.sim.controller.phase === 'idle', 2000);
}

/** Replaces line `line` (1-based) of a document's text through the editor's document registry. */
function editLine(s: ScenarioApp, id: string, line: number, text: string): void {
  const registry = documentRegistryOf(s.app.ctx.documents);
  const doc = registry.state(id).doc;
  const target = doc.line(line);
  registry.dispatch(id, { changes: { from: target.from, to: target.to, insert: text }, userEvent: 'input' });
}

const readFile = async (s: ScenarioApp, path: string): Promise<Bytes | null> =>
  (await s.app.ctx.vfs.stat(path)) ? s.app.ctx.vfs.readFile(path) : null;

/** The address of the first listing row whose source matches `pattern`. */
function addressIn(listing: Bytes, pattern: RegExp): number {
  const row = latin1(listing)
    .split(/\r?\n/)
    .find((text) => /^[0-9A-F]{8}/.test(text) && pattern.test(text));
  return row ? Number.parseInt(row.slice(0, 8), 16) : Number.NaN;
}

/* ------------------------------------------------------------------------------ the scenario */

describe.skipIf(!enginesBuilt)(
  'wave 2 scenario, the application under Node (needs engine/dist)',
  { timeout: LONG },
  () => {
    it('every official example: opened, F9 gives the official .L68 and .S68, Execute, Run as in the headless session', async () => {
      const s = await startApplication();
      try {
        for (const file of EXAMPLE_FILES)
          await s.app.ctx.vfs.writeFile(`/browser/Examples/${file}`, exampleBytes(file));
        const table: string[] = [];
        const failures: string[] = [];
        // Observation only (SH5's request): the cost of the whole-file reads the sound tasks make
        // through ProgramFiles.read (graphicSound's last loop asks task 70 until the player is free).
        const files = s.app.ctx.sim.files;
        const realRead = files.read.bind(files);
        const reads = { calls: 0, ms: 0, longest: 0 };
        files.read = (fileName) => {
          const t0 = performance.now();
          const result = realRead(fileName);
          const spent = performance.now() - t0;
          reads.calls++;
          reads.ms += spent;
          reads.longest = Math.max(reads.longest, spent);
          return result;
        };
        for (const example of OFFICIAL_EXAMPLES) {
          const readsBefore = { ...reads };
          const stem = example.replace(/\.X68$/, '');
          const sRecord = `/browser/Examples/${stem}.S68`;
          const listingPath = `/browser/Examples/${stem}.L68`;
          await openDocument(s, `/browser/Examples/${example}`);
          // The official listing's own time, so that even its date line must be equal.
          const official = officialOutputs(example);
          s.setWallTime(createdOn(official.listing) ?? new Date(2026, 10, 21, 12));
          const { status, close } = await assemble(s);
          const ours = { listing: await readFile(s, listingPath), sRecord: await readFile(s, sRecord) };
          const verdict = compareOutputs(official, ours);
          const exact =
            ours.listing !== null &&
            ours.sRecord !== null &&
            Buffer.compare(ours.listing, official.listing) === 0 &&
            Buffer.compare(ours.sRecord, official.sRecord) === 0;
          if (!(status.errors === 0 && status.warnings === 0 && status.executeEnabled)) {
            failures.push(`${example}: status ${JSON.stringify(status)}`);
          }
          if (!verdict.equal || !exact)
            failures.push(`${example}: the files differ from the official ones: ${describeVerdict(verdict)}`);

          const replacedBefore = s.engineReplacements();
          await execute(s, close, sRecord);
          // 4.7.1: a cold start is skipped while the simulator is still exactly as the last one left
          // it, which can be so for the first Execute of a new window only. Whether the controller
          // skips it there depends on whether a queued read of the engine (the log service's, after
          // the start) has been delivered yet (docs/integration/wave2.md, finding on 4.7.1): either
          // is the same fresh simulator for the program. Every later Execute must be a cold start.
          const coldStarts = s.engineReplacements() - replacedBefore;
          const first = example === OFFICIAL_EXAMPLES[0];
          if (!(coldStarts === 1 || (first && coldStarts === 0))) {
            failures.push(`${example}: Execute made ${coldStarts} cold start(s)`);
          }
          const { end, boxes: shown } = await runProgram(s, 5000);
          const text = outputText(s);

          // The same program, the same files, in the headless session of 6.4 (wave 1's fixtures).
          const program: Assembled = {
            source: example,
            s68Name: `${stem}.S68`,
            l68Name: `${stem}.L68`,
            s68: ours.sRecord ?? new Uint8Array(),
            l68: ours.listing ?? new Uint8Array(),
            warnings: 0,
          };
          const extraFiles = Object.fromEntries(
            ['0.wav', '1.wav', 'chime.wav', 'roger.wav', 'tick.wav', 'tock.wav'].map((wav) => [wav, exampleBytes(wav)]),
          );
          const headless = await runHeadless(program, { seconds: 5, extraFiles });
          const settled = headless.end === 'halted' || headless.end === 'waiting for input';
          if (settled && (end !== headless.end || JSON.stringify(text) !== JSON.stringify(headless.text))) {
            failures.push(
              `${example}: the application ends "${end}" with ${JSON.stringify(text.slice(0, 4))}, ` +
                `the headless session "${headless.end}" with ${JSON.stringify(headless.text.slice(0, 4))}`,
            );
          }
          if (!settled && (end === 'halted' || end === 'stopped'))
            failures.push(`${example}: stopped (${end}), the headless session keeps running`);
          table.push(
            `${example.padEnd(20)} F9 ${status.errors}/${status.warnings} ${exact ? 'official bytes' : 'DIFFERS'}; ` +
              `run: ${end.padEnd(18)} ${JSON.stringify(text.slice(0, 3))}${shown.length ? ` boxes ${JSON.stringify(shown)}` : ''}`,
          );

          if (example === 'fileio.X68') {
            // It writes test1.txt, reads it back into its buffer, closes and deletes it.
            const listing = ours.listing ?? new Uint8Array();
            const data = addressIn(listing, /\bdata\s+dc\.b\s+'this is a test'/i);
            const buffer = addressIn(listing, /\bbuffer\s+ds\.b/i);
            const memory = s.app.ctx.sim.engine.memory;
            const wrote = latin1(memory.subarray(data, data + 24));
            const readBack = latin1(memory.subarray(buffer, buffer + 24));
            if (readBack !== wrote || !wrote.startsWith('this is a test')) {
              failures.push(`fileio.X68: read back ${JSON.stringify(readBack)} for ${JSON.stringify(wrote)}`);
            }
            await until(s, () => false, 1000);
            if ((await readFile(s, '/browser/Examples/test1.txt')) !== null)
              failures.push('fileio.X68: test1.txt is still there');
          }
          if (example === 'graphicSound.X68') {
            const name = (data: Bytes) =>
              ['0.wav', '1.wav', 'chime.wav', 'roger.wav', 'tick.wav', 'tock.wav'].find(
                (wav) => Buffer.compare(exampleBytes(wav), data) === 0,
              ) ?? '?';
            const plays = s.plays.map((play) => `${name(play.data)}@${play.at}`);
            table.push(`  graphicSound sounds (virtual ms): ${plays.join(', ')}`);
            const at = (wav: string) => s.plays.find((play) => name(play.data) === wav)?.at ?? Number.NaN;
            const after1 = at('0.wav') - at('1.wav');
            const after0 = at('roger.wav') - at('0.wav');
            const d1 = wavMs(exampleBytes('1.wav'));
            const d0 = wavMs(exampleBytes('0.wav'));
            table.push(
              `  1.wav lasts ${d1.toFixed(1)} ms, 0.wav ${d0.toFixed(1)} ms; 0.wav came ${after1} ms after 1.wav, roger.wav ${after0} ms after 0.wav`,
            );
            const calls = reads.calls - readsBefore.calls;
            const spent = reads.ms - readsBefore.ms;
            table.push(
              `  ProgramFiles.read for its sound tasks: ${calls} calls, ${spent.toFixed(1)} ms of real time ` +
                `(mean ${((spent / Math.max(1, calls)) * 1000).toFixed(0)} us, longest so far ${reads.longest.toFixed(2)} ms)`,
            );
            // A sound starts when the player is free again: never before the previous one has ended,
            // and within two display frames after it (the program polls between frames).
            if (!(after1 >= d1 - 1 && after1 <= d1 + 40))
              failures.push(`graphicSound: 0.wav ${after1} ms after 1.wav (1.wav lasts ${d1} ms)`);
            if (!(after0 >= d0 - 1 && after0 <= d0 + 40))
              failures.push(`graphicSound: roger.wav ${after0} ms after 0.wav (0.wav lasts ${d0} ms)`);
          }
          await pause(s);
        }
        console.log(`official examples through the application under Node:\n${table.join('\n')}`);
        expect(failures).toEqual([]);
      } finally {
        s.app.dispose();
      }
    });

    it('edit, assemble and Execute three times in a row: each Execute is a cold start', async () => {
      const s = await startApplication();
      try {
        const path = '/browser/edits/pen.X68';
        await writeText(s, path, crlf(penProgram(0)));
        const doc = await openDocument(s, path);
        const msgLine = penProgram(0).findIndex((line) => line.startsWith('MSG:')) + 1;
        const outputs: string[] = [];
        const replacements: number[] = [];
        for (let version = 1; version <= 3; version++) {
          editLine(s, doc.id, msgLine, `MSG:    DC.B    ' version ${version}',0`);
          expect(s.app.ctx.documents.list().find((d) => d.id === doc.id)?.modified).toBe(true);
          const { status, close } = await assemble(s);
          expect(status.errors, `version ${version}`).toBe(0);
          const before = s.engineReplacements();
          await execute(s, close, '/browser/edits/pen.S68');
          replacements.push(s.engineReplacements() - before);
          const { end } = await runProgram(s);
          expect(end).toBe('halted');
          outputs.push(outputText(s).join('|'));
          await s.app.ctx.commands.run('app.mode.set', 'editor');
        }
        expect(outputs).toEqual([penOutput(1), penOutput(2), penOutput(3)]);
        // The first Execute of a new window may find the simulator as its own start left it, and 4.7.1
        // then skips the cold start (whether it does depends on a queued engine read, see the examples
        // test); the two after it must each replace the engine.
        expect([0, 1]).toContain(replacements[0]);
        expect(replacements.slice(1)).toEqual([1, 1]);
        // The control: File > Open of the same program over the finished run is no cold start, and the
        // pen is where the last run left it. This is what makes the three results above evidence.
        await s.app.ctx.sim.controller.open('/browser/edits/pen.S68', 'open');
        await runProgram(s);
        expect(outputText(s).slice(-1)).toEqual([penOutput(3, false)]);
      } finally {
        s.app.dispose();
      }
    });

    it("settings: the original's settings.dat and sim68K.dat are imported, exported and imported again, and reach the assembler and the simulator", async () => {
      const s = await startApplication();
      try {
        const { ctx } = s.app;
        // The shipped files of the official distribution.
        importBytes(ctx, 'settings', shippedSettingsFile('settings.dat'));
        importBytes(ctx, 'sim', shippedSettingsFile('sim68K.dat'));
        const shipped = { editor: ctx.settings.get().editor, sim: ctx.settings.get().sim };
        // The shipped settings.dat (E4's check: the "Shipped file" values).
        expect([shipped.editor.fontSize, shipped.editor.realTabs, shipped.editor.colorPreset]).toEqual([10, false, -1]);

        // Change what a program and a listing can show, export, reset to the shipped files, import the export.
        ctx.settings.update((all) => ({
          ...all,
          editor: { ...all.editor, generateList: false },
          sim: { ...all.sim, exceptions: true, execLogType: 2, outputLogType: 1 },
        }));
        const editorFile = exportBytes(ctx, 'settings');
        const simFile = exportBytes(ctx, 'sim');
        expect(editorFile.unmappable + simFile.unmappable).toBe(0);
        importBytes(ctx, 'settings', shippedSettingsFile('settings.dat'));
        importBytes(ctx, 'sim', shippedSettingsFile('sim68K.dat'));
        expect(ctx.settings.get().editor.generateList).toBe(shipped.editor.generateList);
        expect(ctx.settings.get().sim.exceptions).toBe(shipped.sim.exceptions);
        importBytes(ctx, 'settings', editorFile.bytes);
        importBytes(ctx, 'sim', simFile.bytes);
        expect(ctx.settings.get().editor.generateList).toBe(false);
        expect([ctx.settings.get().sim.exceptions, ctx.settings.get().sim.execLogType]).toEqual([true, 2]);
        // The round trip is exact: exporting again writes the same bytes.
        expect(latin1(exportBytes(ctx, 'settings').bytes)).toBe(latin1(editorFile.bytes));
        expect(latin1(exportBytes(ctx, 'sim').bytes)).toBe(latin1(simFile.bytes));

        // The assembler takes Generate List File from the imported file: F9 writes no .L68.
        await writeText(
          s,
          '/browser/settings/prog.X68',
          crlf(['    ORG $1000', 'START:', '    SIMHALT', '    END START']),
        );
        await openDocument(s, '/browser/settings/prog.X68');
        const { status, close } = await assemble(s);
        expect(status.errors).toBe(0);
        expect(await readFile(s, '/browser/settings/prog.L68')).toBeNull();
        expect(await readFile(s, '/browser/settings/prog.S68')).not.toBeNull();
        // The simulator takes Enable Exceptions and the log types at the cold start of Execute (4.7.1 step 4).
        // The original's Execute starts a new SIM68K.EXE, which reads sim68K.dat: whatever was imported
        // is in force for the very first Execute too.
        await execute(s, close, '/browser/settings/prog.S68');
        // sim-ui 13.6: with a log type selected, Log Start is enabled as soon as a program is loaded.
        const logStartEnabled = () => s.app.ctx.commands.isEnabled('sim.run.logStart');
        await until(s, logStartEnabled, 1000);
        const first = {
          exceptions: s.app.ctx.sim.engine.getOption(SimOption.Exceptions),
          execLogType: s.app.ctx.sim.engine.getOption(SimOption.ExecLogType),
          logStart: s.app.ctx.commands.isEnabled('sim.run.logStart'),
        };
        await runProgram(s);
        await s.app.ctx.commands.run('app.mode.set', 'editor');
        const again = await assemble(s);
        await execute(s, again.close, '/browser/settings/prog.S68');
        await until(s, logStartEnabled, 1000);
        const second = {
          exceptions: s.app.ctx.sim.engine.getOption(SimOption.Exceptions),
          execLogType: s.app.ctx.sim.engine.getOption(SimOption.ExecLogType),
          logStart: s.app.ctx.commands.isEnabled('sim.run.logStart'),
        };
        const wanted = { exceptions: 1, execLogType: 2, logStart: true };
        expect({ second }).toEqual({ second: wanted });
        expect({ first }, 'the first Execute after the import (4.7.1 skips its cold start)').toEqual({ first: wanted });
      } finally {
        s.app.dispose();
      }
    });

    it('logging: Log Start with an execution log of type 2 and the output log gives the official logs', async () => {
      const official = officialLogs();
      expect(official, 'the official logs of l04-print.X68 are committed').not.toBeNull();
      const s = await startApplication();
      try {
        const { ctx } = s.app;
        await ctx.vfs.writeFile(`/browser/logs/${LOG_PROGRAM}.X68`, logProgramSource());
        await openDocument(s, `/browser/logs/${LOG_PROGRAM}.X68`);
        const { status, close } = await assemble(s);
        expect(status.errors).toBe(0);
        await execute(s, close, `/browser/logs/${LOG_PROGRAM}.S68`);
        expect(ctx.commands.isEnabled('sim.run.logStart')).toBe(false);
        // Options > Log Output...: Instruction and Registers, Text Only, OK.
        const shown = ctx.commands.run('sim.options.logOutput');
        expect(await until(s, () => dialogs(s).some((dialog) => dialog.id === LOG_OUTPUT_DIALOG_ID), 5000)).toBe(true);
        const props = dialogs(s).find((dialog) => dialog.id === LOG_OUTPUT_DIALOG_ID)?.props as { values: object };
        expect(props.values).toMatchObject({
          execFileName: `/browser/logs/${LOG_PROGRAM}_RunLog.txt`,
          outputFileName: `/browser/logs/${LOG_PROGRAM}_OutLog.txt`,
        });
        answer(s, LOG_OUTPUT_DIALOG_ID, { ...props.values, execType: 2, outputType: 1 });
        await shown;
        await until(s, () => ctx.commands.isEnabled('sim.run.logStart'), 2000);
        expect(ctx.commands.isEnabled('sim.run.logStart')).toBe(true);
        await ctx.commands.run('sim.run.logStart');
        await until(s, () => ctx.sim.log.state.logging || dialogs(s).length > 0, 5000);
        expect(dialogs(s).map((dialog) => dialog.id)).toEqual([]);
        expect(ctx.sim.log.state.logging).toBe(true);
        // Run at full speed writes no execution log (sim-ui 13.4): Auto Trace, as the oracle did.
        await ctx.commands.run('sim.run.autoTrace');
        const seen: string[] = [];
        const halted = await until(
          s,
          () => {
            for (const box of boxes(s)) if (!seen.includes(box)) seen.push(box);
            if (boxes(s).length > 0) answer(s, MESSAGE_DIALOG_ID, 'OK');
            return ctx.sim.controller.snapshot.halted && !ctx.sim.log.state.logging;
          },
          120_000,
        );
        expect(halted).toBe(true);
        expect(
          seen.some((box) => box.includes('Current Log Stopped.')),
          JSON.stringify(seen),
        ).toBe(true);
        await until(s, () => false, 1500);
        const exec = await readFile(s, `/browser/logs/${LOG_PROGRAM}_RunLog.txt`);
        const output = await readFile(s, `/browser/logs/${LOG_PROGRAM}_OutLog.txt`);
        expect(exec).not.toBeNull();
        expect(output).not.toBeNull();
        expect(maskLog(output as Bytes)).toBe(maskLog(official!.output));
        const ours = maskLog(exec as Bytes).split('\r\n');
        const theirs = maskLog(official!.exec).split('\r\n');
        const first = ours.findIndex((line, i) => line !== theirs[i]);
        expect(
          first,
          `first difference at line ${first + 1}: ours ${JSON.stringify(ours[first])}, official ${JSON.stringify(theirs[first])}`,
        ).toBe(-1);
        expect(ours.length).toBe(theirs.length);
      } finally {
        s.app.dispose();
      }
    });

    it('a program that writes, closes and reads back a file: the bytes are in the browser store', async () => {
      const s = await startApplication();
      try {
        await writeText(s, '/browser/files/writer.X68', crlf(FILE_PROGRAM));
        await openDocument(s, '/browser/files/writer.X68');
        const { close } = await assemble(s);
        await execute(s, close, '/browser/files/writer.S68');
        const { end } = await runProgram(s);
        expect(end).toBe('halted');
        expect(outputText(s)).toEqual([FILE_TEXT]);
        let stored: Bytes | null = null;
        await until(s, () => false, 1000); // the cached view writes behind (fs/sync/cached.ts)
        for (let i = 0; i < 50 && stored === null; i++) {
          stored = await readFile(s, `/browser/files/${FILE_NAME}`);
          if (stored === null) await until(s, () => false, 100);
        }
        expect(stored === null ? null : latin1(stored)).toBe(FILE_TEXT);
      } finally {
        s.app.dispose();
      }
    });

    it('a PC breakpoint set in the listing stops the run there; Run goes on to the halt; Execute clears it', async () => {
      const s = await startApplication();
      try {
        await s.app.ctx.vfs.writeFile('/browser/bp/tutorial1.X68', exampleBytes('tutorial1.X68'));
        await openDocument(s, '/browser/bp/tutorial1.X68');
        let { close } = await assemble(s);
        await execute(s, close, '/browser/bp/tutorial1.S68');
        const listing = s.app.ctx.sim.listing;
        // The LEA of the third line's text: D1 and D2 have been printed, D3 not yet.
        const row = listing.rows.findIndex((text) => /\blea\s+textD3,a1/i.test(text));
        const address = listing.addressOf(row) ?? Number.NaN;
        const model = simMainOf(s.app.ctx);
        model.toggleBreakpoint(row);
        expect(model.view.getState().breakpoints.has(address)).toBe(true);
        const first = await runProgram(s);
        expect(first.end).toBe('stopped');
        expect(hex(s.app.ctx.sim.engine.getRegister(Reg.PC))).toBe(hex(address));
        expect(s.app.ctx.store.getState().sim.selectedRow).toBe(row);
        expect(outputText(s)).toEqual(['D1 contains: 8', 'D2 contains: 520']);
        const second = await runProgram(s);
        expect(second.end).toBe('halted');
        expect(outputText(s)).toEqual(['D1 contains: 8', 'D2 contains: 520', 'D3 contains: 68020', 'Program End']);
        // Execute starts a new simulator: no breakpoint survives it (4.7.1).
        await s.app.ctx.commands.run('app.mode.set', 'editor');
        ({ close } = await assemble(s));
        await execute(s, close, '/browser/bp/tutorial1.S68');
        expect([...simMainOf(s.app.ctx).view.getState().breakpoints]).toEqual([]);
        expect((await runProgram(s)).end).toBe('halted');
      } finally {
        s.app.dispose();
      }
    });

    it('find and replace before assembling: Replace All changes what the program prints', async () => {
      const s = await startApplication();
      try {
        await writeText(s, '/browser/replace/numbers.X68', crlf(REPLACE_PROGRAM));
        await openDocument(s, '/browser/replace/numbers.X68');
        let { close } = await assemble(s);
        await execute(s, close, '/browser/replace/numbers.S68');
        await runProgram(s);
        expect(outputText(s)).toEqual([REPLACE_BEFORE]);
        await s.app.ctx.commands.run('app.mode.set', 'editor');
        const model = findModelOf(s.app.ctx);
        model.setReplace({ text: REPLACE_FIND, replacement: REPLACE_WITH, wholeWord: false, matchCase: false });
        const replaced = model.replace(true);
        await until(s, () => boxes(s).length > 0, 2000);
        const shown = boxes(s);
        while (boxes(s).length > 0) answer(s, MESSAGE_DIALOG_ID, 'OK');
        await replaced;
        expect(shown.length).toBeLessThanOrEqual(1);
        const id = s.app.ctx.store.getState().documents.activeId as string;
        expect(s.app.ctx.documents.text(id).split(REPLACE_WITH).length - 1).toBe(2);
        ({ close } = await assemble(s));
        await execute(s, close, '/browser/replace/numbers.S68');
        await runProgram(s);
        expect(outputText(s)).toEqual([REPLACE_AFTER]);
      } finally {
        s.app.dispose();
      }
    });

    it('a program with an error: the message names the line, Execute is off; the corrected program runs', async () => {
      const s = await startApplication();
      try {
        await writeText(s, '/browser/err/broken.X68', crlf(ERROR_PROGRAM));
        const doc = await openDocument(s, '/browser/err/broken.X68');
        let { status, close } = await assemble(s);
        expect([status.errors, status.executeEnabled]).toEqual([1, false]);
        await close('close');
        const messages = s.app.ctx.store.getState().messages[doc.id] ?? [];
        expect(messages.map((message) => [message.line, message.text])).toEqual([[ERROR_LINE, ERROR_TEXT]]);
        editLine(s, doc.id, ERROR_LINE, CORRECTED_LINE);
        ({ status, close } = await assemble(s));
        expect([status.errors, status.executeEnabled]).toEqual([0, true]);
        expect(s.app.ctx.store.getState().messages[doc.id] ?? []).toEqual([]);
        await execute(s, close, '/browser/err/broken.S68');
        expect((await runProgram(s)).end).toBe('halted');
        expect(outputText(s)).toEqual(['corrected']);
      } finally {
        s.app.dispose();
      }
    });

    it('a program that includes a file from the same folder of the store', async () => {
      const s = await startApplication();
      try {
        await writeText(s, '/browser/inc/main.X68', crlf(INCLUDE_MAIN));
        await writeText(s, '/browser/inc/strings.X68', crlf(INCLUDE_LIB));
        await openDocument(s, '/browser/inc/main.X68');
        const { status, close } = await assemble(s);
        expect([status.errors, status.warnings]).toEqual([0, 0]);
        await execute(s, close, '/browser/inc/main.S68');
        expect((await runProgram(s)).end).toBe('halted');
        expect(outputText(s)).toEqual([INCLUDE_OUTPUT]);
      } finally {
        s.app.dispose();
      }
    });
  },
);
