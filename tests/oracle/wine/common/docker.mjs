// Running the oracle container from Node (ARCHITECTURE.md 6.2.2). Used by asm/regenerate.mjs; the
// simulator driver of package T3 can use it the same way.
//
// Rules this module keeps (docs/porting/official-oracle.md section 2):
// - the official programs are mounted read-only and never copied to the host or into the image;
// - every container is started with --init (Wine leaves zombie processes) and --rm, under a name
//   this process chose, and is removed by that name when the process is interrupted;
// - a container is only ever stopped by the name given here, never by image or by pattern.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_IMAGE = 'easy68k-oracle-wine';

/** SHA-256 of the two official programs, v5.16.1 (docs/porting/ground-truth.md section 2). */
export const OFFICIAL_SHA256 = {
  'EDIT68K.exe': '8cd7760ef3eb089c07a039d7cfb77b38ca23b859690f44d94ef67cf1d2db513e',
  'SIM68K.exe': '49cee94f462e799081f1b1b546c957fd5c37a54f7819cd84a1e17718c4d0d20e',
};
/** The files stage.sh copies out of the mounted official folder. */
export const OFFICIAL_FILES = ['EDIT68K.exe', 'SIM68K.exe', 'help.chm', 'settings.dat', 'sim68K.dat', 'template.NEW'];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Runs `docker <args>` and returns { status, stdout, stderr }; never throws for a non-zero exit. */
export function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error) {
    throw new Error(`docker could not be started (${result.error.message}). Docker must be installed and running.`);
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * Throws unless `directory` holds the official v5.16.1 distribution: every file the container
 * copies, and the two programs with the expected SHA-256.
 */
export function assertOfficialFolder(directory) {
  for (const name of OFFICIAL_FILES) {
    if (!existsSync(join(directory, name))) {
      throw new Error(
        `${directory} does not hold the official EASy68K distribution (${name} is missing). ` +
          'Unpack it there with: node tests/oracle/wine/common/fetch-official.mjs',
      );
    }
  }
  for (const [name, expected] of Object.entries(OFFICIAL_SHA256)) {
    const got = sha256(readFileSync(join(directory, name)));
    if (got !== expected) throw new Error(`${join(directory, name)} is not the v5.16.1 program (SHA-256 ${got})`);
  }
}

/** The files the Dockerfile copies into /oracle, as paths below the Dockerfile's folder. */
export function scriptsInImage(wineDirectory) {
  const dockerfile = readFileSync(join(wineDirectory, 'Dockerfile'), 'utf8');
  const files = [];
  for (const line of dockerfile.split('\n')) {
    const match = /^COPY\s+(.+)\s+\/oracle\/\s*$/.exec(line.trim());
    if (match) files.push(...match[1].trim().split(/\s+/));
  }
  return files;
}

/**
 * Throws unless the image exists and its /oracle scripts are the ones in the working tree: a run
 * with an image built from older scripts would produce results nobody can reproduce.
 */
export function assertImageCurrent(image, wineDirectory) {
  if (docker(['image', 'inspect', '--format', '{{.Id}}', image]).status !== 0) {
    throw new Error(`Docker image ${image} does not exist. Build it with: npm run oracle:wine:build`);
  }
  const files = scriptsInImage(wineDirectory);
  const names = files.map((file) => `/oracle/${file.split('/').pop()}`);
  const result = docker(['run', '--rm', '--entrypoint', 'sha256sum', image, ...names]);
  if (result.status !== 0) {
    throw new Error(`Docker image ${image} lacks scripts the Dockerfile names. Rebuild it: npm run oracle:wine:build`);
  }
  const inImage = new Map(
    result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.slice(66), line.slice(0, 64)]),
  );
  const stale = files.filter((file) => {
    // The image holds the files with LF line ends, as the repository does.
    const local = sha256(readFileSync(join(wineDirectory, file)));
    return inImage.get(`/oracle/${file.split('/').pop()}`) !== local;
  });
  if (stale.length > 0) {
    throw new Error(
      `Docker image ${image} was built from other scripts (${stale.join(', ')} differ). Rebuild it: npm run oracle:wine:build`,
    );
  }
}

/** What identifies the tools of a run, for the manifest: the Wine version inside the image. */
export function wineVersion(image) {
  const result = docker(['run', '--rm', '--entrypoint', 'wine', image, '--version']);
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

/** `--mount` argument for a bind mount; the host path may hold spaces and a drive letter. */
export function bind(source, target, readOnly = true) {
  return ['--mount', `type=bind,source=${source},target=${target}${readOnly ? ',readonly' : ''}`];
}

const running = new Set();
let hooked = false;

function removeRunning() {
  for (const name of running) spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  running.clear();
}

/**
 * Starts one container and resolves with its exit status when it ends. Output goes to `logFile`.
 * The container is named `name`; if this process is interrupted, it is removed by that name.
 * @param {{ name: string, image: string, mounts: string[], env?: Record<string, string>, command: string[], logFile: string }} spec
 * @returns {Promise<number>}
 */
export function runContainer(spec) {
  if (!hooked) {
    hooked = true;
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => {
        removeRunning();
        process.exit(130);
      });
    }
  }
  const env = Object.entries(spec.env ?? {}).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  const args = ['run', '--rm', '--init', '--name', spec.name, ...env, ...spec.mounts, spec.image, ...spec.command];
  return new Promise((resolvePromise, reject) => {
    const log = createWriteStream(spec.logFile);
    running.add(spec.name);
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on('error', (error) => {
      running.delete(spec.name);
      reject(new Error(`docker could not be started (${error.message})`));
    });
    child.on('close', (status) => {
      running.delete(spec.name);
      log.end(() => resolvePromise(status ?? 1));
    });
  });
}
