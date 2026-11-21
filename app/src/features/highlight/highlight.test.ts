// The CodeMirror side of the highlighter under Node: preset resolution, decorations, the view's
// configuration, the feature's registration, and the speed of a viewport pass. Owner: E3.

import { EditorState, Text, type Extension } from '@codemirror/state';
import { EditorView, type DecorationSet } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { TabType, type DocumentState, type EditorSettings, type SyntaxElement } from '../../contracts';
import {
  AUTO_DARK,
  AUTO_LIGHT,
  COLOR1_STYLES,
  COLOR2_STYLES,
  DISABLED_STYLES,
  highlightLine,
  NO_COLOR_STYLES,
  presetStyles,
  SYNTAX_ELEMENTS,
} from '../../core/highlight';
import { DEFAULT_EDITOR_SETTINGS } from '../../core/settings/defaults';
import { editorExtensionSources } from '../../state/editor-extensions';
import { createTestApplication } from '../../state/testing';
import { listColorsStyle, resolveSyntaxColors, storedColorsStyle, syntaxClass } from './colors';
import { buildHighlightDecorations } from './decorations';
import {
  configFrom,
  createHighlightEnvironment,
  decorationsFor,
  editorAttributesFor,
  highlightConfig,
  highlightExtension,
  type HighlightConfig,
  type HighlightEnvironment,
} from './extension';
import { feature } from './index';
import { measureBest } from './timing';

const editor = (patch: Partial<EditorSettings> = {}): EditorSettings => ({ ...DEFAULT_EDITOR_SETTINGS, ...patch });

/** EditorSettings after choosing a preset in the Options dialog (E4 applies presetStyles). */
function withPreset(preset: 0 | 1 | 2 | 4 | 5, background = 0xffffff): EditorSettings {
  const chosen = presetStyles(preset)!;
  return editor({
    colorPreset: preset,
    styles: chosen.styles,
    highlightDisabled: chosen.highlightDisabled,
    backgroundColor: background,
  });
}

const docState = (kind: DocumentState['kind'], id = 'd1'): DocumentState => ({
  id,
  path: null,
  name: kind === 'source' ? 'untitled1.x68' : 'prog.L68',
  kind,
  hasName: false,
  tabType: TabType.Fixed,
  tabSize: 4,
  fontName: 'Courier New',
  fontSize: 10,
  insertMode: true,
  modified: false,
  revision: 0,
});

/** The marks of a decoration set as [from, to, class]. */
function marks(set: DecorationSet): [number, number, string][] {
  const out: [number, number, string][] = [];
  const cursor = set.iter();
  while (cursor.value) {
    out.push([cursor.from, cursor.to, String(cursor.value.spec.class)]);
    cursor.next();
  }
  return out;
}

