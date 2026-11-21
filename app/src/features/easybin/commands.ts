// The commands of EASyBIN mode (ARCHITECTURE.md 9.7: `sim.view.easybin` and every `bin.*`) and the
// file flows behind them (docs/porting/easybin.md 9-13). Owner: B1.
//
// Files are reached only through the application context: ctx.fileDialogs (FS1's dialogs) to choose
// a name, ctx.vfs to read, test and write. The dialogs of FS1 ask their own `File exists! OK to
// overwrite?` unless the request says `overwritePrompt: null` (docs/porting/errata/FS1.md, Contract
// C2); EASyBIN passes null and asks the original's own question itself, after the dialog, as the
// original does - for Save Binary about all four derived names (13.2 step 5).

import type { AppContext, CommandHandler, CommandId, FileFilter, SaveRequest, VPath } from '../../contracts';
import {
  APP_TITLE,
  HELP_PAGE,
  MESSAGES,
  OPEN_BINARY_FILTERS,
  OPEN_DIALOG_TITLE,
  OPEN_SREC_FILTERS,
  SAVE_BINARY_DEFAULT_EXT,
  SAVE_BINARY_FILTERS,
  SAVE_DIALOG_TITLE,
  SAVE_SREC_DEFAULT_EXT,
  SAVE_SREC_FILTERS,
} from '../../core/easybin';
import { basename, dirname } from '../../core/paths/winpath';
import { showExitScreen } from '../../state/shell';
import { beep } from './beep';
import { easybinOf } from './session';

/** The dialog id of the About box (an addition to the ids of ARCHITECTURE.md 2.7, errata B1). */
export const ABOUT_DIALOG_ID = 'easybin.about';

/** A ShowMessage box: caption `EASyBIN`, OK, no icon. */
export async function showMessage(ctx: AppContext, text: string): Promise<void> {
  await ctx.dialogs.messageBox({ title: APP_TITLE, text, icon: 'none', buttons: ['OK'] });
}

/** Application->MessageBox with a caption: OK, or Yes / No; resolves to the button. */
function messageBox(ctx: AppContext, title: string, text: string, buttons: ('OK' | 'Cancel' | 'Yes' | 'No')[]) {
  return ctx.dialogs.messageBox({ title, text, icon: 'none', buttons });
}

/** Windows FileExists: the name in any letter case. Returns the stored spelling, or null. */
async function existing(ctx: AppContext, path: VPath): Promise<VPath | null> {
  try {
    const found = await ctx.vfs.resolve(dirname(path), basename(path));
    if (found === null) return null;
    return (await ctx.vfs.stat(found))?.kind === 'file' ? found : null;
  } catch {
    return null;
  }
}

async function readFile(ctx: AppContext, path: VPath): Promise<Uint8Array | null> {
  try {
    return await ctx.vfs.readFile(path);
  } catch {
    return null;
  }
}

/** The save dialog with the original's filter and default extension; null = cancelled. */
async function chooseSaveName(
  ctx: AppContext,
  filters: readonly FileFilter[],
  defaultExt: string,
): Promise<VPath | null> {
  const session = easybinOf(ctx);
  // `overwritePrompt: null`: FS1's dialog asks nothing; the original asks after the dialog.
  const request: SaveRequest & { overwritePrompt: null } = {
    title: SAVE_DIALOG_TITLE,
    filters: [...filters],
    defaultExt,
    overwritePrompt: null,
    ...(session.lastSaved ? { suggested: session.lastSaved } : {}),
  };
  const path = await ctx.fileDialogs.save(request);
  if (path !== null) session.lastSaved = path;
  return path;
}

async function chooseOpenName(ctx: AppContext, filters: readonly FileFilter[]): Promise<VPath | null> {
  const session = easybinOf(ctx);
  const paths = await ctx.fileDialogs.open({
    title: OPEN_DIALOG_TITLE,
    filters: [...filters],
    multiple: false,
    ...(session.lastOpened ? { startDir: dirname(session.lastOpened) } : {}),
  });
  const path = paths?.[0] ?? null;
  if (path !== null) session.lastOpened = path;
  return path;
}

/** File > New (9). */
export async function newEnvironment(ctx: AppContext): Promise<void> {
  const answer = await messageBox(ctx, MESSAGES.newCautionTitle, MESSAGES.newCaution, ['OK', 'Cancel']);
  if (answer === 'OK') easybinOf(ctx).model.newEnvironment();
}

/** Open S-Record (10.1, 10.2): the loader's message in every case. */
export async function openSRecord(ctx: AppContext): Promise<void> {
  const path = await chooseOpenName(ctx, OPEN_SREC_FILTERS);
  if (path === null) return;
  const data = await readFile(ctx, path);
  if (data === null) return showMessage(ctx, MESSAGES.cannotOpenSrec(path));
  await showMessage(ctx, easybinOf(ctx).model.openSRecord(path, data).message);
}

/** Open Binary (12.1). */
export async function openBinary(ctx: AppContext): Promise<void> {
  const path = await chooseOpenName(ctx, OPEN_BINARY_FILTERS);
  if (path === null) return;
  const data = await readFile(ctx, path);
  if (data === null) return showMessage(ctx, MESSAGES.cannotOpenBinary(path));
  easybinOf(ctx).model.openBinary(path, data);
}

