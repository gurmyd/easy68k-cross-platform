// The document service: New, Open, Save, Save As, Reload, Close (ARCHITECTURE.md 3.9; editor-ui §6,
// §12; 3.8.6 rule 3).
//
// DocumentManager implements the contract's DocumentService. It keeps the DocumentState of every
// open document, mirrors them into AppState.documents (order = order of opening, 2.4), and keeps
// their text in a DocumentRegistry (registry.ts). It touches no browser API: files, dialogs and the
// file dialogs arrive as the contract's interfaces (DocumentServiceDeps).
//
// Behaviour, in the original's order (editor-ui §6), with the port's documented changes:
//   - Open: missing file -> `File Access Error. ...`; a document with exactly this path open ->
//     discarded (after the "already open" question if it is modified) and replaced in its tab;
//     the extension decides source or list (.L68 and .S68, any case, are lists).
//   - Save writes text + trailer (format.ts). Before writing over the file it compares the file's
//     modification time with the one recorded at load or the last save and asks the question of
//     3.8.6 if they differ. Characters without a Windows-1252 byte are asked about once per
//     document (3.9.3).
//   - Save As: the file dialog confirms an overwrite itself (FileDialogs.save); only an extension
//     spelled exactly `.X68` turns a list into a source (mainS.cpp:190-201).
//   - Close saves the document that is closing, and a cancelled or failed save cancels the close
//     (1.4 note 3).
//   - untitledN numbers increase by one per new document (1.4 note 15).
//
// The hooks of the stage of additions (ARCHITECTURE-PLUS P3.4.1, P4.4; package N6). None of them
// changes anything for a caller that does not use it:
//   - open(path, options): once the bytes are read, before they are decoded, the viewer
//     (deps.viewer) is asked; when it wants the file it shows it and open returns null, and a
//     document of the same path that is open as text stays open (it is asked before the "already
//     open" step: an Open never closes what a person has open; errata N6 12). { asText: true }
//     skips that question (Open as Text).
//   - relocate(from, to): open documents of a moved file or folder follow it, with text, modified
//     state and revision unchanged; the modification time is taken from the new file, and the
//     relocation listeners (onRelocated: the drafts) run before the promise resolves.
//   - onWritten(listener): after each successful Save, Save As and Auto Save (the bytes written,
//     'saved') and each open of a file as a document (the bytes read, 'opened'); not for Reload.
//     Listeners run after the operation's promise has resolved, each in its own try/catch.
//   - fileTime(id): as it was (DocumentManager.fileTime), now part of the contract.
//   - deps.shown(id): told whenever a document is made the one a person works on (every
//     activate(), also of the active document, and a reload of the active document), so that the
//     dock brings the editor in front of a viewer (P1.2: today the opened document is shown;
//     errata N6 15). Without the dep nothing is told and nothing else changes.
//
// Owner: E1 (the hooks: N6 in the stage of additions). Runs under Node and in browsers (core/
// rules, 3.1).

import {
  TabType,
  type AppState,
  type Bytes,
  type Clock,
  type DialogService,
  type DocDefaults,
  type DocumentPatch,
  type DocumentSelection,
  type DocumentService,
  type DocumentState,
  type FileDialogs,
  type SettingsService,
  type Store,
  type ViewerService,
  type VPath,
  type Vfs,
} from '../../contracts';
import { basename, extractFileExt } from '../paths/winpath';
import { countUnmappable, decodeFile, encodeFile, looksLikeUtf8, stripTrailer, upperExt, UTF8_BANNER } from './format';
import {
  alreadyOpenQuestion,
  changedOutsideQuestion,
  closeQuestion,
  fileAccessError,
  loadFileError,
  reloadQuestion,
  SAVE_DEFAULT_EXT,
  SAVE_FILTERS,
  SAVE_TITLE,
  unmappableQuestion,
  writeError,
} from './messages';
import { DocumentRegistry } from './registry';

