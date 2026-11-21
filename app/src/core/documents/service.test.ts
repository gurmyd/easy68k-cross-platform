// Tests of DocumentManager (ARCHITECTURE.md 3.9, 3.8.6; editor-ui §6, §12, §20.2) with an in-memory
// file system and scripted dialogs.

import { describe, expect, it } from 'vitest';
import { TabType, type DocumentService, type MessageBoxRequest, type SaveRequest } from '../../contracts';
import { MemoryBackend } from '../../fs/memory-backend';
import { createVfs, fsError } from '../../fs/vfs';
import { writeError } from './messages';
import { createAppStore } from '../../state/store';
import { defaultSettings, DEFAULT_TEMPLATE } from '../settings/defaults';
import { encodeFile } from './format';
import { DocumentManager, isListPath, kindAfterSaveAs } from './service';

const bytes = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));
const latin = (data: Uint8Array) => String.fromCharCode(...data);
const TRAILER = '*~Font name~Courier New~\r\n*~Font size~10~\r\n*~Tab type~1~\r\n*~Tab size~4~\r\n';

function setup() {
  let time = 1000;
  const backend = new MemoryBackend({
    mount: 'browser',
    kind: 'memory',
    label: 'My Programs',
    now: () => (time += 10),
  });
  const vfs = createVfs();
  vfs.mount(backend);
  const settings = defaultSettings();
  const store = createAppStore(settings);
  const asked: MessageBoxRequest[] = [];
  const answers: string[] = [];
  const toasts: string[] = [];
  const saveTargets: (string | null)[] = [];
  const saveRequests: SaveRequest[] = [];
  const manager = new DocumentManager({
    store,
    settings: { get: () => settings },
    dialogs: {
      messageBox: async (request) => {
        asked.push(request);
        const answer = answers.shift();
        if (answer === undefined) throw new Error(`Unexpected message box: ${request.text}`);
        return answer;
      },
      toast: (text) => void toasts.push(text),
    },
    vfs,
    fileDialogs: {
      open: async () => null,
      save: async (request) => {
        saveRequests.push(request);
        return saveTargets.shift() ?? null;
      },
    },
  });
  const type = (id: string, text: string, at = 0) =>
    manager.registry.dispatch(id, { changes: { from: at, insert: text } });
  return { backend, vfs, settings, store, manager, asked, answers, toasts, saveTargets, saveRequests, type };
}

describe('New (editor-ui §12.1)', () => {
  it('creates untitled1.x68, untitled2.x68 ... with the template, not modified, Editor Options settings', () => {
    const t = setup();
    t.settings.editor.tabType = TabType.Assembly;
    t.settings.editor.fixedTabSize = 6;
    const first = t.manager.newSource();
    const second = t.manager.newSource();
    expect([first.name, second.name]).toEqual(['untitled1.x68', 'untitled2.x68']);
    expect(first).toMatchObject({
      kind: 'source',
      hasName: false,
      path: null,
      modified: false,
      tabType: 0,
      tabSize: 6,
    });
    expect(first).toMatchObject({ fontName: 'Courier New', fontSize: 10, insertMode: true, revision: 0 });
    expect(t.manager.text(first.id)).toBe(DEFAULT_TEMPLATE);
    expect(t.store.getState().documents).toEqual({ items: [first, second], activeId: second.id });
  });

  it('counts a text change in revision and modified, and undoing to the saved text clears modified', () => {
    const t = setup();
    const doc = t.manager.newSource();
    t.type(doc.id, 'X');
    expect(t.manager.active()).toMatchObject({ modified: true, revision: 1 });
    t.manager.registry.dispatch(doc.id, { changes: { from: 0, to: 1 } });
    expect(t.manager.active()).toMatchObject({ modified: false, revision: 2 });
    t.manager.registry.dispatch(doc.id, { selection: { anchor: 3 } });
    expect(t.manager.active()?.revision).toBe(2);
  });
});

