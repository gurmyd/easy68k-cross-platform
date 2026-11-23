// The text a person reads for a path (ARCHITECTURE-PLUS P3.2.5, P4.5). Owner: N0.
//
// Pure; runs under Node. Callers pass ctx.vfs.backends() mapped to PlaceLabels:
//
//   placeText(ctx.vfs.backends().map(({ mount, label, kind }) => ({ mount, label, kind })), path, ctx.platform.kind)
//
// The internal path of a linked file (/linked/<id>/<name>) is never shown: a linked file is named
// by its own name and the words "on this computer". The rules, by the mount of the path:
//
//   /browser/demo/prog.X68   My Programs/demo/prog.X68                          (both forms)
//   /linked/<id>/lab1.X68    lab1.X68 - on this computer, edited in place       placeShort: lab1.X68 (on this computer)
//   /folder/prog.X68         Lab/prog.X68 - in the folder "Lab" on this computer placeShort: Lab/prog.X68
//                            (the folder's backend label is "Folder: Lab"; the "Folder: " is left out)
//   /disk/Users/me/x.X68     /Users/me/x.X68 in the desktop app (the real path)  placeShort: the same
//   /linked, /linked/<id>    the linked store's label, "Linked files" when it is not mounted
//   anything else            <label>/<rel>, the root of a mount its label, an unknown mount the path itself

import type { FileSystemBackend, VPath } from '../../contracts';
import { isVPath, splitVPath } from '../paths/winpath';
import {
  FOLDER_LABEL_PREFIX,
  FOLDER_ROOT_SUFFIX,
  LINKED_FALLBACK_LABEL,
  LINKED_SHORT_SUFFIX,
  LINKED_SUFFIX,
  folderSuffix,
} from './texts';

export interface PlaceLabels {
  mount: string;
  label: string;
  kind: FileSystemBackend['kind'];
}

/** The mount names of P4.3 that have a text of their own. */
const LINKED_MOUNT = 'linked';
const FOLDER_MOUNT = 'folder';

/**
 * The name a person reads for a mount: for the opened folder its own name ("Lab"), without the
 * `Folder: ` that its backend's label (FS2's folderLabel) puts in front for the dialogs and the Files
 * panel; for every other mount its label as it is.
 */
function nameOf(mount: string, label: string): string {
  return mount === FOLDER_MOUNT && label.startsWith(FOLDER_LABEL_PREFIX)
    ? label.slice(FOLDER_LABEL_PREFIX.length)
    : label;
}

/** `label/rel`, or the label alone for the root of the mount. */
function labelled(label: string, rel: string): string {
  return rel === '' ? label : `${label}/${rel}`;
}

/**
 * The real path of a /disk path: "/disk/Users/me/x.X68" is "/Users/me/x.X68"; on Windows, where the
 * desktop app runs only for development and tests, "/disk/C:/Users/x" is "C:\Users\x" (the rules of
 * realPathOf in desktop/src/security.ts, which the page cannot import).
 */
function realPath(rel: string): string {
  const [first, ...rest] = rel.split('/');
  if (first !== undefined && /^[A-Za-z]:$/.test(first)) return `${first}\\${rest.join('\\')}`;
  return `/${rel}`;
}

interface Resolved {
  mount: string;
  rel: string;
  labels: PlaceLabels | undefined;
}

function resolve(labels: readonly PlaceLabels[], path: VPath): Resolved | null {
  if (!isVPath(path)) return null;
  const { mount, rel } = splitVPath(path);
  return { mount, rel, labels: labels.find((entry) => entry.mount === mount) };
}

/** The name of a linked file: /linked/<id>/<name> gives <name> ("" for the mount or an id folder). */
function linkedName(rel: string): string {
  return rel.split('/').slice(1).join('/');
}

/** The text a person reads for a path (P3.2.5): the status bar, the document tab's tool-tip. */
export function placeText(labels: readonly PlaceLabels[], path: VPath, platformKind: 'web' | 'desktop'): string {
  const place = resolve(labels, path);
  if (!place) return path;
  const { mount, rel, labels: entry } = place;
  if (mount === LINKED_MOUNT) {
    const name = linkedName(rel);
    return name === '' ? (entry?.label ?? LINKED_FALLBACK_LABEL) : `${name}${LINKED_SUFFIX}`;
  }
  if (entry?.kind === 'disk' && platformKind === 'desktop') return realPath(rel);
  if (!entry) return path;
  if (mount === FOLDER_MOUNT) {
    const name = nameOf(mount, entry.label);
    return rel === '' ? `${name}${FOLDER_ROOT_SUFFIX}` : `${labelled(name, rel)}${folderSuffix(name)}`;
  }
  return labelled(entry.label, rel);
}

/** The short form for messages: "lab1.X68 (on this computer)", "My Programs/demo/prog.X68". */
export function placeShort(labels: readonly PlaceLabels[], path: VPath): string {
  const place = resolve(labels, path);
  if (!place) return path;
  const { mount, rel, labels: entry } = place;
  if (mount === LINKED_MOUNT) {
    const name = linkedName(rel);
    return name === '' ? (entry?.label ?? LINKED_FALLBACK_LABEL) : `${name}${LINKED_SHORT_SUFFIX}`;
  }
  if (!entry) return path;
  if (entry.kind === 'disk') return realPath(rel);
  return labelled(nameOf(mount, entry.label), rel);
}
