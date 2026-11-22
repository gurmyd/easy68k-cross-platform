// Keys for the keyboard-only walk-throughs of the accessibility audit (ARCHITECTURE.md 2.9, 2.11).
// Owner: Q1.
//
// The walk-throughs press the chords the application's own table gives for the key map they run
// with (chordsOn() of app/src/commands/specs.ts, asked in the page). The table writes chords in
// the normal form of app/src/commands/chords.ts (`Ctrl+Alt+O`, `Shift+Cmd+S`, `F9`, `Esc`);
// Playwright wants its own key names (`Control+Alt+KeyO`). Unit-tested in keys.test.mjs.

const MODIFIERS = { Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift', Cmd: 'Meta' };

/** Named keys of the normal form and Playwright's name for each. */
const NAMED = {
  Enter: 'Enter',
  Tab: 'Tab',
  Esc: 'Escape',
  Space: 'Space',
  Insert: 'Insert',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
};

/** Punctuation of the US layout and the `KeyboardEvent.code` of its key. */
const PUNCTUATION = {
  '/': 'Slash',
  '.': 'Period',
  ',': 'Comma',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  '-': 'Minus',
  '=': 'Equal',
  '`': 'Backquote',
  '+': 'Equal',
};

/**
 * Playwright's spelling of a chord in normal form. Letters and digits are given by position
 * (`KeyO`, `Digit1`), as a US keyboard types them, so that Option chords on the macOS key map
 * (matched by position, rule K6) and Ctrl+letter chords on the Windows map both arrive.
 * @param {string} chord
 */
export function playwrightKey(chord) {
  // The key itself may be '+' (written last); split off the modifiers before it.
  const parts = chord.endsWith('++') ? [...chord.slice(0, -2).split('+'), '+'] : chord.split('+');
  const key = parts.pop();
  if (key === undefined || key === '') throw new Error(`not a chord: "${chord}"`);
  const modifiers = parts.map((modifier) => {
    const name = MODIFIERS[modifier];
    if (!name) throw new Error(`unknown modifier "${modifier}" in "${chord}"`);
    return name;
  });
  let name;
  if (/^[A-Z]$/.test(key)) name = `Key${key}`;
  else if (/^[0-9]$/.test(key)) name = `Digit${key}`;
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) name = key;
  else if (NAMED[key]) name = NAMED[key];
  else if (PUNCTUATION[key]) name = PUNCTUATION[key];
  else throw new Error(`unknown key "${key}" in "${chord}"`);
  return [...modifiers, name].join('+');
}

/**
 * Whether Safari, with the system's default setting ("Keyboard navigation" off), stops on this
 * element when the user presses Tab: text fields, text areas, pop-up lists, editable content, and
 * any element with an explicit tabindex of 0 or more. Buttons, check boxes, radio buttons and
 * links without an explicit tabindex are skipped (Option+Tab reaches them). Inside a modal dialog
 * of the application every control is reached, because the dialog moves the focus itself
 * (docs/porting/errata/W2.md entries 13 and 14).
 *
 * Playwright's WebKit on Windows and Linux visits buttons, Safari on a Mac does not; the
 * walk-throughs on the macOS key map therefore press Tab again until the focus is on an element
 * this function accepts, which is the stop Safari would have chosen. The function is passed to
 * page.evaluate(), so it uses nothing from outside its own body.
 * @param {Element} element
 */
export function isSafariTabStop(element) {
  if (!element || typeof element.getAttribute !== 'function') return false;
  if (element.closest && element.closest('[role=dialog][aria-modal=true], [role=alertdialog][aria-modal=true]')) {
    return true;
  }
  const explicit = element.getAttribute('tabindex');
  if (explicit !== null && explicit !== '' && Number(explicit) >= 0) return true;
  const tag = String(element.tagName).toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (element.isContentEditable === true) return true;
  if (tag === 'input') {
    const type = String(element.getAttribute('type') ?? 'text').toLowerCase();
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file', 'color', 'range', 'hidden'].includes(
      type,
    );
  }
  return false;
}
