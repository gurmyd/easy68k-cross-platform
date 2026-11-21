// The theme button at the right of the toolbar row (ARCHITECTURE.md 1.5, 2.8). Owner: W3.
//
// A button that opens the menu `Theme` > `System`, `Light`, `Dark`. Choosing an entry runs
// `app.theme.set`; the setting is stored (AppSettings.theme) and every open window follows it.

import { useEffect, useRef, useState } from 'react';
import { THEMES, THEME_CAPTIONS, type ThemeChoice } from '../../commands/shell-commands';
import { useAppState } from '../../state/context';
import { IconButton, Menu, type IconName, type MenuEntry } from '../components';
import { useRunCommand } from './use-commands';

const ICONS: Record<ThemeChoice, IconName> = { system: 'theme-system', light: 'theme-light', dark: 'theme-dark' };

export function ThemeButton() {
  const theme = useAppState((state) => state.settings.app.theme);
  const run = useRunCommand();
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const close = (refocus: boolean) => {
    setAnchor(null);
    if (refocus) button.current?.focus({ preventScroll: true });
  };

  // A press anywhere else closes the menu.
  useEffect(() => {
    if (!anchor) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('[data-e68-menu]') || button.current?.contains(target)) return;
      setAnchor(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [anchor]);

  const items: MenuEntry[] = THEMES.map((choice) => ({
    type: 'radio',
    id: choice,
    caption: THEME_CAPTIONS[choice],
    checked: choice === theme,
  }));

  return (
    <>
      <IconButton
        ref={button}
        icon={ICONS[theme]}
        label="Theme"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        data-command="app.theme.set"
        onClick={() => {
          if (anchor) return close(false);
          const box = button.current?.getBoundingClientRect();
          if (box) setAnchor({ x: box.left, y: box.top, width: box.width, height: box.height });
        }}
      />
      {anchor && (
        <Menu
          items={items}
          label="Theme"
          anchor={anchor}
          placement="below"
          onSelect={(entry) => {
            close(true);
            run('app.theme.set', entry.id);
          }}
          onClose={(reason) => {
            if (reason !== 'left' && reason !== 'right') close(reason !== 'outside');
          }}
        />
      )}
    </>
  );
}
