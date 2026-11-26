// The names of the icons in icons.svg (ARCHITECTURE.md 2.8). Owner: W2.
// icons.test.ts checks that this list and the sprite agree.

export const ICON_NAMES = [
  // Editor toolbar (editor-ui §3, in toolbar order)
  'file-new',
  'file-open',
  'file-save',
  'print',
  'find',
  'cut',
  'copy',
  'paste',
  'undo',
  'redo',
  'comment',
  'uncomment',
  'assemble',
  // Simulator toolbar (sim-ui §3.2; Open is file-open)
  'run',
  'run-to-cursor',
  'auto-trace',
  'step-over',
  'trace-into',
  'pause',
  'rewind',
  'reload',
  'log-start',
  'log-stop',
  // Controls
  'close',
  'chevron-down',
  'chevron-up',
  'chevron-right',
  'chevron-left',
  'check',
  'dot',
  'arrow-up',
  'arrow-down',
  'plus',
  'minus',
  'menu',
  'fullscreen',
  'fullscreen-exit',
  'options',
  'trash',
  'external',
  // Version 1.1: a window lifted from its place (the Float button of the dock's tab strips, P9.8)
  'float',
  // Files
  'folder',
  'file',
  // Theme
  'theme-system',
  'theme-light',
  'theme-dark',
  // Message box icon classes (3.12.4 MessageBoxRequest.icon) and toasts
  'information',
  'confirmation',
  'warning',
  'error',
  'success',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** The id of a symbol in icons.svg. */
export function iconId(name: IconName): string {
  return `e68-icon-${name}`;
}
