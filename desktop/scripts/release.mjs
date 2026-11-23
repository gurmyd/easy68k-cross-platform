#!/usr/bin/env node
// Steps of release.yml that are more than one shell line (ARCHITECTURE.md 7.4, 7.5, section 11).
// Each prints what it decided; each fails with a message that says what to do.
//
//   node desktop/scripts/release.mjs version <GITHUB_REF>
//       Prints the version to release: the root package.json's. On a tag push the tag must be
//       v<that version> (7.5: one version number, in the root package.json).
//   node desktop/scripts/release.mjs notes <version> <out-file> <minimum macOS>
//       Writes the release notes: the download table (with the minimum macOS, the built app's
//       LSMinimumSystemVersion) and the first-start steps for the ad-hoc signed app, taken from
//       docs/differences/DV3.md (section 11: "every release note carries the exact steps").
//   node desktop/scripts/release.mjs checksums <folder> <version>
//       Checks that <folder> holds exactly the six release files of 7.4 for <version> and writes
//       SHA256SUMS.txt next to them, in the format of `shasum -a 256` (`sha256sum -c` reads it).
//   node desktop/scripts/release.mjs verify <folder> <version>
//       Checks that <folder> holds exactly the six files and a SHA256SUMS.txt that lists exactly
//       them with their hashes (the publish job, before anything is uploaded).
//
// The functions are exported for tests/desktop/packaged/unit.spec.ts.
//
// Owner: DV3.

// console and process are imported, not taken as globals: eslint.config.js gives Node's globals
// only to desktop/**/*.{ts,mts} (docs/requests/DV3-eslint-node-globals.md).
import console from 'node:console';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { macOSName } from './packaging.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A semantic version as 7.5 uses it: X.Y.Z with an optional pre-release part. */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * The version to release, from the root package.json's version and the Git ref of the run.
 * A tag ref must be v<version>; any other ref (a manual run on a branch) releases <version>.
 *
 * @param {string} packageVersion  the root package.json's "version"
 * @param {string} ref             GITHUB_REF ("refs/tags/v0.1.0", "refs/heads/main")
 */
export function releaseVersion(packageVersion, ref) {
  if (!SEMVER.test(packageVersion)) {
    throw new Error(`the root package.json's version "${packageVersion}" is not X.Y.Z`);
  }
  const tag = /^refs\/tags\/(.+)$/.exec(ref)?.[1];
  if (tag !== undefined && tag !== `v${packageVersion}`) {
    throw new Error(
      `the tag ${tag} does not match the root package.json's version ${packageVersion}: set "version" to ` +
        `${tag.replace(/^v/, '')} on the tagged commit, or tag the commit as v${packageVersion} (7.5)`,
    );
  }
  return packageVersion;
}

/**
 * The six files of a release (7.4), by name: two .dmg, two .zip, the engines and the web app.
 * The names of the four app files are electron-builder's (electron-builder.yml artifactName).
 *
 * @param {string} version
 */
export function releaseFiles(version) {
  return [
    `EASy68K-${version}-arm64.dmg`,
    `EASy68K-${version}-x64.dmg`,
    `EASy68K-${version}-arm64-mac.zip`,
    `EASy68K-${version}-x64-mac.zip`,
    'engine-dist.zip',
    `easy68k-cross-platform-web-${version}.zip`,
  ];
}

/**
 * The text of SHA256SUMS.txt: one line per file, "<hex>  <name>", sorted by name, LF line ends,
 * as `shasum -a 256` writes it and `sha256sum -c` / `shasum -a 256 -c` read it.
 *
 * @param {readonly { name: string, sha256: string }[]} entries
 */
export function checksumText(entries) {
  return [...entries]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(({ name, sha256 }) => {
      if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`not a SHA-256 in hex: ${sha256}`);
      if (/[\r\n\\]/.test(name)) throw new Error(`a file name with a line break or backslash: ${name}`);
      return `${sha256}  ${name}\n`;
    })
    .join('');
}

