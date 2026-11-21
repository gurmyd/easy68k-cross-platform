// The editor's print document (editor-ui §13; ARCHITECTURE.md 1.4 note 2). Owner: E6.
//
// Plain code without a DOM: the Print command of features/print builds the page here and hands it
// to Platform.print.

export {
  NEW_PAGE_MARKER,
  buildPrintDocument,
  escapeHtml,
  printFontFamily,
  printFontSize,
  printLines,
  splitPages,
  type PrintDocument,
  type PrintSource,
} from './document';
export { PrintTabSizeError, TAB1, TAB2, TAB3, blanksForTab, expandTabs } from './tabs';
