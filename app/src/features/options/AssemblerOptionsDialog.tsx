// Options > Assembler Options... (dialog id `options.assembler`; editor-ui §11.1, optionsS.dfm,
// optionsS.cpp). A modeless dialog `EASy68K Assembler Options` with two tabs, the first selected
// every time it is shown:
//
//   Assembler Options  the groups `Assembler Options` and `List File Options`, nine check boxes
//                      with the original's tool-tips;
//   Template           the text of template.NEW (no word wrap, Tab types a tab) in the Editor
//                      Options font, reloaded every time the dialog is shown, and `&Save Template`,
//                      which saves it at once whatever OK or Cancel do later.
//
// `&OK` (tool-tip `Save Settings`) asks the Sim68K question when Generate S-Record or Generate
// List File is unchecked; `C&ancel`, Escape and the close button change nothing (1.4 note 8; see
// model.ts). F1 opens options.htm.
//
// Owner: E4.

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { OWN_KEYS_ATTRIBUTE } from '../../commands/keymap';
import type { DialogProps as FeatureDialogProps } from '../../contracts';
import { useAppContext, useAppState } from '../../state/context';
import { Button, Checkbox, Dialog, TabPanel, Tabs } from '../../ui/components';
import { confirmAssemblerOptions, openOptionsHelp, optionsStateOf, saveTemplate } from './actions';
import {
  ASSEMBLER_OPTIONS,
  HELP_CHORD,
  asmValue,
  cssFontFamily,
  isHelpKey,
  type AsmDraft,
  type AsmOption,
} from './model';
import {
  ASSEMBLER_CANCEL_CAPTION,
  ASSEMBLER_GROUP_CAPTION,
  ASSEMBLER_OK_CAPTION,
  ASSEMBLER_OK_HINT,
  ASSEMBLER_OPTIONS_TITLE,
  ASSEMBLER_TAB_CAPTION,
  LIST_GROUP_CAPTION,
  SAVE_TEMPLATE_CAPTION,
  TEMPLATE_TAB_CAPTION,
} from './texts';
import './options.css';

type AsmTab = 'assembler' | 'template';

