// The browser adapters (state/browser.ts), the stub services of 3.12.3 (state/stub-services.ts)
// and the editor-extension registry (state/editor-extensions.ts).

import { describe, expect, it, vi } from 'vitest';
import { Box, type DocumentState, type Extension } from '../contracts';
import { DEFAULT_TEMPLATE } from '../core/settings/defaults';
import { SETTINGS_KEY } from '../core/settings/service';
import {
  FRAME_WATCHDOG_MS,
  WATCHDOG_FRAME_MS,
  browserSettingsStorage,
  createFrameScheduler,
  type FrameSource,
} from './browser';
import { createEditorExtensionRegistry, editorExtensionSources, subscribeEditorExtensions } from './editor-extensions';
import {
  createInertController,
  createInertEngine,
  createSilentAudioBackend,
  createStubFileDialogs,
} from './stub-services';
import { createTestApplication } from './testing';

/** Frames and timers that move only when the test says so. */
function fakeFrames() {
  let now = 0;
  let nextHandle = 1;
  const frames = new Map<number, (now: number) => void>();
  const timers = new Map<number, { at: number; callback: () => void }>();
  const source: FrameSource = {
    requestFrame(callback) {
      frames.set(nextHandle, callback);
      return nextHandle++;
    },
    cancelFrame: (handle) => void frames.delete(handle),
    setTimeout(callback, delayMs) {
      timers.set(nextHandle, { at: now + delayMs, callback });
      return nextHandle++;
    },
    clearTimeout: (handle) => void timers.delete(handle),
    now: () => now,
  };
  return {
    source,
    pendingFrames: () => frames.size,
    pendingTimers: () => timers.size,
    /** The display delivers a frame. */
    frame(at: number) {
      now = at;
      const due = [...frames.entries()];
      frames.clear();
      for (const [, callback] of due) callback(now);
    },
    /** Time passes without a frame (hidden tab). */
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].callback();
      }
      now = end;
    },
  };
}

describe('createFrameScheduler (3.11.1)', () => {
  it('calls onFrame once per display frame', () => {
    const frames = fakeFrames();
    const scheduler = createFrameScheduler(frames.source);
    const seen: number[] = [];
    scheduler.onFrame((now) => seen.push(now));
    frames.frame(16);
    frames.frame(33);
    frames.frame(50);
    expect(seen).toEqual([16, 33, 50]);
  });

  it('calls from a timer when no frame has arrived for 250 ms, and returns to frames afterwards', () => {
    const frames = fakeFrames();
    const scheduler = createFrameScheduler(frames.source);
    const seen: number[] = [];
    scheduler.onFrame((now) => seen.push(now));
    frames.frame(16);
    frames.advance(FRAME_WATCHDOG_MS - 1);
    expect(seen).toEqual([16]); // nothing before 250 ms without a frame
    frames.advance(999 - (FRAME_WATCHDOG_MS - 1)); // the tab is hidden: no frames for a second
    // The watchdog takes over at 250 ms and then stands in for the display, 60 times a second
    // (SH8-frame-watchdog.md): a program keeps its speed in a hidden desktop window.
    const fromTimer = seen.slice(1);
    expect(fromTimer[0]).toBe(16 + FRAME_WATCHDOG_MS);
    for (let i = 1; i < fromTimer.length; i++) {
      expect((fromTimer[i] as number) - (fromTimer[i - 1] as number)).toBeCloseTo(WATCHDOG_FRAME_MS, 6);
    }
    expect(fromTimer.length).toBe(1 + Math.floor((999 - FRAME_WATCHDOG_MS) / WATCHDOG_FRAME_MS));
    frames.frame(1100);
    expect(seen[seen.length - 1]).toBe(1100);
    // A frame re-arms the watchdog: nothing fires for the next 249 ms.
    const count = seen.length;
    frames.advance(249);
    expect(seen).toHaveLength(count);
  });

  it('stops asking for frames and timers when the last callback is removed', () => {
    const frames = fakeFrames();
    const scheduler = createFrameScheduler(frames.source);
    const stopA = scheduler.onFrame(() => {});
    const stopB = scheduler.onFrame(() => {});
    expect(frames.pendingFrames()).toBe(1);
    expect(frames.pendingTimers()).toBe(1);
    stopA();
    expect(frames.pendingFrames()).toBe(1);
    stopB();
    expect(frames.pendingFrames()).toBe(0);
    expect(frames.pendingTimers()).toBe(0);
  });

  it('lets a callback remove itself during a frame', () => {
    const frames = fakeFrames();
    const scheduler = createFrameScheduler(frames.source);
    let calls = 0;
    const stop = scheduler.onFrame(() => {
      calls++;
      stop();
    });
    frames.frame(16);
    frames.frame(33);
    frames.advance(1000);
    expect(calls).toBe(1);
    expect(frames.pendingFrames()).toBe(0);
  });

  it('setTimer fires once after the delay and can be cancelled', () => {
    const frames = fakeFrames();
    const scheduler = createFrameScheduler(frames.source);
    const fired = vi.fn();
    scheduler.setTimer(100, fired);
    const cancel = scheduler.setTimer(100, fired);
    cancel();
    frames.advance(99);
    expect(fired).not.toHaveBeenCalled();
    frames.advance(1);
    expect(fired).toHaveBeenCalledTimes(1);
    frames.advance(500);
    expect(fired).toHaveBeenCalledTimes(1);
  });
});

