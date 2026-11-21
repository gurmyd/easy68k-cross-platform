import { describe, expect, it } from 'vitest';
import {
  canonicalHashes,
  canonicalListing,
  canonicalSRecord,
  compareOutputs,
  createdOn,
  describeVerdict,
  editorLoad,
  hasUndefinedSymbols,
  listingCounts,
  undefinedSymbolRanges,
} from './compare';

const bytes = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, 'latin1'));
const text = (data: Uint8Array): string => Buffer.from(data).toString('latin1');
const lines = (...list: string[]): Uint8Array => bytes(list.join('\r\n') + '\r\n');

const TRAILER = ['*~Font name~Courier New~', '*~Font size~10~', '*~Tab type~1~', '*~Tab size~4~'];

describe('editorLoad: what EDIT68K hands to its assembler (official-oracle §3.3)', () => {
  it('removes the four trailer lines and keeps the rest byte for byte', () => {
    const load = editorLoad(lines('    ORG $1000', 'START:', '    END START', '', ...TRAILER));
    expect(text(load.text)).toBe('    ORG $1000\r\nSTART:\r\n    END START\r\n\r\n');
    expect(load.tabType).toBe(1);
    expect(load.tabSize).toBe(4);
  });

  it('reads the tab type and a tab size of up to two digits from the trailer', () => {
    const load = editorLoad(
      lines('  NOP', '*~Font name~Fixedsys~', '*~Font size~9~', '*~Tab type~0~', '*~Tab size~12~'),
    );
    expect(load.tabType).toBe(0);
    expect(load.tabSize).toBe(12);
    expect(editorLoad(lines('  NOP', '*~Tab type~7~', '*~Tab size~0~'))).toMatchObject({ tabType: 1, tabSize: 0 });
  });

  it('reports no tab settings for a file without trailer', () => {
    const load = editorLoad(lines('  NOP', '  END 0'));
    expect(load.tabType).toBeUndefined();
    expect(load.tabSize).toBeUndefined();
  });

  it('turns a lone LF and a lone CR into CR LF', () => {
    expect(text(editorLoad(bytes('A\nB\rC\r\nD\n')).text)).toBe('A\r\nB\r\nC\r\nD\r\n');
  });

  it('gives the last line a line end only if the file had one', () => {
    expect(text(editorLoad(bytes('  NOP\r\n  END 0')).text)).toBe('  NOP\r\n  END 0');
    expect(text(editorLoad(bytes('')).text)).toBe('');
  });

  it('looks for trailer lines only among the last four lines', () => {
    // Five lines after the trailer line: it is out of reach of the loop of textS.cpp:140-173.
    const far = editorLoad(lines('*~Tab size~8~', 'a', 'b', 'c', 'd', 'e'));
    expect(far.tabSize).toBeUndefined();
    expect(text(far.text)).toBe('*~Tab size~8~\r\na\r\nb\r\nc\r\nd\r\ne\r\n');
    const near = editorLoad(lines('x', '*~Tab size~8~', 'a', 'b', 'c'));
    expect(near.tabSize).toBe(8);
    expect(text(near.text)).toBe('x\r\na\r\nb\r\nc\r\n');
  });

  it('keeps bytes above $7F and control characters', () => {
    const source = bytes("  DC.B '\xe9\xff',\x01\r\n");
    expect(editorLoad(source).text).toEqual(source);
  });
});

const HEADER = [
  '00001000 Starting Address',
  'Assembler used: EASy68K Editor/Assembler v5.16.01',
  'Created On: 11/20/2026 9:20:04 PM',
  '',
];
const TRAILER_OK = [
  '',
  'No errors detected',
  'No warnings generated',
  '',
  '',
  'SYMBOL TABLE INFORMATION',
  'Symbol-name         Value',
  '-------------------------',
  'START               1000',
];

