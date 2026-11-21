// The official assembler's S-records (build/ground-truth/asm, git-ignored, not redistributable) loaded
// and saved back by the EASyBIN model, against the original's code (docs/porting/easybin.md 0.4,
// 20.1, 20.2). Owner: B1.
//
// fixtures/ground-truth.manifest holds, per distinct file, a hash of its bytes and a hash of the
// transcript the native oracle printed for: reset, loadsrec, digest, savesrec over the loaded range.
// The test runs the same script on the model. Without build/ground-truth/asm (CI) it is skipped: the
// files cannot be shipped, and nothing but hashes was taken from them.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runScript } from './script';

const root = fileURLToPath(new URL('../../../../build/ground-truth/asm', import.meta.url));
const manifestPath = fileURLToPath(new URL('./fixtures/ground-truth.manifest', import.meta.url));
const sha = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex').slice(0, 16);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    // The outputs made from one third-party project's sources are left out: this package does not
    // use that project in any way (task rule).
    else if (/\.S68$/i.test(name) && !/easy68k-qt/i.test(path)) out.push(path);
  }
  return out;
}

/** The save-back rule of build/B1/ground-truth-manifest.mjs: From = start, To = end + 1 (at most FFFFFF). */
function saveLine(resultLine: string): string {
  const m = /^result (\d) start=([0-9A-F]{8}) end=([0-9A-F]{8})/.exec(resultLine);
  const ok = m !== null && m[1] === '1';
  const start = ok ? parseInt(m[2] as string, 16) : 0;
  const end = ok ? parseInt(m[3] as string, 16) : 0;
  const hex = (v: number, d: number) => v.toString(16).toUpperCase().padStart(d, '0');
  const inRange = ok && start <= 0xffffff;
  const from = inRange ? start : 0;
  const to = inRange ? Math.min(end + 1, 0xffffff) : 0;
  return `savesrec out.S68 ${hex(from, 6)} ${hex(to, 6)} ${hex(start >>> 0, 8)} Yes`;
}

describe.skipIf(!existsSync(root))('the official assembler outputs (build/ground-truth/asm)', () => {
  it('every distinct .S68 loads and saves back as the original does', () => {
    const manifest = new Map(
      readFileSync(manifestPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split(' ') as [string, string]),
    );
    const files = walk(root);
    expect(files.length).toBeGreaterThan(300);
    const seen = new Set<string>();
    const mismatches: string[] = [];
    for (const file of files) {
      const data = new Uint8Array(readFileSync(file));
      const key = sha(data);
      if (seen.has(key)) continue;
      seen.add(key);
      const first = runScript('reset\nloadsrec in.S68\n', new Map([['in.S68', data]]));
      const resultLine = first.find((line) => line.startsWith('result ')) ?? '';
      const transcript = runScript(
        `reset\nloadsrec in.S68\ndigest\n${saveLine(resultLine)}\n`,
        new Map([['in.S68', data]]),
      ).filter((line) => !line.startsWith('> '));
      if (manifest.get(key) !== sha(transcript.join('\n'))) mismatches.push(file);
    }
    expect(seen.size).toBe(manifest.size);
    expect(mismatches).toEqual([]);
  }, 600_000);
});
