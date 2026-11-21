// The 36 syntax-highlighting vectors of editor-ui §20.1 (ARCHITECTURE.md 6.4). Owner: E3.
//
// Each vector lists the parts of the line that are not Code, left to right, by their text; every
// other character must be Code. Leading blanks are significant.

import { describe, expect, it } from 'vitest';
import type { SyntaxElement } from '../../contracts';
import { highlightLine, type HighlightSpan } from './highlight';

type Part = readonly [text: string, style: SyntaxElement];

/** The spans a line should get: the listed parts in their styles, the rest Code. */
function expectedSpans(line: string, parts: readonly Part[]): HighlightSpan[] {
  const styles: SyntaxElement[] = new Array<SyntaxElement>(line.length).fill('code');
  let cursor = 0;
  for (const [text, style] of parts) {
    const at = line.indexOf(text, cursor);
    if (at < 0) throw new Error(`"${text}" not found in "${line}" after column ${cursor}`);
    styles.fill(style, at, at + text.length);
    cursor = at + text.length;
  }
  const spans: HighlightSpan[] = [];
  let from = 0;
  for (let i = 1; i <= styles.length; i++) {
    if (i === styles.length || styles[i] !== styles[from]) {
      spans.push({ from, to: i, style: styles[from]! });
      from = i;
    }
  }
  return spans;
}

interface Vector {
  n: number;
  line: string;
  parts: readonly Part[];
  bitField?: boolean;
}