export interface DocumentServiceDeps {
  store: Store<AppState>;
  settings: Pick<SettingsService, 'get'>;
  dialogs: Pick<DialogService, 'messageBox' | 'toast'>;
  vfs: Pick<Vfs, 'stat' | 'readFile' | 'writeFile'>;
  fileDialogs: Pick<FileDialogs, 'open' | 'save'>;
  /** Default: a new registry. */
  registry?: DocumentRegistry;
  /** The viewer of files that are not text (ARCHITECTURE-PLUS P3.4); absent = every file is text. */
  viewer?: Pick<ViewerService, 'wants' | 'show'>;
  /** The time of onWritten's events (ARCHITECTURE-PLUS P4.4): its wall time; absent = time 0. */
  clock?: Pick<Clock, 'wallTime'>;
  /**
   * ARCHITECTURE-PLUS P1.2 (errata N6 15): told that the document `id` was made the one a person
   * works on, so that a viewer in front of the editor gives way to it. Called by every activate()
   * (also of the active document: a Window menu choice of it, an "already open" No), and so by New,
   * Open, Open as New Document and a draft brought back, and after a reload of the active document.
   * Not called when a close makes another document active. A listener that throws changes nothing.
   */
  shown?: (id: string) => void;
}

/** An event of DocumentService.onWritten (ARCHITECTURE-PLUS P4.4). */
export interface WrittenEvent {
  path: VPath;
  bytes: Bytes;
  reason: 'saved' | 'opened';
  time: number;
}

/** Told which documents relocate() moved, before its promise resolves (the drafts rewrite theirs). */
export type RelocatedListener = (ids: readonly string[]) => void | Promise<void>;

/** The settings a document can change after it is open (E2: Insert/Replace; E4: Editor Options). */
export type { DocumentPatch } from '../../contracts';

/** A document to bring back from a draft (features/documents/drafts.ts). */
export interface RestoredDocument {
  state: DocumentState;
  text: string;
  /** The file's modification time recorded by the window that wrote the draft. */
  mtime: number | null;
}

interface Entry {
  state: DocumentState;
  /** Modification time of the file when it was loaded or last saved; null = not known. */
  mtime: number | null;
  /** The user has accepted that characters without a Windows-1252 byte are saved as '?'. */
  unmappableAccepted: boolean;
}

/** True for the extensions that open as list documents (editor-ui §6.3: `.L68`, `.S68`, any case). */
export function isListPath(path: string): boolean {
  const ext = upperExt(path);
  return ext === '.L68' || ext === '.S68';
}

/** The kind after Save As (mainS.cpp:190-201): `.X68` exactly makes a source; otherwise unchanged. */
export function kindAfterSaveAs(kind: DocumentState['kind'], path: string): DocumentState['kind'] {
  return extractFileExt(path) === '.X68' ? 'source' : kind;
}

