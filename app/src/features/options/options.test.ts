// The options feature under Node: every control and text of both dialogs as the model gives them,
// the Sim68K question, the presets table, the commands, and "Cancel restores everything" with two
// windows sharing one settings store (1.4 note 8, 3.8.6). The components are drawn and clicked by
// check-options.mjs in a browser.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TabType, type AppContext, type EditorSettings, type FeatureModule, type Settings } from '../../contracts';
import { COLOR1_STYLES, COLOR2_STYLES, DISABLED_STYLES, NO_COLOR_STYLES } from '../../core/highlight';
import { DEFAULT_EDITOR_SETTINGS } from '../../core/settings/defaults';
import { MemorySettingsStorage } from '../../core/settings/service';
import { createTestApplication, type TestApplication } from '../../state/testing';
import { applyEditorOptions, confirmAssemblerOptions, openOptionsHelp, saveTemplate } from './actions';
import { feature } from './index';
import {
  ASSEMBLER_OPTIONS,
  BACKGROUND_ITEM,
  FONT_SIZES,
  INITIAL_COLORS_UI,
  NO_ITEM,
  SWATCHES,
  applyAsmDraft,
  applyEditorDraft,
  asmValue,
  bucketSize,
  chooseFont,
  choosePreset,
  chooseTabSize,
  clickSwatch,
  documentPatch,
  fontItemFor,
  needsSim68KQuestion,
  openingDraft,
  recheckRequired,
  selectElement,
  shownSettings,
  sizeChoices,
  sizeFor,
  toggleAttribute,
  type ActiveDocument,
  type EditorDraft,
} from './model';
import {
  ASSEMBLER_OPTIONS_DIALOG_ID,
  EDITOR_OPTIONS_DIALOG_ID,
  ELEMENT_NAMES,
  OPTIONS_HELP_PAGE,
  PRESET_NAMES,
  PREVIEW_LINES,
  SIM68K_QUESTION,
  TRANSFER_DIALOG_ID,
} from './texts';

const live = (): EditorSettings => structuredClone(DEFAULT_EDITOR_SETTINGS) as EditorSettings;
const DOC: ActiveDocument = { id: 'd1', fontName: 'Courier New', fontSize: 11, tabType: TabType.Fixed, tabSize: 4 };

