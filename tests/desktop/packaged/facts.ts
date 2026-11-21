// Pure helpers of the packaged-app checks (ARCHITECTURE.md 6.7): reading what the tools and the
// app print. No process is started here; unit.spec.ts tests every function on any system.
//
// Owner: DV3.

import { compareMacOSVersions } from '../../../desktop/scripts/packaging.mjs';

/** The two architectures that are shipped (1.1), as electron-builder and Node name them. */
export type ShippedArch = 'arm64' | 'x64';

/** The name `lipo -archs` prints for a shipped architecture. */
export function machArchOf(arch: ShippedArch): 'arm64' | 'x86_64' {
  return arch === 'arm64' ? 'arm64' : 'x86_64';
}

/** The folder below desktop/release where electron-builder puts the .app of an architecture. */
export function releaseFolderOf(arch: ShippedArch): string {
  // electron-builder names the folder of its default architecture (x64) without a suffix.
  return arch === 'arm64' ? 'mac-arm64' : 'mac';
}

/** A shipped architecture from a name (EASY68K_EXPECTED_ARCH, process.arch), or an error. */
export function shippedArch(name: string): ShippedArch {
  if (name === 'arm64') return 'arm64';
  if (name === 'x64' || name === 'x86_64') return 'x64';
  throw new Error(`only arm64 and x64 apps are shipped (1.1), not "${name}"`);
}

/**
 * The port of a DevToolsActivePort file Chromium writes into the user-data folder when started with
 * `--remote-debugging-port=0`: the port on the first line, the browser target's path on the second.
 * Null while the file is still incomplete.
 */
export function parseDevToolsActivePort(text: string): { port: number; path: string } | null {
  const [first = '', second = ''] = text.split(/\r?\n/);
  const port = Number(first.trim());
  if (!Number.isInteger(port) || port <= 0 || port > 65535 || !second.trim().startsWith('/devtools/browser/')) {
    return null;
  }
  return { port, path: second.trim() };
}

/** The port of Chromium's "DevTools listening on ws://127.0.0.1:<port>/..." line, or null. */
export function devToolsPortFromLog(text: string): number | null {
  const match = /DevTools listening on ws:\/\/[^:/\s]+:(\d+)\//.exec(text);
  return match ? Number(match[1]) : null;
}

/** Removes ANSI colour sequences (the fuses CLI colours its states). */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- the escape character is what is removed
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * The fuses `npx @electron/fuses read --app <app>` printed: `{ RunAsNode: 'Disabled', ... }`.
 * Lines look like "  RunAsNode is Disabled".
 */
export function parseFusesRead(text: string): Record<string, string> {
  const fuses: Record<string, string> = {};
  for (const line of stripAnsi(text).split(/\r?\n/)) {
    const match = /^\s+(\w+) is (Enabled|Disabled|Inherited|Removed)\s*$/.exec(line);
    if (match) fuses[match[1] as string] = match[2] as string;
  }
  return fuses;
}

/**
 * The oldest macOS a Mach-O file loads on, from `otool -l <file>`: the "minos" of its
 * LC_BUILD_VERSION command, or the "version" of an older LC_VERSION_MIN_MACOSX. Null if neither
 * is there. Of a fat file, the highest of its slices.
 */
export function minosFromOtool(text: string): string | null {
  const found: string[] = [];
  for (const block of text.split(/^Load command \d+$/m)) {
    if (/^\s*cmd LC_BUILD_VERSION\s*$/m.test(block)) {
      const minos = /^\s*minos (\d+(?:\.\d+){0,2})\s*$/m.exec(block)?.[1];
      if (minos) found.push(minos);
    } else if (/^\s*cmd LC_VERSION_MIN_MACOSX\s*$/m.test(block)) {
      const version = /^\s*version (\d+(?:\.\d+){0,2})\s*$/m.exec(block)?.[1];
      if (version) found.push(version);
    }
  }
  return found.sort(compareMacOSVersions).at(-1) ?? null;
}

