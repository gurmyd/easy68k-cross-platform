// settings.dat (editor-ui §11.4, ARCHITECTURE.md 3.10): the shipped file, the positional rule, the
// C details of the original's reader, and the writer against a checked fixture.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TabType, type EditorSettings } from '../../../contracts';
import { decode, encode } from '../../codec/cp1252';
import { COLOR1_STYLES } from '../../highlight';
import { DEFAULT_EDITOR_SETTINGS } from '../defaults';
import {
  SETTINGS_DAT_DEFAULTS,
  SETTINGS_DAT_HEADER,
  editorSettingsFromDat,
  parseSettingsDat,
  writeSettingsDat,
  type DatEditorSettings,
} from './settings-dat';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`fixtures/${name}`, import.meta.url))));
const SHIPPED = fixture('shipped-settings.dat');

/** The lines of a file (CR LF), without the final empty piece. */
const linesOf = (bytes: Uint8Array) => decode(bytes).split('\r\n').slice(0, -1);
const fileOf = (lines: string[], eol = '\r\n') => encode(lines.map((line) => line + eol).join('')).bytes;

/** editor-ui §11.4, column "Shipped file (official-extracted\settings.dat)". */
const SHIPPED_COLUMN: DatEditorSettings = {
  generateList: true, // line 2
  generateSRecord: true, // 3
  saveThenAssemble: false, // 4
  showWarnings: true, // 5
  crossReference: true, // 6
  macrosExpanded: false, // 7
  structuredExpanded: false, // 8
  constantsExpanded: false, // 9
  fontName: 'Courier New', // 10
  fontSize: 10, // 11
  tabType: TabType.Fixed, // 12
  fixedTabSize: 4, // 13
  autoIndent: true, // 15
  realTabs: false, // 16
  assembleBitField: true, // 17
  styles: {
    code: { color: 0, bold: false, italic: false, underline: false }, // 22-25
    unknown: { color: 32896, bold: false, italic: false, underline: false }, // 26-29
    directive: { color: 32768, bold: false, italic: false, underline: false }, // 30-33
    comment: { color: 16711680, bold: false, italic: false, underline: false }, // 34-37
    label: { color: 8388736, bold: false, italic: false, underline: false }, // 38-41
    structure: { color: 128, bold: false, italic: false, underline: false }, // 42-45
    error: { color: 255, bold: false, italic: false, underline: false }, // 46-49
    text: { color: 8421376, bold: false, italic: false, underline: false }, // 50-53
  },
  highlightDisabled: false, // 54
  printBlack: true, // 55
  backgroundColor: 16777215, // 56
  colorPreset: -1, // 57
};

/** Every setting of the file away from its default (written-settings.dat is its file). */
export const CHANGED_EDITOR: EditorSettings = {
  ...structuredClone(DEFAULT_EDITOR_SETTINGS),
  generateList: false,
  generateSRecord: false,
  saveThenAssemble: true,
  showWarnings: false,
  crossReference: false,
  macrosExpanded: true,
  structuredExpanded: true,
  constantsExpanded: true,
  fontName: 'Fixedsys',
  fontSize: 18,
  tabType: TabType.Assembly,
  fixedTabSize: 8,
  autoIndent: false,
  realTabs: true,
  assembleBitField: false,
  styles: {
    code: { color: 255, bold: true, italic: false, underline: false },
    unknown: { color: 8388608, bold: false, italic: true, underline: false },
    directive: { color: 65280, bold: false, italic: false, underline: true },
    comment: { color: 32768, bold: true, italic: true, underline: true },
    label: { color: 128, bold: false, italic: false, underline: false },
    structure: { color: 16711935, bold: true, italic: false, underline: true },
    error: { color: 65535, bold: false, italic: true, underline: true },
    text: { color: 10526884, bold: true, italic: true, underline: false },
  },
  highlightDisabled: true,
  printBlack: false,
  backgroundColor: 8421504,
  colorPreset: 3,
};

/** The settings of a full EditorSettings that the file holds. */
function datPart(settings: EditorSettings): DatEditorSettings {
  const { template: _t, lineNumbers: _l, ...rest } = settings;
  return rest;
}

