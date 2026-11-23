// Place keys, the untracked rule and the .git rule of the history (ARCHITECTURE-PLUS P3.3.3,
// P3.3.10, P4.3). Owner: N3.
//
// Pure; runs under Node. A `place` names a file independently of which store is mounted where:
//
//   /browser/demo/prog.X68   browser:/DEMO/PROG.X68     letter case folded with foldCase, as the
//                                                       browser store compares (P4.3)
//   /folder/<rel>            folder:<rootId>/<rel>      the spelling the backend reports
//   /linked/<id>/<name>      linked:<id>/<name>
//   /disk/<path>             disk:/<path>
//   /memory/...              not tracked
//   any other mount          <mount>:/<rel>              exact spelling (tests mount their own)
//
// The places of a folder's contents all start with `childPrefix(place of the folder)`.

import type { Bytes, VPath } from '../../contracts';
import { extractFileExt, foldCase, isVPath, splitVPath } from '../paths/winpath';
import { LARGEST_VERSION } from './limits';

/** Why a file gets no automatic versions (P3.3.3; P4.4 `untracked`). */
export type UntrackedReason = 'generated' | 'too-large' | 'not-text' | 'git' | 'memory';

/** How far a zero byte makes a file "not text" (P3.3.3, P3.4.1). */
export const TEXT_PROBE = 8192;

/** True for a segment named .git in any letter case. */
export function isGitName(segment: string): boolean {
  return segment.toLowerCase() === '.git';
}

/** True when a folder of `path` (not its last segment) is named .git, in any letter case (P3.3.10). */
export function belowGit(path: VPath): boolean {
  const segments = path.split('/');
  return segments.slice(1, -1).some(isGitName);
}

/** True when any segment of `path` below its mount, the last included, is named .git. */
export function touchesGit(path: VPath): boolean {
  return path.split('/').slice(2).some(isGitName);
}

/** Why `path` gets no automatic versions, or null when it does (P3.3.3). */
export function untrackedReason(path: VPath, size: number, head: Bytes): UntrackedReason | null {
  if (!isVPath(path) || splitVPath(path).mount === 'memory') return 'memory';
  if (belowGit(path)) return 'git';
  if (/\.(?:l68|s68)$/i.test(path)) return 'generated';
  if (size > LARGEST_VERSION) return 'too-large';
  if (head.subarray(0, TEXT_PROBE).includes(0)) return 'not-text';
  return null;
}

/**
 * The place of `path` (P4.3), or null when it is not tracked (`/memory`, not a VPath). `rootId` is
 * the root of the opened folder; a `/folder` path without one has no place.
 */
export function placeOf(path: VPath, rootId?: string | null): string | null {
  if (!isVPath(path)) return null;
  const { mount, rel } = splitVPath(path);
  switch (mount) {
    case 'memory':
      return null;
    case 'browser':
      return `browser:/${foldCase(rel)}`;
    case 'folder':
      return rootId ? `folder:${rootId}/${rel}` : null;
    case 'linked':
      return `linked:${rel}`;
    case 'disk':
      return `disk:/${rel}`;
    default:
      return `${mount}:/${rel}`;
  }
}

/** The prefix every place below the folder `place` starts with. */
export function childPrefix(place: string): string {
  return place.endsWith('/') || place.endsWith(':') ? place : `${place}/`;
}

/** True when `place` is `folder` or lies below it. */
export function placeWithin(place: string, folder: string): boolean {
  return place === folder || place.startsWith(childPrefix(folder));
}

/**
 * The name a restored file takes when the student keeps both (P3.3.8): `prog (restored).X68`, then
 * `prog (restored 2).X68` ... for `n` = 1, 2, ...
 */
export function besideName(path: VPath, n: number): VPath {
  const slash = path.lastIndexOf('/');
  const dir = path.slice(0, slash + 1);
  const name = path.slice(slash + 1);
  const ext = extractFileExt(name);
  const stem = ext === '' ? name : name.slice(0, name.length - ext.length);
  return `${dir}${stem} (restored${n > 1 ? ` ${n}` : ''})${ext}`;
}
