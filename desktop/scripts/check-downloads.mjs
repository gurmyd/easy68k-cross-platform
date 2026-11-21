#!/usr/bin/env node
// Checks the two downloads of one architecture, the .zip and the .dmg, as a person gets them
// (ARCHITECTURE.md 6.7 check 1, 7.4). release.yml runs it on the macOS runner right after
// `npm run desktop:dist`:
//
//   node desktop/scripts/check-downloads.mjs <release folder> <version> <arm64|x64> <tested .app>
//
// For each download it unpacks the app the way macOS does (ditto for the .zip, a read-only mount
// for the .dmg) and requires:
//   - `codesign --verify --deep --strict` passes on the unpacked app;
//   - its code directory hash (CDHash) equals the one of the .app the packaged-app checks start,
//     so the downloads carry exactly the bundle that was tested (the CDHash seals the main
//     binary, Info.plist and, through CodeResources, every other file);
//   - the .dmg also holds the link to /Applications that the install steps tell people to use.
// It then marks a copy as downloaded by a browser (the com.apple.quarantine attribute) and prints
// what Gatekeeper's assessment (`spctl --assess`) and `syspolicy_check distribution` say about
// it. That is information for the first-start text of docs/differences/DV3.md, not a pass or fail:
// an ad-hoc signed, not notarised app is expected to be rejected.
//
// Owner: DV3.

import { execFileSync, spawnSync } from 'node:child_process';
import console from 'node:console';
import { existsSync, lstatSync, mkdtempSync, readlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { releaseFiles } from './release.mjs';

/** Runs a tool; returns its status and both outputs (never throws for a non-zero status). */
function run(file, args) {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 300_000, maxBuffer: 64 << 20 });
  if (result.error) throw new Error(`${file} ${args.join(' ')} could not run: ${result.error.message}`);
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** The CDHash `codesign --display --verbose=4` prints for a bundle. */
export function cdHashOf(displayText) {
  return /^CDHash=([0-9a-f]+)$/m.exec(displayText)?.[1] ?? null;
}

function cdHash(app) {
  const shown = run('codesign', ['--display', '--verbose=4', app]);
  if (shown.status !== 0) throw new Error(`codesign --display ${app}: ${shown.stderr.trim()}`);
  const hash = cdHashOf(shown.stderr);
  if (hash === null) throw new Error(`codesign --display ${app} printed no CDHash:\n${shown.stderr}`);
  return hash;
}

/** The checks every unpacked app must pass; returns the problems. */
function checkApp(label, app, expectedHash) {
  const problems = [];
  if (!existsSync(join(app, 'Contents', 'Info.plist'))) return [`${label}: no EASy68K.app inside`];
  const verify = run('codesign', ['--verify', '--deep', '--strict', app]);
  console.log(`${label}: codesign --verify --deep --strict: ${verify.status === 0 ? 'valid' : verify.stderr.trim()}`);
  if (verify.status !== 0) problems.push(`${label}: the signature does not verify`);
  const hash = cdHash(app);
  console.log(`${label}: CDHash ${hash}${hash === expectedHash ? ' (the tested bundle)' : ''}`);
  if (hash !== expectedHash) problems.push(`${label}: CDHash ${hash} is not the tested bundle's ${expectedHash}`);
  return problems;
}

/** What Gatekeeper says about a quarantined copy of the app (printed only). */
function gatekeeperReport(label, app) {
  // The attribute a browser sets on a download ("0083" = quarantined, downloaded; time; agent).
  const stamp = Math.floor(Date.now() / 1000).toString(16);
  const marked = run('xattr', ['-w', 'com.apple.quarantine', `0083;${stamp};Safari;`, app]);
  if (marked.status !== 0) console.log(`${label}: xattr -w com.apple.quarantine failed: ${marked.stderr.trim()}`);
  const assess = run('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
  console.log(
    `${label}: spctl --assess --type execute (quarantined copy): exit ${assess.status}\n` +
      `${(assess.stdout + assess.stderr).trim()}`,
  );
  const check = run('syspolicy_check', ['distribution', app]);
  console.log(
    `${label}: syspolicy_check distribution: exit ${check.status}\n${(check.stdout + check.stderr).trim().slice(0, 4000)}`,
  );
}

function main(argv) {
  const [folder, version, arch, tested] = argv;
  if (!folder || !version || (arch !== 'arm64' && arch !== 'x64') || !tested) {
    throw new Error('usage: check-downloads.mjs <release folder> <version> <arm64|x64> <tested .app>');
  }
  const expectedHash = cdHash(tested);
  console.log(`tested bundle ${tested}: CDHash ${expectedHash}`);
  const names = releaseFiles(version).filter((name) => name.includes(`-${arch}`));
  const zip = names.find((name) => name.endsWith('.zip'));
  const dmg = names.find((name) => name.endsWith('.dmg'));
  const problems = [];
  const scratch = mkdtempSync(join(tmpdir(), `easy68k-downloads-${arch}-`));
  try {
    for (const name of [zip, dmg]) {
      const path = join(folder, name ?? '');
      if (!name || !existsSync(path)) problems.push(`missing: ${path}`);
      else console.log(`${name}: ${lstatSync(path).size} bytes`);
    }
    if (problems.length) throw new Error(problems.join('\n'));

    // The .zip, unpacked as Finder's Archive Utility does (ditto keeps links and attributes).
    const unzipped = join(scratch, 'zip');
    execFileSync('ditto', ['-x', '-k', join(folder, zip), unzipped]);
    const zipApp = join(unzipped, 'EASy68K.app');
    problems.push(...checkApp(zip, zipApp, expectedHash));

    // The .dmg, mounted read-only and without showing it in Finder.
    const mount = join(scratch, 'dmg');
    const attach = run('hdiutil', ['attach', join(folder, dmg), '-readonly', '-nobrowse', '-mountpoint', mount]);
    if (attach.status !== 0) {
      problems.push(`${dmg}: hdiutil attach failed: ${attach.stderr.trim()}`);
    } else {
      try {
        problems.push(...checkApp(dmg, join(mount, 'EASy68K.app'), expectedHash));
        const link = join(mount, 'Applications');
        const target = existsSync(link) && lstatSync(link).isSymbolicLink() ? readlinkSync(link) : null;
        console.log(`${dmg}: Applications -> ${target}`);
        if (target !== '/Applications') problems.push(`${dmg}: no link to /Applications next to the app`);
      } finally {
        const detach = run('hdiutil', ['detach', mount, '-force']);
        if (detach.status !== 0) console.log(`hdiutil detach: ${detach.stderr.trim()}`);
      }
    }

    gatekeeperReport(zip, zipApp);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (problems.length) throw new Error(problems.join('\n'));
  console.log(`${zip} and ${dmg}: both hold the tested, validly signed bundle`);
}

if (process.argv[1] && /check-downloads\.mjs$/.test(process.argv[1])) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`check-downloads: ${/** @type {Error} */ (error).message}`);
    process.exit(1);
  }
}
