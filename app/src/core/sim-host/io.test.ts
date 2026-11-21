// OutputDevice (ARCHITECTURE.md 3.3.1): the `text` and `graphics` host parts over a TextScreen and
// a Surface.

import { beforeAll, describe, expect, it } from 'vitest';
import type { HostIoGraphics, HostIoText, SurfaceApi, TextScreenApi } from '../../contracts';
import { HOST_PART_DEFAULTS } from '../../engine/sim';
import { MIN_HEIGHT, MIN_WIDTH, OutputDevice, SIZE_LIMIT_MESSAGE } from './io';
import { MAX_SURFACE } from './surface/surface';
import { bytesOf, createTextRig, rowText, syntheticFonts } from './text/testing';

/** A stand-in that records the calls made to it; reads of `back` and `state` answer from `values`. */
function recorder<T extends object>(values: Record<string, unknown> = {}): { part: T; calls: string[] } {
  const calls: string[] = [];
  const part = new Proxy(values, {
    get: (target, name) =>
      name in target
        ? target[name as string]
        : (...args: unknown[]) => {
            calls.push(
              `${String(name)}(${args.map((arg) => (arg instanceof Uint8Array ? `[${arg.join(' ')}]` : String(arg))).join(',')})`,
            );
            return values[`${String(name)}()`];
          },
  }) as T;
  return { part, calls };
}

// The synthetic fonts are drawn once; under load that can take seconds, so it has a limit of its own.
beforeAll(() => void syntheticFonts(), 60_000);

