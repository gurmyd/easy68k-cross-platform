// Check 1 of ARCHITECTURE.md 6.7, on the built bundle without starting it: the signature, the
// contents, the architectures and the fuses.
//
// Owner: DV3.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { expect, test } from '@playwright/test';
import { compareMacOSVersions, parseMacOSVersion, SHIPPED_FUSES } from '../../../desktop/scripts/packaging.mjs';
import { machArchOf, minosFromOtool, parseCodesignDisplay, parseFusesRead } from './facts';
import { IS_MAC, NOT_MAC, OUT_DIR, REPO, requirePackagedApp, rootVersion, tool, type PackagedApp } from './harness';

test.describe.configure({ mode: 'serial' });

let packaged: PackagedApp;

test.beforeAll(() => {
  test.skip(!IS_MAC, NOT_MAC);
  packaged = requirePackagedApp();
});

/** Regular files below a folder, relative to it with '/' separators. */
function filesBelow(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Info.plist of a bundle as JSON (plutil). */
function infoPlist(app: string): Record<string, unknown> {
  const result = tool('plutil', ['-convert', 'json', '-o', '-', join(app, 'Contents', 'Info.plist')]);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

test('codesign --verify --deep --strict passes and the signature is ad hoc', () => {
  const verify = tool('codesign', ['--verify', '--deep', '--strict', '--verbose=2', packaged.app]);
  console.log(`codesign --verify --deep --strict:\n${verify.stderr.trim()}`);
  expect(verify.status, verify.stderr).toBe(0);

  const display = tool('codesign', ['--display', '--verbose=4', packaged.app]);
  expect(display.status, display.stderr).toBe(0);
  const signature = parseCodesignDisplay(display.stderr);
  console.log(`codesign --display: ${JSON.stringify(signature)}`);
  expect(signature.identifier).toBe('io.github.easy68k-mac.app');
  if (packaged.signature === 'adhoc') {
    expect(signature.signature).toBe('adhoc');
    expect(signature.flags).toMatch(/adhoc/);
    // 7.6: the hardened runtime is not enabled for the ad-hoc signature.
    expect(signature.flags).not.toMatch(/runtime/);
    expect(signature.authorities).toEqual([]);
    expect(signature.teamIdentifier).toBe('not set');
  } else {
    expect(signature.authorities.some((name) => name.startsWith('Developer ID Application:'))).toBe(true);
    expect(signature.flags).toMatch(/runtime/);
  }
});

test('every .node file, helper and framework carries a valid signature of its own', () => {
  const nested = [
    ...filesBelow(packaged.app)
      .filter((path) => path.endsWith('.node') || path.endsWith('.dylib'))
      .map((path) => join(packaged.app, path)),
    ...readdirSync(join(packaged.app, 'Contents', 'Frameworks'))
      .filter((name) => name.endsWith('.app') || name.endsWith('.framework'))
      .map((name) => join(packaged.app, 'Contents', 'Frameworks', name)),
  ];
  expect(nested.length).toBeGreaterThan(4);
  const unsigned = nested.filter((path) => tool('codesign', ['--verify', '--strict', path]).status !== 0);
  expect(unsigned, 'items whose own signature does not verify').toEqual([]);
});

test('the bundle contains both engines, the help, the fonts and the examples', () => {
  const dist = packaged.appDist;
  expect(existsSync(join(dist, 'index.html')), `${dist}/index.html`).toBe(true);

  // The six engine files of the production build (docs/ENGINE-BINDING.md 2): API module, loader
  // and WebAssembly of each engine, under content-hashed names in assets/.
  const assets = readdirSync(join(dist, 'assets'));
  for (const engine of ['asm68k', 'sim68k']) {
    expect(
      assets.filter((name) => new RegExp(`^${engine}-[\\w-]+\\.wasm$`).test(name)),
      `${engine}.wasm`,
    ).toHaveLength(1);
    expect(
      assets.filter((name) => new RegExp(`^${engine}-loader-[\\w-]+\\.mjs$`).test(name)),
      `${engine}-loader`,
    ).toHaveLength(1);
    expect(
      assets.filter((name) => new RegExp(`^${engine}-(?!loader-)[\\w-]+\\.mjs$`).test(name)),
      `${engine}.mjs`,
    ).toHaveLength(1);
  }
  for (const wasm of assets.filter((name) => name.endsWith('.wasm'))) {
    const head = readFileSync(join(dist, 'assets', wasm)).subarray(0, 4);
    expect([...head], `${wasm} starts with \\0asm`).toEqual([0x00, 0x61, 0x73, 0x6d]);
  }

  // Help, fonts and examples: every file the repository ships in app/public, byte for byte.
  for (const folder of ['help', 'fonts', 'examples']) {
    const shipped = filesBelow(join(REPO, 'app', 'public', folder));
    expect(shipped.length, `app/public/${folder} in the checkout`).toBeGreaterThan(0);
    const missing = shipped.filter((path) => !existsSync(join(dist, folder, path)));
    expect(missing, `files of app/public/${folder} missing in the bundle`).toEqual([]);
    const different = shipped.filter(
      (path) => sha256(join(dist, folder, path)) !== sha256(join(REPO, 'app', 'public', folder, path)),
    );
    expect(different, `files of app/public/${folder} that differ in the bundle`).toEqual([]);
    console.log(`${folder}: ${shipped.length} files, all present and equal`);
  }
  expect(existsSync(join(dist, 'examples', 'tutorial1.X68'))).toBe(true);
});

test('the archive, its integrity hash, the file types and the version are in the bundle', () => {
  expect(existsSync(join(packaged.resources, 'app.asar'))).toBe(true);
  // OnlyLoadAppFromAsar: no loose app folder with a package.json the app could load instead.
  expect(existsSync(join(packaged.resources, 'app', 'package.json'))).toBe(false);
  const info = infoPlist(packaged.app);
  expect(info['CFBundleIdentifier']).toBe('io.github.easy68k-mac.app');
  expect(info['CFBundleName']).toBe('EASy68K');
  expect(info['CFBundleShortVersionString']).toBe(rootVersion());
  const integrity = info['ElectronAsarIntegrity'] as Record<string, { algorithm: string; hash: string }> | undefined;
  expect(integrity?.['Resources/app.asar']?.algorithm).toBe('SHA256');
  expect(integrity?.['Resources/app.asar']?.hash).toMatch(/^[0-9a-f]{64}$/);
  const types = (info['CFBundleDocumentTypes'] as { CFBundleTypeExtensions?: string[] }[] | undefined) ?? [];
  const extensions = types.flatMap((type) => type.CFBundleTypeExtensions ?? []);
  for (const extension of ['X68', 'L68', 'S68'])
    expect(extensions, `file type ${extension} (5.7)`).toContain(extension);
});

/** The Electron zip electron-builder unpacked for this build, in @electron/get's cache, or null. */
function stockElectronZip(arch: string): string | null {
  const version = (
    JSON.parse(readFileSync(join(REPO, 'node_modules', 'electron', 'package.json'), 'utf8')) as {
      version: string;
    }
  ).version;
  const name = `electron-v${version}-darwin-${arch}.zip`;
  const cache = process.env.electron_config_cache ?? join(homedir(), 'Library', 'Caches', 'electron');
  if (!existsSync(cache)) return null;
  const found = readdirSync(cache, { recursive: true, withFileTypes: true }).find(
    (entry) => entry.isFile() && entry.name === name,
  );
  return found ? join(found.parentPath, found.name) : null;
}

test("the minimum macOS is Electron's own and no lower than the binaries need", () => {
  // electron-builder.yml sets no minimumSystemVersion, so the app must admit exactly the systems
  // the Electron in use admits (docs/porting/errata/DV3.md entry 10); release.yml prints the same
  // value into the release notes.
  const minimum = infoPlist(packaged.app)['LSMinimumSystemVersion'];
  expect(typeof minimum, 'LSMinimumSystemVersion').toBe('string');
  parseMacOSVersion(minimum as string);

  // Never lower than what the loader requires of the main binary and of Electron Framework.
  const framework = join(
    packaged.app,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Electron Framework',
  );
  for (const binary of [packaged.executable, framework]) {
    const otool = tool('otool', ['-l', binary]);
    expect(otool.status, otool.stderr).toBe(0);
    const minos = minosFromOtool(otool.stdout);
    console.log(`${relative(packaged.app, binary)}: minos ${minos}`);
    expect(minos, `minos of ${binary}`).not.toBeNull();
    expect(
      compareMacOSVersions(minimum as string, minos as string),
      `LSMinimumSystemVersion ${String(minimum)} admits systems below the minos ${minos} of ${binary}`,
    ).toBeGreaterThanOrEqual(0);
  }

  // Equal to the Info.plist of the unmodified Electron.app electron-builder started from.
  const zip = stockElectronZip(packaged.arch);
  if (zip === null) {
    console.log("Electron's download is not in the cache; LSMinimumSystemVersion compared with the binaries only");
  } else {
    const into = join(OUT_DIR, `electron-${packaged.arch}`);
    mkdirSync(into, { recursive: true });
    const unzip = tool('unzip', ['-o', '-q', zip, 'Electron.app/Contents/Info.plist', '-d', into]);
    expect(unzip.status, unzip.stderr).toBe(0);
    const stockPlist = join(into, 'Electron.app', 'Contents', 'Info.plist');
    const stock = tool('plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', '-o', '-', stockPlist]);
    expect(stock.status, stock.stderr).toBe(0);
    console.log(`LSMinimumSystemVersion: app ${String(minimum)}, Electron ${stock.stdout.trim()} (${zip})`);
    expect(minimum).toBe(stock.stdout.trim());
  }
});

test('the main binary and every .node file have the expected architecture', () => {
  const expected = machArchOf(packaged.arch);
  const archsOf = (path: string) => {
    const result = tool('lipo', ['-archs', path]);
    expect(result.status, `lipo -archs ${path}: ${result.stderr}`).toBe(0);
    return result.stdout.trim().split(/\s+/);
  };
  expect(archsOf(packaged.executable), 'Contents/MacOS/EASy68K').toEqual([expected]);

  const nodeFiles = filesBelow(packaged.app).filter((path) => path.endsWith('.node'));
  // 7.6: serialport's native module is in the app, unpacked from the archive.
  expect(nodeFiles.length, '.node files in the bundle').toBeGreaterThan(0);
  for (const path of nodeFiles) {
    expect(path, `${path} lies outside the archive`).toMatch(/^Contents\/Resources\/app\.asar\.unpacked\//);
    expect(archsOf(join(packaged.app, path)), path).toEqual([expected]);
  }
  console.log(`architecture ${expected}: main binary and ${nodeFiles.length} .node file(s): ${nodeFiles.join(', ')}`);
});

test('npx @electron/fuses read shows the fuses of 7.6', () => {
  const result = tool('npx', ['--no', '@electron/fuses', 'read', '--app', packaged.app]);
  console.log(result.stdout.trim());
  expect(result.status, result.stderr).toBe(0);
  const fuses = parseFusesRead(result.stdout);
  const expected = Object.fromEntries(
    Object.entries(SHIPPED_FUSES).map(([name, on]) => [name, on ? 'Enabled' : 'Disabled']),
  );
  expect(fuses).toMatchObject(expected);
});
