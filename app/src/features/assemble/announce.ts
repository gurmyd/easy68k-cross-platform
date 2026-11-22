// What the Messages panel of Editor mode tells a screen reader (ARCHITECTURE.md 2.11: the message
// areas are `log` live regions with polite announcements; finding Q1-3 of docs/integration/rc.md).
//
// The grid itself stays quiet; a visually hidden `role=log` element beside it receives this text
// when the list of the document on show changes: a new assembly's messages. Switching to another
// document shows another list but announces nothing, and neither does an empty list (Clear, or an
// assembly without messages: the status dialog tells the counts).
//
// Owner: E5.

import type { EditorMessage } from '../../contracts';
import { foldCase } from '../../core/paths/winpath';

/** At most this many messages are read out; the count says how many there are. */
export const ANNOUNCED_MESSAGES = 3;

/** One row as it is read: `Line 12: ERROR: Undefined symbol` (and the file when it is another one). */
export function messageText(message: EditorMessage, ownPath: string | null): string {
  const other = message.file !== null && (ownPath === null || foldCase(message.file) !== foldCase(ownPath));
  const file = other && message.file !== null ? ` in ${message.file.slice(message.file.lastIndexOf('/') + 1)}` : '';
  return `Line ${message.line}${file}: ${message.text}`;
}

/**
 * The announcement for a change of the list shown, or null for none. `sameDocument` is false when
 * the panel now shows another document's list.
 */
export function messagesAnnouncement(
  before: readonly EditorMessage[],
  after: readonly EditorMessage[],
  sameDocument: boolean,
  ownPath: string | null,
): string | null {
  if (!sameDocument || after === before || after.length === 0) return null;
  const count = after.length === 1 ? '1 assembler message' : `${after.length} assembler messages`;
  const shown = after.slice(0, ANNOUNCED_MESSAGES).map((message) => messageText(message, ownPath));
  return [`${count}.`, ...shown].join('\n');
}
