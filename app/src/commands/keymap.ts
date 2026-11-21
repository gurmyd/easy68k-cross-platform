// The keyboard dispatcher (ARCHITECTURE.md 2.9.1). Owner: W3.
//
// ONE `keydown` listener on `window`, in the capture phase, decides about every command chord of
// the application. Feature code never listens for a command chord itself; it registers a command
// handler and the chord table (tables/keys.ts) binds the keys.
//
// For every key-down the dispatcher builds the chord (chords.ts) and resolves it in this order:
//
//  1. A modal dialog is open: nothing runs. The dialog keeps its own keys (Enter, Esc, Tab, its
//     access keys) and its text fields keep theirs.
//  2. The Output panel has the keyboard: the dispatcher steps aside completely. The panel applies
//     the rules of 2.9.4 itself (output-keys.ts has them), because there the running program
//     comes first.
//  3. A command of the current mode is bound to the chord and enabled: run it, cancel the event.
//  4. A command of the current mode is bound to the chord but disabled (or has no handler yet):
//     cancel the event and do nothing. The browser must not act on Ctrl+S, F6 and the like.
//  5. Otherwise the event continues to the focused element.
//
// Five refinements, each with its reason:
//
// - TEXT EDITING. Ctrl/Cmd+Z, X, C, V, A, Shift+Cmd+Z and Shift+Insert are the platform's own
//   editing keys. While a text field or the editor has the focus the dispatcher leaves them
//   alone: the browser's cut, copy and paste only work on the event of the key itself (section
//   1.4 note 45), and a text field of a dialog or panel must keep its own undo and select-all, as
//   the fields of the original do. The editor component binds undo, redo and select-all in its
//   own key map. With the focus anywhere else (a toolbar button, a list) the chord runs the
//   command like any other.
// - EDITOR KEYS. Insert and Ctrl+Shift+. / , (EDITOR_FOCUS_COMMANDS) belong to the editor
//   control in the original. Their handlers are enabled only while the editor has the focus;
//   while they are disabled and a text field has the focus, the key is left to the field
//   instead of being cancelled by step 4.
// - TASK 24. While a program has switched key commands off, the chords of the eleven commands of
//   sim-ui §3.5, and F1 and the panel cycle, do nothing in Simulator mode. They are still
//   cancelled, so the browser does not act on them either.
// - GUARDED CHORDS (2.9.3). F5, F6, F7, F10 and Ctrl+O/S/P/F/G/R are cancelled in every mode and
//   also while a modal dialog or a menu is open, bound or not, so that the browser never reloads
//   the page or opens its own dialogs on a key a student knows from EASy68K.
// - MENUS. While the focus is in the menu bar or an open menu, no command runs: letters and
//   arrows belong to the menu, as on Windows. Alt+letter opens the menu with that access key on
//   Windows and Linux (section 1.4 note 14); macOS has no menu access keys.
//
// A consumed event is cancelled (`preventDefault`) and stopped (`stopPropagation`), so no other
// handler acts on a command chord a second time.

import type { CommandId, CommandRegistry, Mode } from '../contracts';
import { chordOf, type KeyEventLike, type Os } from './chords';
import type { KnownCommandId } from './ids';
import { COMMAND_SPECS, KEY_ORDER, chordsOn } from './specs';
import {
  ALSO_IGNORED_AFTER_TASK_24,
  EDITOR_FOCUS_COMMANDS,
  GUARDED_CHORDS,
  OUTPUT_PANEL_COMMANDS,
  TEXT_EDITING_COMMANDS,
} from './tables/keys';

/**
 * The element that takes keys for the running program carries this attribute (the Output panel's
 * hidden textarea, 2.9.4): `data-e68-keys="program"`. While it, or an element inside it, has the
 * focus, "the Output panel has the keyboard" (2.10).
 */
export const PROGRAM_KEYS_SELECTOR = '[data-e68-keys="program"]';

