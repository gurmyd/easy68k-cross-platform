// The Files panel's tree (ARCHITECTURE.md 2.2; ARCHITECTURE-PLUS P3.2): the browser store ("My
// Programs"), any other mounted store (an opened folder, the desktop app's disk) and the linked
// files ("Opened from this computer"), folders that can be expanded, the multiple selection
// (selection.ts), and the keyboard rules of a tree view. No React here: FilesPanel.tsx draws
// `rows()` and calls these methods; the tests drive the model under Node.
//
// The model keeps the listing of every expanded folder. It subscribes to the Vfs, so a save in the
// editor, an import, and a change made in another window (3.8.6, origin 'external') appear without
// a reload. A folder named .git (any letter case) is never listed; the row of a folder that holds
// one says so in its tool-tip (P3.2.5). The expanded folders of an opened folder and of the desktop
// app's disk are listed again when the window regains the focus (`windowFocused`, P3.3.10).
//
// Owner: FS1 > N5.

import type { DirEntry, FileSystemBackend, Vfs, VfsChange, VPath } from '../../contracts';
import { basename, childPath, dirname, foldCase, isVPath, isWithin, splitVPath } from '../../core/paths/winpath';
import { treeViewKeyAction } from '../../ui/components';
import { isGitName } from './git-guard';
import { FilesSelection, type SelectableRow } from './selection';
import { locations, sortEntries } from './store';
import { FOLDER_SECONDARY, GIT_TOOLTIP_LINE, LINKED_SECONDARY, folderTooltip, linkedTooltip } from './texts';

/** A box on the screen, as getBoundingClientRect gives it. */
export interface ScreenBox {
  top: number;
  left: number;
  bottom: number;
  right: number;
}
/** The inner area of a scrolling element (without its borders and scroll bars). */
export interface ScrollerClient {
  clientTop: number;
  clientLeft: number;
  clientWidth: number;
  clientHeight: number;
}

/** One axis of the "nearest" rule of Element.scrollIntoView (CSSOM View): 0 if the box is wholly
 *  inside the view or covers it, else the distance that aligns its nearer edge. */
function nearestDelta(viewStart: number, viewEnd: number, start: number, end: number): number {
  const startOut = start < viewStart;
  const endOut = end > viewEnd;
  if ((startOut && endOut) || (!startOut && !endOut)) return 0;
  const larger = end - start > viewEnd - viewStart;
  if ((startOut && !larger) || (endOut && larger)) return start - viewStart;
  return end - viewEnd;
}

/**
 * How far the tree must scroll (down and right positive) to show the focused row as
 * `row.scrollIntoView({ block: 'nearest', inline: 'nearest' })` would within the tree, which is the
 * element that scrolls. The panel sets scrollTop and scrollLeft with it instead of calling
 * scrollIntoView, which in Chromium moves the Tab key's starting point (errata N1 26, N5 21).
 */
export function scrollToShow(tree: ScreenBox, client: ScrollerClient, row: ScreenBox): { top: number; left: number } {
  const viewTop = tree.top + client.clientTop;
  const viewLeft = tree.left + client.clientLeft;
  return {
    top: nearestDelta(viewTop, viewTop + client.clientHeight, row.top, row.bottom),
    left: nearestDelta(viewLeft, viewLeft + client.clientWidth, row.left, row.right),
  };
}

export interface TreeRow {
  path: VPath;
  /** The entry's name; for a store root its label ("My Programs"). */
  name: string;
  kind: 'root' | 'dir' | 'file';
  depth: number; // 1 for a root (aria-level)
  expanded: boolean;
  /** Folder whose listing failed. */
  error?: string;
  /** Shown after the name, dimmed: `on this computer`, `edited in place` (P3.2.5). */
  secondary?: string;
  /** The row's tool-tip (P3.2.5); absent: the path below its store. */
  tooltip?: string;
  /** A linked file's row (/linked/<id>/<name>). */
  linked?: boolean;
}

/** The name the opened folder's backend was made from ("Lab"), without importing fs. */
function folderName(backend: FileSystemBackend): string {
  const handle = (backend as { rootHandle?: { name?: unknown } }).rootHandle;
  return typeof handle?.name === 'string' && handle.name !== '' ? handle.name : backend.label.replace(/^Folder: /, '');
}

