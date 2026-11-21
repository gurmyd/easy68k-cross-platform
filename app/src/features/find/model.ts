// Find, Find Next and Replace of the editor: the state of the two dialogs and the actions on the
// active document (editor-ui §14; ARCHITECTURE.md 1.4 note 7). Owner: E6.
//
// One model per window (per AppContext). It keeps what the original's two dialog forms keep while
// the program runs: the Find dialog's text and options (which Find Next / F3 always uses, whether
// the dialog is shown or not) and the Replace dialog's own two texts and options. Nothing of it is
// saved in the settings (§14.1).
//
// The search rules are in search.ts. The model reads and changes the document through an
// `EditorTarget`; the real one (registryTarget) works on the document's EditorState in the
// registry of core/documents, which the editor's views follow (3.9.1).

import type { AppContext, MessageBoxRequest } from '../../contracts';
import { documentRegistryOf } from '../../core/documents';
import { focusPanel } from '../../state/panels';
import { createStore } from '../../state/store';
import type { Store } from '../../contracts';
import { findNext, replace, type FindOptions, type Selection, type TextChange } from './search';

/** The dialog ids (2.7). */
export const FIND_DIALOG_ID = 'find';
export const REPLACE_DIALOG_ID = 'replace';

/** The information box of a failed search (§14.2, mainS.cpp:639). */
export const END_OF_DOCUMENT: MessageBoxRequest = {
  title: 'Information',
  text: 'End of document reached.',
  icon: 'information',
  buttons: ['OK'],
};

/** What the model needs from the editor: the active document's text and selection. */
export interface EditorTarget {
  /** The active document, or null when none is open. */
  activeId(): string | null;
  /** The document's text and main selection; `token` changes whenever the text changes. Null when
   *  the document cannot be reached. */
  snapshot(id: string): { text: string; selection: Selection; token: unknown } | null;
  /** Selects `from`..`to` (the caret at `to`) and scrolls it into view. */
  select(id: string, selection: Selection): void;
  /** Applies the changes (coordinates of the current text) as one edit and selects `selection`. */
  apply(id: string, changes: TextChange[], selection: Selection): void;
  /** Gives the keyboard focus to the editor (the original's `Main->SetFocus()` after a match),
   *  keeping `selection` selected. */
  focusEditor(id: string, selection: Selection): void;
}

/** The editor of the window through the document registry (3.9.1). */
export function registryTarget(ctx: AppContext): EditorTarget {
  const registry = () => {
    try {
      return documentRegistryOf(ctx.documents);
    } catch {
      // A document service without a registry (the wave-0 stub, test doubles): nothing to search.
      return null;
    }
  };
  return {
    activeId: () => ctx.store.getState().documents.activeId,
    snapshot(id) {
      const reg = registry();
      if (!reg || !reg.has(id)) return null;
      const state = reg.state(id);
      const main = state.selection.main;
      return { text: state.doc.toString(), selection: { from: main.from, to: main.to }, token: state.doc };
    },
    select(id, selection) {
      const reg = registry();
      if (!reg || !reg.has(id)) return;
      reg.dispatch(id, { selection: { anchor: selection.from, head: selection.to }, scrollIntoView: true });
    },
    apply(id, changes, selection) {
      const reg = registry();
      if (!reg || !reg.has(id)) return;
      reg.dispatch(id, {
        changes,
        selection: { anchor: selection.from, head: selection.to },
        scrollIntoView: true,
        userEvent: 'input.replace',
      });
    },
    focusEditor() {
      // The editor keeps the match selected as it takes the focus: focusPanel lets its view focus
      // itself (state/panels.ts PANEL_FOCUS_EVENT, ui/editor/DocumentEditor.tsx), which writes the
      // state's selection into the page instead of letting the browser put back its own earlier
      // caret. Until gate I2 this feature had to undo that caret for 400 ms after a match
      // (errata/E6.md, entry 2); the guard also undid an arrow key pressed in that time.
      focusPanel(ctx, 'editor');
    },
  };
}

/** Props of the two dialogs: `below` when the other one was open as it opened (then it opens under it). */
export interface FindDialogProps {
  below?: boolean;
}

/** Where a modeless dialog of this feature floats: the top right of the workspace (the kit's
 *  default), or under the other dialog. */
export function dialogAnchor(props: FindDialogProps | undefined): { top: number; right: number } {
  return { top: props?.below ? 352 : 72, right: 24 };
}

export interface FindFields extends FindOptions {
  text: string;
}
export interface ReplaceFields extends FindFields {
  replacement: string;
}
export interface FindView {
  find: FindFields;
  replace: ReplaceFields;
  /** Bumped when Find... is chosen again while its dialog is open: the dialog takes the focus. */
  findFocus: number;
  replaceFocus: number;
}

/** The first line of a selection: a one-line text box cannot hold a line break. */
export function firstLine(text: string): string {
  const end = text.indexOf('\n');
  return end < 0 ? text : text.slice(0, end);
}

export class FindModel {
  readonly view: Store<FindView>;
  /** Set by `End of document reached.`: the next search of that document starts from the top while
   *  its text is unchanged and the caret is still where the box left it (note 7). */
  private restart: { id: string; token: unknown; caret: number } | null = null;

