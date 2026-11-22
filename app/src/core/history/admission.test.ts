// Admission finds out first whether a change can be kept at all (ARCHITECTURE-PLUS P3.3.4; decided
// by the architect, D-e, errata N3): when it cannot, nothing is pruned for it. Owner: N3.
//
// Work runs here on a HistoryTx over plain maps, with a budget far below what a browser gives, so
// that the 128 bytes a protected living record keeps (pruning removes its versions, never the
// record) decide whether the change fits. The store's own tests (fs/history-db.test.ts) cover the
// cases a browser's budget can reach.

import { describe, expect, it } from 'vitest';
import type { VPath } from '../../contracts';
import { RECORD_BYTES } from './limits';
import { Work, type PlanEnv, type PlanEvent } from './plans';
import type { ContentRecord, FileRecord, Totals, VersionRecord } from './records';
import type { HistoryTx, Keyed, TimeKey } from './store';

/** A HistoryTx over maps: what one transaction would see, its own writes included. */
function mapTx(files: Map<string, FileRecord>, versions: VersionRecord[], totals: Totals): HistoryTx {
  const contents = new Map<string, ContentRecord>();
  const meta = new Map<string, unknown>([['totals', totals]]);
  const keyed = (entries: [string, FileRecord][]): Keyed<FileRecord>[] => entries.map(([id, value]) => ({ id, value }));
  const living = () =>
    [...files].filter(([, r]) => r.live !== undefined).sort(([, a], [, b]) => (a.place < b.place ? -1 : 1));
  const byTime = () =>
    [...versions].sort((a, b) => a.time - b.time || (a.file < b.file ? -1 : a.file > b.file ? 1 : a.seq - b.seq));
  const after = (v: VersionRecord, key: TimeKey) =>
    v.time > key[0] || (v.time === key[0] && (v.file > key[1] || (v.file === key[1] && v.seq > key[2])));
  return {
    file: async (id) => files.get(id) ?? null,
    living: async (place) => keyed(living().filter(([, r]) => r.live === place))[0] ?? null,
    livingFrom: async (prefix) => keyed(living().filter(([, r]) => r.place.startsWith(prefix))),
    livingPage: async (afterPlace, limit) =>
      keyed(living().filter(([, r]) => afterPlace === null || r.place > afterPlace)).slice(0, limit),
    item: async (item) => keyed([...files].filter(([, r]) => r.trash?.item === item)),
    trashed: async () => keyed([...files].filter(([, r]) => r.trash).sort(([, a], [, b]) => a.trash!.at - b.trash!.at)),
    trashedBefore: async (before, limit) =>
      keyed([...files].filter(([, r]) => r.trash && r.trash.at < before)).slice(0, limit),
    putFile: (id, record) => void files.set(id, record),
    deleteFile: (id) => void files.delete(id),
    versions: async (file) => versions.filter((v) => v.file === file).sort((a, b) => a.seq - b.seq),
    version: async (file, seq) => versions.find((v) => v.file === file && v.seq === seq) ?? null,
    versionsByTime: async (key, limit, before) =>
      byTime()
        .filter((v) => (key === null || after(v, key)) && (before === undefined || v.time < before))
        .slice(0, limit),
    putVersion: (version) => void versions.push(version),
    deleteVersion: (file, seq) => {
      const index = versions.findIndex((v) => v.file === file && v.seq === seq);
      if (index >= 0) versions.splice(index, 1);
    },
    hashUsers: async (hash) => versions.filter((v) => v.hash === hash).length,
    versionCount: async () => versions.length,
    hasContent: async (hash) => contents.has(hash),
    content: async (hash) => contents.get(hash) ?? null,
    putContent: (hash, content) => void contents.set(hash, content),
    deleteContent: (hash) => void contents.delete(hash),
    meta: async (key) => meta.get(key),
    putMeta: (key, value) => void meta.set(key, value),
  };
}

