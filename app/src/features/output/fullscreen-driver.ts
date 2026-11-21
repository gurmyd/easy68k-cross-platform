// The two ways the Output panel becomes full screen (ARCHITECTURE.md 2.5):
//
//   browser      the Fullscreen API. The request is made for the page's root element, and the
//                panel then covers the window (output.css), exactly as in the desktop app. Asking
//                for the panel's own element would hide everything else from the screen, also the
//                dialogs a program can open (the file dialog of TRAP #15 task 58, a message box),
//                which are drawn outside the panel (docs/porting/errata/SH4.md).
//   desktop app  the window itself goes full screen (Platform.setFullScreen).
//
// Esc in a browser: Chromium lets a page lock the key (`navigator.keyboard.lock`), so a short Esc
// reaches the program as in the original and holding Esc leaves full screen. Safari and Firefox
// leave full screen on Esc and keep the key.

import type { FullScreenDriver } from './fullscreen';

/** The Keyboard Lock API (Chromium); not part of TypeScript's DOM types. */
interface KeyboardLock {
  lock?: (keys: string[]) => Promise<void>;
  unlock?: () => void;
}

export interface WebFullScreenDriver extends FullScreenDriver {
  /** Stops listening to the document. */
  dispose(): void;
}

/**
 * The browser's driver. `onChange` is told whenever the document enters or leaves full screen,
 * whoever caused it, with whether the page's root is now full screen.
 */
export function createWebFullScreenDriver(doc: Document, onChange: (active: boolean) => void): WebFullScreenDriver {
  const root = doc.documentElement;
  const keyboard = (): KeyboardLock | undefined =>
    (doc.defaultView?.navigator as (Navigator & { keyboard?: KeyboardLock }) | undefined)?.keyboard;
  const isActive = () => doc.fullscreenElement === root;
  const changed = () => {
    if (!isActive()) keyboard()?.unlock?.();
    onChange(isActive());
  };
  doc.addEventListener('fullscreenchange', changed);

  return {
    available: () => doc.fullscreenEnabled === true && typeof root.requestFullscreen === 'function',
    gestureActive: () => doc.defaultView?.navigator.userActivation?.isActive,
    async enter() {
      try {
        await root.requestFullscreen({ navigationUI: 'hide' });
      } catch {
        return false; // no user gesture, no permission, or the user's settings forbid it
      }
      // Not awaited and allowed to fail: without the lock Esc simply leaves full screen.
      keyboard()
        ?.lock?.(['Escape'])
        .catch(() => {});
      return true;
    },
    async leave() {
      keyboard()?.unlock?.();
      if (!doc.fullscreenElement) return;
      try {
        await doc.exitFullscreen();
      } catch {
        // Already left.
      }
    },
    dispose() {
      doc.removeEventListener('fullscreenchange', changed);
    },
  };
}

/** The desktop app's driver: the window goes full screen; no user gesture is needed. */
export function createDesktopFullScreenDriver(setFullScreen: (on: boolean) => Promise<boolean>): FullScreenDriver {
  return {
    available: () => true,
    gestureActive: () => true,
    enter: () => setFullScreen(true).catch(() => false),
    async leave() {
      await setFullScreen(false).catch(() => false);
    },
  };
}