/** The Editor Options defaults that a new or loaded document starts with (editor-ui §6.3 step 3). */
export function docDefaults(settings: Pick<SettingsService, 'get'>): DocDefaults {
  const editor = settings.get().editor;
  return {
    fontName: editor.fontName,
    fontSize: editor.fontSize,
    tabType: editor.tabType,
    tabSize: editor.fixedTabSize,
  };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The FsError code of a failed write (contracts/fs.ts), if it has one. */
function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

export class DocumentManager implements DocumentService {
  readonly registry: DocumentRegistry;
  private readonly deps: DocumentServiceDeps;
  private readonly entries = new Map<string, Entry>();
  private order: string[] = [];
  private activeId: string | null = null;
  private untitled = 0;
  private nextId = 1;
  private readonly writtenListeners = new Set<(event: WrittenEvent) => void>();
  private readonly relocatedListeners = new Set<RelocatedListener>();

  constructor(deps: DocumentServiceDeps) {
    this.deps = deps;
    this.registry = deps.registry ?? new DocumentRegistry();
    this.registry.subscribe((event) => {
      if (event.kind !== 'updated' || !event.transaction.docChanged) return;
      const entry = this.entries.get(event.id);
      if (!entry) return;
      entry.state = {
        ...entry.state,
        revision: entry.state.revision + 1,
        modified: this.registry.isModified(event.id),
      };
      this.publish();
    });
  }

  /* ---------------------------------------------------------------- reading */

  list(): DocumentState[] {
    return this.order.map((id) => (this.entries.get(id) as Entry).state);
  }

  active(): DocumentState | null {
    return this.activeId === null ? null : (this.entries.get(this.activeId)?.state ?? null);
  }

  /** The state of one document, or null. */
  get(id: string): DocumentState | null {
    return this.entries.get(id)?.state ?? null;
  }

  text(id: string): string {
    return this.registry.text(id);
  }

  /** The file's modification time recorded at load or the last save (drafts keep it). */
  fileTime(id: string): number | null {
    return this.entries.get(id)?.mtime ?? null;
  }

  /* ---------------------------------------------------------------- new and open */

  /** editor-ui §12.1: `untitledN.x68` holding the template, not modified, Editor Options settings. */
  newSource(): DocumentState {
    const defaults = docDefaults(this.deps.settings);
    const state = this.add(
      {
        path: null,
        name: `untitled${++this.untitled}.x68`,
        kind: 'source',
        hasName: false,
        ...defaults,
        insertMode: true,
      },
      this.deps.settings.get().editor.template,
      null,
    );
    this.activate(state.id);
    return state;
  }

  /**
   * ARCHITECTURE-PLUS P3.3.8 (`Open as New Document`): like newSource, but holding `text` ("\n" line
   * ends) instead of the template, and modified, so that closing it asks whether to save it.
   */
  newSourceWithText(text: string): DocumentState {
    const defaults = docDefaults(this.deps.settings);
    const state = this.add(
      {
        path: null,
        name: `untitled${++this.untitled}.x68`,
        kind: 'source',
        hasName: false,
        ...defaults,
        insertMode: true,
      },
      text,
      null,
      null,
      true,
    );
    this.activate(state.id);
    return state;
  }

  open(path: VPath, options?: { asText?: boolean }): Promise<DocumentState | null> {
    const events: WrittenEvent[] = [];
    return this.announcing(this.openFile(path, options?.asText === true, events), events);
  }

  private async openFile(path: VPath, asText: boolean, events: WrittenEvent[]): Promise<DocumentState | null> {
    const { vfs, dialogs } = this.deps;
    const stat = await vfs.stat(path).catch(() => null);
    if (!stat || stat.kind !== 'file') {
      await dialogs.messageBox(fileAccessError());
      return null;
    }
    // ARCHITECTURE-PLUS P3.4.1: a file that is not text goes to the viewer (never with Open as Text).
    // The viewer is asked before the "already open" step, so that a document of this path that is
    // open as text (Open as Text) stays open: nothing a person has open is closed by an Open
    // (errata N6 12). A file the viewer does not take goes on exactly as before; when no document of
    // this path is open, the bytes read here are the ones loaded (one read, as before).
    const viewer = asText ? undefined : this.deps.viewer;
    let early: Bytes | null = null;
    if (viewer) {
      early = await vfs.readFile(path).catch(() => null);
      if (early !== null && viewer.wants(path, early)) {
        viewer.show(path, early);
        return null;
      }
    }
    // editor-ui §6.2 step 2: every document with exactly this path (case-sensitive), last first.
    let position: number | null = null;
    for (const id of [...this.order].reverse()) {
      const entry = this.entries.get(id);
      if (!entry || entry.state.path !== path) continue;
      if (entry.state.modified) {
        const answer = await dialogs.messageBox(alreadyOpenQuestion(basename(path)));
        if (answer !== 'Yes') {
          this.activate(id);
          return null;
        }
      }
      position = this.order.indexOf(id);
      this.discard(id);
    }

    let bytes: Bytes;
    if (early !== null && position === null) {
      bytes = early;
    } else {
      // Read (again) after the "already open" step, as editor-ui §6.2 orders it.
      try {
        bytes = await vfs.readFile(path);
      } catch {
        await dialogs.messageBox(loadFileError());
        return null;
      }
    }
    const time = this.now();
    const loaded = this.load(path, bytes);
    events.push({ path, bytes, reason: 'opened', time });
    const state = this.add(
      {
        path,
        name: basename(path),
        kind: loaded.kind,
        hasName: true,
        tabType: loaded.tabType,
        tabSize: loaded.tabSize,
        fontName: loaded.fontName,
        fontSize: loaded.fontSize,
        insertMode: true,
      },
      loaded.text,
      stat.mtime,
      position,
    );
    this.activate(state.id);
    if (looksLikeUtf8(bytes)) dialogs.toast(UTF8_BANNER);
    if (loaded.loadError) await dialogs.messageBox(loadFileError());
    return state;
  }

  /* ---------------------------------------------------------------- save */

  save(id: string): Promise<boolean> {
    const events: WrittenEvent[] = [];
    return this.announcing(this.saveFile(id, events), events);
  }

  saveAs(id: string): Promise<boolean> {
    const events: WrittenEvent[] = [];
    return this.announcing(this.saveFileAs(id, events), events);
  }

  private async saveFile(id: string, events: WrittenEvent[]): Promise<boolean> {
    const entry = this.entry(id);
    if (!entry.state.hasName || entry.state.path === null) return this.saveFileAs(id, events);
    return this.write(id, entry.state, true, events);
  }

  private async saveFileAs(id: string, events: WrittenEvent[]): Promise<boolean> {
    const entry = this.entry(id);
    const request = {
      title: SAVE_TITLE,
      filters: [...SAVE_FILTERS],
      defaultExt: SAVE_DEFAULT_EXT,
      ...(entry.state.hasName && entry.state.path !== null ? { suggested: entry.state.path } : {}),
    };
    const target = await this.deps.fileDialogs.save(request);
    if (target === null) return false;
    const current = this.entry(id).state;
    const renamed: DocumentState = {
      ...current,
      path: target,
      name: basename(target),
      kind: kindAfterSaveAs(current.kind, target),
      hasName: true,
    };
    return this.write(id, renamed, false, events);
  }

  /** Writes the document as `target` describes it (its path, name and kind) and adopts that state. */
  private async write(
    id: string,
    target: DocumentState,
    checkConflict: boolean,
    events: WrittenEvent[],
  ): Promise<boolean> {
    const { vfs, dialogs } = this.deps;
    const entry = this.entry(id);
    const path = target.path as VPath;

    const doc = this.registry.state(id).doc;
    const text = doc.toString();
    const unmappable = countUnmappable(text);
    if (unmappable > 0 && !entry.unmappableAccepted) {
      if ((await dialogs.messageBox(unmappableQuestion(unmappable))) !== 'OK') return false;
      entry.unmappableAccepted = true;
    }

    if (checkConflict && entry.mtime !== null) {
      const now = await vfs.stat(path).catch(() => null);
      if ((now?.mtime ?? null) !== entry.mtime) {
        if ((await dialogs.messageBox(changedOutsideQuestion(target.name))) !== 'Yes') return false;
      }
    }

    const data = encodeFile(target, text);
    try {
      await vfs.writeFile(path, data);
    } catch (error) {
      await dialogs.messageBox(writeError(path, reasonOf(error), codeOf(error)));
      return false;
    }
    events.push({ path, bytes: data, reason: 'saved', time: this.now() });
    const stat = await vfs.stat(path).catch(() => null);
    if (!this.entries.has(id)) return true; // closed while the file was written
    const after = this.entry(id);
    after.mtime = stat?.mtime ?? null;
    this.registry.markSaved(id, doc);
    after.state = {
      ...after.state,
      path,
      name: target.name,
      kind: target.kind,
      hasName: true,
      modified: this.registry.isModified(id),
    };
    this.publish();
    return true;
  }

  /* ---------------------------------------------------------------- reload and close */

  /** editor-ui §6.5: the "is modified" question, then load the file into the same document. */
  async reload(id: string): Promise<void> {
    const { vfs, dialogs } = this.deps;
    const entry = this.entry(id);
    const { path, hasName, modified, name } = entry.state;
    if (modified && hasName) {
      if ((await dialogs.messageBox(reloadQuestion(name))) !== 'Yes') return;
    }
    if (!hasName || path === null || !this.entries.has(id)) return;
    let bytes;
    let stat;
    try {
      stat = await vfs.stat(path);
      bytes = await vfs.readFile(path);
    } catch {
      await dialogs.messageBox(loadFileError());
      return;
    }
    if (!this.entries.has(id)) return;
    const loaded = this.load(path, bytes);
    this.registry.replace(id, loaded.text);
    const after = this.entry(id);
    after.mtime = stat?.mtime ?? null;
    after.state = {
      ...after.state,
      kind: loaded.kind,
      tabType: loaded.tabType,
      tabSize: loaded.tabSize,
      fontName: loaded.fontName,
      fontSize: loaded.fontSize,
      modified: false,
      revision: after.state.revision + 1,
    };
    this.publish();
    if (this.activeId === id) this.tellShown(id);
    if (looksLikeUtf8(bytes)) dialogs.toast(UTF8_BANNER);
    if (loaded.loadError) await dialogs.messageBox(loadFileError());
  }

  /** editor-ui §6.6 with 1.4 note 3: Yes saves THIS document; a cancelled or failed save cancels. */
  async close(id: string): Promise<boolean> {
    if (!(await this.closeQuery(id))) return false;
    this.discard(id);
    return true;
  }

  /**
   * editor-ui §1.3: the frame first asks every document's CloseQuery in tab order and closes
   * nothing until all of them have agreed. Cancel (or a cancelled or failed save) in any prompt
   * stops the questions and leaves EVERY document open: one answered No keeps its edits, one
   * answered Yes has been saved (as the original saves inside CloseQuery) but stays open.
   */
  async closeAll(): Promise<boolean> {
    const ids = [...this.order];
    for (const id of ids) {
      if (!(await this.closeQuery(id))) return false;
    }
    for (const id of ids) this.discard(id);
    return true;
  }

  /**
   * TTextStuff::FormCloseQuery (editor-ui §6.6) with 1.4 note 3: true = the document may close.
   * A modified document asks Yes/No/Cancel; Yes saves THIS document, and a cancelled or failed
   * save answers false. Nothing is discarded here.
   */
  private async closeQuery(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry || !entry.state.modified) return true;
    this.activate(id);
    const answer = await this.deps.dialogs.messageBox(closeQuestion(entry.state.name));
    if (answer !== 'Yes' && answer !== 'No') return false;
    if (answer === 'Yes' && !(await this.save(id))) return false;
    return true;
  }

  activate(id: string): void {
    if (!this.entries.has(id)) return;
    if (this.activeId !== id) {
      this.activeId = id;
      this.publish();
    }
    this.tellShown(id);
  }

  /** deps.shown (ARCHITECTURE-PLUS P1.2), in its own try/catch. */
  private tellShown(id: string): void {
    try {
      this.deps.shown?.(id);
    } catch {
      // The dock's reaction never makes an open, a choice or a reload fail.
    }
  }

  /* ---------------------------------------------------------------- for other packages */

  /** Changes settings of an open document (Insert/Replace, Editor Options). Text is not touched. */
  update(id: string, patch: DocumentPatch): void {
    const entry = this.entry(id);
    const next = { ...entry.state, ...patch };
    if ((Object.keys(patch) as (keyof DocumentPatch)[]).every((key) => entry.state[key] === next[key])) return;
    entry.state = next;
    this.publish();
  }

  /**
   * The main selection of a document as the editor last left it (F1, editor-ui §15.3). Offsets are
   * characters of `text(id)`: the registry's EditorState has the same "\n"-separated text, and every
   * transaction of the editor view, selection changes included, goes through the registry.
   */
  selection(id: string): DocumentSelection | null {
    if (!this.entries.has(id)) return null;
    const { doc, selection } = this.registry.state(id);
    const { from, to, head } = selection.main;
    return { selected: doc.sliceString(from, to), caret: head };
  }

  /** Brings back a document from a draft (3.9.4): modified, with the draft's text and settings. */
  restore(draft: RestoredDocument): DocumentState {
    const { state } = draft;
    let name = state.name;
    if (!state.hasName) {
      const used = new Set(this.list().map((doc) => doc.name));
      while (used.has(name)) name = `untitled${++this.untitled}.x68`;
      const number = /^untitled(\d+)\.x68$/.exec(name);
      if (number) this.untitled = Math.max(this.untitled, Number(number[1]));
    }
    const restored = this.add(
      {
        path: state.path,
        name,
        kind: state.kind,
        hasName: state.hasName,
        tabType: state.tabType,
        tabSize: state.tabSize,
        fontName: state.fontName,
        fontSize: state.fontSize,
        insertMode: state.insertMode,
      },
      draft.text,
      draft.mtime,
      null,
      true,
    );
    this.activate(restored.id);
    return restored;
  }

  /* ---------------------------------------------------------------- hooks of ARCHITECTURE-PLUS P4.4 */

  /**
   * The file `from`, or the folder `from` and everything below it, is now at `to` (a move or a
   * rename in the Files panel, P3.2.4). Open documents follow: path and name change; text, modified
   * state, revision and the editor's history do not. The recorded modification time is taken from
   * the new file. Paths are compared exactly, as open() compares them. The relocation listeners (the
   * drafts) have run when the promise resolves.
   */
  async relocate(from: VPath, to: VPath): Promise<void> {
    if (from === to) return;
    const moved: { id: string; path: VPath }[] = [];
    for (const id of this.order) {
      const path = this.entries.get(id)?.state.path ?? null;
      if (path === null) continue;
      if (path === from) moved.push({ id, path: to });
      else if (path.startsWith(`${from}/`)) moved.push({ id, path: `${to}${path.slice(from.length)}` as VPath });
    }
    if (moved.length === 0) return;
    const times = await Promise.all(
      moved.map(({ path }) =>
        this.deps.vfs
          .stat(path)
          .then((stat) => stat?.mtime ?? null)
          .catch(() => null),
      ),
    );
    const ids: string[] = [];
    moved.forEach(({ id, path }, index) => {
      const entry = this.entries.get(id);
      if (!entry) return; // closed meanwhile
      entry.mtime = times[index] ?? null;
      entry.state = { ...entry.state, path, name: basename(path) };
      ids.push(id);
    });
    if (ids.length === 0) return;
    this.publish();
    for (const listener of [...this.relocatedListeners]) {
      try {
        await listener(ids);
      } catch {
        // A listener (the drafts) never makes a move fail.
      }
    }
  }

  /** ARCHITECTURE-PLUS P4.4: told after each successful save and each open as a document. */
  onWritten(listener: (event: WrittenEvent) => void): () => void {
    this.writtenListeners.add(listener);
    return () => void this.writtenListeners.delete(listener);
  }

  /** Told which documents relocate() moved (features/documents/drafts.ts rewrites their drafts). */
  onRelocated(listener: RelocatedListener): () => void {
    this.relocatedListeners.add(listener);
    return () => void this.relocatedListeners.delete(listener);
  }

  /* ---------------------------------------------------------------- internals */

  /**
   * The time of an onWritten event: the wall clock, which every window shares (P3.3.3). Without a
   * clock (unit tests of other packages that build the service by hand) it is 0.
   */
  private now(): number {
    return this.deps.clock ? this.deps.clock.wallTime().getTime() : 0;
  }

  /**
   * Returns `work` itself, and once it has resolved, gives each event that the work collected to
   * every onWritten listener, each in its own try/catch. The listeners run in a reaction to the
   * promise, so they never delay it and an exception of one never reaches the caller.
   */
  private announcing<T>(work: Promise<T>, events: WrittenEvent[]): Promise<T> {
    void work.then(
      () => {
        for (const event of events.splice(0)) {
          for (const listener of [...this.writtenListeners]) {
            try {
              listener(event);
            } catch {
              // A listener that throws never makes a save or an open fail (P4.4).
            }
          }
        }
      },
      () => {},
    );
    return work;
  }

  /** What TTextStuff::LoadFile makes of a file's bytes (editor-ui §6.3). */
  private load(path: VPath, bytes: Uint8Array) {
    const defaults = docDefaults(this.deps.settings);
    const text = decodeFile(bytes);
    if (isListPath(path)) {
      // List document: no trailer processing; TabType and TabSize keep their zero initial values;
      // the font is the Editor Options font (editor-ui §6.3, textS.cpp:826-827).
      return {
        kind: 'list' as const,
        text,
        tabType: TabType.Assembly,
        tabSize: 0,
        fontName: defaults.fontName,
        fontSize: defaults.fontSize,
        loadError: false,
      };
    }
    return { kind: 'source' as const, ...stripTrailer(text, defaults) };
  }

  private add(
    fields: Omit<DocumentState, 'id' | 'modified' | 'revision'>,
    text: string,
    mtime: number | null,
    position: number | null = null,
    modified = false,
  ): DocumentState {
    const id = `doc-${this.nextId++}`;
    this.registry.create(id, text, { modified });
    const state: DocumentState = { id, ...fields, modified, revision: 0 };
    this.entries.set(id, { state, mtime, unmappableAccepted: false });
    if (position === null || position > this.order.length) this.order.push(id);
    else this.order.splice(position, 0, id);
    this.publish();
    return state;
  }

  /** Removes a document without a question; the neighbour on the right (else the left) becomes active. */
  private discard(id: string): void {
    const index = this.order.indexOf(id);
    if (index < 0) return;
    this.order.splice(index, 1);
    this.entries.delete(id);
    this.registry.remove(id);
    if (this.activeId === id) this.activeId = this.order[index] ?? this.order[index - 1] ?? null;
    this.publish();
  }

  private entry(id: string): Entry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`No open document has the id "${id}"`);
    return entry;
  }

  private publish(): void {
    const items = this.list();
    const activeId = this.activeId;
    this.deps.store.setState((state) => ({ ...state, documents: { items, activeId } }));
  }
}

/** The DocumentManager behind `ctx.documents` (E2 and E4 reach the registry and `update` this way). */
export function documentManagerOf(documents: DocumentService): DocumentManager {
  if (!(documents instanceof DocumentManager)) {
    throw new Error('ctx.documents is not the DocumentManager of core/documents (a stub service has no registry)');
  }
  return documents;
}

/** The registry of EditorStates behind `ctx.documents` (3.9.1). */
export function documentRegistryOf(documents: DocumentService): DocumentRegistry {
  return documentManagerOf(documents).registry;
}
