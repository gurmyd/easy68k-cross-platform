// Mouse events of the Output panel (ARCHITECTURE.md 3.6; trap15-b §8.1, §8.4).

import { describe, expect, it } from 'vitest';
import { ShiftBit, type InputEvent68k } from '../../../contracts';
import { OutputMouse, mouseShift, surfacePoint, type MouseLike } from './mouse';

const mouse = (init: Partial<MouseLike> = {}): MouseLike => ({
  clientX: 0,
  clientY: 0,
  buttons: 0,
  detail: 0,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  ...init,
});

const SURFACE = { width: 640, height: 480 };
/** The canvas at (100, 50) on screen, shown at 200 %. */
const BOX = { left: 100, top: 50, width: 1280, height: 960 };

describe('mouseShift: the shift state after the event (trap15-b §8.1)', () => {
  it('button bits are the buttons down after the event', () => {
    expect(mouseShift(mouse({ buttons: 1, detail: 1 }), 'down')).toBe(ShiftBit.Left);
    expect(mouseShift(mouse({ buttons: 2, detail: 1 }), 'down')).toBe(ShiftBit.Right);
    expect(mouseShift(mouse({ buttons: 4, detail: 1 }), 'down')).toBe(ShiftBit.Middle);
    expect(mouseShift(mouse({ buttons: 3, detail: 1 }), 'down')).toBe(ShiftBit.Left | ShiftBit.Right);
  });

  it('rule 2: releasing the only pressed button leaves no button bit', () => {
    expect(mouseShift(mouse({ buttons: 0, detail: 1 }), 'up')).toBe(0);
    // Releasing one of two leaves the other: the snapshot records which buttons are STILL held.
    expect(mouseShift(mouse({ buttons: 2, detail: 1 }), 'up')).toBe(ShiftBit.Right);
  });

  it('rule 3: Double only on the second press of a double-click, never on a release or a move', () => {
    expect(mouseShift(mouse({ buttons: 1, detail: 1 }), 'down') & ShiftBit.Double).toBe(0);
    expect(mouseShift(mouse({ buttons: 1, detail: 2 }), 'down')).toBe(ShiftBit.Left | ShiftBit.Double);
    expect(mouseShift(mouse({ buttons: 1, detail: 3 }), 'down') & ShiftBit.Double).toBe(0);
    expect(mouseShift(mouse({ buttons: 1, detail: 4 }), 'down') & ShiftBit.Double).toBe(ShiftBit.Double);
    expect(mouseShift(mouse({ buttons: 0, detail: 2 }), 'up')).toBe(0);
    expect(mouseShift(mouse({ buttons: 1, detail: 2 }), 'move')).toBe(ShiftBit.Left);
  });

  it('Shift, Alt and Ctrl as held during the event, on every kind of event', () => {
    const held = mouse({ shiftKey: true, altKey: true, ctrlKey: true });
    const all = ShiftBit.Shift | ShiftBit.Alt | ShiftBit.Ctrl;
    expect(mouseShift(held, 'down')).toBe(all);
    expect(mouseShift(held, 'up')).toBe(all);
    expect(mouseShift(held, 'move')).toBe(all);
    expect(mouseShift(mouse({ shiftKey: true }), 'move')).toBe(ShiftBit.Shift);
  });

  it('Ctrl+click on macOS arrives as a right-button event and is reported as one', () => {
    expect(mouseShift(mouse({ buttons: 2, detail: 1, ctrlKey: true }), 'down')).toBe(ShiftBit.Right | ShiftBit.Ctrl);
  });
});

describe('surfacePoint (trap15-b §8.4)', () => {
  it('maps client pixels to surface pixels whatever the zoom', () => {
    expect(surfacePoint(100, 50, BOX, SURFACE)).toEqual({ x: 0, y: 0 });
    expect(surfacePoint(101.9, 51.9, BOX, SURFACE)).toEqual({ x: 0, y: 0 });
    expect(surfacePoint(102, 52, BOX, SURFACE)).toEqual({ x: 1, y: 1 });
    expect(surfacePoint(100 + 1279, 50 + 959, BOX, SURFACE)).toEqual({ x: 639, y: 479 });
    expect(surfacePoint(110, 60, { left: 100, top: 50, width: 640, height: 480 }, SURFACE)).toEqual({ x: 10, y: 10 });
  });

  it('does not clamp', () => {
    expect(surfacePoint(90, 40, BOX, SURFACE)).toEqual({ x: -5, y: -5 });
    expect(surfacePoint(100 + 1300, 50 + 1000, BOX, SURFACE)).toEqual({ x: 650, y: 500 });
  });

  it('a canvas without a size counts as unscaled', () => {
    expect(surfacePoint(7, 9, { left: 0, top: 0, width: 0, height: 0 }, SURFACE)).toEqual({ x: 7, y: 9 });
  });
});

