// Tests of tools/fetch-site-examples.mjs (the checks it makes on an archive) and of the list it
// works from, tests/corpus/site-examples.json. Nothing here uses the network.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { archiveFileName, installArchive, loadSiteIndex, verifyArchive } from '../../tools/fetch-site-examples.mjs';
import { makeZip } from '../oracle/wine/common/make-zip.ts';
import { sha256Hex } from './index.ts';

const scratch = mkdtempSync(join(tmpdir(), 'easy68k-fetch-site-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SOURCE = '    ORG $1000\r\nSTART SIMHALT\r\n    END START\r\n';
const WAVE = new Uint8Array([82, 73, 70, 70, 0, 1, 2, 3]);
const zip = makeZip([
  { name: 'Game/', data: '' },
  { name: 'Game/game.X68', data: SOURCE },
  { name: 'Game/sound.wav', data: WAVE, method: 0 },
]);
const archive = {
  category: 'games',
  name: 'game',
  url: 'http://www.easy68k.com/examples/game.zip',
  sha256: sha256Hex(zip),
  bytes: zip.length,
  files: [
    { path: 'Game/game.X68', sha256: sha256Hex(Buffer.from(SOURCE, 'latin1')), bytes: SOURCE.length },
    { path: 'Game/sound.wav', sha256: sha256Hex(WAVE), bytes: WAVE.length },
  ],
};

describe('verifyArchive', () => {
  it('returns the files of an archive that is exactly what the list says', () => {
    expect(verifyArchive(archive, zip).map((file) => file.path)).toEqual(['Game/game.X68', 'Game/sound.wav']);
  });

  it('refuses an archive with another hash', () => {
    const other = makeZip([{ name: 'Game/game.X68', data: `${SOURCE}* changed\r\n` }]);
    expect(() => verifyArchive(archive, other)).toThrow(/game: the archive has SHA-256 [0-9a-f]{64}, the list says/);
    expect(() => verifyArchive(archive, Buffer.from('<html>404</html>'))).toThrow(/SHA-256/);
  });

  it('refuses a file the list does not name, a missing file and a changed file', () => {
    const listed = (files) => ({ ...archive, files });
    expect(() => verifyArchive(listed(archive.files.slice(0, 1)), zip)).toThrow(/holds Game\/sound\.wav, which the list does not name/);
    const extra = { path: 'Game/readme.txt', sha256: sha256Hex(Buffer.from('x')), bytes: 1 };
    expect(() => verifyArchive(listed([...archive.files, extra]), zip)).toThrow(/lacks Game\/readme\.txt/);
    const wrong = [{ ...archive.files[0], sha256: sha256Hex(Buffer.from('y')) }, archive.files[1]];
    expect(() => verifyArchive(listed(wrong), zip)).toThrow(/Game\/game\.X68 does not have the listed SHA-256/);
  });
});

describe('installArchive', () => {
  it('unpacks into <out>/site/<category>/<name>/ and replaces what was there', () => {
    const target = join(scratch, 'site', 'games', 'game');
    expect(installArchive(archive, zip, scratch)).toBe(2);
    expect(readFileSync(join(target, 'Game', 'game.X68'), 'latin1')).toBe(SOURCE);
    expect(new Uint8Array(readFileSync(join(target, 'Game', 'sound.wav')))).toEqual(WAVE);
    writeFileSync(join(target, 'stale.txt'), 'left over from an earlier run');
    installArchive(archive, zip, scratch);
    expect(existsSync(join(target, 'stale.txt'))).toBe(false);
  });

  it('writes nothing when the archive does not check out', () => {
    const out = join(scratch, 'refused');
    expect(() => installArchive({ ...archive, sha256: '0'.repeat(64) }, zip, out)).toThrow();
    expect(existsSync(out)).toBe(false);
  });
});

describe('tests/corpus/site-examples.json', () => {
  const index = loadSiteIndex();

  it('lists the 77 archives that unpack, with 134 .X68 files (ground-truth §3.2)', () => {
    expect(index.archives).toHaveLength(77);
    const sources = index.archives.flatMap((item) => item.files.filter((file) => /\.x68$/i.test(file.path)));
    expect(sources).toHaveLength(134);
    expect(index.skipped.map((item) => item.name)).toEqual(['dragonballz', 'Cpp to 68K']);
  });

  it('holds addresses and hashes only: no file content', () => {
    for (const item of index.archives) {
      expect(Object.keys(item).filter((key) => key !== 'mirrors'), item.name).toEqual(['category', 'name', 'url', 'sha256', 'bytes', 'files']);
      expect(item.url, item.name).toMatch(/^https?:\/\//);
      expect(item.sha256, item.name).toMatch(/^[0-9a-f]{64}$/);
      for (const file of item.files) {
        expect(Object.keys(file), `${item.name}: ${file.path}`).toEqual(['path', 'sha256', 'bytes']);
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it('gives every archive its own folder and a file name', () => {
    const folders = index.archives.map((item) => `${item.category}/${item.name}`);
    expect(new Set(folders).size).toBe(folders.length);
    expect(archiveFileName(index.archives.find((item) => item.name === 'tutorial4'))).toBe('tutorial4.zip');
    expect(archiveFileName({ url: 'http://www.easy68k.com/examples/Cpp%20to%2068K.pdf' })).toBe('Cpp to 68K.pdf');
  });
});
