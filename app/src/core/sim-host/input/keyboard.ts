// Keyboard of the Output panel (ARCHITECTURE.md 3.6): translates browser key events into what
// Windows would have delivered and posts them to the run controller.
//
// STUB written by W1 (wave 0). SH4 replaces the body; the class name, the constructor signature and
// the exported names are contract (section 8, "Stubs"). This stub posts nothing.
//
// Owner: W1 > SH4.

import type { KeyboardDeps, KeyLike, OutputKeyboardApi } from '../../../contracts';

export type { InputEvent68k, KeyboardDeps } from '../../../contracts';

export class OutputKeyboard implements OutputKeyboardApi {
  constructor(private readonly deps: KeyboardDeps) {}

  keydown(_ev: KeyLike & { repeat: boolean; shiftKey: boolean }, _pasteChord: boolean): void {}
  keyup(_ev: KeyLike): void {}
  text(_composed: string): void {}
  paste(_text: string): void {}
  focusGained(): void {}
  focusLost(): void {}
  resetToStartup(): void {}
}