describe('Open (editor-ui §6.2, §6.3)', () => {
  it('a missing file shows the File Access Error box', async () => {
    const t = setup();
    t.answers.push('OK');
    expect(await t.manager.open('/browser/missing.X68')).toBeNull();
    expect(t.asked).toEqual([
      {
        title: 'Error',
        text: 'File Access Error.  Please verify the file name and that you have the proper permissions to open the file.',
        icon: 'error',
        buttons: ['OK'],
      },
    ]);
  });

  it('opens a source: trailer removed, settings from it, not modified', async () => {
    const t = setup();
    await t.vfs.writeFile('/browser/p.X68', bytes('A\r\n\r\n*~Font name~Fixedsys~\r\n*~Tab type~0~\r\n'));
    const doc = await t.manager.open('/browser/p.X68');
    expect(doc).toMatchObject({
      name: 'p.X68',
      path: '/browser/p.X68',
      kind: 'source',
      hasName: true,
      modified: false,
    });
    expect(doc).toMatchObject({ fontName: 'Fixedsys', tabType: TabType.Assembly, tabSize: 4, fontSize: 10 });
    expect(t.manager.text(doc!.id)).toBe('A\n\n');
    expect(t.store.getState().documents.activeId).toBe(doc!.id);
  });

  it('.L68 and .S68 in any case open as list documents: no trailer processing, tab type 0 and size 0', async () => {
    const t = setup();
    await t.vfs.writeFile('/browser/p.l68', bytes('00001000  ORG\r\n*~Tab type~1~\r\n'));
    const doc = await t.manager.open('/browser/p.l68');
    expect(doc).toMatchObject({ kind: 'list', tabType: 0, tabSize: 0, fontName: 'Courier New', fontSize: 10 });
    expect(t.manager.text(doc!.id)).toBe('00001000  ORG\n*~Tab type~1~\n');
    expect(isListPath('/x/a.S68')).toBe(true);
    expect(isListPath('/x/a.X68')).toBe(false);
  });

  it('an open, unmodified file is replaced in its tab without a question', async () => {
    const t = setup();
    const a = t.manager.newSource();
    await t.vfs.writeFile('/browser/p.X68', bytes('one\r\n'));
    const first = await t.manager.open('/browser/p.X68');
    t.manager.newSource();
    await t.vfs.writeFile('/browser/p.X68', bytes('two\r\n'));
    const second = await t.manager.open('/browser/p.X68');
    expect(t.asked).toEqual([]);
    expect(second!.id).not.toBe(first!.id);
    expect(t.manager.list().map((doc) => doc.name)).toEqual([a.name, 'p.X68', 'untitled2.x68']);
    expect(t.manager.text(second!.id)).toBe('two\n');
  });

  it('an open, modified file: the "already open" question; No keeps it, Yes reopens', async () => {
    const t = setup();
    await t.vfs.writeFile('/browser/p.X68', bytes('one\r\n'));
    const first = (await t.manager.open('/browser/p.X68'))!;
    t.type(first.id, 'edit ');
    t.manager.newSource();
    t.answers.push('No');
    expect(await t.manager.open('/browser/p.X68')).toBeNull();
    expect(t.asked.at(-1)).toEqual({
      title: 'Confirm',
      text: 'p.X68 is already open. Do you want to discard changes and reopen?',
      icon: 'confirmation',
      buttons: ['Yes', 'No'],
    });
    expect(t.manager.active()?.id).toBe(first.id);
    expect(t.manager.text(first.id)).toBe('edit one\n');
    t.answers.push('Yes');
    const again = (await t.manager.open('/browser/p.X68'))!;
    expect(t.manager.text(again.id)).toBe('one\n');
    expect(t.manager.list().map((doc) => doc.id)).toEqual([again.id, expect.any(String)]);
  });

  it('the path is compared exactly: another letter case is another document', async () => {
    const t = setup();
    await t.vfs.writeFile('/browser/p.X68', bytes('one\r\n'));
    const a = (await t.manager.open('/browser/p.X68'))!;
    t.type(a.id, 'x');
    await t.vfs.writeFile('/browser/P.X68', bytes('two\r\n'));
    await t.manager.open('/browser/P.X68');
    expect(t.asked).toEqual([]);
    expect(t.manager.list()).toHaveLength(2);
  });

  it('a UTF-8 file opens as its Windows-1252 bytes with the banner text', async () => {
    const t = setup();
    await t.vfs.writeFile('/browser/u.X68', new TextEncoder().encode('* café\r\n'));
    const doc = (await t.manager.open('/browser/u.X68'))!;
    expect(t.manager.text(doc.id)).toBe('* cafÃ©\n');
    expect(t.toasts).toEqual(['This file looks like UTF-8. EASy68K reads it as Windows-1252.']);
  });

  it('a malformed trailer line shows Error in LoadFile() and still opens the document', async () => {
    const t = setup();
    await t.vfs.writeFile('/browser/m.X68', bytes('A\r\n*~Tab size~4\r\n'));
    t.answers.push('OK');
    const doc = (await t.manager.open('/browser/m.X68'))!;
    expect(t.asked.map((request) => [request.title, request.text])).toEqual([['Information', 'Error in LoadFile()']]);
    expect(t.manager.text(doc.id)).toBe('A\n*~Tab size~4\n');
  });
});

