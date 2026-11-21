// The highlighter's CodeMirror extension for one document view (ARCHITECTURE.md 1.4 note 19, 2.8;
// editor-ui §9). Owner: E3.
//
// - Only source documents are highlighted; list documents (.L68, .S68) get no marks (2.4). Under a
//   stored preset they take the stored background with black text, as every window of the original
//   does (textS.cpp:78); under Auto they keep the theme's editor colours. The kind is read live from
//   the store, so a document that changes kind follows.
// - Lines are coloured at once on every change (no 400 ms delay), for the lines CodeMirror shows.
// - Settings changes (preset, colours, attributes, background, Disabled, the bit-field option)
//   apply to every open view at once, as the original's Editor Options OK does.

import { StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { AppContext, DocumentState, EditorSettings } from '../../contracts';
import { AUTO_DARK, AUTO_LIGHT, SYNTAX_ELEMENTS } from '../../core/highlight';
import { listColorsStyle, storedColorsStyle, syntaxClass, syntaxVariable, syntaxVariables } from './colors';
import { buildHighlightDecorations, type DocRange } from './decorations';

/** What one view needs to know to draw its document. */
export interface HighlightConfig {
  /** The document is a source document (only those are highlighted). */
  source: boolean;
  /** highlightDisabled: everything in the Code colour, no attributes. */
  disabled: boolean;
  /** The assembler option "Assemble Bit Field Instructions". */
  bitField: boolean;
  /**
   * Inline style with the stored colours, or null for the Auto preset. For a list document only the
   * stored background and the default black text (listColorsStyle).
   */
  colors: string | null;
}

/** Where the configuration comes from: the application's settings and store, or a test double. */
export interface HighlightEnvironment {
  config(doc: DocumentState): HighlightConfig;
  /** Calls `listener` whenever the configuration of some document may have changed. */
  subscribe(listener: () => void): () => void;
}

export function configFrom(editor: EditorSettings, kind: DocumentState['kind']): HighlightConfig {
  const source = kind === 'source';
  return {
    source,
    disabled: editor.highlightDisabled,
    bitField: editor.assembleBitField,
    colors: source ? storedColorsStyle(editor) : listColorsStyle(editor),
  };
}

export function sameConfig(a: HighlightConfig, b: HighlightConfig): boolean {
  return a.source === b.source && a.disabled === b.disabled && a.bitField === b.bitField && a.colors === b.colors;
}

/** The environment of the running application. */
export function createHighlightEnvironment(ctx: Pick<AppContext, 'settings' | 'store'>): HighlightEnvironment {
  return {
    config(doc) {
      const live = ctx.store.getState().documents.items.find((item) => item.id === doc.id);
      return configFrom(ctx.settings.get().editor, (live ?? doc).kind);
    },
    subscribe(listener) {
      const offSettings = ctx.settings.subscribe(listener);
      const offStore = ctx.store.subscribe(listener);
      return () => {
        offSettings();
        offStore();
      };
    },
  };
}

const OFF: HighlightConfig = { source: false, disabled: false, bitField: true, colors: null };

const setHighlightConfig = StateEffect.define<HighlightConfig>();

/** The view's current configuration. */
export const highlightConfig = StateField.define<HighlightConfig>({
  create: () => OFF,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setHighlightConfig)) value = effect.value;
    return value;
  },
});

/** The decorations of a view: none for a list document or while highlighting is disabled. */
export function decorationsFor(config: HighlightConfig, doc: Text, ranges: readonly DocRange[]): DecorationSet {
  if (!config.source || config.disabled) return Decoration.none;
  return buildHighlightDecorations(doc, ranges, config);
}

/**
 * The classes and the inline style the editor element takes. A list document takes nothing under
 * Auto, and only the stored background with black text under a stored preset (`e68-syntax--list`).
 */
