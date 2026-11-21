// The browser side of the Files feature: choosing files with <input type="file">, downloading
// bytes, and reading a drop (ARCHITECTURE.md 3.8.1, 3.8.5). Everything that touches the DOM is
// here; the decisions live in store.ts and drop.ts.
//
// Owner: FS1.

import type { Bytes } from '../../contracts';
import type { DroppedItem } from './drop';
import type { ImportItem } from './store';

/** True when the page has a document (not under Node). */
export function hasDom(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined';
}

export interface PickOptions {
  /** The accept attribute ('.x68,.asm'); '' = any file. */
  accept?: string;
  multiple?: boolean;
  /** Choose a folder (webkitdirectory): every file below it is returned with webkitRelativePath. */
  folder?: boolean;
}

/**
 * Shows the browser's file chooser. Must be called from a user gesture (a click handler), before
 * any await. Resolves to the chosen files, or null when the user cancelled.
 */
export function pickFiles(options: PickOptions = {}): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (options.accept) input.accept = options.accept;
    input.multiple = options.multiple ?? false;
    if (options.folder) {
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
    }
    input.style.position = 'fixed';
    input.style.left = '-10000px';
    input.setAttribute('aria-hidden', 'true');
    input.tabIndex = -1;
    let done = false;
    const finish = (files: File[] | null) => {
      if (done) return;
      done = true;
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () =>
      finish(input.files && input.files.length > 0 ? Array.from(input.files) : null),
    );
    input.addEventListener('cancel', () => finish(null));
    // Browsers without the 'cancel' event: the window gets the focus back when the chooser closes;
    // if no 'change' follows soon, the user cancelled.
    // Not for a folder. There the browser asks "Upload N files to this site?" after the chooser has
    // closed, and hands the files over only when the person has answered and it has listed them:
    // that can be many seconds after the focus came back, and giving up after one second dropped
    // the whole import without a word. A folder choice ends only with 'change' or 'cancel'.
    const onFocus = () => {
      if (options.folder) return;
      setTimeout(() => finish(input.files && input.files.length > 0 ? Array.from(input.files) : null), 1000);
    };
    window.addEventListener('focus', onFocus);
    document.body.append(input);
    input.click();
  });
}

/** The bytes of a File. */
export async function readFileBytes(file: Blob): Promise<Bytes> {
  return new Uint8Array(await file.arrayBuffer());
}

/** Files chosen with pickFiles as import items, keeping the folder structure of a chosen folder. */
export function importItemsOf(files: readonly File[]): ImportItem[] {
  return files.map((file) => {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    return { rel: relative && relative !== '' ? relative : file.name, read: () => readFileBytes(file) };
  });
}

/** Offers bytes to the user as a download with the given file name. */
export function downloadBytes(name: string, bytes: Bytes, type = 'application/octet-stream'): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoke later: Safari starts the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

interface EntryLike {
  isDirectory: boolean;
}
interface ItemLike {
  kind: string;
  getAsFile(): File | null;
  webkitGetAsEntry?: () => EntryLike | null;
  getAsFileSystemHandle?: () => Promise<unknown>;
}

/** True if a drag carries files from outside the page. */
export function carriesFiles(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes('Files'));
}

/**
 * The dropped files and folders, in the drop's order. Must run inside the drop event: the items
 * stop being readable when the event handler returns, so files and handles are taken at once.
 */
export function droppedItems(dataTransfer: DataTransfer): DroppedItem[] {
  const out: DroppedItem[] = [];
  const items = dataTransfer.items ? (Array.from(dataTransfer.items) as unknown as ItemLike[]) : [];
  if (items.length > 0) {
    for (const item of items) {
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry?.() ?? null;
      let handle: Promise<unknown> | null;
      try {
        handle = item.getAsFileSystemHandle ? item.getAsFileSystemHandle() : null;
        handle?.catch(() => null);
      } catch {
        handle = null;
      }
      const file = item.getAsFile();
      const isFolder = entry?.isDirectory === true;
      out.push({
        name: file?.name ?? '',
        isFolder,
        read: () => (file && !isFolder ? readFileBytes(file) : Promise.reject(new Error('not a readable file'))),
        handle,
        file,
      });
    }
    return out;
  }
  for (const file of Array.from(dataTransfer.files)) {
    out.push({ name: file.name, isFolder: false, read: () => readFileBytes(file), handle: null, file });
  }
  return out;
}
