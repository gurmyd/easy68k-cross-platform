// `ed.project.assemble` without its user interface: ARCHITECTURE.md 4.9 steps 1 to 9, in the
// original's order (editor-ui §10.2, mainS.cpp:342-392).
//
//   1. Auto Save Modified Source Before Assembling and a modified document: Save (Save As for a
//      document without a name). A cancelled or failed save cancels the assembly.
//   2. The document's messages (and with them its inline markers, which E2 draws from them) are
//      cleared.
//   3. The options from the Assembler Options and the document's tab type and size.
//   4. The files (collect.ts), the editor buffer under the main name, the assembly.
//   5. `fatal`: one row `The assembler stopped: <text>`, nothing written, no dialog.
//   6. `.L68`, then `.S68`, in the source's folder, replacing existing files; a file whose option
//      is off is neither written nor deleted. A write failure: the original's `File Access Error`
//      box and no status dialog.
//   7. The assembler's own message boxes, in order.
//   8. The messages. A message of an include file goes to that file's document, which is opened if
//      it is not open (with the one-time notice of editor-ui §10.5 when it is open and modified);
//      the assembled document stays active (1.4 note 18). An include file whose document is open
//      has its list cleared first (DIRECTIV.CPP:709-719).
//   9. The summary for the shell's height rule of the message list, and what the status dialog
//      shows.
//
// Everything arrives as a contract interface (AssembleDeps), so the whole sequence runs under Node
// with the real document service, file system and assembler (assemble.test.ts, corpus.test.ts).
//
// Owner: E5.

import type {
  AppState,
  AsmEngine,
  AsmMessage,
  Clock,
  DocumentService,
  DocumentState,
  EditorMessage,
  MessageBoxRequest,
  SettingsService,
  Store,
  VPath,
  Vfs,
} from '../../contracts';
import { encodeForAssembler } from '../../core/documents/format';
import { basename, dirname, foldCase } from '../../core/paths/winpath';
import { assembleCollected, pathOfKey, type CollectedFiles } from './collect';
import { asmOptionsFor, outputPaths, sourcePathOf } from './options';
import { engineBox, includeNoticeBox, statusTitle, stoppedText, writeErrorBox } from './texts';

export interface AssembleDeps {
  documents: Pick<DocumentService, 'list' | 'save' | 'text' | 'open' | 'activate'>;
  vfs: Pick<Vfs, 'resolve' | 'readFile' | 'snapshot' | 'writeFile' | 'mkdirp'>;
  asm: AsmEngine;
  settings: Pick<SettingsService, 'get'>;
  store: Store<AppState>;
  clock: Clock;
  messageBox(request: MessageBoxRequest): Promise<string>;
  /** The folder of a never-saved document (options.ts, untitledFolder). */
  untitledDir: VPath;
}

/** What the status dialog `asm.status` shows (editor-ui §10.4) and what its buttons act on. */
export interface StatusDialogProps {
  title: string;
  warnings: number;
  errors: number;
  /** `AsmResult.executeEnabled` and the S-record was written (4.9 step 9). */
  executeEnabled: boolean;
  sRecordPath: VPath;
  listingPath: VPath;
}

/** The button the status dialog was closed with; `close` also for Escape and the title bar. */
export type StatusDialogResult = 'execute' | 'loadL68' | 'close';

export type AssembleOutcome =
  | { kind: 'cancelled' }
  | { kind: 'fatal'; text: string }
  | { kind: 'writeFailed' }
  | { kind: 'done'; status: StatusDialogProps; collected: CollectedFiles };

function findDocument(deps: AssembleDeps, id: string): DocumentState | undefined {
  return deps.documents.list().find((doc) => doc.id === id);
}

function samePath(a: VPath | null, b: VPath | null): boolean {
  return a !== null && b !== null && foldCase(a) === foldCase(b);
}

function setMessages(store: Store<AppState>, lists: ReadonlyMap<string, EditorMessage[]>): void {
  if (lists.size === 0) return;
  store.setState((state) => {
    const messages = { ...state.messages };
    for (const [id, list] of lists) messages[id] = list;
    return { ...state, messages };
  });
}

function toEditorMessage(message: AsmMessage, file: VPath | null): EditorMessage {
  return { file, line: message.line, text: message.text, severity: message.severity };
}

