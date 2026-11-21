// Texts the specifications fix exactly, used by several suites. Owner: X1.

/** The shipped 16-line template (editor-ui §12.2), lines separated by "\n", ending with one. */
export const TEMPLATE = [
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
  '',
].join('\n');

/** The four trailer lines an `.X68` file ends with (editor-ui §6.4, ARCHITECTURE.md 3.9.3), CR LF each. */
export function trailer(fontName = 'Courier New', fontSize = 10, tabType = 1, tabSize = 4): string {
  return (
    `*~Font name~${fontName}~\r\n` +
    `*~Font size~${fontSize}~\r\n` +
    `*~Tab type~${tabType}~\r\n` +
    `*~Tab size~${tabSize}~\r\n`
  );
}

/** The trailer of the default settings. */
export const TRAILER = trailer();
