// The store interface the transaction plans run on (ARCHITECTURE-PLUS P3.3.5). Owner: N3.
//
// Pure; runs under Node. One HistoryTx is one read-write (or read-only) transaction over `files`,
// `versions`, `contents` and `meta`. fs/history-db.ts implements it over an IndexedDB transaction;
// core/history/memory-tx.ts over plain maps (unit and stress tests). A plan awaits nothing but the
// members of this interface, so that the IndexedDB transaction never ends in its middle (P3.3.5:
// "issues only IndexedDB requests and awaits nothing else").
//
// Reads resolve with what the transaction sees, its own earlier writes included. Writes return
// nothing: a failed write aborts the transaction, which the caller learns from its end. A record
// that does not parse is skipped by every read and reported to `skipped` (P3.3.7).

import type { FileRecord, VersionRecord, ContentRecord } from './records';

export interface Keyed<T> {
  id: string;
  value: T;
}

/** The key of a version in time order (index byTime). */
export type TimeKey = readonly [time: number, file: string, seq: number];

export interface HistoryTx {
  /** The record `id`, or null. */
  file(id: string): Promise<FileRecord | null>;
  /** The living record of `place` (index byLive). */
  living(place: string): Promise<Keyed<FileRecord> | null>;
  /** The living records whose place starts with `prefix`, in place order. */
  livingFrom(prefix: string): Promise<Keyed<FileRecord>[]>;
  /** At most `limit` living records with a place after `after` (exclusive; null = from the start). */
  livingPage(after: string | null, limit: number): Promise<Keyed<FileRecord>[]>;
  /** The records of one Trash item (index byItem). */
  item(item: string): Promise<Keyed<FileRecord>[]>;
  /** Every record in the Trash, oldest first (index byTrashed). */
  trashed(): Promise<Keyed<FileRecord>[]>;
  /** The records in the Trash put there before `before`, oldest first, at most `limit`. */
  trashedBefore(before: number, limit: number): Promise<Keyed<FileRecord>[]>;
  putFile(id: string, record: FileRecord): void;
  deleteFile(id: string): void;

  /** The versions of record `file`, by seq ascending. */
  versions(file: string): Promise<VersionRecord[]>;
  version(file: string, seq: number): Promise<VersionRecord | null>;
  /** At most `limit` versions in time order after `after` (exclusive), with a time below `before`. */
  versionsByTime(after: TimeKey | null, limit: number, before?: number): Promise<VersionRecord[]>;
  putVersion(version: VersionRecord): void;
  deleteVersion(file: string, seq: number): void;
  /** How many versions name `hash` (index byHash). */
  hashUsers(hash: string): Promise<number>;
  /** How many versions there are. */
  versionCount(): Promise<number>;

  hasContent(hash: string): Promise<boolean>;
  content(hash: string): Promise<ContentRecord | null>;
  putContent(hash: string, content: ContentRecord): void;
  deleteContent(hash: string): void;

  /** A `meta` record as stored (undefined when absent); the caller parses it. */
  meta(key: 'totals' | 'notice'): Promise<unknown>;
  putMeta(key: 'totals' | 'notice', value: unknown): void;
}

/** The key of a version in time order. */
export function timeKey(version: Pick<VersionRecord, 'time' | 'file' | 'seq'>): TimeKey {
  return [version.time, version.file, version.seq];
}
