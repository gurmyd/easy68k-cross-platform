// The question before a large import and the storage line (ARCHITECTURE-PLUS P3.2.6), and an import
// that keeps the bytes it replaces (P3.2.4, P3.3.4), under Node.

import { describe, expect, it } from 'vitest';
import type { HistoryService } from '../../contracts';
import { createTestApplication } from '../../state/testing';
import { importInto } from './actions';
import { handleDrop } from './drop';
import { guardImport, isLargeImport, LARGE_IMPORT_BYTES, LARGE_IMPORT_FILES } from './import-guard';
import { createFileDialogs, dropDeps, feature } from './index';
import { storageLineText, throttle } from './StorageLine';
import { formatSize, largeImportQuestion, notEnoughRoom } from './texts';
import { ascii, memoryStores, scriptedDialogs, text } from './testing';

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe('the question before a large import (P3.2.6)', { timeout: 60_000 }, () => {
  it('thresholds: 100 files no, 101 yes; 10 MB no, 10 MB + 1 byte yes', () => {
    expect(LARGE_IMPORT_FILES).toBe(100);
    expect(LARGE_IMPORT_BYTES).toBe(10 * MB);
    expect(isLargeImport(100, 0)).toBe(false);
    expect(isLargeImport(101, 0)).toBe(true);
    expect(isLargeImport(1, 10 * MB)).toBe(false);
    expect(isLargeImport(1, 10 * MB + 1)).toBe(true);
  });

  it('asks with the free space when there is an estimate, without it otherwise', async () => {
    const { vfs } = memoryStores();
    const where = (dir: string) => (dir === '/browser/demo' ? 'My Programs/demo' : dir);
    const withEstimate = scriptedDialogs(['Yes']);
    const estimate = async () => ({ quota: 1.8 * GB + 100 * MB, usage: 100 * MB });
    expect(await guardImport({ vfs, dialogs: withEstimate, estimate, where }, '/browser/demo', 312, 48.2 * MB)).toBe(
      true,
    );
    expect(withEstimate.shown).toEqual([
      {
        title: 'Import',
        text: 'Import 312 files (48.2 MB) into My Programs/demo? The browser has about 1.8 GB free for this site.',
        icon: 'confirmation',
        buttons: ['Yes', 'No'],
      },
    ]);
    const without = scriptedDialogs(['No']);
    expect(await guardImport({ vfs, dialogs: without, estimate: null, where }, '/browser/demo', 101, 1000)).toBe(false);
    expect(without.texts()).toEqual(['Import 101 files (1000 bytes) into My Programs/demo?']);
    // Below the thresholds, nothing is asked.
    const small = scriptedDialogs([]);
    expect(await guardImport({ vfs, dialogs: small, estimate, where }, '/browser/demo', 100, 10 * MB)).toBe(true);
    expect(small.shown).toEqual([]);
  });

  it('not enough room: no question, the message, nothing imported', async () => {
    const { vfs } = memoryStores();
    const dialogs = scriptedDialogs([]);
    const estimate = async () => ({ quota: 100 * MB, usage: 100 * MB - 52.1 * MB });
    expect(await guardImport({ vfs, dialogs, estimate, where: () => 'My Programs' }, '/browser', 312, 48.2 * MB)).toBe(
      false,
    );
    expect(dialogs.shown).toEqual([
      {
        title: 'Import',
        text: "There is not enough room in this browser's storage for 312 files (48.2 MB): about 52.1 MB is free. Import fewer files, or delete files you no longer need.",
        icon: 'warning',
        buttons: ['OK'],
      },
    ]);
    expect(notEnoughRoom(312, 48.2 * MB, 20.1 * MB)).toBe(
      "There is not enough room in this browser's storage for 312 files (48.2 MB): about 20.1 MB is free. Import fewer files, or delete files you no longer need.",
    );
  });

  it('an opened folder or the desktop disk as the target: neither question', async () => {
    const { vfs } = memoryStores();
    const dialogs = scriptedDialogs([]);
    const estimate = async () => ({ quota: 10, usage: 10 });
    expect(await guardImport({ vfs, dialogs, estimate, where: () => '' }, '/folder', 5000, 5 * GB)).toBe(true);
    expect(dialogs.shown).toEqual([]);
  });

  it('Import Files with more than 100 files asks, and No imports nothing', async () => {
    const application = createTestApplication({ features: [feature], services: { createFileDialogs } });
    const { ctx } = application;
    const asked: string[] = [];
    ctx.dialogs.messageBox = async (request) => (asked.push(request.text), 'No');
    const items = Array.from({ length: 101 }, (_, i) => ({ rel: `f${i}.X68`, read: async () => ascii('x'), size: 1 }));
    expect(await importInto(ctx, '/browser', items)).toBeNull();
    expect(asked).toEqual([largeImportQuestion(101, 101, 'My Programs', null)]);
    expect(await ctx.vfs.list('/browser')).toEqual([]);
    application.dispose();
  });

  it('files dropped on the window: the same question before anything is copied', async () => {
    const application = createTestApplication({ features: [feature], services: { createFileDialogs } });
    const { ctx } = application;
    const asked: string[] = [];
    ctx.dialogs.messageBox = async (request) => (asked.push(request.text), 'No');
    const big = {
      name: 'big.bin',
      isFolder: false,
      read: async () => ascii('x'),
      handle: null,
      file: { size: 11 * MB },
    };
    const outcome = await handleDrop([big], dropDeps(ctx));
    expect(asked).toEqual(['Import 1 file (11.0 MB) into My Programs/Imported?']);
    expect(outcome.skipped).toEqual(['big.bin']);
    expect(await ctx.vfs.stat('/browser/Imported')).toBeNull();
    application.dispose();
  });

  it('sizes: one decimal, 1 kB = 1024 bytes', () => {
    expect(formatSize(0)).toBe('0 bytes');
    expect(formatSize(1023)).toBe('1023 bytes');
    expect(formatSize(1024)).toBe('1.0 kB');
    expect(formatSize(1.2 * MB)).toBe('1.2 MB');
    expect(formatSize(1.8 * GB)).toBe('1.8 GB');
  });
});

