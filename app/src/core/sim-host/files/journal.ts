// The program-files journal (ARCHITECTURE.md 3.8.4, "Exit"): what an abrupt close of the page left
// unwritten, kept in a small synchronous store (localStorage) until the next start applies it.
//
// One entry per file says what the file must look like, not how it got there:
//
//   { path, remove: true }                 the file must not exist
//   { path, size, at, data }               the file is `size` bytes long and bytes [at, at + n) are
//                                          `data` (base64); the rest is what storage already has
//
// so that applying an entry twice, or applying it after the interrupted write did land after all,
// gives the same bytes. The store holds one text for the whole origin; every window keeps its own
// part under its instance id, so two windows that close at once do not overwrite each other.
//
// Pure functions; runs under Node.
//
// Owner: W1 > SH6.

import type { Bytes, VPath } from '../../../contracts';

export type JournalEntry = { path: VPath; remove: true } | { path: VPath; size: number; at: number; data: string };

export interface JournalPart {
  entries: JournalEntry[];
}

export interface JournalDocument {
  v: 1;
  parts: Record<string, JournalPart>;
}

const EMPTY_DOCUMENT = (): JournalDocument => ({ v: 1, parts: {} });

/** Reads the stored text; anything unreadable is an empty journal. */
export function parseJournal(text: string | null): JournalDocument {
  if (!text) return EMPTY_DOCUMENT();
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object') return EMPTY_DOCUMENT();
    const { v, parts } = value as { v?: unknown; parts?: unknown };
    if (v !== 1 || !parts || typeof parts !== 'object') return EMPTY_DOCUMENT();
    const out = EMPTY_DOCUMENT();
    for (const [id, part] of Object.entries(parts as Record<string, unknown>)) {
      const entries = (part as { entries?: unknown })?.entries;
      if (!Array.isArray(entries)) continue;
      out.parts[id] = { entries: entries.filter(isEntry) };
    }
    return out;
  } catch {
    return EMPTY_DOCUMENT();
  }
}

function isEntry(value: unknown): value is JournalEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.path !== 'string') return false;
  if (entry.remove === true) return true;
  return (
    Number.isSafeInteger(entry.size) &&
    (entry.size as number) >= 0 &&
    Number.isSafeInteger(entry.at) &&
    (entry.at as number) >= 0 &&
    typeof entry.data === 'string'
  );
}

/** The stored text, or null when no part is left. */
export function serializeJournal(doc: JournalDocument): string | null {
  return Object.keys(doc.parts).length === 0 ? null : JSON.stringify(doc);
}

/**
 * The bytes a file must have after an entry: storage's bytes `current` (null = no such file) cut or
 * extended with zero bytes to `size`, with the entry's bytes laid over them at `at`.
 */
export function applyEntryBytes(current: Bytes | null, entry: { size: number; at: number; data: string }): Bytes {
  const out = new Uint8Array(entry.size);
  if (current) out.set(current.subarray(0, Math.min(current.length, entry.size)));
  const patch = fromBase64(entry.data);
  out.set(
    patch.subarray(0, Math.max(0, Math.min(patch.length, entry.size - entry.at))),
    Math.min(entry.at, entry.size),
  );
  return out;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const digit = (value: number): string => ALPHABET.charAt(value & 63);

export function toBase64(bytes: Bytes): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
    out += digit(n >> 18) + digit(n >> 12) + digit(n >> 6) + digit(n);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] as number) << 16;
    out += `${digit(n >> 18)}${digit(n >> 12)}==`;
  } else if (rest === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
    out += `${digit(n >> 18)}${digit(n >> 12)}${digit(n >> 6)}=`;
  }
  return out;
}

export function fromBase64(text: string): Bytes {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (const ch of clean) {
    value = (value << 6) | ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}
