// The transaction plans of the history (ARCHITECTURE-PLUS P3.3.4, P3.3.5). Owner: N3.
//
// Pure; runs under Node. Each exported plan is the body of ONE read-write transaction: it awaits
// nothing but the members of the HistoryTx it is given (core/history/store.ts), so that over
// IndexedDB the transaction stays active from its first request to its last. Everything outside a
// transaction (reading the files, hashing, compressing, resolving places, asking the person) is
// phase 1 and belongs to fs/history-db.ts.
//
// Counting (P3.3.4, core/history/records.ts): `meta.totals` holds the counted bytes of each half
// and changes in the transaction of every change; each record's `bytes` and `count` change with its
// versions. Admission (P3.3.4): each half a change makes larger is checked against B / 2; when the
// change would take it above, that half is pruned in the same transaction down to 0.9 x B / 2 with
// the change included (errata N3, open case 3), in its own order:
//
//   versions half: (1) the widened schedule on every living record, (2) the oldest versions of
//                  the half, of any record; a living record whose last version goes is deleted;
//   Trash half:    the oldest item first, whole.
//
// Pruning never removes what the change keeps or moves, an item this window is restoring from, or
// an item whose files a live window's guard may still be removing (open case 2). What does not fit
// after pruning is not kept. The decisions of the six open cases of P7 are in
// docs/porting/errata/N3.md; each is marked "open case n" where the code makes it.

import type { VPath, VersionReason } from '../../contracts';
import { LARGEST_VERSION, PRUNE_TO, RECORD_BYTES, TRASH_AGE, VERSION_AGE } from './limits';
import { childPrefix } from './places';
import {
  countedVersion,
  halfOfVersion,
  parseNotice,
  parseTotals,
  type ContentRecord,
  type FileRecord,
  type Half,
  type Notice,
  type PendingMark,
  type Totals,
  type TrashMark,
  type VersionRecord,
} from './records';
import { scheduleKeep, widenedKeep } from './schedule';
import { timeKey, type HistoryTx, type Keyed, type TimeKey } from './store';

/** What a plan knows of its window and of phase 1. */
export interface PlanEnv {
  /** The wall clock when the change was asked for (milliseconds since 1970). */
  now: number;
  /** B, as this window read it in phase 1 (P3.3.4). */
  budget: number;
  /** This window's id, for the marks of open case 2. */
  window: string;
  /** True when a guard's mark still protects its item from pruning (open case 2). */
  honored(mark: PendingMark, item: string): boolean;
  /** The Trash items this window is restoring from (never pruned by this window, P3.3.4). */
  restoring: ReadonlySet<string>;
  /** A new random id for a record or an item. */
  newId(): string;
  /** The pruning log (tests and the stress run). */
  log?: ((event: PlanEvent) => void) | undefined;
}

export type PruneCause = 'admission' | 'pass' | 'lower';

/** What a plan did that a test may want to count (the pruning log of P5 N3). */
export type PlanEvent =
  | {
      kind: 'prune';
      half: Half;
      by: PruneCause;
      /** Trash items dropped, with the time each was put into the Trash. */
      items: { item: string; at: number }[];
      /** Versions removed from living records (earlier versions of current files). */
      livingVersions: number;
      /** Versions removed from records in the Trash (their older versions). */
      trashVersions: number;
    }
  | { kind: 'thin'; file: string; removed: number }
  | { kind: 'not-admitted'; half: Half; incoming: number }
  | { kind: 'pushed-out'; file: string; kept: boolean }
  | { kind: 'moved-back'; file: string; copyKept: boolean; recordKept: boolean };

/** A version about to be kept: its content is already hashed and compressed (phase 1). */
export interface NewVersion {
  hash: string;
  size: number;
  content: ContentRecord;
  time: number;
  reason: VersionReason;
}

/** What pruning must leave alone. */
interface Protect {
  records?: ReadonlySet<string>;
  items?: ReadonlySet<string>;
}

/** A resumable position of pruning in the global pass (transactions of at most 500 records). */
export interface PruneCursor {
  step: 1 | 2;
  afterPlace: string | null;
  afterTime: TimeKey | null;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * One transaction's work: the totals it changes, the contents it may leave without a version
 * (deleted at the end if no version names them any more), and the helpers every plan shares.
 */
export class Work {
  private released = new Set<string>();
  private changed = false;
  /** Records touched, for the record limit of the global pass. */
  touched = 0;

  private constructor(
    readonly tx: HistoryTx,
    readonly env: PlanEnv,
    readonly totals: Totals,
  ) {}

  static async start(tx: HistoryTx, env: PlanEnv): Promise<Work> {
    return new Work(tx, env, parseTotals(await tx.meta('totals')));
  }

