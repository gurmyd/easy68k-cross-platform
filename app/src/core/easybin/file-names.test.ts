// The files of package B1 must survive a checkout on every system. Owner: B1.
//
// Windows cannot create or open a file whose name before the first dot is a reserved device name
// (CON, PRN, AUX, NUL, COM1-COM9, LPT1-LPT9, with any extension), and a case-insensitive file
// system cannot hold two names that differ only in letter case. A fixture once called `nul.S68`
// could not be committed for that reason (it is `zero-byte.S68` now).
//
// The fixtures are compared byte for byte, so git must store them unconverted: the root
// .gitattributes turns CR LF into LF below /app/, and fixtures/.gitattributes switches that off.

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const core = fileURLToPath(new URL('.', import.meta.url));
const feature = fileURLToPath(new URL('../../features/easybin/', import.meta.url));
const fixtures = join(core, 'fixtures');

/** Every file and folder below `root`, as paths relative to it with forward slashes. */
function walk(root: string, prefix = ''): string[] {
  const names: string[] = [];
  for (const name of readdirSync(join(root, prefix))) {
    const rel = prefix ? `${prefix}/${name}` : name;
    names.push(rel);
    if (statSync(join(root, rel)).isDirectory()) names.push(...walk(root, rel));
  }
  return names;
}

const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

/** The names below `root` that Windows reserves, or that collide with another in letter case. */
function badNames(paths: readonly string[]): string[] {
  const bad: string[] = [];
  const seen = new Map<string, string>();
  for (const path of paths) {
    const base = path.slice(path.lastIndexOf('/') + 1);
    if (RESERVED.test(base) || /[ .]$/.test(base)) bad.push(`${path}: reserved on Windows`);
    const folded = path.toLowerCase();
    const other = seen.get(folded);
    if (other !== undefined) bad.push(`${path}: differs from ${other} only in letter case`);
    else seen.set(folded, path);
  }
  return bad;
}

describe('B1 file names and attributes', () => {
  it('the rule recognises reserved and colliding names', () => {
    expect(badNames(['nul.S68', 'a/Com1', 'lpt9.txt.bak', 'aux', 'x.', 'ok.S68', 'OK.s68'])).toEqual([
      'nul.S68: reserved on Windows',
      'a/Com1: reserved on Windows',
      'lpt9.txt.bak: reserved on Windows',
      'aux: reserved on Windows',
      'x.: reserved on Windows',
      'OK.s68: differs from ok.S68 only in letter case',
    ]);
    expect(badNames(['zero-byte.S68', 'null.S68', 'console.ts', 'com10', 'nul-byte'])).toEqual([]);
  });

  it('no file of core/easybin or features/easybin has a name Windows cannot hold', () => {
    expect(badNames(walk(core))).toEqual([]);
    expect(badNames(walk(feature))).toEqual([]);
  });

  it('git stores every fixture unconverted (text unset)', (context) => {
    let output: string;
    try {
      const files = readdirSync(fixtures).filter((name) => name !== '.gitattributes');
      output = execFileSync('git', ['check-attr', 'text', '--', ...files], {
        cwd: fixtures,
        encoding: 'utf8',
      });
    } catch {
      context.skip(); // no git, or not a work tree (for example a source archive)
      return;
    }
    const lines = output.trim().split(/\r?\n/);
    expect(lines.length).toBeGreaterThan(40);
    expect(lines.filter((line) => !line.endsWith(': text: unset'))).toEqual([]);
  }, 30_000);
});
