// Texts of the two log files that the application, not the engine, produces (ARCHITECTURE.md 5.3,
// 5.5; sim-ui §13).
//
//   formatUsDateTime(date)     the date in the log headers, as DateTimeToStr prints it on a US
//                              English Windows: "11/20/2026 3:04:05 PM", date only at midnight
//   outputLogHeader(date)      "EASy68K output log file: <date>" CR LF CR LF (the execution log's
//                              header is written by the engine, from the same date text)
//   defaultLogFileNames(path)  <name>_RunLog.txt and <name>_OutLog.txt beside the program
//
// Owner: U4. Pure functions; run under Node and in browsers.

import type { Bytes, VPath } from '../../../contracts';
import { changeFileExt } from '../../paths/winpath';

/**
 * `DateTimeToStr(Now())` of the original with the US English short date and long time formats
 * (`M/d/yyyy`, `h:mm:ss tt`): no leading zero on month, day and hour; at exactly midnight only the
 * date, as `DateTimeToStr` leaves the time out when it is zero (5.3).
 */
export function formatUsDateTime(date: Date): string {
  const day = `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  if (hours === 0 && minutes === 0 && seconds === 0) return day;
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const two = (value: number) => String(value).padStart(2, '0');
  return `${day} ${hour12}:${two(minutes)}:${two(seconds)} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** Bytes of an ASCII text (every character below 128). */
export function asciiBytes(text: string): Bytes {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

/** The first bytes of the output log: `EASy68K output log file: %s\r\n\r\n` (logU.cpp:185). */
export function outputLogHeader(time: string): Bytes {
  return asciiBytes(`EASy68K output log file: ${time}\r\n\r\n`);
}

/**
 * The default names of the two log files (sim-ui §13.1): the program's path with its extension
 * replaced, `ChangeFileExt(name, "_RunLog.txt")` and `ChangeFileExt(name, "_OutLog.txt")`.
 */
export function defaultLogFileNames(programPath: VPath): { exec: string; output: string } {
  return { exec: changeFileExt(programPath, '_RunLog.txt'), output: changeFileExt(programPath, '_OutLog.txt') };
}
