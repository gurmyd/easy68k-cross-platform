// Presentation of the surface on the canvas (ARCHITECTURE.md 3.4, 2.5), with a canvas made of a
// pixel array.

import { describe, expect, it } from 'vitest';
import type { OverlayCell, PixelBuffer, Rect, SurfaceApi } from '../../contracts';
import { Presenter, rgbaView, type PresentTarget } from './present';

const BLACK = 0xff000000;
const RED = 0xff0000ff;
const GREEN = 0xff00ff00;
const WHITE = 0xffffffff;

interface FakeImage {
  pixels: Uint32Array;
  width: number;
  height: number;
}

/** A canvas: a pixel array that `put` copies into, with a record of what was put. */
class FakeCanvas implements PresentTarget<FakeImage> {
  width = 300;
  height = 150;
  pixels = new Uint32Array(300 * 150);
  puts: { dx: number; dy: number; sx: number; sy: number; width: number; height: number }[] = [];
  resizes = 0;

  size() {
    return { width: this.width, height: this.height };
  }
  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint32Array(width * height); // setting the size clears a canvas
    this.resizes++;
  }
  image(pixels: Uint32Array, width: number, height: number): FakeImage {
    return { pixels, width, height };
  }
  put(image: FakeImage, dx: number, dy: number, sx: number, sy: number, width: number, height: number) {
    this.puts.push({ dx, dy, sx, sy, width, height });
    for (let y = sy; y < sy + height; y++) {
      for (let x = sx; x < sx + width; x++) {
        const tx = dx + x;
        const ty = dy + y;
        if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) continue; // a canvas clips
        this.pixels[ty * this.width + tx] = image.pixels[y * image.width + x] as number;
      }
    }
  }
  at(x: number, y: number) {
    return this.pixels[y * this.width + x];
  }
  take() {
    return this.puts.splice(0);
  }
}

/** The parts of a surface the presenter reads. */
class FakeSurface {
  back: PixelBuffer;
  window: PixelBuffer | null = null;
  overlay: OverlayCell | null = null;
  dirty: Rect | null = null;
  taken = 0;

  constructor(width: number, height: number) {
    this.back = FakeSurface.buffer(width, height);
  }
  static buffer(width: number, height: number, colour = BLACK): PixelBuffer {
    return { width, height, data: new Uint32Array(width * height).fill(colour) };
  }
  takeDirty(): Rect | null {
    this.taken++;
    const dirty = this.dirty;
    this.dirty = null;
    return dirty;
  }
  /** Draws a pixel into the back buffer and records the change. */
  plot(x: number, y: number, colour: number) {
    (this.back.data as Uint32Array)[y * this.back.width + x] = colour;
    this.dirty = { left: x, top: y, right: x + 1, bottom: y + 1 };
  }
  get api(): SurfaceApi {
    return this as unknown as SurfaceApi;
  }
}

function setup(width = 640, height = 480) {
  const canvas = new FakeCanvas();
  const surface = new FakeSurface(width, height);
  const presenter = new Presenter(canvas);
  return { canvas, surface, presenter };
}

