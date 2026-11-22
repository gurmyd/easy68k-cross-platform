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
import { DocumentManager, isListPath, kindAfterSaveAs, type DocumentServiceDeps, type WrittenEvent } from './service';

const bytes = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));
const latin = (data: Uint8Array) => String.fromCharCode(...data);
const TRAILER = '*~Font name~Courier New~\r\n*~Font size~10~\r\n*~Tab type~1~\r\n*~Tab size~4~\r\n';

/** `extra`: further deps (the viewer and the clock of ARCHITECTURE-PLUS P4.4, N6's cases). */
function setup(extra: Partial<DocumentServiceDeps> = {}) {
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
    ...extra,
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

  it('newSourceWithText (ARCHITECTURE-PLUS P3.3.8) makes the next untitled document with the text, modified', () => {
    const t = setup();
    t.settings.editor.tabType = TabType.Assembly;
    t.settings.editor.fixedTabSize = 6;
    const first = t.manager.newSource();
    const doc = t.manager.newSourceWithText('  ORG $1000\n  END $1000\n');
    expect(doc).toMatchObject({
      name: 'untitled2.x68',
      kind: 'source',
      hasName: false,
      path: null,
      modified: true,
      tabType: 0,
      tabSize: 6,
      insertMode: true,
    });
    expect(t.manager.text(doc.id)).toBe('  ORG $1000\n  END $1000\n');
    expect(t.manager.text(first.id)).toBe(DEFAULT_TEMPLATE);
    expect(t.store.getState().documents).toEqual({ items: [first, doc], activeId: doc.id });
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

  it("an 'io' sentence that does not name the file keeps the prefix with the file's name (gate I2 review)", async () => {
    // STORE_MESSAGES.closed of fs/browser-backend.ts: a whole sentence, but it names no file.
    const closed = 'The browser closed the file store (site data may have been cleared). Reload the page to continue.';
    const t = setup();
    const doc = t.manager.newSource();
    t.type(doc.id, 'x');
    t.vfs.writeFile = async () => {
      throw fsError('io', closed);
    };
    t.saveTargets.push('/browser/lab1/prog.X68');
    t.answers.push('OK');
    expect(await t.manager.save(doc.id)).toBe(false);
    expect(t.asked[0]?.text).toBe(`Cannot create file "/browser/lab1/prog.X68". ${closed}`);
    // A linked file is named without the store's internal folder, also with the prefix.
    expect(writeError('/linked/21d878e9/prog.X68', closed, 'io').text).toBe(`Cannot create file "prog.X68". ${closed}`);
    expect(writeError('/linked/21d878e9/prog.X68', 'quota', 'io').text).not.toContain('/linked/');
    // A sentence that names the file, in another letter case, is still shown on its own.
    expect(writeError('/linked/21d878e9/PROG.x68', '"prog.X68" no longer exists on this computer.', 'io').text).toBe(
      '"prog.X68" no longer exists on this computer.',
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

// ------------------------------------------------------------------------------------------------
// The hooks of the stage of additions (ARCHITECTURE-PLUS P3.4.1, P4.4; package N6).

/** A viewer that wants the files whose name ends in one of `wanted`, and records what it showed. */
function fakeViewer(...wanted: string[]) {
  const asked: string[] = [];
  const shown: { path: string; bytes: number[] }[] = [];
  return {
    asked,
    shown,
    viewer: {
      wants: (path: string) => {
        asked.push(path);
        return wanted.some((suffix) => path.endsWith(suffix));
      },
      show: (path: string, data: Uint8Array) => void shown.push({ path, bytes: [...data] }),
    },
  };
}

/** A clock whose wall time moves by one second at each reading. */
function steppingClock(start = Date.UTC(2026, 10, 22, 12, 0, 0)) {
  let at = start;
  return { wallTime: () => new Date((at += 1000)) };
}

/** Waits until the reactions of resolved promises have run. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('open asks the viewer (ARCHITECTURE-PLUS P3.4.1, P4.4)', () => {
  it('a file the viewer wants is shown there with the bytes read; open returns null and opens no document', async () => {
    const f = fakeViewer('.pdf');
    const t = setup({ viewer: f.viewer });
    await t.vfs.writeFile('/browser/report.pdf', bytes('%PDF-1.4\r\n'));
    expect(await t.manager.open('/browser/report.pdf')).toBeNull();
    expect(f.shown).toEqual([{ path: '/browser/report.pdf', bytes: [...bytes('%PDF-1.4\r\n')] }]);
    expect(t.manager.list()).toEqual([]);
    expect(t.store.getState().documents.items).toEqual([]);
    expect(t.asked).toEqual([]);
  });

  it('{ asText: true } does not ask the viewer and opens the file as a document', async () => {
    const f = fakeViewer('.pdf');
    const t = setup({ viewer: f.viewer });
    await t.vfs.writeFile('/browser/report.pdf', bytes('%PDF-1.4\r\n'));
    const doc = await t.manager.open('/browser/report.pdf', { asText: true });
    expect(doc).toMatchObject({ name: 'report.pdf', path: '/browser/report.pdf', kind: 'source' });
    expect(f.asked).toEqual([]);
    expect(f.shown).toEqual([]);
  });

  it('a file the viewer does not want opens as text, as before', async () => {
    const f = fakeViewer('.pdf');
    const t = setup({ viewer: f.viewer });
    await t.vfs.writeFile('/browser/p.X68', bytes('A\r\n'));
    expect(await t.manager.open('/browser/p.X68')).toMatchObject({ name: 'p.X68' });
    expect(f.asked).toEqual(['/browser/p.X68']);
    expect(f.shown).toEqual([]);
  });

  it('a missing file shows the File Access Error box and never reaches the viewer', async () => {
    const f = fakeViewer('.pdf');
    const t = setup({ viewer: f.viewer });
    t.answers.push('OK');
    expect(await t.manager.open('/browser/missing.pdf')).toBeNull();
    expect(f.asked).toEqual([]);
    expect(t.asked.map((box) => box.title)).toEqual(['Error']);
  });

  // An Open never closes what a person has open (errata N6 12): a file open as text (Open as Text)
  // that the viewer takes is shown in the viewer, and its text document stays as it is.
  it('a file open as text that the viewer takes: an Open shows the viewer and keeps the document open', async () => {
    const f = fakeViewer('.svg');
    const t = setup({ viewer: f.viewer });
    await t.vfs.writeFile('/browser/p.svg', bytes('<svg/>\r\n'));
    const doc = (await t.manager.open('/browser/p.svg', { asText: true }))!;
    const text = t.manager.text(doc.id);
    expect(await t.manager.open('/browser/p.svg')).toBeNull();
    expect(f.shown.map((entry) => entry.path)).toEqual(['/browser/p.svg']);
    expect(t.manager.list().map((entry) => entry.id)).toEqual([doc.id]);
    expect(t.manager.get(doc.id)).toEqual(doc);
    expect(t.manager.text(doc.id)).toBe(text);
    expect(t.asked).toEqual([]);
  });

  it('the same with unsaved changes: no question, the viewer shows the file, the changes stay', async () => {
    const f = fakeViewer('.pdf');
    const t = setup({ viewer: f.viewer });
    await t.vfs.writeFile('/browser/report.pdf', bytes('%PDF\r\n'));
    const doc = (await t.manager.open('/browser/report.pdf', { asText: true }))!;
    t.type(doc.id, 'X');
    expect(await t.manager.open('/browser/report.pdf')).toBeNull();
    expect(t.asked).toEqual([]);
    expect(f.shown.map((entry) => entry.path)).toEqual(['/browser/report.pdf']);
    expect(t.manager.get(doc.id)?.modified).toBe(true);
    expect(t.manager.text(doc.id).startsWith('X')).toBe(true);
  });

  it('a text file that is already open: the "already open" question as before; Yes reads the file again', async () => {
    const f = fakeViewer('.pdf');
    const t = setup({ viewer: f.viewer });
    await t.vfs.writeFile('/browser/p.X68', bytes('OLD\r\n'));
    const doc = (await t.manager.open('/browser/p.X68'))!;
    t.type(doc.id, 'X');
    // No: the document stays, modified.
    t.answers.push('No');
    expect(await t.manager.open('/browser/p.X68')).toBeNull();
    expect(t.manager.get(doc.id)?.modified).toBe(true);
    // Yes, after the file changed: the new bytes, read after the question, replace it in its tab.
    await t.vfs.writeFile('/browser/p.X68', bytes('NEW\r\n'));
    t.answers.push('Yes');
    const again = (await t.manager.open('/browser/p.X68'))!;
    expect(t.asked.map((box) => box.text)).toEqual([
      'p.X68 is already open. Do you want to discard changes and reopen?',
      'p.X68 is already open. Do you want to discard changes and reopen?',
    ]);
    expect(t.manager.text(again.id).startsWith('NEW')).toBe(true);
    expect(t.manager.list().map((entry) => entry.path)).toEqual(['/browser/p.X68']);
    expect(f.shown).toEqual([]);
  });

  it('a file that is not open is read once, with or without a viewer', async () => {
    for (const viewer of [undefined, fakeViewer('.pdf').viewer]) {
      const t = setup(viewer ? { viewer } : {});
      await t.vfs.writeFile('/browser/p.X68', bytes('A\r\n'));
      let reads = 0;
      const read = t.vfs.readFile.bind(t.vfs);
      t.vfs.readFile = (path) => {
        reads++;
        return read(path);
      };
      await t.manager.open('/browser/p.X68');
      expect(reads).toBe(1);
    }
  });
});

describe('relocate (ARCHITECTURE-PLUS P3.2.4, P4.4)', () => {
  it("a file: path, name and tab title follow; text, modified and revision stay; the time is the new file's", async () => {
    const t = setup();
    await t.vfs.writeFile('/browser/a/p.X68', bytes('A\r\n'));
    const doc = (await t.manager.open('/browser/a/p.X68'))!;
    t.type(doc.id, 'B');
    const before = t.manager.get(doc.id)!;
    await t.vfs.writeFile('/browser/b/q.X68', bytes('BA\r\n'));
    const newTime = (await t.vfs.stat('/browser/b/q.X68'))!.mtime;
    await t.manager.relocate('/browser/a/p.X68', '/browser/b/q.X68');
    const after = t.manager.get(doc.id)!;
    expect(after).toEqual({ ...before, path: '/browser/b/q.X68', name: 'q.X68' });
    expect(t.manager.text(doc.id)).toBe('BA\n');
    expect(t.manager.fileTime(doc.id)).toBe(newTime);
    expect(t.store.getState().documents.items[0]).toEqual(after);
    // The next Save goes to the new place without the "changed outside" question.
    expect(await t.manager.save(doc.id)).toBe(true);
    expect(t.asked).toEqual([]);
    expect(latin(await t.vfs.readFile('/browser/b/q.X68')).startsWith('BA\r\n')).toBe(true);
  });

  it('a folder: every document below it follows, others and untitled ones do not', async () => {
    const t = setup();
    await t.vfs.writeFile('/browser/lab/one.X68', bytes('1\r\n'));
    await t.vfs.writeFile('/browser/lab/sub/two.X68', bytes('2\r\n'));
    await t.vfs.writeFile('/browser/lab2/three.X68', bytes('3\r\n'));
    const one = (await t.manager.open('/browser/lab/one.X68'))!;
    const two = (await t.manager.open('/browser/lab/sub/two.X68'))!;
    const three = (await t.manager.open('/browser/lab2/three.X68'))!;
    const untitled = t.manager.newSource();
    t.type(two.id, 'Z');
    await t.vfs.writeFile('/browser/done/lab/one.X68', bytes('1\r\n'));
    await t.vfs.writeFile('/browser/done/lab/sub/two.X68', bytes('2\r\n'));
    await t.manager.relocate('/browser/lab', '/browser/done/lab');
    expect(t.manager.list().map((doc) => [doc.name, doc.path, doc.modified, doc.revision])).toEqual([
      ['one.X68', '/browser/done/lab/one.X68', false, 0],
      ['two.X68', '/browser/done/lab/sub/two.X68', true, 1],
      ['three.X68', '/browser/lab2/three.X68', false, 0],
      [untitled.name, null, false, 0],
    ]);
    expect(t.manager.get(one.id)?.id).toBe(one.id);
    expect(t.manager.get(three.id)?.path).toBe('/browser/lab2/three.X68');
  });

  it('tells the relocation listeners which documents moved before it resolves; one that throws does not fail it', async () => {
    const t = setup();
    await t.vfs.writeFile('/browser/p.X68', bytes('A\r\n'));
    const doc = (await t.manager.open('/browser/p.X68'))!;
    const told: (readonly string[])[] = [];
    t.manager.onRelocated(() => {
      throw new Error('listener failed');
    });
    const stop = t.manager.onRelocated(async (ids) => {
      await Promise.resolve();
      told.push(ids);
    });
    await t.manager.relocate('/browser/p.X68', '/browser/q.X68');
    expect(told).toEqual([[doc.id]]);
    await t.manager.relocate('/browser/nothing.X68', '/browser/else.X68');
    expect(told).toHaveLength(1);
    stop();
    await t.manager.relocate('/browser/q.X68', '/browser/r.X68');
    expect(told).toHaveLength(1);
    expect(t.manager.get(doc.id)?.path).toBe('/browser/r.X68');
  });
});

describe('onWritten (ARCHITECTURE-PLUS P3.3.3, P4.4)', () => {
  it('once per Save, Save As and open, with the exact bytes and the time of the clock; not for Reload', async () => {
    const clock = steppingClock();
    const t = setup({ clock });
    const events: WrittenEvent[] = [];
    t.manager.onWritten((event) => void events.push(event));
    await t.vfs.writeFile('/browser/p.X68', bytes('A\r\n'));

    const doc = (await t.manager.open('/browser/p.X68'))!;
    await settled();
    expect(events).toEqual([
      { path: '/browser/p.X68', bytes: bytes('A\r\n'), reason: 'opened', time: Date.UTC(2026, 10, 22, 12, 0, 1) },
    ]);

    t.type(doc.id, 'B');
    expect(await t.manager.save(doc.id)).toBe(true);
    await settled();
    const written = await t.vfs.readFile('/browser/p.X68');
    expect(events.slice(1)).toEqual([
      { path: '/browser/p.X68', bytes: written, reason: 'saved', time: Date.UTC(2026, 10, 22, 12, 0, 2) },
    ]);

    t.saveTargets.push('/browser/q.X68');
    expect(await t.manager.saveAs(doc.id)).toBe(true);
    await settled();
    expect(events.slice(2)).toEqual([
      {
        path: '/browser/q.X68',
        bytes: await t.vfs.readFile('/browser/q.X68'),
        reason: 'saved',
        time: Date.UTC(2026, 10, 22, 12, 0, 3),
      },
    ]);

    await t.manager.reload(doc.id);
    await settled();
    expect(events).toHaveLength(3);
  });

  it('nothing for a cancelled Save As, a failed write, a file the viewer takes or a missing file', async () => {
    const f = fakeViewer('.pdf');
    const t = setup({ viewer: f.viewer });
    const events: WrittenEvent[] = [];
    t.manager.onWritten((event) => void events.push(event));
    const doc = t.manager.newSource();
    t.saveTargets.push(null);
    expect(await t.manager.save(doc.id)).toBe(false);
    t.saveTargets.push('/nowhere/x.X68');
    t.answers.push('OK');
    expect(await t.manager.save(doc.id)).toBe(false);
    await t.vfs.writeFile('/browser/r.pdf', bytes('%PDF'));
    expect(await t.manager.open('/browser/r.pdf')).toBeNull();
    t.answers.push('OK');
    expect(await t.manager.open('/browser/missing.X68')).toBeNull();
    await settled();
    expect(events).toEqual([]);
  });

  it('Auto Save (save of a modified document before assembling) and the save of a closing document are announced', async () => {
    const t = setup();
    const reasons: string[] = [];
    t.manager.onWritten((event) => void reasons.push(`${event.reason} ${event.path}`));
    await t.vfs.writeFile('/browser/p.X68', bytes('A\r\n'));
    const doc = (await t.manager.open('/browser/p.X68'))!;
    t.type(doc.id, 'B');
    await t.manager.save(doc.id); // what features/assemble does for Auto Save
    t.type(doc.id, 'C');
    t.answers.push('Yes');
    expect(await t.manager.close(doc.id)).toBe(true);
    await settled();
    expect(reasons).toEqual(['opened /browser/p.X68', 'saved /browser/p.X68', 'saved /browser/p.X68']);
  });

  it('a listener that throws does not make Save fail, and the other listeners still run', async () => {
    const t = setup();
    let calls = 0;
    t.manager.onWritten(() => {
      throw new Error('listener failed');
    });
    t.manager.onWritten(() => void calls++);
    const doc = t.manager.newSource();
    t.saveTargets.push('/browser/t.X68');
    await expect(t.manager.save(doc.id)).resolves.toBe(true);
    await settled();
    expect(calls).toBe(1);
  });

  it("listeners run only after the operation's promise has resolved, and never while it runs", async () => {
    const t = setup();
    const doc = t.manager.newSource();
    let resolved = false;
    const seenResolved: boolean[] = [];
    t.manager.onWritten(() => void seenResolved.push(resolved));
    t.saveTargets.push('/browser/t.X68');
    const saving = t.manager.save(doc.id);
    void saving.then(() => {
      resolved = true;
    });
    // Nothing is announced while the save is still running.
    await t.vfs.stat('/browser/t.X68');
    expect(seenResolved).toEqual([]);
    expect(await saving).toBe(true);
    await settled();
    expect(seenResolved).toHaveLength(1);
  });

  it('the unsubscribe function stops the events', async () => {
    const t = setup();
    let calls = 0;
    const stop = t.manager.onWritten(() => void calls++);
    stop();
    const doc = t.manager.newSource();
    t.saveTargets.push('/browser/t.X68');
    await t.manager.save(doc.id);
    await settled();
    expect(calls).toBe(0);
  });
});

describe('fileTime (ARCHITECTURE-PLUS P4.4: part of the contract)', () => {
  it('the time recorded at open and at the last save; null for a new document', async () => {
    const t = setup();
    const service: DocumentService = t.manager;
    const fresh = t.manager.newSource();
    expect(service.fileTime?.(fresh.id)).toBeNull();
    await t.vfs.writeFile('/browser/p.X68', bytes('A\r\n'));
    const doc = (await t.manager.open('/browser/p.X68'))!;
    expect(service.fileTime?.(doc.id)).toBe((await t.vfs.stat('/browser/p.X68'))!.mtime);
    t.type(doc.id, 'B');
    await t.manager.save(doc.id);
    expect(service.fileTime?.(doc.id)).toBe((await t.vfs.stat('/browser/p.X68'))!.mtime);
    expect(service.fileTime?.('doc-unknown')).toBeNull();
  });
});
