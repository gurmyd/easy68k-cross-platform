// Project "unit" of the packaged-app suite: the logic of the packaging scripts (desktop/scripts),
// of the release workflow and of this harness, without building or starting anything. Runs on
// every system:
//
//     npx playwright test --config tests/desktop/packaged/playwright.config.ts --project unit
//
// Owner: DV3.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  adHocSigningOrder,
  builderArchName,
  fuseConfig,
  isMachO,
  machArch,
  compareMacOSVersions,
  macOSName,
  parseLipoArchs,
  parseMacOSVersion,
  SHIPPED_FUSES,
  signsAdHoc,
  thinOutputPath,
} from '../../../desktop/scripts/packaging.mjs';
import {
  checksumText,
  firstStartSection,
  FIRST_START_BEGIN,
  FIRST_START_END,
  releaseFileProblems,
  releaseFiles,
  releaseNotes,
  releaseVersion,
} from '../../../desktop/scripts/release.mjs';
import {
  cspViolationLines,
  devToolsPortFromLog,
  isMainProcessCommand,
  judgeMinimisedRun,
  machArchOf,
  minosFromOtool,
  parseCodesignDisplay,
  parseDevToolsActivePort,
  parseFusesRead,
  parsePs,
  registerText,
  releaseFolderOf,
  shippedArch,
  srecordStart,
  stripAnsi,
} from './facts';
import { REPO } from './harness';

const read = (...parts: string[]) => readFileSync(join(REPO, ...parts), 'utf8').replace(/\r\n/g, '\n');

