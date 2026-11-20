#!/usr/bin/env node
// easy68k-mac: run-s68.mjs - run an assembled 68000 program without a user
// interface and print what it did.
//
//   node run-s68.mjs program.S68 [program.L68] [options]
//
// If no .L68 is named, the one next to the .S68 is used when it exists (as
// the original does).  Options:
//
//   --no-listing           do not load a listing
//   --input FILE           keyboard script: the bytes of FILE are typed; a line
//                          end (LF or CR LF) is the Enter key
//   --keys TEXT            keyboard script on the command line; \n is Enter
//   --exceptions           Options > Enable Exceptions
//   --bitfield             Options > Enable Bit Field Instructions
//   --file NAME=PATH       put host file PATH into the program's file system as NAME
//   --log TYPE             single-step the whole program (Trace Into) with the
//                          execution log on and print the log; TYPE is 1
//                          (instruction), 2 (+ registers) or 3 (+ memory)
//   --log-mem FROM,BYTES   memory range for --log 3 (hexadecimal)
//   --log-time TEXT        date/time text for the log header
//                          (default "1/1/2000 12:00:00 AM")
//   --max-instructions N   stop after N instructions (default 50000000)
//   --max-ms N             stop after N milliseconds of real time
//   --json                 print one JSON object instead of text
//
// Output (text mode): the message area, the program's text output, the final
// registers in the layout of the execution log, the cycle count, and why the
// run ended:  stopped | input (waiting for keys that the script does not have)
// | budget | time | error.
//
// Exit code: 0 when the run ended with "stopped" or "input", 2 for the other
// reasons, 1 for a usage error.

import { readFileSync, existsSync } from 'node:fs';
import { createSim, Status, Option, Reg, bytesToText } from '../sim68k.mjs';
import { HeadlessHost, drive } from './headless-host.mjs';

function usage(message) {
  if (message) console.error(message);
  console.error('usage: node run-s68.mjs program.S68 [program.L68] [--input FILE] [--keys TEXT] [--exceptions] [--bitfield]');
  console.error('       [--file NAME=PATH] [--log 1|2|3] [--log-mem FROM,BYTES] [--log-time TEXT] [--max-instructions N]');
  console.error('       [--max-ms N] [--no-listing] [--json]');
  process.exit(1);
}

/** The keyboard script of a file: line ends become Enter. @param {Uint8Array} bytes @returns {number[]} */
export function scriptFromFile(bytes) {
  const keys = [];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10) continue;
    keys.push(bytes[i] === 10 ? 13 : bytes[i]);
  }
  return keys;
}

/** Final registers in the layout of the execution log. @param {import('../sim68k.mjs').Sim68k} sim */
export function formatRegisters(sim) {
  const r = sim.registers();
  const h = (v) => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
  const sr = r.sr.toString(2).padStart(16, '0');
  return [
    `D0=${h(r.d[0])} D4=${h(r.d[4])} A0=${h(r.a[0])} A4=${h(r.a[4])}    T_S__INT___XNZVC`,
    `D1=${h(r.d[1])} D5=${h(r.d[5])} A1=${h(r.a[1])} A5=${h(r.a[5])} SR=${sr}`,
    `D2=${h(r.d[2])} D6=${h(r.d[6])} A2=${h(r.a[2])} A6=${h(r.a[6])} US=${h(r.usp)}`,
    `D3=${h(r.d[3])} D7=${h(r.d[7])} A3=${h(r.a[3])} A7=${h(r.a7)} SS=${h(r.ssp)}`,
    `PC=${h(r.pc)}`,
  ].join('\n');
}

/**
 * Single-step until the program halts, needs input that is not there, or a
 * limit is reached.  This is what a user does with Trace Into (F7); only
 * single-stepped instructions appear in the execution log.
 * @returns {{reason: string, status: number}}
 */
export function traceToEnd(sim, host, { maxInstructions = 50_000_000, maxWallMs } = {}) {
  const started = Date.now();
  for (let count = 0; count < maxInstructions; count++) {
    let status = sim.cmdTraceInto();
    while (status !== Status.STOPPED) {
      if (status === Status.WAIT_ALERT) sim.dismissAlert();
      else if (status === Status.WAIT_HOST) {
        const reply = host.dialogReplies.shift() ?? { accepted: false };
        sim.fileDialogReply(reply.accepted, reply.fileName ?? '');
      } else if (status === Status.ERROR || status === Status.BUSY) return { reason: 'error', status };
      status = sim.run(0);
    }
    // In trace mode a keyboard read does not hold the program; the keys are
    // typed while it is paused.
    while (sim.state().inputMode) {
      if (host.keys.length === 0) return { reason: 'input', status };
      sim.keyChar(host.keys.shift());
    }
    if (sim.state().halt) return { reason: 'stopped', status };
    if (maxWallMs !== undefined && (count & 1023) === 0 && Date.now() - started > maxWallMs) return { reason: 'time', status };
  }
  return { reason: 'budget', status: Status.STOPPED };
}

