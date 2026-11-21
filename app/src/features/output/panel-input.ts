// The keys of the Output panel (ARCHITECTURE.md 2.9.4): what the panel does with the events of its
// hidden textarea. No DOM here; OutputPanel.tsx passes the browser's events in.
//
// While the textarea has the focus the keyboard dispatcher does nothing at all, so every key-down
// is decided here, in the original's order (commands/output-keys.ts names the rule a key falls
// under):
//
//  1. The release chord (Ctrl+Alt+O) runs `sim.output.releaseKeyboard`. Nothing reaches the program.
//  2. A menu shortcut in the original's spelling runs its command if that is enabled. The key-down
//     does not reach the program either way.
//  3. Plain Tab and Shift+Tab do nothing.
//  4. Every other key-down is posted to the program (core/sim-host/input/keyboard.ts). Then, only
//     while key commands are enabled, the I/O window's own commands act: Alt+Enter toggles full
//     screen, the paste chord pastes, Ctrl+Tab (desktop app) moves to the next panel.
//
// Every key-up is posted.
//
// Which events are cancelled (`preventDefault()`): every key-down of rules 1 to 3 and every
// key-down of rule 4, EXCEPT those from which the browser itself has to make text or a paste:
//
//  - a key whose `key` is `Dead`, `Process` or `Unidentified`, or is text of several characters
//    (a dead key followed by a letter it does not combine with);
//  - a key-down during composition (`isComposing`, or `keyCode` 229, which is how Safari marks it);
//  - the paste chord, while key commands are enabled.
//
// For those the browser puts the text into the textarea, or fires `paste`, and the panel takes it
// from there (text(), paste()). Cancelling everything else is what stops scrolling, focus
// movement, browser shortcuts and the macOS press-and-hold accent menu, and what lets held keys
// repeat for games.

import type { CommandRegistry, OutputKeyboardApi, Scheduler } from '../../contracts';
import type { KeyEventLike, Os } from '../../commands/chords';
import type { KnownCommandId } from '../../commands/ids';
import { outputPanelKeyAction } from '../../commands/output-keys';
import { isOneCharacter } from '../../core/sim-host/input/chars';

/** The parts of a keyboard event the panel reads; a plain object will do in tests. */
export interface PanelKeyEvent extends KeyEventLike {
  readonly repeat: boolean;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
  preventDefault(): void;
}

/** What a key-down was (rules 1 to 4), for tests and diagnostics. */
export type PanelKeyOutcome =
  | { kind: 'release' }
  | { kind: 'command'; id: KnownCommandId; ran: boolean }
  | { kind: 'tab' }
  | { kind: 'program'; cancelled: boolean; then: 'fullscreen' | 'paste' | 'nextPanel' | null };

export interface PanelInputEnv {
  os: Os;
  /** True in the desktop app. */
  desktop: boolean;
  /** The session's keyboard (ctx.sim.keyboard). */
  keyboard(): OutputKeyboardApi;
  /** `!engine.state().keyCommandsDisabled`: false after TRAP #15 task 24 with D1.L = 1. */
  keyCommandsEnabled(): boolean;
  commands: Pick<CommandRegistry, 'isEnabled' | 'run'>;
  /** Called first for every key-down: a user gesture has happened in the panel (audio may start, a
   *  waiting full-screen request is carried out). True if full screen was entered by it. */
  gesture(): boolean;
  toggleFullScreen(): void;
  nextPanel(): void;
  setTimer: Scheduler['setTimer'];
}

/**
 * How long the key-down of a paste chord waits for the browser's `paste` event before it is sent
 * without text (an empty clipboard fires none). A browser fires `paste` while it handles the key
 * itself, so no time is needed (3.6: "a zero-delay timer"). In the desktop app the paste comes
 * back from the application's Edit menu through the main process, a moment later.
 */
export const PASTE_WAIT_MS = { browser: 0, desktop: 150 } as const;

/** `KeyboardEvent.key` values of keys that only an input method or a dead key can turn into text. */
const COMPOSING_KEYS: ReadonlySet<string> = new Set(['Dead', 'Process', 'Unidentified']);

/**
 * True for a key-down whose text the browser has to produce: a dead key, an input-method key, or
 * a `key` that is text of several characters. Names of keys (`Enter`, `ArrowUp`, `F1`) are ASCII
 * words that start with a capital letter.
 */
function producesTextLater(key: string): boolean {
  if (COMPOSING_KEYS.has(key)) return true;
  if (key === '' || isOneCharacter(key)) return false;
  return !/^[A-Z][A-Za-z0-9]*$/.test(key);
}

export class PanelInput {
  /** Cancels the timer that sends a waiting paste-chord key-down without text. */
  private cancelPasteTimer: (() => void) | null = null;
  /** Set while a paste event is expected for the paste command; cancels the wait. */
  private cancelExpectedPaste: (() => void) | null = null;