/** Listings of the linked files: their rows, in the order of their names. */
interface LinkedFile {
  path: VPath;
  name: string;
}

export class FilesTreeModel {
  private readonly expanded = new Set<VPath>();
  private readonly listings = new Map<VPath, DirEntry[] | { error: string }>();
  /** Folders whose listing held a .git folder (hidden). */
  private readonly holdsGit = new Set<VPath>();
  private readonly listeners = new Set<() => void>();
  private readonly loading = new Map<VPath, Promise<void>>();
  private readonly unsubscribe: () => void;
  private knownRoots = new Set<VPath>();
  private cached: TreeRow[] | null = null;
  private linkedFiles: LinkedFile[] = [];
  private linkedLoading: Promise<void> | null = null;
  private readonly linkedChecked = new Set<VPath>();
  private revealCount = 0;
  readonly selection = new FilesSelection((path) => splitVPath(path).rel === '');

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

  /** The focused row (aria-activedescendant); it is selected unless the focus was moved alone. */
  get selected(): VPath | null {
    return this.selection.focus;
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
        if (this.holdsGit.has(path)) row.tooltip = `${splitVPath(path).rel}\n${GIT_TOOLTIP_LINE}`;
        rows.push(row);
        if (open) add(path, depth + 1);
      }
    };
    for (const location of locations(this.vfs, { linked: true })) {
      const open = this.expanded.has(location.root);
      if (location.backend.mount === 'linked') {
        if (this.linkedFiles.length === 0) continue; // shown only while a file is linked
        rows.push({ path: location.root, name: location.label, kind: 'root', depth: 1, expanded: open });
        if (open) {
          for (const file of this.linkedFiles) {
            rows.push({
              path: file.path,
              name: file.name,
              kind: 'file',
              depth: 2,
              expanded: false,
              secondary: LINKED_SECONDARY,
              tooltip: linkedTooltip(file.name),
              linked: true,
            });
          }
        }
        continue;
      }
      const row: TreeRow = { path: location.root, name: location.label, kind: 'root', depth: 1, expanded: open };
      const listing = this.listings.get(location.root);
      if (listing && 'error' in listing) row.error = listing.error;
      if (location.backend.mount === 'folder') {
        row.secondary = FOLDER_SECONDARY;
        row.tooltip = folderTooltip(folderName(location.backend));
      } else {
        row.tooltip = location.label;
      }
      if (this.holdsGit.has(location.root)) row.tooltip = `${row.tooltip}\n${GIT_TOOLTIP_LINE}`;
      rows.push(row);
      if (open) add(location.root, 2);
    }
    this.cached = rows;
    return rows;
  }

  /** The rows as the selection rules see them. */
  selectable(): SelectableRow[] {
    return this.rows().map((row) => ({ path: row.path, root: row.kind === 'root' }));
  }

  /** The focused row, or null. */
  selectedRow(): TreeRow | null {
    return this.rows().find((row) => row.path === this.selected) ?? null;
  }

  /** The selected rows in the tree's order. */
  selectedRows(): TreeRow[] {
    const rows = this.rows();
    return rows.filter((row) => this.selection.has(row.path));
  }

  /** The selected paths in the tree's order. */
  selectedPaths(): VPath[] {
    return this.selection.ordered(this.rows());
  }

  isSelected(path: VPath): boolean {
    return this.selection.has(path);
  }

  /** A plain click (or Up / Down): this row alone. */
  select(path: VPath | null): void {
    const already = path === null ? this.selection.size === 0 : this.selection.size === 1 && this.selection.has(path);
    if (already && this.selected === path) return;
    this.selection.click(path);
    this.notify(false);
  }

  /** Shift+click and Shift+arrows (P3.2.1). */
  selectRange(path: VPath): void {
    this.selection.range(path, this.selectable());
    this.notify(false);
  }

  /** Ctrl+click (Cmd+click), Ctrl+Space (Option+Space). */
  toggleSelected(path: VPath): void {
    this.selection.toggle(path);
    this.notify(false);
  }

  /** Ctrl+Up/Down (Option+Up/Down): the focus moves without selecting. */
  moveFocus(path: VPath): void {
    this.selection.moveFocus(path);
    this.notify(false);
  }

  /** Ctrl+A: every visible row. */
  selectAll(): void {
    this.selection.all(this.selectable());
    this.notify(false);
  }

  /** Esc: a multiple selection becomes the focused row alone. */
  clearSelection(): void {
    this.selection.clear();
    this.notify(false);
  }

  /** Selects exactly these paths (a delete that stopped), the focus on `focus`. */
  setSelection(paths: readonly VPath[], focus?: VPath | null): void {
    this.selection.set(paths, focus === undefined ? (paths[0] ?? null) : focus);
    this.notify(false);
  }

  /** The row `step` rows below (positive) or above the focused one, for the keys of P1.3. */
  neighbour(key: 'ArrowUp' | 'ArrowDown' | 'Home' | 'End'): VPath | null {
    const rows = this.rows();
    if (rows.length === 0) return null;
    if (key === 'Home') return (rows[0] as TreeRow).path;
    if (key === 'End') return (rows[rows.length - 1] as TreeRow).path;
    const index = rows.findIndex((row) => row.path === this.selected);
    if (index < 0) return (rows[0] as TreeRow).path;
    const next = key === 'ArrowUp' ? Math.max(0, index - 1) : Math.min(rows.length - 1, index + 1);
    return (rows[next] as TreeRow).path;
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
    // Keep the focus visible.
    if (this.selected && this.selected !== path && isWithin(this.selected, path)) {
      const hidden = this.selection.ordered(this.rows()).filter((p) => p !== path && isWithin(p, path));
      if (hidden.length > 0 && this.selection.size === hidden.length) this.selection.click(path);
      else this.selection.moveFocus(path);
    }
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
    if (mount !== 'linked') {
      for (let i = 0; i < segments.length - 1; i++) {
        dir = childPath(dir, segments[i] as string);
        await this.expand(dir);
      }
    } else {
      await this.loadLinked();
    }
    this.selection.click(path);
    this.revealCount++;
    this.notify();
  }

  /** How many reveals have selected a row: the panel brings the focused row into view after each,
   *  also when the row revealed was focused already (FilesPanel's "keep the focused row in view"). */
  get reveals(): number {
    return this.revealCount;
  }

  /** Re-reads every expanded folder (and notices stores mounted or unmounted since). */
  async refreshAll(): Promise<void> {
    this.syncRoots();
    await Promise.all([...this.expanded].map((path) => this.load(path)));
    this.notify();
  }

  /**
   * The window has the focus again: the expanded folders of an opened folder and of the desktop
   * app's disk are listed again, since Git or another program may have changed them (P3.3.10).
   */
  async windowFocused(): Promise<void> {
    const outside = [...this.expanded].filter((path) => {
      const { mount } = splitVPath(path);
      return mount === 'folder' || mount === 'disk';
    });
    await Promise.all([...outside.map((path) => this.load(path)), this.loadLinked()]);
    this.prune();
    this.notify();
  }

  /**
   * The linked files are listed again when a path of /linked is not among them (a file was linked
   * in this window: the linked store adds it without a change of the Vfs).
   */
  async linkedSeen(paths: readonly VPath[]): Promise<void> {
    // Each path once: a listing opened from a linked file's folder is never among the linked files.
    const unknown = paths.filter(
      (path) =>
        splitVPath(path).mount === 'linked' &&
        !this.linkedChecked.has(path) &&
        !this.linkedFiles.some((file) => file.path === path),
    );
    if (unknown.length === 0) return;
    for (const path of unknown) this.linkedChecked.add(path);
    await this.loadLinked();
    this.notify();
  }

  /** Resolves when no listing is loading any more (tests). */
  async settled(): Promise<void> {
    while (this.loading.size > 0 || this.linkedLoading) {
      await Promise.all([...this.loading.values(), this.linkedLoading]);
    }
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

  /** Selected items that are no longer listed leave the selection (P3.2.1). */
  private prune(): void {
    // A path below a collapsed folder is not on screen but may still exist: only a path whose
    // folder's listing is known and does not hold it has gone.
    const gone = (path: VPath) => {
      const { mount, rel } = splitVPath(path);
      if (rel === '') return !this.knownRoots.has(path);
      if (mount === 'linked') return !this.linkedFiles.some((file) => file.path === path);
      const listing = this.listings.get(dirname(path));
      if (!listing || 'error' in listing) return false;
      const name = basename(path);
      return !listing.some((entry) => entry.name === name);
    };
    this.selection.prune((path) => !gone(path));
  }

  private syncRoots(): void {
    const all = locations(this.vfs, { linked: true });
    const roots = new Set(all.map((location) => location.root));
    for (const root of roots) {
      if (!this.knownRoots.has(root)) {
        this.expanded.add(root); // a store appears expanded
        if (root === '/linked') void this.loadLinked().then(() => this.notify());
        else void this.load(root).then(() => this.notify());
      }
    }
    for (const root of this.knownRoots) {
      if (!roots.has(root)) {
        for (const path of [...this.expanded]) if (isWithin(path, root)) this.expanded.delete(path);
        for (const path of [...this.listings.keys()]) if (isWithin(path, root)) this.listings.delete(path);
        if (root === '/linked') this.linkedFiles = [];
        if (this.selected && isWithin(this.selected, root)) this.selection.click(null);
        this.selection.prune((path) => !isWithin(path, root));
      }
    }
    this.knownRoots = roots;
    this.cached = null;
  }

  /** The linked files by their names (P3.2.5); their listings and S-records are not listed. */
  private loadLinked(): Promise<void> {
    if (this.linkedLoading) return this.linkedLoading.then(() => this.loadLinked());
    const backend = this.vfs.backends().find((b) => b.mount === 'linked') as
      (FileSystemBackend & { linkOf?(rel: string): Promise<{ name: string } | null> }) | undefined;
    const work = (async () => {
      const found: LinkedFile[] = [];
      if (backend) {
        const ids = await this.vfs.list('/linked').catch(() => [] as DirEntry[]);
        for (const id of ids) {
          if (id.kind !== 'dir') continue;
          const folder = childPath('/linked', id.name);
          let name: string | null = null;
          if (typeof backend.linkOf === 'function') {
            name = (await backend.linkOf(id.name).catch(() => null))?.name ?? null;
          }
          if (name === null) {
            const files = (await this.vfs.list(folder).catch(() => [] as DirEntry[])).filter(
              (entry) => entry.kind === 'file' && !/\.(l68|s68)$/i.test(entry.name),
            );
            name = files[0]?.name ?? null;
          }
          if (name !== null) found.push({ path: childPath(folder, name), name });
        }
      }
      found.sort((a, b) => (foldCase(a.name) < foldCase(b.name) ? -1 : foldCase(a.name) > foldCase(b.name) ? 1 : 0));
      this.linkedFiles = found;
      this.cached = null;
    })().finally(() => {
      this.linkedLoading = null;
    });
    this.linkedLoading = work;
    return work;
  }

  private load(path: VPath): Promise<void> {
    if (path === '/linked') return this.loadLinked();
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
          const git = entries.some((entry) => entry.kind === 'dir' && isGitName(entry.name));
          if (git) this.holdsGit.add(path);
          else this.holdsGit.delete(path);
          this.listings.set(
            path,
            sortEntries(entries.filter((entry) => !(entry.kind === 'dir' && isGitName(entry.name)))),
          );
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
    if (splitVPath(change.path).mount === 'linked') {
      void this.loadLinked().then(() => {
        this.prune();
        this.notify();
      });
      return;
    }
    // Re-list every expanded folder on the way from the change up to its store: a write can create
    // parent folders, a remove can take a whole folder.
    const affected = [...this.expanded].filter(
      (dir) => isWithin(change.path, dir) || (change.kind === 'remove' && isWithin(dir, change.path)),
    );
    if (change.kind === 'remove') {
      // A removed item leaves the selection (P3.2.1); the focus goes to its folder.
      this.selection.prune((path) => !isWithin(path, change.path));
      if (this.selected && isWithin(this.selected, change.path)) {
        const parent = dirname(change.path);
        if (this.selection.size === 0) this.selection.click(parent);
        else this.selection.moveFocus(parent);
      }
      this.cached = null;
    }
    if (affected.length === 0) {
      if (change.kind === 'remove') this.notify(false);
      return;
    }
    void Promise.all(affected.map((dir) => this.load(dir))).then(() => this.notify());
  }
}
