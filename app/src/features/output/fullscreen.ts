// Full screen of the Output panel (ARCHITECTURE.md 2.5): who may ask for it, and what happens
// when the browser will not give it. No DOM here; the browser and the desktop app are behind
// FullScreenDriver (fullscreen-driver.ts).
//
// The original's I/O window has one flag, `fullScreen`, set by Alt+Enter, by the `/f` switch and
// by TRAP #15 task 33, and cleared again when the program stops. The engine keeps that flag
// (`SimOption.Fullscreen`); this controller makes the screen follow it:
//
//   windowed --(the user toggles: Alt+Enter, the button)--------------------> entering -> full
//   windowed --(the program asks: task 33, D1.L = 2; no user gesture)--> waiting
//   waiting  --(the next key or click in the panel)--------------------------> entering -> full
//   any      --(Alt+Enter, View > Output Window, task 33 D1.L = 1, a stop)--> windowed
//   full     --(the browser ends it: Esc, a tab switch; in the desktop app
//               the system does: the window's green button)-----------------> windowed
//
// - A browser gives full screen only inside a user gesture. A request that has none is kept as
//   `waiting`: the panel shows `Press any key or click to enter full screen` and the next key or
//   click, which the program receives as well, carries it out. The request is dropped if the
//   program asks for windowed mode, or stops, first.
// - A request the browser refuses although a gesture was present ends like the original's failed
//   change of display mode: the box `Sorry, this computer's configuration does not support the
//   desired screen resolution in full screen mode.`, and the flag is cleared.
// - Whenever the flag changes on this side (the user toggles, the browser ends or refuses full
//   screen) the engine is told, so that the engine and the panel never disagree.

import type { MessageBoxRequest, Store } from '../../contracts';
import { createStore } from '../../state/store';

export type FullScreenPhase = 'windowed' | 'waiting' | 'entering' | 'full';

/** Who asks: the user inside a key or click handler; a command (a gesture may or may not be
 *  present); the program, through the engine, which already has its flag set. */
export type FullScreenOrigin = 'gesture' | 'command' | 'program';

/**
 * The original's failure box (trap15-b §4.4), whole: `Application->MessageBoxA(text, "Information")`
 * (simIOu.cpp:290). The call names no flags, which is MB_OK: one OK button and NO icon. "Information"
 * is only the caption; the box does not have the (i) picture of an information box.
 */
export const FULL_SCREEN_REFUSED = {
  title: 'Information',
  text: "Sorry, this computer's configuration does not support the desired screen resolution in full screen mode.",
  icon: 'none',
  buttons: ['OK'],
} as const satisfies MessageBoxRequest;

/** Shown over the surface while a request waits for a user gesture (2.5). */
export const FULL_SCREEN_PROMPT = 'Press any key or click to enter full screen';

/** What makes the screen full: the browser's Fullscreen API, or the window of the desktop app. */
export interface FullScreenDriver {
  /** False where full screen cannot be had at all (a page embedded without permission). */
  available(): boolean;
  /** Whether a request made right now comes with a user gesture: true, false, or undefined where
   *  the browser does not say. The desktop app needs none and answers true. */
  gestureActive(): boolean | undefined;
  /** Resolves false when the request was refused. */
  enter(): Promise<boolean>;
  leave(): Promise<void>;
}

export interface FullScreenDeps {
  /** The driver of the panel on screen; null while the panel is not rendered. */
  driver(): FullScreenDriver | null;
  /** Sets the engine's flag (SimOption.Fullscreen) through the run controller. */
  tellEngine(on: boolean): void;
  /** Records the flag where the rest of the application reads it (AppState.sim.output.fullScreen). */
  publish(on: boolean): void;
  /** Shows the failure box. */
  refused(): void;
  /** The screen has become full: the place to give the panel the keyboard. */
  entered?(): void;
}

export class FullScreenController {
  /** For the panel: re-renders when the phase changes. */
  readonly store: Store<{ phase: FullScreenPhase }> = createStore<{ phase: FullScreenPhase }>({ phase: 'windowed' });
  /** Counts attempts, so that the answer to an old request cannot act on a newer state. */
  private attempt = 0;

  constructor(private readonly deps: FullScreenDeps) {}

  get phase(): FullScreenPhase {
    return this.store.getState().phase;
  }

  /** The flag as this side knows it: full screen is on, or on its way. */
  get wanted(): boolean {
    return this.phase !== 'windowed';
  }

  /** Alt+Enter and the full-screen button: called inside the key or click handler. */
  toggle(): void {
    this.set(!this.wanted, 'gesture');
  }

  /** Turns full screen on or off for `origin`. */
  set(on: boolean, origin: FullScreenOrigin): void {
    if (on === this.wanted) return;
    if (!on) {
      const was = this.phase;
      this.change('windowed');
      if (origin !== 'program') this.deps.tellEngine(false);
      if (was === 'full' || was === 'entering') void this.deps.driver()?.leave();
      return;
    }

    const driver = this.deps.driver();
    if (driver && !driver.available()) {
      // The flag goes up and down again, as in the original when the display mode cannot be set.
      if (origin === 'program') this.deps.tellEngine(false);
      this.deps.publish(false);
      this.deps.refused();
      return;
    }
    if (origin !== 'program') this.deps.tellEngine(true);
    const gesture = origin === 'gesture' ? true : driver?.gestureActive();
    if (driver && gesture === true) {
      this.enter(driver);
    } else {
      this.change('waiting');
    }
  }

  /** A key-down or click in the panel: carries out a waiting request. True if it did. */
  gesture(): boolean {
    if (this.phase !== 'waiting') return false;
    const driver = this.deps.driver();
    // An event that gives no user activation (the Esc key, in some browsers a bare modifier)
    // cannot carry the request; the next one will.
    if (!driver || driver.gestureActive() === false) return false;
    this.enter(driver);
    return true;
  }

  /**
   * The screen is no longer full, or has become full, as the browser's `fullscreenchange` or the
   * desktop app's `Platform.onFullScreenChange` reports it. Only one case needs an answer: full
   * screen ended although this side still wanted it.
   */
  driverChanged(active: boolean): void {
    if (active || this.phase !== 'full') return;
    // Ended without the port asking (the browser's Esc, the system, a tab switch).
    this.change('windowed');
    this.deps.tellEngine(false);
  }

  private enter(driver: FullScreenDriver): void {
    const attempt = ++this.attempt;
    this.change('entering');
    const done = (entered: boolean) => {
      if (attempt !== this.attempt || this.phase !== 'entering') {
        // Windowed mode was asked for meanwhile.
        if (entered && !this.wanted) void driver.leave();
        return;
      }
      if (entered) {
        this.change('full');
        this.deps.entered?.();
      } else {
        this.change('windowed');
        this.deps.tellEngine(false);
        this.deps.refused();
      }
    };
    driver.enter().then(done, () => done(false));
  }

  private change(phase: FullScreenPhase): void {
    const before = this.wanted;
    this.store.setState((state) => (state.phase === phase ? state : { phase }));
    if (this.wanted !== before) this.deps.publish(this.wanted);
  }
}
