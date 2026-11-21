// Reading the committed GDI references (golden/), for the tests. Owner: T2.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateCases, SUITES, type GdiCase } from './cases';
import { decodePack, decodePix, type PixImage } from './pix';

export const GOLDEN_DIR = fileURLToPath(new URL('./golden/', import.meta.url));

export interface Reference {
  readonly case: GdiCase;
  readonly image: PixImage;
  readonly pen: readonly [number, number];
}

let allCases: GdiCase[] | undefined;
export function cases(): GdiCase[] {
  return (allCases ??= generateCases());
}

export function suiteNames(): string[] {
  return SUITES.map((s) => s.name);
}

export function isMachineSuite(suite: string): boolean {
  return SUITES.find((s) => s.name === suite)?.machine ?? false;
}

export function hasPack(suite: string): boolean {
  return existsSync(`${GOLDEN_DIR}${suite}.pixpack.gz`);
}

/** The references of one suite, joined with their cases (by id). */
export function references(suite: string): Reference[] {
  const pack = decodePack(new Uint8Array(readFileSync(`${GOLDEN_DIR}${suite}.pixpack.gz`)));
  const byId = new Map(cases().map((c) => [c.id, c]));
  return pack.cases.map((p) => {
    const c = byId.get(p.id);
    if (!c)
      throw new Error(
        `${suite}: reference ${p.id} has no case in cases.ts (regenerate with npm run oracle:gdi -- --write)`,
      );
    return { case: c, image: decodePix(p.pix), pen: p.pen };
  });
}

export interface Spots {
  capturedOn: Record<string, unknown>;
  sysColors: number[];
  stockPalette: number[];
  colourForms: Record<string, number>;
  modes: { mode: number; line: number; pixel: number; outline: number; interior: number }[];
  rop2Raw: [number, number][];
  dots: { width: number; pixels: number; diameterX: number; diameterY: number; left: number; top: number }[];
  controlBytes: { byte: number; cellRight: number; pen: number }[];
}

let spotValues: Spots | undefined;
/** golden/spots.json, read once (treat it as read-only). */
export function spots(): Spots {
  return (spotValues ??= JSON.parse(readFileSync(`${GOLDEN_DIR}spots.json`, 'utf8')) as Spots);
}

/** First differing pixel of two pictures of the same size, or null. */
export function firstDifference(
  a: { width: number; pixels: Uint32Array },
  b: { width: number; pixels: Uint32Array },
  mask?: (x: number, y: number) => boolean,
): { x: number; y: number; got: number; want: number; count: number } | null {
  let first: { x: number; y: number; got: number; want: number } | null = null;
  let count = 0;
  for (let i = 0; i < a.pixels.length; i++) {
    const x = i % a.width;
    const y = Math.floor(i / a.width);
    if (mask && !mask(x, y)) continue;
    const got = (a.pixels[i] as number) & 0xffffff;
    const want = (b.pixels[i] as number) & 0xffffff;
    if (got !== want) {
      count++;
      first ??= { x, y, got, want };
    }
  }
  return first ? { ...first, count } : null;
}

export const hex6 = (n: number) => '$' + (n >>> 0).toString(16).toUpperCase().padStart(6, '0');