/** The parts of a keydown event the dispatcher uses; a plain object will do in tests. */
export interface DispatchEvent extends KeyEventLike {
  readonly target: unknown;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface KeymapEnv {
  os: Os;
  /** True in the desktop app: the chords that browsers reserve act as well (2.9.3). */
  desktop: boolean;
  mode(): Mode;
  /** False while TRAP #15 task 24 has switched key commands off (AppState.sim.keyCommands). */
  keyCommandsEnabled(): boolean;
  isModalOpen(): boolean;
  commands: Pick<CommandRegistry, 'isEnabled' | 'run'>;
  /** Opens the menu whose access key is `letter` (lower case); false when there is none. */
  openMenu?(letter: string): boolean;
}

/** What the dispatcher did with a key-down. Returned for tests and diagnostics. */
export type KeyOutcome =
  /** Not a chord the dispatcher knows: the event continues (step 5). */
  | { kind: 'none' }
  /** Part of an input-method composition: never a chord. */
  | { kind: 'composing' }
  /** A modal dialog is open (step 1). */
  | { kind: 'modal'; cancelled: boolean }
  /** The Output panel has the keyboard (step 2). */
  | { kind: 'output' }
  /** The focus is in the menu bar or a menu. */
  | { kind: 'menu'; cancelled: boolean }
  /** A text-editing chord, left to the focused text field. */
  | { kind: 'text'; command: CommandId }
  /** Step 3. */
  | { kind: 'run'; command: CommandId }
  /** Step 4, and the chords task 24 switched off. */
  | { kind: 'disabled'; command: CommandId }
  /** Alt+letter opened a menu. */
  | { kind: 'openMenu' }
  /** A guarded chord with no command in this mode: cancelled, nothing else. */
  | { kind: 'guarded' };

/** Chord -> the commands bound to it on this platform, in table order. */
export function buildBindings(os: Os, desktop: boolean): Map<string, KnownCommandId[]> {
  const bindings = new Map<string, KnownCommandId[]>();
  for (const id of KEY_ORDER) {
    if (OUTPUT_PANEL_COMMANDS.includes(id)) continue;
    for (const chord of chordsOn(id, os, desktop)) {
      const list = bindings.get(chord);
      if (list) list.push(id);
      else bindings.set(chord, [id]);
    }
  }
  return bindings;
}

interface ElementLike {
  tagName?: unknown;
  type?: unknown;
  isContentEditable?: unknown;
  closest?: unknown;
}

function closest(target: unknown, selector: string): unknown {
  const element = target as ElementLike | null;
  return element && typeof element.closest === 'function'
    ? (element.closest as (s: string) => unknown)(selector)
    : null;
}

const NOT_TEXT_INPUT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

/** True for an element the user types text into: a text input, a textarea, editable content. */
export function isTextEntry(target: unknown): boolean {
  const element = target as ElementLike | null;
  if (!element || typeof element.tagName !== 'string') return false;
  if (element.isContentEditable === true) return true;
  const tag = element.tagName.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT')
    return !NOT_TEXT_INPUT.has(typeof element.type === 'string' ? element.type.toLowerCase() : 'text');
  return false;
}

/** True while the element that has the focus takes keys for the running program (2.10). */
export function hasProgramKeys(target: unknown): boolean {
  return Boolean(closest(target, PROGRAM_KEYS_SELECTOR));
}

export interface KeyDispatcher {
  /** Resolves one key-down event as described at the top of this file. */
  handle(event: DispatchEvent): KeyOutcome;
}

export function createKeyDispatcher(env: KeymapEnv): KeyDispatcher {
  const bindings = buildBindings(env.os, env.desktop);
  const guarded: ReadonlySet<string> = new Set(env.os === 'mac' ? GUARDED_CHORDS.mac : GUARDED_CHORDS.win);

  const cancel = (event: DispatchEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    handle(event) {
      // Keys that an input method is composing with are text, never chords (Safari reports 229).
      if (event.isComposing === true || event.keyCode === 229) return { kind: 'composing' };
      const chord = chordOf(event, env.os);
      if (chord === null) return { kind: 'none' };
      const isGuarded = guarded.has(chord);

      // 1. A modal dialog is open.
      if (env.isModalOpen()) {
        if (isGuarded) event.preventDefault();
        return { kind: 'modal', cancelled: isGuarded };
      }
      // 2. The Output panel has the keyboard.
      if (hasProgramKeys(event.target)) return { kind: 'output' };
      // The menu bar and open menus keep their keys.
      if (closest(event.target, '[role="menu"], [role="menubar"]')) {
        if (isGuarded) event.preventDefault();
        return { kind: 'menu', cancelled: isGuarded };
      }

      // 3 and 4. Commands of the current mode, and those of every mode.
      const mode = env.mode();
      const candidates = (bindings.get(chord) ?? []).filter((id) => {
        const owner = COMMAND_SPECS[id].mode;
        return owner === mode || owner === 'app';
      });
      const first = candidates[0];
      if (first !== undefined) {
        if (
          !event.altKey &&
          isTextEntry(event.target) &&
          candidates.every((id) => TEXT_EDITING_COMMANDS.includes(id))
        ) {
          return { kind: 'text', command: first };
        }
        const switchedOff = mode === 'simulator' && !env.keyCommandsEnabled();
        const runnable = candidates.find(
          (id) =>
            !(switchedOff && (COMMAND_SPECS[id].suppressedByTask24 || ALSO_IGNORED_AFTER_TASK_24.includes(id))) &&
            env.commands.isEnabled(id),
        );
        if (
          runnable === undefined &&
          isTextEntry(event.target) &&
          candidates.every((id) => EDITOR_FOCUS_COMMANDS.includes(id))
        ) {
          return { kind: 'text', command: first };
        }
        cancel(event);
        if (runnable === undefined) return { kind: 'disabled', command: first };
        void env.commands.run(runnable);
        return { kind: 'run', command: runnable };
      }

      // Alt+letter opens a menu (not on macOS; a dialog's own access keys come first).
      if (env.os !== 'mac' && env.openMenu && !closest(event.target, '[role="dialog"], [role="alertdialog"]')) {
        const letter = /^Alt\+([A-Z0-9])$/.exec(chord)?.[1];
        if (letter && env.openMenu(letter.toLowerCase())) {
          cancel(event);
          return { kind: 'openMenu' };
        }
      }

      if (isGuarded) {
        event.preventDefault();
        return { kind: 'guarded' };
      }
      // 5. Not ours.
      return { kind: 'none' };
    },
  };
}

/** Installs the dispatcher on `target` (the window), capture phase. Returns the uninstall function. */
export function installKeymap(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  env: KeymapEnv,
  onOutcome?: (outcome: KeyOutcome, event: KeyboardEvent) => void,
): () => void {
  const dispatcher = createKeyDispatcher(env);
  const listener = (event: KeyboardEvent) => {
    const outcome = dispatcher.handle(event);
    onOutcome?.(outcome, event);
  };
  target.addEventListener('keydown', listener, { capture: true });
  return () => target.removeEventListener('keydown', listener, { capture: true });
}