describe('an import that replaces a file keeps its bytes (P3.2.4, P3.3.4)', { timeout: 60_000 }, () => {
  it('a dropped file that replaces one in /browser/Imported keeps a Before import version', async () => {
    const application = createTestApplication({ features: [feature], services: { createFileDialogs } });
    const { ctx } = application;
    await ctx.vfs.writeFile('/browser/Imported/prog.X68', ascii('first'));
    ctx.dialogs.messageBox = async () => 'Yes';
    ctx.documents.open = async () => null;
    await handleDrop(
      [{ name: 'prog.X68', isFolder: false, read: async () => ascii('second'), handle: null }],
      dropDeps(ctx),
    );
    expect(text(await ctx.vfs.readFile('/browser/Imported/prog.X68'))).toBe('second');
    const history = ctx.history as HistoryService & { settled(): Promise<void> };
    await history.settled();
    const versions = await history.versions('/browser/Imported/prog.X68');
    expect(versions.map((v) => v.reason)).toEqual(['before-import']);
    expect(text(await history.read('/browser/Imported/prog.X68', versions[0]?.seq as number))).toBe('first');
    application.dispose();
  });

  it('Import Files that replaces a file keeps a Before import version', async () => {
    const application = createTestApplication({ features: [feature], services: { createFileDialogs } });
    const { ctx } = application;
    await ctx.vfs.writeFile('/browser/t/a.X68', ascii('old'));
    ctx.dialogs.messageBox = async () => 'Yes';
    await importInto(ctx, '/browser/t', [{ rel: 'a.X68', read: async () => ascii('new'), size: 3 }]);
    const history = ctx.history as HistoryService & { settled(): Promise<void> };
    await history.settled();
    expect((await history.versions('/browser/t/a.X68')).map((v) => v.reason)).toEqual(['before-import']);
    application.dispose();
  });
});

describe('the storage line (P3.2.6)', () => {
  it('in a browser, with and without an estimate; in the desktop app', () => {
    const figures = { estimate: { usage: 3.4 * MB, quota: 3.4 * MB + 1.8 * GB }, history: 1.2 * MB };
    expect(storageLineText(figures, 'web')).toBe(
      'This site uses 3.4 MB in this browser - Earlier versions and Trash: 1.2 MB - About 1.8 GB free',
    );
    expect(storageLineText({ history: 1.2 * MB }, 'web')).toBe('Earlier versions and Trash: 1.2 MB');
    expect(storageLineText(figures, 'desktop')).toBe('Earlier versions and Trash: 1.2 MB');
  });

  it('is refreshed at most once per second', () => {
    let now = 0;
    const timers: { at: number; fn: () => void }[] = [];
    let runs = 0;
    const t = throttle(() => runs++, 1000, {
      now: () => now,
      set: (fn, ms) => {
        const timer = { at: now + ms, fn };
        timers.push(timer);
        return () => timers.splice(timers.indexOf(timer), 1);
      },
    });
    t.request(); // at once
    for (let i = 0; i < 50; i++) t.request();
    expect(runs).toBe(1);
    now = 999;
    expect(runs).toBe(1);
    now = 1000;
    timers.shift()?.fn();
    expect(runs).toBe(2);
    now = 5000;
    t.request();
    expect(runs).toBe(3);
  });
});