/** Runs 4.9 for the document `id`. */
export async function assembleDocument(deps: AssembleDeps, id: string): Promise<AssembleOutcome> {
  const { store } = deps;
  let doc = findDocument(deps, id);
  if (!doc) return { kind: 'cancelled' };

  // 1. Auto save.
  const editor = deps.settings.get().editor;
  if (editor.saveThenAssemble && doc.modified) {
    if (!(await deps.documents.save(id))) return { kind: 'cancelled' };
    doc = findDocument(deps, id);
    if (!doc) return { kind: 'cancelled' };
  }

  // 2. Clear the document's messages (and so its markers).
  setMessages(store, new Map([[id, []]]));

  // 3. Options.
  const options = asmOptionsFor(editor, doc);

  // 4. Files and the assembly.
  const source = sourcePathOf(doc, deps.untitledDir);
  /** EditorMessage.file of the document's own rows: its path, null for a never-saved document. */
  const own = doc.path;
  const buffer = encodeForAssembler(deps.documents.text(id));
  let assembled;
  try {
    if (doc.path === null) await deps.vfs.mkdirp(dirname(source));
    assembled = await assembleCollected(deps.asm, deps.vfs, source, buffer, options, deps.clock.wallTime());
  } catch (error) {
    // AsmEngine.assemble rejects only for arguments it refuses (a tab size outside -99..99 from a
    // hand-edited trailer) or when the engine cannot be loaded at all; shown like a fatal result.
    const text = stoppedText(error instanceof Error ? error.message : String(error));
    setMessages(store, new Map([[id, [{ file: own, line: 0, text, severity: 'error' }]]]));
    return { kind: 'fatal', text };
  }
  const { result, collected } = assembled;

  // 5. The assembler stopped: no file is written.
  if (result.fatal !== null) {
    const text = stoppedText(result.fatal);
    setMessages(store, new Map([[id, [{ file: own, line: 0, text, severity: 'error' }]]]));
    return { kind: 'fatal', text };
  }

  // 6. Outputs.
  const outputs = outputPaths(source);
  try {
    if (result.listing !== null) await deps.vfs.writeFile(outputs.listing, result.listing);
    if (result.sRecord !== null) await deps.vfs.writeFile(outputs.sRecord, result.sRecord);
  } catch {
    await deps.messageBox(writeErrorBox());
    return { kind: 'writeFailed' };
  }

  // 7. The assembler's own message boxes.
  for (const dialog of result.dialogs) await deps.messageBox(engineBox(dialog.caption, dialog.text));

  // 8. Messages.
  await routeMessages(deps, id, source, own, result.messages, collected);

  // 9. Summary and the status dialog's contents.
  const previous = store.getState().assemble[id];
  const at = Math.max(deps.clock.now(), previous ? previous.at + 1 : -Infinity);
  store.setState((state) => ({
    ...state,
    assemble: {
      ...state.assemble,
      [id]: {
        errors: result.errorCount,
        warnings: result.warningCount,
        hasSRecord: result.sRecord !== null,
        hasListing: result.listing !== null,
        at,
      },
    },
  }));
  const status: StatusDialogProps = {
    title: statusTitle(doc.name),
    warnings: result.warningCount,
    errors: result.errorCount,
    executeEnabled: result.executeEnabled && result.sRecord !== null,
    sRecordPath: outputs.sRecord,
    listingPath: outputs.listing,
  };
  return { kind: 'done', status, collected };
}

/** Step 8: every message into the list of the document it belongs to. */
async function routeMessages(
  deps: AssembleDeps,
  id: string,
  source: VPath,
  own: VPath | null,
  messages: readonly AsmMessage[],
  collected: CollectedFiles,
): Promise<void> {
  const lists = new Map<string, EditorMessage[]>([[id, []]]);
  const listOf = (docId: string): EditorMessage[] => {
    let list = lists.get(docId);
    if (!list) lists.set(docId, (list = []));
    return list;
  };

  // An include file whose document is open has its list cleared when the INCLUDE starts.
  for (const path of collected.includes) {
    for (const doc of deps.documents.list()) if (doc.id !== id && samePath(doc.path, path)) listOf(doc.id);
  }

  let noticeShown = false;
  /** The document that takes the messages of an include file, by folded path; null = none. */
  const targets = new Map<string, string | null>();
  for (const message of messages) {
    if (message.resolvedFile === null) {
      listOf(id).push(toEditorMessage(message, own));
      continue;
    }
    const path = pathOfKey(collected, message.resolvedFile);
    const folded = foldCase(path);
    if (samePath(path, source)) {
      listOf(id).push(toEditorMessage(message, own));
      continue;
    }
    if (!targets.has(folded)) {
      const open = deps.documents.list().find((doc) => samePath(doc.path, path));
      if (open) {
        if (open.modified && !noticeShown) {
          noticeShown = true;
          await deps.messageBox(includeNoticeBox(basename(path)));
        }
        targets.set(folded, open.id);
      } else {
        const opened = await deps.documents.open(path, { asText: true }).catch(() => null);
        targets.set(folded, opened ? opened.id : null);
        // The assembled document keeps its identity and stays active (1.4 note 18).
        deps.documents.activate(id);
      }
    }
    const target = targets.get(folded) ?? null;
    // An include file that could not be opened keeps its rows in the assembled document's list,
    // where the File column names it.
    listOf(target ?? id).push(toEditorMessage(message, path));
  }
  setMessages(deps.store, lists);
}
