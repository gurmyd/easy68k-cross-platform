// What the Editor feature needs from the editor component (ui/editor, also E2's). Owner: E2.
//
// The feature module (index.ts) registers the editor area as the panel `editor` and the commands
// of the Edit and Window menus. The component and the editing operations live in app/src/ui/editor
// (ARCHITECTURE.md section 8 and 9.2). The feature imports the component through ui-link.ts (the
// layer rule lets `features/editor/` import `ui/editor/`, docs/requests/E2-layer-rule.md) and uses
// it through this interface; ui/editor/index.ts implements it and is checked against it by the
// compiler (errata/E2.md, entry 1).

import type { ComponentType } from 'react';
import type { AppContext } from '../../contracts';

export type EditorPaneLayout = 'one' | 'horizontal' | 'vertical';

/** The operations of the editor of one window, as the commands use them. */
export interface EditorActions {
  /** Edit > Undo / Redo on the active document (editor-ui §8.9; note 5). */
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Cut, Copy, Paste, Select All on the focused text control: the editor or a text field (§8.7). */
  cut(): void;
  copy(): void;
  paste(): Promise<void>;
  selectAll(): void;
  /** True when the text control the clipboard commands act on has a selection. */
  hasSelection(): boolean;
  /** Comment / Uncomment / Indent / Outdent on the active document (§8.5, note 6). */
  comment(): void;
  uncomment(): void;
  indent(): void;
  outdent(): void;
  /** Insert / Replace of the active document (§8.6). */
  toggleInsert(): void;
  /** True while a document view of the editor has the keyboard focus. */
  editorHasFocus(): boolean;
  /** True when a document is open (the commands do nothing without one, editor-ui §2.2). */
  hasDocument(): boolean;
  /** Window > Cascade / Tile Horizontally / Tile Vertically (1.4 note 9). */
  setLayout(layout: EditorPaneLayout): void;
}

export interface EditorUi {
  /** The editor area: one or two panes of tab strip, editor and status bar (2.2). */
  EditorArea: ComponentType;
  /** The status bar of Editor mode at the bottom of the window. */
  EditorWindowStatus: ComponentType;
  /** The editor of the window `ctx` belongs to (created on first use). */
  editorFor(ctx: AppContext): EditorActions;
}