describe('reading a listing', () => {
  it('parses the time of the date line as local time', () => {
    const date = createdOn(lines(...HEADER));
    expect(date).toEqual(new Date(2026, 10, 20, 21, 20, 4));
    expect(createdOn(lines('a', 'b', 'Created On: 1/2/2027 12:05:09 AM'))).toEqual(new Date(2027, 0, 2, 0, 5, 9));
    expect(createdOn(lines('a', 'b', 'Created On: 1/2/2027 12:05:09 PM'))).toEqual(new Date(2027, 0, 2, 12, 5, 9));
    expect(createdOn(lines('no', 'date', 'here'))).toBeNull();
    // A date no calendar has is refused, like a local time the time zone skips.
    expect(createdOn(lines('a', 'b', 'Created On: 2/30/2027 1:00:00 AM'))).toBeNull();
  });

  it('reads the error and warning counts of the trailer', () => {
    expect(listingCounts(lines(...HEADER, ...TRAILER_OK))).toEqual({ errors: 0, warnings: 0 });
    expect(listingCounts(lines(...HEADER, '', '1 error detected', '12 warnings generated'))).toEqual({
      errors: 1,
      warnings: 12,
    });
    expect(listingCounts(lines(...HEADER, '', '258 errors detected', '1 warning generated'))).toEqual({
      errors: 258,
      warnings: 1,
    });
    expect(listingCounts(lines(...HEADER))).toEqual({ errors: null, warnings: null });
  });
});

describe('canonicalListing', () => {
  it('masks only the date line of a listing without undefined symbols', () => {
    const listing = lines(...HEADER, '00001000  4E71                       1      NOP', ...TRAILER_OK);
    const canonical = text(canonicalListing(listing)).split('\r\n');
    expect(canonical[2]).toBe('Created On: <date>');
    expect(canonical.filter((line, index) => index !== 2)).toEqual(
      text(listing)
        .split('\r\n')
        .filter((_, index) => index !== 2),
    );
    expect(hasUndefinedSymbols(listing)).toBe(false);
  });

  it('masks the object code of the line below an "Undefined symbol" message', () => {
    const official = lines(
      ...HEADER,
      'Line 12 ERROR: Undefined symbol',
      '0000001A  41F9 004DBD16             12          lea.l   VecCurIx,a0',
      '00000020  4E71                      13          NOP',
    );
    const ours = lines(
      ...HEADER,
      'Line 12 ERROR: Undefined symbol',
      '0000001A  41F9 00000000             12          lea.l   VecCurIx,a0',
      '00000020  4E71                      13          NOP',
    );
    const canonical = text(canonicalListing(official)).split('\r\n');
    expect(canonical[5]).toBe('0000001A  #### ########             12          lea.l   VecCurIx,a0');
    expect(canonical[6]).toBe('00000020  4E71                      13          NOP');
    expect(canonicalListing(official)).toEqual(canonicalListing(ours));
    expect(hasUndefinedSymbols(official)).toBe(true);
  });

  it('does not mask the line below another kind of message', () => {
    const listing = lines(
      ...HEADER,
      'Line 3 ERROR: Invalid syntax',
      '00001000  4E71                       3      NOP X',
    );
    expect(text(canonicalListing(listing)).split('\r\n')[5]).toBe('00001000  4E71                       3      NOP X');
  });

  it('masks the whole statement when its object code continues on further lines', () => {
    // "Constants Expanded": the message stands above the LAST line of the statement.
    const official = lines(
      ...HEADER,
      '0000004E                            43  ',
      '0000004E= 0021F4F4 0021F4F4         44  .INITBL  DC.L    A,B,C,D,E',
      '          0021F4F4 0021F4F4     ',
      'Line 46 ERROR: Undefined symbol',
      '          0021F4F4              ',
      '00000062  4E71                      47          NOP',
    );
    const canonical = text(canonicalListing(official)).split('\r\n');
    expect(canonical.slice(4)).toEqual([
      '0000004E                            43  ',
      '0000004E= ######## ########         44  .INITBL  DC.L    A,B,C,D,E',
      '          ######## ########     ',
      'Line 46 ERROR: Undefined symbol',
      '          ########              ',
      '00000062  4E71                      47          NOP',
      '',
    ]);
  });

  it('masks the object code and nothing of the line number beside it', () => {
    // The line number is right-aligned in the six columns after the object-code field
    // (LISTING.CPP:159-161): with three or more digits it starts next to the field.
    const line = (code: string, lineNumber: number): string =>
      `${`000002F2  33FC 0001 ${code}`.padEnd(32)}${String(lineNumber).padStart(6)}      MOVE.W  #1,(X)`;
    const statement = (code: string, lineNumber: number, shown = lineNumber): Uint8Array =>
      lines(...HEADER, `Line ${lineNumber} ERROR: Undefined symbol`, line(code, shown));
    expect(text(canonicalListing(statement('005455B8', 295))).split('\r\n')[5]).toBe(
      '000002F2  #### #### ########       295      MOVE.W  #1,(X)',
    );
    expect(canonicalListing(statement('005455B8', 1295))).toEqual(canonicalListing(statement('00000000', 1295)));
    // The same statement listed under another line number is another listing.
    expect(canonicalListing(statement('005455B8', 1295))).not.toEqual(
      canonicalListing(statement('005455B8', 1295, 1395)),
    );
  });

  it('masks a symbol-table value whose name cannot be a label, only when symbols were undefined', () => {
    const table = [
      'SYMBOL TABLE INFORMATION',
      'Symbol-name         Value',
      '-------------------------',
      'STRNXTELSE          70C',
      ',D0                 21074E8',
      '_STD_CHVEC          8',
    ];
    const withUndefined = lines(
      ...HEADER,
      'Line 1 ERROR: Undefined symbol',
      '00000000  2229 BD16                  1   move.l -X(a1),d1',
      '',
      '1 error detected',
      ...table,
    );
    const canonical = text(canonicalListing(withUndefined)).split('\r\n');
    expect(canonical).toContain(',D0                 #');
    expect(canonical).toContain('STRNXTELSE          70C');
    expect(canonical).toContain('_STD_CHVEC          8');
    const without = lines(...HEADER, ...table);
    expect(text(canonicalListing(without))).toContain(',D0                 21074E8');
  });
});

