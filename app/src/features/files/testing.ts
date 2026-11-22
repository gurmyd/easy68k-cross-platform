// Test support of the Files panel's operations (ARCHITECTURE-PLUS P3.2; N5's unit tests): a memory
// Vfs with the stores of P4.3, dialogs that answer from a script and record what they showed, a
// fake DocumentService with the optional members of P4.4 (each can be left out), a scripted fake
// of HistoryService, and FilesDeps over all of them. Imported only by tests. Owner: N5.

import type {
  Bytes,
  DialogService,
  DocumentService,
  DocumentState,
  HistoryService,
  HistoryState,
  MessageBoxRequest,
  SeenFile,
  TrashItemInfo,
  VPath,
  Vfs,
} from '../../contracts';
import { MemoryBackend } from '../../fs/memory-backend';
import { createVfs } from '../../fs/vfs';
import type { FilesDeps, UndoEntry } from './bulk';
import { UndoStack, undoEntry } from './undo';

export const ascii = (text: string): Bytes => Uint8Array.from(text, (c) => c.charCodeAt(0));
export const text = (bytes: Bytes): string => String.fromCharCode(...bytes);

/** A Vfs with My Programs (/browser), an opened folder "Lab" (/folder) and a linked store. */
export function memoryStores(): { vfs: Vfs; now: () => number } {
  let time = 1_000;
  const now = () => ++time;
  const vfs = createVfs();
  vfs.mount(new MemoryBackend({ mount: 'browser', kind: 'browser', label: 'My Programs', now }));
  vfs.mount(new MemoryBackend({ mount: 'folder', kind: 'fsaccess', label: 'Folder: Lab', now }));
  return { vfs, now };
}

export interface ShownToast {
  text: string;
  action?: { label: string; run(): void };
}

export interface ScriptedDialogs extends DialogService {
  readonly shown: MessageBoxRequest[];
  readonly toasts: ShownToast[];
  /** The texts of every message box shown, in order. */
  texts(): string[];
}

/**
 * Dialogs whose message boxes answer from `answer` (a list taken in order, or a function of the
 * request); a box without an answer gets its last button ('No' for Yes/No).
 */
export function scriptedDialogs(answer: string[] | ((request: MessageBoxRequest) => string) = []): ScriptedDialogs {
  const shown: MessageBoxRequest[] = [];
  const toasts: ShownToast[] = [];
  return {
    shown,
    toasts,
    texts: () => shown.map((r) => r.text),
    async open<P, R>(_id: string, _props: P): Promise<R> {
      return null as R;
    },
    async messageBox(request) {
      shown.push(request);
      if (typeof answer === 'function') return answer(request);
      const next = answer.shift();
      return next ?? (request.buttons[request.buttons.length - 1] as string);
    },
    toast(textShown, action) {
      toasts.push(action ? { text: textShown, action } : { text: textShown });
    },
    isModalOpen: () => false,
  };
}

export interface FakeDocuments extends DocumentService {
  readonly calls: string[];
  docs: DocumentState[];
}

/** Open documents at `paths`; `modified` lists those with changes. Without `relocate` when asked. */
export function fakeDocuments(
  paths: readonly VPath[] = [],
  options: { modified?: readonly VPath[]; relocate?: boolean } = {},
): FakeDocuments {
  const calls: string[] = [];
  const service: FakeDocuments = {
    calls,
    docs: paths.map((path, i) => ({
      id: `d${i + 1}`,
      path,
      name: path.slice(path.lastIndexOf('/') + 1),
      kind: 'source',
      hasName: true,
      tabType: 0 as never,
      tabSize: 8,
      fontName: 'Courier New',
      fontSize: 11,
      insertMode: true,
      modified: options.modified?.includes(path) ?? false,
      revision: 0,
    })),
    list: () => service.docs,
    active: () => service.docs[0] ?? null,
    text: () => '',
    newSource: () => {
      throw new Error('not in these tests');
    },
    open: async () => null,
    save: async () => true,
    saveAs: async () => true,
    reload: async (id) => void calls.push(`reload ${service.docs.find((d) => d.id === id)?.path}`),
    close: async (id) => {
      calls.push(`close ${service.docs.find((d) => d.id === id)?.path}`);
      service.docs = service.docs.filter((d) => d.id !== id);
      return true;
    },
    closeAll: async () => true,
    activate: () => {},
    update: () => {},
    selection: () => null,
  };
  if (options.relocate !== false) {
    service.relocate = async (from, to) => {
      calls.push(`relocate ${from} -> ${to}`);
      service.docs = service.docs.map((doc) =>
        doc.path !== null && (doc.path === from || doc.path.startsWith(`${from}/`))
          ? { ...doc, path: `${to}${doc.path.slice(from.length)}` }
          : doc,
      );
    };
  }
  return service;
}

