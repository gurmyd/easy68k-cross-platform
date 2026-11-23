// The Files panel's actions (ARCHITECTURE.md 2.2, 3.8.1, 5.9): Import..., Export..., New Folder...,
// Rename..., Delete. Each takes the application context and does the whole job, questions and
// messages included; what needs the DOM (choosing files, downloading) is passed in, so that the
// tests drive these functions under Node.
//
// ARCHITECTURE-PLUS (N5): Delete is the one-item case of bulk.ts; Import passes the question of
// import-guard.ts and keeps a replaced file's bytes as `Before import`, and is otherwise main's,
// also below .git (P1.1 rule 2); Rename refuses a folder that holds .git and lets the history and
// an open document follow.
//
// Owner: FS1 > N5.

import type { AppContext, VPath } from '../../contracts';
import { basename, childPath, dirname, splitVPath } from '../../core/paths/winpath';
import { deleteItems, exportItems, inform, openDocumentsAt, type FilesDeps } from './bulk';
import { invalidNameReason } from './filters';
import { findGitHolder, gitRefusalFor, innerName, isGitName } from './git-guard';
import { guardImport, type StorageEstimator } from './import-guard';
import {
  NEW_FOLDER_INITIAL_NAME,
  NEW_FOLDER_TITLE,
  RENAME_TITLE,
  changedAfterRenaming,
  exportedToast,
  gitNameRefused,
  gitRefusal,
  goneAfterRenaming,
  openInEditor,
} from './texts';
import { renameChecked } from './rename';
import { filesDeps } from './undo';
import {
  type BeforeReplace,
  displayPath,
  isZipName,
  itemsFromZip,
  makeFolder,
  planImport,
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
  options: { estimate?: StorageEstimator } = {},
): Promise<ImportResult | null> {
  // ARCHITECTURE-PLUS P1.1 rule 2: Import is unchanged, also below a folder named .git and in an
  // opened folder that is itself one (decided by the architect, 22 November 2026; errata N5 entry 19):
  // no refusal and nothing left out here, as on main. The history keeps nothing there (`untracked`).
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
      expanded.push({ rel: item.rel, read: async () => bytes, size: bytes.length });
      continue;
    }
    expanded.push(item);
  }

  // ARCHITECTURE-PLUS P3.2.6: a question before a large import into the browser's storage.
  const fileItems = expanded.filter((item) => !item.rel.endsWith('/'));
  const bytes = fileItems.reduce((sum, item) => sum + (item.size ?? 0), 0);
  const goOn = await guardImport(
    { vfs: ctx.vfs, dialogs: ctx.dialogs, estimate: options.estimate ?? null, where: (d) => displayPath(ctx.vfs, d) },
    dir,
    fileItems.length,
    bytes,
  );
  if (!goOn) return null;

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
  const result = await runImport(ctx.vfs, plan, () => replaceAll, keepBeforeImport(ctx));
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

/** The largest file the history gives versions (P3.3.4); larger ones are not read for it. */
const LARGEST_VERSIONED = 1024 * 1024;

/**
 * ARCHITECTURE-PLUS P3.3.4: an import that replaces a file keeps its current bytes as `Before
 * import`, for a file that gets versions, without waiting for the history.
 */
export function keepBeforeImport(ctx: AppContext): BeforeReplace | undefined {
  const history = ctx.history;
  if (!history) return undefined;
  return async (path) => {
    const stat = await ctx.vfs.stat(path).catch(() => null);
    if (stat?.kind !== 'file' || stat.size > LARGEST_VERSIONED) return;
    const current = await ctx.vfs.readFile(path).catch(() => null);
    if (!current || history.untracked(path, current.length, current.subarray(0, 8192)) !== null) return;
    void history.record(path, current, 'before-import', ctx.clock.wallTime().getTime()).catch(() => {});
  };
}

/** `keep` of importOne: the current bytes of a file the copy replaces, as `Before import`. */
export function keepImportedCopy(ctx: AppContext): ((path: VPath, current: Uint8Array) => void) | undefined {
  const history = ctx.history;
  if (!history) return undefined;
  return (path, current) => {
    if (history.untracked(path, current.length, current.subarray(0, 8192)) !== null) return;
    void history.record(path, current, 'before-import', ctx.clock.wallTime().getTime()).catch(() => {});
  };
}

/**
 * Export...: downloads a file as itself, a folder or a whole store as a .zip, several items as one
 * `EASy68K export.zip` (ARCHITECTURE-PLUS P3.2.3). Folders named .git are left out.
 */
export async function exportPath(
  ctx: AppContext,
  path: VPath | readonly VPath[],
  download: (name: string, bytes: Uint8Array) => void,
): Promise<boolean> {
  const paths = typeof path === 'string' ? [path] : path;
  try {
    const file = await exportItems(ctx.vfs, paths, ctx.clock.wallTime().getTime());
    download(file.name, file.bytes);
    if (file.kind === 'zip') ctx.dialogs.toast(exportedToast(file.files, file.name));
    return true;
  } catch (error) {
    await showError(ctx, 'Export', error);
    return false;
  }
}

/**
 * Delete: the one-item case of the Files panel's Delete (bulk.ts, ARCHITECTURE-PLUS P3.2.2): the
 * question, then the item through ctx.history.guard. True when it was deleted.
 */