  /** B / 2. */
  get limit(): number {
    return Math.floor(this.env.budget / 2);
  }

  /** Writes the totals and deletes every released content no version names (P3.3.5). */
  async finish(): Promise<void> {
    if (!this.changed) return;
    for (const hash of this.released) {
      if ((await this.tx.hashUsers(hash)) === 0) this.tx.deleteContent(hash);
    }
    this.released.clear();
    this.tx.putMeta('totals', { versions: this.totals.versions, trash: this.totals.trash });
    this.changed = false;
  }

  private put(id: string, record: FileRecord): void {
    this.changed = true;
    this.tx.putFile(id, record);
  }

  private count(half: Half, delta: number): void {
    this.changed = true;
    this.totals[half] += delta;
  }

  /** Keeps `version` as the newest of record `id` (null: a new living record of `place`). */
  async addVersion(
    id: string | null,
    record: FileRecord | null,
    place: string,
    spelling: VPath,
    version: NewVersion,
  ): Promise<{ id: string; record: FileRecord }> {
    const fileId = id ?? this.env.newId();
    const rec: FileRecord = record
      ? { ...record }
      : { place, live: place, spelling, newestSeq: 0, newestHash: '', lastSeq: 0, count: 0, bytes: RECORD_BYTES };
    if (!record) this.count('versions', RECORD_BYTES);
    if (!(await this.tx.hasContent(version.hash))) this.tx.putContent(version.hash, version.content);
    const seq = rec.lastSeq + 1;
    const stored: VersionRecord = {
      file: fileId,
      seq,
      time: version.time,
      hash: version.hash,
      size: version.size,
      stored: version.content.stored,
      reason: version.reason,
    };
    this.tx.putVersion(stored);
    rec.newestSeq = seq;
    rec.newestHash = version.hash;
    rec.lastSeq = seq;
    rec.count += 1;
    rec.bytes += countedVersion(stored);
    if (!rec.trash) rec.spelling = spelling;
    this.count(halfOfVersion(rec, seq), countedVersion(stored));
    this.put(fileId, rec);
    return { id: fileId, record: rec };
  }

  /**
   * Removes the versions `remove` of record `id`, whose versions are `all`. A record left without a
   * version is deleted unless `keepRecord` (it is about to get one). Returns the record, or null.
   */
  removeVersions(
    id: string,
    record: FileRecord,
    all: readonly VersionRecord[],
    remove: ReadonlySet<number>,
    keepRecord = false,
  ): FileRecord | null {
    if (remove.size === 0) return record;
    if (record.trash && remove.has(record.newestSeq)) {
      throw new Error('internal error: the copy of a record in the Trash goes only with its record');
    }
    const rec = { ...record };
    const rest: VersionRecord[] = [];
    for (const v of all) {
      if (!remove.has(v.seq)) {
        rest.push(v);
        continue;
      }
      this.tx.deleteVersion(id, v.seq);
      rec.count -= 1;
      rec.bytes -= countedVersion(v);
      this.count(halfOfVersion(rec, v.seq), -countedVersion(v));
      this.released.add(v.hash);
    }
    if (remove.has(rec.newestSeq)) {
      const newest = rest.reduce<VersionRecord | null>((best, v) => (!best || v.seq > best.seq ? v : best), null);
      rec.newestSeq = newest ? newest.seq : rec.newestSeq;
      rec.newestHash = newest ? newest.hash : '';
    }
    if (rec.count === 0 && !keepRecord) {
      this.deleteRecordOnly(id, rec);
      return null;
    }
    this.put(id, rec);
    return rec;
  }

  /** Deletes a record that has no version left. */
  private deleteRecordOnly(id: string, record: FileRecord): void {
    this.count(record.trash ? 'trash' : 'versions', -RECORD_BYTES);
    this.changed = true;
    this.tx.deleteFile(id);
  }

  /** Deletes a record with all its versions and every content no other version names (P3.3.5). */
  async dropRecord(id: string, record: FileRecord): Promise<{ versions: number }> {
    const versions = await this.tx.versions(id);
    for (const v of versions) {
      this.tx.deleteVersion(id, v.seq);
      this.count(halfOfVersion(record, v.seq), -countedVersion(v));
      this.released.add(v.hash);
    }
    this.deleteRecordOnly(id, record);
    this.touched++;
    return { versions: versions.length };
  }

  /** Deletes every record of a Trash item with its versions. */
  async dropItem(item: string): Promise<{ records: number; versions: number }> {
    let versions = 0;
    const records = await this.tx.item(item);
    for (const { id, value } of records) versions += (await this.dropRecord(id, value)).versions;
    return { records: records.length, versions };
  }

