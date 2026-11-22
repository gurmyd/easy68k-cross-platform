// The tab menu of a panel's tab (ARCHITECTURE-PLUS P3.1.4). Owner: N1.
//
// Opened by a right click on a tab (FlexLayout's onContextMenu), Shift+F10 or the context-menu key
// on a focused tab. It lists, for that panel: Move To... (the dialog of `app.layout.move`), Move
// Left, Move Right, Move Up, Move Down (one step: beside the neighbouring group in that direction,
// or to the window edge), Move Tab Earlier and Move Tab Later (disabled at the first and the last
// place and in a group of one panel), and Close where the panel can be closed (through hidePanel;
// a viewer closes). Drawn with the kit's ContextMenu, which gives the focus back to the tab.

import type { AppContext } from '../../contracts';
import { hidePanel } from '../../state/panels';
import { ContextMenu, type MenuEntry } from '../components';
import type { DockEngine } from './engine';
import { isClosablePanel, isViewerId } from './model';
import { TAB_MENU } from './texts';

export interface TabMenuState {
  panel: string;
  at: { x: number; y: number };
}

/** The entries of the tab menu of `panel`. */
export function tabMenuEntries(ctx: AppContext, engine: DockEngine, panel: string): MenuEntry[] {
  const entries: MenuEntry[] = [
    {
      type: 'item',
      id: 'dock.moveTo',
      caption: TAB_MENU.moveTo,
      onSelect: () => void ctx.commands.run('app.layout.move', { panel }),
    },
    { type: 'separator' },
    { type: 'item', id: 'dock.moveLeft', caption: TAB_MENU.moveLeft, onSelect: () => engine.step(panel, 'left') },
    { type: 'item', id: 'dock.moveRight', caption: TAB_MENU.moveRight, onSelect: () => engine.step(panel, 'right') },
    { type: 'item', id: 'dock.moveUp', caption: TAB_MENU.moveUp, onSelect: () => engine.step(panel, 'up') },
    { type: 'item', id: 'dock.moveDown', caption: TAB_MENU.moveDown, onSelect: () => engine.step(panel, 'down') },
    { type: 'separator' },
    {
      type: 'item',
      id: 'dock.earlier',
      caption: TAB_MENU.earlier,
      disabled: engine.tabOrderPlan(panel, -1) === null,
      onSelect: () => engine.tabOrder(panel, -1),
    },
    {
      type: 'item',
      id: 'dock.later',
      caption: TAB_MENU.later,
      disabled: engine.tabOrderPlan(panel, 1) === null,
      onSelect: () => engine.tabOrder(panel, 1),
    },
  ];
  if (isClosablePanel(panel)) {
    entries.push(
      { type: 'separator' },
      {
        type: 'item',
        id: 'dock.close',
        caption: TAB_MENU.close,
        onSelect: () => (isViewerId(panel) ? engine.closeTransient(panel) : hidePanel(ctx, panel)),
      },
    );
  }
  return entries;
}

export function TabMenu({
  ctx,
  engine,
  state,
  onClose,
}: {
  ctx: AppContext;
  engine: DockEngine;
  state: TabMenuState | null;
  onClose: () => void;
}) {
  return (
    <ContextMenu
      label={TAB_MENU.label}
      items={state ? tabMenuEntries(ctx, engine, state.panel) : []}
      at={state?.at ?? null}
      onClose={onClose}
      showMnemonics={false}
    />
  );
}
