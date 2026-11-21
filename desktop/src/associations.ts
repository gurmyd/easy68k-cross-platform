// Start-up arguments and file associations (ARCHITECTURE.md 5.7, 3.13).
//
// - Command line: `EASy68K [file] [/r] [/f] [/e] [/b]`. The first argument names the file; the
//   switches of sim-ui §8.1 count only from the second argument on. Chromium and Electron
//   switches (`--...`) and the macOS process serial number (`-psn_...`) are not arguments.
// - File association and a drop on the Dock icon: macOS sends `open-file` events, before the app
//   is ready as well as later. A file that arrives before the first window has loaded becomes
//   that window's start-up file (so `open -a EASy68K.app tutorial1.S68` starts with the program,
//   6.7 check 3); later ones go to the window in front through Platform.onOpenFiles.
//
// The page receives VPaths of the /disk mount ("/Users/me/x.X68" is "/disk/Users/me/x.X68"). The
// folder of every such file becomes a granted root (7.6). What a file means (Editor or Simulator
// mode by its extension) is decided by the page.
//
// Owner: DV2.

import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { type GrantedRoots, vpathOfRealPath } from './security';

/** StartupArgs of app/src/contracts/platform.ts. */
export interface StartupArgs {
  file: string | null;
  run: boolean;
  fullScreen: boolean;
  exceptions: boolean;
  bitField: boolean;
}

export const NO_STARTUP_ARGS: Readonly<StartupArgs> = Object.freeze({
  file: null,
  run: false,
  fullScreen: false,
  exceptions: false,
  bitField: false,
});

/** IPC channel on which open-file events reach the page. */
export const OPEN_FILES_CHANNEL = 'e68:open-files';

export interface CommandLineEnv {
  /** process.defaultApp: started as `electron <app folder>`, so argv[1] is the folder. */
  defaultApp: boolean;
  cwd: string;
  isFile(path: string): boolean;
}

export function isExistingFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * What a dropped File's path (webUtils.getPathForFile in the preload script) names: an existing
 * file or folder given by an absolute path, else null ('' for a File the page made itself).
 */
export function droppedPath(value: unknown): { path: string; kind: 'file' | 'dir' } | null {
  if (typeof value !== 'string' || value === '' || value.length > 4096 || value.includes('\0')) return null;
  if (!isAbsolute(value)) return null;
  try {
    const info = statSync(value);
    return info.isFile() ? { path: value, kind: 'file' } : info.isDirectory() ? { path: value, kind: 'dir' } : null;
  } catch {
    return null;
  }
}

/** The arguments of the command line that are the program's own (no executable, no switches of Chromium). */
export function programArguments(argv: readonly string[], defaultApp: boolean): string[] {
  // Switches may stand before the app folder too (`electron --inspect=0 <folder> ...`), so they
  // are removed first and the folder is the first argument that is left.
  const args = argv.slice(1).filter((arg) => !arg.startsWith('--') && !arg.startsWith('-psn_'));
  return defaultApp ? args.slice(1) : args;
}

/**
 * The start-up arguments of a command line, with the real path of the file (null when the first
 * argument names no existing file, which means a new document).
 */
export function parseCommandLine(
  argv: readonly string[],
  env: CommandLineEnv,
): { args: StartupArgs; realFile: string | null } {
  const [first, ...rest] = programArguments(argv, env.defaultApp);
  const args: StartupArgs = { ...NO_STARTUP_ARGS };
  let realFile: string | null = null;
  if (first !== undefined) {
    const path = isAbsolute(first) ? first : resolve(env.cwd, first);
    if (env.isFile(path)) realFile = path;
  }
  for (const arg of rest) {
    // sim-ui 8.1 (SIM68Ku.cpp): LowerCase(ParamStr(i)) compared with "/r", "/f", "/e", "/b" only.
    const match = /^\/([rfeb])$/i.exec(arg);
    switch (match?.[1]?.toLowerCase()) {
      case 'r':
        args.run = true;
        break;
      case 'f':
        args.fullScreen = true;
        break;
      case 'e':
        args.exceptions = true;
        break;
      case 'b':
        args.bitField = true;
        break;
    }
  }
  if (realFile !== null) args.file = vpathOfRealPath(realFile);
  return { args, realFile };
}

/**
 * Files opened from outside (command line, open-file events) on their way to a window.
 * `deliver` hands VPaths to the window in front and returns false while no window can take them.
 */
export class LaunchFiles {
  private readonly early: string[] = [];
  private startupTaken = false;

  constructor(
    private readonly grants: GrantedRoots,
    private readonly deliver: (vpaths: string[]) => boolean,
  ) {}

  /** A real file opened through the command line, an association or a drop. */
  open(realPath: string): void {
    if (!isAbsolute(realPath)) return;
    this.grants.addFolderOf(realPath);
    const vpath = vpathOfRealPath(realPath);
    if (vpath === null) return;
    if (!this.startupTaken || !this.deliver([vpath])) this.early.push(vpath);
  }

  /**
   * The start-up arguments of the first window: the command line's, or, without a file there,
   * the first file that arrived early. Called once; the remaining early files are delivered once
   * the window can take them (flush()).
   */
  startupArgs(commandLine: StartupArgs): StartupArgs {
    this.startupTaken = true;
    if (commandLine.file !== null) return commandLine;
    const file = this.early.shift();
    return file === undefined ? commandLine : { ...NO_STARTUP_ARGS, file };
  }

  /** Delivers files that arrived while no window could take them. */
  flush(): void {
    if (this.early.length === 0 || !this.startupTaken) return;
    const files = this.early.splice(0);
    if (!this.deliver(files)) this.early.unshift(...files);
  }
}
