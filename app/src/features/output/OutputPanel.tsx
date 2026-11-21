// The Output panel (ARCHITECTURE.md 2.5): the port's stand-in for the original's I/O window.
//
//   +---------------------------------------------------------------+
//   | Output   640x480   zoom: [Fit v]     [full screen] [collapse] |   header strip
//   +---------------------------------------------------------------+
//   |                  +----------------------+                     |
//   |                  |  canvas: the surface |                     |   one canvas for text and
//   |                  +----------------------+                     |   graphics, at a whole-number scale
//   +---------------------------------------------------------------+
//
// What is here and where its logic lives:
//
//   canvas             shows the surface of the simulator session once per animation frame
//                      (present.ts). Its backing store is exactly the surface; CSS scales it
//                      (zoom.ts). Mouse events on it go to the program (core/sim-host/input/mouse.ts).
//                      The size in the header strip and the size of the canvas on screen come
//                      from the same look at the surface as the pixels, not from the store.
//   hidden textarea    has the focus while the program has the keyboard; marked
//                      `data-e68-keys="program"` so that the keyboard dispatcher steps aside and
//                      `data-e68-panel-focus` so that the shell puts the focus here. Its events
//                      are handled by panel-input.ts (the rules of 2.9.4).
//   text mirror        the text screen as lines, off screen, for screen readers (mirror.ts).
//   full screen        fullscreen.ts decides; fullscreen-driver.ts talks to the browser or the
//                      desktop app's window; output.css makes the panel cover the window.

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { shortcutText } from '../../commands/menus';
import { useAppContext, useAppState } from '../../state/context';
import { hidePanel } from '../../state/panels';
import { useStoreValue } from '../../state/store';
import { IconButton, Select } from '../../ui/components';
import { FULL_SCREEN_PROMPT } from './fullscreen';
import { createDesktopFullScreenDriver, createWebFullScreenDriver } from './fullscreen-driver';
import { MIRROR_INTERVAL_MS, mirrorRows, sameRows } from './mirror';
import { outputOf } from './model';
import './output.css';
import { Presenter, rgbaView } from './present';
import { ZOOM_CHOICES, outputPlacement, outputScale, sizeText, zoomOfValue, type OutputZoom, type Size } from './zoom';