describe('parseSettingsDat: the shipped file', () => {
  it('parses to the "Shipped file" column of editor-ui §11.4', () => {
    expect(parseSettingsDat(SHIPPED)).toEqual(SHIPPED_COLUMN);
  });

  it('ignores the header and its version (v5.15.04 in the shipped file)', () => {
    expect(decode(SHIPPED).startsWith('$Settings for EASy68K Editor/Assembler v5.15.04  DO NOT EDIT')).toBe(true);
    const lines = linesOf(SHIPPED);
    lines[0] = 'anything at all';
    expect(parseSettingsDat(fileOf(lines))).toEqual(SHIPPED_COLUMN);
  });

  it('reads the four window lines and $maximized edit but takes nothing from them (1.4 note 21)', () => {
    const lines = linesOf(SHIPPED);
    lines[13] = '1$maximized edit';
    lines[17] = '5$main top';
    lines[20] = '99999$main width';
    expect(parseSettingsDat(fileOf(lines))).toEqual(SHIPPED_COLUMN);
  });

  it('a missing file (no bytes) gives nothing, an import gives the defaults of the original', () => {
    expect(parseSettingsDat(new Uint8Array())).toEqual({});
    expect(editorSettingsFromDat(new Uint8Array())).toEqual(SETTINGS_DAT_DEFAULTS);
    expect(SETTINGS_DAT_DEFAULTS.colorPreset).toBe(-1);
  });
});

describe('parseSettingsDat: positional rule (editor-ui §11.4 step 2, §20.5)', () => {
  const changed = linesOf(writeSettingsDat(CHANGED_EDITOR));

  it('a line removed in the middle: settings before it load, every setting after it is a default', () => {
    // Remove line 30 ($directive color): lines 2-29 still match, 30-57 are all one line out of step.
    const lines = [...changed];
    lines.splice(29, 1);
    const parsed = parseSettingsDat(fileOf(lines));
    expect(parsed.generateList).toBe(false);
    expect(parsed.fontName).toBe('Fixedsys');
    expect(parsed.assembleBitField).toBe(false);
    expect(parsed.styles?.code).toEqual(CHANGED_EDITOR.styles.code);
    expect(parsed.styles?.unknown).toEqual(CHANGED_EDITOR.styles.unknown);
    // From line 30 on: the original's defaults.
    expect(parsed.styles?.directive).toEqual(SETTINGS_DAT_DEFAULTS.styles.directive);
    expect(parsed.styles?.text).toEqual(SETTINGS_DAT_DEFAULTS.styles.text);
    expect('highlightDisabled' in parsed).toBe(false);
    expect('printBlack' in parsed).toBe(false);
    expect('backgroundColor' in parsed).toBe(false);

    const imported = editorSettingsFromDat(fileOf(lines));
    expect(imported.highlightDisabled).toBe(false);
    expect(imported.printBlack).toBe(true);
    expect(imported.backgroundColor).toBe(16777215);
    expect(imported.fixedTabSize).toBe(8);
  });

  it('a line missing: the last read hits the end of the file and matches the stale $color presets (quirk)', () => {
    // Line 57 is read past the end of a 56-line file: getline stores only a NUL at buffer[0], so
    // the buffer holds "\0$color presets" from the file's last line, the scan finds that "$" and
    // temp is "": atoi gives 0, the item Color1. The original shows the same (errata E4.md).
    for (const removed of [1, 29, 55]) {
      const lines = [...changed];
      lines.splice(removed, 1);
      expect(parseSettingsDat(fileOf(lines)).colorPreset).toBe(0);
    }
  });

  it('the first setting line removed: nothing after the header loads but that stale last line', () => {
    const lines = [...changed];
    lines.splice(1, 1);
    expect(parseSettingsDat(fileOf(lines))).toEqual({ colorPreset: 0 });
    expect(editorSettingsFromDat(fileOf(lines))).toEqual({ ...SETTINGS_DAT_DEFAULTS, colorPreset: 0 });
  });

  it('an extra line shifts every later setting out of step as well', () => {
    const lines = [...changed];
    lines.splice(10, 0, 'Courier$font name');
    const parsed = parseSettingsDat(fileOf(lines));
    expect(parsed.fontName).toBe('Fixedsys'); // line 10 still matches
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'generateList',
        'generateSRecord',
        'saveThenAssemble',
        'showWarnings',
        'crossReference',
        'macrosExpanded',
        'structuredExpanded',
        'constantsExpanded',
        'fontName',
      ].sort(),
    );
  });

  it('the last line missing: everything else loads, the preset is the default', () => {
    const lines = changed.slice(0, 56);
    const parsed = parseSettingsDat(fileOf(lines));
    expect(parsed.backgroundColor).toBe(8421504);
    expect('colorPreset' in parsed).toBe(false);
    expect(editorSettingsFromDat(fileOf(lines)).colorPreset).toBe(-1);
  });
});

