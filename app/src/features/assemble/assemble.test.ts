// The Assemble feature (ARCHITECTURE.md 4.9, 3.8.3, 5.3; editor-ui §7.3, §10, §20.4) under Node:
// the real document service (E1), the memory file system, and either the scripted FakeAsmEngine
// (the sequence of 4.9, the routing of messages, the dialog's answers) or the real assembler engine
// (the acceptance items of editor-ui §20.4 and the include rules, which need engine/dist).

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  AsmEngine,
  EditorSettings,
  FeatureModule,
  FileDialogs,
  LoadOrigin,
  MessageBoxRequest,
  SimSession,
  VPath,
} from '../../contracts';
import { TabType } from '../../contracts';
import type { DocumentManager } from '../../core/documents/service';
import { createAsmEngine } from '../../engine';
import { FakeAsmEngine, fakeMessage } from '../../engine/fake-asm';
import { bytesOf, textOf } from '../../engine/testing';
import { MemoryBackend } from '../../fs/memory-backend';
import { shellStateOf } from '../../state/shell';
import { createInertSimSession } from '../../state/stub-services';
import { createTestApplication, type TestApplication } from '../../state/testing';
import { createDocumentService } from '../documents';
import { assembleDocument, type AssembleDeps, type StatusDialogProps } from './assemble';
import { FILE_ERROR_TEXT } from './collect';
import { assembleDeps, assembleEnabled, feature } from './index';
import { needsFileColumn } from './MessagesPanel';
import { documentOfMessage, goToMessage, lineRange } from './navigate';
import { asmOptionsFor, outputPaths, sourcePathOf, untitledFolder } from './options';
import { WRITE_ERROR_TEXT, includeNoticeBox, statusTitle } from './texts';

const repo = (path: string) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const asmBuilt = existsSync(repo('engine/dist/asm68k.wasm')) && existsSync(repo('engine/dist/asm68k-loader.mjs'));
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

/* ------------------------------------------------------------------------------- the window */

const flushPromises = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function waitFor(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await flushPromises();
  }
  throw new Error(`Timed out waiting for ${what}`);
}

interface Window {
  app: TestApplication;
  documents: DocumentManager;
  /** Answers of the Save dialog, in order (null = Cancel). */
  saves: (VPath | null)[];
  /** Every message box the assembly asked (the pipeline's deps), in order. */
  boxes: MessageBoxRequest[];
  deps: AssembleDeps;
  /** controller.open calls of the simulator session. */
  loads: [VPath, LoadOrigin][];
  editor(patch: Partial<EditorSettings>): void;
  write(path: VPath, text: string): Promise<void>;
  read(path: VPath): Promise<string | null>;
  type(id: string, text: string): void;
  /** The open dialogs of the window. */
  stack(): { key: number; id: string; props: unknown }[];
  /** Waits for a dialog (of `id`) and answers it. */
  answer(result: string, id?: string): Promise<void>;
}

function openWindow(options: { asm?: AsmEngine; features?: FeatureModule[] } = {}): Window {
  const backend = new MemoryBackend({ mount: 'browser', kind: 'memory', label: 'My Programs' });
  const saves: (VPath | null)[] = [];
  const loads: [VPath, LoadOrigin][] = [];
  const fileDialogs: FileDialogs = {
    open: async () => null,
    save: async () => saves.shift() ?? null,
    chooseFolder: async () => null,
    linkFileHandle: async () => null,
    registerProvider: () => () => {},
  };
  const app = createTestApplication({
    features: options.features ?? [],
    services: {
      createDocumentService,
      createFileDialogs: () => fileDialogs,
      createSimSession: (ctx): SimSession => {
        const session = createInertSimSession(ctx);
        (session.controller as { open: SimSession['controller']['open'] }).open = async (path, origin) => {
          loads.push([path, origin]);
        };
        return session;
      },
    },
    backends: [backend],
    ...(options.asm ? { asm: options.asm } : {}),
  });
  const boxes: MessageBoxRequest[] = [];
  const deps: AssembleDeps = {
    ...assembleDeps(app.ctx),
    asm: options.asm ?? app.asm,
    messageBox: async (request) => {
      boxes.push(request);
      return 'OK';
    },
  };
  const documents = app.ctx.documents as DocumentManager;
  const stack = () => app.ctx.store.getState().dialogs.stack;
  return {
    app,
    documents,
    saves,
    boxes,
    deps,
    loads,
    editor: (patch) => app.ctx.settings.update((s) => ({ ...s, editor: { ...s.editor, ...patch } })),
    write: (path, text) => app.ctx.vfs.writeFile(path, bytesOf(text)),
    read: async (path) => {
      const stat = await app.ctx.vfs.stat(path);
      return stat?.kind === 'file' ? textOf(await app.ctx.vfs.readFile(path)) : null;
    },
    type: (id, text) => void documents.registry.dispatch(id, { changes: { from: 0, insert: text } }),
    stack,
    answer: async (result, id) => {
      await waitFor(
        () => stack().length > 0 && (id === undefined || stack().at(-1)?.id === id),
        `a dialog to ${result}`,
      );
      const top = stack().at(-1)!;
      app.dialogs.close(top.key, result);
      await flushPromises();
    },
  };
}

