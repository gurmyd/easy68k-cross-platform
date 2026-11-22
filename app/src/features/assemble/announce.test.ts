// The polite announcement of the Messages panel of Editor mode (2.11; Q1-3).

import { describe, expect, it } from 'vitest';
import type { EditorMessage } from '../../contracts';
import { messagesAnnouncement, messageText } from './announce';

const OWN = '/browser/demo/prog.X68';
const row = (line: number, text: string, file: string | null = OWN): EditorMessage => ({
  file,
  line,
  text,
  severity: text.startsWith('WARNING') ? 'warning' : 'error',
});

describe('messagesAnnouncement', () => {
  const list = [row(3, 'ERROR: Invalid syntax'), row(7, 'WARNING: Origin is odd')];

  it('a new assembly of the same document announces the count and the first messages', () => {
    expect(messagesAnnouncement([], list, true, OWN)).toBe(
      '2 assembler messages.\nLine 3: ERROR: Invalid syntax\nLine 7: WARNING: Origin is odd',
    );
    expect(messagesAnnouncement([], [row(1, 'ERROR: x')], true, OWN)).toBe('1 assembler message.\nLine 1: ERROR: x');
  });

  it('reads at most three messages', () => {
    const many = [1, 2, 3, 4, 5].map((n) => row(n, `ERROR: e${n}`));
    expect(messagesAnnouncement([], many, true, OWN)?.split('\n')).toEqual([
      '5 assembler messages.',
      'Line 1: ERROR: e1',
      'Line 2: ERROR: e2',
      'Line 3: ERROR: e3',
    ]);
  });

  it('the same messages again (a second F9 gives a new list) are announced again', () => {
    const again = [...list];
    expect(messagesAnnouncement(list, again, true, OWN)).not.toBeNull();
  });

  it('says nothing for the same list, another document, or an empty list', () => {
    expect(messagesAnnouncement(list, list, true, OWN)).toBeNull();
    expect(messagesAnnouncement([], list, false, OWN)).toBeNull();
    expect(messagesAnnouncement(list, [], true, OWN)).toBeNull();
  });

  it('names another file than the document, without regard to letter case', () => {
    expect(messageText(row(2, 'ERROR: Cannot open', '/browser/demo/inc/Macros.X68'), OWN)).toBe(
      'Line 2 in Macros.X68: ERROR: Cannot open',
    );
    expect(messageText(row(2, 'ERROR: x', '/browser/DEMO/prog.x68'), OWN)).toBe('Line 2: ERROR: x');
    expect(messageText(row(2, 'ERROR: x', null), OWN)).toBe('Line 2: ERROR: x');
  });
});