export async function deletePath(ctx: AppContext, path: VPath): Promise<boolean> {
  if (splitVPath(path).rel === '') return false; // a store itself cannot be deleted
  const outcome = await deleteItems(filesDeps(ctx), [path]);
  return outcome.deleted.includes(path) || outcome.removedLinked.includes(path);
}

/** New Folder...: asks for a name and creates the folder in `parent`. Returns its path. */
export async function newFolder(ctx: AppContext, parent: VPath): Promise<VPath | null> {
  const store = gitRefusalFor(ctx.vfs, [parent]);
  if (store !== null) {
    await inform(ctx, NEW_FOLDER_TITLE, store);
    return null;
  }
  let initial = NEW_FOLDER_INITIAL_NAME;
  for (;;) {
    const name = await askName(ctx, { title: NEW_FOLDER_TITLE, label: '&Name:', initial });
    if (name === null) return null;
    const trimmed = name.trim();
    // ARCHITECTURE-PLUS P1.1 rule 2: no folder named .git is made (errata N5 entry 15).
    const reason = invalidNameReason(trimmed) ?? (isGitName(trimmed) ? gitNameRefused(trimmed) : null);
    const target = reason ? null : childPath(parent, trimmed);
    const taken = target ? await ctx.vfs.resolve(parent, trimmed) : null;
    if (reason || taken) {
      await ctx.dialogs.messageBox({
        title: NEW_FOLDER_TITLE,
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
      await showError(ctx, NEW_FOLDER_TITLE, error);
      return null;
    }
  }
}

/**
 * Rename...: asks for the new name of a file or folder. Returns the new path. ARCHITECTURE-PLUS
 * P3.2.4: a folder that holds .git is not renamed; while DocumentService.relocate does not exist an
 * open file is not renamed; otherwise its document follows, and so does its history (moved).
 */
export async function renamePath(ctx: AppContext, path: VPath): Promise<VPath | null> {
  if (splitVPath(path).rel === '' || splitVPath(path).mount === 'linked') return null;
  const deps = filesDeps(ctx);
  if (await renameRefused(deps, path)) return null;
  const renamed = await askAndRename(ctx, path);
  if (renamed === null) return null;
  await afterRename(deps, path, renamed);
  return renamed;
}

/** Rename's refusals (P3.2.4): a folder that holds .git; an open file while relocate is missing. */
export async function renameRefused(deps: FilesDeps, path: VPath): Promise<boolean> {
  const gitText = gitRefusalFor(deps.vfs, [path]);
  if (gitText !== null) {
    await inform(deps, RENAME_TITLE, gitText);
    return true;
  }
  const stat = await deps.vfs.stat(path).catch(() => null);
  if (stat?.kind === 'dir') {
    const holder = await findGitHolder(deps.vfs, path);
    if (holder) {
      await inform(deps, RENAME_TITLE, gitRefusal(basename(path), innerName(path, holder), 'rename'));
      return true;
    }
  }
  if (!deps.documents.relocate) {
    const open = openDocumentsAt(deps.documents, path)[0];
    if (open?.path) {
      await inform(deps, RENAME_TITLE, openInEditor(basename(open.path), 'rename'));
      return true;
    }
  }
  return false;
}

/** After renameEntry: the history and an open document follow, and Undo Rename is offered. */
export async function afterRename(deps: FilesDeps, from: VPath, to: VPath): Promise<void> {
  await deps.history?.moved(from, to).catch(() => {});
  if (openDocumentsAt(deps.documents, from).length > 0) await deps.documents.relocate?.(from, to).catch(() => {});
  deps.undo.push({ kind: 'rename', pairs: [[from, to]], folders: [], created: [], replaced: [] });
}

async function askAndRename(ctx: AppContext, path: VPath): Promise<VPath | null> {
  let initial = basename(path);
  for (;;) {
    const name = await askName(ctx, { title: RENAME_TITLE, label: '&Name:', initial });
    if (name === null) return null;
    const trimmed = name.trim();
    if (trimmed === basename(path)) return null;
    // ARCHITECTURE-PLUS P1.1 rule 2: nothing is renamed to .git (errata N5 entry 15).
    const reason = invalidNameReason(trimmed) ?? (isGitName(trimmed) ? gitNameRefused(trimmed) : null);
    if (reason) {
      await ctx.dialogs.messageBox({ title: RENAME_TITLE, text: reason, icon: 'warning', buttons: ['OK'] });
      initial = trimmed;
      continue;
    }
    let renamed: VPath;
    const kept: VPath[] = [];
    const gone: VPath[] = [];
    let copies: VPath | null = null;
    try {
      renamed = await renameChecked(ctx.vfs, path, trimmed, {
        kept: (files, folder) => {
          kept.push(...files);
          copies = folder;
        },
        gone: (files) => void gone.push(...files),
      });
    } catch (error) {
      await showError(ctx, RENAME_TITLE, error);
      initial = trimmed;
      continue;
    }
    // A file that changed at the last moment stayed under the old name; one that was moved or
    // deleted meanwhile has no copy under the new name (errata N5 entry 18).
    for (const file of kept) {
      await inform(ctx, RENAME_TITLE, changedAfterRenaming(basename(file), displayPath(ctx.vfs, copies ?? renamed)));
    }
    for (const file of gone) {
      await inform(ctx, RENAME_TITLE, goneAfterRenaming(basename(file), displayPath(ctx.vfs, renamed)));
    }
    return renamed;
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