describe('Presenter', () => {
  it('makes the backing store exactly the surface and paints it whole in the first frame', () => {
    const { canvas, surface, presenter } = setup();
    surface.plot(5, 7, RED);
    presenter.frame(surface.api);
    expect(canvas.size()).toEqual({ width: 640, height: 480 });
    expect(canvas.take()).toEqual([{ dx: 0, dy: 0, sx: 0, sy: 0, width: 640, height: 480 }]);
    expect(canvas.at(5, 7)).toBe(RED);
    expect(canvas.at(0, 0)).toBe(BLACK);
  });

  it('copies only the region that changed, and nothing when nothing changed', () => {
    const { canvas, surface, presenter } = setup();
    presenter.frame(surface.api);
    canvas.take();

    presenter.frame(surface.api);
    expect(canvas.take()).toEqual([]);

    surface.plot(100, 50, GREEN);
    presenter.frame(surface.api);
    expect(canvas.take()).toEqual([{ dx: 0, dy: 0, sx: 100, sy: 50, width: 1, height: 1 }]);
    expect(canvas.at(100, 50)).toBe(GREEN);
    // takeDirty is called exactly once per frame: the record is cleared every time.
    expect(surface.taken).toBe(3);
  });

  it('clips a region that reaches beyond the surface', () => {
    const { canvas, surface, presenter } = setup();
    presenter.frame(surface.api);
    canvas.take();
    surface.dirty = { left: -10, top: 470, right: 20, bottom: 500 };
    presenter.frame(surface.api);
    expect(canvas.take()).toEqual([{ dx: 0, dy: 0, sx: 0, sy: 470, width: 20, height: 10 }]);
    surface.dirty = { left: 700, top: 0, right: 800, bottom: 10 };
    presenter.frame(surface.api);
    expect(canvas.take()).toEqual([]);
  });

  it('follows a resize: new backing size, whole repaint from the new buffer', () => {
    const { canvas, surface, presenter } = setup();
    presenter.frame(surface.api);
    canvas.take();
    surface.back = FakeSurface.buffer(800, 600, WHITE); // 3.4 rule 13: the buffer object is replaced
    presenter.frame(surface.api);
    expect(canvas.size()).toEqual({ width: 800, height: 600 });
    expect(canvas.take()).toEqual([{ dx: 0, dy: 0, sx: 0, sy: 0, width: 800, height: 600 }]);
    expect(canvas.at(799, 599)).toBe(WHITE);
    expect(canvas.resizes).toBe(2); // 300x150 -> 640x480 -> 800x600, and never without need
  });

  it('shows the window buffer while double buffering is on, and the back buffer again after', () => {
    const { canvas, surface, presenter } = setup();
    presenter.frame(surface.api);
    surface.window = FakeSurface.buffer(640, 480, GREEN);
    surface.plot(1, 1, RED); // drawn into the back buffer only
    presenter.frame(surface.api);
    expect(canvas.at(1, 1)).toBe(GREEN);
    surface.window = null;
    presenter.frame(surface.api);
    expect(canvas.at(1, 1)).toBe(RED);
    expect(canvas.resizes).toBe(1);
  });

  it('draws the prompt overlay over the image, on the canvas only', () => {
    const { canvas, surface, presenter } = setup();
    presenter.frame(surface.api);
    canvas.take();
    const cell = new Uint32Array(8 * 16).fill(WHITE);
    surface.overlay = { x: 16, y: 32, width: 8, height: 16, pixels: cell };
    presenter.frame(surface.api);
    expect(canvas.at(16, 32)).toBe(WHITE);
    expect(canvas.at(23, 47)).toBe(WHITE);
    expect(canvas.at(24, 32)).toBe(BLACK);
    expect(surface.back.data[32 * 640 + 16]).toBe(BLACK); // never into the back buffer (3.5.3)

    // The cell blinks by changing its pixels in place.
    cell.fill(BLACK);
    presenter.frame(surface.api);
    expect(canvas.at(16, 32)).toBe(BLACK);
  });

  it('takes an overlay that moved or went away off the canvas again', () => {
    const { canvas, surface, presenter } = setup();
    surface.plot(16, 32, RED);
    presenter.frame(surface.api);
    const cell = new Uint32Array(8 * 16).fill(WHITE);
    surface.overlay = { x: 16, y: 32, width: 8, height: 16, pixels: cell };
    presenter.frame(surface.api);
    expect(canvas.at(16, 32)).toBe(WHITE);

    surface.overlay = { x: 24, y: 32, width: 8, height: 16, pixels: cell }; // the cursor moved on
    presenter.frame(surface.api);
    expect(canvas.at(16, 32)).toBe(RED);
    expect(canvas.at(24, 32)).toBe(WHITE);

    surface.overlay = null;
    presenter.frame(surface.api);
    expect(canvas.at(24, 32)).toBe(BLACK);
    canvas.take();
    presenter.frame(surface.api);
    expect(canvas.take()).toEqual([]);
  });

  it('an overlay partly outside the surface is clipped by the canvas', () => {
    const { canvas, surface, presenter } = setup();
    presenter.frame(surface.api);
    surface.overlay = { x: 636, y: 470, width: 8, height: 16, pixels: new Uint32Array(8 * 16).fill(WHITE) };
    presenter.frame(surface.api);
    expect(canvas.at(639, 479)).toBe(WHITE);
    surface.overlay = null;
    presenter.frame(surface.api);
    expect(canvas.at(639, 479)).toBe(BLACK);
  });

  it('invalidate() paints everything again', () => {
    const { canvas, surface, presenter } = setup();
    presenter.frame(surface.api);
    canvas.take();
    presenter.invalidate();
    presenter.frame(surface.api);
    expect(canvas.take()).toEqual([{ dx: 0, dy: 0, sx: 0, sy: 0, width: 640, height: 480 }]);
  });
});

describe('rgbaView', () => {
  it('shares the memory of the pixels, in the byte order of ImageData', () => {
    const pixels = new Uint32Array([0xff332211, 0]);
    const view = rgbaView(pixels);
    expect([...view.subarray(0, 4)]).toEqual([0x11, 0x22, 0x33, 0xff]); // $00BBGGRR: red is the low byte
    pixels[1] = WHITE;
    expect(view[4]).toBe(0xff);
    expect(view.length).toBe(8);
  });
});