const messagesOf = (w: Window, id: string) => w.app.ctx.store.getState().messages[id] ?? [];
const activeId = (w: Window) => w.app.ctx.store.getState().documents.activeId;

async function openDoc(w: Window, path: VPath, text: string) {
  await w.write(path, text);
  const doc = await w.documents.open(path);
  if (!doc) throw new Error(`could not open ${path}`);
  return doc;
}

/* ------------------------------------------------------------------------------- pure parts */

describe('options and names (4.9 step 3, 5.3, 3.8.2)', () => {
  it('the eight flags of the Assembler Options and the tab model of the document', () => {
    const w = openWindow();
    const editor = {
      ...w.app.ctx.settings.get().editor,
      generateList: false,
      generateSRecord: true,
      constantsExpanded: true,
      assembleBitField: false,
      crossReference: false,
      macrosExpanded: true,
      structuredExpanded: false,
      showWarnings: false,
    };
    expect(asmOptionsFor(editor, { tabType: TabType.Assembly, tabSize: 8 })).toEqual({
      generateListing: false,
      generateSRecord: true,
      constantsExpanded: true,
      bitFieldInstructions: false,
      crossReference: false,
      macrosExpanded: true,
      structuredExpanded: false,
      showWarnings: false,
      tabType: TabType.Assembly,
      tabSize: 8,
    });
  });

  it('outputs: the last extension replaced by .L68 / .S68, or appended', () => {
    expect(outputPaths('/browser/demo/prog.X68')).toEqual({
      listing: '/browser/demo/prog.L68',
      sRecord: '/browser/demo/prog.S68',
    });
    expect(outputPaths('/browser/a.b/prog.src.asm').listing).toBe('/browser/a.b/prog.src.L68');
    expect(outputPaths('/browser/a.b/noext').sRecord).toBe('/browser/a.b/noext.S68');
    expect(outputPaths('/browser/Untitled/untitled1.x68').listing).toBe('/browser/Untitled/untitled1.L68');
  });

  it('a never-saved document lives in /browser/Untitled, in the desktop app in <userData>/Untitled', () => {
    expect(untitledFolder({ kind: 'web' })).toBe('/browser/Untitled');
    expect(untitledFolder({ kind: 'desktop', userDataDir: '/disk/Users/me/AppData/easy68k' })).toBe(
      '/disk/Users/me/AppData/easy68k/Untitled',
    );
    expect(untitledFolder({ kind: 'desktop', userDataDir: null })).toBe('/browser/Untitled');
    expect(sourcePathOf({ path: null, name: 'untitled3.x68' }, '/browser/Untitled')).toBe(
      '/browser/Untitled/untitled3.x68',
    );
    expect(sourcePathOf({ path: '/browser/x/p.X68', name: 'p.X68' }, '/browser/Untitled')).toBe('/browser/x/p.X68');
  });

  it('lineRange: the whole line without its line break; outside lines give the start or the end', () => {
    const text = 'ab\ncd\nef';
    expect(lineRange(text, 1)).toEqual({ from: 0, to: 2 });
    expect(lineRange(text, 2)).toEqual({ from: 3, to: 5 });
    // The last line of a document without a final line break is selected whole (differences/E5.md).
    expect(lineRange(text, 3)).toEqual({ from: 6, to: 8 });
    expect(lineRange(text, 4)).toEqual({ from: 8, to: 8 });
    expect(lineRange(text, 0)).toEqual({ from: 0, to: 0 });
    expect(lineRange('a\n', 2)).toEqual({ from: 2, to: 2 });
  });

  it('the File column appears only for rows of another file', () => {
    const row = (file: string | null) => ({ file, line: 1, text: 'ERROR: x', severity: 'error' as const });
    expect(needsFileColumn([row('/browser/p/a.X68')], '/browser/p/A.x68')).toBe(false);
    expect(needsFileColumn([row('/browser/p/inc.x68')], '/browser/p/a.X68')).toBe(true);
    expect(needsFileColumn([], null)).toBe(false);
  });

  it('texts are verbatim', () => {
    expect(statusTitle('untitled1.x68')).toBe('Assembler Status - untitled1.x68');
    expect(WRITE_ERROR_TEXT).toBe(
      'File Access Error.  Please verify that you have write permission to the folder where the selected file is located.',
    );
    expect(includeNoticeBox('IO.X68')).toEqual({
      title: 'EASy68K',
      text:
        'An Error occurred in the included file IO.X68.\nThe file is currently open and has been modified.\n' +
        'The line numbers of errors may not be correct.',
      icon: 'none',
      buttons: ['OK'],
    });
  });
});

/* ------------------------------------------------------------------------------- 4.9 with a scripted assembler */

