// The end-to-end harness (ARCHITECTURE.md 6.6). Owner: X1. Suites import from here:
//
//   import { test, expect, crlf } from '../fixtures';
//
// tests/e2e/fixtures/README.md explains the rules every suite follows (X2's simulator suites too).

export { test, expect } from './test';
export {
  App,
  bytesOf,
  crlf,
  editorMenuOf,
  escapeRegExp,
  latin1,
  nonBlackColours,
  plainCaption,
  readDownload,
} from './app';
export type { FileSpec, MenuEntry, TabInfo } from './app';
export { chordOf, chordsOf, hostKeyMap, modKey, playwrightKey, type KeyMap } from './keys';
export {
  PENDING,
  expectedFailure,
  pendingReason,
  regressionReason,
  requirePackage,
  type PendingPackage,
} from './pending';
export { printed, recordPrints, type Printed } from './printing';
export { TEMPLATE, TRAILER, trailer } from './texts';
