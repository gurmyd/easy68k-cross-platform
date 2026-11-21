// Feature "audio": the window's audio backend (ARCHITECTURE.md 3.7).
//
// `createAudioBackend` makes the Web Audio backend (webaudio-backend.ts) that the bootstrap puts on
// the context as `ctx.devices.audio`; the simulator session gives it to the sound device (the
// TRAP #15 sound tasks, core/sim-host/audio/), and the simulator's and EASyBIN's beeps use it too.
// The logic of the sound tasks is in core/sim-host/audio/ and does not depend on this backend.
//
// The run commands and the keys of the Output panel call `resume()` (3.7). `init` adds two more
// occasions that cost nothing when the page plays no sound: a press of any key or pointer button in
// the window, and the page becoming visible again, resume an audio context that exists or that a
// playback is waiting for (Safari suspends audio in a background tab).
//
// Owner: W3 > SH5.

import type { AppContext, AudioBackend, FeatureModule } from '../../contracts';
import { createBrowserAudioOutput, WebAudioBackend } from './webaudio-backend';

/** Gestures that may unlock audio; listened to on the window in the capture phase. */
const GESTURES = ['pointerdown', 'keydown'] as const;

export const feature: FeatureModule = {
  id: 'audio',
  init(ctx: AppContext) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const backend = ctx.devices.audio;
    const wake = () => {
      if (backend instanceof WebAudioBackend) backend.resumeIfWanted();
    };
    const visible = () => {
      if (document.visibilityState === 'visible') wake();
    };
    for (const type of GESTURES) window.addEventListener(type, wake, true);
    document.addEventListener('visibilitychange', visible);
    return () => {
      for (const type of GESTURES) window.removeEventListener(type, wake, true);
      document.removeEventListener('visibilitychange', visible);
    };
  },
};

/**
 * The audio backend of the browser (3.7), placed on the context as `devices.audio`. Called once
 * by the bootstrap. Where the page has no Web Audio (Node, tests) it plays nothing.
 */
export function createAudioBackend(_ctx: AppContext): AudioBackend {
  return new WebAudioBackend(createBrowserAudioOutput(), () => performance.now());
}
