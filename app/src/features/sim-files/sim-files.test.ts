// The "sim-files" feature: the task 58 request, the print jobs, and the feature in a test application.

import { describe, expect, it } from 'vitest';
import type {
  AppContext,
  FileDialogs,
  OpenRequest,
  PrintJob,
  SaveRequest,
  SimFileDialogProps,
  SimSession,
} from '../../contracts';
import { createInertSimSession } from '../../state/stub-services';
import { createTestApplication } from '../../state/testing';
import { feature } from './index';
import {
  ALL_FILES_FILTER,
  FILE_DIALOG_ID,
  PRINTER_OUTPUT_DIALOG_ID,
  PrintJobList,
  initialPath,
  jobHtml,
  jobLabel,
  jobText,
  parseProgramFilter,
  programDialogRequest,
  showProgramFileDialog,
} from './logic';
import { printerOutputOpen, printerStateOf } from './printer-state';

const props = (over: Partial<SimFileDialogProps> = {}): SimFileDialogProps => ({
  mode: 0,
  title: '',
  filter: '',
  initialName: '',
  ...over,
});

describe('task 58: the request', () => {
  it('reads the program filter: the engine passes "<list>|<list>", or nothing', () => {
    expect(parseProgramFilter('*.txt;*.pcb|*.txt;*.pcb')).toEqual([
      { label: '*.txt;*.pcb', patterns: ['*.txt', '*.pcb'] },
    ]);
    expect(parseProgramFilter('Text|*.txt|All|*.*')).toEqual([
      { label: 'Text', patterns: ['*.txt'] },
      { label: 'All', patterns: ['*.*'] },
    ]);
    expect(parseProgramFilter('')).toEqual([ALL_FILES_FILTER]);
    expect(parseProgramFilter('broken')).toEqual([ALL_FILES_FILTER]);
  });

  it('the initial name: relative to the current directory, or a path the port handed out', () => {
    expect(initialPath('data.txt', '/browser/demo')).toBe('/browser/demo/data.txt');
    expect(initialPath('sub\\x.dat', '/browser/demo')).toBe('/browser/demo/sub/x.dat');
    expect(initialPath('/browser/other/y.txt', '/browser/demo')).toBe('/browser/other/y.txt');
    expect(initialPath('/Users/me/z.txt', '/disk/Users/me/demo')).toBe('/disk/Users/me/z.txt');
    expect(initialPath('C:\\x.txt', '/browser/demo')).toBeNull();
    expect(initialPath('', '/browser/demo')).toBeNull();
    expect(initialPath('x.txt', null)).toBeNull();
  });

  it('Open: the program title or "Open", one file, starting in the folder of the name', () => {
    expect(programDialogRequest(props({ title: 'Load level', filter: '*.lvl|*.lvl' }), '/browser/game')).toEqual({
      kind: 'open',
      request: {
        title: 'Load level',
        filters: [{ label: '*.lvl', patterns: ['*.lvl'] }],
        multiple: false,
        startDir: '/browser/game',
      },
    });
    const open = programDialogRequest(props({ initialName: 'maps\\one.lvl' }), '/browser/game');
    expect(open).toMatchObject({ kind: 'open', request: { title: 'Open', startDir: '/browser/game/maps' } });
  });

  it('Save: the program title or "Save As", no default extension, no overwrite question', () => {
    expect(programDialogRequest(props({ mode: 1, initialName: 'out.txt' }), '/browser/demo')).toEqual({
      kind: 'save',
      request: {
        title: 'Save As',
        filters: [ALL_FILES_FILTER],
        defaultExt: '',
        overwritePrompt: null,
        suggested: '/browser/demo/out.txt',
      },
    });
  });

  it('shows the dialog through ctx.fileDialogs and answers with the first chosen file', async () => {
    const asked: (OpenRequest | SaveRequest)[] = [];
    const fileDialogs: FileDialogs = {
      open: async (request) => {
        asked.push(request);
        return ['/browser/demo/a.txt', '/browser/demo/b.txt'];
      },
      save: async (request) => {
        asked.push(request);
        return null;
      },
      registerProvider: () => () => {},
    };
    const ctx = { fileDialogs, sim: { files: { currentDir: '/browser/demo' } } };
    expect(await showProgramFileDialog(ctx, props())).toBe('/browser/demo/a.txt');
    expect(await showProgramFileDialog(ctx, props({ mode: 1 }))).toBeNull();
    expect(asked.map((request) => request.title)).toEqual(['Open', 'Save As']);
  });
});

