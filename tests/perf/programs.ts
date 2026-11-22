// The fixed programs of the performance package and how to assemble them (ARCHITECTURE.md 6.9
// item 9, 9.6). Owner: P1.
//
//   calibrate.X68   instructions per second by the program's own clock (task 8); also the program
//                   the owner runs on the original (decision O-1, docs/porting/speed.md)
//   spin.X68        a busy loop: the processor measurements
//   draw.X68        continuous double-buffered drawing: the frame measurements
//   surface.X68     a 4096 x 4096 surface: resize, clear, flood fill
//
// The sources are Windows-1252 text with CR LF line ends (.gitattributes keeps them as bytes).

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Bytes } from '../../app/src/contracts';

export const PERF_DIR = fileURLToPath(new URL('.', import.meta.url));

export const PERF_PROGRAMS = ['calibrate', 'spin', 'draw', 'surface'] as const;
export type PerfProgram = (typeof PERF_PROGRAMS)[number];

/** The bytes of `tests/perf/<name>.X68`. */
export function perfSource(name: PerfProgram): Bytes {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./${name}.X68`, import.meta.url))));
}

/** True if both engines are built (engine/dist is not in the repository). */
export function enginesBuilt(): boolean {
  return ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
    existsSync(fileURLToPath(new URL(`../../engine/dist/${file}`, import.meta.url))),
  );
}

/** The colour surface.X68 fills with, as a pixel of the surface (0xFF000000 | $00BBGGRR). */
export const SURFACE_GREEN = 0xff00c000;
