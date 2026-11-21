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
 * The box is a plain-text TRichEdit (optionsS.dfm:209-214), so, as for the source window
 * (editor-ui 6.7), a line break follows the last line only if the text ends with one.
 * `unmappable` counts characters that Windows-1252 cannot hold, written as `?`.
 */
export function templateToBytes(text: string): { bytes: Bytes; unmappable: number } {
  return encode(text.replace(/\r\n?|\n/g, '\r\n'));
}
