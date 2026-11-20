// Runs a test case through a native twin (build/asm-native/<kind>/ez68k-asm.exe).
// Used by tools/snapshot.mjs (to produce expected.mjs) and native.test.mjs.
//
// Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OPTIONS, decodeCp1252 } from '../../asm68k.mjs';
import { src, TIME } from '../helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(here, '..', '..', '..', '..');
export const nativeExe = (kind) => join(repo, 'build', 'asm-native', kind, 'ez68k-asm.exe');

const FLAG_ORDER = ['generateListing', 'generateSRecord', 'constantsExpanded', 'bitFieldInstructions',
  'crossReference', 'macrosExpanded', 'structuredExpanded', 'showWarnings'];

/** All (case, variant) runs: [{ key, c, options }]. */
export function expandCases(cases) {
  const out = [];
  for (const c of cases) {
    const variants = c.variants ?? [{}];
    variants.forEach((v, k) => out.push({ key: `${c.group}/${c.name}#${k}`, c, options: { ...(c.options ?? {}), ...v } }));
  }
  return out;
}

/**
 * @param {'patched'|'unpatched'} kind
 * @param {{ key: string, c: any, options: any }} run
 * @param {string} workDir scratch folder for this run
 * @returns {{ listing: Uint8Array|null, sRecord: Uint8Array|null, meta: any, exitCode: number }}
 */
export function runNative(kind, run, workDir) {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const { c, options } = run;
  const mainName = c.mainName ?? 'prog.X68';
  const entries = [...Object.entries(c.files ?? {}), [mainName, c.main]];
  const manifest = entries.map(([name, content], k) => {
    const disk = join(workDir, `in${k}.bin`);
    writeFileSync(disk, content instanceof Uint8Array ? content : src(content));
    return `${name}\t${disk}`;
  });
  writeFileSync(join(workDir, 'manifest.txt'), manifest.join('\n') + '\n', 'latin1');
  const o = { ...DEFAULT_OPTIONS, ...options };
  const digits = FLAG_ORDER.map((k) => (o[k] ? '1' : '0')).join('');
  const tabType = o.tabType === 'assembly' || o.tabType === 0 ? 0 : 1;
  const l68 = join(workDir, 'out.L68'), s68 = join(workDir, 'out.S68'), json = join(workDir, 'out.json');
  const r = spawnSync(nativeExe(kind), ['--manifest', join(workDir, 'manifest.txt'), '--main', mainName,
    '--options', digits, '--tabs', `${tabType},${o.tabSize}`,
    '--time', [TIME.year, TIME.month, TIME.day, TIME.hour, TIME.minute, TIME.second].join(','),
    '--l68', l68, '--s68', s68, '--json', json], { encoding: 'latin1', windowsHide: true });
  const meta = existsSync(json) ? JSON.parse(readFileSync(json, 'latin1')) : null;
  return {
    exitCode: r.status ?? -1,
    listing: existsSync(l68) ? new Uint8Array(readFileSync(l68)) : null,
    sRecord: existsSync(s68) ? new Uint8Array(readFileSync(s68)) : null,
    meta,
  };
}

/** The comparable form of a result (from asm68k.mjs or from runNative). */
export function summarize(result) {
  const lines = (b) => (b ? decodeCp1252(b).split('\r\n') : null);
  if (result.meta !== undefined) {
    const m = result.meta || { messages: [], errorCount: -1, warningCount: -1 };
    return {
      listing: lines(result.listing),
      s68: lines(result.sRecord),
      msgs: m.messages.map((x) => [x.line, x.code, decodeCp1252(Uint8Array.from(x.text, (ch) => ch.charCodeAt(0))),
        x.file ? decodeCp1252(Uint8Array.from(x.file, (ch) => ch.charCodeAt(0))) : null]),
      errors: m.errorCount,
      warnings: m.warningCount,
    };
  }
  return {
    listing: lines(result.listing),
    s68: lines(result.sRecord),
    msgs: result.messages.map((x) => [x.line, x.code, x.text, x.file]),
    errors: result.errorCount,
    warnings: result.warningCount,
  };
}
