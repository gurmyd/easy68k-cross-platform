// The committed surface hashes of the whole-program pixel regression (ARCHITECTURE.md 6.5.4) and
// the way they are made and compared. Owner: X3. Node only.
//
// WHERE THE GOLDENS COME FROM. Every hash in golden/surfaces.json was taken from THIS PORT: the
// port's assembler, simulator engine and host parts, in the headless harness, under Node. It is a
// regression baseline. It proves that the pictures do not change from one commit to the next and
// that they are the same in every browser and on every operating system. It does NOT prove that
// they are the pictures the original EASy68K draws: the official SIM68K.exe under Wine cannot give
// that (Wine has no Fixedsys font, and its GDI draws ellipses and text its own way; errata/T3.md
// entry 1), and the original's own pictures on Windows are covered where they can be, by the GDI
// references of T2 (tests/conformance/gdi) and the flat-area checks of T3 (tests/conformance/sim).
// docs/porting/errata/X3.md says the same.

import { readFileSync, writeFileSync } from 'node:fs';
import { sha256Hex } from './sha256';
import type { ExampleResult, PreparedProgram } from './runner';

/** What is committed for one example. */
export interface GoldenEntry {
  origin: string;
  /** SHA-256 of the assembled `.S68`: tells a changed program from a changed picture. */
  programSha256: string;
  end: ExampleResult['end'];
  width: number;
  height: number;
  /** Hash of the back buffer (runner.hashPixelBuffer). */
  surfaceHash: string;
  /** Hash of the image the screen shows; differs from `surfaceHash` while double buffering. */
  shownHash: string;
  doubleBuffered: boolean;
  /** Hash of what the canvas shows: the image on screen with the prompt overlay painted over it. */
  screenHash: string;
  instructions: number;
  cycles: number;
  /** Virtual milliseconds the run took. */
  ms: number;
}

export interface GoldenFile {
  /** Says what the numbers are; read by people. */
  provenance: string;
  /** How to make the file again. */
  regenerate: string;
  /** How a hash is made. */
  hash: string;
  examples: Record<string, GoldenEntry>;
}

export const PROVENANCE =
  'A regression baseline taken from the port itself (its assembler, simulator engine and host parts, headless, ' +
  'under Node, real glyph atlases, virtual time). It is NOT a capture of the official EASy68K: it proves ' +
  'stability and independence of browser and operating system, not agreement with the original.';
export const REGENERATE =
  'EASY68K_EXAMPLES_REGENERATE=1 npx vitest run --config tests/conformance/examples/vitest.config.ts';
export const HASH_DESCRIPTION =
  'SHA-256 of "<width>x<height>:" (ASCII) followed by the pixels as bytes R, G, B, A of every pixel in row order.';

export function entryOf(program: PreparedProgram, origin: string, result: ExampleResult): GoldenEntry {
  return {
    origin,
    programSha256: sha256Hex(program.s68),
    end: result.end,
    width: result.width,
    height: result.height,
    surfaceHash: result.surfaceHash,
    shownHash: result.shownHash,
    doubleBuffered: result.doubleBuffered,
    screenHash: result.screenHash,
    instructions: result.instructions,
    cycles: result.cycles,
    ms: result.ms,
  };
}

export function readGolden(path: string): GoldenFile {
  return JSON.parse(readFileSync(path, 'utf8')) as GoldenFile;
}

export function writeGolden(path: string, examples: Record<string, GoldenEntry>): void {
  const file: GoldenFile = { provenance: PROVENANCE, regenerate: REGENERATE, hash: HASH_DESCRIPTION, examples };
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
}

/** The first difference between a result and its golden entry, as a sentence; null if they agree. */
export function describeDifference(golden: GoldenEntry, entry: GoldenEntry): string | null {
  for (const key of Object.keys(golden) as (keyof GoldenEntry)[]) {
    if (golden[key] !== entry[key]) return `${key}: golden ${String(golden[key])}, got ${String(entry[key])}`;
  }
  return null;
}