describe('parseSettingsDat: how each kind of line is read (optionsS.cpp:228-912)', () => {
  /** The shipped file with line `n` (1-based) replaced. */
  const withLine = (n: number, text: string) => {
    const lines = linesOf(SHIPPED);
    lines[n - 1] = text;
    return parseSettingsDat(fileOf(lines));
  };

  it('on/off lines: exactly one character before the $, 1 = on, anything else = off', () => {
    expect(withLine(4, '1$save then assemble').saveThenAssemble).toBe(true);
    expect(withLine(2, '0$generate list').generateList).toBe(false);
    expect(withLine(2, '2$generate list').generateList).toBe(false);
    expect(withLine(2, 'Y$generate list').generateList).toBe(false);
    // Two characters: &buffer[1] is "1$generate list", not the name; the line does not match.
    expect('generateList' in withLine(2, '11$generate list')).toBe(false);
    // No character: &buffer[1] is "generate list".
    expect('generateList' in withLine(2, '$generate list')).toBe(false);
    // The name is compared exactly, letter case included.
    expect('generateList' in withLine(2, '1$Generate List')).toBe(false);
    expect('generateList' in withLine(2, '1$generate list ')).toBe(false);
  });

  it('$tab type: 0 = Assembly, anything else = Fixed', () => {
    expect(withLine(12, '0$tab type').tabType).toBe(TabType.Assembly);
    expect(withLine(12, '1$tab type').tabType).toBe(TabType.Fixed);
    expect(withLine(12, 'x$tab type').tabType).toBe(TabType.Fixed);
  });

  it('$fixed tab size: atoi, then the spin box clamps to 4..20', () => {
    expect(withLine(13, '8$fixed tab size').fixedTabSize).toBe(8);
    expect(withLine(13, '6$fixed tab size').fixedTabSize).toBe(6);
    expect(withLine(13, '3$fixed tab size').fixedTabSize).toBe(4);
    expect(withLine(13, '64$fixed tab size').fixedTabSize).toBe(20);
    expect(withLine(13, 'abc$fixed tab size').fixedTabSize).toBe(4);
    expect(withLine(13, ' 12xyz$fixed tab size').fixedTabSize).toBe(12);
    expect(withLine(13, '$fixed tab size').fixedTabSize).toBe(4);
  });

  it('$font name takes everything before the $; $font size must be a whole number above zero', () => {
    expect(withLine(10, 'Lucida Console$font name').fontName).toBe('Lucida Console');
    expect(withLine(10, '$font name').fontName).toBe('');
    expect(withLine(11, '14$font size').fontSize).toBe(14);
    expect(withLine(11, ' 9 $font size').fontSize).toBe(9);
    expect('fontSize' in withLine(11, 'big$font size')).toBe(false);
    expect('fontSize' in withLine(11, '0$font size')).toBe(false);
    expect('fontSize' in withLine(11, '$font size')).toBe(false);
  });

  it('the style attributes and $highlight disabled are read with atoi: any non-zero number is on', () => {
    expect(withLine(23, '1$code bold').styles?.code.bold).toBe(true);
    expect(withLine(23, '2$code bold').styles?.code.bold).toBe(true);
    expect(withLine(23, '-1$code bold').styles?.code.bold).toBe(true);
    expect(withLine(23, ' 1$code bold').styles?.code.bold).toBe(true);
    expect(withLine(23, 'x$code bold').styles?.code.bold).toBe(false);
    expect(withLine(54, '10$highlight disabled').highlightDisabled).toBe(true);
    expect(withLine(54, '0$highlight disabled').highlightDisabled).toBe(false);
  });

  it('colours and the background are atoi numbers (COLORREF), negative ones included', () => {
    expect(withLine(22, '255$code color').styles?.code.color).toBe(255);
    expect(withLine(22, '-16777208$code color').styles?.code.color).toBe(-16777208);
    expect(withLine(56, '12632256$background color').backgroundColor).toBe(12632256);
    expect(withLine(56, '4294967295$background color').backgroundColor).toBe(-1); // wraps at 32 bits
  });

  it('$print w/black is an on/off line', () => {
    expect(withLine(55, '0$print w/black').printBlack).toBe(false);
    expect('printBlack' in withLine(55, '10$print w/black')).toBe(false);
  });

  it('$color presets: 0..4 select an item, anything else selects none (-1)', () => {
    for (const value of [0, 1, 2, 3, 4]) expect(withLine(57, `${value}$color presets`).colorPreset).toBe(value);
    expect(withLine(57, '-1$color presets').colorPreset).toBe(-1);
    expect(withLine(57, '5$color presets').colorPreset).toBe(-1); // the port's Auto is not a value of the file
    expect(withLine(57, '7$color presets').colorPreset).toBe(-1);
  });

  it('a style line that does not match keeps the default for that one value only', () => {
    const parsed = withLine(39, '1$label BOLD');
    expect(parsed.styles?.label).toEqual(SHIPPED_COLUMN.styles.label);
    // Only that line: the next one is still in step.
    expect(parsed.styles?.label.italic).toBe(false);
    expect(parsed.highlightDisabled).toBe(false);
    expect(parsed.colorPreset).toBe(-1);
  });
});

