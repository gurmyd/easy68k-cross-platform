// Feature "editor": the editor area (region `editor` of Editor mode) and the editor's commands of
// the Edit and Window menus (ARCHITECTURE.md 2.2, 2.4, 1.3.1, 1.3.2; work package E2).
//
// The component itself is in app/src/ui/editor (pane, tab strip, status bar, context menu and the
// CodeMirror extensions for the tab model, Tab key, Auto Indent, Replace mode, comment / indent,
// markers and the marks on characters Windows-1252 lacks). This module contributes:
//
//   panels    `editor` (Editor mode): the editor area, one or two panes;
//             `status` (Editor mode): the window's status bar, showing the active document's path
//             (each pane has the original's status bar under its document, 2.2)
//   commands  see commands.ts
//   init      ends the window's editor session with the application
//
// Owner: W3 > E2.

import type { FeatureModule } from '../../contracts';
import { editorCommands } from './commands';
import { editorUi } from './ui-link';

export const feature: FeatureModule = {
  id: 'editor',
  panels: [
    { id: 'editor', title: 'Editor', mode: 'editor', component: editorUi.EditorArea },
    { id: 'status', title: 'Status', mode: 'editor', component: editorUi.EditorWindowStatus },
  ],
  commands: editorCommands((ctx) => editorUi.editorFor(ctx)),
  init(ctx) {
    // Create the session at start, so that focus tracking works before the first command.
    const session = editorUi.editorFor(ctx) as { dispose?: () => void };
    return () => session.dispose?.();
  },
};