describe('Save and Save As (editor-ui §6.4, 3.9.3)', () => {
  it('a new document saved as t.X68: template, CR LF, trailer (§20.2); then named and not modified', async () => {
    const t = setup();
    const doc = t.manager.newSource();
    t.saveTargets.push('/browser/t.X68');
    expect(await t.manager.save(doc.id)).toBe(true);
    expect(t.saveRequests).toEqual([
      {
        title: 'Save As',
        filters: [
          { label: '68K Source File  [.X68]', patterns: ['*.X68'] },
          { label: 'Any File  [*.*]', patterns: ['*.*'] },
        ],
        defaultExt: '.X68',
      },
    ]);
    const file = await t.vfs.readFile('/browser/t.X68');
    expect(latin(file)).toBe(`${DEFAULT_TEMPLATE.replace(/\n/g, '\r\n')}\r\n${TRAILER}`);
    expect(file.length).toBe(420 + 2 + TRAILER.length);
    expect(t.manager.active()).toMatchObject({ name: 't.X68', path: '/browser/t.X68', hasName: true, modified: false });
  });

  it('the same text saved as t.ASM gets no trailer', async () => {
    const t = setup();
    const doc = t.manager.newSource();
    t.saveTargets.push('/browser/t.ASM');
    expect(await t.manager.saveAs(doc.id)).toBe(true);
    expect(latin(await t.vfs.readFile('/browser/t.ASM'))).toBe(DEFAULT_TEMPLATE.replace(/\n/g, '\r\n'));
  });

  it('Save of a named document writes without a dialog; Save As suggests the current path', async () => {
    const t = setup();
    await t.vfs.writeFile('/browser/p.X68', bytes('A\r\n'));
    const doc = (await t.manager.open('/browser/p.X68'))!;
    t.type(doc.id, 'B');
    expect(await t.manager.save(doc.id)).toBe(true);
    expect(t.saveRequests).toEqual([]);
    expect(latin(await t.vfs.readFile('/browser/p.X68'))).toBe(`BA\r\n\r\n${TRAILER}`);
    t.saveTargets.push(null);
    expect(await t.manager.saveAs(doc.id)).toBe(false);
    expect(t.saveRequests[0]?.suggested).toBe('/browser/p.X68');
  });

  it('Save As: only ".X68" spelled exactly turns a list into a source; nothing turns a source into a list', async () => {
    expect(kindAfterSaveAs('list', '/browser/a.X68')).toBe('source');
    expect(kindAfterSaveAs('list', '/browser/a.x68')).toBe('list');
    expect(kindAfterSaveAs('source', '/browser/a.L68')).toBe('source');
    const t = setup();
    await t.vfs.writeFile('/browser/p.L68', bytes('LIST\r\n'));
    const doc = (await t.manager.open('/browser/p.L68'))!;
    t.saveTargets.push('/browser/q.x68');
    await t.manager.saveAs(doc.id);
    expect(t.manager.active()?.kind).toBe('list');
    expect(latin(await t.vfs.readFile('/browser/q.x68'))).toBe('LIST\r\n');
    t.saveTargets.push('/browser/q.X68');
    await t.manager.saveAs(doc.id);
    expect(t.manager.active()?.kind).toBe('source');
    expect(latin(await t.vfs.readFile('/browser/q.X68'))).toBe(
      'LIST\r\n\r\n*~Font name~Courier New~\r\n*~Font size~10~\r\n*~Tab type~0~\r\n*~Tab size~0~\r\n',
    );
  });

  it('asks once per document before saving characters that have no Windows-1252 byte', async () => {
    const t = setup();
    const doc = t.manager.newSource();
    t.type(doc.id, '中文');
    t.saveTargets.push('/browser/u.txt');
    t.answers.push('Cancel');
    expect(await t.manager.save(doc.id)).toBe(false);
    expect(t.asked[0]).toEqual({
      title: 'Warning',
      text: 'This file contains 2 characters that EASy68K cannot store. They will be saved as "?".',
      icon: 'warning',
      buttons: ['OK', 'Cancel'],
    });
    t.answers.push('OK');
    t.saveTargets.push('/browser/u.txt');
    expect(await t.manager.save(doc.id)).toBe(true);
    expect(latin(await t.vfs.readFile('/browser/u.txt')).startsWith('??*---')).toBe(true);
    t.type(doc.id, '中');
    expect(await t.manager.save(doc.id)).toBe(true);
    expect(t.asked).toHaveLength(2);
  });

  it('asks the question of 3.8.6 when the file changed in storage since it was loaded or saved', async () => {
    const t = setup();
    await t.vfs.writeFile('/browser/p.X68', bytes('A\r\n'));
    const doc = (await t.manager.open('/browser/p.X68'))!;
    t.type(doc.id, 'mine ');
    // Another window writes the file (straight to the backend, as through its own Vfs).
    await t.backend.writeFile('p.X68', bytes('theirs\r\n'));
    t.answers.push('No');
    expect(await t.manager.save(doc.id)).toBe(false);
    expect(t.asked.at(-1)).toEqual({
      title: 'Confirm',
      text: "'p.X68' has been changed outside this window. Save anyway?",
      icon: 'confirmation',
      buttons: ['Yes', 'No'],
    });
    expect(latin(await t.vfs.readFile('/browser/p.X68'))).toBe('theirs\r\n');
    expect(t.manager.active()?.modified).toBe(true);
    t.answers.push('Yes');
    expect(await t.manager.save(doc.id)).toBe(true);
    expect(latin(await t.vfs.readFile('/browser/p.X68')).startsWith('mine A')).toBe(true);
    // After our own save the recorded time is the new one: no question.
    t.type(doc.id, '!');
    expect(await t.manager.save(doc.id)).toBe(true);
    expect(t.asked).toHaveLength(2);
  });

  it('a file deleted in storage counts as changed', async () => {
    const t = setup();
    await t.vfs.writeFile('/browser/p.X68', bytes('A\r\n'));
    const doc = (await t.manager.open('/browser/p.X68'))!;
    await t.backend.remove('p.X68');
    t.answers.push('Yes');
    expect(await t.manager.save(doc.id)).toBe(true);
    expect(t.asked[0]?.text).toBe("'p.X68' has been changed outside this window. Save anyway?");
  });

  it("an 'io' failure that carries a whole message is shown without the internal path (FS2 review)", async () => {
    const t = setup();
    const doc = t.manager.newSource();
    t.type(doc.id, 'x');
    const sentence =
      '"prog.X68" has been changed by another program since this window last read it, so it was not saved.';
    t.vfs.writeFile = async () => {
      throw fsError('io', sentence);
    };
    t.saveTargets.push('/browser/prog.X68');
    t.answers.push('OK');
    expect(await t.manager.save(doc.id)).toBe(false);
    expect(t.asked[0]?.text).toBe(sentence);
    // Other codes, and an 'io' reason that is no sentence, keep the original's prefix.
    expect(writeError('/browser/a.X68', 'quota', 'io').text).toBe('Cannot create file "/browser/a.X68". quota');
    expect(writeError('/browser/a.X68', 'No such file.', 'not-found').text).toBe(
      'Cannot create file "/browser/a.X68". No such file.',
    );
  });

  it('a failed write reports it and leaves the document modified', async () => {
    const t = setup();
    const doc = t.manager.newSource();
    t.type(doc.id, 'x');
    t.saveTargets.push('/nowhere/a.X68');
    t.answers.push('OK');
    expect(await t.manager.save(doc.id)).toBe(false);
    expect(t.asked[0]).toMatchObject({ title: 'Error', icon: 'error', buttons: ['OK'] });
    expect(t.asked[0]?.text.startsWith('Cannot create file "/nowhere/a.X68".')).toBe(true);
    expect(t.manager.active()).toMatchObject({ modified: true, hasName: false, name: 'untitled1.x68' });
  });

  it('typing during the write keeps the document modified', async () => {
    const t = setup();
    await t.vfs.writeFile('/browser/p.X68', bytes('A\r\n'));
    const doc = (await t.manager.open('/browser/p.X68'))!;
    t.type(doc.id, '1');
    const saving = t.manager.save(doc.id);
    t.type(doc.id, '2');
    expect(await saving).toBe(true);
    expect(t.manager.active()?.modified).toBe(true);
  });
});

