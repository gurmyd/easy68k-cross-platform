// The browser's services behind the interfaces of the contracts: time, frames, and the storage of
// the settings document. Owner: W3.
//
// Code under core/ may not touch `window`, timers or `localStorage` (ARCHITECTURE.md section 0
// rule 5); it receives a Clock, a Scheduler and a SettingsStorage instead. These are the real
// ones, used by the web app and by the desktop app alike (both are browser pages). Tests pass
// fakes to bootstrap() instead.

import type { Clock, Scheduler } from '../contracts';
import { SETTINGS_KEY, type SettingsStorage } from '../core/settings/service';

/** Monotonic milliseconds from performance.now(); wall time from the system clock. */
export function createRealClock(): Clock {
  return { now: () => performance.now(), wallTime: () => new Date() };
}

/** What a frame scheduler needs from its surroundings; the defaults are the browser's. */
export interface FrameSource {
  requestFrame(callback: (now: number) => void): number;
  cancelFrame(handle: number): void;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
  now(): number;
}

const browserFrames = (): FrameSource => ({
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (handle) => window.clearTimeout(handle),
  now: () => performance.now(),
});

/** No frame for this long means the page is hidden or covered: a timer takes over (3.11.1). */
export const FRAME_WATCHDOG_MS = 250;

/**
 * A Scheduler on requestAnimationFrame. onFrame callbacks run once per display frame; if no frame
 * has arrived for 250 ms (hidden tab, minimised or covered window) they run from a timer instead,
 * whatever the page's visibility state says, so that a running program keeps running (4.5.5).
 */
export function createFrameScheduler(source: FrameSource = browserFrames()): Scheduler {
  const callbacks = new Set<(now: number) => void>();
  let frame: number | null = null;
  let watchdog: number | null = null;

  const run = (now: number) => {
    for (const callback of [...callbacks]) callback(now);
  };
  const stop = () => {
    if (frame !== null) source.cancelFrame(frame);
    if (watchdog !== null) source.clearTimeout(watchdog);
    frame = null;
    watchdog = null;
  };
  const armWatchdog = () => {
    if (watchdog !== null) source.clearTimeout(watchdog);
    watchdog = source.setTimeout(() => {
      watchdog = null;
      if (callbacks.size === 0) return;
      // The frame request stays pending; it fires again when the page is shown.
      run(source.now());
      if (callbacks.size > 0) armWatchdog();
    }, FRAME_WATCHDOG_MS);
  };
  const armFrame = () => {
    frame = source.requestFrame((now) => {
      frame = null;
      if (callbacks.size === 0) return stop();
      run(now);
      if (callbacks.size === 0) return stop();
      armFrame();
      armWatchdog();
    });
  };

  return {
    onFrame(fn) {
      callbacks.add(fn);
      if (frame === null) armFrame();
      if (watchdog === null) armWatchdog();
      return () => {
        callbacks.delete(fn);
        if (callbacks.size === 0) stop();
      };
    },
    setTimer(delayMs, fn) {
      const handle = source.setTimeout(fn, Math.max(0, delayMs));
      return () => source.clearTimeout(handle);
    },
  };
}

/**
 * The settings document in localStorage under `easy68k.settings.v1` (3.10). Other windows of the
 * same origin are heard through the `storage` event, which a browser sends to every window except
 * the one that wrote. The listener receives the event's `newValue`: it is what the other window
 * wrote, while `getItem` in this window may still return an older text for a while (WebKit and
 * Chromium both keep a copy per page and update it later; errata W3 entry 26).
 */
export function browserSettingsStorage(win: Window = window): SettingsStorage {
  return {
    read: () => win.localStorage.getItem(SETTINGS_KEY),
    write: (text) => win.localStorage.setItem(SETTINGS_KEY, text),
    // Every window of the origin runs on this computer's clock, so stamps compare across windows.
    now: () => Date.now(),
    // A write-back waits 10 to 50 ms, a different pause in each window, so that of several windows
    // that would put the same setting back one writes and the others see that it is done. A page
    // that is being closed runs the task at once.
    defer(task) {
      let done = false;
      const run = () => {
        if (done) return;
        cancel();
        task();
      };
      const timer = win.setTimeout(run, 10 + Math.random() * 40);
      win.addEventListener('pagehide', run);
      const cancel = () => {
        done = true;
        win.clearTimeout(timer);
        win.removeEventListener('pagehide', run);
      };
      return cancel;
    },
    onExternalChange(listener) {
      const onStorage = (event: StorageEvent) => {
        // key null = the whole storage was cleared.
        if (event.key === null) listener(null);
        else if (event.key === SETTINGS_KEY) listener(event.newValue);
      };
      win.addEventListener('storage', onStorage);
      return () => win.removeEventListener('storage', onStorage);
    },
  };
}