describe('undefinedSymbolRanges: where the statements with an undefined symbol put their code', () => {
  const ranges = (...body: string[]): (readonly [number, number])[] =>
    undefinedSymbolRanges(lines(...HEADER, ...body, ...TRAILER_OK));

  it('is empty for a listing without undefined symbols', () => {
    expect(ranges('00001000  4E71                       1      NOP')).toEqual([]);
    expect(ranges('Line 1 ERROR: Invalid syntax', '00001000  4E71                       1      NOP X')).toEqual([]);
  });

  it('runs from the address of the statement to the address of the next listing line', () => {
    expect(
      ranges(
        '00000016  4E71                      11          NOP',
        'Line 12 ERROR: Undefined symbol',
        '0000001A  41F9 004DBD16             12          lea.l   VecCurIx,a0',
        'Line 13 ERROR: Undefined symbol',
        '00000020  33FC 000A 005455B8        13          move.w  #10,digitPlotX',
        '00000028  4E75                      14          rts',
      ),
    ).toEqual([
      [0x1a, 0x20],
      [0x20, 0x28],
    ]);
  });

  it('covers code the listing does not show: "..." without "Constants Expanded"', () => {
    expect(
      ranges(
        'Line 44 ERROR: Undefined symbol',
        '0000004E= 0021F4F4 0021F4F4 ...     44  .INITBL  DC.L    A,B,C,D,E',
        '00000062  4E71                      45          NOP',
      ),
    ).toEqual([[0x4e, 0x62]]);
  });

  it('starts at the source line when the code continues on further lines', () => {
    // "Constants Expanded": the message stands above the LAST line of the statement.
    expect(
      ranges(
        '0000004E= 0021F4F4 0021F4F4         44  .INITBL  DC.L    A,B,C,D,E',
        '          0021F4F4 0021F4F4     ',
        'Line 44 ERROR: Undefined symbol',
        '          0021F4F4              ',
        '00000062  4E71                      45          NOP',
      ),
    ).toEqual([[0x4e, 0x62]]);
  });

  it('takes the bytes the listing shows when no line follows or the next one is at a lower address', () => {
    // The last statement of the program: the trailer and the symbol table are not listing lines,
    // not even a symbol whose name looks like an address.
    const last = lines(
      ...HEADER,
      'Line 2 ERROR: Undefined symbol',
      '00001000  41F9 004DBD16              2      LEA X,A0',
      '',
      '1 error detected',
      'No warnings generated',
      '',
      '',
      'SYMBOL TABLE INFORMATION',
      'Symbol-name         Value',
      '-------------------------',
      'ABCDEF01            2000',
    );
    expect(undefinedSymbolRanges(last)).toEqual([[0x1000, 0x1006]]);
    // An ORG backwards after the statement.
    expect(
      ranges(
        'Line 2 ERROR: Undefined symbol',
        '00002000  3039 004DBD16              2      MOVE.W X,D0',
        '00001000                             3      ORG $1000',
      ),
    ).toEqual([[0x2000, 0x2006]]);
  });

  it('has nothing for a statement without object code', () => {
    expect(
      ranges(
        'Line 18 ERROR: Undefined symbol',
        '00000010                            18  MAPDATA  DS.B    MAPWITH*MAPHIGH',
        '00000010  4E71                      19          NOP',
      ),
    ).toEqual([]);
  });
});

