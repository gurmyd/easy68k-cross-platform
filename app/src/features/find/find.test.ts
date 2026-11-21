// The find feature in a whole application built from fakes (state/testing.ts) with E1's real
// document service, so that the search works on the document registry the editor's views follow
// (3.9.1). Owner: E6.

import { describe, expect, it } from 'vitest';
import type { AppContext } from '../../contracts';
import { DocumentManager, documentRegistryOf } from '../../core/documents';
import { createTestApplication, type TestApplication } from '../../state/testing';
import { feature } from './index';
import { END_OF_DOCUMENT, FIND_DIALOG_ID, FindModel, REPLACE_DIALOG_ID, findModelOf, firstLine } from './model';

/** Timers of the scheduler, run by the test. */
interface Timers {
  pending: { delay: number; fn: () => void }[];
  runAll(): void;
}

function setup(text: string, timers?: Timers) {
  const app = createTestApplication({
    features: [feature],
    ...(timers
      ? {
          scheduler: {
            onFrame: () => () => {},
            setTimer: (delay: number, fn: () => void) => {
              timers.pending.push({ delay, fn });
              return () => {};
            },
          },
        }
      : {}),
    services: {
      createDocumentService: (ctx: AppContext) =>
        new DocumentManager({
          store: ctx.store,
          settings: ctx.settings,
          dialogs: ctx.dialogs,
          vfs: ctx.vfs,
          fileDialogs: ctx.fileDialogs,
        }),
    },
  });
  const doc = app.ctx.documents.newSource();
  const registry = documentRegistryOf(app.ctx.documents);
  registry.dispatch(doc.id, { changes: { from: 0, to: registry.state(doc.id).doc.length, insert: text } });
  const select = (anchor: number, head = anchor) => registry.dispatch(doc.id, { selection: { anchor, head } });
  select(0);
  const sel = () => {
    const main = registry.state(doc.id).selection.main;
    return [main.from, main.to];
  };
  const content = () => registry.text(doc.id);
  return { app, id: doc.id, registry, select, sel, content, model: findModelOf(app.ctx) };
}

/** The message boxes shown, answered as they come: No to a save question, OK to the others. */
function answerBoxes(app: TestApplication): string[] {
  const seen: string[] = [];
  const answered = new Set<number>();
  app.ctx.store.subscribe(() => {
    for (const dialog of app.ctx.store.getState().dialogs.stack) {
      if (dialog.id !== 'message' || answered.has(dialog.key)) continue;
      answered.add(dialog.key);
      const request = dialog.props as { text: string; buttons: string[] };
      seen.push(request.text);
      const answer = request.buttons.includes('No') ? 'No' : 'OK';
      queueMicrotask(() => app.dialogs.close(dialog.key, answer));
    }
  });
  return seen;
}

const openDialogs = (app: TestApplication) => app.ctx.store.getState().dialogs.stack.map((d) => `${d.id}:${d.modal}`);