test.describe('packaging.mjs', () => {
  test('the shipped fuses are the four of 7.6 plus NODE_OPTIONS and file:// privileges off', () => {
    expect(SHIPPED_FUSES).toEqual({
      RunAsNode: false,
      EnableNodeCliInspectArguments: false,
      OnlyLoadAppFromAsar: true,
      EnableEmbeddedAsarIntegrityValidation: true,
      EnableNodeOptionsEnvironmentVariable: false,
      GrantFileProtocolExtraPrivileges: false,
    });
    // GrantFileProtocolExtraPrivileges off is safe only while the app never loads file:// pages.
    for (const name of ['main.ts', 'security.ts', 'protocol.ts', 'windows.ts']) {
      const path = join(REPO, 'desktop', 'src', name);
      if (existsSync(path)) expect(read('desktop', 'src', name), name).not.toMatch(/loadFile\(|['"`]file:\/\//);
    }
  });

  test('fuseConfig maps the names to the indices of @electron/fuses and keeps the signature alone', async () => {
    const { FuseV1Options, FuseVersion } = await import('@electron/fuses');
    const config = fuseConfig(FuseV1Options as unknown as Record<string, number>, FuseVersion.V1);
    expect(config).toEqual({
      version: FuseVersion.V1,
      resetAdHocDarwinSignature: false,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    });
    expect(() => fuseConfig({}, 1)).toThrow(/no fuse named RunAsNode/);
  });

  test('architecture names', () => {
    expect([0, 1, 2, 3, 4].map(builderArchName)).toEqual(['ia32', 'x64', 'armv7l', 'arm64', 'universal']);
    expect(() => builderArchName(9)).toThrow();
    expect(machArch('arm64')).toBe('arm64');
    expect(machArch('x64')).toBe('x86_64');
    expect(() => machArch('universal')).toThrow(/only arm64 and x64/);
    expect(parseLipoArchs('x86_64 arm64\n')).toEqual(['x86_64', 'arm64']);
    expect(parseLipoArchs('arm64\n')).toEqual(['arm64']);
    expect(parseLipoArchs('')).toEqual([]);
  });

  test('lipo -thin writes a new file beside the .node file, never onto its input', () => {
    const node = '/x/EASy68K.app/Contents/Resources/app.asar.unpacked/a/b.node';
    const out = thinOutputPath(node);
    expect(out).not.toBe(node);
    expect(dirname(out)).toBe(dirname(node));
    expect(out).not.toMatch(/\.node$/);
    const afterPack = read('desktop', 'scripts', 'after-pack.mjs');
    expect(afterPack).toMatch(/'-thin', arch, '-output', thinned\]/);
    expect(afterPack).not.toMatch(/'-output', path\]/);
  });

  test('macOS versions', () => {
    expect(parseMacOSVersion('12.0')).toEqual([12, 0]);
    expect(parseMacOSVersion('10.15.7')).toEqual([10, 15, 7]);
    expect(() => parseMacOSVersion('12.0 ')).toThrow(/not a macOS version/);
    expect(() => parseMacOSVersion('')).toThrow();
    expect(compareMacOSVersions('12', '12.0')).toBe(0);
    expect(compareMacOSVersions('12.0', '13.0')).toBeLessThan(0);
    expect(compareMacOSVersions('13.0', '12.7.6')).toBeGreaterThan(0);
    expect(compareMacOSVersions('10.15', '10.9')).toBeGreaterThan(0);
    expect(macOSName('12.0')).toBe('12');
    expect(macOSName('13.5')).toBe('13.5');
    expect(macOSName('11.0.0')).toBe('11');
  });

  test('isMachO knows thin and fat binaries of both byte orders and nothing else', () => {
    const bytes = (...values: number[]) => Uint8Array.from(values);
    expect(isMachO(bytes(0xcf, 0xfa, 0xed, 0xfe))).toBe(true); // 64-bit, little endian (arm64, x86_64)
    expect(isMachO(bytes(0xce, 0xfa, 0xed, 0xfe))).toBe(true);
    expect(isMachO(bytes(0xfe, 0xed, 0xfa, 0xcf))).toBe(true);
    expect(isMachO(bytes(0xca, 0xfe, 0xba, 0xbe, 0, 0))).toBe(true); // fat
    expect(isMachO(bytes(0x7f, 0x45, 0x4c, 0x46))).toBe(false); // ELF
    expect(isMachO(bytes(0x4d, 0x5a, 0x90, 0x00))).toBe(false); // PE
    expect(isMachO(bytes(0x3c, 0x3f, 0x78, 0x6d))).toBe(false); // "<?xm"
    expect(isMachO(bytes(0xcf, 0xfa))).toBe(false);
  });

  test('signsAdHoc unless a signing identity is configured', () => {
    expect(signsAdHoc(null)).toBe(true);
    expect(signsAdHoc(undefined)).toBe(true);
    expect(signsAdHoc('-')).toBe(true);
    expect(signsAdHoc('')).toBe(true);
    expect(signsAdHoc('Developer ID Application: Someone (ABCDE12345)')).toBe(false);
  });

  test('the ad-hoc signing order: libraries, helper executables, frameworks, helper apps, the app', () => {
    // The regular files of an Electron 45 app as electron-builder lays it out (abridged).
    const F = 'Contents/Frameworks';
    const files = [
      'Contents/Info.plist',
      'Contents/MacOS/EASy68K',
      'Contents/PkgInfo',
      'Contents/Resources/app.asar',
      'Contents/Resources/app.asar.unpacked/node_modules/@serialport/bindings-cpp/prebuilds/darwin-x64+arm64/@serialport+bindings-cpp.node',
      'Contents/Resources/app/dist/index.html',
      'Contents/Resources/icon.icns',
      `${F}/EASy68K Helper (GPU).app/Contents/Info.plist`,
      `${F}/EASy68K Helper (GPU).app/Contents/MacOS/EASy68K Helper (GPU)`,
      `${F}/EASy68K Helper (Renderer).app/Contents/MacOS/EASy68K Helper (Renderer)`,
      `${F}/EASy68K Helper.app/Contents/MacOS/EASy68K Helper`,
      `${F}/Electron Framework.framework/Versions/A/Electron Framework`,
      `${F}/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler`,
      `${F}/Electron Framework.framework/Versions/A/Libraries/libEGL.dylib`,
      `${F}/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib`,
      `${F}/Electron Framework.framework/Versions/A/Resources/Info.plist`,
      `${F}/Mantle.framework/Versions/A/Mantle`,
      `${F}/ReactiveObjC.framework/Versions/A/ReactiveObjC`,
      `${F}/Squirrel.framework/Versions/A/Resources/ShipIt`,
      `${F}/Squirrel.framework/Versions/A/Squirrel`,
    ];
    const code = new Set(
      files.filter((path) => /MacOS\/|Versions\/A\/[^/]+$|Helpers\/|\.dylib$|\.node$|ShipIt$/.test(path)),
    );
    code.delete(`${F}/Electron Framework.framework/Versions/A/Resources/Info.plist`);
    const order = adHocSigningOrder(files, (path) => code.has(path));
    expect(order).toEqual([
      'Contents/Resources/app.asar.unpacked/node_modules/@serialport/bindings-cpp/prebuilds/darwin-x64+arm64/@serialport+bindings-cpp.node',
      `${F}/Electron Framework.framework/Versions/A/Libraries/libEGL.dylib`,
      `${F}/Electron Framework.framework/Versions/A/Libraries/libffmpeg.dylib`,
      `${F}/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler`,
      `${F}/Squirrel.framework/Versions/A/Resources/ShipIt`,
      `${F}/Electron Framework.framework`,
      `${F}/Mantle.framework`,
      `${F}/ReactiveObjC.framework`,
      `${F}/Squirrel.framework`,
      `${F}/EASy68K Helper (GPU).app`,
      `${F}/EASy68K Helper (Renderer).app`,
      `${F}/EASy68K Helper.app`,
      '.',
    ]);
  });
});

test.describe('release.mjs', () => {
  test("the version is the root package.json's, and a tag must name it", () => {
    expect(releaseVersion('0.3.1', 'refs/tags/v0.3.1')).toBe('0.3.1');
    expect(releaseVersion('0.3.1', 'refs/heads/main')).toBe('0.3.1');
    expect(releaseVersion('1.0.0-rc.1', 'refs/tags/v1.0.0-rc.1')).toBe('1.0.0-rc.1');
    expect(() => releaseVersion('0.3.1', 'refs/tags/v0.3.2')).toThrow(/does not match/);
    expect(() => releaseVersion('0.3.1', 'refs/tags/0.3.1')).toThrow(/does not match/);
    expect(() => releaseVersion('banana', 'refs/heads/main')).toThrow(/not X\.Y\.Z/);
  });

  test('the six release files of 7.4', () => {
    expect(releaseFiles('0.3.1')).toEqual([
      'EASy68K-0.3.1-arm64.dmg',
      'EASy68K-0.3.1-x64.dmg',
      'EASy68K-0.3.1-arm64-mac.zip',
      'EASy68K-0.3.1-x64-mac.zip',
      'engine-dist.zip',
      'easy68k-mac-web-0.3.1.zip',
    ]);
    expect(releaseFileProblems([...releaseFiles('1.2.3'), 'SHA256SUMS.txt'], '1.2.3')).toEqual([]);
    expect(releaseFileProblems(['engine-dist.zip', 'EASy68K-1.2.3-arm64.dmg.blockmap'], '1.2.3')).toEqual([
      'missing: EASy68K-1.2.3-arm64.dmg',
      'missing: EASy68K-1.2.3-x64.dmg',
      'missing: EASy68K-1.2.3-arm64-mac.zip',
      'missing: EASy68K-1.2.3-x64-mac.zip',
      'missing: easy68k-mac-web-1.2.3.zip',
      'not a release file: EASy68K-1.2.3-arm64.dmg.blockmap',
    ]);
  });

  test('the names electron-builder gives the app files are the release names', () => {
    const config = read('desktop', 'electron-builder.yml');
    const mac = /\nmac:[\s\S]*?\n {2}artifactName: (\S+)/.exec(config)?.[1];
    const dmg = /\ndmg:[\s\S]*?\n {2}artifactName: (\S+)/.exec(config)?.[1];
    const name = (pattern: string | undefined, arch: string, ext: string) =>
      (pattern ?? '').replaceAll('${version}', '9.8.7').replaceAll('${arch}', arch).replaceAll('${ext}', ext);
    expect([
      name(dmg, 'arm64', 'dmg'),
      name(dmg, 'x64', 'dmg'),
      name(mac, 'arm64', 'zip'),
      name(mac, 'x64', 'zip'),
    ]).toEqual(releaseFiles('9.8.7').slice(0, 4));
  });

  test('SHA256SUMS.txt is in the format of shasum -a 256', () => {
    const a = 'a'.repeat(64);
    const b = '0123456789abcdef'.repeat(4);
    expect(
      checksumText([
        { name: 'z.zip', sha256: a },
        { name: 'EASy68K-1.dmg', sha256: b },
      ]),
    ).toBe(`${b}  EASy68K-1.dmg\n${a}  z.zip\n`);
    expect(() => checksumText([{ name: 'x', sha256: 'ABC' }])).toThrow(/not a SHA-256/);
    expect(() => checksumText([{ name: 'x\ny', sha256: a }])).toThrow(/line break/);
  });

  test('the checksums command checks the folder and writes SHA256SUMS.txt', () => {
    const folder = mkdtempSync(join(tmpdir(), 'easy68k-release-'));
    try {
      const files = releaseFiles('0.0.1');
      for (const [index, name] of files.entries()) writeFileSync(join(folder, name), `file ${index}`);
      const script = join(REPO, 'desktop', 'scripts', 'release.mjs');
      const ok = spawnSync(process.execPath, [script, 'checksums', folder, '0.0.1'], { encoding: 'utf8' });
      expect(ok.status, ok.stderr).toBe(0);
      const expected = checksumText(
        files.map((name, index) => ({ name, sha256: createHash('sha256').update(`file ${index}`).digest('hex') })),
      );
      expect(readFileSync(join(folder, 'SHA256SUMS.txt'), 'utf8')).toBe(expected);
      rmSync(join(folder, files[0] as string));
      const missing = spawnSync(process.execPath, [script, 'checksums', folder, '0.0.1'], { encoding: 'utf8' });
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain('missing: EASy68K-0.0.1-arm64.dmg');
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test('the release notes carry the first-start steps of docs/differences/DV3.md', () => {
    const doc = read('docs', 'differences', 'DV3.md');
    const section = firstStartSection(doc);
    expect(section).toContain('xattr -dr com.apple.quarantine /Applications/EASy68K.app');
    expect(section).toContain('Open Anyway');
    expect(section).toContain('Privacy & Security');
    const notes = releaseNotes('0.4.0', section, '13.0');
    expect(notes).toContain('EASy68K-0.4.0-arm64.dmg');
    expect(notes).toContain('Apple silicon (M1 and later), macOS 13 or later |');
    expect(notes).toContain('Intel processor, macOS 13 or later |');
    expect(notes).not.toContain('macOS 12');
    expect(() => releaseNotes('0.4.0', section, '')).toThrow(/not a macOS version/);
    expect(notes).toContain('easy68k-mac-web-0.4.0.zip');
    expect(notes).toContain(section);
    expect(() => firstStartSection('no marks')).toThrow(/first-start/);
    expect(firstStartSection(`a ${FIRST_START_BEGIN}\n x \n${FIRST_START_END} b`)).toBe('x');
  });
});

test.describe('release.yml', () => {
  const workflow = read('.github', 'workflows', 'release.yml');

  test('starts only on a version tag or by hand', () => {
    const on = /\non:\n([\s\S]*?)\n\S/.exec(workflow)?.[1] ?? '';
    expect(on).toMatch(/^ {2}push:\n {4}tags:\n {6}- 'v\*'/m);
    expect(on).toMatch(/^ {2}workflow_dispatch:/m);
    expect(on).not.toMatch(/branches|pull_request|schedule/);
  });

  test('creates a draft release only, and only the publish job may write', () => {
    expect(workflow).toMatch(/gh release create [^\n]*--draft/);
    expect(workflow).not.toMatch(/gh release edit[^\n]*--draft=false/);
    expect(workflow).not.toMatch(/--latest|make_latest/);
    expect(workflow.match(/contents: write/g)).toHaveLength(1);
    expect(workflow).toMatch(/^permissions:\n {2}contents: read/m);
  });

  test('the notes name the minimum macOS read from the built app', () => {
    expect(workflow).toMatch(
      /plutil -extract LSMinimumSystemVersion raw -o - "\$\{EASY68K_PACKAGED_APP\}\/Contents\/Info\.plist"/,
    );
    expect(workflow).toMatch(/^ {6}minimum_macos: \$\{\{ steps\.minimum\.outputs\.version \}\}$/m);
    expect(workflow).toMatch(/^ {6}MINIMUM_MACOS: \$\{\{ needs\.mac\.outputs\.minimum_macos \}\}$/m);
    expect(workflow).toContain('release.mjs notes "$VERSION" notes.md "$MINIMUM_MACOS"');
  });

  test('pins every action by commit hash', () => {
    const uses = [...workflow.matchAll(/uses: (\S+)/g)].map((match) => match[1] as string);
    expect(uses.length).toBeGreaterThan(5);
    for (const use of uses) {
      if (use.startsWith('./')) continue;
      expect(use, use).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});

test.describe('facts.ts', () => {
  test('architectures and release folders', () => {
    expect(machArchOf('arm64')).toBe('arm64');
    expect(machArchOf('x64')).toBe('x86_64');
    expect(releaseFolderOf('arm64')).toBe('mac-arm64');
    expect(releaseFolderOf('x64')).toBe('mac');
    expect(shippedArch('x86_64')).toBe('x64');
    expect(shippedArch('arm64')).toBe('arm64');
    expect(() => shippedArch('ia32')).toThrow();
  });

  test('the DevTools port from DevToolsActivePort and from the log', () => {
    expect(parseDevToolsActivePort('53781\n/devtools/browser/0b1c-2d\n')).toEqual({
      port: 53781,
      path: '/devtools/browser/0b1c-2d',
    });
    expect(parseDevToolsActivePort('53781\n')).toBeNull();
    expect(parseDevToolsActivePort('')).toBeNull();
    expect(parseDevToolsActivePort('0\n/devtools/browser/x')).toBeNull();
    expect(devToolsPortFromLog('x\nDevTools listening on ws://127.0.0.1:61234/devtools/browser/ab\n')).toBe(61234);
    expect(devToolsPortFromLog('nothing')).toBeNull();
  });

  test('the fuses CLI output, with and without colours', () => {
    const text = [
      'Analyzing app: EASy68K.app',
      'Fuse Version: v1',
      '  \x1b[33mRunAsNode\x1b[39m is \x1b[31mDisabled\x1b[39m',
      '  EnableCookieEncryption is Disabled',
      '  OnlyLoadAppFromAsar is Enabled',
      '  LoadBrowserProcessSpecificV8Snapshot is Removed',
    ].join('\n');
    expect(stripAnsi('\x1b[31mDisabled\x1b[39m')).toBe('Disabled');
    expect(parseFusesRead(text)).toEqual({
      RunAsNode: 'Disabled',
      EnableCookieEncryption: 'Disabled',
      OnlyLoadAppFromAsar: 'Enabled',
      LoadBrowserProcessSpecificV8Snapshot: 'Removed',
    });
  });

  test('codesign --display of an ad-hoc and of a Developer ID signature', () => {
    const adhoc = [
      'Executable=/x/EASy68K.app/Contents/MacOS/EASy68K',
      'Identifier=io.github.easy68k-mac.app',
      'Format=app bundle with Mach-O thin (arm64)',
      'CodeDirectory v=20400 size=520 flags=0x2(adhoc) hashes=5+7 location=embedded',
      'Signature=adhoc',
      'Info.plist entries=24',
      'TeamIdentifier=not set',
    ].join('\n');
    expect(parseCodesignDisplay(adhoc)).toEqual({
      identifier: 'io.github.easy68k-mac.app',
      signature: 'adhoc',
      authorities: [],
      teamIdentifier: 'not set',
      flags: '0x2(adhoc)',
    });
    const signed = [
      'Identifier=io.github.easy68k-mac.app',
      'CodeDirectory v=20500 size=520 flags=0x10000(runtime) hashes=5+7 location=embedded',
      'Authority=Developer ID Application: Someone (ABCDE12345)',
      'Authority=Developer ID Certification Authority',
      'Authority=Apple Root CA',
      'TeamIdentifier=ABCDE12345',
    ].join('\n');
    expect(parseCodesignDisplay(signed)).toMatchObject({
      signature: null,
      authorities: [
        'Developer ID Application: Someone (ABCDE12345)',
        'Developer ID Certification Authority',
        'Apple Root CA',
      ],
      teamIdentifier: 'ABCDE12345',
      flags: '0x10000(runtime)',
    });
  });

  test('the start address of S-record files', () => {
    expect(srecordStart('S00600004844521B\r\nS1071000303C000957\r\nS9031000EC\r\n')).toBe(0x1000);
    expect(srecordStart('S804012345B2\n')).toBe(0x012345);
    expect(srecordStart('S70500100000EA\n')).toBe(0x00100000);
    expect(srecordStart('S1071000303C000957\n')).toBeNull();
    expect(registerText(0x1000)).toBe('00001000');
    expect(registerText(-1)).toBe('FFFFFFFF');
  });

  test('the minimum macOS of a binary from otool -l', () => {
    const otool = [
      '/x/EASy68K:',
      'Load command 8',
      '      cmd LC_BUILD_VERSION',
      '  cmdsize 32',
      ' platform 1',
      '    minos 12.0',
      '      sdk 15.2',
      '   ntools 1',
      'Load command 9',
      '      cmd LC_SOURCE_VERSION',
      '  cmdsize 16',
      '  version 0.0',
    ].join('\n');
    expect(minosFromOtool(otool)).toBe('12.0');
    const old = [
      'Load command 7',
      '      cmd LC_VERSION_MIN_MACOSX',
      '  cmdsize 16',
      '  version 10.15',
      '      sdk 11.0',
    ];
    expect(minosFromOtool(old.join('\n'))).toBe('10.15');
    // A fat file: the highest of the slices.
    expect(minosFromOtool(`${otool}\n${otool.replace('minos 12.0', 'minos 13.0')}`)).toBe('13.0');
    expect(minosFromOtool('Load command 1\n      cmd LC_SOURCE_VERSION\n  version 1.0')).toBeNull();
  });

  test('the main process among the processes of ps', () => {
    const exe = '/x/EASy68K.app/Contents/MacOS/EASy68K';
    const rows = parsePs(
      [
        `  101 ${exe} --remote-debugging-port=5000 --user-data-dir=/tmp/u1 --enable-logging`,
        `  102 /x/EASy68K.app/Contents/Frameworks/EASy68K Helper (Renderer).app/Contents/MacOS/EASy68K Helper (Renderer) --type=renderer --user-data-dir=/tmp/u1`,
        `  103 ${exe} --remote-debugging-port=5001 --user-data-dir=/tmp/u2`,
      ].join('\n'),
    );
    expect(rows.map((row) => row.pid)).toEqual([101, 102, 103]);
    expect(rows.filter((row) => isMainProcessCommand(row.command, exe, '/tmp/u1')).map((row) => row.pid)).toEqual([
      101,
    ]);
  });

  test('violations of the Content Security Policy in a Chromium log', () => {
    const log = [
      // As Electron 45 logs it with --enable-logging (seen on the development build).
      "[50764:1121/112757.472:INFO:CONSOLE:5] \"Executing inline script violates the following Content Security Policy directive 'script-src 'self' 'wasm-unsafe-eval''.\", source:  (5)",
      '[1:2:INFO:CONSOLE(0)] "Refused to load the image because it violates the following Content Security Policy directive"',
      '[1:2:INFO:CONSOLE(0)] "Content Security Policy of your site blocks the use of eval"',
      '[1:2:INFO:CONSOLE(12)] "started", source: app://easy68k/assets/index.js (12)',
      '[1:2:VERBOSE1:network.cc] Content-Security-Policy header sent',
    ].join('\n');
    expect(cspViolationLines(log)).toHaveLength(3);
    expect(cspViolationLines('[1:2:INFO:CONSOLE:2] "hello"')).toEqual([]);
  });

  test('the verdict of a minimised run', () => {
    expect(judgeMinimisedRun({ runAt: 0, minimisedAt: 400, finishedAt: 3100, limitMs: 3500 })).toEqual({
      ok: true,
      elapsedMs: 3100,
      reason: 'finished after 3100 ms',
    });
    expect(judgeMinimisedRun({ runAt: 0, minimisedAt: 400, finishedAt: 3600, limitMs: 3500 }).ok).toBe(false);
    expect(judgeMinimisedRun({ runAt: 0, minimisedAt: null, finishedAt: 3100, limitMs: 3500 }).reason).toMatch(
      /not minimised/,
    );
    expect(judgeMinimisedRun({ runAt: 0, minimisedAt: 3200, finishedAt: 3100, limitMs: 3500 }).ok).toBe(false);
    expect(judgeMinimisedRun({ runAt: 0, minimisedAt: 400, finishedAt: null, limitMs: 3500 }).reason).toMatch(
      /did not finish/,
    );
  });
});

test.describe('electron-builder.yml', () => {
  const config = read('desktop', 'electron-builder.yml');

  test('electron-builder neither signs nor flips fuses itself; the afterPack step does both', () => {
    expect(config).toMatch(/^ {2}identity: null$/m);
    expect(config).toMatch(/^ {2}hardenedRuntime: false$/m);
    expect(config).not.toMatch(/^electronFuses:/m);
    expect(config).toMatch(/^afterPack: \.\/scripts\/after-pack\.mjs$/m);
    expect(existsSync(join(REPO, 'desktop', 'scripts', 'after-pack.mjs'))).toBe(true);
  });

  test('the web build goes where desktop/src/main.ts looks for it, native code is unpacked', () => {
    expect(config).toMatch(/extraResources:\n {2}- from: \.\.\/app\/dist\n {4}to: app\/dist/);
    expect(read('desktop', 'src', 'main.ts')).toContain("join(process.resourcesPath, 'app', 'dist')");
    expect(config).toMatch(/asarUnpack:\n {2}- '\*\*\/\*\.node'/);
    expect(config).toMatch(/^npmRebuild: false$/m);
  });

  test("the minimum macOS is left to Electron's Info.plist", () => {
    expect(config).not.toMatch(/^\s*minimumSystemVersion:/m);
  });

  test('the icon and the three file types exist', () => {
    const icon = /^ {2}icon: (\S+)$/m.exec(config)?.[1] ?? '';
    expect(existsSync(join(REPO, 'desktop', icon)), icon).toBe(true);
    for (const extension of ['X68', 'L68', 'S68'])
      expect(config).toContain(`ext: [${extension}, ${extension.toLowerCase()}]`);
  });
});
