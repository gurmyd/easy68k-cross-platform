// settings.transfer under Node (ARCHITECTURE.md 3.10, 5.6): imports go through the settings
// service, reach another window and are not undone by it; exports write the original's files.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TabType, type FileDialogs, type OpenRequest, type SaveRequest, type VPath } from '../../contracts';
import { decode } from '../../core/codec/cp1252';
import { parseSettingsDat, parseSim68KDat } from '../../core/settings/dat-codec';
import { MemorySettingsStorage } from '../../core/settings/service';
import { panelVisible } from '../../state/panels';
import { createTestApplication } from '../../state/testing';
import { feature } from './index';
import { exportBytes, exportFile, importBytes, importFile, transferFilters } from './transfer';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../core/settings/dat-codec/fixtures/${name}`, import.meta.url))),
  );

/** File dialogs that answer from a queue and record what they were asked. */
function scriptedDialogs(answers: (VPath | null)[]) {
  const asked: (OpenRequest | SaveRequest)[] = [];
  const dialogs: FileDialogs = {
    open: async (request) => {
      asked.push(request);
      const answer = answers.shift() ?? null;
      return answer === null ? null : [answer];
    },
    save: async (request) => {
      asked.push(request);
      return answers.shift() ?? null;
    },
    registerProvider: () => () => {},
  };
  return { dialogs, asked };
}

function application(storage = new MemorySettingsStorage(), answers: (VPath | null)[] = []) {
  const files = scriptedDialogs(answers);
  const app = createTestApplication({
    features: [feature],
    storage,
    services: { createFileDialogs: () => files.dialogs },
  });
  return Object.assign(app, { asked: files.asked });
}

describe('import', () => {
  it('settings.dat: the shipped file sets the "Shipped file" values; the port\'s own settings stay', () => {
    const app = application();
    app.ctx.settings.update((s) => ({
      ...s,
      editor: { ...s.editor, fontSize: 14, realTabs: true, lineNumbers: false, template: 'T\n', colorPreset: 5 },
    }));
    importBytes(app.ctx, 'settings', fixture('shipped-settings.dat'));
    const editor = app.ctx.settings.get().editor;
    expect([editor.fontSize, editor.realTabs, editor.colorPreset, editor.tabType]).toEqual([
      10,
      false,
      -1,
      TabType.Fixed,
    ]);
    expect([editor.lineNumbers, editor.template]).toEqual([false, 'T\n']);
  });

  it("settings.dat with a line missing: later settings go back to the original's defaults", () => {
    const app = application();
    app.ctx.settings.update((s) => ({ ...s, editor: { ...s.editor, printBlack: false, backgroundColor: 1 } }));
    const lines = decode(fixture('written-settings.dat')).split('\r\n');
    lines.splice(40, 1);
    importBytes(
      app.ctx,
      'settings',
      Uint8Array.from(lines.join('\r\n'), (c) => c.charCodeAt(0)),
    );
    const editor = app.ctx.settings.get().editor;
    expect(editor.fontName).toBe('Fixedsys'); // before the gap: from the file
    expect(editor.printBlack).toBe(true); // after it: the original's default
    expect(editor.backgroundColor).toBe(16777215);
  });

  it('sim68K.dat: the settings and the three panels', () => {
    const app = application();
    app.ctx.settings.update((s) => ({ ...s, sim: { ...s.sim, autoTraceIntervalMs: 500 } }));
    importBytes(app.ctx, 'sim', fixture('written-sim68K.dat'));
    const sim = app.ctx.settings.get().sim;
    expect([sim.execLogType, sim.memoryAddress, sim.autoTraceIntervalMs, sim.listingFont.name]).toEqual([
      3,
      0xabcd,
      650,
      'Lucida Console',
    ]);
    expect(['memory', 'stack', 'hardware'].map((id) => panelVisible(app.ctx, id))).toEqual([true, false, true]);
    importBytes(app.ctx, 'sim', fixture('shipped-sim68K.dat'));
    expect(['memory', 'stack', 'hardware'].map((id) => panelVisible(app.ctx, id))).toEqual([false, false, false]);
    expect(app.ctx.settings.get().sim.autoTraceIntervalMs).toBe(200);
  });

  it('template.NEW', () => {
    const app = application();
    importBytes(
      app.ctx,
      'template',
      Uint8Array.from('A\r\n\tB\r\n', (c) => c.charCodeAt(0)),
    );
    expect(app.ctx.settings.get().editor.template).toBe('A\n\tB\n');
  });

  it('reaches the other window at once, and that window cannot write the old values back', () => {
    const storage = new MemorySettingsStorage();
    const a = application(storage);
    const b = application(storage);
    importBytes(a.ctx, 'settings', fixture('written-settings.dat'));
    expect(b.ctx.settings.get().editor.fontName).toBe('Fixedsys');
    // B writes something else, from what it knows: the import stays.
    b.ctx.settings.update((s) => ({ ...s, editor: { ...s.editor, lineNumbers: false } }));
    for (const app of [a, b]) {
      expect(app.ctx.settings.get().editor.fontName).toBe('Fixedsys');
      expect(app.ctx.settings.get().editor.lineNumbers).toBe(false);
    }
    const stored = JSON.parse(storage.text ?? '{}');
    expect(stored.editor.fontName).toBe('Fixedsys');
    expect(stored.stamps['editor.fontName']).toBeDefined();
  });

  it("Import... asks for one file with the file's filters and reports where it came from", async () => {
    const app = application(undefined, ['/browser/my.dat', null]);
    await app.ctx.vfs.writeFile('/browser/my.dat', fixture('written-settings.dat'));
    const done = await importFile(app.ctx, 'settings');
    expect(done).toEqual({ status: 'done', message: 'Imported settings.dat from /browser/my.dat.' });
    expect(app.asked[0]).toEqual({
      title: 'Import settings.dat',
      filters: transferFilters('settings'),
      multiple: false,
    });
    expect(app.ctx.settings.get().editor.fontName).toBe('Fixedsys');
    expect(await importFile(app.ctx, 'settings')).toEqual({ status: 'cancelled', message: '' });
  });

  it('a file that cannot be read is reported and changes nothing', async () => {
    const app = application(undefined, ['/browser/missing.dat']);
    const before = app.ctx.settings.get();
    const result = await importFile(app.ctx, 'sim');
    expect(result.status).toBe('failed');
    expect(result.message.startsWith('sim68K.dat could not be transferred: ')).toBe(true);
    expect(app.ctx.settings.get()).toEqual(before);
  });
});

describe('export', () => {
  it('settings.dat: the Auto preset as -1 with the Color1 values', () => {
    const app = application();
    const parsed = parseSettingsDat(exportBytes(app.ctx, 'settings').bytes);
    expect(parsed.colorPreset).toBe(-1);
    expect(decode(exportBytes(app.ctx, 'settings').bytes).split('\r\n')).toHaveLength(58);
  });

  it('sim68K.dat: the panels as this window shows them', async () => {
    const app = application();
    importBytes(app.ctx, 'sim', fixture('written-sim68K.dat'));
    const { panels } = parseSim68KDat(exportBytes(app.ctx, 'sim').bytes);
    expect(panels).toEqual({ memory: true, stack: false, hardware: true });
    expect(Array.from(exportBytes(app.ctx, 'sim').bytes)).toEqual(Array.from(fixture('written-sim68K.dat')));
  });

  it('template.NEW: the default template is the shipped file', () => {
    const app = application();
    expect(Array.from(exportBytes(app.ctx, 'template').bytes)).toEqual(Array.from(fixture('shipped-template.NEW')));
  });

  it('Export... asks where, suggests the file name in the browser store, and writes the bytes', async () => {
    const app = application(undefined, ['/browser/out/settings.dat', null]);
    await app.ctx.vfs.mkdirp('/browser/out');
    const result = await exportFile(app.ctx, 'settings');
    expect(result).toEqual({ status: 'done', message: 'Exported settings.dat to /browser/out/settings.dat.' });
    expect(app.asked[0]).toEqual({
      title: 'Export settings.dat',
      filters: transferFilters('settings'),
      defaultExt: '.dat',
      suggested: '/browser/settings.dat',
    });
    const written = await app.ctx.vfs.readFile('/browser/out/settings.dat');
    expect(Array.from(written)).toEqual(Array.from(exportBytes(app.ctx, 'settings').bytes));
    expect(await exportFile(app.ctx, 'template')).toEqual({ status: 'cancelled', message: '' });
  });

  it('a template with characters Windows-1252 cannot hold says so', async () => {
    const app = application(undefined, ['/browser/template.NEW']);
    app.ctx.settings.update((s) => ({ ...s, editor: { ...s.editor, template: '中\n' } }));
    const result = await exportFile(app.ctx, 'template');
    expect(result.message).toContain('written as "?"');
  });
});
