// Tests of the document file format (ARCHITECTURE.md 3.9.2, 3.9.3, 5.1, 5.2; editor-ui §6.3, §6.4,
// §20.2). The ten official examples are tracked fixtures; the whole corpus (the official
// editor's received text, by SHA-256) is checked in corpus.test.ts.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TabType, type DocDefaults, type DocumentState } from '../../contracts';
import { decode } from '../codec/cp1252';
import { DEFAULT_TEMPLATE } from '../settings/defaults';
import { OFFICIAL_EXAMPLES } from './fixtures/official-examples';
import {
  countUnmappable,
  decodeFile,
  encodeFile,
  encodeForAssembler,
  getsTrailer,
  looksLikeUtf8,
  stripTrailer,
  upperExt,
} from './format';

const DEFAULTS: DocDefaults = { fontName: 'Courier New', fontSize: 10, tabType: TabType.Fixed, tabSize: 4 };

const bytes = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));
const latin = (data: Uint8Array) => String.fromCharCode(...data);
const hex = (data: Uint8Array) => Array.from(data, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));

function doc(fields: Partial<DocumentState> = {}): DocumentState {
  return {
    id: 'd',
    path: '/browser/t.X68',
    name: 't.X68',
    kind: 'source',
    hasName: true,
    tabType: TabType.Fixed,
    tabSize: 4,
    fontName: 'Courier New',
    fontSize: 10,
    insertMode: true,
    modified: false,
    revision: 0,
    ...fields,
  };
}

/** Open (decode, strip the trailer) as the original's LoadFile does. */
function open(data: Uint8Array) {
  return stripTrailer(decodeFile(data), DEFAULTS);
}

const TRAILER_BYTES = '*~Font name~Courier New~\r\n*~Font size~10~\r\n*~Tab type~1~\r\n*~Tab size~4~\r\n';

describe('decodeFile', () => {
  it('keeps every byte and turns CR LF, lone LF and lone CR into "\\n"', () => {
    expect(decodeFile(bytes('a\r\nb\nc\rd'))).toBe('a\nb\nc\nd');
    expect(decodeFile(bytes('a\r\r\nb'))).toBe('a\n\nb');
    expect(decodeFile(bytes('a\n\rb'))).toBe('a\n\nb');
    expect(decodeFile(bytes('x\r\n'))).toBe('x\n');
    expect(decodeFile(bytes(''))).toBe('');
  });

  it('keeps tabs, Ctrl-Z, NUL and form feeds (5.1: the editor shows the character and what follows)', () => {
    expect(decodeFile(bytes('\tA\x1AB\x00C\x0C'))).toBe('\tA\x1AB\x00C\x0C');
  });

  it('maps bytes $80-$FF to their Windows-1252 characters', () => {
    expect(decodeFile(Uint8Array.of(0x80, 0x81, 0x9f, 0xa0, 0xe9, 0xff))).toBe('€\u0081Ÿ éÿ');
  });
});

