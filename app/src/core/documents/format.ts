// Bytes of a document on disk, and the bytes the assembler receives (ARCHITECTURE.md 3.9.2, 3.9.3,
// 5.1, 5.2; editor-ui §6.3, §6.4, §6.7).
//
// A document's text in memory is a string of Unicode characters that are images of Windows-1252
// bytes, with "\n" between lines (3.9.1). These functions are the only way between that text and
// bytes:
//
//   decodeFile          file bytes -> text (every byte kept; CR LF, lone LF, lone CR end a line)
//   stripTrailer        removes the font/tab trailer of a loaded source, as TTextStuff::LoadFile
//   encodeFile          text -> file bytes, with the trailer for an .X68 source, as Save + SaveFont
//   encodeForAssembler  text -> the main source the assembler receives
//
// What the original does is in the comments; the ground truth that these functions reproduce byte
// for byte is the official EDIT68K v5.16.1 run under Wine (see format.test.ts and
// ground-truth.test.ts).
//
// Owner: E1. Runs under Node and in browsers (core/ rules, 3.1).

import { TabType, type Bytes, type DocDefaults, type DocumentState } from '../../contracts';
import { decode, encode } from '../codec/cp1252';
import { extractFileExt } from '../paths/winpath';

/** What a source file supplies when it is loaded: its text without the trailer, and the settings. */
export interface LoadedSource {
  text: string;
  tabType: TabType;
  tabSize: number;
  fontName: string;
  fontSize: number;
  /**
   * The original's trailer loop stopped with an exception (a trailer line too short for the
   * characters it reads; see `stripTrailer`). The editor then shows `Error in LoadFile()` and still
   * shows the document. Addition of E1 (docs/porting/errata/E1.md).
   */
  loadError: boolean;
}

/** The four trailer prefixes, exactly as the original compares them (case-sensitive). */
export const TRAILER_PREFIX = {
  tabSize: '*~Tab size~',
  tabType: '*~Tab type~',
  fontSize: '*~Font size~',
  fontName: '*~Font name~',
} as const;

/**
 * Windows-1252 bytes to document text. Every byte becomes one character (decode followed by
 * encode gives the bytes back). CR LF, a lone LF and a lone CR each end a line and become "\n"
 * (5.1). A final line break stays a final "\n". Tabs, Ctrl-Z, NUL and everything else are kept.
 */
export function decodeFile(bytes: Bytes): string {
  return decode(bytes).replace(/\r\n?/g, '\n');
}

/** C's atoi on at most the characters given: optional blanks, optional sign, decimal digits. */
function atoi(text: string): number {
  const match = /^[ \t\n\v\f\r]*([+-]?\d+)/.exec(text);
  return match ? Number.parseInt(match[1] as string, 10) : 0;
}

/** Thrown inside stripTrailer where the original's AnsiString::operator[] throws ERangeError. */
class RangeErrorOfOriginal extends Error {}

/**
 * The original's `str[i]` (1-based) on an AnsiString: C++Builder's operator[] checks the index and
 * throws ERangeError outside 1..Length (dstring.h, ThrowIfOutOfRange).
 */
function charAt(line: string, oneBased: number): string {
  if (oneBased < 1 || oneBased > line.length) throw new RangeErrorOfOriginal();
  return line[oneBased - 1] as string;
}

/**
 * The characters the original copies into `temp`: from 1-based position `from` while the
 * character is not '~' and the position is below `limit` (textS.cpp:144-146, 157-159, 164-166).
 * The character test comes first, so a line that ends before a '~' throws (charAt).
 */
function copyField(line: string, from: number, limit: (i: number) => boolean): string {
  let out = '';
  for (let i = from; charAt(line, i) !== '~' && limit(i); i++) out += line[i - 1] as string;
  return out;
}

/**
 * Removes the font/tab trailer from loaded source text and takes the settings from it
 * (3.9.2; editor-ui §6.3 step 4; textS.cpp:139-173).
 *
 * The text is split into lines; a final line break does not start another line (the RichEdit's
 * `Lines->Count`). The lines with 0-based index count-1 down to count-4 are examined, each
 * independently, in that order. A line that starts with one of the four prefixes supplies its value
 * and is removed together with its own line break; other lines stay. Values:
 *
 *   `*~Tab size~`   atoi of the characters at 1-based positions 12 and 13 up to a '~'
 *   `*~Tab type~`   character 12 '0' -> Assembly, anything else (also none) -> Fixed
 *   `*~Font size~`  atoi of the characters at 13 and 14 up to a '~'
 *   `*~Font name~`  the characters from 13 up to the next '~', never the line's last character
 *                   (the loop runs while i < Length); any name is kept, never a substitute
 *
 * A setting without a trailer line keeps its value from `defaults`.
 *
 * Quirk kept: a trailer line that ends before the original's loop meets a '~' or its position
 * limit (`*~Tab size~4` without the closing '~', `*~Font size~`, `*~Font name~`) makes
 * C++Builder's AnsiString index check throw. The original's LoadFile then shows `Error in LoadFile()`
 * and stops examining: that line and the lines above it stay in the text, values taken so far are
 * kept. `loadError` reports it.
 */