describe('feature "find"', () => {
  it('owns exactly its commands of 9.7 and the dialogs find and replace', () => {
    expect(Object.keys(feature.commands ?? {}).sort()).toEqual(['ed.edit.find', 'ed.edit.findNext', 'ed.edit.replace']);
    expect(Object.keys(feature.dialogs ?? {}).sort()).toEqual([FIND_DIALOG_ID, REPLACE_DIALOG_ID]);
  });

  it('Find and Replace need an open document; Find Next also a Find text', async () => {
    const { app, model } = setup('abc');
    answerBoxes(app);
    expect(app.ctx.commands.isEnabled('ed.edit.find')).toBe(true);
    expect(app.ctx.commands.isEnabled('ed.edit.replace')).toBe(true);
    expect(app.ctx.commands.isEnabled('ed.edit.findNext')).toBe(false);
    model.setFind({ text: 'b' });
    expect(app.ctx.commands.isEnabled('ed.edit.findNext')).toBe(true);
    await app.ctx.documents.closeAll();
    expect(app.ctx.commands.isEnabled('ed.edit.find')).toBe(false);
    expect(app.ctx.commands.isEnabled('ed.edit.replace')).toBe(false);
    expect(app.ctx.commands.isEnabled('ed.edit.findNext')).toBe(false);
  });

  it('Ctrl+F with a word selected preloads it and opens the modeless Find dialog once', async () => {
    const { app, select, model } = setup('LOOP MOVE D0,D1\n BRA LOOP\n');
    select(0, 4);
    await app.ctx.commands.run('ed.edit.find');
    expect(model.view.getState().find.text).toBe('LOOP');
    expect(openDialogs(app)).toEqual(['find:false']);
    // Without a selection the previous text stays; a second Find... does not open a second dialog
    // but asks the open one to take the focus.
    select(3);
    const focus = model.view.getState().findFocus;
    await app.ctx.commands.run('ed.edit.find');
    expect(model.view.getState().find.text).toBe('LOOP');
    expect(openDialogs(app)).toEqual(['find:false']);
    expect(model.view.getState().findFocus).toBe(focus + 1);
  });

  it('20.6: Enter finds the next occurrence after the selection, then End of document reached, then F3 from the top', async () => {
    const { app, select, sel, model } = setup('LOOP MOVE D0,D1\n BRA LOOP\n DBRA D2,LOOP\n');
    const boxes = answerBoxes(app);
    select(21, 25);
    await app.ctx.commands.run('ed.edit.find');
    expect(await model.findNextFromFindDialog()).toBe(true);
    expect(sel()).toEqual([35, 39]);
    // The editor takes the focus after a match (Main->SetFocus).
    expect(app.shell.getState().focusRequest?.panel).toBe('editor');
    await app.ctx.commands.run('ed.edit.findNext');
    expect(boxes).toEqual([END_OF_DOCUMENT.text]);
    // The selection collapsed to its start.
    expect(sel()).toEqual([35, 35]);
    await app.ctx.commands.run('ed.edit.findNext');
    expect(sel()).toEqual([0, 4]);
  });

  it('without a selection the search starts at the caret (note 7), not at the top', async () => {
    const { app, select, sel, model } = setup('D0 D0 D0');
    answerBoxes(app);
    model.setFind({ text: 'D0' });
    select(2);
    await app.ctx.commands.run('ed.edit.findNext');
    expect(sel()).toEqual([3, 5]);
  });

  it('the restart from the top holds only while the text and the caret stay as the box left them', async () => {
    const { app, select, sel, model, registry, id } = setup('ab ab');
    const boxes = answerBoxes(app);
    model.setFind({ text: 'ab' });
    select(4);
    await model.findNextFromFindDialog();
    expect(boxes).toHaveLength(1);
    expect(sel()).toEqual([4, 4]);
    // The caret moved: the next search starts at the caret again.
    select(1);
    await model.findNextFromFindDialog();
    expect(sel()).toEqual([3, 5]);
    // End again, then an edit: from the caret.
    select(5);
    await model.findNextFromFindDialog();
    registry.dispatch(id, { changes: { from: 5, insert: ' ab' }, selection: { anchor: 5 } });
    await model.findNextFromFindDialog();
    expect(sel()).toEqual([6, 8]);
  });

  it('Match case and Match whole word only behave as named', async () => {
    const { app, select, sel, model } = setup('d0 xD0 D00 D0');
    const boxes = answerBoxes(app);
    model.setFind({ text: 'D0', matchCase: true, wholeWord: true });
    select(0);
    await model.findNextFromFindDialog();
    expect(sel()).toEqual([11, 13]);
    model.setFind({ matchCase: false, wholeWord: false });
    select(0);
    await model.findNextFromFindDialog();
    expect(sel()).toEqual([0, 2]);
    model.setFind({ matchCase: true });
    select(0);
    await model.findNextFromFindDialog();
    expect(sel()).toEqual([4, 6]);
    expect(boxes).toEqual([]);
  });

  it('Find Next uses the Find dialog text even when the Replace dialog searched something else', async () => {
    const { app, select, sel, model } = setup('A B A B');
    answerBoxes(app);
    model.setFind({ text: 'B' });
    model.setReplace({ text: 'A' });
    select(1);
    await model.findNextFromReplaceDialog();
    expect(sel()).toEqual([4, 5]);
    select(0);
    await app.ctx.commands.run('ed.edit.findNext');
    expect(sel()).toEqual([2, 3]);
  });

  it('Find And Replace fills both boxes with the selection, empty without one, and opens below Find', async () => {
    const { app, select, model } = setup('MOVE D0,D1');
    select(5, 7);
    await app.ctx.commands.run('ed.edit.find');
    await app.ctx.commands.run('ed.edit.replace');
    expect(model.view.getState().replace).toMatchObject({ text: 'D0', replacement: 'D0' });
    const replaceDialog = app.ctx.store.getState().dialogs.stack.find((d) => d.id === REPLACE_DIALOG_ID);
    expect(replaceDialog).toMatchObject({ modal: false, props: { below: true } });
    select(2);
    await app.ctx.commands.run('ed.edit.replace');
    expect(model.view.getState().replace).toMatchObject({ text: '', replacement: '' });
    expect(openDialogs(app)).toEqual(['find:false', 'replace:false']);
  });

  it('20.6: Replace All D0 -> D1 on three occurrences replaces all three, one undo step, and ends with the box', async () => {
    const { app, content, model, sel } = setup(' MOVE.L D0,(A0)\n ADD.W D0,D2\n CLR.B D0\n');
    const boxes = answerBoxes(app);
    model.setReplace({ text: 'D0', replacement: 'D1' });
    await model.replace(true);
    expect(content()).toBe(' MOVE.L D1,(A0)\n ADD.W D1,D2\n CLR.B D1\n');
    expect(boxes).toEqual([END_OF_DOCUMENT.text]);
    // The last replacement, collapsed to its start after the box.
    expect(sel()).toEqual([36, 36]);
    expect(app.ctx.documents.active()?.modified).toBe(true);
  });

  it('Replace replaces the selected match and selects the next; a non-matching selection is not replaced', async () => {
    const { app, content, model, sel, select } = setup('D0 xx D0 D0');
    answerBoxes(app);
    model.setReplace({ text: 'D0', replacement: 'D7' });
    select(0, 5); // "D0 xx" is not a match
    await model.replace(false);
    expect(content()).toBe('D7 xx D0 D0');
    expect(sel()).toEqual([6, 8]);
    await model.replace(false);
    expect(content()).toBe('D7 xx D7 D0');
    expect(sel()).toEqual([9, 11]);
  });

  it('does nothing without a document, and with the stub document service', async () => {
    const { app, model } = setup('x');
    answerBoxes(app);
    await app.ctx.documents.closeAll();
    expect(await model.search('x', { wholeWord: false, matchCase: false })).toBe(false);
    const stub = createTestApplication({ features: [feature] });
    const stubModel = new FindModel(stub.ctx, {
      activeId: () => null,
      snapshot: () => null,
      select: () => {},
      apply: () => {},
      focusEditor: () => {},
    });
    expect(await stubModel.search('x', { wholeWord: false, matchCase: false })).toBe(false);
    // The real target on the stub service finds no registry and does nothing either.
    stubModel.setFind({ text: 'x' });
    expect(await findModelOf(stub.ctx).search('x', { wholeWord: false, matchCase: false })).toBe(false);
  });

  it('after a match the editor takes the focus, and the caret the focus puts back is undone once', async () => {
    const timers: Timers = {
      pending: [],
      runAll() {
        const list = this.pending.splice(0);
        for (const timer of list) timer.fn();
      },
    };
    const { app, select, sel, model, registry, id } = setup('ab ab ab ab', timers);
    model.setFind({ text: 'ab' });
    select(1);
    await model.findNextFromFindDialog();
    expect(sel()).toEqual([3, 5]);
    expect(app.shell.getState().focusRequest?.panel).toBe('editor');
    // The editor reads the browser's caret back after the focus: user event "select".
    registry.dispatch(id, { selection: { anchor: 0 }, userEvent: 'select' });
    expect(sel()).toEqual([0, 0]);
    timers.runAll();
    expect(sel()).toEqual([3, 5]);
    // Only once: the next such change stays.
    registry.dispatch(id, { selection: { anchor: 1 }, userEvent: 'select' });
    timers.runAll();
    expect(sel()).toEqual([1, 1]);
  });

  it('a click in the text, a selection by code or an edit after a match is left alone', async () => {
    const timers: Timers = { pending: [], runAll() {} };
    const { select, sel, model, registry, id } = setup('ab ab ab', timers);
    const run = () => {
      for (const timer of timers.pending.splice(0)) timer.fn();
    };
    model.setFind({ text: 'ab' });
    select(1);
    await model.findNextFromFindDialog();
    registry.dispatch(id, { selection: { anchor: 7 }, userEvent: 'select.pointer' });
    registry.dispatch(id, { selection: { anchor: 0 }, userEvent: 'select' });
    run();
    expect(sel()).toEqual([0, 0]);
    select(1);
    await model.findNextFromFindDialog();
    select(2); // by code (no user event)
    registry.dispatch(id, { selection: { anchor: 0 }, userEvent: 'select' });
    run();
    expect(sel()).toEqual([0, 0]);
    select(1);
    await model.findNextFromFindDialog();
    registry.dispatch(id, { changes: { from: 0, insert: 'x' } });
    registry.dispatch(id, { selection: { anchor: 0 }, userEvent: 'select' });
    run();
    expect(sel()).toEqual([0, 0]);
  });

  it('the watch ends after a short time and with the next search', async () => {
    const timers: Timers = { pending: [], runAll() {} };
    const { select, sel, model, registry, id } = setup('ab ab ab', timers);
    model.setFind({ text: 'ab' });
    select(1);
    await model.findNextFromFindDialog();
    // The guard's own timer (400 ms) has run out.
    const guard = timers.pending.find((t) => t.delay === 400);
    expect(guard).toBeDefined();
    guard?.fn();
    registry.dispatch(id, { selection: { anchor: 0 }, userEvent: 'select' });
    for (const timer of timers.pending.splice(0)) timer.fn();
    expect(sel()).toEqual([0, 0]);
  });

  it('a multi-line selection gives its first line to the one-line box', () => {
    expect(firstLine('a\nb')).toBe('a');
    expect(firstLine('ab')).toBe('ab');
  });
});