describe('Reload (editor-ui §6.5)', () => {
  it('asks when modified, reloads into the same document, re-reads the trailer, clears modified', async () => {
    const t = setup();
    await t.vfs.writeFile('/browser/p.X68', bytes('A\r\n'));
    const doc = (await t.manager.open('/browser/p.X68'))!;
    t.type(doc.id, 'x');
    t.answers.push('No');
    await t.manager.reload(doc.id);
    expect(t.asked[0]).toEqual({
      title: 'Confirm',
      text: 'p.X68 is modified. Do you want to discard changes and reopen?',
      icon: 'confirmation',
      buttons: ['Yes', 'No'],
    });
    expect(t.manager.text(doc.id)).toBe('xA\n');
    await t.backend.writeFile('p.X68', bytes('B\r\n*~Tab size~8~\r\n'));
    t.answers.push('Yes');
    await t.manager.reload(doc.id);
    expect(t.manager.text(doc.id)).toBe('B\n');
    expect(t.manager.active()).toMatchObject({ id: doc.id, tabSize: 8, modified: false });
    // the recorded time is the reloaded file's: saving asks nothing
    expect(await t.manager.save(doc.id)).toBe(true);
    expect(t.asked).toHaveLength(2);
  });

  it('does nothing for a document that was never saved', async () => {
    const t = setup();
    const doc = t.manager.newSource();
    t.type(doc.id, 'x');
    await t.manager.reload(doc.id);
    expect(t.asked).toEqual([]);
    expect(t.manager.text(doc.id).startsWith('x')).toBe(true);
  });
});

