// The Files panel's actions (ARCHITECTURE.md 2.2, 3.8.1, 5.9): Import..., Export..., New Folder...,
// Rename..., Delete. Each takes the application context and does the whole job, questions and
// messages included; what needs the DOM (choosing files, downloading) is passed in, so that the
// tests drive these functions under Node.
//
// Owner: FS1.

import type { AppContext, VPath } from '../../contracts';
import { basename, childPath, dirname, splitVPath } from '../../core/paths/winpath';
import { invalidNameReason } from './filters';
import {
  buildExport,
  displayPath,
  isZipName,
  itemsFromZip,
  makeFolder,
  planImport,
  renameEntry,
  runImport,
  type ImportItem,
  type ImportResult,
} from './store';

export const NAME_DIALOG_ID = 'files.name';

export interface NameDialogProps {
  title: string;
  label: string;
  initial: string;
}

/** Asks for a name with the `files.name` dialog; null = cancelled. */
export function askName(ctx: AppContext, props: NameDialogProps): Promise<string | null> {
  return ctx.dialogs.open<NameDialogProps, string | null>(NAME_DIALOG_ID, props);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

async function showError(ctx: AppContext, title: string, error: unknown): Promise<void> {
  await ctx.dialogs.messageBox({
    title,
    text: error instanceof Error ? error.message : String(error),
    icon: 'error',
    buttons: ['OK'],
  });
}

/**
 * Imports files into a folder. A .zip among them is unpacked there (Import... reads back what
 * Export... wrote, 3.8.1); everything else is copied as it is, folders included. Existing files
 * are replaced only after one question for all of them.
 */
export async function importInto(
  ctx: AppContext,
  dir: VPath,
  items: readonly ImportItem[],
): Promise<ImportResult | null> {
  const expanded: ImportItem[] = [];
  const notes: string[] = [];
  for (const item of items) {
    const segments = item.rel.split('/');
    const name = segments[segments.length - 1] as string;
    if (!item.rel.endsWith('/') && isZipName(name)) {
      let bytes;
      try {
        bytes = await item.read();
      } catch {
        notes.push(`${item.rel}: could not be read`);
        continue;
      }
      if (isZipName(name, bytes)) {
        try {
          const prefix = segments.slice(0, -1).join('/');
          const zip = await itemsFromZip(bytes);
          for (const entry of zip.items)
            expanded.push({ ...entry, rel: prefix ? `${prefix}/${entry.rel}` : entry.rel });
          for (const skipped of zip.skipped) {
            if (skipped.reason !== 'resource-fork') notes.push(`${skipped.path}: ${skipped.reason}`);
          }
          continue;
        } catch (error) {
          notes.push(`${item.rel}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
      }
      expanded.push({ rel: item.rel, read: async () => bytes });
      continue;
    }
    expanded.push(item);
  }

  const plan = await planImport(ctx.vfs, dir, expanded);
  const where = displayPath(ctx.vfs, dir);
  let replaceAll = true;
  if (plan.conflicts.length > 0) {
    const text =
      plan.conflicts.length === 1
        ? `"${plan.conflicts[0]?.rel}" already exists in ${where}. Replace it?`
        : `${plan.conflicts.length} of the files already exist in ${where}. Replace them?`;
    const answer = await ctx.dialogs.messageBox({
      title: 'Import',
      text,
      icon: 'confirmation',
      buttons: ['Yes', 'No', 'Cancel'],
    });
    if (answer === 'Cancel') return null;
    replaceAll = answer === 'Yes';
  }
  const result = await runImport(ctx.vfs, plan, () => replaceAll);
  for (const refused of plan.refused) result.skipped.push({ rel: refused, reason: 'not a valid name' });
  const other = result.skipped.filter((s) => s.reason !== 'exists');
  const kept = result.skipped.length - other.length;
  let message = `Imported ${plural(result.written.length, 'file')} into ${where}.`;
  if (kept > 0) message += ` ${plural(kept, 'existing file was', 'existing files were')} kept.`;
  const problems = [...other.map((s) => `${s.rel}: ${s.reason}`), ...notes];
  if (problems.length > 0) {
    message += ` Not imported: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? '; ...' : ''}`;
  }
  ctx.dialogs.toast(message);
  return result;
}

/** Export...: downloads a file as itself, a folder or a whole store as a .zip. */
export async function exportPath(
  ctx: AppContext,
  path: VPath,
  download: (name: string, bytes: Uint8Array) => void,
): Promise<boolean> {
  try {
    const file = await buildExport(ctx.vfs, path, ctx.clock.wallTime().getTime());
    download(file.name, file.bytes);
    if (file.kind === 'zip') ctx.dialogs.toast(`Exported ${plural(file.files, 'file')} as ${file.name}.`);
    return true;
  } catch (error) {
    await showError(ctx, 'Export', error);
    return false;
  }
}

/** Delete: after a question, removes a file or a folder with everything in it. */
export async function deletePath(ctx: AppContext, path: VPath): Promise<boolean> {
  if (splitVPath(path).rel === '') return false; // a store itself cannot be deleted
  const stat = await ctx.vfs.stat(path).catch(() => null);
  if (!stat) return false;
  const name = basename(path);
  const text = stat.kind === 'dir' ? `Delete the folder "${name}" and everything in it?` : `Delete "${name}"?`;
  const answer = await ctx.dialogs.messageBox({ title: 'Delete', text, icon: 'confirmation', buttons: ['Yes', 'No'] });
  if (answer !== 'Yes') return false;
  try {
    await ctx.vfs.remove(path);
    return true;
  } catch (error) {
    await showError(ctx, 'Delete', error);
    return false;
  }
}

/** New Folder...: asks for a name and creates the folder in `parent`. Returns its path. */
export async function newFolder(ctx: AppContext, parent: VPath): Promise<VPath | null> {
  let initial = 'New Folder';
  for (;;) {
    const name = await askName(ctx, { title: 'New Folder', label: '&Name:', initial });
    if (name === null) return null;
    const trimmed = name.trim();
    const reason = invalidNameReason(trimmed);
    const target = reason ? null : childPath(parent, trimmed);
    const taken = target ? await ctx.vfs.resolve(parent, trimmed) : null;
    if (reason || taken) {
      await ctx.dialogs.messageBox({
        title: 'New Folder',
        text: reason ?? `"${trimmed}" already exists.`,
        icon: 'warning',
        buttons: ['OK'],
      });
      initial = trimmed;
      continue;
    }
    try {
      await makeFolder(ctx.vfs, target as VPath);
      return target;
    } catch (error) {
      await showError(ctx, 'New Folder', error);
      return null;
    }
  }
}

/** Rename...: asks for the new name of a file or folder. Returns the new path. */
export async function renamePath(ctx: AppContext, path: VPath): Promise<VPath | null> {
  if (splitVPath(path).rel === '') return null;
  let initial = basename(path);
  for (;;) {
    const name = await askName(ctx, { title: 'Rename', label: '&Name:', initial });
    if (name === null) return null;
    const trimmed = name.trim();
    if (trimmed === basename(path)) return null;
    const reason = invalidNameReason(trimmed);
    if (reason) {
      await ctx.dialogs.messageBox({ title: 'Rename', text: reason, icon: 'warning', buttons: ['OK'] });
      initial = trimmed;
      continue;
    }
    try {
      return await renameEntry(ctx.vfs, path, trimmed);
    } catch (error) {
      await showError(ctx, 'Rename', error);
      initial = trimmed;
    }
  }
}

/** The folder an action on `path` works in: the folder itself, or the folder of a file. */
export async function folderFor(ctx: AppContext, path: VPath | null, fallback: VPath): Promise<VPath> {
  if (!path) return fallback;
  const stat = await ctx.vfs.stat(path).catch(() => null);
  if (stat?.kind === 'dir') return path;
  if (stat?.kind === 'file') return dirname(path);
  return fallback;
}
