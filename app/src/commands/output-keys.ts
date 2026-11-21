// Keys while the Output panel has the keyboard (ARCHITECTURE.md 2.9.4). Owner: W3.
//
// The Output panel stands for the original's I/O window, and a 68000 program can observe every
// key that reaches it. The dispatcher (keymap.ts) therefore steps aside there, and the panel
// (features/output, owner SH4) asks this module what a key-down is before it does anything else.
// The answer follows the four rules of 2.9.4, in order:
//
//  1. release   Ctrl+Alt+O (Ctrl+Option+O), by key position: run `sim.output.releaseKeyboard`.
//               Nothing is delivered to the program. Works in every state, also after task 24.
//  2. command   A menu shortcut in the ORIGINAL's spelling: the eleven commands that task 24 can
//               switch off, and Find and Go to PC. Run the command if `enabled`; the key-down is
//               not delivered to the program either way. After task 24 only Find and Go to PC.
//               This holds on every platform, in a browser and in the desktop app, for every
//               such key-down that arrives - also Ctrl+F4, which most browsers on Windows and
//               Linux never deliver to a page.
//  3. tab       Plain Tab and Shift+Tab: no key-down and no character for the program; cancel the
//               event so that the focus stays in the panel.
//  4. program   Every other key: post it to the program. Then, only while key commands are
//               enabled, `then` names one of the I/O window's own three commands:
//               'fullscreen' (Alt+Enter), 'paste' (Shift+Insert; Cmd+V on macOS), 'nextPanel'
//               (Ctrl+Tab, desktop app only).
//
// The chords the port added elsewhere (F2, F4, Shift+F<n>) are not active here: they are keys of
// the program (rules K3 and K5 of section 1.3). Which events to cancel is the panel's business
// (the list at the end of 2.9.4), because it depends on composition and on the paste chord.

import type { CommandRegistry } from '../contracts';
import { chordOf, type KeyEventLike, type Os } from './chords';
import type { KnownCommandId } from './ids';
import { COMMAND_SPECS } from './specs';
import { SUPPRESSED_BY_TASK_24 } from './tables/keys';

export type OutputKeyAction =
  | { kind: 'release' }
  | { kind: 'command'; id: KnownCommandId; enabled: boolean }
  | { kind: 'tab' }
  | { kind: 'program'; then: 'fullscreen' | 'paste' | 'nextPanel' | null };

export interface OutputKeyEnv {
  os: Os;
  /** True in the desktop app, where Ctrl+Tab reaches the page and moves to the next panel (rule 4). */
  desktop: boolean;
  /** False while task 24 has switched key commands off (AppState.sim.keyCommands). */
  keyCommandsEnabled: boolean;
  commands: Pick<CommandRegistry, 'isEnabled'>;
}

/** The commands whose shortcuts act in the Output panel (rule 2), in the order of 2.9.4. */
export const OUTPUT_SHORTCUT_COMMANDS: readonly KnownCommandId[] = [
  ...SUPPRESSED_BY_TASK_24,
  'sim.search.find',
  'sim.search.gotoPC',
];

/** Every chord of `id` on the platform's key map. */
function chordsOf(id: KnownCommandId, os: Os): string[] {
  const keys = COMMAND_SPECS[id].keys;
  return os === 'mac' ? keys.mac : keys.win;
}

/**
 * The chords of `id` that rule 2 takes on this platform: all of its chords except the ones the
 * port added (`notInOutput`), which are keys of the program here.
 *
 * `desktopOnly` plays no part, on purpose. It says that a browser usually keeps a key to itself
 * (Ctrl+F4 closes the tab on Windows and Linux, 2.9.3), so the key cannot be promised to the
 * user. But a key-down that does arrive is the original's menu shortcut, in a browser as in the
 * desktop app: the original's I/O window never sees it, so the program must not see it either
 * (2.9.4 rule 2 lists Ctrl+F4 for every platform; section 0 rule 1).
 */
function outputChords(id: KnownCommandId, os: Os): string[] {
  const added = COMMAND_SPECS[id].keys.notInOutput ?? [];
  return chordsOf(id, os).filter((chord) => !added.includes(chord));
}

/** The chords that rule 2 takes on this platform while key commands are enabled, each with its command. */
export function outputShortcuts(os: Os): { chord: string; id: KnownCommandId }[] {
  return OUTPUT_SHORTCUT_COMMANDS.flatMap((id) => outputChords(id, os).map((chord) => ({ chord, id })));
}

/** What a key-down in the Output panel is (rules 1 to 4 above). */
export function outputPanelKeyAction(event: KeyEventLike, env: OutputKeyEnv): OutputKeyAction {
  const chord = chordOf(event);
  if (chord === null) return { kind: 'program', then: null };

  // 1. The release chord.
  if (chordsOf('sim.output.releaseKeyboard', env.os).includes(chord)) return { kind: 'release' };

  // 2. Menu shortcuts in the original's spelling.
  for (const id of OUTPUT_SHORTCUT_COMMANDS) {
    if (!env.keyCommandsEnabled && COMMAND_SPECS[id].suppressedByTask24) continue;
    if (outputChords(id, env.os).includes(chord)) {
      return { kind: 'command', id, enabled: env.commands.isEnabled(id) };
    }
  }

  // 3. Plain Tab and Shift+Tab.
  if (chord === 'Tab' || chord === 'Shift+Tab') return { kind: 'tab' };

  // 4. Everything else goes to the program; the I/O window's own commands follow.
  if (!env.keyCommandsEnabled) return { kind: 'program', then: null };
  if (chordsOf('sim.output.fullscreen', env.os).includes(chord)) return { kind: 'program', then: 'fullscreen' };
  if (chordsOf('sim.output.paste', env.os).includes(chord)) return { kind: 'program', then: 'paste' };
  if (env.desktop && chord === 'Ctrl+Tab') return { kind: 'program', then: 'nextPanel' };
  return { kind: 'program', then: null };
}
