// Folders named .git in the Files panel (ARCHITECTURE-PLUS P1.1 rule 2, P3.2.2, P3.2.4, P3.3.10).
// No command of the Files panel writes, deletes, moves or copies anything below a folder named
// .git (any letter case): the panel does not list such a folder, refuses a folder that holds one,
// and refuses one as a target. Plain functions on the Vfs; tested under Node. Owner: N5.

import type { Vfs, VPath } from '../../contracts';
import { basename, childPath, isWithin, sameName, splitVPath } from '../../core/paths/winpath';

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
