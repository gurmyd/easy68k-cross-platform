// What the page loads under app:// in the production build (6.7, 7.6, docs/ENGINE-BINDING.md
// 2.4): both engines start, a font atlas and a help page load, every file of the build is served,
// Range requests are answered; the help window shows a page.
//
// Owner: DV2.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { expect, test } from '@playwright/test';
import { enginesAvailable, launchDesktop, mainHook, windowIdOf, type Desktop } from './harness';

let desktop: Desktop;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  desktop = await launchDesktop();
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  await desktop?.close();
});

const dist = () => process.env.EASY68K_APP_DIST as string;

/** Files below a folder of the build, relative to the build, '/' separators. */
function filesBelow(folder: string): string[] {
  const root = join(dist(), folder);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(dist(), path).split('\\').join('/'));
    }
  };
  walk(root);
  return out.sort();
}

test('both engines start under app://', async () => {
  test.skip(!enginesAvailable(), 'engine/dist is missing (npm run build:engines or fetch:engines)');
  const chunk = readdirSync(join(dist(), 'assets')).find((name) => /^engine-[\w-]+\.js$/.test(name));
  expect(chunk, 'the engine binding chunk (app/src/engine/index.ts) in the build').toBeTruthy();
  const result = await desktop.page.evaluate(async (chunkName) => {
    // The page's own engine binding, loaded as the application loads it (lazy import of a chunk).
    const binding = (await import(`./assets/${chunkName}`)) as {
      createAsmEngine(): Promise<{
        assemble(
          main: string,
          files: Map<string, Uint8Array>,
          options: Record<string, unknown>,
          date: Date,
        ): Promise<{
          errorCount: number;
          sRecord: Uint8Array | null;
          listing: Uint8Array | null;
          fatal: string | null;
        }>;
      }>;
      createSimEngine(host: object): Promise<{
        load(s68: Uint8Array, l68?: Uint8Array | null, options?: object): void;
        readWord(address: number): number;
        readLong(address: number): number;
      }>;
      releaseSimEngine(engine: object): void;
    };
    const source = '\tORG\t$1000\r\nSTART\tMOVE.L\t#$12345678,D0\r\n\tSIMHALT\r\n\tEND\tSTART\r\n';
    const asm = await binding.createAsmEngine();
    const assembled = await asm.assemble(
      'prog.X68',
      new Map([['prog.X68', Uint8Array.from(source, (c) => c.charCodeAt(0))]]),
      {
        generateListing: true,
        generateSRecord: true,
        constantsExpanded: false,
        bitFieldInstructions: false,
        crossReference: false,
        macrosExpanded: false,
        structuredExpanded: false,
        showWarnings: true,
        tabType: 0,
        tabSize: 8,
      },
      new Date(2026, 0, 1),
    );
    // A host whose every method answers nothing: the engine then uses its own defaults.
    const host = new Proxy({}, { get: () => () => undefined });
    const sim = await binding.createSimEngine(host);
    let opcode = -1;
    let operand = -1;
    if (assembled.sRecord) {
      sim.load(assembled.sRecord, assembled.listing, { name: 'prog', kind: 'open' });
      opcode = sim.readWord(0x1000);
      operand = sim.readLong(0x1002);
    }
    binding.releaseSimEngine(sim);
    return {
      fatal: assembled.fatal,
      errors: assembled.errorCount,
      sRecord: assembled.sRecord ? new TextDecoder().decode(assembled.sRecord).split('\r\n')[0] : null,
      opcode,
      operand,
    };
  }, chunk as string);
  expect(result.fatal).toBeNull();
  expect(result.errors).toBe(0);
  expect(result.sRecord).toMatch(/^S0/);
  expect(result.opcode).toBe(0x203c); // MOVE.L #imm,D0
  expect(result.operand).toBe(0x12345678);
  expect(desktop.errors).toEqual([]);
});