describe('preset resolution (ARCHITECTURE.md 2.8)', () => {
  it('Auto follows the theme and ignores the stored styles', () => {
    const settings = editor({ colorPreset: 5, styles: NO_COLOR_STYLES, backgroundColor: 0x000000 });
    expect(resolveSyntaxColors(settings, 'light')).toEqual({
      auto: true,
      disabled: false,
      styles: AUTO_LIGHT.styles,
      background: AUTO_LIGHT.background,
    });
    expect(resolveSyntaxColors(settings, 'dark')).toEqual({
      auto: true,
      disabled: false,
      styles: AUTO_DARK.styles,
      background: AUTO_DARK.background,
    });
    expect(storedColorsStyle(settings)).toBeNull();
  });

  it.each([
    ['Color1', 0, COLOR1_STYLES],
    ['Color2', 1, COLOR2_STYLES],
    ['No Color', 2, NO_COLOR_STYLES],
    ['Disabled', 4, DISABLED_STYLES],
  ] as const)('%s: the stored styles and background, unchanged in both themes', (_name, preset, styles) => {
    const settings = withPreset(preset, 0x00ffff); // a yellow background stays yellow
    for (const theme of ['light', 'dark'] as const) {
      const resolved = resolveSyntaxColors(settings, theme);
      expect(resolved.auto).toBe(false);
      expect(resolved.styles).toEqual(styles);
      expect(resolved.background).toBe(0x00ffff);
      expect(resolved.disabled).toBe(preset === 4);
    }
  });

  it('Custom: any colour and attributes per element, as stored', () => {
    const custom = {
      ...COLOR1_STYLES,
      label: { color: 0x0000ff, bold: true, italic: true, underline: true },
      code: { color: 0x808080, bold: false, italic: false, underline: true },
    };
    const settings = editor({ colorPreset: 3, styles: custom, backgroundColor: 0xc0c0c0 });
    expect(resolveSyntaxColors(settings, 'dark').styles).toEqual(custom);
    const style = storedColorsStyle(settings)!;
    expect(style).toContain('--e68-syntax-label: #FF0000');
    expect(style).toContain('--e68-syntax-label-weight: bold');
    expect(style).toContain('--e68-syntax-label-style: italic');
    expect(style).toContain('--e68-syntax-label-decoration: underline');
    expect(style).toContain('--e68-syntax-code: #808080');
    expect(style).toContain('--e68-syntax-code-decoration: underline');
    expect(style).toContain('--e68-syntax-comment-weight: normal');
    expect(style).toContain('--e68-syntax-background: #C0C0C0');
  });

  it('"none selected" (-1, as in a shipped settings.dat) uses the stored styles too', () => {
    expect(resolveSyntaxColors(editor({ colorPreset: -1, styles: COLOR2_STYLES }), 'dark').styles).toEqual(
      COLOR2_STYLES,
    );
  });
});

describe('the editor element', () => {
  it('a list document under Auto gets neither classes nor colours', () => {
    expect(editorAttributesFor(configFrom(editor(), 'list'))).toEqual({});
    expect(editorAttributesFor(configFrom(editor({ backgroundColor: 0x00ffff }), 'list'))).toEqual({});
  });

  it('a list document under a stored preset takes the stored background and black text, nothing else', () => {
    // textS.cpp:78: every window, list windows included, takes backColor; their text stays black.
    for (const preset of [0, 1, 2, 4] as const) {
      const attributes = editorAttributesFor(configFrom(withPreset(preset, 0x00ffff), 'list'));
      expect(attributes).toEqual({
        class: 'e68-syntax e68-syntax--list',
        style: '--e68-syntax-code: #000000; --e68-syntax-background: #FFFF00',
      });
      expect(listColorsStyle(withPreset(preset, 0x00ffff))).toBe(attributes.style);
    }
    const custom = editor({
      colorPreset: 3,
      styles: { ...COLOR1_STYLES, code: { ...COLOR1_STYLES.code, color: 0xff } },
    });
    expect(editorAttributesFor(configFrom(custom, 'list')).style).toContain('--e68-syntax-code: #000000');
    expect(
      decorationsFor(configFrom(withPreset(1), 'list'), Text.of(SAMPLE.split('\n')), [{ from: 0, to: 10 }]).size,
    ).toBe(0);
  });

  it('a source document gets the class, and the stored colours unless the preset is Auto', () => {
    expect(editorAttributesFor(configFrom(editor(), 'source'))).toEqual({ class: 'e68-syntax' });
    const stored = editorAttributesFor(configFrom(withPreset(1), 'source'));
    expect(stored.class).toBe('e68-syntax');
    expect(stored.style).toBe(storedColorsStyle(withPreset(1)));
    expect(editorAttributesFor(configFrom(withPreset(4), 'source')).class).toBe('e68-syntax e68-syntax--disabled');
  });
});

const SAMPLE = [
  '* Syntax Highlight',
  'START   MOVE.B #1,D0',
  '        Macro/Other',
  '    if <NE> then',
  '    if <NE> tehn',
  "        DC.B 'HELLO'",
  '',
  '    BFTST (A0){0:8}',
].join('\n');

