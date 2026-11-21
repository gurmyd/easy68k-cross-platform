// The defaults equal editor-ui §11.4 ("Default when the file is missing") and sim-ui §14.3
// ("Default"), table-driven: each row below is one row of those tables, with its line number.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TabType } from '../../contracts';
import { encode } from '../codec/cp1252';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_EDITOR_SETTINGS,
  DEFAULT_SETTINGS,
  DEFAULT_SIM_SETTINGS,
  DEFAULT_TEMPLATE,
  defaultSettings,
} from './defaults';

/** editor-ui §11.4: [line, name in settings.dat, key path in EditorSettings, default]. */
const EDITOR_ROWS: [number, string, string, unknown][] = [
  [2, 'generate list', 'generateList', true],
  [3, 'generate s-record', 'generateSRecord', true],
  [4, 'save then assemble', 'saveThenAssemble', false],
  [5, 'show warnings', 'showWarnings', true],
  [6, 'cross reference', 'crossReference', true],
  [7, 'macros expanded', 'macrosExpanded', false],
  [8, 'structured expand', 'structuredExpanded', false],
  [9, 'constants expand', 'constantsExpanded', false],
  [10, 'font name', 'fontName', 'Courier New'],
  [11, 'font size', 'fontSize', 10],
  [12, 'tab type', 'tabType', TabType.Fixed],
  [13, 'fixed tab size', 'fixedTabSize', 4],
  [15, 'auto indent', 'autoIndent', true],
  [16, 'real tabs', 'realTabs', false],
  [17, 'assemble bit field', 'assembleBitField', true],
  [22, 'code color', 'styles.code.color', 0],
  [26, 'unknown color', 'styles.unknown.color', 32896],
  [30, 'directive color', 'styles.directive.color', 32768],
  [34, 'comment color', 'styles.comment.color', 16711680],
  [38, 'label color', 'styles.label.color', 8388736],
  [42, 'structure color', 'styles.structure.color', 128],
  [46, 'error color', 'styles.error.color', 255],
  [50, 'text color', 'styles.text.color', 8421376],
  [54, 'highlight disabled', 'highlightDisabled', false],
  [55, 'print w/black', 'printBlack', true],
  [56, 'background color', 'backgroundColor', 16777215],
];

/** sim-ui §14.3: [line, name in sim68K.dat, key path in SimSettings, default]. */
const SIM_ROWS: [number, string, string, unknown][] = [
  [2, 'exec log', 'execLogType', 0],
  [3, 'output log', 'outputLogType', 0],
  [4, 'exceptions', 'exceptions', false],
  [14, 'memory address', 'memoryAddress', 0x000000],
  [19, 'which stack', 'whichStack', 8],
  [23, '7-segment address', 'seg7Address', 0xe00000],
  [24, 'LED address', 'ledAddress', 0xe00010],
  [25, 'switch address', 'switchAddress', 0xe00012],
  [26, 'button address', 'buttonAddress', 0xe00014],
  [28, 'output font name', 'outputFont.name', 'Fixedsys'],
  [29, 'output font size', 'outputFont.size', 9],
  [30, 'listing font name', 'listingFont.name', 'Courier New'],
  [31, 'listing font size', 'listingFont.size', 10],
  [32, 'printer font name', 'printerFont.name', 'Courier New'],
  [33, 'printer font size', 'printerFont.size', 10],
  [35, 'bit field enabled', 'bitField', false],
  [36, 'auto trace interval', 'autoTraceIntervalMs', 200],
  [37, 'disable display', 'disableDisplay', false],
];

function at(object: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, key) => (o as Record<string, unknown>)[key], object);
}

describe('editor defaults = editor-ui §11.4', () => {
  it.each(EDITOR_ROWS)('line %i $%s', (_line, _name, path, expected) => {
    expect(at(DEFAULT_EDITOR_SETTINGS, path)).toBe(expected);
  });
  it('every style has bold, italic and underline off (editor-ui §9.2)', () => {
    for (const style of Object.values(DEFAULT_EDITOR_SETTINGS.styles)) {
      expect([style.bold, style.italic, style.underline]).toEqual([false, false, false]);
    }
    expect(Object.keys(DEFAULT_EDITOR_SETTINGS.styles).sort()).toEqual(
      ['code', 'comment', 'directive', 'error', 'label', 'structure', 'text', 'unknown'].sort(),
    );
  });
  it('port settings of 3.10: preset Auto, line numbers on', () => {
    expect(DEFAULT_EDITOR_SETTINGS.colorPreset).toBe(5);
    expect(DEFAULT_EDITOR_SETTINGS.lineNumbers).toBe(true);
  });
});

describe('simulator defaults = sim-ui §14.3', () => {
  it.each(SIM_ROWS)('line %i $%s', (_line, _name, path, expected) => {
    expect(at(DEFAULT_SIM_SETTINGS, path)).toBe(expected);
  });
  it('port settings of 3.10 and 4.5.6', () => {
    expect(DEFAULT_SIM_SETTINGS.speed).toEqual({ mode: 'original', instructionsPerSecond: 1_000_000 });
    expect(DEFAULT_SIM_SETTINGS.highlightChangedRegisters).toBe(true);
  });
});

describe('template.NEW (editor-ui §12.2)', () => {
  const crlf = encode(DEFAULT_TEMPLATE.replace(/\n/g, '\r\n')).bytes;
  it('is 420 bytes with CR LF line ends, spaces only, ending with a line break', () => {
    expect(crlf.length).toBe(420);
    expect(DEFAULT_TEMPLATE.endsWith('\n')).toBe(true);
    expect(DEFAULT_TEMPLATE).not.toContain('\t');
    expect(DEFAULT_EDITOR_SETTINGS.template).toBe(DEFAULT_TEMPLATE);
  });
  const shipped = fileURLToPath(new URL('../../../../reference/official-extracted/template.NEW', import.meta.url));
  it.skipIf(!existsSync(shipped))('equals the shipped file byte for byte (needs reference/)', () => {
    expect([...crlf]).toEqual([...readFileSync(shipped)]);
  });
});

describe('the settings document', () => {
  it('has version 1 and the three parts', () => {
    expect(DEFAULT_SETTINGS.version).toBe(1);
    expect(DEFAULT_SETTINGS.editor).toBe(DEFAULT_EDITOR_SETTINGS);
    expect(DEFAULT_SETTINGS.sim).toBe(DEFAULT_SIM_SETTINGS);
    expect(DEFAULT_SETTINGS.app).toBe(DEFAULT_APP_SETTINGS);
    expect(DEFAULT_APP_SETTINGS).toEqual({
      theme: 'system',
      layout: { panels: {}, splits: {}, editorPanes: 'one', outputZoom: 'fit' },
      serialPortMap: {},
    });
  });
  it('is frozen, and defaultSettings() gives an independent mutable copy', () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_EDITOR_SETTINGS.styles.code)).toBe(true);
    const copy = defaultSettings();
    expect(copy).toEqual(DEFAULT_SETTINGS);
    copy.editor.styles.code.color = 1;
    copy.app.layout.panels['x'] = { visible: true };
    expect(DEFAULT_EDITOR_SETTINGS.styles.code.color).toBe(0);
    expect(DEFAULT_APP_SETTINGS.layout.panels).toEqual({});
  });
});
