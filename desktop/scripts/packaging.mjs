// Pure helpers of the macOS packaging (ARCHITECTURE.md 7.6): which fuses the shipped app has, the
// architecture names of the tools, and the order in which an ad-hoc signature is applied. They do
// nothing by themselves; after-pack.mjs runs them, and tests/desktop/packaged/unit.spec.ts tests
// them on any system.
//
// Owner: DV3.

// Imported, not taken as a global: eslint.config.js gives Node's globals only to
// desktop/**/*.{ts,mts} (docs/requests/DV3-eslint-node-globals.md).
import process from 'node:process';

/**
 * The bundle identifier of the macOS app (CFBundleIdentifier; `appId` in electron-builder.yml,
 * which tests/desktop/packaged/unit.spec.ts keeps equal to this). Fixed for good before the first
 * release (docs/porting/errata/DV3.md entry 19): macOS keys the app's preferences file, its saved
 * window state, its caches and the user's "Open With" choices for .X68, .L68 and .S68 by it, so a
 * later change would orphan them. It names neither the repository (renamed once already) nor a
 * person or account, and claims no domain anyone uses.
 */
export const BUNDLE_ID = 'org.easy68k-port.easy68k';

/**
 * The fuses of the shipped app (7.6), by their names in @electron/fuses' FuseV1Options.
 * `true` = Enabled, `false` = Disabled. The first four are the ones 7.6 names. The last two are
 * additions (docs/porting/errata/DV3.md entries 5 and 9): with NODE_OPTIONS honoured,
 * `NODE_OPTIONS=--require x.js` would run any script in the main process, which is what switching
 * RunAsNode off is meant to prevent; and the app loads only app:// (desktop/src/protocol.ts), never
 * file://, so the extra privileges Electron grants file:// pages are of no use to it. Every other
 * fuse keeps Electron's default.
 */
export const SHIPPED_FUSES = Object.freeze({
  RunAsNode: false,
  EnableNodeCliInspectArguments: false,
  OnlyLoadAppFromAsar: true,
  EnableEmbeddedAsarIntegrityValidation: true,
  EnableNodeOptionsEnvironmentVariable: false,
  GrantFileProtocolExtraPrivileges: false,
});

/**
 * The configuration for @electron/fuses' flipFuses() from SHIPPED_FUSES.
 * `resetAdHocDarwinSignature` is off: the whole bundle is signed afterwards (after-pack.mjs), so a
 * signature of the main binary alone would only be thrown away.
 *
 * @param {Record<string, number>} fuseV1Options  the FuseV1Options enum of @electron/fuses
 * @param {string | number} version               FuseVersion.V1 (the string "1")
 */
export function fuseConfig(fuseV1Options, version) {
  /** @type {Record<string | number, unknown>} */
  const config = { version, resetAdHocDarwinSignature: false };
  for (const [name, on] of Object.entries(SHIPPED_FUSES)) {
    const index = fuseV1Options[name];
    if (typeof index !== 'number') throw new Error(`@electron/fuses has no fuse named ${name}`);
    config[index] = on;
  }
  return config;
}

/**
 * The name of electron-builder's `Arch` enum value (builder-util: ia32 = 0, x64 = 1, armv7l = 2,
 * arm64 = 3, universal = 4), which the afterPack context carries as a number.
 *
 * @param {number} arch
 */
export function builderArchName(arch) {
  const name = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][arch];
  if (name === undefined) throw new Error(`unknown electron-builder architecture ${arch}`);
  return name;
}

/**
 * The architecture name of `lipo` and `file` for an electron-builder architecture name.
 * Only the two architectures that are shipped (1.1); a universal build is not one of them.
 *
 * @param {string} builderArch  'arm64' or 'x64' (electron-builder's Arch names)
 */
export function machArch(builderArch) {
  if (builderArch === 'arm64') return 'arm64';
  if (builderArch === 'x64') return 'x86_64';
  throw new Error(`only arm64 and x64 apps are built (1.1), not ${builderArch}`);
}

/**
 * The architectures `lipo -archs <file>` printed, in its order ("x86_64 arm64").
 *
 * @param {string} stdout
 */
export function parseLipoArchs(stdout) {
  return stdout.trim().split(/\s+/).filter(Boolean);
}

/**
 * Where `lipo -thin` writes the reduced copy of a .node file before it replaces the original: a
 * new name in the same folder (so that the rename is atomic), which does not end in .node.
 * lipo is not documented to accept its input file as its output file.
 *
 * @param {string} path  the .node file
 */
export function thinOutputPath(path) {
  return `${path}.thin-${process.pid}.tmp`;
}

/**
 * A macOS version as LSMinimumSystemVersion and `otool -l` write it ("12.0", "13", "10.15.7"),
 * as numbers; an error for anything else.
 *
 * @param {string} text
 * @returns {number[]}
 */