async function main(argv) {
  const positional = [];
  const opt = { files: {}, logTime: '1/1/2000 12:00:00 AM' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => (i + 1 < argv.length ? argv[++i] : usage(`${arg} needs a value`));
    switch (arg) {
      case '--input': opt.input = value(); break;
      case '--keys': opt.keys = value(); break;
      case '--exceptions': opt.exceptions = true; break;
      case '--bitfield': opt.bitfield = true; break;
      case '--no-listing': opt.noListing = true; break;
      case '--json': opt.json = true; break;
      case '--log': opt.log = Number(value()); break;
      case '--log-mem': opt.logMem = value(); break;
      case '--log-time': opt.logTime = value(); break;
      case '--max-instructions': opt.maxInstructions = Number(value()); break;
      case '--max-ms': opt.maxWallMs = Number(value()); break;
      case '--file': {
        const [name, path] = value().split('=');
        if (!path) usage('--file needs NAME=PATH');
        opt.files[name] = new Uint8Array(readFileSync(path));
        break;
      }
      default:
        if (arg.startsWith('--')) usage(`unknown option ${arg}`);
        positional.push(arg);
    }
  }
  if (positional.length < 1 || positional.length > 2) usage();
  const s68Path = positional[0];
  let l68Path = positional[1];
  if (!l68Path && !opt.noListing) {
    const candidate = s68Path.replace(/\.[^.\\/]*$/, '') + '.L68';
    if (existsSync(candidate)) l68Path = candidate;
  }
  if (opt.log !== undefined && ![1, 2, 3].includes(opt.log)) usage('--log needs 1, 2 or 3');

  const host = new HeadlessHost({ files: opt.files });
  if (opt.input) host.type(scriptFromFile(new Uint8Array(readFileSync(opt.input))));
  if (opt.keys) host.type(opt.keys.replace(/\\n/g, '\n'));

  const sim = await createSim(host);
  if (opt.exceptions) sim.setOption(Option.EXCEPTIONS, 1);
  if (opt.bitfield) sim.setOption(Option.BITFIELD, 1);

  const s68 = existsSync(s68Path) ? new Uint8Array(readFileSync(s68Path)) : null;
  const l68 = (l68Path && !opt.noListing) ? new Uint8Array(readFileSync(l68Path)) : null;
  sim.load(s68, l68, { name: s68Path, kind: 'drop' });

  let result;
  if (opt.log !== undefined) {
    sim.setOption(Option.EXEC_LOG_TYPE, opt.log);
    if (opt.logMem) {
      const [from, bytes] = opt.logMem.split(',').map((t) => parseInt(t, 16));
      sim.setOption(Option.LOG_MEM_FROM, from);
      sim.setOption(Option.LOG_MEM_BYTES, bytes);
    }
    sim.startLog(opt.logTime);
    result = traceToEnd(sim, host, opt);
    sim.stopLog();
  } else {
    sim.cmdRun();
    result = drive(sim, host, { maxInstructions: opt.maxInstructions, maxWallMs: opt.maxWallMs });
  }

  const registers = sim.registers();
  if (opt.json) {
    console.log(JSON.stringify({
      reason: result.reason,
      status: result.status,
      output: host.outputText,
      screen: host.screenLines(),
      messages: host.messages,
      alerts: host.alerts,
      registers: { ...registers, cycles: registers.cycles.toString() },
      halt: sim.state().halt,
      steps: sim.stepCount,
      execLog: opt.log !== undefined ? host.execLogText : undefined,
    }));
  } else {
    const out = [];
    out.push('--- messages ---', ...host.messages);
    for (const a of host.alerts) out.push(`[message box "${a.title}"] ${a.text}`);
    out.push('--- output ---', host.outputText);
    out.push('--- registers ---', formatRegisters(sim), `Cycles=${registers.cycles}`);
    out.push(`--- end: ${result.reason} ---`);
    if (opt.log !== undefined) out.push('--- execution log ---', host.execLogText);
    process.stdout.write(out.join('\n') + '\n');
  }
  process.exitCode = (result.reason === 'stopped' || result.reason === 'input') ? 0 : 2;
}

// Run only when started as a program: not when imported by a test, and not
// when "node --test" picks this file up as if it were a test file.
const startedDirectly = process.argv[1]
  && import.meta.url.toLowerCase().endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop().toLowerCase());
if (startedDirectly && !process.env.NODE_TEST_CONTEXT) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exit(2);
  });
}
