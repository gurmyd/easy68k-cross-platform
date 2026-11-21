// The EASyBIN commands in a whole application built from fakes (docs/porting/easybin.md 9-13).
// Owner: B1. The file dialogs are a scripted test double (FS1's are not used here); files live in the
// test application's memory store at /browser.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FileDialogs, OpenRequest, SaveRequest } from '../../contracts';
import { TITLE } from '../../core/easybin';
import { shellStateOf } from '../../state/shell';
import { createFakePlatform, createTestApplication } from '../../state/testing';
import { asciiRuns, hexRuns, keyByte, reuseRows, sameRow } from './EasybinWorkspace';
import { ABOUT_DIALOG_ID, aboutBoxKey, openDropped } from './commands';
import { feature } from './index';
import { easybinOf } from './session';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../../core/easybin/fixtures/${name}`, import.meta.url))));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function scriptedDialogs() {
  const opens: (string[] | null)[] = [];
  const saves: (string | null)[] = [];
  const openRequests: OpenRequest[] = [];
  const saveRequests: SaveRequest[] = [];
  const dialogs: FileDialogs = {
    open: async (request) => (openRequests.push(request), opens.shift() ?? null),
    save: async (request) => (saveRequests.push(request), saves.shift() ?? null),
    registerProvider: () => () => {},
  };
  return { dialogs, opens, saves, openRequests, saveRequests };
}

function start(platform = createFakePlatform()) {
  const files = scriptedDialogs();
  const app = createTestApplication({
    features: [feature],
    services: { createFileDialogs: () => files.dialogs },
    platform,
  });
  const { ctx } = app;
  const stack = () => ctx.store.getState().dialogs.stack;
  /** Every message box shown, as "title: text", in order. */
  const shown: string[] = [];
  /** Answers the next dialog with `result` (after recording it). */
  const answer = async (result: string) => {
    for (let i = 0; i < 50 && stack().length === 0; i++) await flush();
    const top = stack().at(-1);
    if (!top) throw new Error(`no dialog to answer ${result}`);
    const props = top.props as { title?: string; text?: string };
    shown.push(`${props.title}: ${props.text}`);
    app.dialogs.close(top.key, result);
    await flush();
  };
  const run = (id: string, ...answers: string[]) => {
    const done = ctx.commands.run(id);
    return (async () => {
      for (const a of answers) await answer(a);
      await done;
    })();
  };
  const session = easybinOf(ctx);
  return { app, ctx, files, run, answer, shown, stack, model: session.model, session };
}

describe('feature easybin', () => {
  it('registers sim.view.easybin and every bin.* command, the two panels and the About box', () => {
    const { app } = start();
    for (const id of [
      'bin.file.new',
      'bin.file.openSrec',
      'bin.file.openBinary',
      'bin.file.saveSrec',
      'bin.file.saveBinary',
      'bin.file.exit',
      'bin.help.help',
      'bin.help.about',
      'sim.view.easybin',
    ]) {
      expect(app.commands.hasHandler(id), id).toBe(true);
    }
    expect(app.panels.find('easybin', 'easybin')).toBeDefined();
    // The original has no status bar; its caption is the window title (see below).
    expect(app.panels.find('easybin', 'status')).toBeUndefined();
    expect(app.dialogComponents.has(ABOUT_DIALOG_ID)).toBe(true);
  });

  it('Simulator View > EASyBIN switches to EASyBIN mode', async () => {
    const { ctx } = start();
    await ctx.commands.run('sim.view.easybin');
    expect(ctx.store.getState().mode).toBe('easybin');
  });

  it('File > New asks Caution with OK / Cancel; Cancel keeps memory', async () => {
    const { run, model, shown, stack } = start();
    model.memory[0] = 0;
    await run('bin.file.new', 'Cancel');
    expect(model.memory[0]).toBe(0);
    expect(shown).toEqual(['Caution: The current environment will be lost, click OK to continue.']);
    await run('bin.file.new', 'OK');
    expect(model.memory[0]).toBe(0xff);
    expect(stack()).toEqual([]);
  });

  it('Open S-Record: the dialog with the original filters, the loader message, the fields', async () => {
    const { ctx, run, files, model, shown } = start();
    await ctx.vfs.writeFile('/browser/demo/prog.S68', fixture('asm-hello.S68'));
    files.opens.push(['/browser/demo/prog.S68']);
    await run('bin.file.openSrec', 'OK');
    expect(files.openRequests[0]).toMatchObject({
      title: 'Open',
      multiple: false,
      filters: [
        { label: 'EASy68K S-Record [.S68]', patterns: ['*.S68'] },
        { label: 'Motorola S-Record [.S3][.S19]', patterns: ['*.S3', '*.S19'] },
        { label: 'Other S-Record', patterns: ['*.*'] },
      ],
    });
    expect(shown).toEqual([
      'EASyBIN: S Record loaded successfully.\n\nS0 description record contains:\nS0 = 68KPROG   20CREATED BY EASY68K\n',
    ]);
    expect(model.getState().caption).toBe('/browser/demo/prog.S68');
    expect(model.getState().fields.lastAddress).toBe('001022');
    // the next Open starts in that folder
    files.opens.push(null);
    await run('bin.file.openBinary');
    expect(files.openRequests[1]).toMatchObject({
      startDir: '/browser/demo',
      filters: [
        { label: 'Binary File [.BIN]', patterns: ['*.BIN'] },
        { label: 'Any File', patterns: ['*.*'] },
      ],
    });
  });

  it('Open of a file that cannot be read: the two texts of the original', async () => {
    const { run, files, shown } = start();
    files.opens.push(['/browser/none.S68'], ['/browser/none.BIN']);
    await run('bin.file.openSrec', 'OK');
    await run('bin.file.openBinary', 'OK');
    expect(shown).toEqual([
      'EASyBIN: error: cannot open file /browser/none.S68',
      'EASyBIN: Error openning /browser/none.BIN',
    ]);
  });

  it('Open Binary loads at First Address with the split', async () => {
    const { ctx, run, files, model } = start();
    await ctx.vfs.writeFile('/browser/b.BIN', fixture('bin5.BIN'));
    model.setField('firstAddress', '003000');
    model.setSplit(2);
    files.opens.push(['/browser/b.BIN']);
    await run('bin.file.openBinary');
    expect(Array.from(model.memory.subarray(0x3000, 0x300a))).toEqual([1, 0xff, 2, 0xff, 3, 0xff, 4, 0xff, 5, 0xff]);
    expect(model.getState().fields.outLength).toBe('00000B');
  });

  it('Save S-Record: confirmation, save dialog without its own question, the original file', async () => {
    const { ctx, run, files, model, shown } = start();
    await ctx.vfs.writeFile('/browser/p.S68', fixture('asm-hello.S68'));
    files.opens.push(['/browser/p.S68']);
    await run('bin.file.openSrec', 'OK');
    model.setField('from', '001000');
    model.setField('to', '001023');
    shown.length = 0;

    await run('bin.file.saveSrec', 'No');
    expect(files.saveRequests).toEqual([]);

    files.saves.push('/browser/out.S68');
    await run('bin.file.saveSrec', 'Yes');
    expect(shown).toEqual([
      'S-Record Creation: S-Record file information:\n\nFrom:$001000  To:$001023\nStart Address:$00001000\n\nCreate S-Record?',
      'S-Record Creation: S-Record file information:\n\nFrom:$001000  To:$001023\nStart Address:$00001000\n\nCreate S-Record?',
    ]);
    expect(files.saveRequests[0]).toMatchObject({
      title: 'Save As',
      defaultExt: 'S68',
      overwritePrompt: null,
      filters: [
        { label: 'EASy68K S-Record [.S68]', patterns: ['*.S68'] },
        { label: 'Motorola S-Record [.S3]', patterns: ['*.S3'] },
        { label: 'Other S-Record', patterns: ['*.*'] },
      ],
    });
    const written = new TextDecoder('latin1').decode(await ctx.vfs.readFile('/browser/out.S68'));
    expect(written).toBe(
      'S0210000535245434F5244202020313143524541544544204259204541535942494E2C\r\n' +
        'S123100043F900001010103C000E4E4FFFFFFFFF48656C6C6F2C204541537942494EE9FC2D\r\n' +
        'S10610207F1F002B\r\n' +
        'S70500001000EA\r\n',
    );

    // An existing file (any letter case): the original's Alert; No keeps it. The dialog suggests the last name.
    shown.length = 0;
    files.saves.push('/browser/OUT.s68');
    model.setField('to', '001001');
    await run('bin.file.saveSrec', 'Yes', 'No');
    expect(files.saveRequests[1]?.suggested).toBe('/browser/out.S68');
    expect(shown[1]).toBe('Alert: File exists! OK to replace?');
    expect((await ctx.vfs.readFile('/browser/out.S68')).length).toBe(written.length);
  });

  it('Save S-Record with From > To: Invalid memory range., no dialog', async () => {
    const { run, files, model, shown } = start();
    model.setField('from', '001001');
    model.setField('to', '001000');
    await run('bin.file.saveSrec', 'Yes', 'OK');
    expect(shown[1]).toBe('Information: Invalid memory range.');
    expect(files.saveRequests).toEqual([]);
  });

  it('Save Binary with 2 files writes name_0 and name_1; the question looks at all four names', async () => {
    const { ctx, run, files, model, shown } = start();
    model.memory.set([1, 2, 3, 4, 5, 6], 0x5000);
    model.setField('firstAddress', '005000');
    model.setField('outLength', '000005');
    model.setSplit(2);
    files.saves.push('/browser/rom.BIN');
    await run('bin.file.saveBinary');
    expect(files.saveRequests[0]).toMatchObject({ defaultExt: 'BIN', overwritePrompt: null });
    expect(Array.from(await ctx.vfs.readFile('/browser/rom_0.BIN'))).toEqual([1, 3, 5]);
    expect(Array.from(await ctx.vfs.readFile('/browser/rom_1.BIN'))).toEqual([2, 4, 6]); // Q4
    expect(await ctx.vfs.stat('/browser/rom.BIN')).toBeNull();

    await ctx.vfs.writeFile('/browser/one_3.BIN', new Uint8Array([9]));
    model.setSplit(0);
    files.saves.push('/browser/one.BIN');
    await run('bin.file.saveBinary', 'No');
    expect(shown).toEqual(['Alert: File exists! OK to replace?']);
    expect(await ctx.vfs.stat('/browser/one.BIN')).toBeNull();
  });

  it('Save Binary past the end of memory: Invalid memory range.', async () => {
    const { run, files, model, shown } = start();
    model.setField('firstAddress', 'FFFFF0');
    model.setField('outLength', '000010');
    await run('bin.file.saveBinary', 'OK');
    expect(shown).toEqual(['Information: Invalid memory range.']);
    expect(files.saveRequests).toEqual([]);
  });

  it('a dropped file that is not an S-record: the loader message, then Opening as binary file.', async () => {
    const { ctx, answer, shown, model } = start();
    model.setField('firstAddress', '006000');
    const done = openDropped(ctx, [{ name: 'code.BIN', data: fixture('non-srec.BIN') }]);
    await answer('OK');
    await answer('OK');
    await done;
    expect(shown).toEqual([
      'EASyBIN: Invalid data on line 1\n1: NqNu\n\nOpen stopped.',
      'EASyBIN: Opening as binary file.',
    ]);
    expect(model.memory[0x6000]).toBe(0x4e);
    expect(model.getState().caption).toBe('code.BIN');
  });

  it('Exit in a browser shows the exit screen; the desktop app quits', async () => {
    const web = start();
    await web.ctx.commands.run('bin.file.exit');
    expect(shellStateOf(web.ctx).getState().exited).toBe(true);
    let quits = 0;
    const desktop = start(createFakePlatform({ kind: 'desktop', quit: () => void quits++ }));
    await desktop.ctx.commands.run('bin.file.exit');
    expect(quits).toBe(1);
  });

  it('About EASyBIN opens its dialog; Help asks for easybin.htm', async () => {
    const { ctx, app, stack } = start();
    let page: unknown = null;
    app.commands.register('ed.help.help', { run: (_ctx, arg) => void (page = arg) });
    await ctx.commands.run('bin.help.help');
    expect(page).toBe('easybin.htm');
    void ctx.commands.run('bin.help.about');
    await flush();
    expect(stack().at(-1)?.id).toBe(ABOUT_DIALOG_ID);
  });

  it('F1 in the About box asks for credits.htm, also while the modal box is open', async () => {
    const { ctx, app, stack } = start();
    let page: unknown = null;
    app.commands.register('ed.help.help', { run: (_ctx, arg) => void (page = arg) });
    void ctx.commands.run('bin.help.about');
    await flush();
    expect(stack().at(-1)?.id).toBe(ABOUT_DIALOG_ID);
    expect(ctx.dialogs.isModalOpen()).toBe(true);
    const keys = { ctrlKey: false, altKey: false, metaKey: false, shiftKey: false };
    expect(aboutBoxKey(ctx, { key: 'F2', ...keys })).toBe(false);
    expect(aboutBoxKey(ctx, { key: 'F1', ...keys, shiftKey: true })).toBe(false);
    await flush();
    expect(page).toBeNull();
    expect(aboutBoxKey(ctx, { key: 'F1', ...keys })).toBe(true);
    await flush();
    expect(page).toBe('credits.htm');
  });

  it('the window title is the caption: the opened file, and the fixed title again after New', async () => {
    const platform = createFakePlatform();
    const { ctx, run, answer, files, model } = start(platform);
    const title = () => shellStateOf(ctx).getState().modeTitles.easybin ?? null;
    expect(model.getState().caption).toBe(TITLE);
    expect(title()).toBeNull();
    await ctx.commands.run('app.mode.set', 'easybin');
    expect(platform.titles.at(-1)).toMatch(/^EASyBIN v2\.5\.0 - unofficial port /);

    await ctx.vfs.writeFile('/browser/demo/prog.S68', fixture('asm-hello.S68'));
    files.opens.push(['/browser/demo/prog.S68']);
    await run('bin.file.openSrec', 'OK');
    expect(title()).toBe('/browser/demo/prog.S68');
    expect(platform.titles.at(-1)).toMatch(/^\/browser\/demo\/prog\.S68 - unofficial port /);

    await run('bin.file.new', 'OK');
    expect(title()).toBeNull();
    expect(platform.titles.at(-1)).toMatch(/^EASyBIN v2\.5\.0 - unofficial port /);

    const done = openDropped(ctx, [{ name: 'code.BIN', data: fixture('non-srec.BIN') }]);
    await answer('OK');
    await answer('OK');
    await done;
    expect(title()).toBe('code.BIN');
  });
});

describe('redrawing the memory rows', () => {
  it('after a typed byte only the row that changed draws differently (the others are not redrawn)', () => {
    const { model } = start();
    model.setRows(20);
    model.ensureCursor();
    const before = model.viewRows();
    expect(model.typeByte(0x41)).not.toBe('beep');
    const after = model.viewRows();
    const changed = after.map((row, i) => !sameRow(row, before[i] as (typeof before)[number]));
    expect(changed.filter(Boolean)).toHaveLength(1);
    // A change of the colours alone (the binary range) redraws the rows it touches.
    model.setField('firstAddress', '000000');
    model.setField('outLength', '000010');
    const coloured = model.viewRows();
    expect(coloured.map((row, i) => !sameRow(row, after[i] as (typeof after)[number])).filter(Boolean).length).toBe(1);
  });

  it('a typed byte makes one new row item; every other row keeps its item (one element per key, not one per row)', () => {
    const { model } = start();
    model.setRows(60);
    model.ensureCursor();
    let made = 0;
    const make = (_row: unknown, index: number) => ({ index, serial: ++made });
    const first = reuseRows([], model.viewRows(), make);
    expect(made).toBe(60);
    expect(model.typeByte(0x41)).not.toBe('beep');
    const second = reuseRows(first, model.viewRows(), make);
    expect(made).toBe(61);
    expect(second.filter((d, i) => d !== first[i]).map((d) => d.item.index)).toEqual([0]);
    // The same at the end of memory (the cost does not depend on the address).
    model.setField('address', 'FFFFF0');
    const third = reuseRows(second, model.viewRows(), make);
    const madeBefore = made;
    model.ensureCursor();
    expect(model.typeByte(0x42)).not.toBe('beep');
    reuseRows(third, model.viewRows(), make);
    expect(made - madeBefore).toBe(1);
    // A row is drawn as runs of one colour: the text is the original's, cell by cell.
    model.setField('firstAddress', 'FFFFF4');
    model.setField('outLength', '000004');
    model.setSplit(2);
    model.memory[0xfffff0] = 0x7f;
    model.memory[0xfffff1] = 0x41;
    model.touch();
    const [last] = model.viewRows();
    const lastRow = last as NonNullable<typeof last>;
    expect(
      hexRuns(lastRow)
        .map((r) => r.text)
        .join(''),
    ).toBe(lastRow.hex.map((c) => `${c} `).join(''));
    expect(hexRuns(lastRow).map((r) => r.tone)).toEqual(['gray', 'file0', 'file1', 'file0', 'file1', 'gray']);
    expect(asciiRuns(lastRow)).toEqual([{ tone: false, text: '□A--------------' }]);
    // The row past the end of memory: one run of 16 cells drawn as invalid.
    const beyond = model.viewRows()[1] as NonNullable<typeof last>;
    expect(asciiRuns(beyond)).toEqual([{ tone: true, text: '----------------' }]);
    expect(hexRuns(beyond)).toEqual([{ tone: 'invalid', text: 'xx '.repeat(16) }]);
    // Fewer rows: the list shrinks with them.
    model.setRows(10);
    expect(reuseRows(third, model.viewRows(), make)).toHaveLength(10);
  });
});

describe('keys typed into the memory area (7.4)', () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) =>
    keyByte({ key: k, ctrlKey: false, altKey: false, metaKey: false, ...mods });
  it('characters as Windows-1252 bytes; Backspace, Enter, Esc and Ctrl+letter as control characters', () => {
    expect(key('a')).toBe(0x61);
    expect(key('é')).toBe(0xe9);
    expect(key('€')).toBe(0x80);
    expect(key('Backspace')).toBe(0x08);
    expect(key('Enter')).toBe(0x0d);
    expect(key('Escape')).toBe(0x1b);
    expect(key('c', { ctrlKey: true })).toBe(0x03);
    expect(key('@', { ctrlKey: true, altKey: true })).toBe(0x40); // AltGr on Windows
    expect(key('Ω')).toBe('refuse');
    expect(key('Shift')).toBeNull();
    expect(key('a', { metaKey: true })).toBeNull();
    expect(key('Tab')).toBeNull();
  });
});
