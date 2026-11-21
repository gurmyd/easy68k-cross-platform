// Mouse of the Output panel (ARCHITECTURE.md 3.6; trap15-b §8): translates browser mouse events
// into what the original's I/O window receives and posts them to the run controller.
//
// The engine keeps the mouse state that TRAP #15 task 61 reads and raises the interrupts of task
// 60. It wants, for each event, the position in surface pixels and the VCL's shift state AFTER the
// event (trap15-b §8.1):
//
//  - the buttons that are down after the event (`MouseEvent.buttons`). On releasing the only
//    pressed button none is left, so the "up" snapshot of task 61 normally shows no button;
//  - Shift, Alt and Ctrl as held during the event;
//  - Double on a button-down that is the second press of a double-click (`detail` even), never on
//    a release or a move.
//
// Positions follow trap15-b §8.4, so that zoom and device pixel ratio do not leak in. The left
// button captures the mouse, as the original's window does: while it is held, positions outside
// the surface are reported as they are (negative, or beyond the size). The right and middle
// buttons do not capture.
//
// Owner: SH4.

import { ShiftBit, type InputEvent68k } from '../../../contracts';

/** The parts of a MouseEvent this module reads; a plain object will do in tests. */
export interface MouseLike {
  readonly clientX: number;
  readonly clientY: number;
  /** The buttons down after the event: bit 0 left, bit 1 right, bit 2 middle. */
  readonly buttons: number;
  /** The click count of a button-down. */
  readonly detail: number;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
}

/** Where the surface is on screen: the canvas's bounding rectangle, in CSS pixels. */
export interface ClientBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface SurfaceSize {
  readonly width: number;
  readonly height: number;
}

export type MouseEventKind = 'down' | 'up' | 'move';

/** The surface pixel under a client position (trap15-b §8.4). Not clamped. */
export function surfacePoint(
  clientX: number,
  clientY: number,
  box: ClientBox,
  surface: SurfaceSize,
): { x: number; y: number } {
  // A canvas that is not laid out (a hidden panel) has no size; it receives no events either.
  const shown = {
    width: box.width > 0 ? box.width : surface.width,
    height: box.height > 0 ? box.height : surface.height,
  };
  return {
    x: Math.floor(((clientX - box.left) * surface.width) / shown.width),
    y: Math.floor(((clientY - box.top) * surface.height) / shown.height),
  };
}

/** The shift state after a mouse event, as ShiftBit values (rules 1 to 3 of trap15-b §8.1). */
export function mouseShift(ev: MouseLike, kind: MouseEventKind): number {
  let shift = 0;
  if (ev.buttons & 1) shift |= ShiftBit.Left;
  if (ev.buttons & 2) shift |= ShiftBit.Right;
  if (ev.buttons & 4) shift |= ShiftBit.Middle;
  if (ev.shiftKey) shift |= ShiftBit.Shift;
  if (ev.altKey) shift |= ShiftBit.Alt;
  if (ev.ctrlKey) shift |= ShiftBit.Ctrl;
  if (kind === 'down' && ev.detail > 0 && ev.detail % 2 === 0) shift |= ShiftBit.Double;
  return shift;
}

export interface MouseDeps {
  post: (event: InputEvent68k) => void; // run-controller queue (4.3)
}

export class OutputMouse {
  /** True while the left button is held: the mouse is captured and positions are not clamped. */
  private captured = false;
  private last = { x: 0, y: 0 };

  constructor(private readonly deps: MouseDeps) {}

  /** True while the left button that was pressed on the surface is still held. */
  get leftHeld(): boolean {
    return this.captured;
  }

  down(ev: MouseLike, box: ClientBox, surface: SurfaceSize): void {
    this.event('down', ev, box, surface);
  }

  up(ev: MouseLike, box: ClientBox, surface: SurfaceSize): void {
    this.event('up', ev, box, surface);
  }

  move(ev: MouseLike, box: ClientBox, surface: SurfaceSize): void {
    this.event('move', ev, box, surface);
  }

  /** The browser cancelled the captured pointer: the left button is released for the program, at
   *  the last position, with no button and no modifier held. */
  cancel(): void {
    if (!this.captured) return;
    this.captured = false;
    this.deps.post({ kind: 'mouseUp', x: this.last.x, y: this.last.y, shift: 0 });
  }

  resetToStartup(): void {
    this.captured = false;
    this.last = { x: 0, y: 0 };
  }

  private event(kind: MouseEventKind, ev: MouseLike, box: ClientBox, surface: SurfaceSize): void {
    const leftDown = (ev.buttons & 1) !== 0;
    if (kind === 'move' && this.captured && !leftDown) {
      // The button went up where the browser could not report it (outside its window, with the
      // capture lost). The program gets the release now, before the move that reveals it.
      this.event('up', ev, box, surface);
    }
    // A release of the left button is still part of the drag: it is reported where it happens.
    const free = this.captured || (kind === 'down' && leftDown);
    if (kind !== 'move') this.captured = leftDown;

    let { x, y } = surfacePoint(ev.clientX, ev.clientY, box, surface);
    if (!free) {
      // Without capture the events come from the canvas itself; only rounding at its right and
      // bottom edge can land one pixel outside.
      x = Math.min(Math.max(x, 0), surface.width - 1);
      y = Math.min(Math.max(y, 0), surface.height - 1);
    }
    this.last = { x, y };
    const name = kind === 'down' ? 'mouseDown' : kind === 'up' ? 'mouseUp' : 'mouseMove';
    this.deps.post({ kind: name, x, y, shift: mouseShift(ev, kind) });
  }
}