describe('canonicalSRecord', () => {
  const sRecord = lines(
    'S021000036384B50524F47202020323043524541544544204259204541535936384B6D',
    'S10910004E7141F9BD166F',
    'S2081234564E714E71AA',
    'S804001000EB',
  );

  it('is the file itself when no statement has an undefined symbol', () => {
    expect(canonicalSRecord(sRecord, [])).toBe(sRecord);
  });

  it('masks the bytes at the given addresses and the checksum of their record, and nothing else', () => {
    // $1004 and $1005 of the S1 record ($1000..$1005); the S2 record is at $123456.
    expect(text(canonicalSRecord(sRecord, [[0x1004, 0x1006]])).split('\r\n')).toEqual([
      'S021000036384B50524F47202020323043524541544544204259204541535936384B6D',
      'S10910004E7141F9######',
      'S2081234564E714E71AA',
      'S804001000EB',
      '',
    ]);
    expect(text(canonicalSRecord(sRecord, [[0x123458, 0x12345a]])).split('\r\n')[2]).toBe('S2081234564E71######');
  });

  it('follows a statement across the end of a record', () => {
    const two = lines('S10710004E7141F97A', 'S1071004004DBD16CB', 'S10510084E7524');
    expect(text(canonicalSRecord(two, [[0x1002, 0x1008]])).split('\r\n')).toEqual([
      'S10710004E71######',
      'S1071004##########',
      'S10510084E7524',
      '',
    ]);
  });

  it('leaves a record alone that is not well formed', () => {
    const odd = lines('S10710004E71BD1', 'S1071000xx71BD166F');
    expect(canonicalSRecord(odd, [[0, 0x10000]])).toEqual(odd);
  });
});