describe('Close (editor-ui §6.6, 1.4 note 3)', () => {
  it('closes an unmodified document without a question; the neighbour becomes active', () => {
    const t = setup();
    const a = t.manager.newSource();
    const b = t.manager.newSource();
    const c = t.manager.newSource();
    t.manager.activate(b.id);
    return t.manager.close(b.id).then((closed) => {
      expect(closed).toBe(true);
      expect(t.asked).toEqual([]);
      expect(t.store.getState().documents.activeId).toBe(c.id);
      expect(t.manager.list().map((doc) => doc.id)).toEqual([a.id, c.id]);
      expect(t.manager.registry.has(b.id)).toBe(false);
    });
  });

  it('a modified document: Yes/No/Cancel with the exact text; Cancel keeps it, No closes without saving', async () => {
    const t = setup();
    const doc = t.manager.newSource();
    t.type(doc.id, 'x');
    t.answers.push('Cancel');
    expect(await t.manager.close(doc.id)).toBe(false);
    expect(t.asked[0]).toEqual({
      title: 'Confirm',
      text: "File modified, do you wish to save 'untitled1.x68' before closing?",
      icon: 'confirmation',
      buttons: ['Yes', 'No', 'Cancel'],
    });
    expect(t.manager.list()).toHaveLength(1);
    t.answers.push('No');
    expect(await t.manager.close(doc.id)).toBe(true);
    expect(t.manager.list()).toEqual([]);
    expect(t.store.getState().documents).toEqual({ items: [], activeId: null });
  });

  it('Yes saves the document that is closing, not the active one', async () => {
    const t = setup();
    await t.vfs.writeFile('/browser/a.X68', bytes('A\r\n'));
    const a = (await t.manager.open('/browser/a.X68'))!;
    t.type(a.id, '1');
    await t.vfs.writeFile('/browser/b.X68', bytes('B\r\n'));
    const b = (await t.manager.open('/browser/b.X68'))!;
    t.type(b.id, '2');
    t.answers.push('Yes');
    expect(await t.manager.close(a.id)).toBe(true);
    expect(latin(await t.vfs.readFile('/browser/a.X68')).startsWith('1A')).toBe(true);
    expect(latin(await t.vfs.readFile('/browser/b.X68'))).toBe('B\r\n');
  });

  it('a cancelled Save As cancels the close', async () => {
    const t = setup();
    const doc = t.manager.newSource();
    t.type(doc.id, 'x');
    t.answers.push('Yes');
    t.saveTargets.push(null);
    expect(await t.manager.close(doc.id)).toBe(false);
    expect(t.manager.list()).toHaveLength(1);
  });

  it('closeAll asks for each modified document in tab order and stops at Cancel', async () => {
    const t = setup();
    const a = t.manager.newSource();
    const b = t.manager.newSource();
    const c = t.manager.newSource();
    t.type(a.id, 'x');
    t.type(c.id, 'y');
    t.answers.push('No', 'Cancel');
    expect(await t.manager.closeAll()).toBe(false);
    expect(t.asked.map((request) => request.text)).toEqual([
      "File modified, do you wish to save 'untitled1.x68' before closing?",
      "File modified, do you wish to save 'untitled3.x68' before closing?",
    ]);
    // editor-ui §1.3: nothing closes when the exit is cancelled; the one answered No keeps its edits.
    expect(t.manager.list().map((doc) => doc.id)).toEqual([a.id, b.id, c.id]);
    expect(t.manager.text(a.id).startsWith('x')).toBe(true);
    expect(t.manager.get(a.id)?.modified).toBe(true);
    expect(t.manager.registry.has(a.id)).toBe(true);
    t.answers.push('No', 'No');
    expect(await t.manager.closeAll()).toBe(true);
    expect(t.manager.list()).toEqual([]);
    expect(t.store.getState().documents).toEqual({ items: [], activeId: null });
  });

  it('closeAll: Yes saves at once, but a later Cancel leaves the saved document open', async () => {
    const t = setup();
    await t.vfs.writeFile('/browser/a.X68', bytes('A\r\n'));
    const a = (await t.manager.open('/browser/a.X68'))!;
    t.type(a.id, '1');
    const b = t.manager.newSource();
    t.type(b.id, '2');
    t.answers.push('Yes', 'Cancel');
    expect(await t.manager.closeAll()).toBe(false);
    expect(latin(await t.vfs.readFile('/browser/a.X68')).startsWith('1A')).toBe(true);
    expect(t.manager.list().map((doc) => doc.id)).toEqual([a.id, b.id]);
    expect(t.manager.get(a.id)?.modified).toBe(false);
    expect(t.manager.get(b.id)?.modified).toBe(true);
  });

  it('closeAll: a cancelled Save As leaves every document open', async () => {
    const t = setup();
    const a = t.manager.newSource();
    const b = t.manager.newSource();
    t.type(a.id, 'x');
    t.type(b.id, 'y');
    t.answers.push('No', 'Yes');
    t.saveTargets.push(null);
    expect(await t.manager.closeAll()).toBe(false);
    expect(t.manager.list().map((doc) => [doc.id, doc.modified])).toEqual([
      [a.id, true],
      [b.id, true],
    ]);
  });
});

