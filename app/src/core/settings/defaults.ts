// Default settings (ARCHITECTURE.md 3.10): the values of the original programs when their settings
// files are missing - editor-ui §11.4 for the editor, sim-ui §14.3 for the simulator - plus the
// port's own settings, whose defaults section 3.10 gives.
//
// Owner: W1. SettingsService (core/settings/service.ts, W3) fills missing keys from these.

import { TabType, type AppSettings, type EditorSettings, type Settings, type SimSettings } from '../../contracts';

/**
 * template.NEW as shipped with the official v5.16.1 installer (editor-ui §12.2), with "\n" line
 * breaks as the documents hold text (3.9.1). Saved with CR LF it is the original's 420 bytes.
 */
export const DEFAULT_TEMPLATE: string =
  [
    '*-----------------------------------------------------------',
    '* Title      :',
    '* Written by :',
    '* Date       :',
    '* Description:',
    '*-----------------------------------------------------------',
    '    ORG    $1000',
    'START:                  ; first instruction of program',
    '',
    '* Put program code here',
    '',
    '    SIMHALT             ; halt simulator',
    '',
    '* Put variables and constants here',
    '',
    '    END    START        ; last line of source',
  ].join('\n') + '\n';

/** "EASy68K-like" speed (4.5.6). Same value as DEFAULT_IPS of core/run/governor.ts (SH8). */
export const DEFAULT_INSTRUCTIONS_PER_SECOND = 1_000_000;

/** editor-ui §11.4, column "Default when the file is missing"; styles from editor-ui §9.2. */
export const DEFAULT_EDITOR_SETTINGS: Readonly<EditorSettings> = Object.freeze({
  generateList: true, // line 2
  generateSRecord: true, // line 3
  saveThenAssemble: false, // line 4
  showWarnings: true, // line 5
  crossReference: true, // line 6
  macrosExpanded: false, // line 7
  structuredExpanded: false, // line 8
  constantsExpanded: false, // line 9
  fontName: 'Courier New', // line 10
  fontSize: 10, // line 11
  tabType: TabType.Fixed, // line 12
  fixedTabSize: 4, // line 13
  autoIndent: true, // line 15
  realTabs: false, // line 16
  assembleBitField: true, // line 17
  styles: Object.freeze({
    code: Object.freeze({ color: 0, bold: false, italic: false, underline: false }), // lines 22-25
    unknown: Object.freeze({ color: 32896, bold: false, italic: false, underline: false }), // 26-29
    directive: Object.freeze({ color: 32768, bold: false, italic: false, underline: false }), // 30-33
    comment: Object.freeze({ color: 16711680, bold: false, italic: false, underline: false }), // 34-37
    label: Object.freeze({ color: 8388736, bold: false, italic: false, underline: false }), // 38-41
    structure: Object.freeze({ color: 128, bold: false, italic: false, underline: false }), // 42-45
    error: Object.freeze({ color: 255, bold: false, italic: false, underline: false }), // 46-49
    text: Object.freeze({ color: 8421376, bold: false, italic: false, underline: false }), // 50-53
  }),
  highlightDisabled: false, // line 54
  printBlack: true, // line 55
  backgroundColor: 16777215, // line 56
  colorPreset: 5, // port: Auto (line 57 of the original defaults to -1, 3.10)
  template: DEFAULT_TEMPLATE,
  lineNumbers: true, // port
}) as Readonly<EditorSettings>;

/** sim-ui §14.3, column "Default"; the Options defaults of sim-ui §14.1. */
export const DEFAULT_SIM_SETTINGS: Readonly<SimSettings> = Object.freeze({
  execLogType: 0, // line 2
  outputLogType: 0, // line 3
  exceptions: false, // line 4
  bitField: false, // line 35
  memoryAddress: 0x000000, // line 14
  whichStack: 8, // line 19 (SS)
  seg7Address: 0xe00000, // line 23
  ledAddress: 0xe00010, // line 24
  switchAddress: 0xe00012, // line 25
  buttonAddress: 0xe00014, // line 26
  outputFont: Object.freeze({ name: 'Fixedsys', size: 9 }), // lines 28-29
  listingFont: Object.freeze({ name: 'Courier New', size: 10 }), // lines 30-31
  printerFont: Object.freeze({ name: 'Courier New', size: 10 }), // lines 32-33
  autoTraceIntervalMs: 200, // line 36
  disableDisplay: false, // line 37
  speed: Object.freeze({ mode: 'original', instructionsPerSecond: DEFAULT_INSTRUCTIONS_PER_SECOND }), // port, 4.5.6
  highlightChangedRegisters: true, // port
}) as Readonly<SimSettings>;

/**
 * Port-only settings. The layout starts empty: panel visibility and splitter positions not stored
 * take the defaults of the shell (W3, 2.4).
 */
export const DEFAULT_APP_SETTINGS: Readonly<AppSettings> = Object.freeze({
  theme: 'system',
  layout: Object.freeze({
    panels: Object.freeze({}),
    splits: Object.freeze({}),
    editorPanes: 'one',
    outputZoom: 'fit',
  }),
  serialPortMap: Object.freeze({}),
}) as Readonly<AppSettings>;

/** The whole default settings document (frozen). */
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  version: 1,
  editor: DEFAULT_EDITOR_SETTINGS,
  sim: DEFAULT_SIM_SETTINGS,
  app: DEFAULT_APP_SETTINGS,
}) as Readonly<Settings>;

/** A fresh, mutable copy of the default settings. */
export function defaultSettings(): Settings {
  return structuredClone(DEFAULT_SETTINGS) as Settings;
}