export function stripTrailer(text: string, defaults: DocDefaults): LoadedSource {
  const pieces = text.split('\n');
  const endsWithBreak = text.endsWith('\n');
  if (endsWithBreak) pieces.pop();
  // Each line with its own line break: the last one has none unless the text ends with one.
  const lines = pieces.map((line, index) => ({ line, br: index < pieces.length - 1 || endsWithBreak }));

  const result: LoadedSource = { ...defaults, text: '', loadError: false };
  const count = lines.length;
  try {
    // textS.cpp:140 runs cnt from count down to count-4; index count is past the end (an empty
    // string) and negative indexes give empty strings, so neither can match.
    for (let cnt = count - 1; cnt > count - 5 && cnt >= 0; cnt--) {
      const str = (lines[cnt] as { line: string }).line;
      if (str.startsWith(TRAILER_PREFIX.tabSize)) {
        result.tabSize = atoi(copyField(str, 12, (i) => i < 14));
        lines.splice(cnt, 1);
      } else if (str.startsWith(TRAILER_PREFIX.tabType)) {
        result.tabType = str.charAt(11) === '0' ? TabType.Assembly : TabType.Fixed;
        lines.splice(cnt, 1);
      } else if (str.startsWith(TRAILER_PREFIX.fontSize)) {
        result.fontSize = atoi(copyField(str, 13, (i) => i < 15));
        lines.splice(cnt, 1);
      } else if (str.startsWith(TRAILER_PREFIX.fontName)) {
        result.fontName = copyField(str, 13, (i) => i < str.length);
        lines.splice(cnt, 1);
      }
    }
  } catch (error) {
    if (!(error instanceof RangeErrorOfOriginal)) throw error;
    result.loadError = true;
  }
  result.text = lines.map(({ line, br }) => (br ? `${line}\n` : line)).join('');
  return result;
}

/** `ExtractFileExt` then `UpperCase` (ASCII letters only, as the VCL's UpperCase). */
export function upperExt(name: string): string {
  return extractFileExt(name).replace(/[a-z]/g, (letter) => letter.toUpperCase());
}

/** True for a document that gets the trailer when saved: a source whose name ends in .X68 in any case. */
export function getsTrailer(doc: Pick<DocumentState, 'kind' | 'path' | 'name'>): boolean {
  return doc.kind === 'source' && upperExt(doc.path ?? doc.name) === '.X68';
}

/** The text of the trailer that SaveFont appends, with "\n" line breaks (mainS.cpp:246-251). */
export function trailerText(doc: Pick<DocumentState, 'fontName' | 'fontSize' | 'tabType' | 'tabSize'>): string {
  return (
    '\n' +
    `${TRAILER_PREFIX.fontName}${doc.fontName}~\n` +
    `${TRAILER_PREFIX.fontSize}${Math.trunc(doc.fontSize)}~\n` +
    `${TRAILER_PREFIX.tabType}${doc.tabType}~\n` +
    `${TRAILER_PREFIX.tabSize}${Math.trunc(doc.tabSize)}~\n`
  );
}

/** "\n" -> CR LF. */
function withCrLf(text: string): string {
  return text.replace(/\n/g, '\r\n');
}

/**
 * The bytes Save writes (3.9.3; editor-ui §6.4): the text with every "\n" as CR LF (a line break
 * after the last line only if the text ends with one), then, for a source document whose file name
 * ends in .X68 in any letter case, CR LF and the four trailer lines `*~Font name~<name>~`,
 * `*~Font size~<size>~`, `*~Tab type~<0|1>~`, `*~Tab size~<n>~`, each ending in CR LF. The file
 * name is `doc.path`, or `doc.name` for a document that has none yet. A character without a
 * Windows-1252 byte is written as '?' (countUnmappable tells how many there are).
 */
export function encodeFile(doc: DocumentState, text: string): Bytes {
  const body = withCrLf(text) + (getsTrailer(doc) ? withCrLf(trailerText(doc)) : '');
  return encode(body).bytes;
}

/**
 * The main source as the assembler receives it (4.9 step 4): the editor text without the trailer,
 * every "\n" written as CR LF, nothing appended. The original hands the assembler what its
 * RichEdit's plain-text save writes, and that ends with CR LF only if the text ends with a line
 * break (ground truth: four corpus files without a final line end; docs/porting/errata/E1.md).
 */
export function encodeForAssembler(text: string): Bytes {
  return encode(withCrLf(text)).bytes;
}

/** The number of characters of `text` that have no Windows-1252 byte and would be saved as '?'. */
export function countUnmappable(text: string): number {
  return encode(text).unmappable;
}

/**
 * True when the bytes are valid UTF-8 and contain at least one multi-byte sequence: the editor
 * then shows `This file looks like UTF-8. EASy68K reads it as Windows-1252.` (5.1). Nothing is
 * converted. A UTF-8 byte-order mark counts as a multi-byte sequence.
 */
export function looksLikeUtf8(bytes: Bytes): boolean {
  let multi = false;
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i] as number;
    if (b < 0x80) {
      i++;
      continue;
    }
    let need: number;
    let min: number;
    if (b >= 0xc2 && b <= 0xdf) [need, min] = [1, 0x80];
    else if (b >= 0xe0 && b <= 0xef) [need, min] = [2, 0x800];
    else if (b >= 0xf0 && b <= 0xf4) [need, min] = [3, 0x10000];
    else return false;
    let cp = b & (need === 1 ? 0x1f : need === 2 ? 0x0f : 0x07);
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return false;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return false;
    multi = true;
    i += need + 1;
  }
  return multi;
}

/** The text of the UTF-8 banner (5.1). */
export const UTF8_BANNER = 'This file looks like UTF-8. EASy68K reads it as Windows-1252.';
