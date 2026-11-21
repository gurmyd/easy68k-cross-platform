// electron-builder's afterPack step for the macOS app (ARCHITECTURE.md 7.6). electron-builder calls
// it after it has assembled EASy68K.app (Electron, app.asar, app.asar.unpacked, the web build in
// Resources/app/dist, Info.plist with the ASAR integrity hash) and before it builds the .dmg and
// the .zip. In this order:
//
//   1. Native modules for this architecture only: every .node file is reduced to the architecture
//      being built (`lipo -thin`). serialport ships one N-API binary for both Mac architectures
//      (prebuilds/darwin-x64+arm64), which N-API makes valid for Electron as it is; nothing is
//      compiled. A .node file that does not hold the architecture stops the build.
//   2. The fuses of 7.6 (packaging.mjs SHIPPED_FUSES), on the main binary.
//   3. The ad-hoc signature: every .node and .dylib, then the helper executables, frameworks and
//      helper apps, then the app (`codesign --force --sign -`), without the hardened runtime.
//      Then `codesign --verify --deep --strict`.
//
// Step 3 is skipped when a signing identity is configured (`-c.mac.identity=...`, which release.yml
// passes only when the optional Developer ID secrets exist; section 11): electron-builder then signs
// with that identity right after this step and notarises. electron-builder's own signing is off
// otherwise (`mac.identity: null` in electron-builder.yml), so that nothing signs after the fuses
// but this step.
//
// On Windows and Linux (an unpacked build made only to inspect the archive) nothing is done.
//
// Owner: DV3.

import { execFile } from 'node:child_process';
// console is imported, not taken as a global: eslint.config.js gives Node's globals only to
// desktop/**/*.{ts,mts} (docs/requests/DV3-eslint-node-globals.md).
import console from 'node:console';
import { lstat, open, readdir, rename, rm } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import {
  adHocSigningOrder,
  builderArchName,
  fuseConfig,
  isMachO,
  machArch,
  parseLipoArchs,
  SHIPPED_FUSES,
  signsAdHoc,
  thinOutputPath,
} from './packaging.mjs';

const run = promisify(execFile);

/** Runs a tool and returns its standard output; a failure carries the tool's own error text. */
async function tool(file, args) {
  try {
    const { stdout } = await run(file, args, { maxBuffer: 64 << 20 });
    return stdout;
  } catch (error) {
    const stderr = /** @type {{ stderr?: string }} */ (error).stderr ?? '';
    throw new Error(`${file} ${args.join(' ')} failed: ${stderr.trim() || /** @type {Error} */ (error).message}`, {
      cause: error,
    });
  }
}

/** Every regular file below `root`, relative to it with '/' separators (symbolic links skipped). */
async function regularFiles(root) {
  const out = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue; // directories and symbolic links
    out.push(relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'));
  }
  return out.sort();
}

/** True if the file starts like Mach-O code. */
async function startsLikeMachO(path) {
  const handle = await open(path, 'r');
  try {
    const head = new Uint8Array(4);
    const { bytesRead } = await handle.read(head, 0, 4, 0);
    return bytesRead === 4 && isMachO(head);
  } finally {
    await handle.close();
  }
}

/** Step 1: reduces every .node file to `arch` (a lipo name); returns what it did, for the log. */
async function thinNativeModules(appPath, files, arch) {
  const report = [];
  for (const rel of files.filter((path) => path.endsWith('.node'))) {
    const path = join(appPath, rel);
    const archs = parseLipoArchs(await tool('lipo', ['-archs', path]));
    if (!archs.includes(arch)) {
      throw new Error(`${rel} holds ${archs.join(', ') || 'no Mach-O code'}, not ${arch}`);
    }
    if (archs.length > 1) {
      // lipo is not documented to accept its input as its output: write a new file beside it,
      // check it, then put it in place (rename within one folder replaces the old file atomically).
      const thinned = thinOutputPath(path);
      try {
        await tool('lipo', [path, '-thin', arch, '-output', thinned]);
        const after = parseLipoArchs(await tool('lipo', ['-archs', thinned]));
        if (after.length !== 1 || after[0] !== arch) {
          throw new Error(`lipo -thin ${arch} of ${rel} produced ${after.join(', ') || 'no Mach-O code'}`);
        }
        await rename(thinned, path);
      } finally {
        await rm(thinned, { force: true });
      }
      report.push(`${rel}: ${archs.join(' ')} -> ${arch}`);
    } else {
      report.push(`${rel}: ${arch}`);
    }
  }
  return report;
}

/** Step 2: the fuses of 7.6 on the app's main binary. */
async function setFuses(appPath) {
  const { flipFuses, FuseV1Options, FuseVersion } = await import('@electron/fuses');
  await flipFuses(appPath, /** @type {never} */ (fuseConfig(FuseV1Options, FuseVersion.V1)));
}

/** Step 3: the ad-hoc signature in the order of 7.6, then the strict verification. */
async function signAdHoc(appPath, files) {
  // Extended attributes (Finder information, resource forks) make `codesign --strict` refuse a
  // bundle. A checkout has none; this removes any a tool left. Attributes macOS protects stay,
  // which is why a failure here is only reported.
  await tool('xattr', ['-cr', appPath]).catch((error) => console.log(`  • after-pack: ${error.message}`));
  const code = new Set();
  for (const rel of files) if (await startsLikeMachO(join(appPath, rel))) code.add(rel);
  const order = adHocSigningOrder(files, (rel) => code.has(rel));
  for (const rel of order) {
    const target = rel === '.' ? appPath : join(appPath, rel);
    await tool('codesign', ['--force', '--sign', '-', '--timestamp=none', target]);
  }
  await tool('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  return order.length;
}

/**
 * The afterPack hook (electron-builder calls the default export with its AfterPackContext).
 *
 * @param {{
 *   appOutDir: string,
 *   arch: number,
 *   electronPlatformName: string,
 *   packager: {
 *     appInfo: { productFilename: string },
 *     platformSpecificBuildOptions: { identity?: string | null },
 *   },
 * }} context
 */
export default async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  if (electronPlatformName !== 'darwin') {
    console.log(`  • after-pack: ${electronPlatformName} build, nothing to do (only the macOS app is shipped)`);
    return;
  }
  const arch = machArch(builderArchName(context.arch));
  const appPath = join(appOutDir, `${packager.appInfo.productFilename}.app`);
  await lstat(appPath); // fails clearly if electron-builder put the app elsewhere

  const files = await regularFiles(appPath);
  for (const line of await thinNativeModules(appPath, files, arch))
    console.log(`  • after-pack: native module ${line}`);
  if (!files.some((path) => path.endsWith('.node'))) {
    throw new Error('the app holds no .node file: serialport (7.6) was not packaged');
  }

  await setFuses(appPath);
  console.log(
    `  • after-pack: fuses set: ${Object.entries(SHIPPED_FUSES)
      .map(([name, on]) => `${name} ${on ? 'on' : 'off'}`)
      .join(', ')}`,
  );

  const identity = packager.platformSpecificBuildOptions.identity;
  if (!signsAdHoc(identity)) {
    console.log(`  • after-pack: signing identity "${identity}" configured; electron-builder signs and notarises`);
    return;
  }
  const signed = await signAdHoc(appPath, files);
  console.log(`  • after-pack: signed ad hoc (${signed} items); codesign --verify --deep --strict passed`);
}