  constructor(
    private readonly ctx: Pick<AppContext, 'store' | 'dialogs'>,
    private readonly target: EditorTarget,
  ) {
    const empty = { text: '', wholeWord: false, matchCase: false };
    this.view = createStore<FindView>({
      find: { ...empty },
      replace: { ...empty, replacement: '' },
      findFocus: 0,
      replaceFocus: 0,
    });
  }

  /* ---- the dialogs' fields ---- */

  setFind(patch: Partial<FindFields>): void {
    const before = this.view.getState().find.text;
    this.view.setState((state) => ({ ...state, find: { ...state.find, ...patch } }));
    // Find Next is enabled while the Find text is not empty (Edit1Click): menus ask again.
    if ((before === '') !== (this.view.getState().find.text === '')) this.ctx.store.setState((s) => ({ ...s }));
  }

  setReplace(patch: Partial<ReplaceFields>): void {
    this.view.setState((state) => ({ ...state, replace: { ...state.replace, ...patch } }));
  }

  /** The selected text of the active document ('' when nothing is selected or none is open). */
  selectedText(): string {
    const id = this.target.activeId();
    const snap = id === null ? null : this.target.snapshot(id);
    if (!snap) return '';
    return snap.text.slice(snap.selection.from, snap.selection.to);
  }

  /** Edit > Find... (mnuFindClick): a non-empty selection becomes the Find text. */
  prepareFind(): void {
    const selected = firstLine(this.selectedText());
    if (selected !== '') this.setFind({ text: selected });
    this.view.setState((state) => ({ ...state, findFocus: state.findFocus + 1 }));
  }

  /** Edit > Find And Replace... (mnuFindAndReplace1Click): both boxes get the selection, even empty. */
  prepareReplace(): void {
    const selected = firstLine(this.selectedText());
    this.setReplace({ text: selected, replacement: selected });
    this.view.setState((state) => ({ ...state, replaceFocus: state.replaceFocus + 1 }));
  }

  /** True when Find Next can run: a document is open and the Find text is not empty. */
  canFindNext(): boolean {
    return this.target.activeId() !== null && this.view.getState().find.text !== '';
  }

  /* ---- actions ---- */

  /** Find Next / F3 / the Find dialog's button: the search with the Find dialog's text and options. */
  findNextFromFindDialog(): Promise<boolean> {
    const { text, wholeWord, matchCase } = this.view.getState().find;
    return this.search(text, { wholeWord, matchCase });
  }

  /** The Replace dialog's Find Next: the same search with that dialog's text and options. */
  findNextFromReplaceDialog(): Promise<boolean> {
    const { text, wholeWord, matchCase } = this.view.getState().replace;
    return this.search(text, { wholeWord, matchCase });
  }

  /** FindDialogFind (§14.2, note 7). Resolves true when a match was selected. */
  async search(query: string, options: FindOptions): Promise<boolean> {
    const id = this.target.activeId();
    if (id === null || query === '') return false;
    const snap = this.target.snapshot(id);
    if (!snap) return false;
    const found = findNext(snap.text, query, options, { selection: snap.selection, restart: this.restarts(id, snap) });
    this.restart = null;
    if (found) {
      this.target.select(id, found);
      this.target.focusEditor(id, found);
      return true;
    }
    await this.endOfDocument(id);
    return false;
  }

  /** Replace (all = false) and Replace All (all = true) of the Replace dialog (§14.3, note 7). */
  async replace(all: boolean): Promise<void> {
    const id = this.target.activeId();
    const fields = this.view.getState().replace;
    if (id === null || fields.text === '') return;
    const snap = this.target.snapshot(id);
    if (!snap) return;
    const result = replace({
      text: snap.text,
      selection: snap.selection,
      restart: this.restarts(id, snap),
      query: fields.text,
      replacement: fields.replacement,
      options: { wholeWord: fields.wholeWord, matchCase: fields.matchCase },
      all,
    });
    this.restart = null;
    if (result.changes.length > 0) this.target.apply(id, result.changes, result.selection);
    if (result.endReached) {
      await this.endOfDocument(id);
      return;
    }
    this.target.focusEditor(id, result.selection);
  }

  private restarts(id: string, snap: { selection: Selection; token: unknown }): boolean {
    const r = this.restart;
    return (
      r !== null &&
      r.id === id &&
      r.token === snap.token &&
      snap.selection.from === snap.selection.to &&
      snap.selection.from === r.caret
    );
  }

  /** `End of document reached.`, then the selection collapses to its start (mainS.cpp:639-640). */
  private async endOfDocument(id: string): Promise<void> {
    await this.ctx.dialogs.messageBox(END_OF_DOCUMENT);
    const snap = this.target.snapshot(id);
    if (!snap) return;
    const caret = snap.selection.from;
    this.target.select(id, { from: caret, to: caret });
    const after = this.target.snapshot(id);
    this.restart = { id, token: after?.token ?? snap.token, caret };
  }
}

const models = new WeakMap<object, FindModel>();

/** The Find model of the window `ctx` belongs to (created on first use). */
export function findModelOf(ctx: AppContext): FindModel {
  let model = models.get(ctx);
  if (!model) {
    model = new FindModel(ctx, registryTarget(ctx));
    models.set(ctx, model);
  }
  return model;
}
