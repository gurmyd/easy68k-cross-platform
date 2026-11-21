// Windows virtual-key codes for browser key events (ARCHITECTURE.md 3.6; trap15-b §9.1).
//
// STUB written by W1 (wave 0). SH4 replaces the body; the exported names and signatures are
// contract (section 8, "Stubs"). The stub knows no key and returns 0.
//
// Owner: W1 > SH4.

/** Windows virtual-key code for a KeyboardEvent.code, or 0. Table: trap15-b §9.1 (last paragraph).
 *  numLock decides between the digit and the navigation codes of the keypad. */
export function vkFromCode(_code: string, _numLock: boolean): number {
  return 0;
}
