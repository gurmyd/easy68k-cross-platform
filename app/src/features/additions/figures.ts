// The figures of the Storage group of Options > Port Additions... (ARCHITECTURE-PLUS P3.5, P3.2.6,
// P3.3.7): what My Programs holds, the two halves of the history (`HistoryService.usage()`) and, in a
// browser, the site's storage estimate. Pure apart from the calls it is given; tested under Node
// (additions.test.ts). Owner: N7.

import type { HistoryService, Vfs, VPath } from '../../contracts';
import {
  CLEARING_SITE_DATA,
  DESKTOP_STORAGE_LINE,
  EARLIER_VERSIONS_LABEL,
  MY_PROGRAMS_LABEL,
  TRASH_LABEL,
  filesFigure,
  siteUsageLine,
  trashFigure,
  versionsFigure,
} from './texts';

/** The mount of the browser store, "My Programs" (main 3.8.1). */
export const MY_PROGRAMS_MOUNT = 'browser';

/** What `navigator.storage.estimate()` gives, as far as the dialog uses it. */
export interface SiteEstimate {
  usage?: number;
  quota?: number;
}

export interface FiguresDeps {
  vfs: Vfs;
  /** `ctx.history`; absent: both halves read as zero. */
  history?: HistoryService | undefined;
  /** `navigator.storage.estimate`, or null where there is none (and always null in the desktop app). */
  estimate: (() => Promise<SiteEstimate>) | null;
  platformKind: 'web' | 'desktop';
}

export interface StorageFigures {
  /** Files and bytes below /browser; null when the browser store is not mounted (desktop app). */
  myPrograms: { files: number; bytes: number } | null;
  versions: number;
  versionBytes: number;
  trashItems: number;
  trashBytes: number;
  /** The estimate (browser only): `usage`, and `quota - usage` or null without a quota. */
  site: { usage: number; free: number | null } | null;
  desktop: boolean;
}

/** Every file below `dir`, counted with its size; folders that cannot be listed are skipped. */
export async function countFiles(vfs: Vfs, dir: VPath): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  const pending: VPath[] = [dir];
  while (pending.length > 0) {
    const current = pending.pop() as VPath;
    let entries;
    try {
      entries = await vfs.list(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = `${current}/${entry.name}`;
      if (entry.kind === 'dir') {
        pending.push(path);
        continue;
      }
      try {
        const stat = await vfs.stat(path);
        if (stat && stat.kind === 'file') {
          files++;
          bytes += stat.size;
        }
      } catch {
        // A file that went away while counting is not counted.
      }
    }
  }
  return { files, bytes };
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Reads every figure of the group. Never rejects: what cannot be read is left out or zero. */
export async function readFigures(deps: FiguresDeps): Promise<StorageFigures> {
  const desktop = deps.platformKind === 'desktop';
  const mounted = deps.vfs.backends().some((backend) => backend.mount === MY_PROGRAMS_MOUNT);
  const [myPrograms, usage, site] = await Promise.all([
    mounted ? countFiles(deps.vfs, `/${MY_PROGRAMS_MOUNT}`) : Promise.resolve(null),
    deps.history ? deps.history.usage().catch(() => null) : Promise.resolve(null),
    !desktop && deps.estimate
      ? deps.estimate().then(
          (estimate) => {
            if (!finite(estimate?.usage)) return null;
            return { usage: estimate.usage, free: finite(estimate.quota) ? estimate.quota - estimate.usage : null };
          },
          () => null,
        )
      : Promise.resolve(null),
  ]);
  return {
    myPrograms,
    versions: usage?.versions ?? 0,
    versionBytes: usage?.versionBytes ?? 0,
    trashItems: usage?.trashItems ?? 0,
    trashBytes: usage?.trashBytes ?? 0,
    site,
    desktop,
  };
}

/** One line of the group: a label with its figure, or a sentence on its own. */
export type StorageLine =
  | { kind: 'figure'; id: 'programs' | 'versions' | 'trash'; label: string; value: string }
  | { kind: 'text'; id: 'site' | 'clearing' | 'desktop'; text: string };

/** The lines of the group, in the order of P3.5, for the figures read. */
export function storageLines(figures: StorageFigures): StorageLine[] {
  const lines: StorageLine[] = [];
  if (figures.myPrograms) {
    lines.push({
      kind: 'figure',
      id: 'programs',
      label: MY_PROGRAMS_LABEL,
      value: filesFigure(figures.myPrograms.files, figures.myPrograms.bytes),
    });
  }
  lines.push({
    kind: 'figure',
    id: 'versions',
    label: EARLIER_VERSIONS_LABEL,
    value: versionsFigure(figures.versions, figures.versionBytes),
  });
  lines.push({
    kind: 'figure',
    id: 'trash',
    label: TRASH_LABEL,
    value: trashFigure(figures.trashItems, figures.trashBytes),
  });
  if (figures.desktop) {
    lines.push({ kind: 'text', id: 'desktop', text: DESKTOP_STORAGE_LINE });
    return lines;
  }
  if (figures.site)
    lines.push({ kind: 'text', id: 'site', text: siteUsageLine(figures.site.usage, figures.site.free) });
  lines.push({ kind: 'text', id: 'clearing', text: CLEARING_SITE_DATA });
  return lines;
}

/** The estimate of the running browser, or null where `navigator.storage.estimate` does not exist. */
export function browserEstimate(): (() => Promise<SiteEstimate>) | null {
  const storage = (globalThis as { navigator?: { storage?: { estimate?: () => Promise<SiteEstimate> } } }).navigator
    ?.storage;
  if (!storage || typeof storage.estimate !== 'function') return null;
  return () => (storage.estimate as () => Promise<SiteEstimate>).call(storage);
}
