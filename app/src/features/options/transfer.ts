// Import and export of the original's settings files (ARCHITECTURE.md 3.10, 5.6, 1.5): the work of
// the dialog `settings.transfer`, without React. Owner: E4.
//
// Every import goes through the settings service (`ctx.settings.update`), like any other change:
// the service stamps each setting the file changed, so the import reaches every other window and
// a window that has not heard of it yet cannot write the older values back over it (3.8.6, errata
// W3 entries 26-31). The panels of sim68K.dat are shown and hidden through state/panels.ts, which
// writes the layout through the same service.
//
// Rules (3.10): an import keeps the positional reader's behaviour, so a missing line puts every
// later setting back to the original's default (dat-codec); window positions are ignored on import
// and written as the original's defaults on export; the Auto preset is exported as -1 with the
// Color1 values.

import type { AppContext, FileFilter, VPath } from '../../contracts';
import {
  SIM68K_DAT_PANELS,
  editorSettingsFromDat,
  simSettingsFromDat,
  templateFromBytes,
  templateToBytes,
  writeSettingsDat,
  writeSim68KDat,
} from '../../core/settings/dat-codec';
import { hidePanel, panelVisible, showPanel } from '../../state/panels';
import {
  TRANSFER_FILES,
  TRANSFER_UNMAPPABLE,
  transferExported,
  transferFailed,
  transferImported,
  type TransferFileKind,
} from './texts';

/** The filters of the file dialogs: the file's own extension first, then any file. */
export function transferFilters(kind: TransferFileKind): FileFilter[] {
  const any: FileFilter = { label: 'Any File  [*.*]', patterns: ['*.*'] };
  switch (kind) {
    case 'settings':
    case 'sim':
      return [{ label: 'Settings File  [.dat]', patterns: ['*.dat'] }, any];
    case 'template':
      return [{ label: 'Template File  [.NEW]', patterns: ['*.NEW'] }, any];
  }
}

const describe = (kind: TransferFileKind) => TRANSFER_FILES.find((file) => file.kind === kind)!;

/** The result of one import or export, for the dialog's status line. */
export interface TransferOutcome {
  /** 'done', 'cancelled' (the file dialog was cancelled) or 'failed'. */
  status: 'done' | 'cancelled' | 'failed';
  /** The text the dialog shows; empty when cancelled. */
  message: string;
}

/** The bytes of one file from the settings of this window. */
export function exportBytes(ctx: AppContext, kind: TransferFileKind): { bytes: Uint8Array; unmappable: number } {
  const settings = ctx.settings.get();
  switch (kind) {
    case 'settings':
      return { bytes: writeSettingsDat(settings.editor), unmappable: 0 };
    case 'sim': {
      const panels: Record<string, boolean> = {};
      for (const id of SIM68K_DAT_PANELS) panels[id] = panelVisible(ctx, id);
      return { bytes: writeSim68KDat(settings.sim, panels), unmappable: 0 };
    }
    case 'template':
      return templateToBytes(settings.editor.template);
  }
}

/** Applies the bytes of one file to the settings, through the settings service. */
export function importBytes(ctx: AppContext, kind: TransferFileKind, bytes: Uint8Array): void {
  switch (kind) {
    case 'settings': {
      const editor = editorSettingsFromDat(bytes);
      ctx.settings.update((settings) => ({ ...settings, editor: { ...settings.editor, ...editor } }));
      return;
    }
    case 'sim': {
      const { settings: sim, panels } = simSettingsFromDat(bytes);
      ctx.settings.update((settings) => ({ ...settings, sim: { ...settings.sim, ...sim } }));
      for (const id of SIM68K_DAT_PANELS) {
        if (panels[id] === panelVisible(ctx, id)) continue;
        if (panels[id]) showPanel(ctx, id, { focus: false });
        else hidePanel(ctx, id);
      }
      return;
    }
    case 'template': {
      const template = templateFromBytes(bytes);
      ctx.settings.update((settings) => ({ ...settings, editor: { ...settings.editor, template } }));
      return;
    }
  }
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Import...: asks for a file, reads it and applies it. */
export async function importFile(ctx: AppContext, kind: TransferFileKind): Promise<TransferOutcome> {
  const file = describe(kind);
  const chosen = await ctx.fileDialogs.open({
    title: file.importTitle,
    filters: transferFilters(kind),
    multiple: false,
  });
  const path = chosen?.[0];
  if (!path) return { status: 'cancelled', message: '' };
  try {
    importBytes(ctx, kind, await ctx.vfs.readFile(path));
  } catch (error) {
    return { status: 'failed', message: transferFailed(file.fileName, reasonOf(error)) };
  }
  return { status: 'done', message: transferImported(file.fileName, path) };
}

/** Where the Save dialog starts: the browser store on the web, the user-data folder on the desktop. */
function suggestedPath(ctx: AppContext, fileName: string): VPath {
  const folder = ctx.platform.kind === 'desktop' && ctx.platform.userDataDir ? ctx.platform.userDataDir : '/browser';
  return `${folder}/${fileName}`;
}

/** Export...: asks where to write the file and writes it. */
export async function exportFile(ctx: AppContext, kind: TransferFileKind): Promise<TransferOutcome> {
  const file = describe(kind);
  const extension = file.fileName.slice(file.fileName.lastIndexOf('.'));
  const path = await ctx.fileDialogs.save({
    title: file.exportTitle,
    filters: transferFilters(kind),
    defaultExt: extension,
    suggested: suggestedPath(ctx, file.fileName),
  });
  if (!path) return { status: 'cancelled', message: '' };
  const { bytes, unmappable } = exportBytes(ctx, kind);
  try {
    await ctx.vfs.writeFile(path, bytes);
  } catch (error) {
    return { status: 'failed', message: transferFailed(file.fileName, reasonOf(error)) };
  }
  const message = transferExported(file.fileName, path);
  return { status: 'done', message: unmappable > 0 ? `${message} ${TRANSFER_UNMAPPABLE}` : message };
}