export function editorAttributesFor(config: HighlightConfig): Record<string, string> {
  if (!config.source) return config.colors ? { class: 'e68-syntax e68-syntax--list', style: config.colors } : {};
  const attributes: Record<string, string> = {
    class: config.disabled ? 'e68-syntax e68-syntax--disabled' : 'e68-syntax',
  };
  if (config.colors) attributes.style = config.colors;
  return attributes;
}

const cssVariables = (palette: typeof AUTO_LIGHT) => syntaxVariables(palette.styles, palette.background);

/** Mark rules: each element takes its colour and attributes from its custom properties. */
const markRules = Object.fromEntries(
  SYNTAX_ELEMENTS.map((element) => {
    const name = syntaxVariable(element);
    return [
      `&.e68-syntax .${syntaxClass(element)}`,
      {
        color: `var(${name})`,
        fontWeight: `var(${name}-weight, normal)`,
        fontStyle: `var(${name}-style, normal)`,
        textDecoration: `var(${name}-decoration, none)`,
      },
    ];
  }),
);

const background = `var(${syntaxVariable('background')})`;
const codeColor = `var(${syntaxVariable('code')})`;

/**
 * The highlighter's theme. The Auto values are the defaults (light on :root, dark under
 * data-theme="dark", ARCHITECTURE.md 2.8); a stored preset overrides them with an inline style.
 */
export const highlightTheme = EditorView.theme({
  '&.e68-syntax': { ...cssVariables(AUTO_LIGHT), backgroundColor: background },
  ':root[data-theme="dark"] &.e68-syntax': cssVariables(AUTO_DARK),
  // The scroller carries the background, never .cm-content: CodeMirror draws the selection in a
  // layer behind the content (.cm-selectionLayer, z-index -2), which an opaque .cm-content would
  // hide, so no selection was ever visible (gate I2, E6's review). Pinned by check-highlight.mjs.
  '&.e68-syntax .cm-scroller': { backgroundColor: background },
  '&.e68-syntax .cm-content': { backgroundColor: 'transparent', color: codeColor, caretColor: codeColor },
  // One step more specific than the editor component's own cursor rule, which would otherwise win
  // by stylesheet order and draw a light-theme caret on a stored dark background (or the reverse).
  '&.e68-syntax .cm-cursorLayer .cm-cursor, &.e68-syntax .cm-dropCursor': { borderLeftColor: codeColor },
  ...markRules,
});

/**
 * The extension for one document view. `env.config(doc)` decides, now and whenever `env`
 * reports a change, whether and how the view is highlighted.
 */
export function highlightExtension(env: HighlightEnvironment, doc: DocumentState): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      #pending = false;
      #destroyed = false;
      readonly #unsubscribe: () => void;

      constructor(readonly view: EditorView) {
        this.decorations = this.#build();
        this.#unsubscribe = env.subscribe(() => this.#refresh());
      }

      update(update: ViewUpdate): void {
        const configChanged = update.startState.field(highlightConfig) !== update.state.field(highlightConfig);
        if (update.docChanged || update.viewportChanged || configChanged) this.decorations = this.#build();
      }

      destroy(): void {
        this.#destroyed = true;
        this.#unsubscribe();
      }

      #build(): DecorationSet {
        return decorationsFor(this.view.state.field(highlightConfig), this.view.state.doc, this.view.visibleRanges);
      }

      /** A settings or store change: dispatch the new configuration once the current update is over. */
      #refresh(): void {
        if (this.#pending || sameConfig(env.config(doc), this.view.state.field(highlightConfig))) return;
        this.#pending = true;
        queueMicrotask(() => {
          this.#pending = false;
          if (this.#destroyed) return;
          const next = env.config(doc);
          if (!sameConfig(next, this.view.state.field(highlightConfig))) {
            this.view.dispatch({ effects: setHighlightConfig.of(next) });
          }
        });
      }
    },
    { decorations: (instance) => instance.decorations },
  );

  return [
    highlightConfig.init(() => env.config(doc)),
    EditorView.editorAttributes.compute([highlightConfig], (state) =>
      editorAttributesFor(state.field(highlightConfig)),
    ),
    highlightTheme,
    plugin,
  ];
}
