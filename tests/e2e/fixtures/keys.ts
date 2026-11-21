// Keys for the end-to-end tests: which key map the page gets, and the application's own chords as
// Playwright key names (ARCHITECTURE.md 2.9, 6.6). Owner: X1.
//
// The page is given the key map of the system the tests run on: macOS on a Mac, Windows on Windows
// and Linux (Linux shares the Windows key map, 1.3 rule K1). The browser's own editing keys belong
// to the real system (on a Mac Cmd+C copies in a text field and Ctrl+C does not), so a Windows key
// map on a Mac would test a combination no user has. E2E_KEYS overrides the choice for diagnosis.
//
// Every command chord a test presses is read from the application's chord table
// (`chordsOn()` of app/src/commands/specs.ts), never written into a test, so the tests follow the
// table on every system.

import { chordsOn } from '../../../app/src/commands/specs';
import type { KnownCommandId } from '../../../app/src/commands/ids';

export type KeyMap = 'mac' | 'windows';

/** The key map the page is given: the host system's, unless E2E_KEYS says otherwise. */
export function hostKeyMap(platform: string = process.platform, override = process.env.E2E_KEYS): KeyMap {
  if (override === 'mac' || override === 'windows') return override;
  return platform === 'darwin' ? 'mac' : 'windows';
}

/** The value `navigator.platform` reports for a key map (what the application's detectOs reads). */
export function navigatorPlatformOf(keys: KeyMap): string {
  return keys === 'mac' ? 'MacIntel' : 'Win32';
}

/**
 * Runs in the page before the application: `navigator.platform` reports the chosen system and
 * `userAgentData` is hidden, so that the application (detectOs in platform/web.ts) and CodeMirror
 * both pick that system's key map. Must stay self-contained (Playwright serialises it).
 */
export function pretendPlatform(platform: string): void {
  Object.defineProperty(Navigator.prototype, 'platform', { get: () => platform, configurable: true });
  Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined, configurable: true });
}

const MODIFIERS: Record<string, string> = { Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift', Cmd: 'Meta' };
const KEY_NAMES: Record<string, string> = {
  '.': 'Period',
  ',': 'Comma',
  '/': 'Slash',
  ';': 'Semicolon',
  '=': 'Equal',
  '-': 'Minus',
  Esc: 'Escape',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Return: 'Enter',
};

/**
 * A chord in the table's normal form (`Shift+Cmd+Z`, `Ctrl+Shift+.`, `F9`) as the key name
 * Playwright's `keyboard.press` takes. Letters and digits are pressed by their code (`KeyZ`,
 * `Digit1`), because a chord with Alt is matched by position (rule K6).
 */
export function playwrightKey(chord: string): string {
  const parts = chord.split('+');
  // `Ctrl++` would end in an empty part; no command uses `+`, so this only guards the split.
  const key = parts.pop() ?? '';
  const name = /^[A-Z]$/.test(key) ? `Key${key}` : /^[0-9]$/.test(key) ? `Digit${key}` : (KEY_NAMES[key] ?? key);
  return [
    ...parts.map((modifier) => {
      const mapped = MODIFIERS[modifier];
      if (!mapped) throw new Error(`Unknown modifier "${modifier}" in chord "${chord}"`);
      return mapped;
    }),
    name,
  ].join('+');
}

/** The chords of a command that act in a browser on this key map, first = the one menus show. */
export function chordsOf(id: KnownCommandId, keys: KeyMap): string[] {
  return chordsOn(id, keys === 'mac' ? 'mac' : 'windows', false);
}

/** The first chord of a command on this key map; throws when the command has none there. */
export function chordOf(id: KnownCommandId, keys: KeyMap): string {
  const chord = chordsOf(id, keys)[0];
  if (!chord) throw new Error(`Command ${id} has no chord on the ${keys} key map`);
  return chord;
}

/** CodeMirror's and the browser's own `Mod` key on this key map (Select All, Mod-Home, ...). */
export function modKey(keys: KeyMap): 'Meta' | 'Control' {
  return keys === 'mac' ? 'Meta' : 'Control';
}
