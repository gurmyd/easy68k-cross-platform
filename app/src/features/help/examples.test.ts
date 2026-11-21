import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FileDialogs, OpenRequest, SaveRequest } from '../../contracts';
import { panelVisible } from '../../state/panels';
import { createFakePlatform, createTestApplication } from '../../state/testing';
import { showExamples } from './commands';
import { copyExamples, loadExampleList, type ExampleFetch } from './examples';
import { feature } from './index';

const PUBLIC = new URL('../../../public/', import.meta.url);
const EXAMPLES = new URL('examples/', PUBLIC);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', EXAMPLES), 'utf8')) as {
  files: { name: string; size: number }[];
};

/** A fetch that answers from app/public, as the web server does. */
const publicFetch: ExampleFetch = async (url) => {
  const path = decodeURIComponent(new URL(url).pathname.slice(1));
  const file = new URL(path, PUBLIC);
  if (!existsSync(file))
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  const bytes = readFileSync(file);
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(bytes.toString('utf8')),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
};

describe('the shipped examples', { timeout: 60_000 }, () => {
  it('are the ten official programs and six sounds, nothing else', () => {
    const names = manifest.files.map((file) => file.name);
    expect(names.filter((name) => /\.x68$/i.test(name))).toEqual([
      'MACRO.X68',
      'clockDigital.X68',
      'clockWithSound.X68',
      'fileio.X68',
      'graphicSound.X68',
      'mouseWindowSize.X68',
      'tutorial1.X68',
      'tutorial2.X68',
      'tutorial3.X68',
      'tutorial4.X68',
    ]);
    expect(names.filter((name) => /\.wav$/i.test(name))).toEqual([
      '0.wav',
      '1.wav',
      'chime.wav',
      'roger.wav',
      'tick.wav',
      'tock.wav',
    ]);
    expect(names.length).toBe(16);
    expect(
      readdirSync(EXAMPLES)
        .filter((name) => name !== 'manifest.json')
        .sort(),
    ).toEqual([...names].sort());
    for (const file of manifest.files)
      expect(readFileSync(new URL(file.name, EXAMPLES)).length, file.name).toBe(file.size);
  });

  it('keep the original bytes: Windows-1252 text, CR LF line ends', () => {
    const source = readFileSync(new URL('tutorial1.X68', EXAMPLES));
    expect(source.includes(0x0d)).toBe(true);
    expect(
      source
        .toString('latin1')
        .split('\n')
        .every((line, i, all) => i === all.length - 1 || line.endsWith('\r')),
    ).toBe(true);
  });

  it('hold nothing from reference/examples/site: only official files are published', () => {
    const everything = (dir: URL, prefix = ''): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? everything(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`)
          : [`${prefix}${entry.name}`],
      );
    const published = everything(PUBLIC);
    // No folder of the web site's collections (these names are the site's own), and no folder of
    // the third-party Qt port, anywhere below app/public.
    const foreign =
      /(^|\/)(_downloads|_pages|applications|codeLibrary|games|graphics|hardware|simulations|tutorials|site|github|easy68k-qt)(\/|$)/i;
    // (Only the top two levels: the help's own folders have names like SIMHELP/IMAGES/Hardware.)
    const topLevels = published.map((path) => path.split('/').slice(0, 2).join('/'));
    expect(topLevels.filter((path) => foreign.test(path))).toEqual([]);
    // Every file of examples/ is a file of the official distribution, byte for byte. (The web site
    // repeats some official programs, so equal bytes alone would prove nothing about where a file
    // came from; the import script reads the official folder only.)
    const official = new URL('../../../../reference/examples/official/Examples/', import.meta.url);
    if (!existsSync(official)) return; // reference material is not part of a source archive
    const hash = (file: URL) => createHash('sha1').update(readFileSync(file)).digest('hex');
    const officialHashes = new Map(readdirSync(official).map((name) => [name, hash(new URL(name, official))]));
    for (const file of manifest.files) {
      expect(officialHashes.get(file.name), file.name).toBe(hash(new URL(file.name, EXAMPLES)));
    }
    expect(officialHashes.size).toBe(manifest.files.length);
  });
});

describe('copying the examples', { timeout: 60_000 }, () => {
  it('copies byte for byte into the browser store, once, and shows the Files panel', async () => {
    const app = createTestApplication({ features: [feature] });
    await showExamples(app.ctx, publicFetch);
    expect(panelVisible(app.ctx, 'files')).toBe(true);
    const list = await app.ctx.vfs.list('/browser/Examples');
    expect(list.map((entry) => entry.name).sort()).toEqual(manifest.files.map((file) => file.name).sort());
    for (const file of manifest.files) {
      const copy = await app.ctx.vfs.readFile(`/browser/Examples/${file.name}`);
      expect(Buffer.from(copy).equals(readFileSync(new URL(file.name, EXAMPLES))), file.name).toBe(true);
    }
    // A folder the user has is not overwritten.
    await app.ctx.vfs.writeFile('/browser/Examples/fileio.X68', new TextEncoder().encode('mine'));
    await showExamples(app.ctx, publicFetch);
    expect(new TextDecoder().decode(await app.ctx.vfs.readFile('/browser/Examples/fileio.X68'))).toBe('mine');
  }, 30_000);

  it('tells the user when the examples cannot be read', async () => {
    const app = createTestApplication({ features: [feature] });
    const missing: ExampleFetch = async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    void showExamples(app.ctx, missing);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const stack = app.ctx.store.getState().dialogs.stack;
    expect(stack.map((dialog) => dialog.id)).toEqual(['message']);
    expect(JSON.stringify(stack[0]!.props)).toContain('HTTP 404');
  });

  it('desktop: copies into the chosen folder and shows the Open dialog there', async () => {
    const saves: SaveRequest[] = [];
    const opens: OpenRequest[] = [];
    const dialogs: FileDialogs = {
      save: async (request) => (saves.push(request), '/browser/Chosen/Examples'),
      open: async (request) => (opens.push(request), ['/browser/Chosen/Examples/tutorial1.X68']),
      registerProvider: () => () => {},
    };
    const app = createTestApplication({
      features: [feature],
      platform: createFakePlatform({ kind: 'desktop' }),
      services: { createFileDialogs: () => dialogs },
    });
    await showExamples(app.ctx, publicFetch);
    expect(saves).toHaveLength(1);
    expect((await app.ctx.vfs.list('/browser/Chosen/Examples')).length).toBe(16);
    expect(opens).toHaveLength(1);
    expect(opens[0]!.startDir).toBe('/browser/Chosen/Examples');
    expect(opens[0]!.filters.map((filter) => filter.patterns)).toEqual([
      ['*.X68'],
      ['*.ASM', '*.M68'],
      ['*.L68'],
      ['*.S68'],
      ['*.*'],
    ]);
    expect(panelVisible(app.ctx, 'files')).toBe(false);
  }, 30_000);

  it('desktop: Cancel copies nothing', async () => {
    const dialogs: FileDialogs = { save: async () => null, open: async () => null, registerProvider: () => () => {} };
    const app = createTestApplication({
      features: [feature],
      platform: createFakePlatform({ kind: 'desktop' }),
      services: { createFileDialogs: () => dialogs },
    });
    await showExamples(app.ctx, publicFetch);
    expect(await app.ctx.vfs.stat('/browser/Examples')).toBeNull();
  });

  it('lists the files through the manifest', async () => {
    expect((await loadExampleList('http://localhost/', publicFetch)).length).toBe(16);
    const written: string[] = [];
    await copyExamples(
      { writeFile: async (path) => void written.push(path) },
      '/x',
      manifest.files.slice(0, 2),
      'http://localhost/',
      publicFetch,
    );
    expect(written).toEqual(['/x/0.wav', '/x/1.wav']);
  });
});
