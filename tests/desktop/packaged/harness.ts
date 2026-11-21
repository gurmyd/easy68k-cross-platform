// The CDP harness of the packaged-app checks (ARCHITECTURE.md 6.7): starts the built, fused and
// signed EASy68K.app and attaches to its page over the Chrome DevTools Protocol.
//
// Why not Playwright's Electron launcher: it needs Node's inspector, which the fuse
// EnableNodeCliInspectArguments switches off in the shipped app, and the fuses of the shipped build
// are never relaxed for a test (6.7). So the harness starts the app's own binary (or `open`, for the
// file-association path of check 3) with
//
//     --remote-debugging-port=<0 or a free port> --user-data-dir=<a new temporary folder>
//
// reads the port from the DevToolsActivePort file Chromium writes into that folder (or from its
// "DevTools listening on" log line), and attaches with chromium.connectOverCDP. The packaged app
// honours none of the development variables (docs/porting/errata/DV2.md entry 15), so its windows
// appear on the runner's screen like a user's; what the page cannot show (the native window title,
// the quit question, minimising) is read and done through macOS accessibility with System Events
// (JavaScript for Automation, `osascript -l JavaScript`).
//
// Every process is ended by its process id when a check is done; nothing is stopped by name.
//
// Environment:
//   EASY68K_PACKAGED_APP     the .app to test (default: desktop/release/mac-arm64/EASy68K.app on
//                            Apple silicon, desktop/release/mac/EASy68K.app on Intel)
//   EASY68K_EXPECTED_ARCH    arm64 or x64 (default: the architecture of the folder name, else Node's)
//   EASY68K_EXPECT_SIGNATURE adhoc (default) or developer-id (release.yml with the optional secrets)
//
// Owner: DV3.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import {
  devToolsPortFromLog,
  isMainProcessCommand,
  parseDevToolsActivePort,
  parsePs,
  releaseFolderOf,
  shippedArch,
  type ShippedArch,
} from './facts';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const IS_MAC = process.platform === 'darwin';
export const NOT_MAC = 'the packaged app is a macOS app; these checks run on the macOS runners (release.yml)';
/** Everything the checks write: logs, screenshots, the prebuilt programs (build/ is not tracked). */
export const OUT_DIR = join(REPO, 'build', 'desktop-packaged');
/** The page every application window shows (desktop/src/security.ts APP_INDEX_URL). */
export const APP_PAGE = 'app://easy68k/index.html';

/** The port's version (root package.json, 7.5); the window titles end with it. */
export function rootVersion(): string {
  return (JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { version: string }).version;
}

export interface PackagedApp {
  /** The .app folder. */
  app: string;
  arch: ShippedArch;
  /** Contents/MacOS/EASy68K. */
  executable: string;
  /** Contents/Resources. */
  resources: string;
  /** Contents/Resources/app/dist: the web build app:// serves. */
  appDist: string;
  /** What signature to expect (EASY68K_EXPECT_SIGNATURE). */
  signature: 'adhoc' | 'developer-id';
}

/** The app under test, from the environment or desktop/release. */
export function packagedApp(): PackagedApp {
  const explicit = process.env.EASY68K_PACKAGED_APP;
  const hostArch = shippedArch(process.env.EASY68K_EXPECTED_ARCH ?? process.arch);
  // A relative EASY68K_PACKAGED_APP is relative to the repository (release.yml gives one).
  const app = resolve(REPO, explicit ?? join('desktop', 'release', releaseFolderOf(hostArch), 'EASy68K.app'));
  // Without EASY68K_EXPECTED_ARCH an explicit app's folder name decides (mac-arm64 / mac).
  const arch =
    process.env.EASY68K_EXPECTED_ARCH !== undefined || explicit === undefined
      ? hostArch
      : basename(dirname(app)) === 'mac-arm64'
        ? 'arm64'
        : basename(dirname(app)) === 'mac'
          ? 'x64'
          : hostArch;
  const resources = join(app, 'Contents', 'Resources');
  return {
    app,
    arch,
    executable: join(app, 'Contents', 'MacOS', 'EASy68K'),
    resources,
    appDist: join(resources, 'app', 'dist'),
    signature: process.env.EASY68K_EXPECT_SIGNATURE === 'developer-id' ? 'developer-id' : 'adhoc',
  };
}

