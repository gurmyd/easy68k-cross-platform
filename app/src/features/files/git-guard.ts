// Folders named .git in the Files panel (ARCHITECTURE-PLUS P1.1 rule 2, P3.2.2, P3.2.4, P3.3.10).
// No command of the Files panel writes, deletes, moves or copies anything below a folder named
// .git (any letter case): the panel does not list such a folder, refuses a folder that holds one,
// and refuses one as a target. Plain functions on the Vfs; tested under Node. Owner: N5.

import type { Vfs, VPath } from '../../contracts';
import { basename, childPath, isWithin, sameName, splitVPath } from '../../core/paths/winpath';
import { gitPathRefused, gitStoreRefused } from './texts';

/** A name that is `.git` in any letter case. */
export function isGitName(name: string): boolean {
  return sameName(name, '.git');
}

/** True when `path` is a folder named .git or lies below one (any letter case). */
export function touchesGit(path: VPath): boolean {
  const { rel } = splitVPath(path);
  return rel !== '' && rel.split('/').some(isGitName);
}

/**
 * The name of the folder of the student's computer that the store of `path` is, when that folder is
 * itself named .git (Open Folder... or a drop chose a repository's .git folder); else null. Every
 * path of such a store lies below a folder named .git, although no segment of it says so.
 */
export function gitStoreName(vfs: Pick<Vfs, 'backends'>, path: VPath): string | null {
  const { mount } = splitVPath(path);
  const backend = vfs.backends().find((b) => b.mount === mount) as
    ({ label: string; rootHandle?: { name?: unknown } } & object) | undefined;
  const name = backend?.rootHandle?.name;
  return typeof name === 'string' && isGitName(name) ? name : null;
}

/**
 * True when a write or removal at `path` would land below a folder named .git (P1.1 rule 2): a
 * segment of the path is .git, or the store is an opened folder named .git.
 */
export function writesBelowGit(vfs: Pick<Vfs, 'backends'>, path: VPath): boolean {
  return touchesGit(path) || gitStoreName(vfs, path) !== null;
}

/**
 * The first of `paths` (items, their targets) a command of the Files panel may not write or remove,
 * with the text that refuses it (errata N5 entry 15), or null when every path may be used.
 */
export function gitRefusalFor(vfs: Pick<Vfs, 'backends'>, paths: readonly VPath[]): string | null {
  for (const path of paths) {
    const store = gitStoreName(vfs, path);
    if (store !== null) return gitStoreRefused(store);
    if (touchesGit(path)) {
      const segment = splitVPath(path).rel.split('/').find(isGitName) ?? '.git';
      return gitPathRefused(segment);
    }
  }
  return null;
}

/**
 * The folder at or below `folder` that holds a folder named .git, first in the tree's order
 * (folders before files, names without regard to letter case), or null. Only folders are walked:
 * a repository is a folder holding `.git`. `limit` bounds the folders visited (a very large tree
 * is walked to its end anyway; the limit exists for tests).
 */
export async function findGitHolder(vfs: Vfs, folder: VPath, limit = Infinity): Promise<VPath | null> {
  let visited = 0;
  const walk = async (dir: VPath): Promise<VPath | null> => {
    if (++visited > limit) return null;
    let entries;
    try {
      entries = await vfs.list(dir);
    } catch {
      return null;
    }
    const dirs = entries
      .filter((entry) => entry.kind === 'dir')
      .map((entry) => entry.name)
      .sort((a, b) => {
        const x = a.toLocaleLowerCase();
        const y = b.toLocaleLowerCase();
        return x < y ? -1 : x > y ? 1 : 0;
      });
    if (dirs.some(isGitName)) return dir;
    for (const name of dirs) {
      const found = await walk(childPath(dir, name));
      if (found) return found;
    }
    return null;
  };
  return walk(folder);
}

/**
 * How a refusal names the repository: null when `folder` itself holds .git, otherwise the holder's
 * path from the folder's own name on ("Courses/lab3").
 */
export function innerName(folder: VPath, holder: VPath): string | null {
  if (holder === folder || !isWithin(holder, folder)) return null;
  return `${basename(folder)}${holder.slice(folder.length)}`;
}
