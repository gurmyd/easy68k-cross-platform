// The editor component (ARCHITECTURE.md 2.2, 2.4; work package E2). Owner: E2.
//
// features/editor registers `EditorArea` as the panel `editor` and calls the operations of
// `editorFor(ctx)` from the commands of the Edit and Window menus. The object below is checked
// against the interface that feature declares (features/editor/editor-api.ts).
//
// Folder contents:
//   tab-model.ts        the tab stops of EASy68K and the rules that use them (editor-ui §8.1-§8.3)
//   editing.ts          Tab, Shift+Tab, Enter / Auto Indent, Comment / Indent, Replace mode
//   extensions.ts       the CodeMirror configuration of a document view
//   markers.ts          inline assembler markers;  cp1252-marks.ts  characters Windows-1252 lacks
//   status.ts           texts of the status bar;   fonts.ts         the document's display font
//   document-link.ts    how the editor reaches a document's EditorState (local adapter)
//   panes.ts            documents per pane (Cascade, Tile);  clipboard.ts  menu Cut/Copy/Paste
//   session.ts          the editor of one window: views, focus, operations
//   *.tsx, editor.css   the React components
//   check-editor.mjs    the browser check (Chromium and WebKit)

import type { EditorUi } from '../../features/editor/editor-api';
import { EditorArea } from './EditorArea';
import { EditorWindowStatus } from './EditorStatusBar';
import { editorSession } from './session';

export const editorUi = {
  EditorArea,
  EditorWindowStatus,
  editorFor: editorSession,
} satisfies EditorUi;

export { EditorArea, EditorWindowStatus, editorSession };
export * from './tab-model';