describe('parseSettingsDat: bytes as C reads them', () => {
  it('reads files with LF only as well as CR LF (text mode)', () => {
    expect(parseSettingsDat(fileOf(linesOf(SHIPPED), '\n'))).toEqual(SHIPPED_COLUMN);
  });

  it('a lone CR is part of the line: the name does not match', () => {
    const lines = linesOf(SHIPPED);
    lines[1] = '0$generate list\r';
    expect('generateList' in parseSettingsDat(fileOf(lines))).toBe(false);
  });

  it('a NUL ends a line for strcmp: what follows it is not compared', () => {
    const lines = linesOf(SHIPPED);
    lines[1] = '0$generate list\u0000 and more';
    expect(parseSettingsDat(fileOf(lines)).generateList).toBe(false);
  });

  it('a value whose text holds a NUL: temp ends at the NUL, the scan goes on to the $', () => {
    const lines = linesOf(SHIPPED);
    lines[9] = 'Cour\u0000ier$font name';
    expect(parseSettingsDat(fileOf(lines)).fontName).toBe('Cour');
  });

  it('a line of more than 255 bytes fails the stream: it and every later line give defaults', () => {
    const lines = linesOf(SHIPPED);
    lines[9] = `${'X'.repeat(300)}$font name`;
    const parsed = parseSettingsDat(fileOf(lines));
    expect(parsed.constantsExpanded).toBe(false); // line 9 read
    expect(Object.keys(parsed)).toHaveLength(8);
  });

  it('a line of exactly 255 bytes is still read whole', () => {
    const lines = linesOf(SHIPPED);
    const name = 'N'.repeat(255 - '$font name'.length);
    lines[9] = `${name}$font name`;
    expect(lines[9]).toHaveLength(255);
    expect(parseSettingsDat(fileOf(lines)).fontName).toBe(name);
  });

  it('a value scan that finds no $ in its line runs on into what an earlier, longer line left', () => {
    // Line 10 is long; line 11 is "12" without a $ and without a name: the scan passes the NUL
    // after "12" and finds the "$" of line 10's leftover bytes, whose name is not "$font size".
    const lines = linesOf(SHIPPED);
    lines[9] = 'AAAAAAAAAAAAAAAAAAAA$font name';
    lines[10] = '12';
    const parsed = parseSettingsDat(fileOf(lines));
    expect(parsed.fontName).toBe('AAAAAAAAAAAAAAAAAAAA');
    expect('fontSize' in parsed).toBe(false);
    expect(parsed.tabType).toBe(TabType.Fixed); // the next lines are in step
  });

  it('font names are Windows-1252', () => {
    const lines = linesOf(SHIPPED);
    lines[9] = 'Café$font name';
    expect(parseSettingsDat(fileOf(lines)).fontName).toBe('Café');
  });
});

