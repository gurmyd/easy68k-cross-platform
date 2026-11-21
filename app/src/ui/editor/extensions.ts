// The CodeMirror configuration of a document view (ARCHITECTURE.md 2.2, 2.4; editor-ui §7.1, §8). Owner: E2.
//
// Everything the editor adds to a document's EditorState lives in one compartment
// (`editorCompartment`) that the view reconfigures whenever one of its inputs changes: the
// document's tab model and Insert/Replace flag, the global options (Real Tabs, Auto Indent, line
// numbers), and the extensions other features contribute (highlighting, E3; anything registered
// through state/editor-extensions.ts). History and markers are state fields of their own and keep
// their contents across reconfigurations.
//
// What is deliberately NOT here (2.4, editor-ui §7.1): word wrap, bracket matching,
// auto-completion, folding, multiple cursors, a search panel (Find and Replace are E6's dialogs).

import { history, redo, selectAll, standardKeymap, temporarilySetTabFocusMode, undo } from '@codemirror/commands';
import { Compartment, Facet, type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  drawSelection,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  type DecorationSet,
  type KeyBinding,
  type ViewUpdate,
} from '@codemirror/view';
import { TabType } from '../../contracts';
import {
  autoIndentAfterEnter,
  enterKey,
  normalizeLineBreaks,
  overwriteInput,
  shiftTabKey,
  tabKey,
  whiteSpaceBeforeEnter,
} from './editing';
import { cp1252Marks } from './cp1252-marks';
import { markerExtension } from './markers';
import { nextTabStop, type TabSettings } from './tab-model';

/** The inputs of a document view that are not text. */
export interface DocumentViewOptions extends TabSettings {
  /** Global Real Tabs option (editor-ui §8.2). */
  realTabs: boolean;
  /** Global Auto Indent option (editor-ui §8.4). */
  autoIndent: boolean;
  /** The document's Insert (true) / Replace (false) flag (editor-ui §8.6). */
  insertMode: boolean;
}

export const DEFAULT_VIEW_OPTIONS: DocumentViewOptions = {
  tabType: TabType.Fixed,
  tabSize: 4,
  realTabs: false,
  autoIndent: true,
  insertMode: true,
};

/** The options of the document a state belongs to. */
export const viewOptions = Facet.define<DocumentViewOptions, DocumentViewOptions>({
  combine: (values) => values[0] ?? DEFAULT_VIEW_OPTIONS,
});

/** The compartment that holds everything the editor adds to a document's state. */
export const editorCompartment = new Compartment();

/* ------------------------------------------------------------------ tab characters (editor-ui §8.3) */

/** A tab character drawn as wide as the columns up to its stop. */
class TabWidget extends WidgetType {
  constructor(readonly columns: number) {
    super();
  }
  override eq(other: TabWidget): boolean {
    return other.columns === this.columns;
  }
  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'e68-tab';
    span.style.width = `${this.columns}ch`;
    span.textContent = '\t';
    return span;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

const tabWidgets = new Map<number, Decoration>();
function tabDecoration(columns: number): Decoration {
  let decoration = tabWidgets.get(columns);
  if (!decoration) {
    decoration = Decoration.replace({ widget: new TabWidget(columns) });
    tabWidgets.set(columns, decoration);
  }
  return decoration;
}

/** Tab decorations of the visible lines: each tab reaches the next stop of the document's model. */
function tabDecorations(view: EditorView): DecorationSet {
  const settings = view.state.facet(viewOptions);
  const ranges = [];
  let lastLine = -1;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      if (line.number !== lastLine && line.text.includes('\t')) {
        let column = 0;
        for (let i = 0; i < line.text.length; i++) {
          if (line.text.charCodeAt(i) === 9) {
            const stop = nextTabStop(column, settings);
            ranges.push(tabDecoration(stop - column).range(line.from + i, line.from + i + 1));
            column = stop;
          } else {
            column++;
          }
        }
      }
      lastLine = line.number;
      pos = line.to + 1;
    }
  }
  return Decoration.set(ranges);
}