/** What `codesign --display --verbose=4 <app>` says about a signature (it writes to stderr). */
export interface CodeSignature {
  identifier: string | null;
  /** "adhoc" for an ad-hoc signature, otherwise null (a certificate signature has Authority lines). */
  signature: string | null;
  authorities: string[];
  teamIdentifier: string | null;
  /** The flags as printed, e.g. "0x2(adhoc)" or "0x10000(runtime)". */
  flags: string | null;
}

export function parseCodesignDisplay(text: string): CodeSignature {
  const value = (key: string): string | null => {
    const match = new RegExp(`^${key}=(.*)$`, 'm').exec(text);
    return match ? (match[1] as string).trim() : null;
  };
  const flags = /flags=(0x[0-9a-f]+\([^)]*\))/.exec(text)?.[1] ?? null;
  return {
    identifier: value('Identifier'),
    signature: value('Signature'),
    authorities: [...text.matchAll(/^Authority=(.*)$/gm)].map((match) => (match[1] as string).trim()),
    teamIdentifier: value('TeamIdentifier'),
    flags,
  };
}

/**
 * The start address of an S-record file: the address of its termination record (S7: 32 bits,
 * S8: 24 bits, S9: 16 bits), which the simulator puts into the PC when it loads the file.
 */
export function srecordStart(text: string): number | null {
  for (const line of text.split(/\r?\n/)) {
    const match = /^S([789])([0-9A-Fa-f]{2})([0-9A-Fa-f]+)$/.exec(line.trim());
    if (!match) continue;
    const digits = { '7': 8, '8': 6, '9': 4 }[match[1] as '7' | '8' | '9'];
    return parseInt((match[3] as string).slice(0, digits), 16);
  }
  return null;
}

/** A 32-bit value as the register fields show it: eight upper-case hex digits. */
export function registerText(value: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

/**
 * True for the line of `ps -axo pid=,command=` that is the app's main process started with this
 * user-data folder: its command is the main executable, not one of the helpers
 * ("<app>/Contents/Frameworks/EASy68K Helper (Renderer).app/..."), which often get the same
 * switches.
 */
export function isMainProcessCommand(command: string, executable: string, userDataDir: string): boolean {
  return (
    (command === executable || command.startsWith(`${executable} `)) &&
    command.includes(`--user-data-dir=${userDataDir}`)
  );
}

/** Parses `ps -axo pid=,command=` into pid and command. */
export function parsePs(text: string): { pid: number; command: string }[] {
  const out: { pid: number; command: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match) out.push({ pid: Number(match[1]), command: (match[2] as string).trimEnd() });
  }
  return out;
}

/** Lines of a Chromium log that report a Content Security Policy violation. */
export function cspViolationLines(log: string): string[] {
  // Chromium logs page console messages with --enable-logging as `[...:INFO:CONSOLE:5] "..."`; a
  // violation reads "Executing inline script violates the following Content Security Policy
  // directive ..." (seen with Electron 45), "Refused to load ..." or "... Content Security Policy of
  // your site blocks ...". Any console line that names the policy counts.
  return log.split(/\r?\n/).filter((line) => /:CONSOLE[:(]/.test(line) && /Content[- ]Security[- ]Policy/i.test(line));
}

/**
 * Whether a timed run of check 5 meets 4.5.5: the window was minimised before the program
 * finished, and the program finished within `limitMs` of the Run command.
 */
export function judgeMinimisedRun(run: {
  runAt: number;
  minimisedAt: number | null;
  finishedAt: number | null;
  limitMs: number;
}): { ok: boolean; elapsedMs: number | null; reason: string } {
  if (run.finishedAt === null) return { ok: false, elapsedMs: null, reason: 'the program did not finish' };
  const elapsedMs = run.finishedAt - run.runAt;
  if (run.minimisedAt === null || run.minimisedAt >= run.finishedAt) {
    return { ok: false, elapsedMs, reason: 'the window was not minimised while the program waited' };
  }
  if (elapsedMs > run.limitMs) {
    return { ok: false, elapsedMs, reason: `finished after ${elapsedMs} ms, more than ${run.limitMs} ms` };
  }
  return { ok: true, elapsedMs, reason: `finished after ${elapsedMs} ms` };
}
