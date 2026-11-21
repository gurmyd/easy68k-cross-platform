// The page side of check-output.mjs: mounts the real shell with the real Output panel on the test
// bed (bed.ts) in a browser. Never imported by the application.
//
// The check script opens harness.html on the Vite dev server and calls mountOutputHarness() with
// the things this folder may not import itself (3.1): the engine helpers of app/src/engine and
// the root component app/src/App.tsx. The result is what the script then drives and reads:
//
//   const output = await mountOutputHarness({ createEngine, assemble, App, os, container });
//   await output.load(lineInputProgram()); output.run();
//   ... real keys through Playwright ...
//   output.string(LINES.text)
//
// Here time is the browser's: the run controller's double ticks once per animation frame.
//
// The page reports every change of the full-screen phase on its console (FULL_SCREEN_SIGNAL).
// The script needs that to see a request arrive WITHOUT touching the page: whatever it does to a
// page counts there as a user gesture, and the deferred case of 2.5 is the one without a gesture.

import type { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import type { Glyph, Platform } from '../../../contracts';
import { codePointForByte } from '../../../core/codec/cp1252';
import { createFrameScheduler, createRealClock } from '../../../state/browser';
import type { Application } from '../../../state/context';
import { outputOf } from '../model';
import { createOutputBed, type BedEnv, type OutputBed } from './bed';
import * as programs from './programs';
import { CELL_HEIGHT, CELL_WIDTH } from './text-grid';

export interface HarnessOptions extends BedEnv {
  /** The root component, app/src/App.tsx. */
  App: ComponentType<{ app: Application }>;
  os: Platform['os'];
  /** Behave as the desktop app: `Platform.setFullScreen` exists and records its calls, and
   *  `Platform.onFullScreenChange` reports what the test says the system did. */
  desktop?: boolean;
  container: HTMLElement;
}

/** Prefix of the console line that reports a change of the full-screen phase; the phase follows. */
export const FULL_SCREEN_SIGNAL = '[output-check] full screen: ';

export interface OutputHarness extends OutputBed {
  /** The 68000 programs of programs.ts and the addresses of their variables. */
  readonly programs: typeof programs;
  /** Desktop mode: every value Platform.setFullScreen was called with. */
  readonly windowFullScreen: boolean[];
  /** Desktop mode: the system itself put the window into full screen or took it out (the green
   *  button); the listeners of Platform.onFullScreenChange hear of it. */
  systemFullScreen(on: boolean): void;
  /** The phase of the full-screen controller: windowed, waiting, entering or full. */
  fullScreenPhase(): string;
}

/** Pictures of characters drawn by the browser, so that a screenshot of the text double is readable. */
function browserGlyphs(): (ch: number) => Glyph {
  const canvas = document.createElement('canvas');
  canvas.width = CELL_WIDTH;
  canvas.height = CELL_HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const cache = new Map<number, Glyph>();
  return (ch) => {
    let glyph = cache.get(ch);
    if (!glyph && context) {
      context.fillStyle = '#000';
      context.fillRect(0, 0, CELL_WIDTH, CELL_HEIGHT);
      context.fillStyle = '#fff';
      context.font = '13px monospace';
      context.textBaseline = 'alphabetic';
      context.fillText(String.fromCharCode(codePointForByte(ch)), 0, 12);
      const { data } = context.getImageData(0, 0, CELL_WIDTH, CELL_HEIGHT);
      const coverage = Uint8Array.from({ length: CELL_WIDTH * CELL_HEIGHT }, (_, index) => data[index * 4] as number);
      glyph = { advance: CELL_WIDTH, width: CELL_WIDTH, height: CELL_HEIGHT, coverage };
      cache.set(ch, glyph);
    }
    return glyph ?? { advance: CELL_WIDTH, width: CELL_WIDTH, height: CELL_HEIGHT, coverage: new Uint8Array(128) };
  };
}

export async function mountOutputHarness(options: HarnessOptions): Promise<OutputHarness> {
  const windowFullScreen: boolean[] = [];
  const systemListeners = new Set<(on: boolean) => void>();
  const bed = await createOutputBed(options, {
    os: options.os,
    clock: createRealClock(),
    scheduler: createFrameScheduler(),
    keyTarget: window,
    glyph: browserGlyphs(),
    ...(options.desktop
      ? {
          platform: {
            kind: 'desktop',
            setFullScreen: async (on: boolean) => {
              windowFullScreen.push(on);
              return true;
            },
            onFullScreenChange(listener: (on: boolean) => void) {
              systemListeners.add(listener);
              return () => {
                systemListeners.delete(listener);
              };
            },
          },
        }
      : {}),
  });
  bed.controller.start();
  const { fullScreen } = outputOf(bed.ctx);
  fullScreen.store.subscribe(() => console.info(`${FULL_SCREEN_SIGNAL}${fullScreen.phase}`));
  createRoot(options.container).render(<options.App app={bed.app} />);
  return Object.assign(bed, {
    programs,
    windowFullScreen,
    systemFullScreen(on: boolean) {
      for (const listener of [...systemListeners]) listener(on);
    },
    fullScreenPhase: () => fullScreen.phase,
  });
}
