// tools/make-font-atlases.mjs gives byte-identical outline atlases on every operating system
// (ARCHITECTURE.md 6.2.3, T2 acceptance): the conformance job runs this on Linux and macOS, the
// developers on Windows. Owner: T2.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { FONTS_DIR, loadScalableIndex } from './fonts';
import { decodeAtlas } from './pix';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

it('make-font-atlases --check: the committed scalable atlases are what the tool produces here', () => {
  const run = spawnSync(process.execPath, ['tools/make-font-atlases.mjs', '--check'], { cwd: repo, encoding: 'utf8' });
  expect(run.stdout + run.stderr).toMatch(/0 differ from app\/public\/fonts\/scalable/);
  expect(run.status).toBe(0);
}, 300_000);

it('every outline atlas keeps the accents: accented capitals differ from their base letters', () => {
  // The substitute fonts are taller than some Windows cells (DejaVu Sans Mono in Lucida Console's);
  // an accent cut off above row 0 makes É look like E (verifier finding, T2 round 1).
  const pairs = [
    [0xc0, 0x41], // À A
    [0xc1, 0x41], // Á A
    [0xc3, 0x41], // Ã A
    [0xc4, 0x41], // Ä A
    [0xc5, 0x41], // Å A
    [0xc9, 0x45], // É E
    [0xcd, 0x49], // Í I
    [0xd1, 0x4e], // Ñ N
    [0xd6, 0x4f], // Ö O
    [0xdc, 0x55], // Ü U
    [0x8a, 0x53], // Š S
  ];
  const failures: string[] = [];
  for (const entry of loadScalableIndex()) {
    const atlas = decodeAtlas(new Uint8Array(readFileSync(FONTS_DIR + entry.file)));
    for (const [accented, base] of pairs) {
      const a = atlas.glyph(accented as number);
      const b = atlas.glyph(base as number);
      let difference = 0;
      for (let i = 0; i < a.length; i++) difference += Math.abs((a[i] as number) - (b[i] as number));
      // An accent is at least one full pixel of ink (coverage 255) that the base letter does not
      // have; the clipped Lucida Console capitals were identical to their base letters.
      if (difference < 255)
        failures.push(`${entry.file}: $${(accented as number).toString(16)} looks like its base letter`);
    }
  }
  expect(failures).toEqual([]);
}, 120_000);