  /** The schedule and the cap on one record, after a version was kept for it (P3.3.4). */
  async thin(id: string, record: FileRecord): Promise<FileRecord | null> {
    const versions = await this.tx.versions(id);
    const keep = scheduleKeep(versions, this.env.now, record.newestSeq);
    if (keep.size >= versions.length) return record;
    const remove = new Set(versions.filter((v) => !keep.has(v.seq)).map((v) => v.seq));
    this.env.log?.({ kind: 'thin', file: id, removed: remove.size });
    return this.removeVersions(id, record, versions, remove, true);
  }

  /** Moves a living record into the Trash with its newest version as its copy. */
  async toTrash(id: string, record: FileRecord, mark: TrashMark): Promise<FileRecord> {
    const copy = record.count > 0 ? await this.tx.version(id, record.newestSeq) : null;
    const moved = RECORD_BYTES + (copy ? countedVersion(copy) : 0);
    this.count('versions', -moved);
    this.count('trash', moved);
    const { live: _live, ...rest } = record;
    const rec: FileRecord = { ...rest, trash: mark };
    this.put(id, rec);
    return rec;
  }

  /**
   * Admission (P3.3.4): true when `incoming` more counted bytes fit into `half`, after pruning it
   * down to 0.9 x B / 2 with the change included when they would not. It first finds out whether
   * they can fit at all, with everything it may prune gone; when they cannot, it prunes nothing
   * and keeps nothing (decided by the architect, D-e, errata N3: earlier versions and Trash items
   * are never removed for a change that is not kept in the end).
   */
  async admit(half: Half, incoming: number, protect: Protect = {}): Promise<boolean> {
    if (this.totals[half] + incoming <= this.limit) return true;
    const fits =
      incoming <= this.limit &&
      (half === 'versions' ? await this.versionsCanFit(incoming, protect) : await this.trashCanFit(incoming, protect));
    if (fits) {
      const target = Math.max(0, Math.floor(PRUNE_TO * this.limit) - incoming);
      if (half === 'trash') await this.pruneTrash(target, protect, 'admission');
      else await this.pruneVersions(target, protect, 'admission');
    }
    const admitted = this.totals[half] + incoming <= this.limit;
    if (!admitted) this.env.log?.({ kind: 'not-admitted', half, incoming });
    return admitted;
  }

  /**
   * True when the versions half could take `incoming` if every version pruning may remove went
   * (pruneVersions): every version counted there goes, and with its last version every living
   * record but a protected one, which keeps its record (128 bytes) and only that.
   */
  private async versionsCanFit(incoming: number, protect: Protect): Promise<boolean> {
    let kept = 0;
    for (const id of protect.records ?? NONE) {
      const record = await this.tx.file(id);
      if (record && !record.trash) kept += RECORD_BYTES;
    }
    return kept + incoming <= this.limit;
  }

  /** True when the Trash half could take `incoming` if every item it may prune went. */
  private async trashCanFit(incoming: number, protect: Protect): Promise<boolean> {
    let kept = 0;
    for (const item of groupItems(await this.tx.trashed())) {
      if (!this.prunable(item, protect)) kept += await this.itemBytes(item.records);
    }
    return kept + incoming <= this.limit;
  }

  /** The counted bytes of an item in the Trash half: its records and their copies. */
  async itemBytes(records: readonly Keyed<FileRecord>[]): Promise<number> {
    let bytes = 0;
    for (const { id, value } of records) {
      bytes += RECORD_BYTES;
      if (value.count > 0) {
        const copy = await this.tx.version(id, value.newestSeq);
        if (copy) bytes += countedVersion(copy);
      }
    }
    return bytes;
  }

  private prunable(item: TrashGroup, protect: Protect): boolean {
    if (this.env.restoring.has(item.item) || (protect.items ?? NONE).has(item.item)) return false;
    return !item.records.some(({ value }) => value.trash?.pending && this.env.honored(value.trash.pending, item.item));
  }

  /** Prunes the Trash half, oldest item first, whole, until it holds at most `target`. */
  async pruneTrash(target: number, protect: Protect, by: PruneCause, maxRecords = Infinity): Promise<boolean> {
    if (this.totals.trash <= target) return true;
    const dropped: { item: string; at: number }[] = [];
    let versions = 0;
    let done = false;
    for (const item of groupItems(await this.tx.trashed())) {
      if (this.totals.trash <= target) {
        done = true;
        break;
      }
      if (this.touched >= maxRecords) break;
      if (!this.prunable(item, protect)) continue;
      versions += (await this.dropItem(item.item)).versions;
      dropped.push({ item: item.item, at: item.at });
    }
    if (this.totals.trash <= target) done = true;
    if (dropped.length > 0) {
      this.env.log?.({ kind: 'prune', half: 'trash', by, items: dropped, livingVersions: 0, trashVersions: versions });
    }
    return done || this.touched < maxRecords;
  }

