// The Files panel's tree (ARCHITECTURE.md 2.2): the browser store ("My Programs") and any other
// mounted store (an opened folder), folders that can be expanded, the selection, and the keyboard
// rules of a tree view. No React here: FilesPanel.tsx draws `rows()` and calls these methods; the
// tests drive the model under Node.
//
// The model keeps the listing of every expanded folder. It subscribes to the Vfs, so a save in the
// editor, an import, and a change made in another window (3.8.6, origin 'external') appear without
// a reload.
//
// Owner: FS1.

import type { DirEntry, Vfs, VfsChange, VPath } from '../../contracts';
import { childPath, dirname, isVPath, isWithin, splitVPath } from '../../core/paths/winpath';
import { treeViewKeyAction } from '../../ui/components';
import { locations, sortEntries } from './store';

export interface TreeRow {
  path: VPath;
  /** The entry's name; for a store root its label ("My Programs"). */
  name: string;
  kind: 'root' | 'dir' | 'file';
  depth: number; // 1 for a root (aria-level)
  expanded: boolean;
  /** Folder whose listing failed. */
  error?: string;
}

export class FilesTreeModel {
  private readonly expanded = new Set<VPath>();
  private readonly listings = new Map<VPath, DirEntry[] | { error: string }>();
  private readonly listeners = new Set<() => void>();
  private readonly loading = new Map<VPath, Promise<void>>();
  private readonly unsubscribe: () => void;
  private knownRoots = new Set<VPath>();
  private cached: TreeRow[] | null = null;
  selected: VPath | null = null;

  constructor(private readonly vfs: Vfs) {
    this.unsubscribe = vfs.subscribe('/', (change) => this.changed(change));
    this.syncRoots();
  }

