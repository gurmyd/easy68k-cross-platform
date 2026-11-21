// Types of pwa-build.mjs (for its unit test and for app/vite.config.ts). Owner: DV1.

/** A Vite plugin (typed loosely: features/ may not import from vite; the config casts it). */
export interface PwaPlugin {
  name: string;
  apply: 'build';
  [hook: string]: unknown;
}

export interface PrecacheEntry {
  url: string;
  size: number;
  sha256: string;
}

export interface PwaBuildReport {
  version: string;
  files: number;
  bytes: number;
  serviceWorkerBytes: number;
  entries: PrecacheEntry[];
}

export const APP_DIR: string;
export const SW_SOURCE: string;
export const SW_FILE: string;
export const SW_META_NAME: string;
export const THEME_COLOR: string;
export const HEAD_TAGS: readonly string[];
export function isPrecached(path: string): boolean;
export function listFiles(dir: string): string[];
export function urlOf(path: string): string;
export function sha256(data: string | Uint8Array): string;
export function precacheEntries(outDir: string): PrecacheEntry[];
export function patchIndexHtml(html: string): string;
export function versionOf(code: string, entries: readonly PrecacheEntry[]): string;
export function serviceWorkerText(code: string, entries: readonly PrecacheEntry[]): string;
export function readServiceWorkerManifest(text: string): { version: string; entries: PrecacheEntry[] };
export function bundleServiceWorker(): Promise<string>;
export function finishPwaBuild(outDir: string, options?: { code?: string }): Promise<PwaBuildReport>;
export function summarize(report: PwaBuildReport): string;
export function pwaPlugin(): PwaPlugin;
