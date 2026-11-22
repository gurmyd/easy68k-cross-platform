// Contract: editor documents (ARCHITECTURE.md 3.9). Implemented by E1 (core/documents/,
// features/documents/).
//
// Owner: W1. Contracts import nothing but other contracts (3.1).

import type { Bytes, TabType } from './engine';
import type { VPath } from './fs';

export type DocKind = 'source' | 'list';
export interface DocumentState {
  id: string;
  path: VPath | null; // null until loaded from or saved to a file
  name: string; // file name, or "untitledN.x68"
  kind: DocKind; // IsSource
  hasName: boolean;
  tabType: TabType;
  tabSize: number;
  fontName: string; // as stored in the trailer; never rewritten to a substitute
  fontSize: number;
  insertMode: boolean;
  modified: boolean;
  /** Increases with every text change; lets panels detect staleness without reading the text. */
  revision: number;
}

export interface DocDefaults {
  fontName: string;
  fontSize: number;
  tabType: TabType;
  tabSize: number;
}

/** The settings of an open document that can be changed after it is open (DocumentService.update).
 *  Added at gate I1 (docs/porting/errata/W1.md, entry 11). */
export type DocumentPatch = Partial<
  Pick<DocumentState, 'insertMode' | 'tabType' | 'tabSize' | 'fontName' | 'fontSize'>
>;

/** The selection of a document as the editor last left it (DocumentService.selection). Offsets count
 *  characters of `text(id)`. Added at gate I1. */
export interface DocumentSelection {
  /** The selected text; '' when nothing is selected. */
  selected: string;
  /** The caret: the number of characters before it (the end of the selection that moves). */
  caret: number;
}

export interface DocumentService {
  list(): DocumentState[];
  active(): DocumentState | null;
  text(id: string): string; // lines separated by "\n"
  newSource(): DocumentState;
  /** editor-ui §6.2 incl. the "already open" question. As before; with { asText: true } the viewer
   *  is not asked (ARCHITECTURE-PLUS P3.4.2, Open as Text). */
  open(path: VPath, options?: { asText?: boolean }): Promise<DocumentState | null>;
  save(id: string): Promise<boolean>; // false = cancelled or failed
  saveAs(id: string): Promise<boolean>;
  reload(id: string): Promise<void>;
  close(id: string): Promise<boolean>; // false = cancelled
  closeAll(): Promise<boolean>;
  activate(id: string): void;

  /* ---- added at gate I1 (docs/porting/errata/W1.md, entry 11) as optional members; required
     since gate I2 (entry 14.5), when the real service (core/documents, E1), the shell's stand-in
     and every fake in the tree had both. A caller's `?.` from the optional days still compiles. ---- */

  /** Changes settings of an open document: Insert/Replace (the editor), font and tabs (Editor
   *  Options). The store's DocumentState follows; the text, `modified` and `revision` do not change.
   *  The next Save writes the font and tab values into the trailer. */
  update(id: string, patch: DocumentPatch): void;
  /** The selection and caret of a document, for F1 in the editor (editor-ui §15.3). null for an
   *  unknown id. */
  selection(id: string): DocumentSelection | null;

  /* ---- the stage of additions (ARCHITECTURE-PLUS P4.4): optional members ---- */

  /** The file at `from` (or a folder `from` and everything below) is now at `to`: open documents
   *  follow, with text, modified state and history unchanged; the recorded modification time is taken
   *  from the new file, and the document's draft is rewritten at once (ARCHITECTURE-PLUS P3.2.4). */
  relocate?(from: VPath, to: VPath): Promise<void>;

  /** Called after each successful write by Save, Save As and Auto Save, with the exact bytes written
   *  ('saved'), and after each open of a file as a document, with the bytes read ('opened')
   *  (ARCHITECTURE-PLUS P3.3.3). Listeners run after the save's or open's promise has resolved, each
   *  in its own try/catch, never awaited: a listener that throws never makes a save fail. `time` is
   *  the clock when the bytes were written or read. */
  onWritten?(
    listener: (event: { path: VPath; bytes: Bytes; reason: 'saved' | 'opened'; time: number }) => void,
  ): () => void;

  /** The file's modification time recorded at open or the last save; null for a new document
   *  (exists as DocumentManager.fileTime). */
  fileTime?(id: string): number | null;
}