describe('browserSettingsStorage (3.10)', () => {
  function fakeWindow() {
    const items = new Map<string, string>();
    const listeners = new Set<(event: StorageEvent) => void>();
    const win = {
      localStorage: {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
      },
      addEventListener: (_type: string, listener: (event: StorageEvent) => void) => void listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: StorageEvent) => void) => void listeners.delete(listener),
    };
    const fire = (key: string | null, newValue: string | null = null) => {
      for (const listener of [...listeners]) listener({ key, newValue } as StorageEvent);
    };
    return { win: win as unknown as Window, items, fire, listeners };
  }

  it('reads and writes the key easy68k.settings.v1', () => {
    const { win, items } = fakeWindow();
    const storage = browserSettingsStorage(win);
    expect(storage.read()).toBeNull();
    storage.write('{"version":1}');
    expect(items.get(SETTINGS_KEY)).toBe('{"version":1}');
    expect(SETTINGS_KEY).toBe('easy68k.settings.v1');
    expect(storage.read()).toBe('{"version":1}');
  });

  it('gives the stamps of changed settings the wall clock that every window shares', () => {
    const before = Date.now();
    const time = browserSettingsStorage(fakeWindow().win).now?.() ?? -1;
    expect(time).toBeGreaterThanOrEqual(before);
    expect(time).toBeLessThanOrEqual(Date.now());
  });

  it('reports storage events for its key (and a cleared storage), not for other keys', () => {
    const { win, fire, listeners } = fakeWindow();
    const changed = vi.fn();
    const stop = browserSettingsStorage(win).onExternalChange(changed);
    fire('easy68k.files.index', '{}');
    expect(changed).not.toHaveBeenCalled();
    fire(SETTINGS_KEY, '{"version":1}');
    fire(SETTINGS_KEY, null);
    fire(null);
    expect(changed).toHaveBeenCalledTimes(3);
    stop();
    expect(listeners.size).toBe(0);
  });

  it("hands on the text the other window wrote (the event's newValue), not this page's copy", () => {
    // The page's own copy may still be older when the event arrives (errata W3 entry 26).
    const { win, items, fire } = fakeWindow();
    items.set(SETTINGS_KEY, '{"version":1,"old":true}');
    const changed = vi.fn();
    browserSettingsStorage(win).onExternalChange(changed);
    fire(SETTINGS_KEY, '{"version":1,"new":true}');
    expect(changed).toHaveBeenLastCalledWith('{"version":1,"new":true}');
    fire(SETTINGS_KEY, null); // removed
    expect(changed).toHaveBeenLastCalledWith(null);
    fire(null); // the whole storage cleared
    expect(changed).toHaveBeenLastCalledWith(null);
  });

  it('runs a write-back after a short pause, at once when the page is hidden, never after cancel', () => {
    vi.useFakeTimers();
    try {
      const byType = new Map<string, Set<() => void>>();
      const win = {
        setTimeout: (task: () => void, ms: number) => globalThis.setTimeout(task, ms),
        clearTimeout: (id: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(id),
        addEventListener: (type: string, listener: () => void) => {
          if (!byType.has(type)) byType.set(type, new Set());
          byType.get(type)?.add(listener);
        },
        removeEventListener: (type: string, listener: () => void) => void byType.get(type)?.delete(listener),
      } as unknown as Window;
      const storage = browserSettingsStorage(win);
      const task = vi.fn();
      storage.defer?.(task);
      vi.advanceTimersByTime(5);
      expect(task).not.toHaveBeenCalled();
      vi.advanceTimersByTime(50);
      expect(task).toHaveBeenCalledTimes(1);
      expect(byType.get('pagehide')?.size ?? 0).toBe(0);

      const hidden = vi.fn();
      storage.defer?.(hidden);
      for (const listener of [...(byType.get('pagehide') ?? [])]) listener();
      expect(hidden).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(100);
      expect(hidden).toHaveBeenCalledTimes(1);

      const cancelled = vi.fn();
      const cancel = storage.defer?.(cancelled);
      cancel?.();
      vi.advanceTimersByTime(100);
      for (const listener of [...(byType.get('pagehide') ?? [])]) listener();
      expect(cancelled).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the stub services (3.12.3)', () => {
  it('one in-memory document made from the template', async () => {
    const app = createTestApplication();
    const { documents, store } = app.ctx;
    const active = documents.active();
    expect(documents.list()).toHaveLength(1);
    expect(active).toMatchObject({
      name: 'untitled1.x68',
      kind: 'source',
      path: null,
      modified: false,
      insertMode: true,
    });
    expect(documents.text(active?.id ?? '')).toBe(DEFAULT_TEMPLATE);
    expect(store.getState().documents).toEqual({ items: [active], activeId: active?.id });
    expect(await documents.open('/browser/x.X68')).toBeNull();
    expect(await documents.save(active?.id ?? '')).toBe(false);
  });

  it('the stub document has the members added at gate I1: update and selection', () => {
    const app = createTestApplication();
    const { documents, store } = app.ctx;
    const id = documents.active()?.id ?? '';
    expect(documents.update).toBeTypeOf('function');
    documents.update?.(id, { insertMode: false, fontSize: 14 });
    expect(documents.active()).toMatchObject({ insertMode: false, fontSize: 14, modified: false, revision: 0 });
    expect(store.getState().documents.items[0]).toMatchObject({ insertMode: false, fontSize: 14 });
    documents.update?.('unknown', { fontSize: 20 });
    expect(documents.active()?.fontSize).toBe(14);
    expect(documents.selection?.(id)).toEqual({ selected: '', caret: 0 });
    expect(documents.selection?.('unknown')).toBeNull();
  });

  it('file dialogs that answer Cancel', async () => {
    const dialogs = createStubFileDialogs();
    expect(await dialogs.open({ title: 'Open', filters: [], multiple: false })).toBeNull();
    expect(await dialogs.save({ title: 'Save', filters: [], defaultExt: '.X68' })).toBeNull();
    expect(await dialogs.chooseFolder?.({ title: 'Choose a folder' })).toBeNull();
    dialogs.registerProvider({ id: 'x', label: 'X', available: () => true })();
  });

  it('a silent audio backend', () => {
    const audio = createSilentAudioBackend();
    const sound = audio.load(new Uint8Array(4));
    expect(typeof audio.play(sound, false)).toBe('number');
    audio.stop(1);
    audio.release(sound);
    audio.resume();
  });

  it('the memory file backend at /browser', async () => {
    const { vfs } = createTestApplication().ctx;
    expect(vfs.backends().map((backend) => backend.mount)).toEqual(['browser']);
    await vfs.writeFile('/browser/demo/prog.X68', new Uint8Array([1, 2, 3]));
    expect([...(await vfs.readFile('/browser/demo/prog.X68'))]).toEqual([1, 2, 3]);
  });

  it('the scripted assembler', async () => {
    const app = createTestApplication();
    const result = await app.ctx.asm.assemble(
      'demo/prog.X68',
      new Map([['demo/prog.X68', new Uint8Array(0)]]),
      {
        generateListing: true,
        generateSRecord: true,
        constantsExpanded: false,
        bitFieldInstructions: true,
        crossReference: true,
        macrosExpanded: false,
        structuredExpanded: false,
        showWarnings: true,
        tabType: 1,
        tabSize: 4,
      },
      new Date(2026, 10, 20),
    );
    expect(result.listingName).toBe('demo/prog.L68');
    expect(app.asm.calls).toHaveLength(1);
  });

  it('an inert simulator session: every part exists, nothing runs', () => {
    const { sim } = createTestApplication().ctx;
    expect(sim.controller.phase).toBe('idle');
    expect(sim.controller.program).toBeNull();
    expect(sim.controller.snapshot.boxes).toHaveLength(20);
    expect(sim.controller.snapshot.boxes[Box.SS]).toBe('01000000');
    expect(sim.controller.snapshot.boxes[Box.SR]).toBe('0010000000000000');
    sim.controller.run();
    sim.controller.post({ kind: 'irq', level: 7 });
    expect(sim.controller.phase).toBe('idle');
    expect(sim.engine.listingLineCount).toBe(0);
    expect(sim.engine.state().halt).toBe(false);
    expect(sim.listing.rows).toEqual([]);
    expect(sim.surface.back.width).toBe(640);
    // Host methods exist and do nothing.
    expect(() => sim.host.message(new Uint8Array(0))).not.toThrow();
    expect(sim.onEngineReplaced(() => {})).toBeTypeOf('function');
  });

  it('the inert engine reads like a simulator that has just started', () => {
    const engine = createInertEngine();
    expect(engine.boxText(Box.A7)).toBe('01000000');
    expect(engine.boxText(Box.US)).toBe('00FF0000');
    expect(engine.boxText(Box.D0)).toBe('00000000');
    expect(engine.cycles).toBe(0n);
    expect(engine.memory).toHaveLength(0x1000000);
    expect(engine.memory[0]).toBe(0xff);
    expect(engine.memory).toBe(engine.memory);
    expect(engine.hardware().auto).toHaveLength(8);
    expect(engine.breakpoints()).toEqual([]);
  });

  it('the inert controller counts holds', () => {
    const controller = createInertController();
    const changes = vi.fn();
    controller.subscribe(changes);
    const a = controller.hold();
    const b = controller.hold();
    expect(controller.held).toBe(true);
    a();
    a(); // releasing twice counts once
    expect(controller.held).toBe(true);
    b();
    expect(controller.held).toBe(false);
    expect(changes).toHaveBeenCalledTimes(4);
  });
});

describe('editor extensions (3.12.3)', () => {
  const extension: Extension = [];
  const source = (_doc: DocumentState) => extension;

  it('keeps the sources in registration order and removes them again', () => {
    const registry = createEditorExtensionRegistry();
    const other = () => extension;
    const changes = vi.fn();
    registry.subscribe(changes);
    const remove = registry.register(source);
    registry.register(other);
    expect(registry.sources()).toEqual([source, other]);
    remove();
    remove();
    expect(registry.sources()).toEqual([other]);
    expect(changes).toHaveBeenCalledTimes(3);
  });

  it('is what the context carries; the editor reads it through the two functions', () => {
    const { ctx } = createTestApplication();
    const changes = vi.fn();
    const stop = subscribeEditorExtensions(ctx, changes);
    const remove = ctx.editorExtensions.register(source);
    expect(editorExtensionSources(ctx)).toEqual([source]);
    remove();
    stop();
    expect(editorExtensionSources(ctx)).toEqual([]);
    expect(changes).toHaveBeenCalledTimes(2);
  });
});
