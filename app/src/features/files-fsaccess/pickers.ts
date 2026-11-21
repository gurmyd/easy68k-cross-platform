// The browser's own pickers (File System Access API, Chromium): their options, and how the port's
// file filters become the picker's file types. Plain functions, tested under Node.
//
// Owner: FS2.

import type { FileFilter } from '../../contracts';
import type { FsaDirectoryHandle, FsaFileHandle, FsaHandle } from '../../fs/fsaccess-backend';

/** The id under which Chromium remembers the last folder of each picker. */
export const FOLDER_PICKER_ID = 'easy68k-folder';
export const FILE_PICKER_ID = 'easy68k-file';

export interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: FsaHandle;
}

export interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}

export interface OpenFilePickerOptions {
  id?: string;
  multiple?: boolean;
  types?: PickerType[];
  excludeAcceptAllOption?: boolean;
  startIn?: FsaHandle;
}

/** The two pickers, as window.showDirectoryPicker and window.showOpenFilePicker give them. */
export interface Pickers {
  showDirectoryPicker(options: DirectoryPickerOptions): Promise<FsaDirectoryHandle>;
  showOpenFilePicker(options: OpenFilePickerOptions): Promise<FsaFileHandle[]>;
}

/** What Chromium accepts as an extension of a picker type (".X68", ".tar.gz"; at most 16 characters). */
const EXTENSION = /^\.[A-Za-z0-9+]+(?:\.[A-Za-z0-9+]+)*$/;

/**
 * The picker's file types for the port's filters, in the same order (the first is preselected).
 * "*.X68" becomes ".X68"; a filter that matches everything ("*.*", "*") is left to the picker's own
 * "All files" choice, and a pattern the picker cannot express drops out (a filter left with none
 * drops out too).
 */
export function pickerTypes(filters: readonly FileFilter[]): PickerType[] {
  const types: PickerType[] = [];
  for (const filter of filters) {
    const extensions: string[] = [];
    for (const pattern of filter.patterns) {
      const match = /^\*(\.[^*?]+)$/.exec(pattern.trim());
      const extension = match?.[1];
      if (extension && extension.length <= 16 && EXTENSION.test(extension) && !extensions.includes(extension)) {
        extensions.push(extension);
      }
    }
    if (extensions.length > 0) {
      types.push({ description: filter.label.replace(/\s+/g, ' ').trim(), accept: { 'text/plain': extensions } });
    }
  }
  return types;
}

/** True for the error a picker rejects with when the user closed it without choosing. */
export function isPickerCancel(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'AbortError';
}
