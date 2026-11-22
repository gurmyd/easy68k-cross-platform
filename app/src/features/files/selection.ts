// The Files panel's multiple selection (ARCHITECTURE-PLUS P3.2.1, P1.3): the anchor, a range, a
// toggle, the focused row apart from the selection, pruning when items go away, and the keys the
// tree owns. No React here; FilesTreeModel keeps one FilesSelection and the tests drive it under
// Node with tables of clicks and keys. Owner: N5.
//
//   click             selects one row; it becomes the anchor and the focused row
//   Shift+click       the range from the anchor to the row
//   Ctrl+click        (macOS Cmd+click) adds or removes the row; it becomes the anchor
//   Shift+Up/Down/Home/End   moves the focus and selects the range from the anchor to it
//   Ctrl+Up/Down      (macOS Option+Up/Down) moves the focus without selecting
//   Ctrl+Space        (macOS Option+Space) adds or removes the focused row
//   Ctrl+A            (macOS Cmd+A or Ctrl+A) selects every visible row
//   Esc               clears a multiple selection down to the focused row
//
// A store's root row is never part of a selection of more than one row: adding rows to it, or it
// to others, drops it (P3.2.1).

import type { VPath } from '../../contracts';
import { normalizeChord, type Os } from '../../commands/chords';
import { chordsOn } from '../../commands/specs';

export interface SelectableRow {
  path: VPath;
  /** A store's root row. */
  root: boolean;
}

export class FilesSelection {
  private readonly chosen = new Set<VPath>();
  anchor: VPath | null = null;
  focus: VPath | null = null;

  constructor(private readonly isRoot: (path: VPath) => boolean) {}

  has(path: VPath): boolean {
    return this.chosen.has(path);
  }

  get size(): number {
    return this.chosen.size;
  }

  /** The selected paths in the order of `rows` (the tree's order); paths not among them follow. */
  ordered(rows: readonly { path: VPath }[]): VPath[] {
    const index = new Map(rows.map((row, i) => [row.path, i]));
    return [...this.chosen].sort((a, b) => (index.get(a) ?? Infinity) - (index.get(b) ?? Infinity));
  }

  /** A plain click, Up or Down: this row alone. */
  click(path: VPath | null): void {
    this.chosen.clear();
    if (path !== null) this.chosen.add(path);
    this.anchor = path;
    this.focus = path;
  }

  /** Shift+click and Shift+arrows: the range from the anchor to `path` in the tree's order. */
  range(path: VPath, rows: readonly SelectableRow[]): void {
    const from = this.anchor === null ? -1 : rows.findIndex((row) => row.path === this.anchor);
    const to = rows.findIndex((row) => row.path === path);
    if (to < 0) return;
    if (from < 0) {
      const anchor = path;
      this.click(path);
      this.anchor = anchor;
      return;
    }
    this.chosen.clear();
    const [low, high] = from <= to ? [from, to] : [to, from];
    for (let i = low; i <= high; i++) this.chosen.add((rows[i] as SelectableRow).path);
    this.focus = path;
    this.dropRoots();
  }

  /** Ctrl+click (Cmd+click) and Ctrl+Space (Option+Space): adds or removes `path`; it becomes the anchor. */
  toggle(path: VPath): void {
    if (this.chosen.has(path)) this.chosen.delete(path);
    else this.chosen.add(path);
    this.anchor = path;
    this.focus = path;
    this.dropRoots();
  }

  /** Ctrl+Up/Down (Option+Up/Down): the focused row moves; the selection stays. */
  moveFocus(path: VPath): void {
    this.focus = path;
  }

  /** Ctrl+A: every visible row (a root only when it is the one row there is). */
  all(rows: readonly SelectableRow[]): void {
    this.chosen.clear();
    for (const row of rows) this.chosen.add(row.path);
    this.dropRoots();
  }

  /** Esc: a multiple selection becomes the focused row alone. */
  clear(): void {
    if (this.chosen.size <= 1) return;
    this.chosen.clear();
    if (this.focus !== null) this.chosen.add(this.focus);
    this.anchor = this.focus;
  }

  /** Sets the selection (after a delete that stopped: the items not yet deleted stay selected). */
  set(paths: readonly VPath[], focus: VPath | null = paths[0] ?? null): void {
    this.chosen.clear();
    for (const path of paths) this.chosen.add(path);
    this.focus = focus;
    this.anchor = focus;
    this.dropRoots();
  }