/** Save S-Record (11). */
export async function saveSRecord(ctx: AppContext): Promise<void> {
  const { model } = easybinOf(ctx);
  const confirm = await messageBox(ctx, MESSAGES.srecConfirmTitle, model.sRecordConfirmText(), ['Yes', 'No']);
  if (confirm !== 'Yes') return;
  const plan = model.sRecordPlan();
  if (plan === null) {
    beep(ctx);
    await messageBox(ctx, MESSAGES.invalidRangeTitle, MESSAGES.invalidRange, ['OK']);
    return;
  }
  const chosen = await chooseSaveName(ctx, SAVE_SREC_FILTERS, SAVE_SREC_DEFAULT_EXT);
  if (chosen === null) return;
  const found = await existing(ctx, chosen);
  if (found !== null) {
    const answer = await messageBox(ctx, MESSAGES.fileExistsTitle, MESSAGES.fileExists, ['Yes', 'No']);
    if (answer !== 'Yes') return;
  }
  const target = found ?? chosen;
  try {
    await ctx.vfs.writeFile(target, model.sRecordBytes(plan));
  } catch {
    await showMessage(ctx, MESSAGES.errorCreating(target));
  }
}

/** Save Binary (13). */
export async function saveBinary(ctx: AppContext): Promise<void> {
  const { model } = easybinOf(ctx);
  const plan = model.binaryPlan();
  if (plan === null) {
    beep(ctx);
    await messageBox(ctx, MESSAGES.invalidRangeTitle, MESSAGES.invalidRange, ['OK']);
    return;
  }
  const chosen = await chooseSaveName(ctx, SAVE_BINARY_FILTERS, SAVE_BINARY_DEFAULT_EXT);
  if (chosen === null) return;
  const outputs = model.binaryOutputs(plan, chosen);
  const found = await Promise.all(outputs.check.map((name) => existing(ctx, name)));
  if (found.some((name) => name !== null)) {
    const answer = await messageBox(ctx, MESSAGES.fileExistsTitle, MESSAGES.fileExists, ['Yes', 'No']);
    if (answer !== 'Yes') return;
  }
  for (const [k, file] of outputs.files.entries()) {
    const target = found[k] ?? file.name;
    try {
      await ctx.vfs.writeFile(target, file.data);
    } catch {
      await showMessage(ctx, MESSAGES.errorCreating(target));
      return;
    }
  }
}

/** Copy (14.1) and Fill (14.2): their message, if any. */
export async function copyBytes(ctx: AppContext): Promise<void> {
  const message = easybinOf(ctx).model.copy();
  if (message !== null) await showMessage(ctx, message);
}
export async function fillBytes(ctx: AppContext): Promise<void> {
  const message = easybinOf(ctx).model.fill();
  if (message !== null) await showMessage(ctx, message);
}

/**
 * Files dropped on the window in EASyBIN mode (1.4): each is first tried as an S-record; when that
 * fails, `Opening as binary file.` and Open Binary's rules. The caption is the file's name.
 */
export async function openDropped(
  ctx: AppContext,
  files: readonly { name: string; data: Uint8Array }[],
): Promise<void> {
  const { model } = easybinOf(ctx);
  for (const file of files) {
    const result = model.openSRecord(file.name, file.data);
    await showMessage(ctx, result.message);
    if (result.ok) continue;
    await showMessage(ctx, MESSAGES.openingAsBinary);
    model.openBinary(file.name, file.data);
  }
}

/**
 * File > Exit. The original ends EASyBIN without a question; in the port EASyBIN is a mode of the one
 * application, so Exit ends the application as the editor's and simulator's Exit do: the editor's
 * close prompts first, then quit (desktop) or the exit screen (web, ARCHITECTURE.md 1.4 note 4).
 */
export async function exitApplication(ctx: AppContext): Promise<void> {
  if (!(await ctx.documents.closeAll())) return;
  for (const part of [ctx.sim.log, ctx.sim.files]) {
    try {
      await part.exit();
    } catch {
      // A failing simulator part does not keep the window open.
    }
  }
  if (ctx.platform.kind === 'desktop') ctx.platform.quit();
  else showExitScreen(ctx);
}

export const commands: Record<CommandId, CommandHandler> = {
  'bin.file.new': { run: newEnvironment },
  'bin.file.openSrec': { run: openSRecord },
  'bin.file.openBinary': { run: openBinary },
  'bin.file.saveSrec': { run: saveSRecord },
  'bin.file.saveBinary': { run: saveBinary },
  'bin.file.exit': { run: exitApplication },
  // Help is H1's panel; its command takes the page (docs/requests/H1-help-from-dialogs.md).
  'bin.help.help': { run: (ctx) => ctx.commands.run('ed.help.help', HELP_PAGE) },
  'bin.help.about': { run: (ctx) => void ctx.dialogs.open(ABOUT_DIALOG_ID, {}) },
  // Simulator View > EASyBIN: the original starts EASyBIN.EXE; here it is the EASyBIN mode (note 26).
  'sim.view.easybin': { run: (ctx) => ctx.commands.run('app.mode.set', 'easybin') },
};
