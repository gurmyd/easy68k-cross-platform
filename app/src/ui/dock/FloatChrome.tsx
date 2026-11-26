// A floating window's title bar and edges (ARCHITECTURE-PLUS P9.2). Owner: M1.
//
// Drawn by DockContent inside the panel's own element (`.flexlayout__tab`, which dock.css places at
// the window's rect), before and after the panel's content, which stays where it is in the React
// tree: floating and docking never create the panel anew.
//
//   title bar   the panel's name, `Dock` and, for the panels that have one today, `x`. Dragging it
//               moves the window. It is one Tab stop (its buttons are reached with the mouse or
//               through its menu). Shift+F10, the context-menu key, Enter, Space or a right click
//               open its menu: Move, Size, Dock, Close (Close only where the panel has an x).
//   Move/Size   as in a desktop window's system menu: the arrows by 16 px, with Shift by 1 px; Enter
//               ends, Esc restores the place and size it had.
//   edges       eight handles (four edges, four corners) for the pointer; not seen by assistive
//               technology (Size does the same from the keyboard).
//
// The keys handled here are the title bar's own; nothing here handles a key whose target is inside
// `[data-e68-keys="program"]` (P1.1 rule 5): the title bar is outside the panel's content.

import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { AppContext } from '../../contracts';
import type { DockRect } from '../../state/dock';
import { hidePanel } from '../../state/panels';
import { ContextMenu, Icon, IconButton, type MenuEntry } from '../components';
import type { DockEngine, FloatView } from './engine';
import { EDGES, keyStep, sizedRect, type Edges } from './floating';
import { isViewerId } from './model';
import { CLOSE_TAB, FLOAT_BUTTON, FLOAT_WINDOW } from './texts';

type Mode = 'move' | 'size' | null;

/** Closes the panel exactly as its x does today (through hidePanel; a viewer closes). */
function closePanel(ctx: AppContext, engine: DockEngine, panel: string): void {
  if (isViewerId(panel)) engine.closeTransient(panel);
  else hidePanel(ctx, panel);
}

/**
 * Dock (P9.5): the command `app.layout.dock` with `{ panel }`; while no feature has registered
 * its handler (features/layout spreads DOCK_COMMANDS of state/dock.ts), the dock itself.
 */
export function dockPanel(ctx: AppContext, engine: DockEngine, panel: string): void {
  if (ctx.commands.isEnabled('app.layout.dock', { panel })) void ctx.commands.run('app.layout.dock', { panel });
  else engine.dock(panel);
}

/**
 * Float (P9.5): the command `app.layout.float` with `{ panel }`; while no feature has registered
 * its handler, the dock itself. Works locked or not (D8).
 */
export function floatPanel(ctx: AppContext, engine: DockEngine, panel: string): void {
  if (ctx.commands.isEnabled('app.layout.float', { panel })) void ctx.commands.run('app.layout.float', { panel });
  else engine.float(panel);
}

/**
 * The button `Float` at the right end of a tab strip (P9.8 point 3 (b)): floats the strip's
 * selected panel. The kit's IconButton (20 px, the tab strips' size); its tool tip is its name.
 */
export function FloatButton({ ctx, engine, panel }: { ctx: AppContext; engine: DockEngine; panel: string }) {
  return (
    <IconButton
      icon="float"
      size="small"
      label={FLOAT_BUTTON}
      className="e68-dock__float-button"
      data-e68-float-button={panel}
      disabled={!engine.canFloat(panel)}
      onClick={() => floatPanel(ctx, engine, panel)}
    />
  );
}

/** The entries of a floating window's menu. */
export function floatMenuEntries(
  ctx: AppContext,
  engine: DockEngine,
  view: FloatView,
  start: (mode: 'move' | 'size') => void,
): MenuEntry[] {
  const entries: MenuEntry[] = [
    { type: 'item', id: 'dock.float.move', caption: FLOAT_WINDOW.move, onSelect: () => start('move') },
    { type: 'item', id: 'dock.float.size', caption: FLOAT_WINDOW.size, onSelect: () => start('size') },
    { type: 'separator' },
    {
      type: 'item',
      id: 'dock.float.dock',
      caption: FLOAT_WINDOW.dock,
      onSelect: () => dockPanel(ctx, engine, view.panel),
    },
  ];
  if (view.closable) {
    entries.push(
      { type: 'separator' },
      {
        type: 'item',
        id: 'dock.float.close',
        caption: FLOAT_WINDOW.close,
        onSelect: () => closePanel(ctx, engine, view.panel),
      },
    );
  }
  return entries;
}

