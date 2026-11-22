// The commands of the Edit and Window menus that belong to the editor (ARCHITECTURE.md 1.3.1,
// 1.3.2, 9.7; editor-ui §2.2, §2.5, §5.2). Owner: E2.
//
//   ed.edit.undo, redo                 the active document's history (note 5); enabled while it has
//                                      something to undo / redo (§8.9)
//   ed.edit.cut, copy                  enabled while the focused text control has a selection
//   ed.edit.paste, selectAll           enabled while a document is open (§2.2: the original's paste
//                                      handler dereferences a missing window; the port does nothing)
//   ed.edit.comment, uncomment         enabled while a document is open (never disabled in the
//                                      original; without a window the port does nothing, §19.3)
//   ed.edit.indent, outdent,           enabled ONLY while the editor has the focus: the dispatcher
//   ed.edit.toggleInsert               then leaves Insert and Ctrl+Shift+. / , to a focused text
//                                      field elsewhere (EDITOR_FOCUS_COMMANDS; errata/W3.md 25)
//   ed.window.cascade, tileH, tileV    one pane / two panes (note 9); enabled while a document is
//                                      open, as the VCL window actions are; checked = current layout
//   ed.window.arrange, minimizeAll     shown, always disabled (note 9)
//   ed.window.splitRight, splitDown,   the editor split of ARCHITECTURE-PLUS P3.1.4 (N2), in terms of
//   ed.window.unsplit                  Tile Vertically / Tile Horizontally / Cascade
//                                      (ui/editor/split.ts); Split while a document is open, Close
//                                      Split while there are two panes
//
// The handlers call the editor of the window (EditorActions); they are plain functions of it so
// that the unit tests can pass a fake.

import type { AppContext, CommandHandler, CommandId } from '../../contracts';
import type { SplitActions, SplitCommand } from '../../ui/editor/split';
import type { EditorActions, EditorPaneLayout } from './editor-api';

export type EditorFor = (ctx: AppContext) => EditorActions;
export type SplitFor = (ctx: AppContext) => SplitActions;

/** Without a split (the tests of the other commands): the split commands are disabled. */
const NO_SPLIT: SplitActions = { run: () => {}, enabled: () => false };

export function editorCommands(
  editorFor: EditorFor,
  splitFor: SplitFor = () => NO_SPLIT,
): Record<CommandId, CommandHandler> {
  const withDocument = (state: { documents: { activeId: string | null } }, ctx: AppContext) =>
    state.documents.activeId !== null || editorFor(ctx).hasDocument();
  const action = (run: (editor: EditorActions) => void | Promise<void>, enabled?: CommandHandler['enabled']) => {
    const handler: CommandHandler = { run: (ctx) => run(editorFor(ctx)) };
    if (enabled) handler.enabled = enabled;
    return handler;
  };
  const focused: CommandHandler['enabled'] = (_state, ctx) => editorFor(ctx).editorHasFocus();
  const layout = (value: EditorPaneLayout): CommandHandler => ({
    run: (ctx) => editorFor(ctx).setLayout(value),
    enabled: withDocument,
    checked: (state) => state.settings.app.layout.editorPanes === value,
  });
  const never: CommandHandler = { run: () => {}, enabled: () => false };
  const split = (command: SplitCommand): CommandHandler => ({
    run: (ctx) => splitFor(ctx).run(command),
    enabled: (_state, ctx) => splitFor(ctx).enabled(command),
  });

  return {
    'ed.edit.undo': action(
      (e) => e.undo(),
      (_s, ctx) => editorFor(ctx).canUndo(),
    ),
    'ed.edit.redo': action(
      (e) => e.redo(),
      (_s, ctx) => editorFor(ctx).canRedo(),
    ),
    'ed.edit.cut': action(
      (e) => e.cut(),
      (_s, ctx) => editorFor(ctx).hasSelection(),
    ),
    'ed.edit.copy': action(
      (e) => e.copy(),
      (_s, ctx) => editorFor(ctx).hasSelection(),
    ),
    'ed.edit.paste': action((e) => e.paste(), withDocument),
    'ed.edit.selectAll': action((e) => e.selectAll(), withDocument),
    'ed.edit.comment': action((e) => e.comment(), withDocument),
    'ed.edit.uncomment': action((e) => e.uncomment(), withDocument),
    'ed.edit.indent': action((e) => e.indent(), focused),
    'ed.edit.outdent': action((e) => e.outdent(), focused),
    'ed.edit.toggleInsert': action((e) => e.toggleInsert(), focused),
    'ed.window.arrange': never,
    'ed.window.cascade': layout('one'),
    'ed.window.tileH': layout('horizontal'),
    'ed.window.tileV': layout('vertical'),
    'ed.window.minimizeAll': never,
    'ed.window.splitRight': split('splitRight'),
    'ed.window.splitDown': split('splitDown'),
    'ed.window.unsplit': split('unsplit'),
  };
}