/**
 * What is wrong with a folder of release files, as messages; empty when it holds exactly the six.
 *
 * @param {readonly string[]} present  the file names in the folder
 * @param {string} version
 */
export function releaseFileProblems(present, version) {
  const expected = releaseFiles(version);
  const problems = [];
  for (const name of expected) if (!present.includes(name)) problems.push(`missing: ${name}`);
  for (const name of present) {
    if (!expected.includes(name) && name !== 'SHA256SUMS.txt') problems.push(`not a release file: ${name}`);
  }
  return problems;
}

/**
 * What is wrong with a release folder that SHA256SUMS.txt has been written for, as messages; empty
 * when it holds exactly the six files and SHA256SUMS.txt, and the sums list exactly those six with
 * their actual hashes (the publish job's check of what the checksums job made).
 *
 * @param {readonly string[]} present            the file names in the folder
 * @param {string} version
 * @param {string | null} sumsText               SHA256SUMS.txt, null when missing
 * @param {(name: string) => string} hashOf      the SHA-256 (hex) of a file of the folder
 */
export function verifyProblems(present, version, sumsText, hashOf) {
  const problems = releaseFileProblems(present, version);
  if (sumsText === null) return [...problems, 'missing: SHA256SUMS.txt'];
  if (problems.length) return problems;
  const expected = checksumText(releaseFiles(version).map((name) => ({ name, sha256: hashOf(name) })));
  if (sumsText !== expected) problems.push('SHA256SUMS.txt does not list exactly the six files with their hashes');
  return problems;
}

/** Marks around the first-start section of docs/differences/DV3.md that the notes copy. */
export const FIRST_START_BEGIN = '<!-- first-start:begin -->';
export const FIRST_START_END = '<!-- first-start:end -->';

/**
 * The text between the first-start marks of a Markdown document, trimmed.
 *
 * @param {string} markdown
 */
export function firstStartSection(markdown) {
  const begin = markdown.indexOf(FIRST_START_BEGIN);
  const end = markdown.indexOf(FIRST_START_END);
  if (begin < 0 || end < begin) {
    throw new Error(`docs/differences/DV3.md has no section between ${FIRST_START_BEGIN} and ${FIRST_START_END}`);
  }
  return markdown.slice(begin + FIRST_START_BEGIN.length, end).trim();
}

/** The repository on GitHub, for the absolute links of the release notes. */
export const REPOSITORY_URL = 'https://github.com/gurmyd/easy68k-cross-platform';
/** The web version (GitHub Pages, the head of main). */
export const WEB_VERSION_URL = 'https://gurmyd.github.io/easy68k-cross-platform/';

/**
 * The sentences near the top of the release notes that say how far the release has been tried
 * (owner's decisions of 22 November 2026: the first release is published before a person has made
 * the checks of ARCHITECTURE.md 6.8; the notes must say so plainly). Lines of Markdown. The
 * links are absolute, because GitHub shows a release's notes outside the repository's tree.
 *
 * @param {string} version
 */
export function releaseStatus(version) {
  return [
    'The Mac app is signed ad hoc and not notarised by Apple, so macOS blocks it the first time you',
    'open it: the steps below get you past that once. Everything in this release was tested',
    "automatically on GitHub's Windows, macOS and Linux machines, but no person has worked through",
    `the manual checks of [docs/MANUAL-TEST-MAC.md](${REPOSITORY_URL}/blob/v${version}/docs/MANUAL-TEST-MAC.md)`,
    'yet: nobody has tried this release on a real Mac, in Safari itself, with a screen reader, a',
    'printer or a serial adapter. If you try it, please report what you find, good or bad, in the',
    `repository's issues: ${REPOSITORY_URL}/issues`,
    '',
    `The web version needs no download: ${WEB_VERSION_URL}`,
  ];
}

