// The print feature in a whole application built from fakes, with E1's real document service and a
// platform that records what it is asked to print. Owner: E6.

import { describe, expect, it } from 'vitest';
import { TabType, type AppContext } from '../../contracts';
import { DocumentManager, documentRegistryOf } from '../../core/documents';
import { NEW_PAGE_MARKER } from '../../core/print';
import { createFakePlatform, createTestApplication, type TestApplication } from '../../state/testing';
import { feature } from './index';
import { PRINT_RANGE_DIALOG_ID, PRINTER_ERROR } from './print';

interface Printed {
  html: string;
  title: string;
}

function setup(text: string | null, options: { fail?: boolean } = {}) {
  const printed: Printed[] = [];
  const platform = createFakePlatform({
    print: async (html, title) => {
      if (options.fail) throw new Error('no printer');
      printed.push({ html, title });
    },
  });
  const app = createTestApplication({
    features: [feature],
    platform,
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
  if (text === null) return { app, printed, id: '', select: () => {} };
  const doc = app.ctx.documents.newSource();
  const registry = documentRegistryOf(app.ctx.documents);
  registry.dispatch(doc.id, { changes: { from: 0, to: registry.state(doc.id).doc.length, insert: text } });
  const select = (anchor: number, head = anchor) => registry.dispatch(doc.id, { selection: { anchor, head } });
  select(0);
  return { app, printed, id: doc.id, select };
}

/** Answers the next dialog with this id as soon as it opens; resolves to its props. */
function answer(app: TestApplication, id: string, result: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const stop = app.ctx.store.subscribe(() => {
      const dialog = app.ctx.store.getState().dialogs.stack.find((d) => d.id === id);
      if (!dialog) return;
      stop();
      queueMicrotask(() => app.dialogs.close(dialog.key, result));
      resolve(dialog.props);
    });
  });
}

/** The text between the <pre> tags of a print document. */
const pages = (html: string) => [...html.matchAll(/<pre class="page">\n([^<]*)<\/pre>/g)].map((m) => m[1]);

describe('feature "print"', () => {
  it('owns exactly its commands of 9.7 and the dialog print.range', () => {
    expect(Object.keys(feature.commands ?? {}).sort()).toEqual(['ed.file.print', 'ed.file.printerSetup']);
    expect(Object.keys(feature.dialogs ?? {})).toEqual([PRINT_RANGE_DIALOG_ID]);
  });

  it('Print needs an open document; Printer Setup is always enabled', () => {
    const none = setup(null);
    expect(none.app.ctx.commands.isEnabled('ed.file.print')).toBe(false);
    expect(none.app.ctx.commands.isEnabled('ed.file.printerSetup')).toBe(true);
    const one = setup('x');
    expect(one.app.ctx.commands.isEnabled('ed.file.print')).toBe(true);
  });

  it('without a selection prints the whole document at once, tabs expanded, titled EASy68K and the name', async () => {
    const { app, printed, id } = setup('START\tORG\t$1000\n\tEND\tSTART\n');
    app.ctx.documents.update?.(id, { tabType: TabType.Assembly });
    const doc = app.ctx.documents.active()!;
    expect(doc.tabType).toBe(TabType.Assembly);
    await app.ctx.commands.run('ed.file.print');
    expect(app.ctx.store.getState().dialogs.stack).toEqual([]);
    expect(printed).toHaveLength(1);
    expect(printed[0]!.title).toBe(`EASy68K ${doc.name}`);
    expect(pages(printed[0]!.html)).toEqual([
      `${'START'.padEnd(12)}${'ORG'.padEnd(8)}$1000\n${' '.repeat(12)}${'END'.padEnd(8)}START`,
    ]);
  });

  it('with a selection asks All / Selection first; Selection prints only it, counted from column 0', async () => {
    const { app, printed, select, id } = setup('LABEL\tMOVE\t#1,D0\nNEXT\tRTS\n');
    app.ctx.documents.update?.(id, { tabType: TabType.Assembly });
    select(5, 10); // "\tMOVE"
    const asked = answer(app, PRINT_RANGE_DIALOG_ID, 'selection');
    await app.ctx.commands.run('ed.file.print');
    expect(await asked).toEqual({ selection: true });
    expect(pages(printed[0]!.html)).toEqual([`${' '.repeat(12)}MOVE`]);
  });

  it('with a selection, All prints the whole document and Cancel prints nothing', async () => {
    const { app, printed, select } = setup('a\nb');
    select(0, 1);
    const all = answer(app, PRINT_RANGE_DIALOG_ID, 'all');
    await app.ctx.commands.run('ed.file.print');
    await all;
    expect(pages(printed[0]!.html)).toEqual(['a\nb']);
    const cancel = answer(app, PRINT_RANGE_DIALOG_ID, null);
    await app.ctx.commands.run('ed.file.print');
    await cancel;
    expect(printed).toHaveLength(1);
  });

  it('a page marker line is not printed and starts a new page', async () => {
    const { app, printed } = setup(`one\n${NEW_PAGE_MARKER}\ntwo\n`);
    await app.ctx.commands.run('ed.file.print');
    expect(pages(printed[0]!.html)).toEqual(['one', 'two']);
  });

  it('a failure shows Printer error.  Please check printer.', async () => {
    const { app } = setup('x', { fail: true });
    const box = answer(app, 'message', 'OK');
    await app.ctx.commands.run('ed.file.print');
    expect(await box).toEqual(PRINTER_ERROR);
  });

  it('fixed tab size 0 with a tab character fails like the original print job', async () => {
    const { app, id, printed } = setup('a\tb');
    app.ctx.documents.update?.(id, { tabType: TabType.Fixed, tabSize: 0 });
    const box = answer(app, 'message', 'OK');
    await app.ctx.commands.run('ed.file.print');
    expect((await box) as { text: string }).toMatchObject({ text: 'Printer error.  Please check printer.' });
    expect(printed).toEqual([]);
  });

  it('Printer Setup opens the system print dialog for the document, or an empty page without one', async () => {
    const one = setup('abc');
    await one.app.ctx.commands.run('ed.file.printerSetup');
    expect(pages(one.printed[0]!.html)).toEqual(['abc']);
    const none = setup(null);
    await none.app.ctx.commands.run('ed.file.printerSetup');
    expect(pages(none.printed[0]!.html)).toEqual([' ']);
  });
});
