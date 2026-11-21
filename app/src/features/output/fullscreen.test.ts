// The full-screen controller (ARCHITECTURE.md 2.5): entering by the user and by the program,
// the deferred, the refused and the externally ended case.

import { describe, expect, it } from 'vitest';
import { FULL_SCREEN_PROMPT, FULL_SCREEN_REFUSED, FullScreenController, type FullScreenDriver } from './fullscreen';

/** A driver whose answers the test chooses. */
class FakeDriver implements FullScreenDriver {
  isAvailable = true;
  gesture: boolean | undefined = false;
  /** What enter() resolves to; 'reject' makes it reject; 'pending' leaves it open. */
  answer: boolean | 'reject' | 'pending' = true;
  active = false;
  enters = 0;
  leaves = 0;
  private resolvePending: ((entered: boolean) => void) | null = null;

  available() {
    return this.isAvailable;
  }
  gestureActive() {
    return this.gesture;
  }
  enter(): Promise<boolean> {
    this.enters++;
    if (this.answer === 'reject') return Promise.reject(new TypeError('Permissions check failed'));
    if (this.answer === 'pending') return new Promise((resolve) => (this.resolvePending = resolve));
    this.active = this.answer;
    return Promise.resolve(this.answer);
  }
  async leave(): Promise<void> {
    this.leaves++;
    this.active = false;
  }
  /** Settles an enter() that was left open. */
  settle(entered: boolean) {
    this.active = entered;
    this.resolvePending?.(entered);
  }
}

function setup(driver: FakeDriver | null = new FakeDriver()) {
  const log: string[] = [];
  const controller = new FullScreenController({
    driver: () => driver,
    tellEngine: (on) => log.push(`engine ${on}`),
    publish: (on) => log.push(`store ${on}`),
    refused: () => log.push('refused box'),
    entered: () => log.push('entered'),
  });
  const take = () => log.splice(0);
  /** Lets the promises of the driver settle. */
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return { controller, driver: driver as FakeDriver, take, settle };
}

describe('the user toggles (Alt+Enter, the button)', () => {
  it('enters at once, tells the engine, and gives the panel the keyboard', async () => {
    const { controller, driver, take, settle } = setup();
    controller.toggle();
    expect(controller.phase).toBe('entering');
    expect(controller.wanted).toBe(true);
    await settle();
    expect(controller.phase).toBe('full');
    expect(driver.enters).toBe(1);
    expect(take()).toEqual(['engine true', 'store true', 'entered']);
  });

  it('toggles back: the engine is told, the driver leaves', async () => {
    const { controller, driver, take, settle } = setup();
    controller.toggle();
    await settle();
    take();
    controller.toggle();
    expect(controller.phase).toBe('windowed');
    expect(driver.leaves).toBe(1);
    expect(take()).toEqual(['store false', 'engine false']);
  });

  it('refused although a gesture was present: the failure box, and the flag is cleared', async () => {
    for (const answer of [false, 'reject'] as const) {
      const { controller, driver, take, settle } = setup();
      driver.answer = answer;
      controller.toggle();
      await settle();
      expect(controller.phase).toBe('windowed');
      expect(take()).toEqual(['engine true', 'store true', 'store false', 'engine false', 'refused box']);
    }
  });

  it('where full screen cannot be had at all, the box comes at once', () => {
    const { controller, driver, take } = setup();
    driver.isAvailable = false;
    controller.toggle();
    expect(controller.phase).toBe('windowed');
    expect(driver.enters).toBe(0);
    expect(take()).toEqual(['store false', 'refused box']);
  });
});