  /**
   * Prunes the versions half until it holds at most `target`: (1) the widened schedule on every
   * living record, (2) the oldest versions of the half (P3.3.4). Returns true when it got there or
   * ran out of versions, false when it stopped at `maxRecords` (the cursor says where it was).
   */
  async pruneVersions(
    target: number,
    protect: Protect,
    by: PruneCause,
    maxRecords = Infinity,
    cursor: PruneCursor = { step: 1, afterPlace: null, afterTime: null },
  ): Promise<boolean> {
    if (this.totals.versions <= target) return true;
    const own = protect.records ?? NONE;
    let living = 0;
    let trashed = 0;
    const report = () => {
      if (living + trashed > 0) {
        this.env.log?.({
          kind: 'prune',
          half: 'versions',
          by,
          items: [],
          livingVersions: living,
          trashVersions: trashed,
        });
      }
    };
    if (cursor.step === 1) {
      for (;;) {
        const page = await this.tx.livingPage(cursor.afterPlace, 50);
        if (page.length === 0) break;
        for (const { id, value } of page) {
          if (this.touched >= maxRecords) {
            report();
            return false;
          }
          cursor.afterPlace = value.place;
          const versions = await this.tx.versions(id);
          const keep = widenedKeep(versions, this.env.now, value.newestSeq);
          if (keep.size < versions.length) {
            const remove = new Set(versions.filter((v) => !keep.has(v.seq)).map((v) => v.seq));
            this.removeVersions(id, value, versions, remove, true);
            living += remove.size;
            this.touched++;
          }
        }
      }
      cursor.step = 2;
      if (this.totals.versions <= target) {
        report();
        return true;
      }
    }
    for (;;) {
      const page = await this.tx.versionsByTime(cursor.afterTime, 100);
      if (page.length === 0) break;
      for (const v of page) {
        if (this.totals.versions <= target) {
          report();
          return true;
        }
        if (this.touched >= maxRecords) {
          report();
          return false;
        }
        cursor.afterTime = timeKey(v);
        const rec = await this.tx.file(v.file);
        if (!rec || (rec.trash && v.seq === rec.newestSeq)) continue; // a copy counts in the Trash half
        const all = v.seq === rec.newestSeq ? await this.tx.versions(v.file) : [v];
        this.removeVersions(v.file, rec, all, new Set([v.seq]), own.has(v.file));
        if (rec.trash) trashed++;
        else living++;
        this.touched++;
      }
    }
    report();
    return true;
  }

  /**
   * A living record pushed out of its place by `moved` or a restore goes into the Trash as
   * `Replaced` with its newest version as its copy (P3.3.5). Its copy passes Trash admission; when
   * it does not fit, the record is dropped with its versions: its file is gone already (open case 1).
   */
  async pushOut(id: string, record: FileRecord, protect: Protect): Promise<void> {
    if (record.count === 0) {
      await this.dropRecord(id, record);
      return;
    }
    const copy = await this.tx.version(id, record.newestSeq);
    const incoming = RECORD_BYTES + (copy ? countedVersion(copy) : 0);
    const records = new Set([...(protect.records ?? NONE), id]);
    if (!(await this.admit('trash', incoming, { ...protect, records }))) {
      this.env.log?.({ kind: 'pushed-out', file: id, kept: false });
      const current = await this.tx.file(id);
      if (current) await this.dropRecord(id, current);
      return;
    }
    const current = (await this.tx.file(id)) ?? record;
    await this.toTrash(id, current, {
      item: this.env.newId(),
      at: this.env.now,
      cause: 'replaced',
      path: current.spelling,
    });
    this.env.log?.({ kind: 'pushed-out', file: id, kept: true });
  }