describe('writeSettingsDat (optionsS.cpp:134-221)', () => {
  it('writes 57 lines with CR LF and the v5.16.01 header', () => {
    const lines = linesOf(writeSettingsDat(DEFAULT_EDITOR_SETTINGS));
    expect(lines).toHaveLength(57);
    expect(lines[0]).toBe(SETTINGS_DAT_HEADER);
    expect(lines[0]).toBe('$Settings for EASy68K Editor/Assembler v5.16.01  DO NOT EDIT THIS FILE!!!!');
    const text = decode(writeSettingsDat(DEFAULT_EDITOR_SETTINGS));
    expect(text.endsWith('$color presets\r\n')).toBe(true);
    expect(/[^\r]\n/.test(text)).toBe(false);
  });

  it('equals the checked fixture written-settings.dat, which loads back to the same settings', () => {
    const written = writeSettingsDat(CHANGED_EDITOR);
    const checked = fixture('written-settings.dat');
    expect(Array.from(written)).toEqual(Array.from(checked));
    expect(parseSettingsDat(checked)).toEqual(datPart(CHANGED_EDITOR));
    expect(editorSettingsFromDat(checked)).toEqual(datPart(CHANGED_EDITOR));
  });

  it('the shipped settings, written, are the shipped file except the header (and the same window lines)', () => {
    const written = linesOf(writeSettingsDat({ ...DEFAULT_EDITOR_SETTINGS, ...SHIPPED_COLUMN }));
    const shipped = linesOf(SHIPPED);
    expect(written.slice(1)).toEqual(shipped.slice(1));
  });

  it('window lines: maximized 0, main top 106, left 513, height 943, width 925 (1.4 note 21)', () => {
    const lines = linesOf(writeSettingsDat(CHANGED_EDITOR));
    expect(lines.slice(13, 14)).toEqual(['0$maximized edit']);
    expect(lines.slice(17, 21)).toEqual(['106$main top', '513$main left', '943$main height', '925$main width']);
  });

  it('the Auto preset is written as -1 with the Color1 values (3.10)', () => {
    const auto: EditorSettings = { ...CHANGED_EDITOR, colorPreset: 5, highlightDisabled: false };
    const parsed = parseSettingsDat(writeSettingsDat(auto));
    expect(parsed.colorPreset).toBe(-1);
    expect(parsed.styles).toEqual(COLOR1_STYLES);
    expect(parsed.backgroundColor).toBe(CHANGED_EDITOR.backgroundColor);
  });

  it('every preset of the file and every tab type round-trip', () => {
    for (const colorPreset of [-1, 0, 1, 2, 3, 4] as const) {
      expect(parseSettingsDat(writeSettingsDat({ ...CHANGED_EDITOR, colorPreset })).colorPreset).toBe(colorPreset);
    }
    for (const tabType of [TabType.Assembly, TabType.Fixed]) {
      expect(parseSettingsDat(writeSettingsDat({ ...CHANGED_EDITOR, tabType })).tabType).toBe(tabType);
    }
  });

  it('the defaults round-trip, the Auto preset becoming -1', () => {
    expect(parseSettingsDat(writeSettingsDat(DEFAULT_EDITOR_SETTINGS))).toEqual({
      ...datPart(structuredClone(DEFAULT_EDITOR_SETTINGS) as EditorSettings),
      colorPreset: -1,
    });
  });
});
