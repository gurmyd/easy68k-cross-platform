// The two switches of `Options > Port Additions...` (ARCHITECTURE-PLUS P1.2, P3.5, P4.2). Owner: N0.
// Version 1.1 (P9.3; M2): also whether the tip about arranging the Simulator's panels was answered.
//
// AppSettings.plus is optional and not in core/settings/defaults.ts: the settings service keeps keys
// the defaults do not have (mergeWithDefaults), so whatever is stored reaches get() as it is. It is
// therefore validated where it is read, here: anything malformed reads as the default.

import type { PlusSettings, Settings } from '../../contracts';

/** Both switches are on by default (D1). */
export const PLUS_DEFAULTS: Readonly<PlusSettings> = Object.freeze({ viewer: true, history: true });

/**
 * AppSettings.plus as it may be stored since version 1.1: the two switches and the optional member
 * `arrangeTipAnswered` (true once `Arrange Panels` or `Got it` of the tip of P9.3 was pressed in
 * this browser profile; absent or anything but true: not answered). Like every setting but the
 * layout it is shared by every window of the profile at once (errata W3 16). The member is not in
 * the contracts' PlusSettings yet (docs/requests/M2-plus-arrange-tip.md).
 */
export type StoredPlus = PlusSettings & { arrangeTipAnswered?: boolean };

/** What is stored as app.plus when it is an object, else null. */
function storedPlus(settings: Pick<Settings, 'app'>): Record<string, unknown> | null {
  const app: unknown = (settings as { app?: unknown }).app;
  const stored = typeof app === 'object' && app !== null ? (app as { plus?: unknown }).plus : undefined;
  return typeof stored === 'object' && stored !== null && !Array.isArray(stored)
    ? (stored as Record<string, unknown>)
    : null;
}

/** The two switches as stored, each one the default unless it is a boolean. */
export function readPlus(settings: Pick<Settings, 'app'>): PlusSettings {
  const stored = storedPlus(settings);
  const value = (key: keyof PlusSettings): boolean => {
    const field = stored?.[key];
    return typeof field === 'boolean' ? field : PLUS_DEFAULTS[key];
  };
  return { viewer: value('viewer'), history: value('history') };
}

/** The members of app.plus that this version reads besides the switches, kept as they are stored. */
function kept(settings: Settings): { arrangeTipAnswered?: true } {
  return arrangeTipAnswered(settings) ? { arrangeTipAnswered: true } : {};
}

/** `settings` with the switches changed (for the dialog's OK, N7). The tip's answer is kept. */
export function withPlus(settings: Settings, change: Partial<PlusSettings>): Settings {
  const plus: StoredPlus = { ...readPlus(settings), ...kept(settings), ...change };
  return { ...settings, app: { ...settings.app, plus } };
}

/** Version 1.1 (P9.3): true once the tip about arranging the panels was answered in this profile. */
export function arrangeTipAnswered(settings: Pick<Settings, 'app'>): boolean {
  return storedPlus(settings)?.arrangeTipAnswered === true;
}

/** `settings` with the tip answered (either of its buttons); the switches are kept as they read. */
export function withArrangeTipAnswered(settings: Settings): Settings {
  if (arrangeTipAnswered(settings)) return settings;
  const plus: StoredPlus = { ...readPlus(settings), arrangeTipAnswered: true };
  return { ...settings, app: { ...settings.app, plus } };
}