export function OutputPanel() {
  const ctx = useAppContext();
  const output = outputOf(ctx);
  const zoom = useAppState((state) => state.settings.app.layout.outputZoom);
  const phase = useStoreValue(output.fullScreen.store, (state) => state.phase);
  const full = phase === 'full';

  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const keys = useRef<HTMLTextAreaElement>(null);
  /**
   * The size of the surface as the presentation loop last saw it. A program changes it without
   * notice (TRAP #15 task 33); taking it here, in the frame that resizes the canvas's backing
   * store, keeps the backing store and the size on screen in step. (AppState.sim.output holds the
   * same numbers for the Options menu; the session mirrors them there, possibly a frame apart.)
   */
  const [surfaceSize, setSurfaceSize] = useState<Size>(() => {
    const { width, height } = ctx.sim.surface.window ?? ctx.sim.surface.back;
    return { width, height };
  });
  /** The room the surface has, in CSS pixels. */
  const [available, setAvailable] = useState<Size>({ width: 0, height: 0 });
  const [hasKeys, setHasKeys] = useState(false);
  const [rows, setRows] = useState<readonly string[]>([]);

  // The room for the surface: the viewport without its scroll bars.
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () =>
      setAvailable((previous) =>
        previous.width === element.clientWidth && previous.height === element.clientHeight
          ? previous
          : { width: element.clientWidth, height: element.clientHeight },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Presentation: once per animation frame the canvas is brought up to date with the surface.
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d', { alpha: false });
    if (!element || !context) return;
    const presenter = new Presenter<ImageData>({
      size: () => ({ width: element.width, height: element.height }),
      resize: (width, height) => {
        element.width = width;
        element.height = height;
      },
      image: (pixels, width, height) => new ImageData(rgbaView(pixels), width, height),
      put: (image, dx, dy, sx, sy, width, height) => context.putImageData(image, dx, dy, sx, sy, width, height),
    });
    let mirroredAt = Number.NEGATIVE_INFINITY;
    let mirrored: readonly string[] = [];
    const frame = () => {
      const { surface } = ctx.sim;
      presenter.frame(surface);
      const { width, height } = surface.window ?? surface.back;
      setSurfaceSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
      // The text mirror follows at most twice per second (2.11).
      const now = ctx.clock.now();
      if (now - mirroredAt < MIRROR_INTERVAL_MS) return;
      mirroredAt = now;
      const next = mirrorRows(ctx.sim.text.state);
      if (sameRows(next, mirrored)) return;
      mirrored = next;
      setRows(next);
    };
    frame();
    const stopFrames = ctx.scheduler.onFrame(frame);
    const stopListening = ctx.sim.onEngineReplaced(() => presenter.invalidate());
    return () => {
      stopFrames();
      stopListening();
    };
  }, [ctx]);

  // Full screen: the browser's Fullscreen API, or the window of the desktop app.
  useEffect(() => {
    if (ctx.platform.setFullScreen) {
      return output.attachDriver(
        createDesktopFullScreenDriver((on) => ctx.platform.setFullScreen?.(on) ?? Promise.resolve(false)),
      );
    }
    const driver = createWebFullScreenDriver(document, (active) => output.fullScreen.driverChanged(active));
    const detach = output.attachDriver(driver);
    return () => {
      detach();
      driver.dispose();
    };
  }, [ctx, output]);

  const focusKeys = () => keys.current?.focus({ preventScroll: true });
  useEffect(() => output.attachKeys(() => keys.current?.focus({ preventScroll: true })), [output]);
  /** The surface as it is now, and where its canvas is on screen. */
  const where = (event: ReactMouseEvent<HTMLCanvasElement>) =>
    [event.nativeEvent, event.currentTarget.getBoundingClientRect(), ctx.sim.surface.back] as const;

  const takeText = (field: HTMLTextAreaElement) => {
    const { value } = field;
    field.value = '';
    output.input.text(value);
  };

  const setZoom = (next: OutputZoom) =>
    ctx.settings.update((settings) =>
      settings.app.layout.outputZoom === next
        ? settings
        : { ...settings, app: { ...settings.app, layout: { ...settings.app.layout, outputZoom: next } } },
    );

  // Full screen shows the surface at the largest whole-number scale that fits, whatever the zoom.
  const scale = outputScale(full ? 'fit' : zoom, surfaceSize, available);
  const place = outputPlacement(surfaceSize, scale, available);

  const keymap = { os: ctx.platform.os, desktop: ctx.platform.kind === 'desktop', state: ctx.store.getState() };
  const fullScreenChord = shortcutText('sim.output.fullscreen', keymap);
  const releaseChord = shortcutText('sim.output.releaseKeyboard', keymap);

  return (
    <div className="e68-output" data-fullscreen={full ? 'true' : undefined} data-keys={hasKeys ? 'true' : undefined}>
      <div className="e68-output__header">
        <h2 className="e68-output__title">Output</h2>
        <span className="e68-output__size">{sizeText(surfaceSize)}</span>
        <Select
          label="zoom:"
          options={ZOOM_CHOICES}
          value={String(zoom)}
          onChange={(value) => setZoom(zoomOfValue(value))}
        />
        <span className="e68-output__grow" />
        <IconButton
          icon="fullscreen"
          label={fullScreenChord ? `Full Screen (${fullScreenChord})` : 'Full Screen'}
          onClick={() => {
            // A click that carries out a waiting request has switched already.
            if (!output.gesture()) output.fullScreen.toggle();
          }}
        />
        <IconButton
          className="e68-output__collapse"
          icon="chevron-up"
          size="small"
          label="Collapse the Output panel"
          onClick={() => hidePanel(ctx, 'output')}
        />
      </div>

      <div className="e68-output__body">
        {/* A click beside the surface gives the program the keyboard, like a click on it. */}
        <div ref={viewport} className="e68-output__viewport" onClick={focusKeys}>
          <canvas
            ref={canvas}
            className="e68-output__canvas"
            role="img"
            aria-label="Output of the program: text and graphics"
            style={{ width: place.width, height: place.height, marginLeft: place.left, marginTop: place.top }}
            onMouseDown={(event) => {
              // Cancelled: no text selection, no drag, no automatic scrolling with the middle button.
              event.preventDefault();
              output.gesture();
              focusKeys();
              output.mouse.down(...where(event));
            }}
            onMouseUp={(event) => output.mouse.up(...where(event))}
            onMouseMove={(event) => output.mouse.move(...where(event))}
            // The left button captures the mouse, as the original's window does (trap15-b §8.1).
            onPointerDown={(event) => {
              if (event.pointerType !== 'mouse' || event.button !== 0) return;
              try {
                event.currentTarget.setPointerCapture(event.pointerId);
              } catch {
                // The pointer is gone already; the events on the canvas itself still arrive.
              }
            }}
            onPointerCancel={() => output.mouse.cancel()}
            onContextMenu={(event) => event.preventDefault()}
          />
        </div>

        <textarea
          ref={keys}
          className="e68-output__keys"
          data-e68-keys="program"
          data-e68-panel-focus=""
          aria-label={
            releaseChord
              ? `Keyboard of the running program. ${releaseChord} moves to the next panel.`
              : 'Keyboard of the running program'
          }
          rows={1}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => void output.input.keydown(event.nativeEvent)}
          onKeyUp={(event) => output.input.keyup(event.nativeEvent)}
          // Text from a dead key or an input method: taken when it is complete (3.6).
          onInput={(event) => {
            if (!(event.nativeEvent as InputEvent).isComposing) takeText(event.currentTarget);
          }}
          onCompositionEnd={(event) => takeText(event.currentTarget)}
          onPaste={(event) => {
            event.preventDefault();
            output.input.paste(event.clipboardData.getData('text/plain'));
          }}
          onFocus={() => {
            setHasKeys(true);
            output.input.focus();
          }}
          onBlur={() => {
            setHasKeys(false);
            output.input.blur();
          }}
        />

        {phase === 'waiting' && (
          <button
            type="button"
            className="e68-output__prompt"
            onClick={() => {
              output.gesture();
              focusKeys();
            }}
          >
            {FULL_SCREEN_PROMPT}
          </button>
        )}
      </div>

      {/* The text screen for screen readers: one row per line, announced politely (2.11). */}
      <div className="e68-sr" role="log" aria-label="Text of the Output panel">
        {rows.map((row, index) => (
          <div key={index}>{row === '' ? ' ' : row}</div>
        ))}
      </div>
    </div>
  );
}