/** The dialog on top of the window's stack. */
function top(app: TestApplication) {
  const stack = app.ctx.store.getState().dialogs.stack;
  const dialog = stack[stack.length - 1];
  if (!dialog) throw new Error('no dialog is open');
  return dialog;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/* ================================================================ Assembler Options */

describe('Assembler Options: controls and texts (editor-ui §11.1)', () => {
  it('has the nine check boxes with the original captions, tool-tips (sic) and groups', () => {
    expect(ASSEMBLER_OPTIONS.map((o) => [o.group, o.caption, o.hint ?? null])).toEqual([
      ['assembler', 'Generate List File', 'Generates a list file upon assembly [RECOMMENDED]'],
      ['assembler', 'Auto Save Modified Source Before Assembling', 'If checked source will be saved before assembly'],
      ['assembler', 'Generate S-Record', 'Generate a S-Record file upon assembly  [RECOMENDED]'],
      ['assembler', 'Assemble Bit Field Instructions', null],
      ['assembler', 'Show Warnings', null],
      ['list', 'Cross Reference', 'Cross Reference list file'],
      ['list', 'Structured Expanded', 'Expand macros in list file'],
      ['list', 'Constants Expanded', 'Expand constants in list file'],
      ['list', 'Macros Expanded', 'Expand macros in list file'],
    ]);
  });

  it('defaults: List, S-Record, Warnings, Bit Field and Cross Reference checked, the others not', () => {
    const values = Object.fromEntries(ASSEMBLER_OPTIONS.map((o) => [o.caption, asmValue(live(), {}, o.key)]));
    expect(values).toEqual({
      'Generate List File': true,
      'Generate S-Record': true,
      'Show Warnings': true,
      'Auto Save Modified Source Before Assembling': false,
      'Assemble Bit Field Instructions': true,
      'Cross Reference': true,
      'Constants Expanded': false,
      'Structured Expanded': false,
      'Macros Expanded': false,
    });
  });

  it('the Sim68K question text, title, icon and buttons', () => {
    expect(SIM68K_QUESTION).toEqual({
      title: 'Information',
      text:
        'You have unchecked options that are required for use by the 68000 simulator Sim68K.  Without these ' +
        'options many features of Sim68K will be unavailable.  Do you wish to continue?',
      icon: 'information',
      buttons: ['Yes', 'No'],
    });
  });

  it('the question is asked when Generate S-Record or Generate List File is unchecked', () => {
    expect(needsSim68KQuestion(live(), {})).toBe(false);
    expect(needsSim68KQuestion(live(), { generateList: false })).toBe(true);
    expect(needsSim68KQuestion(live(), { generateSRecord: false })).toBe(true);
    expect(needsSim68KQuestion(live(), { showWarnings: false, crossReference: false })).toBe(false);
    expect(needsSim68KQuestion({ ...live(), generateList: false }, { generateList: true })).toBe(false);
    expect(recheckRequired({ generateList: false, generateSRecord: false, macrosExpanded: true })).toEqual({
      generateList: true,
      generateSRecord: true,
      macrosExpanded: true,
    });
  });
});

/* ================================================================ Editor Options: General */

describe('Editor Options, General tab (editor-ui §11.2)', () => {
  it('fonts and their sizes (editorOptions.cpp:211-255)', () => {
    expect(FONT_SIZES).toEqual({
      Courier: [10, 12, 15],
      'Courier New': [8, 9, 10, 11, 12, 14, 16, 18],
      Fixedsys: [9, 18],
    });
    expect(fontItemFor('Courier')).toBe('Courier');
    expect(fontItemFor('Fixedsys')).toBe('Fixedsys');
    expect(fontItemFor('Courier New')).toBe('Courier New');
    expect(fontItemFor('Lucida Console')).toBe('Courier New');
  });

  it("the size box shows the document's real size when the dialog opens (1.4 note 8)", () => {
    for (const size of [8, 9, 11, 14, 18]) {
      expect(openingDraft({ ...DOC, fontSize: size })).toEqual({ fontName: 'Courier New', fontSize: size });
    }
    expect(openingDraft({ ...DOC, fontName: 'Courier', fontSize: 13 })).toEqual({ fontName: 'Courier', fontSize: 13 });
    expect(sizeChoices('Courier', 13)).toEqual([10, 12, 13, 15]);
    expect(sizeChoices('Courier New', 11)).toEqual(FONT_SIZES['Courier New']);
  });

  it("choosing another font keeps the document's size where the font has it, else the original's bucket", () => {
    // The bucket of cbFontChange (editor-ui §11.2).
    expect([8, 11, 12, 14, 15, 18].map((s) => bucketSize('Courier New', s))).toEqual([10, 10, 12, 12, 16, 16]);
    expect([9, 14, 15, 18].map((s) => bucketSize('Fixedsys', s))).toEqual([9, 9, 18, 18]);
    expect([8, 11, 12, 14, 15].map((s) => bucketSize('Courier', s))).toEqual([10, 10, 12, 12, 15]);
    expect(sizeFor('Fixedsys', 11, false)).toBe(9);
    expect(sizeFor('Fixedsys', 18, false)).toBe(18);
    expect(sizeFor('Courier', 12, false)).toBe(12);
    expect(chooseFont({ fontName: 'Courier New', fontSize: 11 }, 'Courier', DOC)).toEqual({
      fontName: 'Courier',
      fontSize: 10,
    });
  });

  it('the tab size stays within 4..20; typed values in between are kept', () => {
    expect(chooseTabSize({}, 2).fixedTabSize).toBe(4);
    expect(chooseTabSize({}, 6).fixedTabSize).toBe(6);
    expect(chooseTabSize({}, 24).fixedTabSize).toBe(20);
  });

  it("OK gives the active document the boxes' font, size, tab type and size; the tab controls show the defaults", () => {
    const settings = { ...live(), tabType: TabType.Assembly, fixedTabSize: 8 };
    expect(documentPatch(settings, openingDraft(DOC))).toEqual({
      fontName: 'Courier New',
      fontSize: 11,
      tabType: TabType.Assembly,
      tabSize: 8,
    });
    expect(documentPatch(settings, { ...openingDraft(DOC), tabType: TabType.Fixed, fixedTabSize: 12 })).toEqual({
      fontName: 'Courier New',
      fontSize: 11,
      tabType: TabType.Fixed,
      tabSize: 12,
    });
  });
});

/* ================================================================ Editor Options: Colors */

describe('Editor Options, Colors tab (editor-ui §11.2)', () => {
  it('lists, presets, swatches and the preview text', () => {
    expect(ELEMENT_NAMES).toEqual([
      'Code',
      'Comment',
      'Directive',
      'Label',
      'Macro/Other',
      'Structured',
      'Structure Error',
      'Text',
      'Background',
    ]);
    expect(PRESET_NAMES).toEqual(['Color1', 'Color2', 'No Color', 'Custom', 'Disabled', 'Auto']);
    // editor-ui §11.2, the 4 x 4 grid, as #RRGGBB.
    const hex = (c: number) =>
      `#${[c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
    expect(SWATCHES.map((s) => `${s.name} ${hex(s.color)}`)).toEqual([
      'clBlack #000000',
      'clMaroon #800000',
      'clGreen #008000',
      'clOlive #808000',
      'clNavy #000080',
      'clPurple #800080',
      'clTeal #008080',
      'clGray #808080',
      'clMedGray #A0A0A4',
      'clRed #FF0000',
      'clLime #00FF00',
      'clYellow #FFFF00',
      'clBlue #0000FF',
      'clFuchsia #FF00FF',
      'clAqua #00FFFF',
      'clWhite #FFFFFF',
    ]);
    expect(PREVIEW_LINES.map((line) => line.map(([text]) => text).join(''))).toEqual([
      '* Syntax Highlight',
      'START   MOVE.B #1,D0',
      '        Macro/Other',
      '    if <NE> then',
      '    of <NE> tehn',
      "        DC.B 'HELLO'",
    ]);
    expect(
      PREVIEW_LINES.flatMap((line) => line.filter(([, e]) => e !== null).map(([, e]) => ELEMENT_NAMES[e!])),
    ).toEqual(['Comment', 'Label', 'Code', 'Macro/Other', 'Structured', 'Structure Error', 'Directive', 'Text']);
  });

  it('presets table: every preset sets all eight elements, never the background', () => {
    const start: EditorSettings = { ...live(), backgroundColor: 0x123456, colorPreset: 3 };
    const after = (preset: number) => shownSettings(start, choosePreset({}, preset).draft);
    expect(after(0).styles).toEqual(COLOR1_STYLES);
    expect(after(0).highlightDisabled).toBe(false);
    // Color2: Code black, Macro/Other clPurple, Directive clBlue, Comment clGreen, Label clNavy,
    // Structured clBlue, Structure Error clRed, Text clMaroon; no attributes.
    expect(after(1).styles).toEqual({
      code: { color: 0x000000, bold: false, italic: false, underline: false },
      unknown: { color: 0x800080, bold: false, italic: false, underline: false },
      directive: { color: 0xff0000, bold: false, italic: false, underline: false },
      comment: { color: 0x008000, bold: false, italic: false, underline: false },
      label: { color: 0x800000, bold: false, italic: false, underline: false },
      structure: { color: 0xff0000, bold: false, italic: false, underline: false },
      error: { color: 0x0000ff, bold: false, italic: false, underline: false },
      text: { color: 0x000080, bold: false, italic: false, underline: false },
    });
    expect(after(1).styles).toEqual(COLOR2_STYLES);
    // No Color: all black; Macro/Other italic + underline; Directive bold; Comment italic; Label
    // bold; Structured bold; Structure Error underline; Code and Text plain.
    const mono = after(2).styles;
    expect(Object.values(mono).every((s) => s.color === 0)).toBe(true);
    expect(mono.unknown).toMatchObject({ bold: false, italic: true, underline: true });
    expect(mono.directive).toMatchObject({ bold: true, italic: false, underline: false });
    expect(mono.comment).toMatchObject({ bold: false, italic: true, underline: false });
    expect(mono.label).toMatchObject({ bold: true, italic: false, underline: false });
    expect(mono.structure).toMatchObject({ bold: true, italic: false, underline: false });
    expect(mono.error).toMatchObject({ bold: false, italic: false, underline: true });
    expect(mono.code).toMatchObject({ bold: false, italic: false, underline: false });
    expect(mono.text).toMatchObject({ bold: false, italic: false, underline: false });
    expect(mono).toEqual(NO_COLOR_STYLES);
    // Disabled: all black, no attributes, highlighting off.
    expect(after(4).styles).toEqual(DISABLED_STYLES);
    expect(after(4).highlightDisabled).toBe(true);
    // Auto (the port's): stores the Color1 values.
    expect(after(5).styles).toEqual(COLOR1_STYLES);
    expect(after(5).colorPreset).toBe(5);
    for (const preset of [0, 1, 2, 3, 4, 5]) {
      expect(after(preset).backgroundColor).toBe(0x123456);
      expect(after(preset).colorPreset).toBe(preset);
    }
  });

  it('a preset deselects the element and clears the boxes; Custom changes nothing else, not even highlighting', () => {
    const disabled: EditorSettings = { ...live(), highlightDisabled: true, colorPreset: 4 };
    const custom = choosePreset({}, 3);
    expect(custom.ui).toEqual(INITIAL_COLORS_UI);
    expect(custom.draft).toEqual({ colorPreset: 3 });
    expect(shownSettings(disabled, custom.draft).highlightDisabled).toBe(true);
    expect(choosePreset({}, 0).ui).toEqual({ element: NO_ITEM, bold: false, italic: false, underline: false });
  });

  it('selecting an element loads its attributes; Background leaves the boxes as they are', () => {
    const shown = shownSettings(live(), choosePreset({}, 2).draft);
    expect(selectElement(INITIAL_COLORS_UI, shown, 4)).toEqual({
      element: 4,
      bold: false,
      italic: true,
      underline: true,
    });
    const ui = { element: 1, bold: true, italic: false, underline: true };
    expect(selectElement(ui, shown, BACKGROUND_ITEM)).toEqual({ ...ui, element: BACKGROUND_ITEM });
  });

  it('a swatch colours the selected element or the background, and switches the preset to Custom', () => {
    const start: EditorSettings = { ...live(), colorPreset: 4, highlightDisabled: true };
    const red = 0x0000ff;
    const onComment = clickSwatch({}, { ...INITIAL_COLORS_UI, element: 1 }, start, red);
    expect(shownSettings(start, onComment).styles.comment).toEqual({ ...start.styles.comment, color: red });
    expect(onComment.colorPreset).toBe(3);
    expect(onComment.highlightDisabled).toBe(false);
    const onBackground = clickSwatch({}, { ...INITIAL_COLORS_UI, element: BACKGROUND_ITEM }, start, red);
    expect(onBackground.backgroundColor).toBe(red);
    expect(onBackground.styles).toBeUndefined();
    const onNothing = clickSwatch({}, INITIAL_COLORS_UI, start, red);
    expect(onNothing).toEqual({ colorPreset: 3, highlightDisabled: false });
  });

  it('Bold, Italic and Underline set the three attributes of the selected element and switch to Custom', () => {
    const start = live();
    const ui = selectElement(INITIAL_COLORS_UI, start, 3);
    const step = toggleAttribute({}, ui, start, 'bold', true);
    expect(step.ui).toEqual({ element: 3, bold: true, italic: false, underline: false });
    expect(shownSettings(start, step.draft).styles.label).toEqual({ ...start.styles.label, bold: true });
    expect(step.draft.colorPreset).toBe(3);
    // On the background or on nothing: the box changes, no style does, the preset becomes Custom.
    const none = toggleAttribute({}, INITIAL_COLORS_UI, start, 'italic', true);
    expect(none.draft).toEqual({ colorPreset: 3, highlightDisabled: false });
    expect(none.ui.italic).toBe(true);
  });
});

/* ================================================================ the feature in an application */

/** A stand-in for H1's help command: records the pages it is asked for. */
function helpRecorder(): { feature: FeatureModule; pages: unknown[] } {
  const pages: unknown[] = [];
  return {
    pages,
    feature: { id: 'help-recorder', commands: { 'ed.help.help': { run: (_ctx, page) => void pages.push(page) } } },
  };
}

function application(storage = new MemorySettingsStorage(), extra: FeatureModule[] = []) {
  return createTestApplication({ features: [feature, ...extra], storage });
}

describe('the commands', () => {
  it('Editor Options is enabled while a document is open (state E)', () => {
    const app = application();
    const enabled = feature.commands!['ed.options.editor']!.enabled!;
    const state = app.ctx.store.getState();
    expect(enabled(state, app.ctx)).toBe(true);
    expect(enabled({ ...state, documents: { items: [], activeId: null } }, app.ctx)).toBe(false);
  });

  it('Assembler Options opens the modeless dialog once; asked again while open, it opens no second one', async () => {
    const app = application();
    void app.ctx.commands.run('ed.options.assembler');
    expect(top(app)).toMatchObject({ id: ASSEMBLER_OPTIONS_DIALOG_ID, modal: false });
    void app.ctx.commands.run('ed.options.assembler');
    await tick();
    expect(app.ctx.store.getState().dialogs.stack.filter((d) => d.id === ASSEMBLER_OPTIONS_DIALOG_ID)).toHaveLength(1);
    expect(app.dialogs.isModalOpen()).toBe(false);
  });

  it('Import/Export Settings opens the modal settings.transfer from either mode', async () => {
    const app = application();
    void app.ctx.commands.run('ed.options.transfer');
    expect(top(app)).toMatchObject({ id: TRANSFER_DIALOG_ID, modal: true });
    app.dialogs.close(top(app).key, undefined);
    await app.ctx.commands.run('app.mode.set', 'simulator');
    void app.ctx.commands.run('sim.options.transfer');
    expect(top(app)).toMatchObject({ id: TRANSFER_DIALOG_ID, modal: true });
  });

  it('F1 and Help open options.htm, also while the modal dialog is open', async () => {
    const help = helpRecorder();
    const app = application(undefined, [help.feature]);
    void app.ctx.commands.run('ed.options.editor');
    expect(app.dialogs.isModalOpen()).toBe(true);
    openOptionsHelp(app.ctx);
    await tick();
    expect(help.pages).toEqual([OPTIONS_HELP_PAGE]);
    expect(OPTIONS_HELP_PAGE).toBe('options.htm');
  });

  it('Editor Options passes the active document; OK writes the draft and the document, not Modified', async () => {
    const app = application();
    const running = app.ctx.commands.run('ed.options.editor');
    const dialog = top(app);
    expect(dialog).toMatchObject({ id: EDITOR_OPTIONS_DIALOG_ID, modal: true });
    const props = dialog.props as { document: ActiveDocument };
    expect(props.document).toEqual({
      id: 'stub-1',
      fontName: 'Courier New',
      fontSize: 10,
      tabType: TabType.Fixed,
      tabSize: 4,
    });
    const draft: EditorDraft = {
      ...openingDraft(props.document),
      fontName: 'Fixedsys',
      fontSize: 18,
      fixedTabSize: 8,
      realTabs: true,
    };
    app.dialogs.close(dialog.key, draft);
    await running;
    const editor = app.ctx.settings.get().editor;
    expect([editor.fontName, editor.fontSize, editor.fixedTabSize, editor.realTabs]).toEqual(['Fixedsys', 18, 8, true]);
    const doc = app.ctx.documents.active()!;
    expect([doc.fontName, doc.fontSize, doc.tabSize, doc.tabType, doc.modified]).toEqual([
      'Fixedsys',
      18,
      8,
      TabType.Fixed,
      false,
    ]);
  });
});

describe('Cancel restores everything (1.4 note 8), with another window writing meanwhile', () => {
  const snapshot = (ctx: AppContext) => structuredClone(ctx.settings.get());
  const withoutLayout = (settings: Settings) => ({ ...settings, app: { ...settings.app, layout: null } });

  it("Editor Options: Cancel writes nothing; the other window's change made while it was open stays", async () => {
    const storage = new MemorySettingsStorage();
    const a = application(storage);
    const b = application(storage);
    const before = snapshot(a.ctx);
    const running = a.ctx.commands.run('ed.options.editor');
    // In A the user changes everything there is to change (the dialog keeps it in its draft) ...
    const props = top(a).props as { document: ActiveDocument };
    let draft: EditorDraft = {
      ...openingDraft(props.document),
      fontName: 'Courier',
      fontSize: 15,
      tabType: TabType.Assembly,
    };
    draft = { ...draft, autoIndent: false, realTabs: true, fixedTabSize: 12 };
    draft = choosePreset(draft, 1).draft;
    draft = clickSwatch(
      draft,
      { ...INITIAL_COLORS_UI, element: BACKGROUND_ITEM },
      shownSettings(before.editor, draft),
      0xc0c0c0,
    );
    expect(Object.keys(draft).length).toBeGreaterThan(5);
    // ... while B changes two settings, one of which A's dialog also shows.
    b.ctx.settings.update((s) => ({ ...s, editor: { ...s.editor, showWarnings: false, highlightDisabled: true } }));
    expect(a.ctx.settings.get().editor.highlightDisabled).toBe(true);
    // Cancel.
    a.dialogs.close(top(a).key, null);
    await running;
    const expected = { ...before, editor: { ...before.editor, showWarnings: false, highlightDisabled: true } };
    expect(withoutLayout(a.ctx.settings.get())).toEqual(withoutLayout(expected));
    expect(withoutLayout(b.ctx.settings.get())).toEqual(withoutLayout(expected));
    const doc = a.ctx.documents.active()!;
    expect([doc.fontName, doc.fontSize, doc.tabType]).toEqual(['Courier New', 10, TabType.Fixed]);
  });

  it("Editor Options: OK writes only what the user changed; the other window's other change survives", async () => {
    const storage = new MemorySettingsStorage();
    const a = application(storage);
    const b = application(storage);
    const running = a.ctx.commands.run('ed.options.editor');
    const props = top(a).props as { document: ActiveDocument };
    const draft: EditorDraft = { ...openingDraft(props.document), realTabs: true };
    b.ctx.settings.update((s) => ({ ...s, editor: { ...s.editor, autoIndent: false, fixedTabSize: 16 } }));
    a.dialogs.close(top(a).key, draft);
    await running;
    for (const app of [a, b]) {
      const editor = app.ctx.settings.get().editor;
      expect([editor.realTabs, editor.autoIndent, editor.fixedTabSize]).toEqual([true, false, 16]);
    }
    // The tab controls followed B's change, so the document took 16 too.
    expect(a.ctx.documents.active()!.tabSize).toBe(16);
  });

  it('Assembler Options: Cancel writes nothing, OK only the touched boxes', async () => {
    const storage = new MemorySettingsStorage();
    const a = application(storage);
    const b = application(storage);
    const before = snapshot(a.ctx);
    // Cancel: the dialog closes with its draft unused.
    void a.ctx.commands.run('ed.options.assembler');
    b.ctx.settings.update((s) => ({ ...s, editor: { ...s.editor, crossReference: false } }));
    a.dialogs.close(top(a).key, undefined);
    expect(withoutLayout(a.ctx.settings.get())).toEqual(
      withoutLayout({ ...before, editor: { ...before.editor, crossReference: false } }),
    );
    // OK with one box touched, after B changed another.
    b.ctx.settings.update((s) => ({ ...s, editor: { ...s.editor, showWarnings: false } }));
    const result = await confirmAssemblerOptions(a.ctx, { macrosExpanded: true });
    expect(result).toEqual({ close: true });
    for (const app of [a, b]) {
      const editor = app.ctx.settings.get().editor;
      expect([editor.macrosExpanded, editor.showWarnings, editor.crossReference]).toEqual([true, false, false]);
    }
  });

  it('applyEditorOptions on a document that has gone writes the settings only', () => {
    const app = application();
    applyEditorOptions(app.ctx, 'no-such-document', { realTabs: true, fontName: 'Courier', fontSize: 12 });
    expect(app.ctx.settings.get().editor.realTabs).toBe(true);
    expect(app.ctx.documents.active()!.fontName).toBe('Courier New');
  });
});

describe('Assembler Options OK and the Sim68K question', () => {
  it('No re-checks both boxes and keeps the dialog open; nothing is written', async () => {
    const app = application();
    const asking = confirmAssemblerOptions(app.ctx, { generateList: false, showWarnings: false });
    const box = top(app);
    expect(box.id).toBe('message');
    expect(box.props).toEqual(SIM68K_QUESTION);
    app.dialogs.close(box.key, 'No');
    expect(await asking).toEqual({
      close: false,
      draft: { generateList: true, generateSRecord: true, showWarnings: false },
    });
    expect(app.ctx.settings.get().editor.showWarnings).toBe(true);
  });

  it('Yes writes every box of the draft and closes', async () => {
    const app = application();
    const asking = confirmAssemblerOptions(app.ctx, { generateSRecord: false, constantsExpanded: true });
    app.dialogs.close(top(app).key, 'Yes');
    expect(await asking).toEqual({ close: true });
    const editor = app.ctx.settings.get().editor;
    expect([editor.generateSRecord, editor.constantsExpanded, editor.generateList]).toEqual([false, true, true]);
  });

  it('Escape on the question counts as No', async () => {
    const app = application();
    const asking = confirmAssemblerOptions(app.ctx, { generateSRecord: false });
    app.dialogs.close(top(app).key, 'Cancel');
    expect((await asking).close).toBe(false);
    expect(app.ctx.settings.get().editor.generateSRecord).toBe(true);
  });

  it('Save Template writes the template at once, whatever OK or Cancel do', () => {
    const app = application();
    saveTemplate(app.ctx, '* mine\n');
    expect(app.ctx.settings.get().editor.template).toBe('* mine\n');
  });

  it('applyAsmDraft and applyEditorDraft leave every other setting alone', () => {
    const settings = { editor: live() };
    expect(applyAsmDraft(settings, {}).editor).toEqual(settings.editor);
    expect(applyEditorDraft(settings, {}).editor).toEqual(settings.editor);
    expect(applyEditorDraft(settings, { fixedTabSize: 99 }).editor.fixedTabSize).toBe(20);
  });
});

describe('the template box and the shipped template', () => {
  it('Save Template text with CR LF on disk equals the shipped template.NEW (editor-ui §12.2)', () => {
    const shipped = readFileSync(
      fileURLToPath(new URL('../../core/settings/dat-codec/fixtures/shipped-template.NEW', import.meta.url)),
      'latin1',
    );
    expect(DEFAULT_EDITOR_SETTINGS.template.replaceAll('\n', '\r\n')).toBe(shipped);
  });
});