  /**
   * A record in the Trash becomes living at `place` (a restore, or guard giving a place back): its
   * copy moves back to the versions half by admission (P3.3.4). A copy above 1 MB or without room is
   * dropped and the record still becomes living; a record left without versions is deleted (open
   * case 4); when not even the record fits, it is dropped with its older versions.
   */
  async moveBack(id: string, record: FileRecord, place: string, spelling: VPath, protect: Protect): Promise<void> {
    const item = record.trash?.item;
    const items = new Set([...(protect.items ?? NONE), ...(item ? [item] : [])]);
    const records = new Set([...(protect.records ?? NONE), id]);
    const guard: Protect = { items, records };
    const copy = record.count > 0 ? await this.tx.version(id, record.newestSeq) : null;
    const copyBytes = copy ? countedVersion(copy) : 0;
    this.count('trash', -(RECORD_BYTES + copyBytes));
    const copyKept =
      !!copy && copy.size <= LARGEST_VERSION && (await this.admit('versions', RECORD_BYTES + copyBytes, guard));
    const current = (await this.tx.file(id)) ?? record;
    const { trash: _trash, ...rest } = current;
    let rec: FileRecord = { ...rest, place, live: place, spelling };
    if (copyKept) {
      this.count('versions', RECORD_BYTES + copyBytes);
      this.put(id, rec);
      this.env.log?.({ kind: 'moved-back', file: id, copyKept: true, recordKept: true });
      return;
    }
    if (copy) {
      // The copy was counted nowhere since it left the Trash half: remove it without counting.
      this.tx.deleteVersion(id, copy.seq);
      this.released.add(copy.hash);
      this.changed = true;
      const rest2 = (await this.tx.versions(id)).filter((v) => v.seq !== copy.seq);
      const newest = rest2.reduce<VersionRecord | null>((best, v) => (!best || v.seq > best.seq ? v : best), null);
      rec = {
        ...rec,
        count: rec.count - 1,
        bytes: rec.bytes - copyBytes,
        newestSeq: newest ? newest.seq : rec.newestSeq,
        newestHash: newest ? newest.hash : '',
      };
    }
    if (rec.count === 0) {
      // Open case 4: a living record without versions is not kept.
      this.changed = true;
      this.tx.deleteFile(id);
      this.env.log?.({ kind: 'moved-back', file: id, copyKept: false, recordKept: false });
      return;
    }
    if (await this.admit('versions', RECORD_BYTES, guard)) {
      this.count('versions', RECORD_BYTES);
      this.put(id, rec);
      this.env.log?.({ kind: 'moved-back', file: id, copyKept: false, recordKept: true });
      return;
    }
    // Not even the record fits: its older versions (counted in the versions half) go with it.
    for (const v of await this.tx.versions(id)) {
      this.tx.deleteVersion(id, v.seq);
      this.count('versions', -countedVersion(v));
      this.released.add(v.hash);
    }
    this.changed = true;
    this.tx.deleteFile(id);
    this.env.log?.({ kind: 'moved-back', file: id, copyKept: false, recordKept: false });
  }

  /** Writes a record as it is (a changed mark). */
  rewrite(id: string, record: FileRecord): void {
    this.put(id, record);
  }
}

/** The records of the Trash grouped into items, oldest item first. */
export interface TrashGroup {
  item: string;
  at: number;
  records: Keyed<FileRecord>[];
}

export function groupItems(records: readonly Keyed<FileRecord>[]): TrashGroup[] {
  const groups = new Map<string, TrashGroup>();
  for (const record of records) {
    const mark = record.value.trash;
    if (!mark) continue;
    let group = groups.get(mark.item);
    if (!group) {
      group = { item: mark.item, at: mark.at, records: [] };
      groups.set(mark.item, group);
    }
    group.records.push(record);
    group.at = Math.min(group.at, mark.at);
  }
  return [...groups.values()].sort((a, b) => a.at - b.at || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0));
}

// ---- the plans ------------------------------------------------------------------------------------

export type RecordOutcome = 'kept' | 'same' | 'no-room';

/**
 * Keeps an automatic version (`saved`, `opened`, `before-import`), or the copy of
 * `guard('restore')` (`before-restore`), unless it equals its record's newest (P3.3.5). After a
 * kept version, the schedule and the cap on that record (P3.3.4).
 */
export async function planKeepVersion(
  tx: HistoryTx,
  env: PlanEnv,
  args: { place: string; spelling: VPath; version: NewVersion },
): Promise<RecordOutcome> {
  const work = await Work.start(tx, env);
  const live = await tx.living(args.place);
  if (live && live.value.newestHash === args.version.hash) return 'same';
  if (args.version.size > LARGEST_VERSION) return 'no-room';
  const incoming = countedVersion(args.version.content) + (live ? 0 : RECORD_BYTES);
  const admitted = await work.admit('versions', incoming, { records: new Set(live ? [live.id] : []) });
  if (!admitted) {
    await work.finish();
    return 'no-room';
  }
  const record = live ? await tx.file(live.id) : null;
  const kept = await work.addVersion(live && record ? live.id : null, record, args.place, args.spelling, args.version);
  await work.thin(kept.id, kept.record);
  await work.finish();
  return 'kept';
}

