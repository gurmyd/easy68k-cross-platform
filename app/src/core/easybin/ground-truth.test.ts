// The official assembler's S-records loaded and saved back by the EASyBIN model, against the
// original's code (docs/porting/easybin.md 0.4, 20.1, 20.2). Owner: B1.
//
// The inputs are the official outputs of the corpus (tests/corpus, ARCHITECTURE.md 6.2.2): the tracked
// golden folder tests/conformance/asm/golden, which every machine and CI has, and the git-ignored
// build/golden-local/asm when it exists (the outputs that may not be redistributed).
// fixtures/ground-truth.manifest holds, per distinct file, a hash of its bytes and a hash of the
// transcript the native oracle printed for: reset, loadsrec, digest, savesrec over the loaded range
// (build/B1/ground-truth-manifest2.mjs, a scratch tool). The test runs the same script on the model.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runScript } from './script';

// GOLDEN_TRACKED and GOLDEN_LOCAL of tests/corpus/index.ts (app code does not import from tests/).
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const tracked = join(repo, 'tests/conformance/asm/golden');
const local = join(repo, 'build/golden-local/asm');
const manifestPath = new URL('./fixtures/ground-truth.manifest', import.meta.url);
const sha = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex').slice(0, 16);

/**
 * How many distinct manifest entries the tracked golden folder holds (130 of the 262; the other 132
 * are only in build/golden-local/asm). Pinned, so that a file removed from the corpus or the golden
 * folder is noticed (gate I1 round 3 review). Adding a tracked golden that the manifest knows raises it.
 */
const TRACKED_MANIFEST_FILES = 130;

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

/** The save-back rule of the manifest tool: From = start, To = end + 1 (at most FFFFFF). */
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

/**
 * Runs every distinct file of `files` that the manifest knows; returns how many it checked, the files
 * that differ and the files the manifest does not know (a golden added after the manifest was made:
 * only the native oracle on a Windows machine can add it, so it is reported, not failed).
 */
function compare(files: string[], manifest: Map<string, string>, seen: Set<string>) {
  const mismatches: string[] = [];
  const unknown: string[] = [];
  let checked = 0;
  for (const file of files) {
    const data = new Uint8Array(readFileSync(file));
    const key = sha(data);
    if (seen.has(key)) continue;
    seen.add(key);
    const expected = manifest.get(key);
    if (expected === undefined) {
      unknown.push(file);
      continue;
    }
    checked++;
    const first = runScript('reset\nloadsrec in.S68\n', new Map([['in.S68', data]]));
    const resultLine = first.find((line) => line.startsWith('result ')) ?? '';
    const transcript = runScript(
      `reset\nloadsrec in.S68\ndigest\n${saveLine(resultLine)}\n`,
      new Map([['in.S68', data]]),
    ).filter((line) => !line.startsWith('> '));
    if (expected !== sha(transcript.join('\n'))) mismatches.push(file);
  }
  if (unknown.length) console.log(`not in the manifest (not checked): ${unknown.join(', ')}`);
  return { checked, mismatches };
}

describe('the official assembler outputs of the corpus', () => {
  const manifest = new Map(
    readFileSync(manifestPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' ') as [string, string]),
  );
  const seen = new Set<string>();

  it('every distinct .S68 of the tracked golden folder loads and saves back as the original does', () => {
    const { checked, mismatches } = compare(walk(tracked), manifest, seen);
    expect(checked).toBe(TRACKED_MANIFEST_FILES);
    expect(mismatches).toEqual([]);
  }, 600_000);

  it.skipIf(!existsSync(local))(
    'the same for the local golden folder (build/golden-local/asm)',
    () => {
      // The tracked folder first (a no-op when the test above ran: compare skips what it has seen).
      const first = compare(walk(tracked), manifest, seen);
      const { mismatches } = compare(walk(local), manifest, seen);
      expect([...first.mismatches, ...mismatches]).toEqual([]);
      // With both folders every manifest entry must have been met and compared: a missing one means
      // a file was removed from the corpus or the golden folders (gate I1 round 3 review).
      const neverMet = [...manifest.keys()].filter((key) => !seen.has(key));
      expect(neverMet, `manifest entries never met: ${neverMet.join(', ')}`).toEqual([]);
    },
    600_000,
  );
});