  dispose(): void {
    this.unsubscribe();
    this.listeners.clear();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The rows on screen, top to bottom. */
  rows(): TreeRow[] {
    if (this.cached) return this.cached;
    const rows: TreeRow[] = [];
    const add = (dir: VPath, depth: number) => {
      const listing = this.listings.get(dir);
      if (!listing || 'error' in listing) return;
      for (const entry of listing) {
        const path = childPath(dir, entry.name);
        const open = entry.kind === 'dir' && this.expanded.has(path);
        const row: TreeRow = { path, name: entry.name, kind: entry.kind, depth, expanded: open };
        const sub = this.listings.get(path);
        if (sub && 'error' in sub) row.error = sub.error;
        rows.push(row);
        if (open) add(path, depth + 1);
      }
    };
    for (const location of locations(this.vfs)) {
      const open = this.expanded.has(location.root);
      const row: TreeRow = { path: location.root, name: location.label, kind: 'root', depth: 1, expanded: open };
      const listing = this.listings.get(location.root);
      if (listing && 'error' in listing) row.error = listing.error;
      rows.push(row);
      if (open) add(location.root, 2);
    }
    this.cached = rows;
    return rows;
  }

  /** The selected row, or null. */
  selectedRow(): TreeRow | null {
    return this.rows().find((row) => row.path === this.selected) ?? null;
  }

  select(path: VPath | null): void {
    if (this.selected === path) return;
    this.selected = path;
    this.notify(false);
  }

  isExpanded(path: VPath): boolean {
    return this.expanded.has(path);
  }

  async expand(path: VPath): Promise<void> {
    this.expanded.add(path);
    await this.load(path);
    this.notify();
  }

  collapse(path: VPath): void {
    if (!this.expanded.delete(path)) return;
    // Keep the selection visible.
    if (this.selected && this.selected !== path && isWithin(this.selected, path)) this.selected = path;
    this.notify();
  }

  async toggle(path: VPath): Promise<void> {
    if (this.expanded.has(path)) this.collapse(path);
    else await this.expand(path);
  }

  /** Expands the folders down to `path` and selects it (Help > Examples, a new folder, an import). */
  async reveal(path: VPath): Promise<void> {
    const { mount, rel } = splitVPath(path);
    let dir: VPath = `/${mount}`;
    await this.expand(dir);
    const segments = rel === '' ? [] : rel.split('/');
    for (let i = 0; i < segments.length - 1; i++) {
      dir = childPath(dir, segments[i] as string);
      await this.expand(dir);
    }
    this.selected = path;
    this.notify();
  }

  /** Re-reads every expanded folder (and notices stores mounted or unmounted since). */
  async refreshAll(): Promise<void> {
    this.syncRoots();
    await Promise.all([...this.expanded].map((path) => this.load(path)));
    this.notify();
  }

  /** Resolves when no listing is loading any more (tests). */
  async settled(): Promise<void> {
    while (this.loading.size > 0) await Promise.all([...this.loading.values()]);
  }

  // ---- keyboard (WAI-ARIA tree view) ----------------------------------------------------------

  /**
   * What a key does in the tree. Up / Down / Home / End move; Right opens a closed folder or moves
   * to its first child; Left closes an open folder or moves to the parent; Enter opens a file or
   * toggles a folder (Space too). Returns the action for the panel to carry out, or null for keys
   * the tree does not use. The rules are the kit's treeViewKeyAction (ui/components/tree.ts).
   */
  keyAction(
    key: string,
  ): { kind: 'select'; path: VPath } | { kind: 'open'; path: VPath } | { kind: 'toggle'; path: VPath } | null {
    const rows = this.rows();
    const index = rows.findIndex((row) => row.path === this.selected);
    // The kit's tree-view rules: folders and stores open and close, files are leaves that open.
    const action = treeViewKeyAction(
      rows.map((row) => ({ depth: row.depth, expandable: row.kind !== 'file', expanded: row.expanded })),
      index,
      key,
    );
    if (!action) return null;
    const path = (rows[action.index] as TreeRow).path;
    if (action.kind === 'move') return { kind: 'select', path };
    if (action.kind === 'toggle') return { kind: 'toggle', path };
    return { kind: 'open', path };
  }

  // ---- internals ------------------------------------------------------------------------------

  private notify(structure = true): void {
    if (structure) this.cached = null;
    for (const listener of [...this.listeners]) listener();
  }

  private syncRoots(): void {
    const roots = new Set(locations(this.vfs).map((location) => location.root));
    for (const root of roots) {
      if (!this.knownRoots.has(root)) {
        this.expanded.add(root); // a store appears expanded
        void this.load(root).then(() => this.notify());
      }
    }
    for (const root of this.knownRoots) {
      if (!roots.has(root)) {
        for (const path of [...this.expanded]) if (isWithin(path, root)) this.expanded.delete(path);
        for (const path of [...this.listings.keys()]) if (isWithin(path, root)) this.listings.delete(path);
        if (this.selected && isWithin(this.selected, root)) this.selected = null;
      }
    }
    this.knownRoots = roots;
    this.cached = null;
  }

  private load(path: VPath): Promise<void> {
    const running = this.loading.get(path);
    if (running) {
      // A change arrived while listing: list once more afterwards.
      const again = running.then(() => this.load(path));
      return again;
    }
    const work = this.vfs
      .list(path)
      .then(
        (entries) => {
          this.listings.set(path, sortEntries(entries));
        },
        (error: unknown) => {
          const code = (error as { code?: string } | null)?.code;
          if (code === 'not-found' || code === 'not-directory') {
            this.listings.delete(path);
            this.expanded.delete(path);
          } else {
            this.listings.set(path, { error: error instanceof Error ? error.message : String(error) });
          }
        },
      )
      .finally(() => {
        this.loading.delete(path);
        this.cached = null;
      });
    this.loading.set(path, work);
    return work;
  }

  private changed(change: VfsChange): void {
    if (!isVPath(change.path)) return;
    // A store mounted since (an opened folder) shows up with its first change at the latest.
    this.syncRoots();
    // Re-list every expanded folder on the way from the change up to its store: a write can create
    // parent folders, a remove can take a whole folder.
    const affected = [...this.expanded].filter(
      (dir) => isWithin(change.path, dir) || (change.kind === 'remove' && isWithin(dir, change.path)),
    );
    if (change.kind === 'remove' && this.selected && isWithin(this.selected, change.path)) {
      this.selected = dirname(change.path);
    }
    if (affected.length === 0) return;
    void Promise.all(affected.map((dir) => this.load(dir))).then(() => this.notify());
  }
}