describe('OutputDevice', () => {
  it('has every method of the text and graphics parts of the host, and nothing else that the host would take', () => {
    const { device } = createTextRig();
    const methods = Object.getOwnPropertyNames(OutputDevice.prototype).filter((name) => name !== 'constructor');
    expect(methods.sort()).toEqual(
      [...Object.keys(HOST_PART_DEFAULTS.text), ...Object.keys(HOST_PART_DEFAULTS.graphics)].sort(),
    );
    // usable as both parts
    const text: HostIoText = device;
    const graphics: HostIoGraphics = device;
    expect(text).toBe(graphics);
  });

  it('gives the text calls to the text screen with their arguments', () => {
    const text = recorder<TextScreenApi>({ 'getrc()': 0x0a05, 'getCharAt()': 0x48 });
    const surface = recorder<SurfaceApi>({ back: { width: 640, height: 480 } });
    const device = new OutputDevice({
      surface: surface.part,
      text: text.part,
      show: () => {},
      bringToFront: () => {},
      setFullScreen: () => {},
    });
    device.charOut(65);
    device.textOut(bytesOf('AB'));
    device.textOutCR(bytesOf('C'));
    device.clear();
    device.gotorc(5, 10);
    device.setFontProperties(0xff, 0x03120001);
    device.scrollRect(1, 2, 3, 4, 0);
    device.inputPrompt(2);
    device.erasePrompt();
    device.inputEcho(97, true);
    device.inputBackspace(false);
    device.doCRLF();
    device.drawText(bytesOf('Hi'), 10, 20);
    expect(device.getrc()).toBe(0x0a05);
    expect(device.getCharAt(3, 4)).toBe(0x48);
    expect(text.calls).toEqual([
      'charOut(65)',
      'textOut([65 66])',
      'textOutCR([67])',
      'clear()',
      'gotorc(5,10)',
      'setFontProperties(255,51511297)',
      'scrollRect(1,2,3,4,0)',
      'inputPrompt(2)',
      'erasePrompt()',
      'inputEcho(97,true)',
      'inputBackspace(false)',
      'doCRLF()',
      'drawText([72 105],10,20)',
      'getrc()',
      'getCharAt(3,4)',
    ]);
    expect(surface.calls).toEqual([]);
  });

  it('gives the graphics calls to the surface with their arguments', () => {
    const text = recorder<TextScreenApi>();
    const surface = recorder<SurfaceApi>({ 'getPixel()': 0x00123456, 'getXY()': [7, 9] });
    const device = new OutputDevice({
      surface: surface.part,
      text: text.part,
      show: () => {},
      bringToFront: () => {},
      setFullScreen: () => {},
    });
    device.setLineColor(0xff);
    device.setFillColor(0xff00);
    device.drawPixel(1, 2);
    device.line(1, 2, 30, 40);
    device.lineTo(5, 6);
    device.moveTo(7, 8);
    device.rectangle(1, 2, 3, 4);
    device.ellipse(5, 6, 7, 8);
    device.floodFill(9, 10);
    device.unfilledRectangle(1, 2, 3, 4);
    device.unfilledEllipse(5, 6, 7, 8);
    device.setDrawingMode(17);
    device.setPenWidth(3);
    device.formPaint();
    device.invalidate();
    expect(device.getPixel(-1, 5)).toBe(0x00123456);
    expect(device.getXY()).toEqual([7, 9]);
    expect(surface.calls).toEqual([
      'setLineColor(255)',
      'setFillColor(65280)',
      'drawPixel(1,2)',
      'line(1,2,30,40)',
      'lineTo(5,6)',
      'moveTo(7,8)',
      'rectangle(1,2,3,4)',
      'ellipse(5,6,7,8)',
      'floodFill(9,10)',
      'unfilledRectangle(1,2,3,4)',
      'unfilledEllipse(5,6,7,8)',
      'setDrawingMode(17)',
      'setPenWidth(3)',
      'formPaint()', // task 94
      'formPaint()', // invalidate: the window is repainted from the back buffer
      'getPixel(-1,5)',
      'getXY()',
    ]);
    expect(text.calls).toEqual([]);
  });

  it('show, bring to front and full screen go to the Output panel', () => {
    const rig = createTextRig();
    rig.device.ioShow();
    rig.device.ioBringToFront();
    rig.device.ioBringToFront();
    rig.device.setupWindow(true);
    rig.device.setupWindow(false);
    expect(rig.calls).toMatchObject({ ioShow: 1, bringToFront: 2 });
    expect(rig.fullScreen).toEqual([true, false]);
    expect(rig.calls.show).toBe(0); // the text screen's own show is for text output
  });

  describe('setWindowSize (trap15-b §4.3)', () => {
    it('resizes the surface, blacks it and measures the text grid again; the cursor and the text stay', () => {
      const rig = createTextRig();
      rig.text.gotorc(3, 4);
      rig.text.textOut(bytesOf('HELLO'));
      rig.device.setWindowSize(800, 600);
      expect(rig.device.getWindowSize()).toEqual([800, 600]);
      expect(rig.surface.isFilled({ left: 0, top: 0, right: 800, bottom: 600 }, 0)).toBe(true);
      expect(rig.text.state).toMatchObject({ textCols: 100, textRows: 40, row: 3, col: 9, textX: 72, textY: 45 });
      // the shadow array is neither cleared nor laid out again: byte 3 * 80 + 4 is still the H
      expect(rig.text.state.text[244]).toBe(0x48);
      expect(rowText(rig.text, 2, 50).slice(44, 49)).toBe('HELLO');
    });

    it('0, 0 keeps the size and still blacks the surface', () => {
      const rig = createTextRig();
      rig.device.setWindowSize(1024, 768);
      rig.text.textOut(bytesOf('HELLO'));
      rig.device.setWindowSize(0, 0);
      expect(rig.device.getWindowSize()).toEqual([1024, 768]);
      expect(rig.surface.isFilled({ left: 0, top: 0, right: 1024, bottom: 768 }, 0)).toBe(true);
      expect(rig.text.state).toMatchObject({ row: 0, col: 5 });
    });

    it('each side is at least 640 and 480; only 0, 0 means "keep"', () => {
      const rig = createTextRig();
      rig.device.setWindowSize(100, 100);
      expect(rig.device.getWindowSize()).toEqual([MIN_WIDTH, MIN_HEIGHT]);
      rig.device.setWindowSize(800, 0);
      expect(rig.device.getWindowSize()).toEqual([800, 480]);
      rig.device.setWindowSize(0, 600);
      expect(rig.device.getWindowSize()).toEqual([640, 600]);
    });

    it('asks the surface for the size with the minimum applied', () => {
      const surface = recorder<SurfaceApi>({ back: { width: 800, height: 600 } });
      const text = recorder<TextScreenApi>();
      const device = new OutputDevice({
        surface: surface.part,
        text: text.part,
        show: () => {},
        bringToFront: () => {},
        setFullScreen: () => {},
      });
      device.setWindowSize(0, 0);
      device.setWindowSize(1920, 1200);
      device.setWindowSize(10, 2000);
      expect(surface.calls).toEqual(['resize(800,600)', 'resize(1920,1200)', 'resize(640,2000)']);
      expect(text.calls).toEqual(['setTextSize()', 'setTextSize()', 'setTextSize()']);
    });

    it('a request above the limit of the port is reported in the message area, once per call', () => {
      const rig = createTextRig();
      rig.device.setWindowSize(MAX_SURFACE, MAX_SURFACE);
      expect(rig.messages).toEqual([]);
      rig.device.setWindowSize(MAX_SURFACE + 1, 480);
      rig.device.setWindowSize(640, 65535);
      expect(rig.messages).toEqual([SIZE_LIMIT_MESSAGE, SIZE_LIMIT_MESSAGE]);
      expect(SIZE_LIMIT_MESSAGE).toBe('Output window size limited to 4096 x 4096');
    });

    it('works without the message callback, which is optional in the contract', () => {
      const rig = createTextRig();
      const device = new OutputDevice({
        surface: rig.surface,
        text: rig.text,
        show: () => {},
        bringToFront: () => {},
        setFullScreen: () => {},
      });
      expect(() => device.setWindowSize(65535, 65535)).not.toThrow();
      expect(device.getWindowSize()).toEqual([MAX_SURFACE, MAX_SURFACE]);
    });

    it('does not ask the Output panel to lay itself out again: only setupWindow reaches the full-screen callback', () => {
      // The original's setWindowSize ends with setupWindow() (simIOu.cpp:226), which re-applies
      // the window or full-screen layout. In the port the panel lays the surface out from its size
      // on every frame, and the full-screen flag is the engine's, not this class's: a size change
      // must not send a remembered value of it (docs/porting/errata/SH3.md entry 24).
      const rig = createTextRig();
      rig.device.setupWindow(true);
      rig.device.setWindowSize(800, 600);
      rig.device.setWindowSize(0, 0);
      rig.device.setWindowSize(65535, 65535);
      expect(rig.fullScreen).toEqual([true]);
      expect(rig.calls).toMatchObject({ ioShow: 0, bringToFront: 0 });
    });
  });
});
