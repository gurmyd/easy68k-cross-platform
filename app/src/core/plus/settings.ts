// The two switches of `Options > Port Additions...` (ARCHITECTURE-PLUS P1.2, P3.5, P4.2). Owner: N0.
//
// AppSettings.plus is optional and not in core/settings/defaults.ts: the settings service keeps keys
// the defaults do not have (mergeWithDefaults), so whatever is stored reaches get() as it is. It is
// therefore validated where it is read, here: anything malformed reads as the default.

import type { PlusSettings, Settings } from '../../contracts';

/** Both switches are on by default (D1). */
export const PLUS_DEFAULTS: Readonly<PlusSettings> = Object.freeze({ viewer: true, history: true });

/** The two switches as stored, each one the default unless it is a boolean. */
export function readPlus(settings: Pick<Settings, 'app'>): PlusSettings {
  const app: unknown = (settings as { app?: unknown }).app;
  const stored = typeof app === 'object' && app !== null ? (app as { plus?: unknown }).plus : undefined;
  const value = (key: keyof PlusSettings): boolean => {
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return PLUS_DEFAULTS[key];
    const field = (stored as Record<string, unknown>)[key];
    return typeof field === 'boolean' ? field : PLUS_DEFAULTS[key];
  };
  return { viewer: value('viewer'), history: value('history') };
}

/** `settings` with the switches changed (for the dialog's OK, N7). */
export function withPlus(settings: Settings, change: Partial<PlusSettings>): Settings {
  return { ...settings, app: { ...settings.app, plus: { ...readPlus(settings), ...change } } };
}
