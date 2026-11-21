// Reading and writing the original's settings files (ARCHITECTURE.md 3.10, 5.6): settings.dat of
// the Editor/Assembler, sim68K.dat of the Simulator and template.NEW. The port's own store is JSON
// (core/settings/service.ts); these files are imported and exported through the dialog
// `settings.transfer` (features/options). Runs under Node: bytes in, bytes out. Owner: E4.

export { DatReader, LINE_SIZE, atoi } from './c-reader';
export {
  SETTINGS_DAT_DEFAULTS,
  SETTINGS_DAT_HEADER,
  SETTINGS_DAT_KEYS,
  SETTINGS_DAT_LINES,
  SETTINGS_DAT_WINDOW,
  STYLE_BLOCKS,
  clampTabSize,
  editorSettingsFromDat,
  parseSettingsDat,
  writeSettingsDat,
  type DatEditorSettings,
} from './settings-dat';
export {
  SIM68K_DAT_DEFAULTS,
  SIM68K_DAT_HEADER,
  SIM68K_DAT_LINES,
  SIM68K_DAT_PANELS,
  SIM68K_DAT_WINDOWS,
  clampAutoTraceInterval,
  parseSim68KDat,
  simSettingsFromDat,
  writeSim68KDat,
  type DatSimSettings,
  type ImportedSim68KDat,
  type ParsedSim68KDat,
  type Sim68KPanel,
} from './sim68k-dat';
export { templateFromBytes, templateToBytes } from './template';
