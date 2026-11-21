// Syntax highlighting of .X68 source lines, a port of the original editor's highlighter
// (editor-ui §9; textS.cpp:1144-1571, ASSEMBLE.CPP, INSTLOOK.CPP, INSTTABL.CPP). Owner: E3.
//
// Framework-free: runs under Node. The CodeMirror side is app/src/features/highlight.

export { strcap, capitalise, skipSpace, isAlnum, isSpace, isDigit, toUpper } from './chars';
export { tokenize, Tokens, MAXT, MAX_SIZE } from './tokenize';
export { INSTRUCTION_TABLE, lookupMnemonic, type MnemonicEntry, type MnemonicKind } from './mnemonics';
export { highlightOperand } from './operand';
export {
  classifyStatement,
  checkRelational,
  DIRECTIVES,
  STRUCTURE_SINGLES,
  RELATIONAL_PATTERNS,
  type StatementResult,
} from './classify';
export { ELEMENTS } from './line-state';
export { highlightLine, highlightStyles, toSpans, type HighlightOptions, type HighlightSpan } from './highlight';
export {
  COLOR_PRESET,
  SYNTAX_ELEMENTS,
  VCL_COLORS,
  DEFAULT_BACKGROUND,
  COLOR1_STYLES,
  COLOR2_STYLES,
  NO_COLOR_STYLES,
  DISABLED_STYLES,
  AUTO_LIGHT,
  AUTO_DARK,
  presetStyles,
  colorRefToHex,
  hexToColorRef,
  type AutoPalette,
} from './presets';