describe('stripTrailer (3.9.2, editor-ui §6.3 step 4)', () => {
  it('reads the four trailer lines and removes them with their line breaks', () => {
    const loaded = stripTrailer(
      'X\n\n*~Font name~Lucida Console~\n*~Font size~12~\n*~Tab type~0~\n*~Tab size~8~\n',
      DEFAULTS,
    );
    expect(loaded).toEqual({
      text: 'X\n\n',
      fontName: 'Lucida Console',
      fontSize: 12,
      tabType: TabType.Assembly,
      tabSize: 8,
      loadError: false,
    });
  });

  it('a file whose only trailer line is *~Tab type~0~ opens with Assembly tabs, the rest from the options (§20.2)', () => {
    const loaded = stripTrailer('    ORG $1000\n    END $1000\n*~Tab type~0~\n', DEFAULTS);
    expect(loaded.text).toBe('    ORG $1000\n    END $1000\n');
    expect(loaded.tabType).toBe(TabType.Assembly);
    expect([loaded.fontName, loaded.fontSize, loaded.tabSize]).toEqual(['Courier New', 10, 4]);
    // ... and as the last line without a line break of its own
    expect(stripTrailer('A\n*~Tab type~0~', DEFAULTS)).toMatchObject({ text: 'A\n', tabType: TabType.Assembly });
  });

  it('Tab type: character 12 "0" is Assembly, anything else Fixed', () => {
    const assembly = { ...DEFAULTS, tabType: TabType.Assembly };
    expect(stripTrailer('*~Tab type~1~\n', assembly).tabType).toBe(TabType.Fixed);
    expect(stripTrailer('*~Tab type~x~\n', assembly).tabType).toBe(TabType.Fixed);
    expect(stripTrailer('*~Tab type~\n', assembly)).toMatchObject({ tabType: TabType.Fixed, text: '' });
    expect(stripTrailer('*~Tab type~01~\n', DEFAULTS).tabType).toBe(TabType.Assembly);
  });

  it('two-digit limits: tab size from positions 12-13, font size from 13-14 (atoi)', () => {
    expect(stripTrailer('*~Tab size~123~\n', DEFAULTS).tabSize).toBe(12);
    expect(stripTrailer('*~Tab size~7~\n', DEFAULTS).tabSize).toBe(7);
    expect(stripTrailer('*~Tab size~~\n', DEFAULTS).tabSize).toBe(0);
    expect(stripTrailer('*~Tab size~4x~\n', DEFAULTS).tabSize).toBe(4);
    expect(stripTrailer('*~Tab size~-5~\n', DEFAULTS).tabSize).toBe(-5);
    expect(stripTrailer('*~Font size~100~\n', DEFAULTS).fontSize).toBe(10);
    expect(stripTrailer('*~Font size~9~\n', DEFAULTS).fontSize).toBe(9);
    expect(stripTrailer('*~Font size~ab~\n', DEFAULTS).fontSize).toBe(0);
  });

  it('keeps an unknown font name exactly, of any length', () => {
    expect(stripTrailer('*~Font name~Comic Sans MS~\n', DEFAULTS).fontName).toBe('Comic Sans MS');
    const long = 'F'.repeat(120);
    expect(stripTrailer(`*~Font name~${long}~\n`, DEFAULTS).fontName).toBe(long);
    expect(stripTrailer('*~Font name~~\n', DEFAULTS).fontName).toBe('');
  });

  it('a font name without its closing "~" loses its last character (the loop runs while i < Length)', () => {
    expect(stripTrailer('*~Font name~Arial\n', DEFAULTS).fontName).toBe('Aria');
    expect(stripTrailer('*~Font name~A\n', DEFAULTS).fontName).toBe('');
  });

  it('examines only the last four lines, each independently, in any order', () => {
    const text = '*~Tab size~9~\nA\n*~Tab size~6~\n*~Font size~11~\nB\n';
    const loaded = stripTrailer(text, DEFAULTS);
    expect(loaded.text).toBe('*~Tab size~9~\nA\nB\n');
    expect([loaded.tabSize, loaded.fontSize]).toEqual([6, 11]);
    // five trailer lines: the fifth from the end stays
    const five = 'X\n*~Tab size~2~\n*~Font name~A~\n*~Font size~8~\n*~Tab type~0~\n*~Tab size~3~\n';
    expect(stripTrailer(five, DEFAULTS)).toMatchObject({ text: 'X\n*~Tab size~2~\n', tabSize: 3 });
    // two lines of one kind: the higher line is examined last and wins
    expect(stripTrailer('*~Tab size~5~\n*~Tab size~6~\n', DEFAULTS)).toMatchObject({ text: '', tabSize: 5 });
  });

  it('a final line break is not a line; an empty last line is', () => {
    // "A\n\n" has the lines "A" and "": the empty line counts as one of the four
    const text = '*~Tab size~8~\nA\n\n\n\n';
    expect(stripTrailer(text, DEFAULTS)).toMatchObject({ text, tabSize: 4 });
  });

  it('prefixes are case-sensitive and must start the line', () => {
    const text = '*~tab size~8~\n *~Tab size~8~\n;*~Tab size~8~\n';
    expect(stripTrailer(text, DEFAULTS)).toMatchObject({ text, tabSize: 4, loadError: false });
  });

  it('quirk: a trailer line too short for its loop stops the examination (ERangeError -> Error in LoadFile())', () => {
    // From the end: Tab size is taken and removed, then "*~Font size~1" makes str[14] throw.
    const loaded = stripTrailer('*~Tab type~0~\n*~Font size~1\n*~Tab size~9~\n', DEFAULTS);
    expect(loaded).toMatchObject({ text: '*~Tab type~0~\n*~Font size~1\n', tabSize: 9, loadError: true });
    expect(loaded.tabType).toBe(TabType.Fixed);
    expect(stripTrailer('*~Tab size~4\n', DEFAULTS)).toMatchObject({ text: '*~Tab size~4\n', loadError: true });
    expect(stripTrailer('*~Font name~\n', DEFAULTS).loadError).toBe(true);
    expect(stripTrailer('*~Tab size~\n', DEFAULTS).loadError).toBe(true);
  });
});

