// The records of the history database and how they are counted (ARCHITECTURE-PLUS P3.3.4, P3.3.5).
// Owner: N3.
//
// Pure; runs under Node. The stores of `easy68k-history` (P3.3.5):
//
//   meta      'totals' -> Totals, 'notice' -> Notice
//   roots     rootId -> { handle, name }
//   files     fileId -> FileRecord        indexes byLive (unique), byItem, byTrashed
//   versions  [file, seq] -> VersionRecord  indexes byTime, byHash
//   contents  hash -> ContentRecord
//
// Counting (P3.3.4): each record counts 128 bytes, each version its content's stored size plus 128.
// A record in the Trash counts itself and its copy (its newest version) in the Trash half; its
// older versions, and every living record with all its versions, count in the versions half.
//
// Additions to the fields P3.3.5 lists (errata N3, entry "records"): a version carries its `file`
// and `seq` (the store's key path) and the `stored` size of its content, so that counting never
// reads a content; a record carries `lastSeq`, the highest seq it ever used, so that a seq is never
// given twice; a record in the Trash may carry `pending`, the mark of the window that is deleting
// its file (open case 2).

import type { VPath, VersionReason } from '../../contracts';
import { RECORD_BYTES } from './limits';

/** Where a record in the Trash came from (P3.3.5). */
export interface TrashMark {
  item: string;
  at: number;
  cause: 'deleted' | 'replaced';
  /** The item's path: the file or folder the command named. */
  path: VPath;
  /** Set by guard between its keep and the end of `act` (errata N3, open case 2). */
  pending?: PendingMark;
}

/** The mark of a window whose `act` may still remove the item's files. */
export interface PendingMark {
  window: string;
  at: number;
}

export interface FileRecord {
  place: string;
  /** Equals `place` while the record is living; absent in the Trash (unique index byLive). */
  live?: string;
  /** The path as last written, for display and for a restore. */
  spelling: VPath;
  newestSeq: number;
  /** '' while the record has no version (a `dir` record, or within one transaction). */
  newestHash: string;
  lastSeq: number;
  count: number;
  /** The counted size of the record and all its versions. */
  bytes: number;
  /** An empty folder of a deleted folder: no versions, only in the Trash. */
  dir?: true;
  trash?: TrashMark;
}

export interface VersionRecord {
  file: string;
  seq: number;
  time: number;
  hash: string;
  /** The size of the bytes. */
  size: number;
  /** The stored size of its content. */
  stored: number;
  reason: VersionReason;
}

export interface ContentRecord {
  enc: 'deflate-raw' | 'none';
  data: Uint8Array;
  size: number;
  stored: number;
}

/** The counted bytes of each half (P3.3.4). */
export interface Totals {
  versions: number;
  trash: number;
}

/** The lowering when storage is tight (P3.3.4); absent = armed. */
export interface Notice {
  armed: boolean;
  halvedAt?: number;
}

export type Half = keyof Totals;

/** The counted size of one version. */
export function countedVersion(version: Pick<VersionRecord, 'stored'>): number {
  return version.stored + RECORD_BYTES;
}

/** The half a version counts in. */
export function halfOfVersion(record: FileRecord, seq: number): Half {
  return record.trash && seq === record.newestSeq ? 'trash' : 'versions';
}

/** What a record with these versions contributes to each half. */
export function contribution(record: FileRecord, versions: readonly VersionRecord[]): Totals {
  const out: Totals = { versions: 0, trash: 0 };
  out[record.trash ? 'trash' : 'versions'] += RECORD_BYTES;
  for (const v of versions) out[halfOfVersion(record, v.seq)] += countedVersion(v);
  return out;
}

const REASONS: ReadonlySet<string> = new Set([
  'saved',
  'opened',
  'before-import',
  'before-restore',
  'before-replace',
  'before-delete',
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A record as stored, or null when it does not parse (P3.3.7: skipped and counted). */
export function parseFileRecord(value: unknown): FileRecord | null {
  if (!isObject(value)) return null;
  const { place, live, spelling, newestSeq, newestHash, lastSeq, count, bytes, dir, trash } = value;
  if (typeof place !== 'string' || typeof spelling !== 'string' || typeof newestHash !== 'string') return null;
  if (!isCount(newestSeq) || !isCount(lastSeq) || !isCount(count) || !isCount(bytes)) return null;
  if (live !== undefined && live !== place) return null;
  if (dir !== undefined && dir !== true) return null;
  if (trash !== undefined) {
    if (!isObject(trash) || live !== undefined) return null;
    if (typeof trash.item !== 'string' || !isTime(trash.at) || typeof trash.path !== 'string') return null;
    if (trash.cause !== 'deleted' && trash.cause !== 'replaced') return null;
    if (trash.pending !== undefined) {
      const pending = trash.pending;
      if (!isObject(pending) || typeof pending.window !== 'string' || !isTime(pending.at)) return null;
    }
  } else if (live === undefined) {
    return null; // neither living nor in the Trash
  }
  return value as unknown as FileRecord;
}

/** A version as stored, or null when it does not parse. */
export function parseVersionRecord(value: unknown): VersionRecord | null {
  if (!isObject(value)) return null;
  const { file, seq, time, hash, size, stored, reason } = value;
  if (typeof file !== 'string' || !isCount(seq) || !isTime(time) || typeof hash !== 'string') return null;
  if (!isCount(size) || !isCount(stored) || typeof reason !== 'string' || !REASONS.has(reason)) return null;
  return value as unknown as VersionRecord;
}

/** A content as stored, or null when it does not parse. */
export function parseContentRecord(value: unknown): ContentRecord | null {
  if (!isObject(value)) return null;
  const { enc, data, size, stored } = value;
  if (enc !== 'deflate-raw' && enc !== 'none') return null;
  if (!(data instanceof Uint8Array) && !ArrayBuffer.isView(data)) return null;
  if (!isCount(size) || !isCount(stored)) return null;
  return value as unknown as ContentRecord;
}

/** Thrown inside a transaction when a `meta` record does not parse: the history is unavailable (P3.3.7). */
export class MetaDamaged extends Error {
  constructor(readonly key: string) {
    super(`the record "${key}" of the history is damaged`);
    this.name = 'MetaDamaged';
  }
}

/** `meta.totals`, absent in a new database. */
export function parseTotals(value: unknown): Totals {
  if (value === undefined) return { versions: 0, trash: 0 };
  if (!isObject(value) || !isCount(value.versions) || !isCount(value.trash)) throw new MetaDamaged('totals');
  return { versions: value.versions, trash: value.trash };
}

/** `meta.notice`, absent = armed. */
export function parseNotice(value: unknown): Notice {
  if (value === undefined) return { armed: true };
  if (!isObject(value) || typeof value.armed !== 'boolean') throw new MetaDamaged('notice');
  if (value.halvedAt !== undefined && !isTime(value.halvedAt)) throw new MetaDamaged('notice');
  return value.halvedAt === undefined ? { armed: value.armed } : { armed: value.armed, halvedAt: value.halvedAt };
}