export function parseMacOSVersion(text) {
  if (!/^\d+(?:\.\d+){0,2}$/.test(text)) throw new Error(`not a macOS version: "${text}"`);
  return text.split('.').map(Number);
}

/**
 * Negative, zero or positive as macOS version `a` is lower than, equal to or higher than `b`
 * ("12" equals "12.0").
 *
 * @param {string} a
 * @param {string} b
 */
export function compareMacOSVersions(a, b) {
  const x = parseMacOSVersion(a);
  const y = parseMacOSVersion(b);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * A macOS version as the release notes name it: trailing ".0" parts dropped ("12.0" -> "12",
 * "13.5" -> "13.5").
 *
 * @param {string} version
 */
export function macOSName(version) {
  const parts = parseMacOSVersion(version);
  while (parts.length > 1 && parts[parts.length - 1] === 0) parts.pop();
  return parts.join('.');
}

/** The first four bytes of a Mach-O file or a fat (universal) binary, both byte orders. */
const MACHO_MAGICS = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);

/**
 * True if the bytes start like a Mach-O file or a fat binary. (0xCAFEBABE is also the start of a
 * Java class file; an Electron bundle holds none.)
 *
 * @param {Uint8Array} head  at least the first four bytes of the file
 */
export function isMachO(head) {
  if (head.length < 4) return false;
  const magic = ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0;
  return MACHO_MAGICS.has(magic);
}

/**
 * Whether after-pack.mjs signs the app ad hoc. It does unless a signing identity was configured
 * (`mac.identity`, given on the command line by release.yml when the optional Developer ID secrets
 * exist, section 11): electron-builder then signs with it after the afterPack step, with the
 * hardened runtime, and notarises.
 *
 * @param {unknown} identity  the `mac.identity` of the configuration
 */
export function signsAdHoc(identity) {
  return identity === null || identity === undefined || identity === '-' || identity === '';
}

/** Depth of a relative path ("a/b/c" = 3). */
function depth(path) {
  return path.split('/').length;
}

/** Deepest first, then by name, so that nested code is signed before what contains it. */
function deepestFirst(a, b) {
  return depth(b) - depth(a) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * The order of the ad-hoc signature (7.6): "first every .node and .dylib, then the helpers and
 * frameworks, then the app". Nested code must be signed before the bundle that contains it, or the
 * outer signature seals a stale inner one and `codesign --verify --deep --strict` fails.
 *
 * `files` are the regular files of the bundle (no symbolic links), relative to the .app folder,
 * with '/' separators ("Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/
 * libEGL.dylib"). `isCode(path)` tells whether a file is Mach-O code (isMachO on its first bytes).
 *
 * Returns the paths to sign, relative to the .app folder, in order; the last is "." (the app):
 *   1. every .node and .dylib file;
 *   2. every other Mach-O file that is not the main executable of a bundle: loose helper
 *      executables such as chrome_crashpad_handler and ShipIt;
 *   3. the frameworks, then the helper apps (Contents/Frameworks/*.framework, *.app), each signed
 *      as a bundle, which seals the main executable inside it;
 *   4. the app itself.
 *
 * @param {readonly string[]} files
 * @param {(path: string) => boolean} isCode
 * @returns {string[]}
 */
export function adHocSigningOrder(files, isCode) {
  /** Bundles directly below Contents/Frameworks, as "Contents/Frameworks/X.framework". */
  const bundleOf = (path) => {
    const match = /^(Contents\/Frameworks\/[^/]+\.(?:framework|app))\//.exec(path);
    return match ? match[1] : null;
  };
  /** True for the file a bundle names as its executable, which signing the bundle covers. */
  const isBundleMain = (path) => {
    if (/^Contents\/MacOS\/[^/]+$/.test(path)) return true; // the app's own executable
    const app = /^Contents\/Frameworks\/([^/]+)\.app\/Contents\/MacOS\/([^/]+)$/.exec(path);
    if (app) return true;
    const framework = /^Contents\/Frameworks\/([^/]+)\.framework\/Versions\/[^/]+\/([^/]+)$/.exec(path);
    return framework !== null && framework[1] === framework[2];
  };

  const libraries = [];
  const loose = [];
  const frameworks = new Set();
  const helpers = new Set();
  for (const path of files) {
    const bundle = bundleOf(path);
    if (bundle?.endsWith('.framework')) frameworks.add(bundle);
    else if (bundle?.endsWith('.app')) helpers.add(bundle);
    if (/\.(?:node|dylib)$/.test(path)) libraries.push(path);
    else if (!isBundleMain(path) && isCode(path)) loose.push(path);
  }
  return [
    ...libraries.sort(deepestFirst),
    ...loose.sort(deepestFirst),
    ...[...frameworks].sort(),
    ...[...helpers].sort(),
    '.',
  ];
}