describe('encodeFile (3.9.3, 5.2)', () => {
  const template = DEFAULT_TEMPLATE;

  it('the byte example of 5.2: a new document saved as t.X68 is the 420-byte template, CR LF, the trailer', () => {
    const file = encodeFile(doc(), template);
    const templateBytes = file.subarray(0, 420);
    expect(latin(templateBytes)).toBe(template.replace(/\n/g, '\r\n'));
    expect(hex(file.subarray(420, 422))).toBe('0D 0A');
    expect(latin(file.subarray(422))).toBe(TRAILER_BYTES);
    expect(file.length).toBe(420 + 2 + TRAILER_BYTES.length);
  });

  it('the trailer for .X68 in any letter case, nothing for another extension or a list document', () => {
    expect(latin(encodeFile(doc({ path: '/browser/t.x68', name: 't.x68' }), 'A\n'))).toBe(`A\r\n\r\n${TRAILER_BYTES}`);
    expect(latin(encodeFile(doc({ path: '/browser/t.ASM', name: 't.ASM' }), template))).toBe(
      template.replace(/\n/g, '\r\n'),
    );
    expect(latin(encodeFile(doc({ path: '/browser/t.X68.bak', name: 't.X68.bak' }), 'A'))).toBe('A');
    expect(latin(encodeFile(doc({ kind: 'list', path: '/browser/t.X68' }), 'A\n'))).toBe('A\r\n');
    expect(latin(encodeFile(doc({ path: '/browser/folder.X68/t', name: 't' }), 'A\n'))).toBe('A\r\n');
  });

  it('writes the document settings as stored, including a list turned source (tab type 0, size 0)', () => {
    const file = encodeFile(doc({ fontName: 'Fixedsys', fontSize: 14, tabType: TabType.Assembly, tabSize: 0 }), 'A');
    expect(latin(file)).toBe('A\r\n*~Font name~Fixedsys~\r\n*~Font size~14~\r\n*~Tab type~0~\r\n*~Tab size~0~\r\n');
  });

  it('a line break after the last line only when the text ends with one', () => {
    expect(latin(encodeFile(doc({ path: '/browser/a.txt', name: 'a.txt' }), 'A\nB'))).toBe('A\r\nB');
    expect(latin(encodeFile(doc({ path: '/browser/a.txt', name: 'a.txt' }), 'A\nB\n'))).toBe('A\r\nB\r\n');
  });

  it('writes "?" for characters without a Windows-1252 byte, and counts them', () => {
    const text = 'A中\u{1F600}€';
    expect(countUnmappable(text)).toBe(2);
    expect(Array.from(encodeFile(doc({ path: '/browser/a.txt', name: 'a.txt' }), text))).toEqual([
      0x41, 0x3f, 0x3f, 0x80,
    ]);
  });

  it('getsTrailer and upperExt follow ExtractFileExt + UpperCase', () => {
    expect(upperExt('/browser/a.b/c.x68')).toBe('.X68');
    expect(upperExt('/browser/a.b/c')).toBe('');
    expect(getsTrailer({ kind: 'source', path: null, name: 'untitled1.x68' })).toBe(true);
  });
});

