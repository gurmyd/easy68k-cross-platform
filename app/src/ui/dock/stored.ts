// The stored dock arrangement, validated where it is read (ARCHITECTURE-PLUS P4.2). Owner: N1.
//
// `AppSettings.layout.dock` comes from storage as it was written (the settings service keeps keys
// the defaults do not have), so every part is checked here and replaced by its default when it is
// malformed: a mode's tree that has a node of an unknown type, a weight that is not a positive
// finite number, a group without panels or with a selected panel it does not list, a panel that is
// not a panel of that mode (viewer ids are never stored), a panel listed twice, or that lacks a
// panel that cannot be closed, is dropped, and the mode shows its default arrangement (P3.1.8).
// The lock is true unless `false` is stored (D2).
//
//   readDock(settings)            -> { locked, editor?, simulator?, parked }
//   withDock(settings, change)    settings with layout.dock replaced (stamped with app.layout)

import type { DockLayouts, DockNode, DockParked, Settings } from '../../contracts';
import { DOCK_PANELS, FIXED_PANELS, normalizeDock, type DockMode } from './model';

export interface ReadDock {
  locked: boolean;
  editor?: DockNode;
  simulator?: DockNode;
  parked: Record<string, DockParked>;
}

const SIDES: readonly string[] = ['tab', 'left', 'right', 'above', 'below'];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isWeight = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** A tree as stored, or null when any part of it is malformed for `mode`. Not yet normalized. */
function readNode(raw: unknown, mode: DockMode, seen: Set<string>, depth: number): DockNode | null {
  if (!isObject(raw) || depth > 32 || !isWeight(raw.weight)) return null;
  if (raw.type === 'tabs') {
    const panels = raw.panels;
    if (!Array.isArray(panels) || panels.length === 0) return null;
    for (const panel of panels) {
      if (typeof panel !== 'string' || !DOCK_PANELS[mode].includes(panel) || seen.has(panel)) return null;
      seen.add(panel);
    }
    if (typeof raw.selected !== 'string' || !panels.includes(raw.selected)) return null;
    return { type: 'tabs', weight: raw.weight, panels: [...(panels as string[])], selected: raw.selected };
  }
  if (raw.type === 'row' || raw.type === 'column') {
    if (!Array.isArray(raw.children) || raw.children.length === 0) return null;
    const children: DockNode[] = [];
    for (const child of raw.children) {
      const node = readNode(child, mode, seen, depth + 1);
      if (node === null) return null;
      children.push(node);
    }
    return { type: raw.type, weight: raw.weight, children };
  }
  return null;
}

/** A mode's stored tree, normalized, or undefined (the default arrangement). */
export function readTree(raw: unknown, mode: DockMode): DockNode | undefined {
  if (raw === undefined) return undefined;
  const seen = new Set<string>();
  const node = readNode(raw, mode, seen, 0);
  if (node === null) return undefined;
  if (FIXED_PANELS[mode].some((panel) => !seen.has(panel))) return undefined;
  return normalizeDock(node);
}

/** The stored arrangement of both modes, the lock and the parked places, each validated. */
export function readDock(settings: Settings): ReadDock {
  const raw: unknown = settings.app.layout.dock;
  if (!isObject(raw) || raw.version !== 1) return { locked: true, parked: {} };
  const parked: Record<string, DockParked> = {};
  if (isObject(raw.parked)) {
    for (const [panel, place] of Object.entries(raw.parked)) {
      if (
        isObject(place) &&
        typeof place.near === 'string' &&
        typeof place.side === 'string' &&
        SIDES.includes(place.side)
      ) {
        parked[panel] = { near: place.near, side: place.side as DockParked['side'] };
      }
    }
  }
  const editor = readTree(raw.editor, 'editor');
  const simulator = readTree(raw.simulator, 'simulator');
  return {
    locked: typeof raw.locked === 'boolean' ? raw.locked : true,
    ...(editor ? { editor } : {}),
    ...(simulator ? { simulator } : {}),
    parked,
  };
}

/** The stored DockLayouts to write back: what readDock gave, changed. */
export function toStored(dock: ReadDock): DockLayouts {
  const out: DockLayouts = { version: 1 };
  if (!dock.locked) out.locked = false;
  if (dock.editor) out.editor = dock.editor;
  if (dock.simulator) out.simulator = dock.simulator;
  if (Object.keys(dock.parked).length > 0) out.parked = dock.parked;
  return out;
}

/**
 * `settings` with the dock changed by `change` (which gets what readDock reads). The lock keeps the
 * stored form: `locked` is written only when it is false or was stored. Returns the same object
 * when nothing changes.
 */
export function withDock(settings: Settings, change: (dock: ReadDock) => ReadDock): Settings {
  const before = readDock(settings);
  const after = change(before);
  const next = toStored(after);
  const raw: unknown = settings.app.layout.dock;
  if (isObject(raw) && raw.locked === true && after.locked) next.locked = true;
  if (JSON.stringify(next) === JSON.stringify(raw ?? null)) return settings;
  const layout = settings.app.layout;
  if (JSON.stringify(next) === JSON.stringify({ version: 1 }) && raw === undefined) return settings;
  return { ...settings, app: { ...settings.app, layout: { ...layout, dock: next } } };
}