/** Fails with a message when the app has not been built. */
export function requirePackagedApp(): PackagedApp {
  const found = packagedApp();
  if (!existsSync(found.executable)) {
    throw new Error(
      `${found.app} does not exist: build it with \`npm run desktop:dist -- --${found.arch}\` ` +
        '(or set EASY68K_PACKAGED_APP to a built EASy68K.app)',
    );
  }
  return found;
}

/** Runs a command and returns its exit status and output (never throws for a non-zero status). */
export function tool(
  file: string,
  args: readonly string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(file, args, {
    cwd: options.cwd ?? REPO,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 120_000,
    maxBuffer: 64 << 20,
  });
  if (result.error) throw new Error(`${file} ${args.join(' ')} could not run: ${result.error.message}`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** A port that was free a moment ago (for `open`, which cannot report the port of port 0). */
export function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Polls `probe` until it returns a value that is not null, or throws `what` after `timeoutMs`. */
export async function waitFor<T>(
  what: string,
  timeoutMs: number,
  probe: () => T | null | Promise<T | null>,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  for (;;) {
    try {
      const value = await probe();
      if (value !== null) return value;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline) {
      const detail = lastError instanceof Error ? ` (last error: ${lastError.message})` : '';
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}${detail}`);
    }
    await sleep(200);
  }
}

export interface LaunchOptions {
  /** A file to open: on the command line (`binary`) or as an open-file event (`open`). */
  file?: string;
  /** `binary` starts Contents/MacOS/EASy68K itself; `open` goes through Launch Services (5.7). */
  via?: 'binary' | 'open';
  /** More environment variables (binary only). */
  env?: Record<string, string>;
  /** A name for the log file and screenshots. */
  name: string;
}

export interface RunningApp {
  packaged: PackagedApp;
  browser: Browser;
  /** The application window's page (app://easy68k/index.html). */
  page: Page;
  /** The main process. */
  pid: number;
  userData: string;
  /** Console errors and page errors of the page since the harness attached. */
  errors: string[];
  /** Everything the app wrote to stdout and stderr so far (Chromium's log with --enable-logging). */
  log(): string;
  /** A screenshot of the page into build/desktop-packaged/screenshots/<name>-<label>.png. */
  screenshot(label: string): Promise<string | null>;
  /** True while the main process exists. */
  alive(): boolean;
  /** Ends the app (main process, then any process left with its user-data folder) and cleans up. */
  close(): Promise<void>;
}

function processTable(): { pid: number; command: string }[] {
  return parsePs(tool('ps', ['-axo', 'pid=,command=']).stdout);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The port the app's DevTools server listens on, from the places Chromium reports it. */
function findDevToolsPort(userData: string, log: string, startedAt: number): number | null {
  const own = join(userData, 'DevToolsActivePort');
  if (existsSync(own)) {
    const parsed = parseDevToolsActivePort(readFileSync(own, 'utf8'));
    if (parsed) return parsed.port;
  }
  const fromLog = devToolsPortFromLog(log);
  if (fromLog !== null) return fromLog;
  // If Electron ever ignored --user-data-dir, the file would be in the app's default folder.
  const fallback = join(homedir(), 'Library', 'Application Support', 'EASy68K', 'DevToolsActivePort');
  if (existsSync(fallback) && statSync(fallback).mtimeMs >= startedAt) {
    const parsed = parseDevToolsActivePort(readFileSync(fallback, 'utf8'));
    if (parsed) return parsed.port;
  }
  return null;
}

/** Starts the packaged app and attaches to its page. */
export async function launchPackaged(options: LaunchOptions): Promise<RunningApp> {
  const packaged = requirePackagedApp();
  const userData = mkdtempSync(join(tmpdir(), 'easy68k-packaged-'));
  const logs = join(OUT_DIR, 'logs');
  mkdirSync(logs, { recursive: true });
  const logFile = join(logs, `${options.name}.log`);
  writeFileSync(logFile, '');
  const startedAt = Date.now() - 1000;
  let output = '';
  let child: ChildProcess | null = null;
  let knownPort: number | null = null;

  if ((options.via ?? 'binary') === 'binary') {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
    delete env.ELECTRON_RUN_AS_NODE;
    Object.assign(env, options.env);
    child = spawn(
      packaged.executable,
      [
        '--remote-debugging-port=0',
        `--user-data-dir=${userData}`,
        '--enable-logging',
        ...(options.file ? [options.file] : []),
      ],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const collect = (chunk: Buffer) => {
      output += chunk.toString('utf8');
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
  } else {
    // The command of 6.7 check 3, with an explicit free port (open cannot report the port of
    // port 0's file before the app has written it, and the file is read anyway) and the app's
    // output sent to the log file.
    knownPort = await freePort();
    const target = ['-a', packaged.app, ...(options.file ? [options.file] : [])];
    const appArgs = [
      '--args',
      `--remote-debugging-port=${knownPort}`,
      `--user-data-dir=${userData}`,
      '--enable-logging',
    ];
    let result = tool('open', ['-n', '--stdout', logFile, '--stderr', logFile, ...target, ...appArgs]);
    if (result.status !== 0) {
      // An `open` without --stdout/--stderr (older systems): the same command without the log.
      writeFileSync(logFile, `open with --stdout/--stderr failed: ${result.stderr.trim()}\n`);
      result = tool('open', ['-n', ...target, ...appArgs]);
    }
    if (result.status !== 0) throw new Error(`open failed (${result.status}): ${result.stderr.trim()}`);
  }

  const log = () => (child ? output : existsSync(logFile) ? readFileSync(logFile, 'utf8') : '');
  const mainPid = async (): Promise<number> => {
    if (child?.pid !== undefined) return child.pid;
    return waitFor('the main process of the app started by open', 60_000, () => {
      const found = processTable().find((row) => isMainProcessCommand(row.command, packaged.executable, userData));
      return found ? found.pid : null;
    });
  };

  let pid = -1;
  let browser: Browser | null = null;
  const stopEverything = async () => {
    if (pid > 0 && isAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // gone meanwhile
      }
    }
    // Helpers normally end with the main process; any left with this folder are ended too.
    for (const row of processTable()) {
      if (row.command.includes(`--user-data-dir=${userData}`) && row.pid !== process.pid) {
        try {
          process.kill(row.pid, 'SIGKILL');
        } catch {
          // gone meanwhile
        }
      }
    }
    await browser?.close().catch(() => {});
    if (child) writeFileSync(logFile, output);
    try {
      rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      // left to the system's cleanup of temporary folders
    }
  };

  try {
    pid = await mainPid();
    const port =
      knownPort ??
      (await waitFor('the DevTools port (DevToolsActivePort or the log line)', 90_000, () => {
        if (child && child.exitCode !== null) throw new Error(`the app exited with ${child.exitCode}:\n${output}`);
        return findDevToolsPort(userData, output, startedAt);
      }));
    const endpoint = `http://127.0.0.1:${port}`;
    await waitFor(`the DevTools server at ${endpoint}`, 90_000, async () => {
      const response = await fetch(`${endpoint}/json/version`);
      return response.ok ? true : null;
    });
    browser = await chromium.connectOverCDP(endpoint, { timeout: 60_000 });
    const connected = browser;
    const page = await waitFor(`a window showing ${APP_PAGE}`, 60_000, () => {
      const pages = connected.contexts().flatMap((context) => context.pages());
      // The application window, not a help window (app://easy68k/help/...).
      return pages.find((candidate) => candidate.url().split(/[?#]/)[0] === APP_PAGE) ?? null;
    });
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    const shots = join(OUT_DIR, 'screenshots');
    return {
      packaged,
      browser: connected,
      page,
      pid,
      userData,
      errors,
      log,
      alive: () => isAlive(pid),
      async screenshot(label: string) {
        mkdirSync(shots, { recursive: true });
        const path = join(shots, `${options.name}-${label}.png`);
        try {
          await page.screenshot({ path, timeout: 15_000 });
          return path;
        } catch {
          return null; // a minimised window may paint nothing; the picture is for people only
        }
      },
      close: stopEverything,
    };
  } catch (error) {
    await stopEverything();
    throw new Error(
      `${(error as Error).message}\n--- log of the app (${logFile}) ---\n${log().split('\n').slice(-60).join('\n')}`,
      { cause: error },
    );
  }
}

/** Waits until the application has rendered (the production build has no window.__easy68k). */
export async function waitForApplication(page: Page): Promise<void> {
  await page.locator('#root > *').first().waitFor({ state: 'attached', timeout: 90_000 });
  const text = (await page.locator('#root').innerText({ timeout: 10_000 })).slice(0, 2000);
  if (/could not start/i.test(text)) throw new Error(`the application did not start: ${text}`);
}

// ---- macOS accessibility (System Events) ----------------------------------------------------------

/** Error numbers of System Events when the caller has no accessibility permission. */
const NO_ACCESS = /-1719|-25211|-1743|not allowed assistive access|not authori[sz]ed to send Apple events/i;

/**
 * Runs JavaScript for Automation and returns the JSON its last expression produced. A refused
 * accessibility permission is reported as such: the checks that need System Events cannot pass
 * without it (GitHub's macOS images grant it to the runner).
 */
export function jxa<T>(script: string, timeoutMs = 30_000): T {
  const result = tool('osascript', ['-l', 'JavaScript', '-e', script], { timeoutMs });
  if (result.status !== 0) {
    const message = result.stderr.trim();
    if (NO_ACCESS.test(message)) {
      throw new Error(
        `System Events refused the request (${message}). The process that runs these checks needs the ` +
          'Accessibility permission (System Settings > Privacy & Security > Accessibility).',
      );
    }
    throw new Error(`osascript failed (${result.status}): ${message}`);
  }
  return JSON.parse(result.stdout.trim() || 'null') as T;
}

/** JXA source that finds the application process with this pid as `p`. */
function processPrelude(pid: number): string {
  return `
    const se = Application('System Events');
    const found = se.applicationProcesses.whose({ unixId: ${Number(pid)} });
    if (found.length === 0) throw new Error('no application process with unix id ${Number(pid)}');
    const p = found[0];
    const tryGet = (f, fallback) => { try { return f(); } catch (e) { return fallback; } };
  `;
}

export interface NativeWindow {
  name: string;
  subrole: string;
  minimised: boolean;
  /** Sheets attached to the window, and dialog windows themselves (subrole AXDialog). */
  sheets: { texts: string[]; buttons: string[] }[];
}

/** The windows of the app's process as macOS shows them. */
export function nativeWindows(pid: number): NativeWindow[] {
  return jxa<NativeWindow[]>(`
    ${processPrelude(pid)}
    JSON.stringify(p.windows().map((w) => {
      const subrole = tryGet(() => w.subrole(), '') || '';
      const sheets = tryGet(() => w.sheets(), []).map((s) => ({
        texts: tryGet(() => s.staticTexts.value(), []),
        buttons: tryGet(() => s.buttons.name(), []),
      }));
      if (subrole === 'AXDialog' || subrole === 'AXSystemDialog') {
        sheets.push({ texts: tryGet(() => w.staticTexts.value(), []), buttons: tryGet(() => w.buttons.name(), []) });
      }
      return {
        name: tryGet(() => w.name(), '') || '',
        subrole,
        minimised: tryGet(() => w.attributes.byName('AXMinimized').value(), false) === true,
        sheets,
      };
    }));
  `);
}

/** Presses the button with this name in a sheet or dialog of the app. True if one was pressed. */
export function pressDialogButton(pid: number, name: string): boolean {
  return jxa<boolean>(`
    ${processPrelude(pid)}
    let pressed = false;
    for (const w of p.windows()) {
      const subrole = tryGet(() => w.subrole(), '') || '';
      const containers = tryGet(() => w.sheets(), []);
      if (subrole === 'AXDialog' || subrole === 'AXSystemDialog') containers.push(w);
      for (const c of containers) {
        const buttons = tryGet(() => c.buttons.whose({ name: ${JSON.stringify(name)} })(), []);
        if (buttons.length > 0) { buttons[0].click(); pressed = true; break; }
      }
      if (pressed) break;
    }
    JSON.stringify(pressed);
  `);
}

/** Minimises the app window whose title contains `titlePart`. True if one was found. */
export function minimiseWindow(pid: number, titlePart: string): boolean {
  return jxa<boolean>(`
    ${processPrelude(pid)}
    const w = p.windows().find((x) => (tryGet(() => x.name(), '') || '').includes(${JSON.stringify(titlePart)}));
    if (w) w.attributes.byName('AXMinimized').value = true;
    JSON.stringify(Boolean(w));
  `);
}

/** A picture of the whole screen (for the quit question, which the page cannot show). */
export function screenCapture(label: string): string | null {
  const shots = join(OUT_DIR, 'screenshots');
  mkdirSync(shots, { recursive: true });
  const path = join(shots, `${label}.png`);
  try {
    return tool('screencapture', ['-x', path], { timeoutMs: 20_000 }).status === 0 && existsSync(path) ? path : null;
  } catch {
    return null;
  }
}