const job = (chars: PrintJob['chars'], size = 10): PrintJob => ({ font: { name: 'Courier New', size }, chars });

describe('print jobs', () => {
  const page = job([
    { x: 637, y: 600, ch: 0x41 },
    { x: 687, y: 600, ch: 0x3c },
    { x: 637, y: 694, ch: 0x43 },
    { x: 937, y: 694, ch: 0xe9 },
    { x: 637, y: 882, ch: 0x45 },
  ]);

  it('the label and the text of a job', () => {
    expect(jobLabel(page, 3)).toBe('Job 3 - 3 lines, 5 characters - Courier New 10');
    expect(jobLabel(job([{ x: 637, y: 600, ch: 0x41 }]), 1)).toBe('Job 1 - 1 line, 1 character - Courier New 10');
    expect(jobText(page)).toBe('A<\nC     é\n\nE');
    expect(jobText(job([]))).toBe('');
  });

  it('the document for Platform.print: one letter page, each character at its place', () => {
    const html = jobHtml(page, 'EASy68K printer output 1');
    expect(html).toContain('<title>EASy68K printer output 1</title>');
    expect(html).toContain('@page { size: 8.5in 11in; margin: 0; }');
    expect(html).toContain('font-size: 10pt');
    expect(html).toContain('<span style="left:1.0617in;top:1.0000in">A</span>');
    expect(html).toContain('<span style="left:1.1450in;top:1.0000in">&lt;</span>');
    expect(html).toContain('>é</span>');
  });

  it('waiting jobs, their numbers, printed or discarded ones leave the list', () => {
    const all: PrintJob[] = [job([]), job([])];
    const list = new PrintJobList(() => all);
    expect(list.waiting()).toEqual(all);
    expect(list.numberOf(all[1] as PrintJob)).toBe(2);
    list.settle(all[0] as PrintJob);
    all.push(job([]));
    expect(list.waiting()).toEqual([all[1], all[2]]);
    expect(list.numberOf(all[2] as PrintJob)).toBe(3);
  });
});

/** A session that has print jobs (the inert stub has none). */
function sessionWithJobs() {
  const jobs: PrintJob[] = [];
  const listeners = new Set<(job: PrintJob) => void>();
  const submit = (printed: PrintJob) => {
    jobs.push(printed);
    for (const listener of listeners) listener(printed);
  };
  const createSimSession = (ctx: AppContext): SimSession => ({
    ...createInertSimSession(ctx),
    printJobs: jobs,
    onPrintJob(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  return { jobs, submit, createSimSession };
}

describe('feature "sim-files" in a test application', () => {
  it('registers both dialogs and the Printer Setup command', () => {
    const app = createTestApplication({ features: [feature] });
    expect(app.dialogComponents.has(FILE_DIALOG_ID)).toBe(true);
    expect(app.dialogComponents.has(PRINTER_OUTPUT_DIALOG_ID)).toBe(true);
    expect(app.ctx.commands.isEnabled('sim.file.printerSetup')).toBe(true);
  });

  it('a finished job opens the Printer Output dialog without holding the program; once', async () => {
    const session = sessionWithJobs();
    const app = createTestApplication({
      features: [feature],
      services: { createSimSession: session.createSimSession },
    });
    await app.ctx.commands.run('app.mode.set', 'simulator');
    session.submit(job([{ x: 637, y: 600, ch: 0x41 }]));
    session.submit(job([{ x: 637, y: 600, ch: 0x42 }]));
    const stack = app.ctx.store.getState().dialogs.stack;
    expect(stack.map((d) => [d.id, d.modal])).toEqual([[PRINTER_OUTPUT_DIALOG_ID, false]]);
    expect(app.ctx.dialogs.isModalOpen()).toBe(false);
    expect(printerOutputOpen(app.ctx)).toBe(true);
    expect(printerStateOf(app.ctx).list.waiting()).toHaveLength(2);
  });

  it('File > Printer Setup... opens the dialog modal (as the original set-up dialog was)', async () => {
    const session = sessionWithJobs();
    const app = createTestApplication({
      features: [feature],
      services: { createSimSession: session.createSimSession },
    });
    await app.ctx.commands.run('app.mode.set', 'simulator');
    await app.ctx.commands.run('sim.file.printerSetup');
    const stack = app.ctx.store.getState().dialogs.stack;
    expect(stack.map((d) => [d.id, d.modal, d.props])).toEqual([[PRINTER_OUTPUT_DIALOG_ID, true, { modal: true }]]);
    expect(app.ctx.dialogs.isModalOpen()).toBe(true);
  });
});
