// ListingView (ARCHITECTURE.md 3.11.4; sim-ui §6.1, §6.2, §6.7): the decoded rows, the
// instruction-row test, the address of a row and the Find search; with a scripted engine and with
// the real assembler and simulator.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SimEngine } from '../../contracts';
import { assembleProgram, createTestEngine } from '../../engine/testing';
import { encode } from '../codec/cp1252';
import { ListingView, addressOfText, isInstructionText, upperAscii } from './view';

const repo = (file: string) => fileURLToPath(new URL(`../../../../${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(repo(`engine/dist/${file}`)),
);
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

/** An engine that only has a listing (what ListingView reads). */
function listingEngine(lines: readonly (string | Uint8Array)[]): () => SimEngine {
  const bytes = lines.map((line) => (typeof line === 'string' ? encode(line).bytes : line));
  const engine = {
    get listingLineCount() {
      return bytes.length;
    },
    listingLine: (index: number) => bytes[index] ?? new Uint8Array(0),
  } as unknown as SimEngine;
  return () => engine;
}

/** A listing in the layout of LISTING.CPP: address, object code from column 11, line number, source. */
const LISTING = [
  '00001000 Starting Address',
  'Assembler used: EASy68K Editor/Assembler v5.16.01',
  'Created On: 1/1/2026 12:00:00 PM',
  '',
  '00001000                             1      ORG $1000',
  '00001000                             2  START:',
  '00001000  7205                       3      MOVE.L #5,D1',
  '00001002  D280                       4      add.l d0,d1',
  '00001004  =00000010                  5  TEN EQU 16',
  '00001004= 0001 0002                  6      DC.W 1,2',
  '00001008  60FE                       7  LOOP BRA LOOP',
  '0000100A  FFFF FFFF                  8      SIMHALT',
  '0000100E                             9      END START',
  '',
  'No errors detected',
];

describe('isInstruction (sim-ui §6.2)', () => {
  const vectors: [string, boolean, string][] = [
    ['00001000  7205                       3      MOVE.L #5,D1', true, 'instruction with object code'],
    ['00FFFFFE  4E71                       3      NOP', true, 'highest address that starts with 00'],
    ['01000000  4E71                       3      NOP', false, 'address $01000000 does not start with 00'],
    ['00001000                             2  START:', false, 'label only: position 11 is blank'],
    ['00001000                             1      ORG $1000', false, 'directive without code'],
    ['00001004  =00000010                  5  TEN EQU 16', false, 'EQU: = at position 11'],
    ['00001004= 0001 0002                  6      DC.W 1,2', false, 'DC: = at position 9'],
    ['00001004= 00000004                   6      DS.B 4', false, 'DS: = at position 9'],
    ['00001000 Starting Address', true, 'the first header row passes (callers skip rows 0-2)'],
    ['Assembler used: EASy68K Editor/Assembler v5.16.01', false, 'header line 2'],
    ['', false, 'empty row'],
    ['No errors detected', false, 'trailer'],
    ['LOOP                1008', false, 'symbol table row'],
    ['0000100', false, 'shorter than position 11'],
    ['0000100A  ', false, 'exactly 10 characters'],
    ['0000100A  F', true, 'exactly 11 characters, code at position 11'],
    ['  001000  4E71', false, 'address must start at column 1'],
    ['00001000\t4E71 4E71', true, 'a tab at position 9 is not ='],
  ];
  for (const [text, expected, what] of vectors) {
    it(`${expected ? 'yes' : 'no '}: ${what}`, () => {
      expect(isInstructionText(text)).toBe(expected);
    });
  }

  it('ListingView.isInstruction uses the row text; a row that does not exist is not one', () => {
    const view = new ListingView(listingEngine(LISTING));
    view.refresh();
    const rows = LISTING.map((_line, row) => view.isInstruction(row));
    expect(rows).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      false,
      false,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(view.isInstruction(-1)).toBe(false);
    expect(view.isInstruction(LISTING.length)).toBe(false);
  });
});

describe('addressOf', () => {
  it('reads the first 8 characters as hex', () => {
    const view = new ListingView(listingEngine(LISTING));
    view.refresh();
    expect(view.addressOf(0)).toBe(0x1000); // the start address of the header
    expect(view.addressOf(6)).toBe(0x1000);
    expect(view.addressOf(10)).toBe(0x1008);
    expect(view.addressOf(1)).toBeNull();
    expect(view.addressOf(3)).toBeNull();
    expect(view.addressOf(99)).toBeNull();
  });

  it('lower-case digits, the highest value, and texts that are not 8 hex digits', () => {
    expect(addressOfText('0000abcd  4E71')).toBe(0xabcd);
    expect(addressOfText('FFFFFFFF')).toBe(0xffffffff);
    expect(addressOfText('0000100')).toBeNull();
    expect(addressOfText('0000100G  4E71')).toBeNull();
    expect(addressOfText(' 0001000  4E71')).toBeNull();
  });
});

describe('find (sim-ui §6.7)', () => {
  const view = new ListingView(listingEngine(LISTING));
  view.refresh();

  it('is a case-insensitive substring search over the whole raw row', () => {
    expect(view.find('move.l', 3)).toBe(6);
    expect(view.find('ADD.L D0', 3)).toBe(7); // the row is in lower case
    expect(view.find('D280', 3)).toBe(7); // object code column
    expect(view.find('00001008', 3)).toBe(10); // address column
    expect(view.find('    8  ', 3)).toBe(11); // line number column with its blanks
  });

  it('starts at fromRow, never before row 3, and does not wrap', () => {
    expect(view.find('00001000', 0)).toBe(4); // row 0 also contains it, but the header is skipped
    expect(view.find('START', 6)).toBe(12);
    expect(view.find('START', 13)).toBe(-1);
    expect(view.find('MOVE', 7)).toBe(-1);
    expect(view.find('not there', 3)).toBe(-1);
    expect(view.find('MOVE', 99)).toBe(-1);
  });

  it('upper-cases ASCII letters only, as the original toupper on a char does', () => {
    const accents = new ListingView(
      listingEngine(['h1', 'h2', 'h3', '00001000  4E71   1  * café', '00001002  4E71   2  * CAFÉ']),
    );
    accents.refresh();
    expect(accents.find('CAFÉ', 3)).toBe(4);
    expect(accents.find('café', 3)).toBe(3);
    expect(upperAscii('abcéxyz')).toBe('ABCéXYZ');
  });
});

describe('refresh', () => {
  it('decodes Windows-1252, drops line ends and makes a new array each time', () => {
    const engine = listingEngine([new Uint8Array([0x41, 0x80, 0xe9, 0x0d, 0x0a]), new Uint8Array([0x09, 0x42])]);
    const view = new ListingView(engine);
    expect(view.rows).toEqual([]);
    view.refresh();
    expect(view.rows).toEqual(['A€é', '\tB']);
    const first = view.rows;
    view.refresh();
    expect(view.rows).not.toBe(first);
    expect(view.rows).toEqual(first);
  });

  it('reads the engine that is current at the time of the call', () => {
    let current = listingEngine(['one'])();
    const view = new ListingView(() => current);
    view.refresh();
    expect(view.rows).toEqual(['one']);
    current = listingEngine(['two', 'three'])();
    view.refresh();
    expect(view.rows).toEqual(['two', 'three']);
  });
});

describe('with the real engine (needs engine/dist)', () => {
  it.runIf(enginesRequired && !enginesBuilt)('engine/dist holds both engines (EASY68K_REQUIRE_ENGINES=1)', () => {
    expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist does not hold both engines');
  });

  it.skipIf(!enginesBuilt)(
    'the rows equal the .L68 lines; instruction rows are the rows with code',
    async () => {
      const program = await assembleProgram([
        '    ORG $1000',
        'START:',
        '    MOVE.L #5,D1',
        'TEN EQU 10',
        '    BRA.S *',
        'DATA DC.W 1,2',
        '    SIMHALT',
        '    END START',
      ]);
      const test = await createTestEngine();
      try {
        const view = new ListingView(() => test.engine);
        view.refresh();
        expect(view.rows).toEqual([]); // nothing loaded: the pane is empty (sim-ui §6.1)
        test.engine.load(program.s68, program.l68, { name: 'program.S68', kind: 'open' });
        view.refresh();
        const lines = new TextDecoder('windows-1252').decode(program.l68).split('\r\n');
        expect(view.rows).toEqual(lines.slice(0, view.rows.length));
        expect(view.rows.length).toBeGreaterThan(10);
        const code = view.rows.map((_row, index) => index > 2 && view.isInstruction(index));
        const withCode = view.rows.filter((_row, index) => code[index]).map((row) => row.slice(40).trim());
        expect(withCode).toEqual(['MOVE.L #5,D1', 'BRA.S *', 'SIMHALT']);
        const move = view.find('move.l', 0);
        expect(view.addressOf(move)).toBe(0x1000);
        expect(test.engine.listingHighlight).toBe(move); // the engine's highlight is that row

        // Without a listing the engine shows its nine-line notice (sim-ui §6.1).
        test.engine.load(program.s68, null, { name: 'program.S68', kind: 'open' });
        view.refresh();
        expect(view.rows[0]).toBe('A matching .L68 file was not found. The .L68 file');
        expect(view.rows).toHaveLength(9);
        expect(view.rows.some((_row, index) => view.isInstruction(index))).toBe(false);
      } finally {
        test.release();
      }
    },
    60_000,
  );
});