describe('decorations', () => {
  const doc = Text.of(SAMPLE.split('\n'));
  const all = [{ from: 0, to: doc.length }];

  it('every character of a highlighted line has a mark of its element', () => {
    const expected: [number, number, string][] = [];
    for (let n = 1; n <= doc.lines; n++) {
      const line = doc.line(n);
      for (const span of highlightLine(line.text, { bitField: true })) {
        expected.push([line.from + span.from, line.from + span.to, syntaxClass(span.style)]);
      }
    }
    expect(marks(buildHighlightDecorations(doc, all, { bitField: true }))).toEqual(expected);
    // The preview text of the Options dialog shows each element once (editor-ui Â§11.2).
    const classes = new Set(marks(buildHighlightDecorations(doc, all, { bitField: true })).map((m) => m[2]));
    expect([...classes].sort()).toEqual(SYNTAX_ELEMENTS.map((e) => syntaxClass(e)).sort());
  });

  it('the bit-field option changes the colouring', () => {
    const line = doc.line(8);
    const of = (bitField: boolean) =>
      marks(buildHighlightDecorations(doc, [{ from: line.from, to: line.to }], { bitField }));
    expect(of(true).map((m) => m[2])).toEqual(['e68-syntax__code']);
    expect(of(false).map((m) => m[2])).toEqual(['e68-syntax__code', 'e68-syntax__unknown']);
  });

  it('only lines that touch the ranges are decorated; a line shared by two ranges once', () => {
    const second = doc.line(2);
    const fourth = doc.line(4);
    const result = marks(
      buildHighlightDecorations(
        doc,
        [
          { from: second.from + 2, to: second.from + 5 },
          { from: second.from + 7, to: fourth.from },
        ],
        { bitField: true },
      ),
    );
    expect(result[0]![0]).toBe(second.from);
    expect(result.at(-1)![1]).toBe(fourth.to);
    expect(result.every(([from]) => from >= second.from && from < fourth.to)).toBe(true);
  });

  it('list documents and disabled highlighting get no decorations', () => {
    const source: HighlightConfig = { source: true, disabled: false, bitField: true, colors: null };
    expect(decorationsFor(source, doc, all).size).toBeGreaterThan(0);
    expect(decorationsFor({ ...source, source: false }, doc, all).size).toBe(0);
    expect(decorationsFor({ ...source, disabled: true }, doc, all).size).toBe(0);
  });
});

/** A test environment whose configuration the test sets. */
function fakeEnvironment(initial: HighlightConfig): HighlightEnvironment & { set(config: HighlightConfig): void } {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    config: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(config) {
      current = config;
      for (const listener of listeners) listener();
    },
  };
}

describe('the extension in an editor state', () => {
  const stateWith = (extension: Extension) => EditorState.create({ doc: SAMPLE, extensions: extension });

  it('starts with the configuration of its document', () => {
    const env = fakeEnvironment(configFrom(withPreset(2), 'source'));
    const state = stateWith(highlightExtension(env, docState('source')));
    expect(state.field(highlightConfig)).toEqual(configFrom(withPreset(2), 'source'));
    const attributes = state.facet(EditorView.editorAttributes);
    expect(attributes).toContainEqual(editorAttributesFor(configFrom(withPreset(2), 'source')));
  });

  it('a list document: no classes, no colours', () => {
    const env = fakeEnvironment(configFrom(editor(), 'list'));
    const state = stateWith(highlightExtension(env, docState('list')));
    expect(state.field(highlightConfig).source).toBe(false);
    expect(state.facet(EditorView.editorAttributes).filter((a) => Object.keys(a).length > 0)).toEqual([]);
  });
});

describe('the feature', () => {
  it('registers one editor-extension source whose configuration follows the settings and the store', () => {
    const app = createTestApplication({ features: [feature] });
    try {
      const sources = editorExtensionSources(app.ctx);
      expect(sources).toHaveLength(1);
      const source = docState('source', 'doc-a');
      const state = EditorState.create({ doc: SAMPLE, extensions: sources[0]!(source) as Extension });
      expect(state.field(highlightConfig)).toEqual(configFrom(app.ctx.settings.get().editor, 'source'));

      const env = createHighlightEnvironment(app.ctx);
      let calls = 0;
      const off = env.subscribe(() => calls++);
      app.ctx.settings.update((s) => ({ ...s, editor: { ...s.editor, assembleBitField: false } }));
      expect(calls).toBeGreaterThan(0);
      expect(env.config(source).bitField).toBe(false);

      // The kind is read live from the store: a document that becomes a list document is not highlighted.
      app.ctx.store.setState((s) => ({
        ...s,
        documents: { items: [{ ...source, kind: 'list' }], activeId: source.id },
      }));
      expect(env.config(source).source).toBe(false);
      off();
    } finally {
      app.dispose();
    }
  });
});

