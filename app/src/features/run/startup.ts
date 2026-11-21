// Start-up arguments and file associations of the simulator (ARCHITECTURE.md 5.7; sim-ui §8.1).
//
//   desktop command line   EASy68K [file] [/r] [/f] [/e] [/b]
//   web URL                ?open=<VPath> plus run=1, fullscreen=1, exceptions=1, bitfield=1
//   file association       an .S68 opened from the system (the desktop app's open-file event)
//
// A first argument that names an `.S68` file (any letter case) belongs to the simulator: the
// application switches to Simulator mode and loads it like the original's command-line file, then
// applies the switches. As in the original, the switches are applied even when that file cannot
// be loaded, and they are not looked at when the first argument is anything else (another file is
// the editor's business, features/documents).
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

async function isFile(ctx: AppContext, path: VPath): Promise<boolean> {
  try {
    return (await ctx.vfs.stat(path))?.kind === 'file';
  } catch {
    return false;
  }
}

/** The switches without a loaded file (sim-ui §8.1: "still processed when argument 1 was not a loadable file"). */
function applySwitches(ctx: AppContext, args: StartupArgs): void {
  const { controller } = ctx.sim;
  if (args.exceptions) controller.invoke((engine) => engine.setOption(SimOption.Exceptions, true));
  if (args.bitField) controller.invoke((engine) => engine.setOption(SimOption.BitField, true));
  if (args.fullScreen) void ctx.commands.run('sim.output.fullscreen');
  if (args.run) controller.run();
}

/** Acts on the arguments this window was started with. */
export async function openStartupFile(ctx: AppContext): Promise<void> {
  const args = ctx.platform.startupArgs();
  if (args.file === null || !isSRecordName(args.file)) return;
  await ctx.commands.run('app.mode.set', 'simulator');
  const path = startupPath(args.file, ctx.platform.kind);
  if (path !== null && (await isFile(ctx, path))) {
    // The load applies /e and /b, and after it /f and /r (4.7 steps 9 and 10).
    await ctx.sim.controller.open(path, 'commandLine');
  } else {
    // Nothing is loaded and nothing is reported, as in the original; the simulator still starts.
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
