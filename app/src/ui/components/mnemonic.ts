// Access keys ("mnemonics") in captions. Owner: W2.
//
// The original's captions mark the access key with '&' ('&Open File...',
// 'Save &As...'); '&&' is a literal '&'. Command tables keep that spelling
// (3.12.2, CommandSpec.caption), and the menu bar, menus, buttons, check boxes
// and dialogs render it with the letter underlined and react to the key.

export interface ParsedCaption {
  /** The caption without the markers. */
  text: string;
  /** Index into `text` of the access key, or -1. */
  index: number;
  /** The access key in lower case, or null. */
  key: string | null;
}

/** Splits a caption with '&' markers into its text and access key. The first marker wins. */
export function parseMnemonic(caption: string): ParsedCaption {
  let text = '';
  let index = -1;
  for (let i = 0; i < caption.length; i++) {
    const ch = caption[i];
    if (ch === '&' && i + 1 < caption.length) {
      const next = caption[i + 1] ?? '';
      if (next === '&') {
        text += '&';
        i++;
        continue;
      }
      if (index < 0) index = text.length;
      continue;
    }
    text += ch;
  }
  const key = index >= 0 ? (text[index] ?? '').toLowerCase() || null : null;
  return { text, index: key ? index : -1, key };
}

/** The caption's text without markers ('Save &As...' gives 'Save As...'). */
export function stripMnemonic(caption: string): string {
  return parseMnemonic(caption).text;
}

/**
 * The letter or digit of a key event for mnemonic matching, in lower case, or
 * null. With Alt (Option on macOS), or when `key` is not ASCII, the physical
 * key decides (KeyboardEvent.code), because Option changes the character
 * (Option+O is 'ø') and non-Latin layouts have no ASCII letters (rule K6).
 */
export function mnemonicKeyOf(event: { key: string; code: string; altKey: boolean }): string | null {
  const fromCode = /^Key([A-Z])$/.exec(event.code)?.[1] ?? /^Digit(\d)$/.exec(event.code)?.[1] ?? null;
  if (event.altKey) return fromCode ? fromCode.toLowerCase() : null;
  if (event.key.length === 1 && /^[\x21-\x7e]$/.test(event.key)) return event.key.toLowerCase();
  return fromCode ? fromCode.toLowerCase() : null;
}

/**
 * The next item, after `from`, whose access key is `key`; the search wraps.
 * Returns the index and whether it is the only item with that key (Windows
 * activates a unique match and only moves to a shared one). `captions` may
 * contain null for items that cannot be chosen (separators).
 */
export function findMnemonic(
  captions: readonly (string | null)[],
  key: string,
  from: number,
): { index: number; unique: boolean } | null {
  const wanted = key.toLowerCase();
  const matches: number[] = [];
  captions.forEach((caption, i) => {
    if (caption !== null && parseMnemonic(caption).key === wanted) matches.push(i);
  });
  if (matches.length === 0) return null;
  const next = matches.find((i) => i > from) ?? matches[0] ?? -1;
  return { index: next, unique: matches.length === 1 };
}

/**
 * The next item, after `from`, whose text starts with `prefix` (type-ahead in
 * lists and the fallback in menus whose captions have no access key).
 */
export function findTypeahead(labels: readonly (string | null)[], prefix: string, from: number): number {
  const wanted = prefix.toLowerCase();
  const n = labels.length;
  for (let step = 1; step <= n; step++) {
    const i = (((from + step) % n) + n) % n;
    const label = labels[i];
    if (label !== null && label !== undefined && stripMnemonic(label).toLowerCase().startsWith(wanted)) return i;
  }
  return -1;
}