/** A file of a Delete or a Replace, as guard read it in phase 1. */
export interface GuardFile {
  place: string;
  spelling: VPath;
  version: NewVersion;
}

/**
 * Step 2 of guard for 'delete' and 'replace' (P3.3.4): one transaction keeps each file's bytes as a
 * version of its living record (a file without a record gets one) and puts these records, and one
 * for each empty folder, into the Trash as one item, each marked as pending for this window (open
 * case 2). Whole or not at all (D13). Returns false when the item does not fit.
 */
export async function planGuardKeep(
  tx: HistoryTx,
  env: PlanEnv,
  args: {
    item: string;
    path: VPath;
    cause: 'deleted' | 'replaced';
    files: readonly GuardFile[];
    dirs: readonly { place: string; spelling: VPath }[];
  },
): Promise<boolean> {
  const work = await Work.start(tx, env);
  const entries: { file: GuardFile; live: Keyed<FileRecord> | null; same: boolean }[] = [];
  let incoming = RECORD_BYTES * args.dirs.length;
  for (const file of args.files) {
    const live = await tx.living(file.place);
    const same = !!live && live.value.newestHash === file.version.hash;
    let copyBytes = countedVersion(file.version.content);
    if (same && live) {
      const newest = await tx.version(live.id, live.value.newestSeq);
      if (newest) copyBytes = countedVersion(newest);
    }
    incoming += RECORD_BYTES + copyBytes;
    entries.push({ file, live, same });
  }
  const records = new Set(entries.flatMap(({ live }) => (live ? [live.id] : [])));
  if (!(await work.admit('trash', incoming, { records }))) {
    await work.finish();
    return false;
  }
  const mark: TrashMark = {
    item: args.item,
    at: env.now,
    cause: args.cause,
    path: args.path,
    pending: { window: env.window, at: env.now },
  };
  for (const { file, live, same } of entries) {
    let id = live?.id ?? null;
    let record = live ? await tx.file(live.id) : null;
    if (live && !record) id = null;
    if (!same || !record || !id) {
      const kept = await work.addVersion(id, record, file.place, file.spelling, file.version);
      id = kept.id;
      record = kept.record;
    }
    // The path guard read is the file's spelling now (a move the history missed, an aborted
    // transaction, a change of letter case): a restore writes it back there.
    const trashed = await work.toTrash(id, { ...record, spelling: file.spelling }, { ...mark });
    await work.thin(id, trashed);
  }
  for (const dir of args.dirs) {
    const id = env.newId();
    work.rewrite(id, {
      place: dir.place,
      spelling: dir.spelling,
      newestSeq: 0,
      newestHash: '',
      lastSeq: 0,
      count: 0,
      bytes: RECORD_BYTES,
      dir: true,
      trash: { ...mark },
    });
    work.totals.trash += RECORD_BYTES;
  }
  await work.finish();
  return true;
}

/**
 * Step 4 of guard (P3.3.4), after `act` resolved or rejected: each record of the item whose file
 * `act` did not remove or overwrite gets its place back, unless a living record has taken it
 * meanwhile (an empty folder that still exists: its `dir` record is deleted); the pending marks of
 * this window are cleared.
 */
export async function planGuardSettle(
  tx: HistoryTx,
  env: PlanEnv,
  args: { item: string; untouched: ReadonlySet<string> },
): Promise<void> {
  const work = await Work.start(tx, env);
  for (const { id } of await tx.item(args.item)) {
    // Read each record again: a record moved back earlier in this loop passed admission, which may
    // have pruned older versions of this one (they count in the versions half); writing the record
    // as the item was first read would undo that count (seed 22043, errata N3).
    const value = await tx.file(id);
    if (!value) continue;
    const mark = value.trash;
    if (!mark) continue;
    if (args.untouched.has(value.place)) {
      if (value.dir) {
        await work.dropRecord(id, value);
        continue;
      }
      if (!(await tx.living(value.place))) {
        await work.moveBack(id, value, value.place, value.spelling, { items: new Set([args.item]) });
        continue;
      }
    }
    if (mark.pending) {
      const { pending: _pending, ...rest } = mark;
      work.rewrite(id, { ...value, trash: rest });
    }
  }
  await work.finish();
}

/**
 * Step 3 of guard after `Yes` without a copy (P3.3.4, D14): the living records of the files `act`
 * removed or overwrote are dropped with their versions, so that no older version of a file that is
 * gone passes to a new file at its place. Files `act` left alone keep their records (open case 5).
 */