const VECTORS: readonly Vector[] = [
  { n: 1, line: '* comment', parts: [['* comment', 'comment']] },
  { n: 2, line: '    ; comment', parts: [['    ; comment', 'comment']] },
  {
    n: 3,
    line: 'START:  ORG    $1000   set origin',
    parts: [
      ['START:', 'label'],
      ['ORG', 'directive'],
      ['set origin', 'comment'],
    ],
  },
  {
    n: 4,
    line: "    MOVE.B  #'A',D0     load char",
    parts: [
      ["'A'", 'text'],
      ['load char', 'comment'],
    ],
  },
  { n: 5, line: 'LOOP    DBRA    D0,LOOP', parts: [['LOOP', 'label']] },
  { n: 6, line: '    PRINT   msg     macro call', parts: [['PRINT   msg     macro call', 'unknown']] },
  {
    n: 7,
    line: '    IF.B D0 <EQ> #1 THEN.S    do it',
    parts: [
      ['IF.B D0 <EQ> #1 THEN.S', 'structure'],
      ['do it', 'comment'],
    ],
  },
  { n: 8, line: '    IF D0 <EQ> #1 THE', parts: [['IF D0 <EQ> #1 THE', 'error']] },
  { n: 9, line: '    ELSE', parts: [['ELSE', 'structure']] },
  {
    n: 10,
    line: '    ENDI    end if',
    parts: [
      ['ENDI', 'structure'],
      ['end if', 'comment'],
    ],
  },
  { n: 11, line: '    WHILE <T> DO', parts: [['WHILE <T> DO', 'structure']] },
  { n: 12, line: '    FOR D1 = #1 TO #10 BY #2 DO', parts: [['FOR D1 = #1 TO #10 BY #2 DO', 'structure']] },
  { n: 13, line: '    FOR D1=#1 TO #10 DO', parts: [['FOR D1=#1 TO #10 DO', 'error']] },
  { n: 14, line: '    DBLOOP D0 = #10', parts: [['DBLOOP D0 = #10', 'structure']] },
  { n: 15, line: '    UNLESS D0 <NE> #0', parts: [['UNLESS D0 <NE> #0', 'structure']] },
  { n: 16, line: '    UNTIL D0 <EQ> #0 DO', parts: [['UNTIL D0 <EQ> #0 DO', 'structure']] },
  { n: 17, line: '    REPEAT', parts: [['REPEAT', 'structure']] },
  {
    n: 18,
    line: "MSG     DC.B    'Hello',0     text",
    parts: [
      ['MSG', 'label'],
      ['DC.B', 'directive'],
      ["'Hello'", 'text'],
      ['text', 'comment'],
    ],
  },
  {
    n: 19,
    line: "    DC.B    'It''s',0",
    parts: [
      ['DC.B', 'directive'],
      ["'It''s'", 'text'],
    ],
  },
  {
    n: 20,
    line: "    DC.B 'unterminated",
    parts: [
      ['DC.B', 'directive'],
      ["'unterminated", 'error'],
    ],
  },
  { n: 21, line: '    MOVE.L  (A0,D1', parts: [['MOVE.L  (A0,D1', 'error']] },
  {
    n: 22,
    line: '    SIMHALT             ; halt simulator',
    parts: [
      ['SIMHALT', 'directive'],
      ['; halt simulator', 'comment'],
    ],
  },
  {
    n: 23,
    line: '    END    START        ; last line of source',
    parts: [
      ['END', 'directive'],
      ['; last line of source', 'comment'],
    ],
  },
  {
    n: 24,
    line: 'START:                  ; first instruction of program',
    parts: [
      ['START:', 'label'],
      ['; first instruction of program', 'comment'],
    ],
  },
  { n: 25, line: '    NOP     no operation', parts: [['no operation', 'comment']] },
  { n: 26, line: '    MOVE    D0, D1     comment', parts: [['comment', 'comment']] },
  { n: 27, line: '    FAIL    this is an error', parts: [['FAIL', 'directive']] },
  { n: 28, line: '    BFINS   D0,(A0){4:8}', parts: [] },
  { n: 28, line: '    BFINS   D0,(A0){4:8}', parts: [['BFINS   D0,(A0){4:8}', 'unknown']], bitField: false },
  { n: 29, line: '  loop:  ADD D1,D2', parts: [['  loop:', 'label']] },
  {
    n: 30,
    line: 'MOVE D0,D1',
    parts: [
      ['MOVE', 'label'],
      ['D0,D1', 'unknown'],
    ],
  },
  {
    n: 31,
    line: "    INCLUDE 'file.x68'    comment",
    parts: [
      ['INCLUDE', 'directive'],
      ["'file.x68'", 'text'],
      ['comment', 'comment'],
    ],
  },
  {
    n: 32,
    line: 'NAME    EQU     5',
    parts: [
      ['NAME', 'label'],
      ['EQU', 'directive'],
    ],
  },
  { n: 33, line: '    move.b  d0,d1', parts: [] },
  {
    n: 34,
    line: '    MEMORY  ROM $001000,$002000   my rom',
    parts: [
      ['MEMORY', 'directive'],
      ['my rom', 'comment'],
    ],
  },
  // The quirk of 9.7: ".loop" is taken for a size suffix, "go" for the operand.
  { n: 35, line: '    BRA     .loop       go back', parts: [['back', 'comment']] },
  { n: 36, line: '', parts: [] },
  { n: 36, line: '        ', parts: [] },
  { n: 36, line: ' \t \t', parts: [] },
];

describe('editor-ui §20.1 highlighting vectors', () => {
  it('covers all 36 vectors', () => {
    expect(new Set(VECTORS.map((v) => v.n)).size).toBe(36);
  });

  for (const vector of VECTORS) {
    const bitField = vector.bitField ?? true;
    it(`vector ${vector.n}${bitField ? '' : ' (bit-field option off)'}: ${JSON.stringify(vector.line)}`, () => {
      expect(highlightLine(vector.line, { bitField })).toEqual(expectedSpans(vector.line, vector.parts));
    });
  }

  it('vector 36: an empty line has no runs, a blank line is one Code run', () => {
    expect(highlightLine('', { bitField: true })).toEqual([]);
    expect(highlightLine('    ', { bitField: true })).toEqual([{ from: 0, to: 4, style: 'code' }]);
  });
});
