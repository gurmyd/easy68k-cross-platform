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
  /** Behave as the desktop app: `Platform.setFullScreen` exists and records its calls. */
  desktop?: boolean;
  container: HTMLElement;
}

export interface OutputHarness extends OutputBed {
  /** The 68000 programs of programs.ts and the addresses of their variables. */
  readonly programs: typeof programs;
  /** Desktop mode: every value Platform.setFullScreen was called with. */
  readonly windowFullScreen: boolean[];
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
          },
        }
      : {}),
  });
  bed.controller.start();
  createRoot(options.container).render(<options.App app={bed.app} />);
  return Object.assign(bed, {
    programs,
    windowFullScreen,
    fullScreenPhase: () => outputOf(bed.ctx).fullScreen.phase,
  });
}
