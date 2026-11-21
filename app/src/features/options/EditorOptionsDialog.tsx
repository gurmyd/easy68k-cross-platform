// Options > Editor Options... (dialog id `options.editor`; editor-ui §11.2, editorOptions.dfm,
// editorOptions.cpp). A modal dialog `EASy68K Editor Options` with the tabs `General` and
// `Colors` (the tab shown last time is shown again; the first time `Colors`) and the buttons
// `&OK` (default), `&Cancel`, `&Help`.
//
// The dialog resolves to the draft on OK and to null on Cancel, Escape or the close button; the
// command writes the draft (actions.ts). What the controls show and what each control does is
// model.ts. F1 and Help open options.htm above the dialog (1.4 note 8).
//
// Owner: E4.

import { useEffect, useId, useRef, useState } from 'react';
import type { DialogProps as FeatureDialogProps } from '../../contracts';
import { TabType, type EditorSettings } from '../../contracts';
import { AUTO_DARK, AUTO_LIGHT, COLOR_PRESET, SYNTAX_ELEMENTS, colorRefToHex } from '../../core/highlight';
import { useAppContext, useAppState } from '../../state/context';
import {
  Button,
  Caption,
  Checkbox,
  Dialog,
  ListBox,
  RadioGroup,
  Select,
  SpinField,
  TabPanel,
  Tabs,
} from '../../ui/components';
import { openOptionsHelp, optionsStateOf } from './actions';
import {
  EDITOR_FONTS,
  INITIAL_COLORS_UI,
  SWATCHES,
  chooseFont,
  choosePreset,
  chooseTabSize,
  clickSwatch,
  cssFontFamily,
  fontItemFor,
  isHelpKey,
  openingDraft,
  selectElement,
  shownSettings,
  sizeChoices,
  tabTypeName,
  toggleAttribute,
  type ColorsUi,
  type EditorDraft,
  type EditorFont,
  type EditorOptionsProps,
} from './model';
import {
  ASSEMBLY_TABS_CAPTION,
  AUTO_INDENT_CAPTION,
  BOLD_CAPTION,
  COLORS_TAB_CAPTION,
  COLOR_GROUP_CAPTION,
  COLOR_PRESETS_CAPTION,
  CURRENT_FILE_GROUP_CAPTION,
  CURRENT_FONT_CAPTION,
  CURRENT_FONT_SIZE_CAPTION,
  CURRENT_TAB_SIZE_CAPTION,
  CURRENT_TAB_TYPE_CAPTION,
  EDITOR_CANCEL_CAPTION,
  EDITOR_HELP_CAPTION,
  EDITOR_OK_CAPTION,
  EDITOR_OPTIONS_TITLE,
  ELEMENT_CAPTION,
  ELEMENT_NAMES,
  ENVIRONMENT_GROUP_CAPTION,
  FIXED_TABS_CAPTION,
  FIXED_TAB_SIZE_CAPTION,
  GENERAL_TAB_CAPTION,
  ITALIC_CAPTION,
  NEW_FILE_GROUP_CAPTION,
  NEW_FONT_CAPTION,
  NEW_FONT_SIZE_CAPTION,
  PRESET_NAMES,
  PREVIEW_CAPTION,
  PREVIEW_LINES,
  PRINT_BLACK_CAPTION,
  REAL_TABS_CAPTION,
  TEXT_ATTRIBUTES_GROUP_CAPTION,
  UNDERLINE_CAPTION,
} from './texts';
import './options.css';

type EditorTab = 'general' | 'colors';

/** The colours the preview draws: the shown styles, or under Auto the palette of the theme (2.8). */
function previewPalette(shown: EditorSettings) {
  if (shown.colorPreset !== COLOR_PRESET.auto) return { styles: shown.styles, background: shown.backgroundColor };
  const dark = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark';
  return dark ? AUTO_DARK : AUTO_LIGHT;
}