export async function planDropLiving(tx: HistoryTx, env: PlanEnv, places: readonly string[]): Promise<void> {
  const work = await Work.start(tx, env);
  for (const place of places) {
    const live = await tx.living(place);
    if (live) await work.dropRecord(live.id, live.value);
  }
  await work.finish();
}

/**
 * `moved(from, to)` (P3.3.5): each living record at or below `from` takes the place below `to` and
 * the new spelling. When both give the same place (a change of letter case in the browser store),
 * only the spelling changes. A living record at a target place that is not itself moving goes into
 * the Trash first as `Replaced` (open case 1 for its admission).
 */
export async function planMoved(
  tx: HistoryTx,
  env: PlanEnv,
  args: { fromPlace: string; toPlace: string; to: VPath },
): Promise<number> {
  const work = await Work.start(tx, env);
  const moving: Keyed<FileRecord>[] = [];
  const at = await tx.living(args.fromPlace);
  if (at) moving.push(at);
  moving.push(...(await tx.livingFrom(childPrefix(args.fromPlace))));
  if (moving.length === 0) return 0;
  const target = (record: FileRecord) => {
    const suffix = record.place.slice(args.fromPlace.length);
    return {
      place: args.toPlace + suffix,
      spelling: args.to + record.spelling.slice(record.spelling.length - suffix.length),
    };
  };
  if (args.fromPlace === args.toPlace) {
    for (const { id, value } of moving) work.rewrite(id, { ...value, spelling: target(value).spelling });
    await work.finish();
    return moving.length;
  }
  // Free the places first, so that the unique index never sees two living records of one place.
  for (const { id, value } of moving) {
    const { live: _live, ...rest } = value;
    tx.putFile(id, rest as FileRecord);
  }
  const ids = new Set(moving.map(({ id }) => id));
  for (const { id, value } of moving) {
    const { place, spelling } = target(value);
    const occupant = await tx.living(place);
    if (occupant && !ids.has(occupant.id)) await work.pushOut(occupant.id, occupant.value, { records: ids });
    // Pruning leaves the moving records alone (they are protected, and step 1 sees only living
    // records), so `value` is still what is stored, apart from the place freed above.
    work.rewrite(id, { ...value, place, live: place, spelling });
  }
  await work.finish();
  return moving.length;
}

/**
 * A restore from the Trash, after the file was written (P3.3.5): the record becomes living at the
 * place written, its copy moving back by admission, but only while it is still in the item the
 * restore read. A living record that holds the place goes into the Trash first as `Replaced`.
 */
export async function planRestoreFile(
  tx: HistoryTx,
  env: PlanEnv,
  args: { record: string; item: string; place: string; spelling: VPath },
): Promise<'restored' | 'unchanged'> {
  const work = await Work.start(tx, env);
  const record = await tx.file(args.record);
  if (!record || record.trash?.item !== args.item || record.dir) return 'unchanged';
  const protect: Protect = { items: new Set([args.item]), records: new Set([args.record]) };
  const occupant = await tx.living(args.place);
  if (occupant && occupant.id !== args.record) await work.pushOut(occupant.id, occupant.value, protect);
  const current = (await tx.file(args.record)) ?? record;
  await work.moveBack(args.record, current, args.place, args.spelling, protect);
  await work.finish();
  return 'restored';
}

/** A restore created the folder of a `dir` record: the record is deleted (P3.3.5). */
export async function planRestoreDir(
  tx: HistoryTx,
  env: PlanEnv,
  args: { record: string; item: string },
): Promise<'restored' | 'unchanged'> {
  const work = await Work.start(tx, env);
  const record = await tx.file(args.record);
  if (!record || record.trash?.item !== args.item || !record.dir) return 'unchanged';
  await work.dropRecord(args.record, record);
  await work.finish();
  return 'restored';
}

/** `Delete for Good` and `Empty Trash` (P3.3.8): the items, their records and versions. */
export async function planDropItems(tx: HistoryTx, env: PlanEnv, items: readonly string[]): Promise<void> {
  const work = await Work.start(tx, env);
  for (const item of items) await work.dropItem(item);
  await work.finish();
}

/**
 * `Delete Earlier Versions` (P3.3.5), one batch: every version counted in the versions half goes;
 * each Trash record keeps its copy. Returns false when there is nothing left to do.
 */
export async function planClearVersions(tx: HistoryTx, env: PlanEnv, limit: number): Promise<boolean> {
  const work = await Work.start(tx, env);
  let touched = 0;
  for (const { id, value } of await tx.livingPage(null, limit)) {
    await work.dropRecord(id, value);
    touched++;
  }
  if (touched < limit) {
    for (const { id, value } of await tx.trashed()) {
      if (touched >= limit) break;
      if (value.count <= 1) continue;
      const versions = await tx.versions(id);
      work.removeVersions(
        id,
        value,
        versions,
        new Set(versions.filter((v) => v.seq !== value.newestSeq).map((v) => v.seq)),
      );
      touched++;
    }
  }
  await work.finish();
  return touched > 0;
}