/**
 * The release notes (Markdown).
 *
 * @param {string} version
 * @param {string} firstStart     the first-start section (firstStartSection)
 * @param {string} minimumMacOS   the LSMinimumSystemVersion of the built app ("12.0"); it is
 *                                Electron's own (electron-builder.yml sets none), read from the
 *                                bundle by release.yml
 */
export function releaseNotes(version, firstStart, minimumMacOS) {
  const macos = `macOS ${macOSName(minimumMacOS)} or later`;
  const [arm64Dmg, x64Dmg, arm64Zip, x64Zip, engines, web] = releaseFiles(version);
  return [
    `EASy68K ${version} - unofficial web and macOS port of EASy68K v5.16.1.`,
    '',
    ...releaseStatus(version),
    '',
    '## Downloads',
    '',
    '| File | For |',
    '|---|---|',
    `| \`${arm64Dmg}\` or \`${arm64Zip}\` | Macs with Apple silicon (M1 and later), ${macos} |`,
    `| \`${x64Dmg}\` or \`${x64Zip}\` | Macs with an Intel processor, ${macos} |`,
    `| \`${web}\` | the web app, to serve from any web server (or use the one on GitHub Pages) |`,
    `| \`${engines}\` | the two WebAssembly engines, for contributors without Emscripten (\`npm run fetch:engines\`) |`,
    '| `SHA256SUMS.txt` | SHA-256 of every file above (`shasum -a 256 -c SHA256SUMS.txt`) |',
    '',
    '## Opening the Mac app for the first time',
    '',
    firstStart,
    '',
  ].join('\n');
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === 'version') {
    const [ref = ''] = args;
    const { version } = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
    console.log(releaseVersion(version, ref));
    return;
  }
  if (command === 'notes') {
    const [version, out, minimumMacOS] = args;
    if (!version || !out || !minimumMacOS) {
      throw new Error('usage: release.mjs notes <version> <out-file> <minimum macOS of the app>');
    }
    const section = firstStartSection(readFileSync(join(REPO, 'docs', 'differences', 'DV3.md'), 'utf8'));
    writeFileSync(out, releaseNotes(version, section, minimumMacOS));
    console.log(`release notes for ${version} written to ${out}`);
    return;
  }
  if (command === 'checksums') {
    const [folder, version] = args;
    if (!folder || !version) throw new Error('usage: release.mjs checksums <folder> <version>');
    const present = readdirSync(folder).filter((name) => statSync(join(folder, name)).isFile());
    const problems = releaseFileProblems(present, version);
    if (problems.length) throw new Error(`${folder} is not a complete release:\n  ${problems.join('\n  ')}`);
    const text = checksumText(releaseFiles(version).map((name) => ({ name, sha256: sha256(join(folder, name)) })));
    writeFileSync(join(folder, 'SHA256SUMS.txt'), text);
    process.stdout.write(text);
    return;
  }
  if (command === 'verify') {
    const [folder, version] = args;
    if (!folder || !version) throw new Error('usage: release.mjs verify <folder> <version>');
    const present = readdirSync(folder).filter((name) => statSync(join(folder, name)).isFile());
    const sumsPath = join(folder, 'SHA256SUMS.txt');
    const sums = present.includes('SHA256SUMS.txt') ? readFileSync(sumsPath, 'utf8') : null;
    const problems = verifyProblems(present, version, sums, (name) => sha256(join(folder, name)));
    if (problems.length)
      throw new Error(`${folder} is not the release SHA256SUMS.txt describes:\n  ${problems.join('\n  ')}`);
    console.log(`${folder}: the six files of ${version} and SHA256SUMS.txt agree`);
    return;
  }
  throw new Error(
    'usage: release.mjs version <ref> | notes <version> <out> <minimum macOS> | checksums <folder> <version> | ' +
      'verify <folder> <version>',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`release: ${/** @type {Error} */ (error).message}`);
    process.exit(1);
  }
}
