// Path rules (ARCHITECTURE.md 3.8): virtual paths (VPath) and the Windows-style names that 68000
// programs, INCLUDE lines and users give.
//
// A VPath is absolute, "/<mount>/<segment>/...", with '/' separators and letter case as stored. It
// has no trailing '/', no empty segment, no "." or "..". The root of a mount is "/<mount>".
//
// A Windows-style name uses '\' and '/' alike as separators; "." and ".." are resolved
// lexically, before anything is looked up, as Windows does. Letter case is compared with
// foldCase(), which upper-cases one character at a time as Windows' file systems do.
//
// Owner: W1. Pure functions; runs under Node and in browsers.

import type { VPath } from '../../contracts';

/** True for "/<mount>" and "/<mount>/<segment>/..." in normal form. */
export function isVPath(path: string): boolean {
  if (!path.startsWith('/') || path.length < 2 || path.endsWith('/')) return false;
  return path
    .slice(1)
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..' && !segment.includes('\\'));
}

/** Throws unless `path` is a VPath in normal form. */
export function assertVPath(path: string): void {
  if (!isVPath(path)) throw new TypeError(`not a virtual path: "${path}"`);
}

/** "/browser/demo/prog.X68" -> { mount: "browser", rel: "demo/prog.X68" }; the mount root has rel "". */
export function splitVPath(path: VPath): { mount: string; rel: string } {
  assertVPath(path);
  const slash = path.indexOf('/', 1);
  return slash < 0 ? { mount: path.slice(1), rel: '' } : { mount: path.slice(1, slash), rel: path.slice(slash + 1) };
}

/** The mount name of a VPath. */
export function mountOf(path: VPath): string {
  return splitVPath(path).mount;
}

/** The VPath of `rel` (a path inside the mount, '/' separators, "" for the root) in `mount`. */
export function joinVPath(mount: string, rel: string): VPath {
  const path = rel === '' ? `/${mount}` : `/${mount}/${rel}`;
  assertVPath(path);
  return path;
}

/** Appends one or more segments (no separators inside) to a VPath. */
export function childPath(dir: VPath, ...segments: string[]): VPath {
  const path = [dir, ...segments].join('/');
  assertVPath(path);
  return path;
}

/** The folder of a VPath; the root of a mount is its own folder. "/browser/demo/p.X68" -> "/browser/demo". */
export function dirname(path: VPath): VPath {
  assertVPath(path);
  const slash = path.lastIndexOf('/');
  return slash === 0 ? path : path.slice(0, slash);
}

/** The last segment of a VPath (the mount name for a mount root). */
export function basename(path: VPath): string {
  assertVPath(path);
  return path.slice(path.lastIndexOf('/') + 1);
}

/** True if `path` is `prefix` or lies below it (exact letter case). */
export function isWithin(path: VPath, prefix: VPath): boolean {
  return path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
}

/**
 * The extension of a file name including its '.', or "" (VCL ExtractFileExt). Only the last
 * segment counts; '\', '/' and ':' end the folder part.
 */
export function extractFileExt(name: string): string {
  const cut = Math.max(name.lastIndexOf('\\'), name.lastIndexOf('/'), name.lastIndexOf(':'));
  const dot = name.lastIndexOf('.');
  return dot > cut ? name.slice(dot) : '';
}

/** Replaces the extension of a file name, or appends `ext` when there is none (VCL ChangeFileExt). */
export function changeFileExt(name: string, ext: string): string {
  const cut = Math.max(name.lastIndexOf('\\'), name.lastIndexOf('/'), name.lastIndexOf(':'));
  const dot = name.lastIndexOf('.');
  return (dot > cut ? name.slice(0, dot) : name) + ext;
}

/**
 * Upper-cases one character at a time, keeping the length (so "ß" stays "ß"), which is how
 * Windows compares file names without regard to case.
 */
export function foldCase(name: string): string {
  let out = '';
  for (const ch of name) {
    const upper = ch.toUpperCase();
    out += upper.length === ch.length ? upper : ch;
  }
  return out;
}

/** True if two names are equal without regard to letter case. */
export function sameName(a: string, b: string): boolean {
  return a === b || foldCase(a) === foldCase(b);
}

/**
 * The entry of `names` that `name` refers to: the exact match if there is one, otherwise the first
 * match without regard to case, otherwise null.
 */
export function matchName(names: Iterable<string>, name: string): string | null {
  let loose: string | null = null;
  const folded = foldCase(name);
  for (const candidate of names) {
    if (candidate === name) return candidate;
    if (loose === null && foldCase(candidate) === folded) loose = candidate;
  }
  return loose;
}

/** True if the name starts with a drive letter ("C:", "c:\x"). */
export function hasDriveLetter(name: string): boolean {
  return /^[A-Za-z]:/.test(name);
}

/** True if the name starts with '\' or '/' (absolute on the current drive, or a UNC name). */
export function isRooted(name: string): boolean {
  return name.startsWith('\\') || name.startsWith('/');
}

/** The segments of a Windows-style name: split at '\' and '/', empty segments dropped. */
export function splitWindowsName(name: string): string[] {
  return name.split(/[\\/]/).filter((segment) => segment !== '');
}

/**
 * Resolves a Windows-style relative name against a folder, lexically: '\' and '/' separate, "."
 * is dropped, ".." goes up one folder. Returns null when the name is empty, has a drive letter,
 * starts with a separator, or uses ".." to leave the mount of `dir`. Letter case is kept as given;
 * matching names against stored ones is the caller's job (matchName()).
 *
 *     resolveLexically('/browser/demo', 'sub\\..\\data.txt')  -> '/browser/demo/data.txt'
 *     resolveLexically('/browser/demo', '..\\..\\x')           -> null (leaves /browser)
 */
export function resolveLexically(dir: VPath, name: string): VPath | null {
  const { mount, rel } = splitVPath(dir);
  if (name === '' || hasDriveLetter(name) || isRooted(name)) return null;
  const segments = rel === '' ? [] : rel.split('/');
  for (const segment of splitWindowsName(name)) {
    if (segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return joinVPath(mount, segments.join('/'));
}

/** The path of `path` relative to `root` ('/' separators), or null if it is not below `root`. */
export function relativeTo(root: VPath, path: VPath): string | null {
  if (path === root) return '';
  return isWithin(path, root) ? path.slice(root.length + 1) : null;
}