describe('update and restore', () => {
  it('update changes settings and publishes them', () => {
    const t = setup();
    const doc = t.manager.newSource();
    t.manager.update(doc.id, { insertMode: false, tabSize: 8 });
    expect(t.store.getState().documents.items[0]).toMatchObject({ insertMode: false, tabSize: 8, modified: false });
  });

  it('selection reports the selected text and the caret in characters of text(id)', () => {
    const t = setup();
    const doc = t.manager.newSource();
    expect(t.manager.selection(doc.id)).toEqual({ selected: '', caret: 0 });
    t.manager.registry.dispatch(doc.id, {
      changes: { from: 0, to: t.manager.text(doc.id).length, insert: 'AB\nMOVE.L D0' },
    });
    // Selected backwards: the caret is the moving end (head), here before "MOVE".
    t.manager.registry.dispatch(doc.id, { selection: { anchor: 9, head: 3 } });
    expect(t.manager.selection(doc.id)).toEqual({ selected: 'MOVE.L', caret: 3 });
    expect(t.manager.text(doc.id).slice(0, 3)).toBe('AB\n');
    expect(t.manager.selection('unknown')).toBeNull();
    // The contract's optional members exist on the real service.
    const service: DocumentService = t.manager;
    expect(typeof service.update).toBe('function');
    expect(typeof service.selection).toBe('function');
  });

  it('restore brings a document back as modified, renaming a clashing untitled name', async () => {
    const t = setup();
    t.manager.newSource();
    const draft = { ...t.manager.list()[0]!, id: 'old', modified: true };
    const restored = t.manager.restore({ state: draft, text: 'draft text', mtime: null });
    expect(restored).toMatchObject({ name: 'untitled2.x68', modified: true, hasName: false });
    expect(t.manager.text(restored.id)).toBe('draft text');
    expect(t.manager.newSource().name).toBe('untitled3.x68');
    // saving makes it unmodified
    t.saveTargets.push('/browser/r.X68');
    expect(await t.manager.save(restored.id)).toBe(true);
    expect(t.manager.get(restored.id)?.modified).toBe(false);
    expect(encodeFile(t.manager.get(restored.id)!, 'draft text').length).toBe(
      (await t.vfs.readFile('/browser/r.X68')).length,
    );
  });
});