describe('OutputMouse', () => {
  function setup() {
    const posted: InputEvent68k[] = [];
    const output = new OutputMouse({ post: (event) => posted.push(event) });
    return { output, posted, take: () => posted.splice(0) };
  }
  const at = (x: number, y: number, init: Partial<MouseLike> = {}) =>
    mouse({ clientX: BOX.left + 2 * x, clientY: BOX.top + 2 * y, ...init });

  it('posts down, move and up with surface positions and the shift state after the event', () => {
    const { output, take } = setup();
    output.move(at(10, 20), BOX, SURFACE);
    output.down(at(10, 20, { buttons: 1, detail: 1 }), BOX, SURFACE);
    output.move(at(30, 40, { buttons: 1, shiftKey: true }), BOX, SURFACE);
    output.up(at(30, 40, { buttons: 0, detail: 1 }), BOX, SURFACE);
    expect(take()).toEqual([
      { kind: 'mouseMove', x: 10, y: 20, shift: 0 },
      { kind: 'mouseDown', x: 10, y: 20, shift: ShiftBit.Left },
      { kind: 'mouseMove', x: 30, y: 40, shift: ShiftBit.Left | ShiftBit.Shift },
      { kind: 'mouseUp', x: 30, y: 40, shift: 0 },
    ]);
  });

  it('the left button captures: positions outside the surface are reported as they are', () => {
    const { output, take } = setup();
    output.down(at(5, 5, { buttons: 1, detail: 1 }), BOX, SURFACE);
    expect(output.leftHeld).toBe(true);
    output.move(at(-20, 700, { buttons: 1 }), BOX, SURFACE);
    output.up(at(900, -3, { buttons: 0, detail: 1 }), BOX, SURFACE);
    expect(output.leftHeld).toBe(false);
    expect(take().slice(1)).toEqual([
      { kind: 'mouseMove', x: -20, y: 700, shift: ShiftBit.Left },
      { kind: 'mouseUp', x: 900, y: -3, shift: 0 },
    ]);
  });

  it('the right and middle buttons do not capture', () => {
    const { output, take } = setup();
    output.down(at(5, 5, { buttons: 2, detail: 1 }), BOX, SURFACE);
    expect(output.leftHeld).toBe(false);
    // An event at the very edge of the canvas can round to one pixel outside: it is kept inside.
    output.move(mouse({ clientX: BOX.left + BOX.width, clientY: BOX.top + BOX.height, buttons: 2 }), BOX, SURFACE);
    expect(take()[1]).toEqual({ kind: 'mouseMove', x: 639, y: 479, shift: ShiftBit.Right });
  });

  it('releasing another button during a left drag keeps the capture', () => {
    const { output, take } = setup();
    output.down(at(5, 5, { buttons: 1, detail: 1 }), BOX, SURFACE);
    output.down(at(5, 5, { buttons: 3, detail: 1 }), BOX, SURFACE);
    output.up(at(5, 5, { buttons: 1, detail: 1 }), BOX, SURFACE);
    expect(output.leftHeld).toBe(true);
    output.move(at(-1, -1, { buttons: 1 }), BOX, SURFACE);
    expect(take().pop()).toEqual({ kind: 'mouseMove', x: -1, y: -1, shift: ShiftBit.Left });
  });

  it('a cancelled captured pointer releases the left button at the last position, once', () => {
    const { output, take } = setup();
    output.cancel(); // nothing held: nothing to release
    expect(take()).toEqual([]);
    output.down(at(5, 5, { buttons: 1, detail: 1 }), BOX, SURFACE);
    output.move(at(700, 9, { buttons: 1, ctrlKey: true }), BOX, SURFACE);
    take();
    output.cancel();
    output.cancel();
    expect(take()).toEqual([{ kind: 'mouseUp', x: 700, y: 9, shift: 0 }]);
    expect(output.leftHeld).toBe(false);
  });

  it('a release the browser could not report is made up for at the next move', () => {
    const { output, take } = setup();
    output.down(at(5, 5, { buttons: 1, detail: 1 }), BOX, SURFACE);
    take();
    // The pointer comes back over the surface with no button held: the release was missed.
    output.move(at(8, 9, { buttons: 0 }), BOX, SURFACE);
    expect(take()).toEqual([
      { kind: 'mouseUp', x: 8, y: 9, shift: 0 },
      { kind: 'mouseMove', x: 8, y: 9, shift: 0 },
    ]);
    expect(output.leftHeld).toBe(false);
    output.move(at(9, 9, { buttons: 0 }), BOX, SURFACE);
    expect(take()).toEqual([{ kind: 'mouseMove', x: 9, y: 9, shift: 0 }]);
  });

  it('resetToStartup forgets a held button', () => {
    const { output, take } = setup();
    output.down(at(5, 5, { buttons: 1, detail: 1 }), BOX, SURFACE);
    output.resetToStartup();
    output.cancel();
    expect(take().length).toBe(1);
  });
});