describe('the program asks (TRAP #15 task 33; the engine has set its flag)', () => {
  it('without a gesture the request waits; the next key or click carries it out', async () => {
    const { controller, driver, take, settle } = setup();
    controller.set(true, 'program');
    expect(controller.phase).toBe('waiting');
    expect(controller.wanted).toBe(true);
    expect(driver.enters).toBe(0);
    expect(take()).toEqual(['store true']); // the engine is not told what it said itself

    driver.gesture = true; // inside the key-down handler
    expect(controller.gesture()).toBe(true);
    await settle();
    expect(controller.phase).toBe('full');
    expect(take()).toEqual(['entered']);
    expect(controller.gesture()).toBe(false); // nothing is waiting any more
  });

  it('an event without user activation (Esc) leaves the request waiting', () => {
    const { controller, driver } = setup();
    controller.set(true, 'program');
    driver.gesture = false;
    expect(controller.gesture()).toBe(false);
    expect(controller.phase).toBe('waiting');
    // A browser that does not say whether a gesture is active: the event handler is trusted.
    driver.gesture = undefined;
    expect(controller.gesture()).toBe(true);
    expect(controller.phase).toBe('entering');
  });

  it('with a gesture still active (Run was just pressed) it enters at once', async () => {
    const { controller, driver, settle } = setup();
    driver.gesture = true;
    controller.set(true, 'program');
    expect(controller.phase).toBe('entering');
    await settle();
    expect(controller.phase).toBe('full');
  });

  it('the waiting request is dropped if the program asks for windowed mode or stops first', () => {
    const { controller, driver, take } = setup();
    controller.set(true, 'program');
    take();
    controller.set(false, 'program'); // task 33 with D1.L = 1, or the engine's setupWindow(false) at a stop
    expect(controller.phase).toBe('windowed');
    expect(take()).toEqual(['store false']);
    driver.gesture = true;
    expect(controller.gesture()).toBe(false);
    expect(driver.enters).toBe(0);
    expect(driver.leaves).toBe(0);
  });

  it('refused in the gesture: the box, and the engine flag is cleared', async () => {
    const { controller, driver, take, settle } = setup();
    controller.set(true, 'program');
    take();
    driver.gesture = true;
    driver.answer = 'reject';
    controller.gesture();
    await settle();
    expect(controller.phase).toBe('windowed');
    expect(take()).toEqual(['store false', 'engine false', 'refused box']);
  });

  it('embedded without permission: the box at once, and the engine flag is cleared', () => {
    const { controller, driver, take } = setup();
    driver.isAvailable = false;
    controller.set(true, 'program');
    expect(controller.phase).toBe('windowed');
    expect(take()).toEqual(['engine false', 'store false', 'refused box']);
  });

  it('leaves automatically when the engine says so (a stop in trace mode, a halt)', async () => {
    const { controller, driver, take, settle } = setup();
    controller.toggle();
    await settle();
    take();
    controller.set(false, 'program');
    expect(controller.phase).toBe('windowed');
    expect(driver.leaves).toBe(1);
    expect(take()).toEqual(['store false']);
  });

  it('while the panel is not on screen the request waits for it', () => {
    const { controller, take } = setup(null);
    controller.set(true, 'program');
    expect(controller.phase).toBe('waiting');
    expect(controller.gesture()).toBe(false);
    expect(take()).toEqual(['store true']);
  });
});

describe('a command (the /f switch; no key behind it)', () => {
  it('tells the engine and waits for a gesture when none is active', () => {
    const { controller, take } = setup();
    controller.set(true, 'command');
    expect(controller.phase).toBe('waiting');
    expect(take()).toEqual(['engine true', 'store true']);
  });

  it('does nothing when the state is already the one asked for', () => {
    const { controller, take } = setup();
    controller.set(false, 'command');
    expect(take()).toEqual([]);
  });
});

describe('full screen ends without the port asking (browser Esc, the system, a tab switch)', () => {
  it('sets the engine flag back', async () => {
    const { controller, driver, take, settle } = setup();
    controller.toggle();
    await settle();
    take();
    driver.active = false;
    controller.driverChanged(false);
    expect(controller.phase).toBe('windowed');
    expect(take()).toEqual(['store false', 'engine false']);
    expect(driver.leaves).toBe(0);
  });

  it('a change event that only confirms what the port did is ignored', async () => {
    const { controller, take, settle } = setup();
    controller.toggle();
    controller.driverChanged(true); // fullscreenchange arrives before the promise resolves
    await settle();
    controller.driverChanged(true);
    take();
    controller.toggle();
    controller.driverChanged(false); // the port's own leave
    expect(take()).toEqual(['store false', 'engine false']);
  });
});

describe('answers that arrive late', () => {
  it('windowed mode asked for while the request is open: the screen is left again', async () => {
    const { controller, driver, take, settle } = setup();
    driver.answer = 'pending';
    controller.toggle();
    controller.toggle();
    expect(controller.phase).toBe('windowed');
    driver.settle(true);
    await settle();
    expect(controller.phase).toBe('windowed');
    expect(driver.leaves).toBe(2); // once when it was asked, once when the late answer came
    expect(take()).toEqual(['engine true', 'store true', 'store false', 'engine false']);
  });

  it('a refusal that arrives after windowed mode was asked for shows no box', async () => {
    const { controller, driver, take, settle } = setup();
    driver.answer = 'pending';
    controller.toggle();
    controller.toggle();
    take();
    driver.settle(false);
    await settle();
    expect(take()).toEqual([]);
  });
});

describe('texts', () => {
  it('are the ones of 2.5', () => {
    expect(FULL_SCREEN_PROMPT).toBe('Press any key or click to enter full screen');
    expect(FULL_SCREEN_REFUSED.title).toBe('Information');
    expect(FULL_SCREEN_REFUSED.text).toBe(
      "Sorry, this computer's configuration does not support the desired screen resolution in full screen mode.",
    );
  });
});