const tabDisplay = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = tabDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.startState.facet(viewOptions) !== update.state.facet(viewOptions)
      ) {
        this.decorations = tabDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/* ------------------------------------------------------------------ keys (editor-ui §5.2, §8) */

function enterCommand(view: EditorView): boolean {
  const options = view.state.facet(viewOptions);
  const lead = whiteSpaceBeforeEnter(view.state);
  view.dispatch(enterKey(view.state));
  if (options.autoIndent) {
    const indent = autoIndentAfterEnter(view.state, lead);
    if (indent) view.dispatch(indent);
  }
  return true;
}

/**
 * Enter with any modifiers (editor-ui §5.2 rule 11): the original does not swallow the key, so the
 * edit control inserts its line break whatever modifiers are held, and Auto Indent follows. One
 * binding per combination of Alt, Ctrl and Meta, each with its Shift variant. Alt+Enter is
 * Simulator mode's Full Screen command; in Editor mode the dispatcher leaves it to the editor.
 */
const enterBindings: KeyBinding[] = [
  '',
  'Alt-',
  'Ctrl-',
  'Meta-',
  'Alt-Ctrl-',
  'Alt-Meta-',
  'Ctrl-Meta-',
  'Alt-Ctrl-Meta-',
].map((modifiers) => ({ key: `${modifiers}Enter`, run: enterCommand, shift: enterCommand }));

/**
 * The editor's own key map. Tab and Shift+Tab are taken (WantTabs, editor-ui §7.1); Esc followed
 * by Tab moves the focus out of the editor, so that keyboard users are not trapped. Undo, redo
 * and select all are bound here because the dispatcher leaves their chords to the focused editor
 * (errata/W3.md entry 1); Ctrl+Alt+Z (Redo on Windows) is a command and reaches the editor through
 * the registry.
 */
export const editorKeymap: readonly KeyBinding[] = [
  {
    key: 'Tab',
    run: (view) => {
      view.dispatch(tabKey(view.state, view.state.facet(viewOptions)));
      return true;
    },
    shift: (view) => {
      const spec = shiftTabKey(view.state, view.state.facet(viewOptions));
      if (spec) view.dispatch(spec);
      return true;
    },
  },
  ...enterBindings,
  { key: 'Escape', run: temporarilySetTabFocusMode },
  { key: 'Mod-z', run: undo, preventDefault: true },
  { key: 'Mod-Shift-z', run: redo, preventDefault: true },
  { key: 'Mod-a', run: selectAll },
];

/* ------------------------------------------------------------------ Replace mode (editor-ui §8.6) */

const overwriteTyping = EditorView.inputHandler.of((view, from, to, text) => {
  if (view.state.facet(viewOptions).insertMode) return false;
  const spec = overwriteInput(view.state, from, to, text);
  if (!spec) return false;
  view.dispatch(spec);
  return true;
});

/* ------------------------------------------------------------------ Cut and Copy keys (editor-ui §8.7) */

/**
 * True when Cut or Copy has nothing to act on: every selection range is empty. CodeMirror would
 * then cut or copy the whole caret line; the original edit control does nothing (and the Edit
 * menu disables Cut and Copy without a selection, §2.2), so the event is cancelled and the
 * document and the clipboard stay as they are.
 */
export function clipboardHasNothingToTake(state: EditorState): boolean {
  return state.selection.ranges.every((range) => range.empty);
}

const noLinewiseClipboard = EditorView.domEventHandlers({
  cut: (event, view) => {
    if (!clipboardHasNothingToTake(view.state)) return false;
    event.preventDefault();
    return true;
  },
  copy: (event, view) => {
    if (!clipboardHasNothingToTake(view.state)) return false;
    event.preventDefault();
    return true;
  },
});

/* ------------------------------------------------------------------ assembly */

/** The parts that never change. */
const baseExtensions: Extension = [
  history(),
  drawSelection(),
  highlightSpecialChars(),
  tabDisplay,
  overwriteTyping,
  noLinewiseClipboard,
  cp1252Marks,
  markerExtension,
  // Pasted and dropped text arrives as plain text (CodeMirror reads text/plain only, 20.3) with
  // "\n" as its only line break.
  EditorView.clipboardInputFilter.of((text) => normalizeLineBreaks(text)),
  keymap.of([...editorKeymap, ...standardKeymap]),
  EditorView.contentAttributes.of({
    'aria-multiline': 'true',
    spellcheck: 'false',
    autocorrect: 'off',
    autocapitalize: 'off',
  }),
];

export interface EditorConfigInput {
  options: DocumentViewOptions;
  lineNumbers: boolean;
  /** Accessible name of the text area: the document's name. */
  label: string;
  /** Extensions contributed by other features for this document (state/editor-extensions.ts). */
  features: readonly Extension[];
}

/** The contents of `editorCompartment` for a document. */
export function editorConfig(input: EditorConfigInput): Extension {
  return [
    viewOptions.of(input.options),
    baseExtensions,
    input.lineNumbers ? lineNumbers() : [],
    EditorView.contentAttributes.of({ 'aria-label': input.label }),
    ...input.features,
  ];
}