const pointerRect = (start: DockRect, dx: number, dy: number): DockRect => ({
  ...start,
  x: start.x + dx,
  y: start.y + dy,
});

/** The title bar of a floating window. */
export function FloatTitleBar({ ctx, engine, view }: { ctx: AppContext; engine: DockEngine; view: FloatView }) {
  const handle = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  // The place and size before Move or Size began (Esc restores it).
  const before = useRef<DockRect | null>(null);
  const keyed = useRef<DockRect | null>(null);
  // A pointer pressed on the title bar; on a button it moves the window only once it has moved
  // 4 px (a window dragged out shows 48 px of its title bar, which may be its buttons).
  const dragging = useRef<{
    id: number;
    x: number;
    y: number;
    start: DockRect;
    moved: boolean;
    button: HTMLButtonElement | null;
  } | null>(null);
  const suppressClick = useRef(false);
  // The last two presses on the bar: whether each was on one of its buttons or moved the window. A
  // double click (the browser's, by the system's double-click time) docks the window only when both
  // of its presses were on the title area and moved nothing (P9.8 point 3 (a)).
  const presses = useRef<{ button: boolean; moved: boolean }[]>([]);

  const start = useCallback(
    (next: 'move' | 'size') => {
      const rect = engine.shownRect(view.panel);
      if (!rect) return;
      before.current = rect;
      keyed.current = rect;
      setMode(next);
      engine.raise(view.panel);
      // The menu gives the focus back to the title bar; Move and Size take the keys there.
      handle.current?.focus({ preventScroll: true });
    },
    [engine, view.panel],
  );

  const end = useCallback(
    (restore: boolean) => {
      const rect = restore ? before.current : keyed.current;
      if (rect) {
        if (restore) engine.previewRect(view.panel, null);
        engine.commitRect(view.panel, rect);
      }
      before.current = null;
      keyed.current = null;
      setMode(null);
    },
    [engine, view.panel],
  );

  const openMenu = (x: number, y: number) => setMenu({ x, y });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
    if (mode !== null) {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        end(event.key === 'Escape');
        return;
      }
      const step = plain ? keyStep(event.key, event.shiftKey) : null;
      if (step === null || keyed.current === null) return;
      event.preventDefault();
      event.stopPropagation();
      const area = engine.bounds();
      const current = keyed.current;
      const next =
        mode === 'move'
          ? pointerRect(current, step.dx, step.dy)
          : sizedRect(current, 'se', step.dx, step.dy, engine.minimumOf(view.panel), area);
      keyed.current = next;
      engine.previewRect(view.panel, next);
      // The rect shown, moved back into the dock, is the one Enter keeps.
      keyed.current = engine.shownRect(view.panel) ?? next;
      return;
    }
    if (
      event.key === 'ContextMenu' ||
      (event.key === 'F10' && event.shiftKey && plain) ||
      ((event.key === 'Enter' || event.key === ' ') && plain && !event.shiftKey)
    ) {
      event.preventDefault();
      event.stopPropagation();
      const box = event.currentTarget.getBoundingClientRect();
      openMenu(box.left, box.bottom);
    }
  };

  /**
   * React passes the events of the title bar's menu (a portal) up to the bar as well; they are the
   * menu's, not a press on the bar. Before the closing pass of version 1.1 a press on the menu's
   * Move or Size captured the pointer for the bar, and the item's click never started Move or Size.
   */
  const fromBar = (event: { currentTarget: Element; target: EventTarget }) =>
    event.target instanceof Node && event.currentTarget.contains(event.target);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !fromBar(event)) return;
    const rect = engine.shownRect(view.panel);
    if (!rect) return;
    const button = (event.target as Element).closest('button');
    suppressClick.current = false;
    if (mode !== null) end(false);
    engine.raise(view.panel);
    event.preventDefault();
    if (!button) handle.current?.focus({ preventScroll: true });
    // Captured at once: the pointer's next events come here wherever it goes (a press on a button
    // that does not move is that button's click, below).
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: rect,
      moved: button === null,
      button,
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragging.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      drag.moved = true;
    }
    engine.previewRect(view.panel, pointerRect(drag.start, dx, dy));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragging.current;
    if (!drag || drag.id !== event.pointerId) return;
    dragging.current = null;
    const moved = drag.moved && (Math.abs(event.clientX - drag.x) >= 4 || Math.abs(event.clientY - drag.y) >= 4);
    presses.current = [...presses.current.slice(-1), { button: drag.button !== null, moved }];
    if (!drag.moved) {
      // A press and release on a button: its click (the browser's own click goes to the title bar,
      // the element that captured the pointer, or is ignored once).
      if (drag.button && event.type === 'pointerup') {
        drag.button.click();
        ignoreNextClick();
      }
      return;
    }
    ignoreNextClick();
    const rect = engine.shownRect(view.panel);
    if (rect) engine.commitRect(view.panel, rect);
  };
  /** The browser's own click that follows this pointer's release (if any) is not a button's click. */
  const ignoreNextClick = () => {
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  };
  /** A button's click, unless the pointer pressed on it moved the window. */
  const clicked = (action: () => void) => () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    action();
  };

  return (
    <div
      className="e68-float__bar"
      data-e68-float-bar={view.panel}
      data-mode={mode ?? undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(event) => {
        if (!fromBar(event) || event.button !== 0) return;
        const [first, second] = presses.current;
        presses.current = [];
        if (!first || !second || first.button || second.button || first.moved || second.moved) return;
        event.preventDefault();
        if (mode !== null) end(false);
        dockPanel(ctx, engine, view.panel);
      }}
      onContextMenu={(event) => {
        if (!fromBar(event)) return;
        event.preventDefault();
        openMenu(event.clientX, event.clientY);
      }}
    >
      <div
        ref={handle}
        className="e68-float__title"
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        data-e68-float-title={view.panel}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (mode !== null) end(false);
        }}
      >
        {view.title}
      </div>
      <button
        type="button"
        className="e68-float__button e68-float__dock"
        tabIndex={-1}
        title={FLOAT_WINDOW.dock}
        data-e68-float-dock={view.panel}
        onClick={clicked(() => dockPanel(ctx, engine, view.panel))}
      >
        {FLOAT_WINDOW.dock}
      </button>
      {view.closable && (
        <button
          type="button"
          className="e68-float__button e68-float__close"
          tabIndex={-1}
          title={CLOSE_TAB}
          aria-label={CLOSE_TAB}
          data-e68-float-close={view.panel}
          onClick={clicked(() => closePanel(ctx, engine, view.panel))}
        >
          <Icon name="close" size={14} />
        </button>
      )}
      <ContextMenu
        label={FLOAT_WINDOW.menuLabel}
        items={menu ? floatMenuEntries(ctx, engine, view, start) : []}
        at={menu}
        onClose={() => setMenu(null)}
        showMnemonics={false}
      />
    </div>
  );
}

/** The eight edges of a floating window, for the pointer (P9.2: resized at its edges and corners). */
export function FloatEdges({ engine, panel }: { engine: DockEngine; panel: string }): ReactNode {
  const drag = useRef<{ id: number; x: number; y: number; start: DockRect; edges: Edges } | null>(null);
  const down = (edges: Edges) => (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const rect = engine.shownRect(panel);
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    engine.raise(panel);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: rect, edges };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const rect = sizedRect(
      current.start,
      current.edges,
      event.clientX - current.x,
      event.clientY - current.y,
      engine.minimumOf(panel),
      engine.bounds(),
    );
    engine.previewRect(panel, rect);
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    const rect = engine.shownRect(panel);
    if (rect) engine.commitRect(panel, rect);
  };
  return (
    <div className="e68-float__edges" aria-hidden="true">
      {EDGES.map((edges) => (
        <div
          key={edges}
          className={`e68-float__edge e68-float__edge--${edges}`}
          data-e68-float-edge={edges}
          onPointerDown={down(edges)}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
      ))}
    </div>
  );
}