/** The acceptance figure (ARCHITECTURE.md 9.2 E3) and the limit this unit test enforces. */
const VIEWPORT_TARGET_MS = 5;
const VIEWPORT_REGRESSION_MS = 50;

describe('measureBest', () => {
  it('stops at the first batch whose best run meets the target', () => {
    let calls = 0;
    const times = [9, 8, 7, 1];
    let t = 0;
    const clock = () => t;
    const result = measureBest(
      () => {
        t += times[Math.min(calls, times.length - 1)]!;
        calls++;
      },
      { target: 5, batch: 2, maxBatches: 5, budgetMs: 1e9, now: clock },
    );
    expect(result).toEqual({ best: 1, runs: 4 });
  });

  it('gives up after maxBatches or the time budget and reports the best it saw', () => {
    let t = 0;
    const slow = measureBest(() => (t += 20), { target: 5, batch: 3, maxBatches: 4, budgetMs: 1e9, now: () => t });
    expect(slow).toEqual({ best: 20, runs: 12 });
    t = 0;
    const budget = measureBest(() => (t += 20), { target: 5, batch: 3, maxBatches: 100, budgetMs: 100, now: () => t });
    expect(budget.runs).toBe(6); // two batches of 60 ms each exceed the 100 ms budget
  });
});

describe('speed (acceptance: a 10,000-line document highlights its viewport in under 5 ms)', () => {
  it('a viewport of 300 lines in a 10,000-line document', () => {
    const block = [
      '* Syntax Highlight',
      'START:  ORG    $1000   set origin',
      "    MOVE.B  #'A',D0     load char",
      'LOOP    DBRA    D0,LOOP',
      '    PRINT   msg     macro call',
      '    IF.B D0 <EQ> #1 THEN.S    do it',
      "MSG     DC.B    'Hello',0     text",
      '    MOVE.L  (A0,D1',
      '    FOR D1 = #1 TO #10 BY #2 DO',
      '    MEMORY  ROM $001000,$002000   my rom',
    ];
    const lines = Array.from({ length: 10_000 }, (_, i) => block[i % block.length]!);
    const doc = Text.of(lines);
    const first = doc.line(5_000).from;
    const viewport = [{ from: first, to: doc.line(5_299).to }];
    const set = buildHighlightDecorations(doc, viewport, { bitField: true });
    expect(set.size).toBeGreaterThan(300);
    const timing = measureBest(() => buildHighlightDecorations(doc, viewport, { bitField: true }), {
      target: VIEWPORT_TARGET_MS,
    });
    console.log(
      `viewport of 300 lines: best ${timing.best.toFixed(3)} ms of ${timing.runs} runs` +
        (timing.best < VIEWPORT_TARGET_MS ? '' : ` (the ${VIEWPORT_TARGET_MS} ms target was missed: machine loaded?)`),
    );
    // The 5 ms acceptance figure is checked strictly in the browser (check-highlight.mjs). Here, on a
    // machine shared with other test runs, only a regression by an order of magnitude fails.
    expect(timing.best).toBeLessThan(VIEWPORT_REGRESSION_MS);

    // For information: every line of the document.
    const whole = performance.now();
    buildHighlightDecorations(doc, [{ from: 0, to: doc.length }], { bitField: true });
    console.log(`whole document (10,000 lines): ${(performance.now() - whole).toFixed(1)} ms`);
  }, 60_000);
});

// Every element of the dialog appears in the presets' records.
it('the presets cover the eight elements', () => {
  const keys = (record: Record<SyntaxElement, unknown>) => Object.keys(record).sort();
  for (const styles of [COLOR1_STYLES, COLOR2_STYLES, NO_COLOR_STYLES, DISABLED_STYLES]) {
    expect(keys(styles)).toEqual([...SYNTAX_ELEMENTS].sort());
  }
});