/** FilesDeps over the parts, with an undo stack of its own. */
export function filesTestDeps(parts: {
  vfs: Vfs;
  history?: HistoryService;
  dialogs?: ScriptedDialogs;
  documents?: DocumentService;
}): FilesDeps & { stack: UndoStack; dialogs: ScriptedDialogs; undone: VPath[][] } {
  const stack = new UndoStack();
  const undone: VPath[][] = [];
  const deps: FilesDeps & { stack: UndoStack; dialogs: ScriptedDialogs; undone: VPath[][] } = {
    vfs: parts.vfs,
    history: parts.history,
    dialogs: parts.dialogs ?? scriptedDialogs(),
    documents: parts.documents ?? fakeDocuments(),
    now: () => Date.UTC(2026, 10, 22, 12, 0, 0),
    stack,
    undone,
    undo: {
      push: (entry: UndoEntry) => stack.push(entry),
      run: async (entry: UndoEntry, fromToast: boolean) => {
        if (!stack.take(entry)) return [];
        const back = await undoEntry(deps, entry);
        if (fromToast) undone.push(back);
        return back;
      },
    },
  };
  return deps;
}

/** How a scripted guard answers for one path. */
export type GuardScript = 'kept' | 'cannot-keep' | 'fail-act';

/**
 * A fake HistoryService whose guard follows the contract of P4.4 in a few lines: it reads `seen`
 * through the Vfs, keeps (or cannot keep, by `script`), calls act, and records every call. Items
 * get ids `item1`, `item2`, ...; restoreTrash answers `gone` for ids it is told are gone.
 */
export function scriptedHistory(
  vfs: Vfs,
  options: { state?: HistoryState; script?: (path: VPath) => GuardScript } = {},
): HistoryService & { calls: string[]; state: () => HistoryState; setState(state: HistoryState): void } {
  let state: HistoryState = options.state ?? 'ready';
  let next = 0;
  const calls: string[] = [];
  const walk = async (path: VPath, out: SeenFile[]) => {
    const stat = await vfs.stat(path).catch(() => null);
    if (!stat) return;
    if (stat.kind === 'file') {
      out.push({ path, mtime: stat.mtime, size: stat.size });
      return;
    }
    for (const entry of await vfs.list(path)) await walk(`${path}/${entry.name}`, out);
  };
  const history = {
    calls,
    state: () => state,
    setState(value: HistoryState) {
      state = value;
    },
    untracked: () => null,
    record: async (path: VPath, _data: Bytes, reason: string) => void calls.push(`record ${reason} ${path}`),
    async guard(
      path: VPath,
      how: 'delete' | 'replace' | 'restore',
      act: (seen: readonly SeenFile[]) => Promise<void>,
      confirm: () => Promise<boolean>,
    ) {
      calls.push(`guard ${how} ${path}`);
      const seen: SeenFile[] = [];
      await walk(path, seen);
      const script = options.script?.(path) ?? 'kept';
      if (state !== 'ready' || script === 'cannot-keep') {
        if (!(await confirm())) return { outcome: 'declined' as const };
        await act(seen);
        return { outcome: 'not-kept' as const };
      }
      if (script === 'fail-act') throw new Error(`"${path.slice(path.lastIndexOf('/') + 1)}" could not be removed.`);
      await act(seen);
      return seen.length > 0 && how !== 'restore'
        ? { outcome: 'kept' as const, item: `item${++next}` }
        : { outcome: 'kept' as const };
    },
    versions: async () => [],
    read: async () => {
      throw new Error('no version');
    },
    trashItems: async (): Promise<TrashItemInfo[]> => [],
    restoreTrash: async (id: string) => {
      calls.push(`restore ${id}`);
      return { restored: [], left: [], lost: [], gone: true };
    },
    dropTrash: async () => {},
    moved: async (from: VPath, to: VPath) => void calls.push(`moved ${from} -> ${to}`),
    clearVersions: async () => {},
    deleteAll: async () => {},
    usage: async () => ({ versions: 0, versionBytes: 0, trashItems: 0, trashBytes: 0, budget: 0 }),
    subscribe: () => () => {},
  };
  return history;
}