/** `count` living records of one version of `stored` bytes each, ids `<prefix>0`, ... */
function living(prefix: string, count: number, stored: number, time: number) {
  const files: [string, FileRecord][] = [];
  const versions: VersionRecord[] = [];
  for (let i = 0; i < count; i++) {
    const id = `${prefix}${i}`;
    const place = `browser:/${prefix.toUpperCase()}${i}.X68`;
    files.push([
      id,
      {
        place,
        live: place,
        spelling: `/browser/${prefix}${i}.X68` as VPath,
        newestSeq: 1,
        newestHash: `${id}-1`,
        lastSeq: 1,
        count: 1,
        bytes: RECORD_BYTES + stored + RECORD_BYTES,
      },
    ]);
    versions.push({ file: id, seq: 1, time: time + i, hash: `${id}-1`, size: stored, stored, reason: 'saved' });
  }
  return { files, versions };
}

function world(protectedCount: number) {
  // B = 4,000 bytes, B / 2 = 2,000. Three other files, each 128 + 300 + 128 = 556 counted bytes;
  // `protectedCount` protected files, each 128 + 10 + 128 = 266.
  const others = living('o', 3, 300, 1_000);
  const mine = living('p', protectedCount, 10, 2_000);
  const files = new Map([...others.files, ...mine.files]);
  const versions = [...others.versions, ...mine.versions];
  const totals: Totals = { versions: 3 * 556 + protectedCount * 266, trash: 0 };
  const events: PlanEvent[] = [];
  const env: PlanEnv = {
    now: 10_000,
    budget: 4_000,
    window: 'w1',
    honored: () => false,
    restoring: new Set(),
    newId: () => 'new',
    log: (event) => events.push(event),
  };
  return { tx: mapTx(files, versions, totals), versions, events, env, protect: new Set(mine.files.map(([id]) => id)) };
}

describe('admission finds out first whether the change can be kept (P3.3.4, D-e)', () => {
  it('a change that cannot fit even with everything prunable gone prunes nothing and is not kept', async () => {
    // 12 protected living records keep 12 x 128 = 1,536 bytes; 1,536 + 600 > 2,000.
    const w = world(12);
    const work = await Work.start(w.tx, w.env);
    const before = w.versions.map((v) => `${v.file}/${v.seq}`).sort();
    expect(await work.admit('versions', 600, { records: w.protect })).toBe(false);
    // Nothing was pruned for it: every earlier version of every file is still there.
    expect(w.versions.map((v) => `${v.file}/${v.seq}`).sort()).toEqual(before);
    expect(w.events.filter((e) => e.kind === 'prune')).toEqual([]);
    expect(w.events).toEqual([{ kind: 'not-admitted', half: 'versions', incoming: 600 }]);
    expect(work.totals.versions).toBe(3 * 556 + 12 * 266);
  });

  it('a change that can fit is admitted after pruning, oldest first', async () => {
    // 2 protected living records keep 256 bytes; 256 + 600 <= 2,000.
    const w = world(2);
    const work = await Work.start(w.tx, w.env);
    expect(await work.admit('versions', 600, { records: w.protect })).toBe(true);
    expect(w.events.some((e) => e.kind === 'prune' && e.half === 'versions')).toBe(true);
    expect(work.totals.versions + 600).toBeLessThanOrEqual(2_000);
    // The protected records are still living.
    for (const id of w.protect) expect(await w.tx.file(id)).not.toBeNull();
  });

  it('the boundary: the protected records and the change exactly fill B / 2', async () => {
    // 4 x 128 = 512; 512 + 1,488 = 2,000: it fits.
    const w = world(4);
    const work = await Work.start(w.tx, w.env);
    expect(await work.admit('versions', 1_488, { records: w.protect })).toBe(true);
    const w2 = world(4);
    const work2 = await Work.start(w2.tx, w2.env);
    const before = w2.versions.length;
    expect(await work2.admit('versions', 1_489, { records: w2.protect })).toBe(false);
    expect(w2.versions.length).toBe(before);
  });
});
