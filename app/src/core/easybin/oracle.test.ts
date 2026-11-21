// The EASyBIN model against the original's own code (docs/porting/easybin.md 0.4). Owner: B1.
//
// fixtures/<name>.script drives the model through core/easybin/script.ts; fixtures/<name>.expected is
// the transcript the native oracle printed for the same script: the original's loadSrec, loadBinary,
// saveSRecord, saveBinary, finish, CopyClick and FillClick, compiled unchanged with Microsoft C++
// (build/B1/oracle, a scratch tool; see the spec). Messages, return values, memory digests and the
// bytes of every file written must be equal.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runScript } from './script';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const read = (name: string) => readFileSync(`${fixtures}${name}`);

/** Every input file of the fixtures folder, by name (a fresh copy for each script). */
function inputFiles(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const name of readdirSync(fixtures)) {
    if (name.startsWith('.') || /\.(script|expected|manifest|ts|md)$/.test(name)) continue;
    files.set(name, new Uint8Array(read(name)));
  }
  return files;
}

const scripts = readdirSync(fixtures)
  .filter((name) => name.endsWith('.script'))
  .map((name) => name.replace(/\.script$/, ''));

describe('EASyBIN model = the original code (native oracle transcripts)', () => {
  it('has the five scripts', () => {
    expect(scripts.sort()).toEqual(['assembler', 'binary', 'copyfill', 'malformed', 'srecsave']);
  });
  for (const name of scripts) {
    it(
      name,
      () => {
        const expected = read(`${name}.expected`).toString('latin1').split(/\r?\n/);
        if (expected.at(-1) === '') expected.pop();
        const actual = runScript(read(`${name}.script`).toString('utf8'), inputFiles());
        expect(actual).toEqual(expected);
      },
      30_000,
    );
  }
});