  constructor(private readonly env: PanelInputEnv) {}

  keydown(event: PanelKeyEvent): PanelKeyOutcome {
    const { env } = this;
    const enteredFullScreen = env.gesture();

    // A key the input method is composing with is text in the making, never a chord.
    const composing = event.isComposing === true || event.keyCode === 229;
    let then: 'fullscreen' | 'paste' | 'nextPanel' | null = null;
    if (!composing) {
      const action = outputPanelKeyAction(event, {
        os: env.os,
        desktop: env.desktop,
        keyCommandsEnabled: env.keyCommandsEnabled(),
        commands: env.commands,
      });
      switch (action.kind) {
        case 'release':
          event.preventDefault();
          void env.commands.run('sim.output.releaseKeyboard');
          return { kind: 'release' };
        case 'command':
          event.preventDefault();
          if (action.enabled) void env.commands.run(action.id);
          return { kind: 'command', id: action.id, ran: action.enabled };
        case 'tab':
          event.preventDefault();
          return { kind: 'tab' };
        case 'program':
          then = action.then;
      }
    }

    const paste = then === 'paste';
    const leftToBrowser = composing || paste || producesTextLater(event.key);
    if (!leftToBrowser) event.preventDefault();

    const keyboard = env.keyboard();
    keyboard.keydown(
      {
        // Safari reports the letter itself during composition; the key has no character of its own.
        key: composing ? 'Process' : event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        repeat: event.repeat,
      },
      paste,
    );

    if (paste) {
      // The browser fires `paste` now. If it does not (an empty clipboard), the key goes out alone.
      this.cancelPasteTimer?.();
      this.cancelPasteTimer = env.setTimer(env.desktop ? PASTE_WAIT_MS.desktop : PASTE_WAIT_MS.browser, () => {
        this.cancelPasteTimer = null;
        keyboard.paste('');
      });
    } else if (then === 'fullscreen') {
      // The key that carried out a waiting request has already switched; it does not switch back.
      if (!enteredFullScreen) env.toggleFullScreen();
    } else if (then === 'nextPanel') {
      env.nextPanel();
    }
    return { kind: 'program', cancelled: !leftToBrowser, then };
  }

  keyup(event: PanelKeyEvent): void {
    // Cancelled as well: a released Alt or F10 would otherwise move the focus to the browser's menu.
    event.preventDefault();
    this.env.keyboard().keyup({
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });
  }

  /**
   * Text the browser has put into the textarea for a key-down that was not cancelled. The panel
   * calls this from `input` (while no composition is going on) and from `compositionend` with the
   * textarea's value and clears the textarea, so whichever event comes first delivers the text
   * and the other finds nothing.
   */
  text(value: string): void {
    if (value === '') return;
    // A line break in a textarea is the Enter key (a virtual keyboard sends it as text).
    this.env.keyboard().text(value.replace(/\r\n|\n/g, '\r'));
  }

  /** The textarea's paste event, already cancelled by the panel. */
  paste(text: string): void {
    this.cancelPasteTimer?.();
    this.cancelPasteTimer = null;
    if (this.cancelExpectedPaste) {
      this.cancelExpectedPaste();
      this.cancelExpectedPaste = null;
      this.pasteByCommand(text);
      return;
    }
    this.env.keyboard().paste(text);
  }

  /**
   * `sim.output.paste` run as a command, without its key: `text` is typed in as the paste chord
   * does it. The chord's key is recorded, the text follows in the same entry, and the key goes up
   * again, so that TRAP #15 task 19 does not see it held.
   */
  pasteByCommand(text: string): void {
    const keyboard = this.env.keyboard();
    const key =
      this.env.os === 'mac'
        ? { key: 'v', code: 'KeyV', ctrlKey: false, altKey: false, metaKey: true, shiftKey: false, repeat: false }
        : {
            key: 'Insert',
            code: 'Insert',
            ctrlKey: false,
            altKey: false,
            metaKey: false,
            shiftKey: true,
            repeat: false,
          };
    keyboard.keydown(key, true);
    keyboard.paste(text);
    keyboard.keyup(key);
  }

  /**
   * Desktop app: the command has asked the platform to paste into the textarea
   * (Platform.pasteIntoFocus). The paste event that arrives within a moment is that paste.
   */
  expectPaste(): void {
    this.cancelExpectedPaste?.();
    this.cancelExpectedPaste = this.env.setTimer(PASTE_WAIT_MS.desktop, () => {
      this.cancelExpectedPaste = null;
    });
  }

  focus(): void {
    this.env.keyboard().focusGained();
  }

  blur(): void {
    this.cancelPasteTimer?.();
    this.cancelPasteTimer = null;
    this.env.keyboard().focusLost();
  }
}