export function AssemblerOptionsDialog({ close }: FeatureDialogProps<Record<string, never>, void>) {
  const ctx = useAppContext();
  const live = useAppState((state) => state.settings.editor);
  const [draft, setDraft] = useState<AsmDraft>({});
  const [tab, setTab] = useState<AsmTab>('assembler');
  // FormShow: the box is loaded from template.NEW every time the dialog is shown.
  const [template, setTemplate] = useState(() => ctx.settings.get().editor.template);
  const [busy, setBusy] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const templateArea = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const idBase = useId();

  // Options > Assembler Options... while the dialog is open brings it to the front.
  useEffect(() => {
    const state = optionsStateOf(ctx);
    state.focusAssembler = () => body.current?.querySelector<HTMLElement>('input, textarea, button')?.focus();
    return () => {
      state.focusAssembler = null;
    };
  }, [ctx]);

  // F1 belongs to this dialog while the focus is anywhere in its box (tabs, boxes, template, the
  // button row, the close button): the shell's key dispatcher leaves a chord listed in
  // `data-e68-own-keys` to the element that lists it (commands/keymap.ts, errata W3.md entry 37;
  // docs/requests/E4-dialog-help-key.md), so the dialog's onKeyDown opens options.htm, not main.htm.
  // The kit's Dialog passes no attributes through, so the mark goes on its box from here.
  useEffect(() => {
    const box = body.current?.closest<HTMLElement>('[role=dialog]');
    if (!box) return;
    box.setAttribute(OWN_KEYS_ATTRIBUTE, HELP_CHORD);
    return () => box.removeAttribute(OWN_KEYS_ATTRIBUTE);
  }, []);

  const ok = async () => {
    if (busy) return;
    setBusy(true);
    const result = await confirmAssemblerOptions(ctx, draft);
    setBusy(false);
    if (result.close) close();
    else setDraft(result.draft);
  };

  const check = (option: AsmOption) => (
    <Checkbox
      key={option.key}
      label={option.caption}
      title={option.hint}
      checked={asmValue(live, draft, option.key)}
      onChange={(on) => setDraft((current) => ({ ...current, [option.key]: on }))}
    />
  );

  const onTemplateKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // WantTabs: Tab types a tab character instead of moving the focus. insertText keeps the
    // caret and the field's own undo; a browser without it gets the character set directly.
    if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    const area = event.currentTarget;
    if (document.execCommand?.('insertText', false, '\t')) return;
    const { selectionStart, selectionEnd, value } = area;
    // The caret is put back right after React writes the new value (a layout effect, not a
    // display frame: a headless runner may deliver none).
    pendingCaret.current = selectionStart + 1;
    setTemplate(`${value.slice(0, selectionStart)}\t${value.slice(selectionEnd)}`);
  };
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null || !templateArea.current) return;
    pendingCaret.current = null;
    templateArea.current.setSelectionRange(caret, caret);
  }, [template]);

  return (
    <Dialog
      title={ASSEMBLER_OPTIONS_TITLE}
      modal={false}
      width={500}
      anchor={{ top: 72, left: 96 }}
      className="e68-options-dialog"
      onCancel={() => close()}
      onKeyDown={(event) => {
        if (!isHelpKey(event)) return;
        event.preventDefault();
        openOptionsHelp(ctx);
      }}
      footer={
        <>
          <Button caption={ASSEMBLER_OK_CAPTION} title={ASSEMBLER_OK_HINT} disabled={busy} onClick={() => void ok()} />
          <Button caption={ASSEMBLER_CANCEL_CAPTION} onClick={() => close()} />
        </>
      }
    >
      <div className="e68-options" ref={body} data-e68-options="assembler">
        <Tabs
          idBase={idBase}
          variant="tool"
          label={ASSEMBLER_OPTIONS_TITLE}
          items={[
            { id: 'assembler', label: ASSEMBLER_TAB_CAPTION },
            { id: 'template', label: TEMPLATE_TAB_CAPTION },
          ]}
          selectedId={tab}
          onSelect={(id) => setTab(id as AsmTab)}
        />
        {tab === 'assembler' ? (
          <TabPanel idBase={idBase} tabId="assembler" className="e68-options__tabpanel">
            <div className="e68-options__stack">
              <fieldset className="e68-options__group">
                <legend>{ASSEMBLER_GROUP_CAPTION}</legend>
                <div className="e68-options__checks">
                  {ASSEMBLER_OPTIONS.filter((option) => option.group === 'assembler').map(check)}
                </div>
              </fieldset>
              <fieldset className="e68-options__group">
                <legend>{LIST_GROUP_CAPTION}</legend>
                <div className="e68-options__checks">
                  {ASSEMBLER_OPTIONS.filter((option) => option.group === 'list').map(check)}
                </div>
              </fieldset>
            </div>
          </TabPanel>
        ) : (
          <TabPanel idBase={idBase} tabId="template" className="e68-options__tabpanel">
            <div className="e68-options__stack">
              <textarea
                ref={templateArea}
                className="e68-options__template"
                aria-label={TEMPLATE_TAB_CAPTION}
                value={template}
                spellCheck={false}
                wrap="off"
                style={{ fontFamily: cssFontFamily(live.fontName), fontSize: `${live.fontSize}pt` }}
                onChange={(event) => setTemplate(event.target.value)}
                onKeyDown={onTemplateKey}
              />
              <div className="e68-options__row-end">
                <Button caption={SAVE_TEMPLATE_CAPTION} onClick={() => saveTemplate(ctx, template)} />
              </div>
            </div>
          </TabPanel>
        )}
      </div>
    </Dialog>
  );
}
