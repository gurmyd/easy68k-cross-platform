// Files handed to the installed web app through the launch queue (5.7; launch.ts).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { VPath } from '../../contracts';
import {
  launchQueueOf,
  notOpenedText,
  openLaunchedFiles,
  startLaunchQueue,
  type LaunchDeps,
  type LaunchParamsLike,
} from './launch';

const handle = (name: string) => ({ kind: 'file', name, getFile: async () => null });

function deps(overrides: Partial<LaunchDeps> = {}) {
  const log: string[] = [];
  const value: LaunchDeps = {
    platformKind: 'web',
    link: async (h) => {
      const name = (h as unknown as { name: string }).name;
      return name.startsWith('bad') ? null : (`/linked/0000abcd/${name}` as VPath);
    },
    openInEditor: async (paths) => void log.push(`editor ${paths.join(' ')}`),
    loadInSimulator: async (path) => void log.push(`simulator ${path}`),
    toast: (text) => void log.push(`toast ${text}`),
    ...overrides,
  };
  return { value, log };
}

describe('the launch queue of the installed web app (5.7)', () => {
  it('.X68 and .L68 open in Editor mode in the order given; the first .S68 is loaded in Simulator mode', async () => {
    const d = deps();
    await openLaunchedFiles(d.value, [handle('a.X68'), handle('prog.s68'), handle('b.L68'), handle('second.S68')]);
    expect(d.log).toEqual([
      'editor /linked/0000abcd/a.X68 /linked/0000abcd/b.L68',
      'simulator /linked/0000abcd/prog.s68',
    ]);
  });

  it('a file that cannot be linked is named in a toast; the others still open', async () => {
    const d = deps();
    await openLaunchedFiles(d.value, [handle('bad.X68'), handle('good.X68')]);
    expect(d.log).toEqual([`toast ${notOpenedText('bad.X68')}`, 'editor /linked/0000abcd/good.X68']);
    const none = deps({ link: null });
    await openLaunchedFiles(none.value, [handle('x.X68')]);
    expect(none.log).toEqual([`toast ${notOpenedText('x.X68')}`]);
    const throwing = deps({ link: async () => Promise.reject(new Error('gone')) });
    await openLaunchedFiles(throwing.value, [handle('x.S68')]);
    expect(throwing.log).toEqual([`toast ${notOpenedText('x.S68')}`]);
  });

  it('the consumer is set only on the web platform with a launch queue, and runs after init', async () => {
    let consumer: ((p: LaunchParamsLike) => void) | null = null;
    const queue = { setConsumer: (c: (p: LaunchParamsLike) => void) => void (consumer = c) };
    expect(launchQueueOf({ launchQueue: queue })).toBe(queue);
    expect(launchQueueOf({})).toBeNull();
    expect(launchQueueOf(null)).toBeNull();

    startLaunchQueue(deps({ platformKind: 'desktop' }).value, queue, () => {});
    expect(consumer).toBeNull();
    const d = deps();
    startLaunchQueue(d.value, queue, () => {});
    expect(consumer).not.toBeNull();
    consumer!({ files: [handle('a.X68')] });
    expect(d.log).toEqual([]); // not inside setConsumer's call: the providers register first
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(d.log).toEqual(['editor /linked/0000abcd/a.X68']);
    consumer!({});
  });

  it('the manifest declares the file handlers for .x68, .l68 and .s68', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../public/manifest.webmanifest', import.meta.url), 'utf8'));
    const accepted = (manifest.file_handlers as { action: string; accept: Record<string, string[]> }[]).flatMap(
      (entry) => Object.values(entry.accept).flat(),
    );
    expect(accepted.map((e) => e.toLowerCase()).sort()).toEqual(['.l68', '.s68', '.x68']);
    expect(manifest.file_handlers[0].action).toBe('./');
  });
});
