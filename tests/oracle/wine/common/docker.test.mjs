// Tests of the parts of docker.mjs that need no Docker.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { OFFICIAL_FILES, assertOfficialFolder, bind, scriptsInImage } from './docker.mjs';

const WINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'easy68k-docker-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('scriptsInImage', () => {
  const scripts = scriptsInImage(WINE);

  it('reads from the Dockerfile which scripts the image holds, and they all exist', () => {
    expect(scripts).toContain('common/entry.sh');
    expect(scripts).toContain('common/xwin.py');
    expect(scripts).toContain('asm/asm_batch.py');
    expect(scripts).toContain('sim/sim_run.py');
    for (const script of scripts) expect(existsSync(join(WINE, script)), script).toBe(true);
  });

  it('finds no two scripts with the same name: /oracle is one flat folder', () => {
    const names = scripts.map((script) => script.split('/').pop());
    expect(new Set(names).size).toBe(names.length);
  });

  it('the image holds no file of the official distribution', () => {
    for (const script of scripts) expect(script).toMatch(/\.(sh|py)$/);
  });
});

describe('assertOfficialFolder', () => {
  it('says how to get the distribution when the folder does not hold it', () => {
    expect(() => assertOfficialFolder(scratch)).toThrow(/EDIT68K\.exe is missing.*fetch-official\.mjs/s);
  });

  it('refuses a program that is not the v5.16.1 one', () => {
    for (const name of OFFICIAL_FILES) writeFileSync(join(scratch, name), 'not the real file');
    expect(() => assertOfficialFolder(scratch)).toThrow(/EDIT68K\.exe is not the v5\.16\.1 program/);
  });
});

describe('bind', () => {
  it('mounts read-only unless told otherwise, and keeps a path with blanks or a drive letter whole', () => {
    expect(bind('C:\\my files\\official', '/mnt/official')).toEqual([
      '--mount',
      'type=bind,source=C:\\my files\\official,target=/mnt/official,readonly',
    ]);
    expect(bind('/home/me/out', '/mnt/out', false)).toEqual([
      '--mount',
      'type=bind,source=/home/me/out,target=/mnt/out',
    ]);
  });
});
