// Keyboard of the Output panel (ARCHITECTURE.md 3.6): translates browser key events into what
// Windows would have delivered to the original's I/O window and posts them to the run controller,
// which hands them to the engine between instructions (4.3).
//
// The Output panel (features/output) decides which key-downs come here at all (2.9.4). For each
// one this class posts ONE `keyDown` entry: the Windows virtual-key code of the key (vk.ts) and,
// if the key types something, its character (chars.ts) - Windows' WM_KEYDOWN followed by WM_CHAR.
// Auto-repeat posts the entry again, as Windows repeats both messages.
//
//  - A key the virtual-key table does not know is not reported as a key (code 0 would mark "no
//    key" as held for TRAP #15 task 19); if it types a character, that is posted as `char`.
//  - Plain Tab and Shift+Tab post nothing on the way down: the original's framework keeps them
//    (2.9.4 rule 3). Their key-up is posted like every other.
//  - The paste chord: its key-down is kept back until the browser's paste event delivers the text,
//    so that key and text reach the engine as one entry (the original feeds the clipboard from
//    inside its key-down handler). Anything else that happens first sends the key-down by itself.
//  - macOS sends no key-up for a key released while Command is held. When Command goes up, every
//    other key still marked down is released, so that a program never sees a stuck key.
//  - Losing the focus posts nothing: the original delivers nothing either, and the keys stay
//    "down" for task 19 until the window is activated again, which clears the engine's key table.
//
// Owner: W1 > SH4.

import type { InputEvent68k, KeyboardDeps, KeyLike, OutputKeyboardApi } from '../../../contracts';
import { byteForCodePoint } from '../../codec/cp1252';
import { charFromKey, isOneCharacter, pasteBytes } from './chars';
import { vkFromCode } from './vk';

export type { InputEvent68k, KeyboardDeps } from '../../../contracts';

/** `KeyboardEvent.key` of the keypad's keys while NumLock is off (Windows and Linux). */
const KEYPAD_NAVIGATION: ReadonlySet<string> = new Set([
  'Insert',
  'End',
  'ArrowDown',
  'PageDown',
  'ArrowLeft',
  'Clear',
  'ArrowRight',
  'Home',
  'ArrowUp',
  'PageUp',
  'Delete',
]);

/** Shift, Ctrl, Alt and Caps Lock: keys that Command does not swallow the key-up of. */
const MODIFIER_VKS: ReadonlySet<number> = new Set([0x10, 0x11, 0x12, 0x14]);

/** What identifies a physical key between its key-down and its key-up. */
const keyId = (ev: KeyLike): string => ev.code || ev.key;

const isTab = (ev: KeyLike): boolean => ev.code === 'Tab' || ev.key === 'Tab';

const isCommandKey = (ev: KeyLike): boolean => ev.key === 'Meta' || ev.code === 'MetaLeft' || ev.code === 'MetaRight';

export class OutputKeyboard implements OutputKeyboardApi {
  /** The keys reported down, by `keyId`, each with the virtual-key code that was posted for it. */
  private readonly down = new Map<string, number>();
  /** The key-down of a paste chord that waits for its text. */
  private held: { vk: number } | null = null;

  constructor(private readonly deps: KeyboardDeps) {}

  /** Key-down of rule 4 of 2.9.4. pasteChord = the platform's paste chord with key commands enabled. */
  keydown(ev: KeyLike & { repeat: boolean; shiftKey: boolean }, pasteChord: boolean): void {
    this.sendHeld();
    // The form answers Windows' dialog-key query for Tab whenever neither Ctrl nor Alt is down.
    if (isTab(ev) && !ev.ctrlKey && !ev.altKey) return;

    const vk = this.virtualKey(ev);
    if (vk !== 0) this.down.set(keyId(ev), vk);
    if (pasteChord && vk !== 0) {
      this.held = { vk };
      return;
    }
    const ch = this.character(ev);
    if (vk !== 0) this.post(ch === null ? { kind: 'keyDown', vk } : { kind: 'keyDown', vk, ch });
    else if (ch !== null) this.post({ kind: 'char', ch });
  }

  keyup(ev: KeyLike): void {
    this.sendHeld();
    const id = keyId(ev);
    // The code posted on the way down, so that a key cannot go down as one key and up as another
    // (the keypad's codes change with NumLock).
    const vk = this.down.get(id) ?? this.virtualKey(ev);
    this.down.delete(id);
    if (vk !== 0) this.post({ kind: 'keyUp', vk });

    if (this.deps.os === 'mac' && isCommandKey(ev)) {
      for (const [key, code] of [...this.down]) {
        if (MODIFIER_VKS.has(code)) continue;
        this.down.delete(key);
        this.post({ kind: 'keyUp', vk: code });
      }
    }
  }

  /** Text the browser composed from a dead key or an input method: one `char` per character that
   *  Windows-1252 has. */
  text(composed: string): void {
    this.sendHeld();
    for (const character of composed) {
      const ch = byteForCodePoint(character.codePointAt(0) as number);
      if (ch !== null) this.post({ kind: 'char', ch });
    }
  }

  /** The textarea's paste event. With the key-down of the paste chord waiting, key and text go out
   *  as one entry; an empty text sends the key alone. Text pasted without that key (the browser's
   *  own Paste command) arrives as typed characters. */
  paste(text: string): void {
    const paste = pasteBytes(text);
    const held = this.held;
    this.held = null;
    if (held) {
      this.post(paste.length > 0 ? { kind: 'keyDown', vk: held.vk, paste } : { kind: 'keyDown', vk: held.vk });
      return;
    }
    for (const ch of paste) this.post({ kind: 'char', ch });
  }

  /** Posts ioActivated (the key table is cleared). */
  focusGained(): void {
    this.sendHeld();
    this.post({ kind: 'ioActivated' });
  }

  /** Posts nothing; forgets the keys it saw go down. */
  focusLost(): void {
    this.sendHeld(); // a key-down that happened before the focus left
    this.down.clear();
  }

  resetToStartup(): void {
    this.held = null;
    this.down.clear();
  }

  private post(event: InputEvent68k): void {
    this.deps.post(event);
  }

  /** Sends a waiting paste-chord key-down without text: something else happened first. */
  private sendHeld(): void {
    if (!this.held) return;
    const { vk } = this.held;
    this.held = null;
    this.post({ kind: 'keyDown', vk });
  }

  private virtualKey(ev: KeyLike): number {
    // A Mac keyboard has no NumLock: its keypad always types digits. Elsewhere the event says what
    // the keypad key did: `key` is a digit with NumLock on and a navigation key's name with it off.
    const numLock = this.deps.os === 'mac' || !KEYPAD_NAVIGATION.has(ev.key);
    return vkFromCode(ev.code, numLock);
  }

  private character(ev: KeyLike): number | null {
    // Option on a Mac types characters (Option+G is the copyright sign), as AltGr does on Windows,
    // while Windows' Alt + key is a system key without a character. A named key keeps the Windows
    // rule: Option+Return, the full-screen chord, types nothing.
    const typed = this.deps.os === 'mac' && ev.altKey && isOneCharacter(ev.key) ? { ...ev, altKey: false } : ev;
    return charFromKey(typed);
  }
}