/** The global pass (P3.3.4): drops the items older than 30 days, at most about `limit` records. */
export async function planExpireTrash(tx: HistoryTx, env: PlanEnv, limit: number): Promise<number> {
  const work = await Work.start(tx, env);
  const items: string[] = [];
  for (const { value } of await tx.trashedBefore(env.now - TRASH_AGE, limit)) {
    if (value.trash && !items.includes(value.trash.item)) items.push(value.trash.item);
  }
  let records = 0;
  for (const item of items) records += (await work.dropItem(item)).records;
  await work.finish();
  return records;
}

/**
 * The global pass (P3.3.4): drops the versions older than 60 days, except each living record's
 * newest (and each Trash record's copy), a record always with all its versions. Returns the cursor
 * to continue from, or null when done.
 */
export async function planExpireVersions(
  tx: HistoryTx,
  env: PlanEnv,
  after: TimeKey | null,
  limit: number,
): Promise<TimeKey | null> {
  const work = await Work.start(tx, env);
  const cutoff = env.now - VERSION_AGE;
  const page = await tx.versionsByTime(after, limit, cutoff);
  const files = [...new Set(page.map((v) => v.file))];
  for (const file of files) {
    const record = await tx.file(file);
    if (!record) continue;
    const versions = await tx.versions(file);
    const remove = new Set(versions.filter((v) => v.time < cutoff && v.seq !== record.newestSeq).map((v) => v.seq));
    work.removeVersions(file, record, versions, remove);
  }
  await work.finish();
  const last = page[page.length - 1];
  return page.length < limit || !last ? null : timeKey(last);
}

/**
 * The global pass: prunes `half` down to `target` (B fell, or the lowering when storage is tight),
 * touching at most `limit` records. Returns true when done.
 */
export async function planPruneHalf(
  tx: HistoryTx,
  env: PlanEnv,
  args: { half: Half; target: number; by: PruneCause; limit: number; cursor: PruneCursor },
): Promise<boolean> {
  const work = await Work.start(tx, env);
  const done =
    args.half === 'trash'
      ? await work.pruneTrash(args.target, {}, args.by, args.limit)
      : await work.pruneVersions(args.target, {}, args.by, args.limit, args.cursor);
  await work.finish();
  return done || work.totals[args.half] <= args.target;
}

/**
 * The notice of the lowering (P3.3.4), in the pass: a pass that sees free space above 64 MB arms
 * it; the first pass that finds storage tight while it is armed lowers each half to half of what it
 * holds, and clears it. Returns the targets of the lowering, or null when there is none.
 */
export async function planNotice(
  tx: HistoryTx,
  _env: PlanEnv,
  args: { tight: boolean; roomy: boolean; now: number },
): Promise<Totals | null> {
  const totals = parseTotals(await tx.meta('totals'));
  const stored = await tx.meta('notice');
  const notice: Notice = parseNotice(stored);
  if (args.roomy && !notice.armed) {
    tx.putMeta('notice', notice.halvedAt === undefined ? { armed: true } : { armed: true, halvedAt: notice.halvedAt });
    return null;
  }
  if (!args.tight || !notice.armed) return null;
  tx.putMeta('notice', { armed: false, halvedAt: args.now });
  return { versions: Math.floor(totals.versions / 2), trash: Math.floor(totals.trash / 2) };
}

/** Reads `meta` and fails when it does not parse (P3.3.7: the history is then unavailable). */
export async function planCheckMeta(tx: HistoryTx): Promise<{ totals: Totals; notice: Notice }> {
  return { totals: parseTotals(await tx.meta('totals')), notice: parseNotice(await tx.meta('notice')) };
}

/**
 * Clears the pending marks that no longer protect anything (a page closed between guard's keep and
 * its settle, or a settle that failed): the marks `stale` says so of.
 */
export async function planClearMarks(
  tx: HistoryTx,
  env: PlanEnv,
  stale: (mark: PendingMark, item: string) => boolean,
): Promise<number> {
  const work = await Work.start(tx, env);
  let cleared = 0;
  for (const { id, value } of await tx.trashed()) {
    const mark = value.trash;
    if (!mark?.pending || !stale(mark.pending, mark.item)) continue;
    const { pending: _pending, ...rest } = mark;
    work.rewrite(id, { ...value, trash: rest });
    cleared++;
  }
  await work.finish();
  return cleared;
}
