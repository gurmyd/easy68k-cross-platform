// The in-window menu bar of the current mode (ARCHITECTURE.md 2.1). Owner: W3.
//
// The menus come from the tables of app/src/commands/tables, resolved against the running
// application (use-commands.ts): a command without a handler is disabled, shortcuts are the
// platform's. Alt+letter opens a menu on Windows and Linux; the keyboard dispatcher asks for that
// through `menuAccess` (bootstrap.ts). macOS has no access keys, so they are not underlined there.

import { useEffect, useMemo, useRef } from 'react';
import type { Mode } from '../../contracts';
import { MODE_CAPTIONS } from '../../commands/shell-commands';
import { useApplication } from '../../state/context';
import { MenuBar, type MenuBarHandle } from '../components';
import { toMenuBarMenus } from './menu-entries';
import { useResolvedMenus, useRunCommand } from './use-commands';

export function ShellMenuBar({ mode }: { mode: Mode }) {
  const app = useApplication();
  const run = useRunCommand();
  const resolved = useResolvedMenus(mode);
  const menus = useMemo(() => toMenuBarMenus(resolved, run), [resolved, run]);
  const handle = useRef<MenuBarHandle>(null);

  useEffect(() => {
    app.menuAccess.open = (letter) => handle.current?.openByAccessKey(letter) ?? false;
    return () => {
      app.menuAccess.open = null;
    };
  }, [app]);

  return (
    <MenuBar
      // A new bar per mode: an open menu of the old mode must not stay open.
      key={mode}
      ref={handle}
      menus={menus}
      label={`${MODE_CAPTIONS[mode]} menu`}
      showMnemonics={app.ctx.platform.os !== 'mac'}
      className="e68-shell__menubar"
    />
  );
}
