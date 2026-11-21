// Start-up arguments and file associations of the simulator (ARCHITECTURE.md 5.7; sim-ui §8.1).
//
//   desktop command line   EASy68K [file] [/r] [/f] [/e] [/b]
//   web URL                ?open=<VPath> plus run=1, fullscreen=1, exceptions=1, bitfield=1
//   file association       an .S68 opened from the system (the desktop app's open-file event)
//
// The port's one command line stands for the two programs of the original, and the simulator's
// part of it follows SIM68K.exe (sim-ui §8.1):
//
//   - Argument 1 is a file name. If it names an existing `.S68` file (any letter case), the
//     application switches to Simulator mode and loads it, and the load applies the switches.
//   - Any other argument 1 - another kind of file, a file that does not exist, none at all - is
//     nothing to the simulator. It is ignored without a message and the mode is not changed (5.7:
//     another existing file is opened by the editor, features/documents; otherwise the editor shows
//     a new document). The desktop app reports a file that does not exist as `file: null`.
//   - "Switches are still processed when argument 1 was not a loadable file": `/e` and `/b` set
//     the two options (and, as every settings change in the port, are stored at once), `/f` runs the
//     full-screen command of the Output panel, `/r` runs the Run command. Run with nothing loaded
//     halts at once, as in the original: memory is all `$FF`, which is the SIMHALT pattern.
//
// Owner: SH8.

import type { AppContext, StartupArgs, VPath } from '../../contracts';
import { SimOption } from '../../contracts';
import { extractFileExt, isVPath } from '../../core/paths/winpath';

/** True for a name with the extension `.S68` in any letter case. */
export function isSRecordName(name: string): boolean {
  return extractFileExt(name).toUpperCase() === '.S68';
}

/**
 * The virtual path of a start-up file: a web URL carries one already (`/browser/demo/prog.S68`);
 * the desktop app passes a real path, which lives under the `/disk` mount (3.8.2). Null for a name
 * that is neither.
 */
export function startupPath(file: string, kind: AppContext['platform']['kind']): VPath | null {
  const name = file.replaceAll('\\', '/');
  if (kind === 'desktop') {
    const path = name.startsWith('/disk/') ? name : `/disk${name.startsWith('/') ? '' : '/'}${name}`;
    return isVPath(path) ? path : null;
  }
  return isVPath(name) ? name : null;
}

/** True if the command line has at least one of the simulator's switches. */
export function hasSwitches(args: StartupArgs): boolean {
  return args.run || args.fullScreen || args.exceptions || args.bitField;
}

async function isFile(ctx: AppContext, path: VPath): Promise<boolean> {
  try {
    return (await ctx.vfs.stat(path))?.kind === 'file';
  } catch {
    return false;
  }
}

/** The program the simulator loads at start: argument 1 if it names an existing `.S68` file, else null. */
async function startupProgram(ctx: AppContext, args: StartupArgs): Promise<VPath | null> {
  if (args.file === null || !isSRecordName(args.file)) return null;
  const path = startupPath(args.file, ctx.platform.kind);
  return path !== null && (await isFile(ctx, path)) ? path : null;
}

/**
 * The switches when no program was loaded (sim-ui §8.1), in the original's order: the two options
 * and full screen at once, Run last (the original runs when its window is first activated).
 */
function applySwitches(ctx: AppContext, args: StartupArgs): void {
  const { controller } = ctx.sim;
  if (args.exceptions) controller.invoke((engine) => engine.setOption(SimOption.Exceptions, true));
  if (args.bitField) controller.invoke((engine) => engine.setOption(SimOption.BitField, true));
  if (args.fullScreen) void ctx.commands.run('sim.output.fullscreen', true);
  if (args.run) controller.run();
}

/** Acts on the arguments this window was started with. */
export async function openStartupFile(ctx: AppContext): Promise<void> {
  const args = ctx.platform.startupArgs();
  const program = await startupProgram(ctx, args);
  if (program !== null) {
    await ctx.commands.run('app.mode.set', 'simulator');
    // The load applies /e and /b, and after it /f and /r (4.7 steps 9 and 10).
    await ctx.sim.controller.open(program, 'commandLine');
  } else if (hasSwitches(args)) {
    // Nothing is loaded and nothing is reported. The switches need the engine: wait for its start.
    await ctx.sim.controller.coldStart();
    applySwitches(ctx, args);
  }
}

/**
 * An `.S68` opened from the system while the application runs: Simulator mode, the simulator
 * started afresh, the file loaded without running (5.7). Other files are the editor's.
 */
export async function openAssociatedFiles(ctx: AppContext, files: readonly string[]): Promise<void> {
  const file = files.find(isSRecordName);
  if (file === undefined) return;
  const path = startupPath(file, ctx.platform.kind);
  if (path === null) return;
  await ctx.commands.run('app.mode.set', 'simulator');
  await ctx.sim.controller.open(path, 'association');
}