test('a font atlas loads under app://', async () => {
  // T2's atlases (app/public/fonts, ARCHITECTURE.md 3.3.6): one .bin per face and size under
  // fonts/bitmap and fonts/scalable, described by fonts/metrics.json.
  const fonts = filesBelow('fonts');
  test.skip(fonts.length === 0, 'the build has no fonts/ yet (app/public/fonts is work package T2)');
  const atlas = fonts.find((file) => file.startsWith('fonts/bitmap/') && file.endsWith('.bin'));
  const metrics = fonts.find((file) => file === 'fonts/metrics.json');
  expect(atlas, 'a .bin atlas under fonts/bitmap/').toBeTruthy();
  expect(metrics, 'fonts/metrics.json').toBeTruthy();
  const result = await desktop.page.evaluate(
    async ([atlasPath, metricsPath]) => {
      const response = await fetch(`app://easy68k/${atlasPath}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const metricsResponse = await fetch(`app://easy68k/${metricsPath}`);
      const json: unknown = await metricsResponse.json();
      return {
        status: response.status,
        type: response.headers.get('content-type'),
        length: bytes.length,
        metricsStatus: metricsResponse.status,
        metricsType: metricsResponse.headers.get('content-type'),
        metrics: json !== null && typeof json === 'object',
      };
    },
    [atlas as string, metrics as string] as const,
  );
  expect(result).toMatchObject({
    status: 200,
    type: 'application/octet-stream',
    metricsStatus: 200,
    metricsType: 'application/json; charset=utf-8',
    metrics: true,
  });
  expect(result.length).toBe(statSync(join(dist(), atlas as string)).size);
  expect(result.length).toBeGreaterThan(0);
  expect(desktop.errors).toEqual([]);
});

test('every file of the build is served under app:// (no extension missing from the table)', async () => {
  const files = filesBelow('.');
  expect(files.length).toBeGreaterThan(0);
  // One file per extension (case folded), fetched by the page.
  const byExtension = new Map<string, string>();
  for (const file of files) {
    const extension = extname(file).toLowerCase();
    if (!byExtension.has(extension)) byExtension.set(extension, file);
  }
  const results = await desktop.page.evaluate(
    async (paths) => {
      const out: { path: string; status: number; type: string | null }[] = [];
      for (const path of paths) {
        const response = await fetch(`app://easy68k/${path.split('/').map(encodeURIComponent).join('/')}`, {
          method: 'HEAD',
        });
        out.push({ path, status: response.status, type: response.headers.get('content-type') });
      }
      return out;
    },
    [...byExtension.values()],
  );
  expect(results.filter((result) => result.status !== 200)).toEqual([]);
  const pdf = files.find((file) => file.toLowerCase().endsWith('.pdf'));
  if (pdf) expect(results.find((result) => result.path === pdf)?.type).toBe('application/pdf');
});

test('a Range request is answered with 206 and the part asked for', async () => {
  const result = await desktop.page.evaluate(async () => {
    const whole = new Uint8Array(await (await fetch('app://easy68k/index.html')).arrayBuffer());
    const part = await fetch('app://easy68k/index.html', { headers: { Range: 'bytes=0-9' } });
    const tail = await fetch('app://easy68k/index.html', { headers: { Range: 'bytes=-4' } });
    const beyond = await fetch('app://easy68k/index.html', { headers: { Range: `bytes=${whole.length}-` } });
    const partBytes = new Uint8Array(await part.arrayBuffer());
    const tailBytes = new Uint8Array(await tail.arrayBuffer());
    return {
      size: whole.length,
      status: part.status,
      contentRange: part.headers.get('content-range'),
      acceptRanges: part.headers.get('accept-ranges'),
      partEqual: partBytes.length === 10 && partBytes.every((byte, index) => byte === whole[index]),
      tailStatus: tail.status,
      tailEqual: tailBytes.length === 4 && tailBytes.every((byte, index) => byte === whole[whole.length - 4 + index]),
      beyond: beyond.status,
    };
  });
  expect(result).toEqual({
    size: result.size,
    status: 206,
    contentRange: `bytes 0-9/${result.size}`,
    acceptRanges: 'bytes',
    partEqual: true,
    tailStatus: 206,
    tailEqual: true,
    beyond: 416,
  });
  // The 416 asked for above is the one console error this test may cause.
  const unexpected = desktop.errors.filter((error) => !/\b416\b/.test(error));
  expect(unexpected).toEqual([]);
  desktop.errors.length = 0;
});

test('a help page loads under app:// and in the help window', async () => {
  const pages = filesBelow('help').filter((file) => /\.html?$/i.test(file));
  test.skip(pages.length === 0, 'the build has no help/ pages yet (app/public/help is work package H1)');
  const page = pages[0] as string;
  const inHelp = page.slice('help/'.length);
  const fetched = await desktop.page.evaluate(async (path) => {
    const response = await fetch(`app://easy68k/${path.split('/').map(encodeURIComponent).join('/')}`);
    return {
      status: response.status,
      type: response.headers.get('content-type'),
      length: (await response.text()).length,
    };
  }, page);
  expect(fetched.status).toBe(200);
  expect(fetched.type).toBe('text/html');
  expect(fetched.length).toBeGreaterThan(0);

  const id = await windowIdOf(desktop.app, desktop.page);
  await desktop.page.evaluate((name) => window.easy68kDesktop?.showHelp(name), inHelp);
  await expect
    .poll(() => mainHook<string | null>(desktop.app, 'helpWindowUrl', id), { timeout: 30_000 })
    .toBe(new URL(inHelp.split('/').map(encodeURIComponent).join('/'), 'app://easy68k/help/').toString());
  const helpFacts = await desktop.app.evaluate(async ({ BrowserWindow }) => {
    const help = BrowserWindow.getAllWindows().find(
      (window) => window.getTitle() !== '' && window.webContents.getURL().includes('/help/'),
    );
    if (!help) return null;
    if (help.webContents.isLoading()) {
      await new Promise<void>((done) => help.webContents.once('did-stop-loading', () => done()));
    }
    // getLastWebPreferences() exists at run time but is missing from Electron's type declarations.
    const prefs = (
      help.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> | null }
    ).getLastWebPreferences();
    return {
      javascript: prefs?.['javascript'],
      preload: prefs?.['preload'] ?? null,
      visible: help.isVisible(),
    };
  });
  expect(helpFacts).toEqual({ javascript: false, preload: null, visible: false });
  // A name outside the help folder is refused.
  await desktop.page.evaluate(() => window.easy68kDesktop?.showHelp('../index.html'));
  await desktop.page.waitForTimeout(500);
  expect(await mainHook<string | null>(desktop.app, 'helpWindowUrl', id)).not.toContain('index.html');
});