describe('4.9 with a scripted assembler', () => {
  it('step 4: the editor buffer under the main name, the document tab model, the wall time', async () => {
    const w = openWindow();
    const doc = await openDoc(w, '/browser/demo/prog.X68', ' NOP\r\n*~Tab type~0~\r\n*~Tab size~6~\r\n');
    w.type(doc.id, '* edited\n');
    const outcome = await assembleDocument(w.deps, doc.id);
    expect(outcome.kind).toBe('done');
    const call = w.app.asm.calls[0]!;
    expect(call.mainName).toBe('demo/prog.X68');
    expect(textOf(call.files.get('demo/prog.X68')!)).toBe('* edited\r\n NOP\r\n');
    expect(call.options).toMatchObject({ tabType: TabType.Assembly, tabSize: 6, generateListing: true });
    expect(call.timestamp).toEqual(new Date(2026, 10, 20, 12, 0, 0));
  });

  it('Auto Save off: the file on disk is untouched; on: it is saved before assembling (editor-ui §20.4)', async () => {
    const w = openWindow();
    const doc = await openDoc(w, '/browser/demo/prog.X68', ' NOP\r\n');
    w.type(doc.id, '* edit 1\n');
    await assembleDocument(w.deps, doc.id);
    expect(await w.read('/browser/demo/prog.X68')).toBe(' NOP\r\n');
    expect(w.documents.get(doc.id)?.modified).toBe(true);

    w.editor({ saveThenAssemble: true });
    await assembleDocument(w.deps, doc.id);
    expect((await w.read('/browser/demo/prog.X68'))?.startsWith('* edit 1\r\n NOP\r\n')).toBe(true);
    expect(w.documents.get(doc.id)?.modified).toBe(false);
    expect(w.app.asm.calls).toHaveLength(2);
  });

  it('Auto Save on with a never-saved document: Save As; Cancel cancels the assembly', async () => {
    const w = openWindow();
    w.editor({ saveThenAssemble: true });
    const doc = w.documents.newSource();
    w.type(doc.id, '*\n');
    w.saves.push(null);
    expect((await assembleDocument(w.deps, doc.id)).kind).toBe('cancelled');
    expect(w.app.asm.calls).toHaveLength(0);

    w.saves.push('/browser/saved/first.X68');
    const outcome = await assembleDocument(w.deps, doc.id);
    expect(outcome.kind).toBe('done');
    expect(w.app.asm.calls[0]!.mainName).toBe('saved/first.X68');
    expect(await w.read('/browser/saved/first.L68')).not.toBeNull();
    if (outcome.kind === 'done') expect(outcome.status.title).toBe('Assembler Status - first.X68');
  });

  it('a never-saved document assembles in /browser/Untitled and writes its outputs there', async () => {
    const w = openWindow();
    const doc = w.documents.newSource();
    const outcome = await assembleDocument(w.deps, doc.id);
    expect(w.app.asm.calls[0]!.mainName).toBe('Untitled/untitled1.x68');
    expect(await w.read('/browser/Untitled/untitled1.L68')).toBe('');
    expect(await w.read('/browser/Untitled/untitled1.S68')).toBe('');
    expect(outcome).toMatchObject({
      kind: 'done',
      status: {
        title: 'Assembler Status - untitled1.x68',
        warnings: 0,
        errors: 0,
        executeEnabled: true,
        sRecordPath: '/browser/Untitled/untitled1.S68',
        listingPath: '/browser/Untitled/untitled1.L68',
      },
    });
  });

  it('step 2: the messages of the last assembly are cleared first; step 9: the summary', async () => {
    const w = openWindow();
    const doc = await openDoc(w, '/browser/p/a.X68', ' NOP\r\n');
    w.app.asm.enqueue({
      messages: [fakeMessage(1, 'ERROR: Invalid opcode'), fakeMessage(2, 'WARNING: Label too long')],
    });
    const outcome = await assembleDocument(w.deps, doc.id);
    expect(messagesOf(w, doc.id)).toEqual([
      { file: '/browser/p/a.X68', line: 1, text: 'ERROR: Invalid opcode', severity: 'error' },
      { file: '/browser/p/a.X68', line: 2, text: 'WARNING: Label too long', severity: 'warning' },
    ]);
    expect(outcome).toMatchObject({ kind: 'done', status: { errors: 1, warnings: 1, executeEnabled: false } });
    const first = w.app.ctx.store.getState().assemble[doc.id]!;
    expect(first).toMatchObject({ errors: 1, warnings: 1, hasListing: true, hasSRecord: true });

    await assembleDocument(w.deps, doc.id);
    expect(messagesOf(w, doc.id)).toEqual([]);
    const second = w.app.ctx.store.getState().assemble[doc.id]!;
    expect(second).toMatchObject({ errors: 0, warnings: 0 });
    expect(second.at).toBeGreaterThan(first.at);
  });

  it('step 5: a fatal result shows `The assembler stopped: ...`, writes no file and opens no dialog', async () => {
    const w = openWindow();
    const doc = await openDoc(w, '/browser/p/a.X68', ' NOP\r\n');
    w.app.asm.enqueue({
      fatal: 'The assembler stopped abnormally: unreachable',
      status: -1,
      listing: null,
      sRecord: null,
    });
    const outcome = await assembleDocument(w.deps, doc.id);
    expect(outcome).toEqual({
      kind: 'fatal',
      text: 'The assembler stopped: The assembler stopped abnormally: unreachable',
    });
    expect(messagesOf(w, doc.id)).toEqual([
      {
        file: '/browser/p/a.X68',
        line: 0,
        text: 'The assembler stopped: The assembler stopped abnormally: unreachable',
        severity: 'error',
      },
    ]);
    expect(await w.read('/browser/p/a.L68')).toBeNull();
    expect(await w.read('/browser/p/a.S68')).toBeNull();
    expect(w.boxes).toEqual([]);
  });

  it('a fatal result writes no file even when the result carries bytes', async () => {
    const w = openWindow();
    const doc = await openDoc(w, '/browser/p/a.X68', ' NOP\r\n');
    w.app.asm.enqueue({
      fatal: 'The assembler could not start: out of memory',
      listing: bytesOf('L'),
      sRecord: bytesOf('S'),
    });
    expect((await assembleDocument(w.deps, doc.id)).kind).toBe('fatal');
    expect(await w.read('/browser/p/a.L68')).toBeNull();
    expect(await w.read('/browser/p/a.S68')).toBeNull();
  });

  it('an assembler that rejects (an engine that cannot load) is reported like a fatal result', async () => {
    const w = openWindow();
    const doc = await openDoc(w, '/browser/p/a.X68', ' NOP\r\n');
    w.app.asm.enqueue(new Error('The assembler engine could not be loaded: offline'));
    const outcome = await assembleDocument(w.deps, doc.id);
    expect(outcome).toEqual({
      kind: 'fatal',
      text: 'The assembler stopped: The assembler engine could not be loaded: offline',
    });
  });

  it('step 6: a write failure shows the File Access Error box and no status dialog', async () => {
    const w = openWindow();
    const doc = await openDoc(w, '/browser/p/a.X68', ' NOP\r\n');
    const deps: AssembleDeps = {
      ...w.deps,
      vfs: {
        ...w.app.ctx.vfs,
        resolve: w.app.ctx.vfs.resolve,
        readFile: w.app.ctx.vfs.readFile,
        snapshot: w.app.ctx.vfs.snapshot,
        mkdirp: w.app.ctx.vfs.mkdirp,
        writeFile: () => Promise.reject(new Error('read-only')),
      },
    };
    expect(await assembleDocument(deps, doc.id)).toEqual({ kind: 'writeFailed' });
    expect(w.boxes).toEqual([{ title: 'Error', text: WRITE_ERROR_TEXT, icon: 'error', buttons: ['OK'] }]);
  });

  it('step 6: a file whose option is off is neither written nor deleted; Execute needs the S-record', async () => {
    const w = openWindow();
    const doc = await openDoc(w, '/browser/p/a.X68', ' NOP\r\n');
    await w.write('/browser/p/a.L68', 'OLD LISTING');
    await w.write('/browser/p/a.S68', 'OLD SRECORD');
    w.editor({ generateList: false, generateSRecord: false });
    const outcome = await assembleDocument(w.deps, doc.id);
    expect(w.app.asm.calls[0]!.options).toMatchObject({ generateListing: false, generateSRecord: false });
    expect(await w.read('/browser/p/a.L68')).toBe('OLD LISTING');
    expect(await w.read('/browser/p/a.S68')).toBe('OLD SRECORD');
    // 4.9 step 9: the engine says Execute (no errors), but no S-record was written.
    expect(outcome).toMatchObject({ kind: 'done', status: { executeEnabled: false } });
    expect(w.app.ctx.store.getState().assemble[doc.id]).toMatchObject({ hasListing: false, hasSRecord: false });
  });

  it('step 6: existing outputs are replaced without a question', async () => {
    const w = openWindow();
    const doc = await openDoc(w, '/browser/p/a.X68', ' NOP\r\n');
    await w.write('/browser/p/a.L68', 'OLD');
    w.app.asm.enqueue({ listing: bytesOf('NEW L68'), sRecord: bytesOf('NEW S68') });
    await assembleDocument(w.deps, doc.id);
    expect(await w.read('/browser/p/a.L68')).toBe('NEW L68');
    expect(await w.read('/browser/p/a.S68')).toBe('NEW S68');
    expect(w.boxes).toEqual([]);
  });

  it('step 7: the assembler message boxes, in order, with their captions', async () => {
    const w = openWindow();
    const doc = await openDoc(w, '/browser/p/a.X68', ' NOP\r\n');
    w.app.asm.enqueue({
      dialogs: [
        { caption: 'Error', text: 'Unable to create S-Record file' },
        { caption: 'Other', text: 'x' },
      ],
    });
    await assembleDocument(w.deps, doc.id);
    expect(w.boxes).toEqual([
      { title: 'Error', text: 'Unable to create S-Record file', icon: 'error', buttons: ['OK'] },
      { title: 'Other', text: 'x', icon: 'none', buttons: ['OK'] },
    ]);
  });

  it('step 8: a message of an include file opens it, goes to its list, and the assembled document stays active', async () => {
    const w = openWindow();
    await w.write('/browser/p/inc/Macros.x68', ' BAD\r\n');
    const doc = await openDoc(w, '/browser/p/main.X68', " INCLUDE 'inc\\macros.x68'\r\n");
    w.app.asm.enqueue({
      messages: [
        { ...fakeMessage(1, 'ERROR: Invalid opcode'), file: 'inc\\macros.x68', resolvedFile: 'p/inc/Macros.x68' },
        fakeMessage(2, 'WARNING: END directive missing, starting address not set'),
      ],
    });
    await assembleDocument(w.deps, doc.id);
    const include = w.documents.list().find((d) => d.path === '/browser/p/inc/Macros.x68');
    expect(include).toBeDefined();
    expect(activeId(w)).toBe(doc.id);
    expect(messagesOf(w, include!.id)).toEqual([
      { file: '/browser/p/inc/Macros.x68', line: 1, text: 'ERROR: Invalid opcode', severity: 'error' },
    ]);
    expect(messagesOf(w, doc.id)).toEqual([
      {
        file: '/browser/p/main.X68',
        line: 2,
        text: 'WARNING: END directive missing, starting address not set',
        severity: 'warning',
      },
    ]);
    // The row of the include file points at the include document.
    expect(documentOfMessage(w.app.ctx, messagesOf(w, include!.id)[0]!, doc.id)).toBe(include!.id);
    expect(w.boxes).toEqual([]);
  });

  it('step 8: an open, modified include file gets the notice once and its list is cleared first', async () => {
    const w = openWindow();
    const a = await openDoc(w, '/browser/p/a.x68', ' BAD\r\n');
    const b = await openDoc(w, '/browser/p/b.x68', ' BAD\r\n');
    const c = await openDoc(w, '/browser/p/c.x68', ' NOP\r\n');
    w.type(a.id, '*\n');
    w.type(b.id, '*\n');
    w.app.ctx.store.setState((s) => ({
      ...s,
      messages: {
        ...s.messages,
        [c.id]: [{ file: '/browser/p/c.x68', line: 1, text: 'ERROR: old', severity: 'error' }],
      },
    }));
    const doc = await openDoc(w, '/browser/p/main.X68', ' INCLUDE A.X68\r\n INCLUDE b.x68\r\n INCLUDE c.x68\r\n');
    w.app.asm.enqueue({
      messages: [
        { ...fakeMessage(1, 'ERROR: Invalid opcode'), file: 'A.X68', resolvedFile: 'p/a.x68' },
        { ...fakeMessage(1, 'ERROR: Invalid opcode'), file: 'B.X68', resolvedFile: 'p/b.x68' },
      ],
    });
    await assembleDocument(w.deps, doc.id);
    expect(w.boxes).toEqual([includeNoticeBox('a.x68')]);
    expect(messagesOf(w, a.id)).toHaveLength(1);
    expect(messagesOf(w, b.id)).toHaveLength(1);
    expect(messagesOf(w, c.id)).toEqual([]);
    expect(activeId(w)).toBe(doc.id);
  });

  it('a second, macro-built include name is found through the program directory (3.8.3 step 3)', async () => {
    const w = openWindow();
    await w.write('/browser/m/part.x68', 'p');
    const doc = await openDoc(w, '/browser/m/main.X68', ' INCLUDE \\1\r\n');
    w.app.asm.enqueue({ messages: [fakeMessage(1, FILE_ERROR_TEXT)] }, {});
    const outcome = await assembleDocument(w.deps, doc.id);
    expect(w.app.asm.calls).toHaveLength(2);
    expect(outcome).toMatchObject({ kind: 'done', status: { errors: 0 } });
    expect(messagesOf(w, doc.id)).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------- the feature */

describe('the feature: commands, the status dialog, Execute, Load L68, Clear', () => {
  it('registers ed.project.assemble, ed.msg.clear, the Messages panel of Editor mode and asm.status', () => {
    expect(Object.keys(feature.commands ?? {})).toEqual(['ed.project.assemble', 'ed.msg.clear']);
    expect(feature.panels?.map((p) => [p.id, p.mode])).toEqual([['messages', 'editor']]);
    expect(Object.keys(feature.dialogs ?? {})).toEqual(['asm.status']);
  });

  it('Assemble is enabled while a document is active and a source document is open (editor-ui §2.7)', async () => {
    const w = openWindow({ features: [feature] });
    expect(w.app.ctx.commands.isEnabled('ed.project.assemble')).toBe(false);
    const src = w.documents.newSource();
    expect(w.app.ctx.commands.isEnabled('ed.project.assemble')).toBe(true);
    await openDoc(w, '/browser/p/x.L68', 'listing');
    // The original's flag is global: an active list document can be assembled while a source is open.
    expect(w.app.ctx.commands.isEnabled('ed.project.assemble')).toBe(true);
    await w.documents.close(src.id);
    expect(assembleEnabled(w.app.ctx.store.getState())).toBe(false);
  });

  it('F9 opens `asm.status` with the counts; Execute switches to Simulator mode and loads with origin execute', async () => {
    const w = openWindow({ features: [feature] });
    const doc = await openDoc(w, '/browser/demo/prog.X68', ' NOP\r\n');
    const run = w.app.ctx.commands.run('ed.project.assemble');
    await waitFor(() => w.stack().length > 0, 'the status dialog');
    const top = w.stack().at(-1)!;
    expect(top.id).toBe('asm.status');
    expect(top.props as StatusDialogProps).toEqual({
      title: 'Assembler Status - prog.X68',
      warnings: 0,
      errors: 0,
      executeEnabled: true,
      sRecordPath: '/browser/demo/prog.S68',
      listingPath: '/browser/demo/prog.L68',
    });
    expect(w.app.ctx.store.getState().dialogs.stack.at(-1)?.modal).toBe(true);
    await w.answer('execute', 'asm.status');
    await run;
    expect(w.app.ctx.store.getState().mode).toBe('simulator');
    expect(w.loads).toEqual([['/browser/demo/prog.S68', 'execute']]);
    expect(activeId(w)).toBe(doc.id);
  });

  it('Load L68 opens the listing as a list document; Close does nothing', async () => {
    const w = openWindow({ features: [feature] });
    await openDoc(w, '/browser/demo/prog.X68', ' NOP\r\n');
    w.app.asm.enqueue({ listing: bytesOf('LISTING\r\n') });
    let run = w.app.ctx.commands.run('ed.project.assemble');
    await w.answer('loadL68', 'asm.status');
    await run;
    const listing = w.documents.list().find((d) => d.path === '/browser/demo/prog.L68');
    expect(listing?.kind).toBe('list');
    expect(activeId(w)).toBe(listing?.id);
    expect(w.loads).toEqual([]);

    const count = w.documents.list().length;
    run = w.app.ctx.commands.run('ed.project.assemble');
    await w.answer('close', 'asm.status');
    await run;
    expect(w.documents.list()).toHaveLength(count);
    expect(w.app.ctx.store.getState().mode).toBe('editor');
  });

  it('Execute is refused when the dialog had it disabled', async () => {
    const w = openWindow({ features: [feature] });
    await openDoc(w, '/browser/demo/prog.X68', ' BAD\r\n');
    w.app.asm.enqueue({ messages: [fakeMessage(1, 'ERROR: Invalid opcode')] });
    const run = w.app.ctx.commands.run('ed.project.assemble');
    await waitFor(() => w.stack().length > 0, 'the status dialog');
    expect((w.stack().at(-1)!.props as StatusDialogProps).executeEnabled).toBe(false);
    await w.answer('execute', 'asm.status');
    await run;
    expect(w.loads).toEqual([]);
  });

  it('a second F9 during an assembly is ignored', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fake = new FakeAsmEngine();
    const slow: AsmEngine = {
      assemble: async (...args) => {
        await gate;
        return fake.assemble(...args);
      },
    };
    const w = openWindow({ features: [feature], asm: slow });
    await openDoc(w, '/browser/demo/prog.X68', ' NOP\r\n');
    const first = w.app.ctx.commands.run('ed.project.assemble');
    await flushPromises();
    expect(w.app.ctx.commands.isEnabled('ed.project.assemble')).toBe(false);
    await w.app.ctx.commands.run('ed.project.assemble');
    release();
    await w.answer('close', 'asm.status');
    await first;
    expect(fake.calls).toHaveLength(1);
    expect(w.app.ctx.commands.isEnabled('ed.project.assemble')).toBe(true);
  });

  it('ed.msg.clear empties the active document list (and so its markers)', async () => {
    const w = openWindow({ features: [feature] });
    const doc = await openDoc(w, '/browser/demo/prog.X68', ' BAD\r\n');
    expect(w.app.ctx.commands.isEnabled('ed.msg.clear')).toBe(false);
    w.app.asm.enqueue({ messages: [fakeMessage(1, 'ERROR: Invalid opcode')] });
    const run = w.app.ctx.commands.run('ed.project.assemble');
    await w.answer('close', 'asm.status');
    await run;
    expect(messagesOf(w, doc.id)).toHaveLength(1);
    expect(w.app.ctx.commands.isEnabled('ed.msg.clear')).toBe(true);
    await w.app.ctx.commands.run('ed.msg.clear');
    expect(messagesOf(w, doc.id)).toEqual([]);
    // The summary stays: the shell then collapses the list to 7 px (editor-ui §4.2).
    expect(w.app.ctx.store.getState().assemble[doc.id]).toBeDefined();
  });

  it('goToMessage selects the row line in the registry state and asks for the editor focus', async () => {
    const w = openWindow({ features: [feature] });
    const doc = await openDoc(w, '/browser/demo/prog.X68', 'one\r\ntwo\r\nthree');
    goToMessage(w.app.ctx, doc.id, { file: '/browser/demo/prog.X68', line: 2, text: 'ERROR: x', severity: 'error' });
    const selection = w.documents.registry.state(doc.id).selection.main;
    expect([selection.from, selection.to]).toEqual([4, 7]);
    expect(shellStateOf(w.app.ctx).getState().focusRequest?.panel).toBe('editor');
  });
});

/* ------------------------------------------------------------------------------- the real assembler */

describe('engine/dist', () => {
  it.runIf(enginesRequired && !asmBuilt)('holds the assembler (EASY68K_REQUIRE_ENGINES=1)', () => {
    expect.fail(
      'EASY68K_REQUIRE_ENGINES is 1 but engine/dist/asm68k.wasm or asm68k-loader.mjs is missing: ' +
        'run `npm run build:engines` first. Without the variable these tests are skipped.',
    );
  });
});

describe.skipIf(!asmBuilt)('with the real assembler (editor-ui §20.4; needs engine/dist)', { timeout: 60_000 }, () => {
  const realWindow = async (features: FeatureModule[] = [feature]) =>
    openWindow({ features, asm: await createAsmEngine() });

  it('F9 on the template: Warnings 0, Errors 0, Execute enabled; untitled1.L68 and untitled1.S68 created', async () => {
    const w = await realWindow();
    const doc = w.documents.newSource();
    const outcome = await assembleDocument(w.deps, doc.id);
    expect(outcome).toMatchObject({
      kind: 'done',
      status: { title: 'Assembler Status - untitled1.x68', warnings: 0, errors: 0, executeEnabled: true },
    });
    const listing = await w.read('/browser/Untitled/untitled1.L68');
    expect(listing).toContain('No errors detected\r\nNo warnings generated');
    expect(listing).toMatch(/^00001000 +8 {2}START: +; first instruction of program\r$/m);
    expect(listing).toContain('00001000  FFFF FFFF                 12      SIMHALT');
    expect((await w.read('/browser/Untitled/untitled1.S68'))?.startsWith('S0')).toBe(true);
    expect(messagesOf(w, doc.id)).toEqual([]);
  });

  it('one bad opcode: Errors 1, Execute disabled, one row; double-click selects that line', async () => {
    const w = await realWindow();
    const doc = await openDoc(
      w,
      '/browser/t/bad.X68',
      '    ORG $1000\r\nSTART:\r\n    FOO D0\r\n    SIMHALT\r\n    END START\r\n',
    );
    const outcome = await assembleDocument(w.deps, doc.id);
    expect(outcome).toMatchObject({ kind: 'done', status: { errors: 1, warnings: 0, executeEnabled: false } });
    expect(messagesOf(w, doc.id)).toEqual([
      { file: '/browser/t/bad.X68', line: 3, text: 'ERROR: Invalid opcode', severity: 'error' },
    ]);
    goToMessage(w.app.ctx, doc.id, messagesOf(w, doc.id)[0]!);
    const { from, to } = w.documents.registry.state(doc.id).selection.main;
    expect(w.documents.text(doc.id).slice(from, to)).toBe('    FOO D0');
  });

  it('no END: Warnings 1 with its row; with Show Warnings off the row is absent but the count stays', async () => {
    const w = await realWindow();
    const doc = await openDoc(w, '/browser/t/noend.X68', '    ORG $1000\r\n    NOP\r\n');
    let outcome = await assembleDocument(w.deps, doc.id);
    expect(outcome).toMatchObject({ kind: 'done', status: { warnings: 1, errors: 0, executeEnabled: true } });
    expect(messagesOf(w, doc.id).map((m) => [m.line, m.text])).toEqual([
      [3, 'WARNING: END directive missing, starting address not set'],
    ]);
    w.editor({ showWarnings: false });
    outcome = await assembleDocument(w.deps, doc.id);
    expect(outcome).toMatchObject({ kind: 'done', status: { warnings: 1, errors: 0 } });
    expect(messagesOf(w, doc.id)).toEqual([]);
  });

  it('Auto Save off: the outputs reflect the edited text while the file is unchanged', async () => {
    const w = await realWindow();
    const doc = await openDoc(w, '/browser/t/edit.X68', '    ORG $1000\r\n    NOP\r\n    END $1000\r\n');
    w.type(doc.id, '* EDITED LINE\n');
    await assembleDocument(w.deps, doc.id);
    expect(await w.read('/browser/t/edit.X68')).toBe('    ORG $1000\r\n    NOP\r\n    END $1000\r\n');
    expect(await w.read('/browser/t/edit.L68')).toContain('* EDITED LINE');
  });

  it('include resolution: quoted, unquoted, other case, backslash path, `..` into a sibling, a macro-built name', async () => {
    const w = await realWindow();
    await w.write('/browser/course/lab1/Defs.X68', 'ONE EQU $11\r\n');
    await w.write('/browser/course/lab1/sub/Two.x68', ' DC.B $22\r\n');
    await w.write('/browser/course/Shared/three.X68', ' DC.B $33\r\n');
    await w.write('/browser/course/Shared/blob.bin', '\x44\x55');
    await w.write('/browser/course/lab1/four.x68', ' DC.B $66\r\n');
    const source = [
      '    ORG $1000',
      "    INCLUDE 'defs.x68'",
      '    DC.B ONE',
      '    INCLUDE SUB\\TWO.X68',
      '    INCLUDE "../shared/THREE.x68"',
      "    INCBIN '..\\Shared\\BLOB.BIN'",
      'INC MACRO',
      '    INCLUDE \\1',
      '    ENDM',
      '    INC four.x68',
      '    END $1000',
      '',
    ].join('\r\n');
    const doc = await openDoc(w, '/browser/course/lab1/prog.X68', source);
    const outcome = await assembleDocument(w.deps, doc.id);
    expect(messagesOf(w, doc.id)).toEqual([]);
    expect(outcome).toMatchObject({ kind: 'done', status: { errors: 0, warnings: 0 } });
    if (outcome.kind === 'done') expect(outcome.collected.snapshot).toBe(true);
    const sRecord = (await w.read('/browser/course/lab1/prog.S68')) ?? '';
    // S1 record at $1000: 11 22 33 44 55 66.
    expect(sRecord).toMatch(/^S1091000112233445566[0-9A-F]{2}\r$/m);
  });

  it('include names as Win32 opens them: `..` after a folder that does not exist, trailing dots and spaces', async () => {
    // Win32 normalises a name lexically before it opens it (GetFullPathName): `q\..` cancels out
    // whether or not q exists, and trailing dots and spaces of every component are dropped. The
    // engine's own file layer does the same (engine/asm/shim/ez_file.cpp, ezCanonicalPath); the
    // files must also reach it, including those outside the program directory, which the snapshot
    // retry does not add (gate I2, review of E5).
    const w = await realWindow();
    await w.write('/browser/root.x68', ' DC.B $11\r\n');
    await w.write('/browser/course/Shared/three.X68', ' DC.B $22\r\n');
    await w.write('/browser/course/Shared/blob.bin', '\x33');
    await w.write('/browser/course/Lib/four.x68', ' DC.B $44\r\n');
    const source = [
      '    ORG $1000',
      "    INCLUDE '..\\..\\nothere\\..\\root.x68'",
      "    INCLUDE '..\\Shared\\three.X68.'",
      "    INCBIN '..\\Shared.\\blob.bin . '",
      "    INCLUDE '..\\missing\\..\\Lib. \\four.x68'",
      '    END $1000',
      '',
    ].join('\r\n');
    const doc = await openDoc(w, '/browser/course/lab1/prog.X68', source);
    const outcome = await assembleDocument(w.deps, doc.id);
    expect(messagesOf(w, doc.id)).toEqual([]);
    expect(outcome).toMatchObject({ kind: 'done', status: { errors: 0, warnings: 0 } });
    if (outcome.kind === 'done') {
      expect(outcome.collected.snapshot).toBe(false);
      expect(outcome.collected.includes).toEqual([
        '/browser/root.x68',
        '/browser/course/Shared/three.X68',
        '/browser/course/Lib/four.x68',
      ]);
    }
    const sRecord = (await w.read('/browser/course/lab1/prog.S68')) ?? '';
    // S1 record at $1000: 11 22 33 44.
    expect(sRecord).toMatch(/^S107100011223344[0-9A-F]{2}\r$/m);
  });

  it('a message of an include file opens that file and keeps the assembled document active', async () => {
    const w = await realWindow();
    await w.write('/browser/inc/Lib.x68', '* library\r\n    BADOP\r\n');
    const doc = await openDoc(w, '/browser/inc/main.X68', '    ORG $1000\r\n    INCLUDE lib.x68\r\n    END $1000\r\n');
    const outcome = await assembleDocument(w.deps, doc.id);
    expect(outcome).toMatchObject({ kind: 'done', status: { errors: 1, title: 'Assembler Status - main.X68' } });
    const lib = w.documents.list().find((d) => d.path === '/browser/inc/Lib.x68');
    expect(lib).toBeDefined();
    expect(activeId(w)).toBe(doc.id);
    expect(messagesOf(w, lib!.id)).toEqual([
      { file: '/browser/inc/Lib.x68', line: 2, text: 'ERROR: Invalid opcode', severity: 'error' },
    ]);
    expect(messagesOf(w, doc.id)).toEqual([]);
  });

  it('Load L68 opens <name>.L68 as an uncoloured list document; Execute hands the S-record over', async () => {
    const w = await realWindow();
    await openDoc(w, '/browser/t/run.X68', '    ORG $1000\r\n    SIMHALT\r\n    END $1000\r\n');
    let run = w.app.ctx.commands.run('ed.project.assemble');
    await w.answer('loadL68', 'asm.status');
    await run;
    const listing = w.documents.list().find((d) => d.path === '/browser/t/run.L68');
    expect(listing?.kind).toBe('list');
    expect(w.documents.text(listing!.id)).toContain('SIMHALT');

    w.documents.activate(w.documents.list().find((d) => d.path === '/browser/t/run.X68')!.id);
    run = w.app.ctx.commands.run('ed.project.assemble');
    await w.answer('execute', 'asm.status');
    await run;
    expect(w.loads).toEqual([['/browser/t/run.S68', 'execute']]);
    expect(w.app.ctx.store.getState().mode).toBe('simulator');
  });
});