describe('compareOutputs', () => {
  const listing = (code: string): Uint8Array =>
    lines(...HEADER, `00001000  ${code}                       1      NOP`, ...TRAILER_OK);
  const sRecord = lines('S10510004E71DB', 'S804001000EB');

  it('calls two outputs equal that differ only in the date line', () => {
    const other = bytes(text(listing('4E71')).replace('9:20:04 PM', '10:01:59 AM'));
    const verdict = compareOutputs({ listing: listing('4E71'), sRecord }, { listing: other, sRecord });
    expect(verdict.equal).toBe(true);
    expect(verdict.undefinedSymbols).toBe(false);
    expect(describeVerdict(verdict)).toBe('');
  });

  it('reports the differing lines of the listing and of the S-record', () => {
    const verdict = compareOutputs(
      { listing: listing('4E71'), sRecord },
      { listing: listing('4E72'), sRecord: lines('S10510004E72DA', 'S804001000EB') },
    );
    expect(verdict.equal).toBe(false);
    expect(verdict.listing.differingLines).toBe(1);
    expect(verdict.listing.differences[0]).toMatchObject({ line: 5 });
    expect(verdict.sRecord.differences[0]).toEqual({ line: 1, expected: 'S10510004E71DB', actual: 'S10510004E72DA' });
    expect(describeVerdict(verdict)).toContain('.L68: 1 differing line');
    expect(describeVerdict(verdict)).toContain('line 1 official: S10510004E71DB');
  });

  describe('with an undefined symbol', () => {
    const withUndefined = (garbage: string, nop: string): Uint8Array =>
      lines(
        ...HEADER,
        'Line 1 ERROR: Undefined symbol',
        `00001000  41F9 ${garbage}              1      LEA X,A0`,
        `00001006  ${nop}                       2      NOP`,
        '',
        '1 error detected',
        'No warnings generated',
      );
    const official = {
      listing: withUndefined('004DBD16', '4E71'),
      sRecord: lines('S10B100041F9004DBD164E7100', 'S804001000EB'),
    };

    it('calls outputs equal that differ only in the code of that statement', () => {
      const ours = {
        listing: withUndefined('00000000', '4E71'),
        sRecord: lines('S10B100041F9000000004E71D5', 'S804001000EB'),
      };
      const verdict = compareOutputs(official, ours);
      expect(verdict.equal).toBe(true);
      expect(verdict.undefinedSymbols).toBe(true);
    });

    it('still reports an S-record byte that differs outside that statement', () => {
      // The listings agree; only the S-record writer put another byte at $1007.
      const ours = {
        listing: withUndefined('00000000', '4E71'),
        sRecord: lines('S10B100041F9000000004E72D4', 'S804001000EB'),
      };
      const verdict = compareOutputs(official, ours);
      expect(verdict.listing.equal).toBe(true);
      expect(verdict.sRecord.equal).toBe(false);
      expect(describeVerdict(verdict)).toContain('line 1 official: S10B1000############4E71##');
      expect(describeVerdict(verdict)).toContain('line 1 ours:     S10B1000############4E72##');
    });
  });

  it('treats a missing file as a difference and two missing files as equal', () => {
    expect(compareOutputs({ listing: null, sRecord }, { listing: null, sRecord }).equal).toBe(true);
    const verdict = compareOutputs({ listing: listing('4E71'), sRecord }, { listing: null, sRecord });
    expect(verdict.equal).toBe(false);
    expect(verdict.listing.differences[0]).toMatchObject({ expected: '(file)', actual: '(no file)' });
  });

  it('hashes the canonical forms: the date does not change the hash, the code does', () => {
    const a = canonicalHashes({ listing: listing('4E71'), sRecord });
    const b = canonicalHashes({ listing: bytes(text(listing('4E71')).replace('11/20/2026', '1/1/2030')), sRecord });
    const c = canonicalHashes({ listing: listing('4E72'), sRecord });
    expect(a).toEqual(b);
    expect(a.l68).not.toBe(c.l68);
    expect(a.undefinedSymbols).toBe(false);
    expect(canonicalHashes({ listing: null, sRecord: null })).toEqual({
      l68: null,
      s68: null,
      undefinedSymbols: false,
    });
  });
});