  /** Items that no longer exist leave the selection; returns true when anything changed. */
  prune(exists: (path: VPath) => boolean): boolean {
    let changed = false;
    for (const path of [...this.chosen]) {
      if (!exists(path)) {
        this.chosen.delete(path);
        changed = true;
      }
    }
    if (this.anchor !== null && !exists(this.anchor)) {
      this.anchor = null;
      changed = true;
    }
    return changed;
  }

  private dropRoots(): void {
    if (this.chosen.size <= 1) return;
    for (const path of [...this.chosen]) if (this.isRoot(path)) this.chosen.delete(path);
  }
}

// ---- keys -------------------------------------------------------------------------------------------

export interface TreeKeyEvent {
  key: string;
  /** The key's position (KeyboardEvent.code); absent in some tests. */
  code?: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** What a key of P1.3 does in the tree; null for keys the selection rules do not use. */
export type SelectionKey =
  | { kind: 'extend'; key: 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' }
  | { kind: 'focus'; key: 'ArrowUp' | 'ArrowDown' }
  | { kind: 'toggle' }
  | { kind: 'clear' }
  | { kind: 'delete' };

export function selectionKeyOf(event: TreeKeyEvent, os: Os): SelectionKey | null {
  const mac = os === 'mac';
  const { key } = event;
  const only = (mods: { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }) =>
    event.shiftKey === Boolean(mods.shift) &&
    event.ctrlKey === Boolean(mods.ctrl) &&
    event.altKey === Boolean(mods.alt) &&
    event.metaKey === Boolean(mods.meta);
  if ((key === 'ArrowUp' || key === 'ArrowDown' || key === 'Home' || key === 'End') && only({ shift: true }))
    return { kind: 'extend', key };
  if ((key === 'ArrowUp' || key === 'ArrowDown') && only(mac ? { alt: true } : { ctrl: true }))
    return { kind: 'focus', key };
  // The space bar by its position: on a Mac, Option+Space types a no-break space (key U+00A0).
  const space = event.code === 'Space' || key === ' ' || key === '\u00a0' || key === 'Spacebar';
  if (space && only(mac ? { alt: true } : { ctrl: true })) return { kind: 'toggle' };
  if (key === 'Escape' && only({})) return { kind: 'clear' };
  if (key === 'Delete' && only({})) return { kind: 'delete' };
  if (mac && key === 'Backspace' && only({ meta: true })) return { kind: 'delete' };
  return null;
}

/** True when a click with these modifiers adds or removes a row (Ctrl+click; macOS Cmd+click). */
export function isToggleClick(event: Pick<TreeKeyEvent, 'ctrlKey' | 'metaKey'>, os: Os): boolean {
  return os === 'mac' ? event.metaKey : event.ctrlKey;
}

/** The chords the tree owns on a key map: those of Select All, Undo and Redo (P1.3). */
export function ownedChords(os: Os): { selectAll: string[]; undo: string[]; redo: string[] } {
  const of = (id: 'ed.edit.selectAll' | 'ed.edit.undo' | 'ed.edit.redo') => chordsOn(id, os, false).map(normalizeChord);
  return { selectAll: of('ed.edit.selectAll'), undo: of('ed.edit.undo'), redo: of('ed.edit.redo') };
}

/** The value of the tree's `data-e68-own-keys` on a key map, built from the key map (P1.3). */
export function ownKeysAttribute(os: Os): string {
  const { selectAll, undo, redo } = ownedChords(os);
  return [...selectAll, ...undo, ...redo].join(' ');
}

/**
 * Where the focus goes after a delete (P3.2.2): the row after the last deleted row, else the row
 * before the first, else the store's root row. `rows` are the rows before the delete.
 */
export function focusAfterDelete(
  rows: readonly SelectableRow[],
  deleted: readonly VPath[],
  rootOf: (path: VPath) => VPath,
): VPath | null {
  if (deleted.length === 0) return null;
  const gone = (path: VPath) => deleted.some((d) => path === d || path.startsWith(`${d}/`));
  const indexes = deleted.map((d) => rows.findIndex((row) => row.path === d)).filter((i) => i >= 0);
  if (indexes.length === 0) return rootOf(deleted[0] as VPath);
  const last = Math.max(...indexes);
  const first = Math.min(...indexes);
  for (let i = last + 1; i < rows.length; i++)
    if (!gone((rows[i] as SelectableRow).path)) return (rows[i] as SelectableRow).path;
  for (let i = first - 1; i >= 0; i--)
    if (!gone((rows[i] as SelectableRow).path)) return (rows[i] as SelectableRow).path;
  return rootOf(deleted[0] as VPath);
}
