// template.NEW (editor-ui §12; ARCHITECTURE.md 3.10, 5.6): plain text, Windows-1252, CR LF on disk.
// The port keeps the text as `EditorSettings.template` with "\n" line breaks, as documents hold
// text (3.9.1). Owner: E4.

import type { Bytes } from '../../../contracts';
import { decode, encode } from '../../codec/cp1252';

/** The file's text as the port keeps it: every byte one character; CR LF, lone LF, lone CR -> "\n". */
export function templateFromBytes(bytes: Bytes): string {
  return decode(bytes).replace(/\r\n?/g, '\n');
}

/**
 * The text as the original saves it (`Template->Lines->SaveToFile`): Windows-1252 with CR LF.
 * `unmappable` counts characters that Windows-1252 cannot hold, written as `?`.
 */
export function templateToBytes(text: string): { bytes: Bytes; unmappable: number } {
  return encode(text.replace(/\r\n?|\n/g, '\r\n'));
}
