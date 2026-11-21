// The corpus manifest against the files it describes (ARCHITECTURE.md 6.3): every tracked program is
// listed with the hash of its bytes, every golden file has the hash the manifest states, and nothing
// that may not be redistributed is in the repository.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalHashes } from '../conformance/asm/compare';
import {
  GOLDEN_TRACKED,
  REPO,
  SET_DIRECTORIES,
  goldenDirectory,
  loadManifest,
  programAvailable,
  readProgram,
  sha256Hex,
  sourceFlags,
  sourcePath,
  type CorpusProgram,
} from './index';

interface SiteIndex {
  archives: { category: string; name: string; url: string; mirrors?: string[]; sha256: string; files: { path: string; sha256: string }[] }[];
  skipped: { name: string; reason: string }[];
}

const manifest = loadManifest();
const siteIndex = JSON.parse(readFileSync(join(REPO, 'tests', 'corpus', 'site-examples.json'), 'utf8')) as SiteIndex;
const tracked = manifest.programs.filter((program) => program.set !== 'site');
const read = (path: string): Uint8Array => new Uint8Array(readFileSync(path));

function filesBelow(directory: string, prefix = ''): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    return entry.isDirectory() ? filesBelow(join(directory, entry.name), name) : [name];
  });
}

describe('tests/corpus/manifest.json', () => {
  it('has unique ids, in order', () => {
    const ids = manifest.programs.map((program) => program.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('describes every tracked program as it is on disk', () => {
    for (const program of tracked) {
      expect(programAvailable(program), program.id).toBe(true);
      const source = read(sourcePath(program));
      expect(sha256Hex(source), program.id).toBe(program.sha256);
      expect(source.length, program.id).toBe(program.bytes);
      for (const flag of sourceFlags(source)) expect(program.flags, program.id).toContain(flag);
    }
  });

  it('lists every .X68 of the tracked example sets', () => {
    for (const set of ['official', 'github-mit'] as const) {
      const onDisk = filesBelow(join(REPO, SET_DIRECTORIES[set])).filter((name) => /\.x68$/i.test(name));
      const listed = manifest.programs.filter((program) => program.set === set).map((program) => program.file);
      expect([...listed].sort(), set).toEqual([...onDisk].sort());
    }
  });

  it('carries the licence file of each redistributed set', () => {
    expect(existsSync(join(REPO, 'tests/corpus/official/License.txt'))).toBe(true);
    expect(readFileSync(join(REPO, 'tests/corpus/github/pacman-mc68000/LICENSE'), 'utf8')).toContain('MIT License');
    expect(readFileSync(join(REPO, 'tests/corpus/github/68k-assembly-learning/LICENCE'), 'utf8')).toContain('MIT License');
  });

  it('has a result or a reason for every run', () => {
    for (const program of manifest.programs) {
      expect(Object.keys(program.runs).length, program.id).toBeGreaterThan(0);
      for (const [label, run] of Object.entries(program.runs)) {
        const name = `${program.id} (${label})`;
        if (run.status === 'ok') {
          expect(run.l68 !== null || run.s68 !== null, name).toBe(true);
          expect(run.received, name).toMatch(/^[0-9a-f]{64}$/);
        } else {
          expect(run.reason, name).toBeTruthy();
          expect(run.golden, name).toBe(false);
        }
      }
    }
  });

  it('gives a program its files by the names INCLUDE and INCBIN use', () => {
    const main = manifest.programs.find((program) => program.id === 'github/pacman-mc68000/GAME/MAIN.X68') as CorpusProgram;
    const { mainName, files } = readProgram(main);
    expect(mainName).toBe('GAME/MAIN.X68');
    expect(files.has('GAME/GFX.X68')).toBe(true);
    expect(sha256Hex(files.get(mainName) as Uint8Array)).toBe(main.sha256);
  });
});

describe('tests/conformance/asm/golden', () => {
  it('holds, for every run marked golden, files with the hashes of the manifest', { timeout: 120_000 }, () => {
    for (const program of tracked) {
      for (const [label, run] of Object.entries(program.runs)) {
        if (!run.golden) continue;
        const directory = goldenDirectory(program);
        const path = (extension: string): string => join(directory, `${label}.${extension}`);
        const listing = run.l68 === null ? null : read(path('L68'));
        const sRecord = run.s68 === null ? null : read(path('S68'));
        const hashes = canonicalHashes({ listing, sRecord });
        expect({ l68: hashes.l68, s68: hashes.s68 }, `${program.id} (${label})`).toEqual({ l68: run.l68, s68: run.s68 });
        if (run.receivedFile) expect(sha256Hex(read(path('received.txt'))), program.id).toBe(run.received);
      }
    }
  });

  it('holds no file that the manifest does not name', () => {
    const expected = new Set<string>(['REPORT.md']);
    for (const program of tracked) {
      for (const [label, run] of Object.entries(program.runs)) {
        if (!run.golden) continue;
        if (run.l68 !== null) expected.add(`${program.id}/${label}.L68`);
        if (run.s68 !== null) expected.add(`${program.id}/${label}.S68`);
        if (run.receivedFile) expected.add(`${program.id}/${label}.received.txt`);
      }
    }
    expect(filesBelow(join(REPO, GOLDEN_TRACKED)).filter((name) => !expected.has(name))).toEqual([]);
  });
});

describe('what may not be redistributed stays out of the repository (6.3)', () => {
  const siteHashes = new Set(siteIndex.archives.flatMap((archive) => [archive.sha256, ...archive.files.map((file) => file.sha256)]));
  // A file may be both in a redistributable set and in a site archive (tutorial4.X68 of the site is
  // byte for byte the tutorial4.X68 that ships with EASy68K): its own licence lets it be here.
  const redistributable = new Set(
    ['tests/corpus/official', 'tests/corpus/github'].flatMap((folder) =>
      filesBelow(join(REPO, folder)).map((name) => sha256Hex(read(join(REPO, folder, name)))),
    ),
  );

  it('no tracked file under tests/ is a file of the site set', { timeout: 120_000 }, () => {
    const found: string[] = [];
    for (const folder of ['tests/conformance', 'tests/oracle', 'tests/corpus']) {
      for (const name of filesBelow(join(REPO, folder))) {
        if (name.includes('node_modules/')) continue;
        const bytes = read(join(REPO, folder, name));
        if (bytes.length === 0) continue; // an empty file is nobody's work
        const hash = sha256Hex(bytes);
        if (siteHashes.has(hash) && !redistributable.has(hash)) found.push(`${folder}/${name}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('no golden file is kept for a site program, only hashes', () => {
    for (const program of manifest.programs.filter((candidate) => candidate.set === 'site')) {
      for (const run of Object.values(program.runs)) expect(run.golden, program.id).toBe(false);
      expect(existsSync(goldenDirectory(program, true)), program.id).toBe(false);
    }
  });

  it('the site programs of the manifest are the .X68 files of site-examples.json', () => {
    const listed = siteIndex.archives.flatMap((archive) =>
      archive.files
        .filter((file) => /\.x68$/i.test(file.path))
        .map((file) => [`site/${archive.category}/${archive.name}/${file.path}`, file.sha256] as const),
    );
    const inManifest = manifest.programs
      .filter((program) => program.set === 'site')
      .map((program) => [program.id, program.sha256] as const);
    expect([...inManifest].sort()).toEqual([...listed].sort());
    expect(listed).toHaveLength(134);
  });
});
