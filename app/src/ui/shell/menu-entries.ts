// Resolved menus as entries of the component kit's MenuBar (ARCHITECTURE.md 2.1). Owner: W3.
//
// commands/menus.ts resolves the menu tables against the running application; this module turns
// the result into the MenuBarMenu / MenuEntry objects of ui/components. Choosing an entry runs its
// command through the registry.

import type { CommandId } from '../../contracts';
import type { ResolvedMenu, ResolvedNode } from '../../commands/menus';
import type { MenuBarMenu, MenuEntry } from '../components';

export type RunCommand = (id: CommandId, arg?: unknown) => void;

function toEntries(nodes: readonly ResolvedNode[], run: RunCommand, path: string): MenuEntry[] {
  return nodes.map((node, index): MenuEntry => {
    const id = `${path}/${index}`;
    if (node.type === 'separator') return { type: 'separator', id };
    if (node.type === 'submenu') {
      return { type: 'submenu', id, caption: node.caption, items: toEntries(node.items, run, id) };
    }
    const base = {
      id,
      caption: node.caption,
      disabled: !node.enabled,
      onSelect: () => run(node.id, node.arg),
      ...(node.shortcut !== null ? { shortcut: node.shortcut } : {}),
    };
    if (node.kind === 'check') return { type: 'check', checked: node.checked, ...base };
    if (node.kind === 'radio') return { type: 'radio', checked: node.checked, ...base };
    return { type: 'item', ...base };
  });
}

export function toMenuBarMenus(menus: readonly ResolvedMenu[], run: RunCommand): MenuBarMenu[] {
  return menus.map((menu) => ({ id: menu.id, caption: menu.caption, items: toEntries(menu.items, run, menu.id) }));
}