describe('open and save cycles', () => {
  it('each open-and-save cycle adds one empty line before the trailer, as the original does (editor-ui §6.4)', () => {
    let file = encodeFile(doc(), 'START\n');
    const sizes: number[] = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      const loaded = open(file);
      file = encodeFile(doc({ fontName: loaded.fontName, tabType: loaded.tabType }), loaded.text);
      sizes.push(file.length);
    }
    expect(latin(file)).toBe(`START\r\n\r\n\r\n\r\n\r\n${TRAILER_BYTES}`);
    expect(sizes[1]! - sizes[0]!).toBe(2);
    expect(sizes[2]! - sizes[1]!).toBe(2);
  });

  it('bytes $80-$FF survive an open-and-save round trip', () => {
    const high = Array.from({ length: 128 }, (_, i) => 0x80 + i);
    const line = [...bytes("    DC.B    '"), ...high.filter((b) => b !== 0x27), ...bytes("'\r\n")];
    const source = Uint8Array.from([...bytes('    ORG $1000\r\n'), ...line, ...bytes('    END $1000\r\n')]);
    const loaded = open(source);
    expect(countUnmappable(loaded.text)).toBe(0);
    const saved = encodeFile(doc({ path: '/browser/h.txt', name: 'h.txt' }), loaded.text);
    expect(Array.from(saved)).toEqual(Array.from(source));
    expect(Array.from(encodeForAssembler(loaded.text))).toEqual(Array.from(source));
  });

  it('every one of the 256 byte values survives, apart from the line ends that become CR LF', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i).filter((b) => b !== 0x0a && b !== 0x0d);
    expect(Array.from(encodeFile(doc({ path: '/browser/b.bin', name: 'b.bin' }), decodeFile(all)))).toEqual(
      Array.from(all),
    );
  });
});

describe('encodeForAssembler (4.9 step 4)', () => {
  it('writes the text with CR LF and appends nothing (official EDIT68K: no final CR LF when the text has none)', () => {
    expect(latin(encodeForAssembler('A\nB\n'))).toBe('A\r\nB\r\n');
    expect(latin(encodeForAssembler('A\nB'))).toBe('A\r\nB');
    expect(latin(encodeForAssembler(''))).toBe('');
    expect(latin(encodeForAssembler('\x1A\t'))).toBe('\x1A\t');
  });
});

describe('the ten official examples (editor-ui §20.2)', () => {
  it('has all ten fixtures', () => {
    expect(OFFICIAL_EXAMPLES.map((example) => example.name)).toHaveLength(10);
  });

  for (const example of OFFICIAL_EXAMPLES) {
    it(`${example.name}: no *~ line left; Courier New, 10, tab size 4, Fixed; the assembler gets the official bytes`, () => {
      const file = fromBase64(example.base64);
      const loaded = open(file);
      expect(loaded.text.split('\n').some((line) => line.startsWith('*~'))).toBe(false);
      expect(loaded).toMatchObject({ fontName: 'Courier New', fontSize: 10, tabSize: 4, tabType: TabType.Fixed });
      expect(loaded.loadError).toBe(false);
      expect(sha256(encodeForAssembler(loaded.text))).toBe(example.receivedSha256);
      // Saving again writes the same text with one more empty line before the same trailer.
      const saved = encodeFile(doc({ path: `/browser/${example.name}`, name: example.name }), loaded.text);
      const trailerAt = latin(file).lastIndexOf('*~Font name~');
      expect(latin(saved)).toBe(`${latin(file).slice(0, trailerAt)}\r\n${latin(file).slice(trailerAt)}`);
      expect(decode(saved).endsWith(TRAILER_BYTES)).toBe(true);
    });
  }
});

describe('looksLikeUtf8 (5.1 banner)', () => {
  it('is true for valid UTF-8 with a multi-byte sequence only', () => {
    expect(looksLikeUtf8(new TextEncoder().encode('* café\r\n'))).toBe(true);
    expect(looksLikeUtf8(Uint8Array.of(0xef, 0xbb, 0xbf, 0x41))).toBe(true);
    expect(looksLikeUtf8(bytes('plain ASCII\r\n'))).toBe(false);
    expect(looksLikeUtf8(Uint8Array.of(0x41, 0xe9, 0x42))).toBe(false); // Windows-1252 é
    expect(looksLikeUtf8(Uint8Array.of(0xc3))).toBe(false); // cut short
    expect(looksLikeUtf8(Uint8Array.of(0xc0, 0x80))).toBe(false); // overlong
    expect(looksLikeUtf8(Uint8Array.of(0xed, 0xa0, 0x80))).toBe(false); // surrogate
  });
});
