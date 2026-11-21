// The commands the shell itself handles (ARCHITECTURE.md 9.7: `app.mode.set`, `app.mode.next`,
// `app.theme.set`, `app.window.new`, `sim.panel.next`). Owner: W3.
//
// They are packaged as a FeatureModule so that the bootstrap registers them like any feature's.

import type { AppContext, AppState, FeatureModule, Mode } from '../contracts';
import { focusNextPanel } from '../state/panels';

/** The modes in the order of the mode switch; F4 cycles through them (2.1). */
export const MODES: readonly Mode[] = ['editor', 'simulator', 'easybin'];

export const MODE_CAPTIONS: Record<Mode, string> = { editor: 'Editor', simulator: 'Simulator', easybin: 'EASyBIN' };

export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEMES)[number];
export const THEME_CAPTIONS: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' };

function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

function isTheme(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** Switches the mode. The modes keep their state; a running program keeps running (2.1). */
export function setMode(ctx: AppContext, mode: Mode): void {
  ctx.store.setState((state) => (state.mode === mode ? state : { ...state, mode }));
}

export const shellCommands: FeatureModule = {
  id: 'shell',
  commands: {
    'app.mode.set': {
      run(ctx, arg) {
        if (isMode(arg)) setMode(ctx, arg);
      },
      checked: (state: AppState, _ctx, arg) => state.mode === arg,
    },
    'app.mode.next': {
      run(ctx) {
        const current = MODES.indexOf(ctx.store.getState().mode);
        setMode(ctx, MODES[(current + 1) % MODES.length] ?? 'editor');
      },
    },
    'app.theme.set': {
      run(ctx, arg) {
        if (!isTheme(arg)) return;
        ctx.settings.update((settings) =>
          settings.app.theme === arg ? settings : { ...settings, app: { ...settings.app, theme: arg } },
        );
      },
      checked: (state: AppState, _ctx, arg) => state.settings.app.theme === arg,
    },
    'app.window.new': {
      run(ctx) {
        ctx.platform.newWindow();
      },
    },
    'sim.panel.next': {
      run(ctx) {
        focusNextPanel(ctx);
      },
    },
  },
};