export function EditorOptionsDialog({ props, close }: FeatureDialogProps<EditorOptionsProps, EditorDraft | null>) {
  const ctx = useAppContext();
  const live = useAppState((state) => state.settings.editor);
  const document = props.document;
  const [draft, setDraft] = useState<EditorDraft>(() => openingDraft(document));
  const [ui, setUi] = useState<ColorsUi>(INITIAL_COLORS_UI);
  const [tab, setTabState] = useState<EditorTab>(() => optionsStateOf(ctx).editorTab);
  const idBase = useId();
  const elementLabel = useId();
  const elementList = useRef<HTMLDivElement>(null);
  const shown = shownSettings(live, draft);

  const setTab = (next: EditorTab) => {
    optionsStateOf(ctx).editorTab = next;
    setTabState(next);
  };

  // `&Element` focuses the list (FocusControl = Element): the kit's access keys find the element
  // that carries data-e68-mnemonic, which the ListBox does not set itself.
  useEffect(() => {
    elementList.current?.querySelector('[role=listbox]')?.setAttribute('data-e68-mnemonic', 'e');
  }, [tab]);

  const font = fontItemFor(shown.fontName);
  const palette = previewPalette(shown);

  const general = (
    <div className="e68-options__general">
      <fieldset className="e68-options__group">
        <legend>{NEW_FILE_GROUP_CAPTION}</legend>
        <div className="e68-options__stack">
          <Select
            label={NEW_FONT_CAPTION}
            options={EDITOR_FONTS.map((name) => ({ value: name, label: name }))}
            value={font}
            onChange={(value) => setDraft((current) => chooseFont(current, value as EditorFont, document))}
          />
          <Select
            label={NEW_FONT_SIZE_CAPTION}
            options={sizeChoices(font, shown.fontSize).map((size) => ({ value: String(size), label: String(size) }))}
            value={String(shown.fontSize)}
            onChange={(value) => setDraft((current) => ({ ...current, fontSize: Number(value) }))}
          />
          <SpinField
            label={FIXED_TAB_SIZE_CAPTION}
            value={shown.fixedTabSize}
            min={4}
            max={20}
            step={4}
            digits={2}
            onChange={(value) => setDraft((current) => chooseTabSize(current, value))}
          />
          <RadioGroup
            label="Tab Type"
            showLabel={false}
            options={[
              { value: 'assembly', label: ASSEMBLY_TABS_CAPTION },
              { value: 'fixed', label: FIXED_TABS_CAPTION },
            ]}
            value={shown.tabType === TabType.Assembly ? 'assembly' : 'fixed'}
            onChange={(value) =>
              setDraft((current) => ({ ...current, tabType: value === 'assembly' ? TabType.Assembly : TabType.Fixed }))
            }
          />
        </div>
      </fieldset>
      <fieldset className="e68-options__group">
        <legend>{CURRENT_FILE_GROUP_CAPTION}</legend>
        <dl className="e68-options__info" data-e68-options="current-file">
          <dt>{CURRENT_FONT_CAPTION}</dt>
          <dd>{document.fontName}</dd>
          <dt>{CURRENT_FONT_SIZE_CAPTION}</dt>
          <dd>{document.fontSize}</dd>
          <dt>{CURRENT_TAB_SIZE_CAPTION}</dt>
          <dd>{document.tabSize}</dd>
          <dt>{CURRENT_TAB_TYPE_CAPTION}</dt>
          <dd>{tabTypeName(document.tabType)}</dd>
        </dl>
      </fieldset>
      <fieldset className="e68-options__group">
        <legend>{ENVIRONMENT_GROUP_CAPTION}</legend>
        <div className="e68-options__stack">
          <Checkbox
            label={AUTO_INDENT_CAPTION}
            checked={shown.autoIndent}
            onChange={(on) => setDraft((current) => ({ ...current, autoIndent: on }))}
          />
          <Checkbox
            label={REAL_TABS_CAPTION}
            checked={shown.realTabs}
            onChange={(on) => setDraft((current) => ({ ...current, realTabs: on }))}
          />
        </div>
      </fieldset>
    </div>
  );

  const attribute = (name: 'bold' | 'italic' | 'underline', caption: string) => (
    <Checkbox
      label={caption}
      checked={ui[name]}
      onChange={(on) => {
        const next = toggleAttribute(draft, ui, shown, name, on);
        setDraft(next.draft);
        setUi(next.ui);
      }}
    />
  );

  const colors = (
    <div className="e68-options__colors">
      <div className="e68-options__stack" ref={elementList}>
        <span id={elementLabel}>
          <Caption text={ELEMENT_CAPTION} />
        </span>
        <ListBox
          labelledBy={elementLabel}
          rows={9}
          items={ELEMENT_NAMES.map((label, index) => ({ value: String(index), label }))}
          value={ui.element >= 0 ? String(ui.element) : null}
          onChange={(value) => setUi(selectElement(ui, shown, Number(value)))}
        />
      </div>
      <div className="e68-options__stack">
        <fieldset className="e68-options__group">
          <legend>{TEXT_ATTRIBUTES_GROUP_CAPTION}</legend>
          <div className="e68-options__stack">
            {attribute('bold', BOLD_CAPTION)}
            {attribute('italic', ITALIC_CAPTION)}
            {attribute('underline', UNDERLINE_CAPTION)}
          </div>
        </fieldset>
        <fieldset className="e68-options__group">
          <legend>
            <Caption text={COLOR_GROUP_CAPTION} />
          </legend>
          <div className="e68-options__swatches">
            {SWATCHES.map((swatch) => (
              <button
                key={swatch.name}
                type="button"
                className="e68-options__swatch"
                aria-label={swatch.name}
                title={swatch.name}
                style={{ background: colorRefToHex(swatch.color) }}
                onClick={() => setDraft(clickSwatch(draft, ui, shown, swatch.color))}
              />
            ))}
          </div>
        </fieldset>
      </div>
      <div className="e68-options__stack">
        <Select
          label={COLOR_PRESETS_CAPTION}
          labelPosition="top"
          options={[
            ...(shown.colorPreset === COLOR_PRESET.none ? [{ value: '-1', label: '', disabled: true }] : []),
            ...PRESET_NAMES.map((label, index) => ({ value: String(index), label })),
          ]}
          value={String(shown.colorPreset)}
          onChange={(value) => {
            const next = choosePreset(draft, Number(value));
            setDraft(next.draft);
            setUi(next.ui);
          }}
        />
        <Checkbox label={PRINT_BLACK_CAPTION} checked={shown.printBlack} disabled onChange={() => {}} />
      </div>
      <div className="e68-options__preview-wrap">
        <span>{PREVIEW_CAPTION}</span>
        {/* A picture of the styles: the original's colours, whatever their contrast (2.8: stored
            presets are used unchanged), so it is an image to assistive technology. */}
        <pre
          className="e68-options__preview"
          role="img"
          aria-label={PREVIEW_CAPTION}
          data-e68-options="preview"
          style={{ background: colorRefToHex(palette.background), fontFamily: cssFontFamily('Courier New') }}
        >
          {PREVIEW_LINES.map((line, row) => (
            <div key={row}>
              {line.map(([text, element], index) => {
                const name = element === null ? undefined : SYNTAX_ELEMENTS[element];
                if (name === undefined) return <span key={index}>{text}</span>;
                const style = palette.styles[name];
                return (
                  <span
                    key={index}
                    data-element={name}
                    style={{
                      color: colorRefToHex(style.color),
                      fontWeight: style.bold ? 700 : 400,
                      fontStyle: style.italic ? 'italic' : 'normal',
                      textDecoration: style.underline ? 'underline' : 'none',
                    }}
                  >
                    {text}
                  </span>
                );
              })}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );

  return (
    <Dialog
      title={EDITOR_OPTIONS_TITLE}
      width={600}
      className="e68-options-dialog"
      onCancel={() => close(null)}
      onKeyDown={(event) => {
        if (!isHelpKey(event)) return;
        event.preventDefault();
        openOptionsHelp(ctx);
      }}
      footer={
        <>
          <Button caption={EDITOR_OK_CAPTION} isDefault onClick={() => close(draft)} />
          <Button caption={EDITOR_CANCEL_CAPTION} onClick={() => close(null)} />
          <Button caption={EDITOR_HELP_CAPTION} onClick={() => openOptionsHelp(ctx)} />
        </>
      }
    >
      <div className="e68-options" data-e68-options="editor">
        <Tabs
          idBase={idBase}
          variant="tool"
          label={EDITOR_OPTIONS_TITLE}
          items={[
            { id: 'general', label: GENERAL_TAB_CAPTION },
            { id: 'colors', label: COLORS_TAB_CAPTION },
          ]}
          selectedId={tab}
          onSelect={(id) => setTab(id as EditorTab)}
        />
        <TabPanel idBase={idBase} tabId={tab} className="e68-options__tabpanel">
          {tab === 'general' ? general : colors}
        </TabPanel>
      </div>
    </Dialog>
  );
}
