// The stress runs of the history store (ARCHITECTURE-PLUS P5 N3, "stress"): long, seeded histories
// of saves and deletes on the real store (fs/history-db.ts over fake-indexeddb), with the pruning
// log of every transaction, checked after every operation. Each run prints its figures.
//
//   (a) 10,000 saves across 200 files over 90 simulated days in bursts, plus 500 deletes, B = 64 MB:
//       the typical-student figure that decides D4 (16 MB); a burst of 500 saves in one hour leaves
//       the versions of the week before untouched.
//   (b) run (a) with B = 4 MB.
//   (c) 200 files x 1 MB x 5 saves, 200 saves of one 1 MB file, and deletes of folders whose copies
//       count 5 MB each (B = 64 MB).
//   (d) run (a) with B lowered from 64 MB to 3.2 MB after 30 % of the saves (errata N3: below a quota of
//       32 MB storage is always tight, so B cannot be 2 MB while anything is kept).
//   (e) run (a) with storage made tight in the middle.
//
// It lives in core/history (N3's folder) rather than next to the store so that it runs in a worker
// of its own beside the unit tests and the model test. CI runs the numbers in full; elsewhere they are
// scaled to a tenth unless EASY68K_HISTORY_STRESS=<factor> says otherwise (1 = in full).

import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { Bytes, SeenFile, VPath } from '../../contracts';
import { createVfs } from '../../fs/vfs';
import { MemoryBackend } from '../../fs/memory-backend';
import { createMemoryHistoryStore } from '../../fs/history-memory';
import { editText, noiseBytes, readHistoryDatabase, seededRandom } from '../../fs/history-model';
import { DAY, HOUR, MB, MINUTE } from './limits';
import type { PlanEvent } from './plans';

const SCALE = Number(process.env.EASY68K_HISTORY_STRESS ?? (process.env.CI ? 1 : 0.1));
const n = (count: number) => Math.max(1, Math.round(count * SCALE));

const subtle = {
  digest: async (_: string, data: BufferSource) => {
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
    const out = createHash('sha256').update(bytes).digest();
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  },
} as unknown as SubtleCrypto;

class SyncCompression {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<BufferSource>;
  constructor() {
    const parts: Uint8Array[] = [];
    const stream = new TransformStream<BufferSource, Uint8Array>({
      transform: (chunk) => void parts.push(new Uint8Array(ArrayBuffer.isView(chunk) ? chunk.buffer : chunk)),
      flush: (controller) => controller.enqueue(new Uint8Array(deflateRawSync(Buffer.concat(parts)))),
    });
    this.readable = stream.readable;
    this.writable = stream.writable;
  }
}

interface Op {
  kind: 'save' | 'delete' | 'pass';
}

/** A world: a memory Vfs, a fake clock, the store, and the pruning log of the operation running. */
function world(quota: number | undefined) {
  let now = Date.UTC(2026, 8, 1, 18, 0, 0);
  let fileTime = now;
  const vfs = createVfs();
  vfs.mount(new MemoryBackend({ mount: 'browser', kind: 'browser', label: 'My Programs', now: () => ++fileTime }));
  const env = { quota, usage: 0 };
  const log: { op: Op['kind']; event: PlanEvent }[] = [];
  let current: Op['kind'] = 'save';
  const clock = { now: () => now, wallTime: () => new Date(now) };
  const factory = new IDBFactory();
  const store = createMemoryHistoryStore(
    {
      vfs,
      clock,
      scheduler: { setTimer: () => () => {}, onFrame: () => () => {} },
      factory,
      subtle,
      compression: { CompressionStream: SyncCompression as never, DecompressionStream: globalThis.DecompressionStream },
      estimate: async () => (env.quota === undefined ? {} : { quota: env.quota, usage: env.usage }),
    },
    {
      schedulePass: false,
      log: (event) => log.push({ op: current, event }),
      newId: (() => {
        let id = 0;
        return () => `r${++id}`;
      })(),
    },
  );
  return {
    vfs,
    store,
    factory,
    env,
    log,
    get now() {
      return now;
    },
    advance(ms: number) {
      now += ms;
    },
    set op(kind: Op['kind']) {
      current = kind;
    },
  };
}

type World = ReturnType<typeof world>;

/** What every run checks after every operation, and counts. */
class Checks {
  prunes = { versions: 0, trash: 0 };
  /** What the prunings removed: versions (of living records and of records in the Trash), items. */
  pruned = { versions: 0, items: 0 };
  /** From which operation on the halves must be at most B / 2 again (run d). */
  boundFrom = 0;
  ops = 0;
  /** Storage is tight: nothing new may be kept from now on (run e). */
  tight = false;
  /** Passes that lowered each half while storage was tight (run e). */
  lowerings = { versions: 0, trash: 0 };
  private last = { versions: Infinity, items: Infinity };
  failures: string[] = [];
  private oldestTrash = -Infinity;

  constructor(private readonly w: World) {}

  async after(kind: Op['kind'], path?: VPath) {
    this.ops++;
    const fail = (text: string) => {
      if (this.failures.length < 10) this.failures.push(`op ${this.ops} (${kind}): ${text}`);
    };
    const lowered = { versions: false, trash: false };
    for (const { op, event } of this.w.log.splice(0)) {
      if (event.kind !== 'prune') continue;
      if (event.by === 'lower') lowered[event.half] = true;
      this.prunes[event.half]++;
      this.pruned.versions += event.livingVersions + event.trashVersions;
      this.pruned.items += event.items.length;
      if (op === 'save' && event.items.length > 0) fail('a save removed a Trash item');
      if (op === 'delete' && event.livingVersions > 0) fail('a delete removed an earlier version');
      for (const item of event.items) {
        // The Trash lost items only oldest first (the times of the items it dropped never go back).
        if (item.at < this.oldestTrash)
          fail(`the Trash dropped an item of ${item.at} after one of ${this.oldestTrash}`);
        this.oldestTrash = Math.max(this.oldestTrash, item.at);
      }
    }
    if (lowered.versions) this.lowerings.versions++;
    if (lowered.trash) this.lowerings.trash++;
    const usage = await this.w.store.usage();
    if (this.tight) {
      if (usage.versions > this.last.versions) fail('a version was kept while storage was tight');
      if (usage.trashItems > this.last.items) fail('a Trash item was kept while storage was tight');
      this.last = { versions: usage.versions, items: usage.trashItems };
    }
    if (this.ops >= this.boundFrom) {
      if (usage.versionBytes > usage.budget / 2)
        fail(`the versions half holds ${usage.versionBytes} > B / 2 = ${usage.budget / 2}`);
      if (usage.trashBytes > usage.budget / 2)
        fail(`the Trash half holds ${usage.trashBytes} > B / 2 = ${usage.budget / 2}`);
    }
    if (path && kind === 'save') {
      const count = (await this.w.store.versions(path)).length;
      if (count > 200) fail(`"${path}" has ${count} versions`);
    }
  }
}

/** Bytes that do not compress and have no zero byte (so that they get versions, P3.3.3). */
function incompressible(random: () => number, size: number): Bytes {
  const out = noiseBytes(random, size);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) | 1;
  return out;
}

/**
 * A source of about `size` bytes that compresses about as the corpus does (P3.3.6: median ratio
 * 3.8): labels, numbers and comments vary from line to line.
 */
function source(random: () => number, size: number): Bytes {
  const ops = ['MOVE.L', 'MOVE.B', 'ADD.W', 'SUB.L', 'CMP.B', 'BEQ', 'BNE', 'BRA', 'LEA', 'JSR', 'TRAP', 'DBRA'];
  const words = ['loop', 'next', 'value', 'count', 'print', 'table', 'done', 'check', 'buffer', 'result'];
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)] as T;
  let out = '';
  while (out.length < size) {
    const label = random() < 0.2 ? `${pick(words)}${Math.floor(random() * 100)}:` : '';
    const operand = `#$${Math.floor(random() * 65536)
      .toString(16)
      .toUpperCase()},D${Math.floor(random() * 8)}`;
    const comment = random() < 0.5 ? `\t* ${pick(words)} ${pick(words)} ${Math.floor(random() * 1000)}` : '';
    out += `${label}\t${pick(ops)}\t${operand}${comment}\r\n`;
  }
  return new TextEncoder().encode(out.slice(0, size));
}

/** P3.2.2's remove: the unchanged files of `seen`, then empty folders. */
function remover(w: World, root: VPath) {
  return async (seen: readonly SeenFile[]) => {
    for (const file of seen) {
      const now = await w.vfs.stat(file.path);
      if (now && now.mtime === file.mtime && now.size === file.size) await w.vfs.remove(file.path);
    }
    const stat = await w.vfs.stat(root);
    if (stat?.kind === 'dir') await w.vfs.remove(root).catch(() => {});
  };
}

interface StudentRun {
  quota: number | undefined;
  /** At this share of the saves: lower B (the quota) or make storage tight. */
  middle?: { at: number; quota?: number; tight?: boolean };
}

/** Run (a) and its variants: bursts of saves over 90 days, deletes in between. */
async function student(run: StudentRun) {
  const w = world(run.quota);
  const checks = new Checks(w);
  const random = seededRandom(17);
  const files = Array.from({ length: 200 }, (_, i) => `/browser/course/w${Math.floor(i / 10)}/f${i}.X68` as VPath);
  const big = new Set(files.filter(() => random() < 0.05));
  const contents = new Map<VPath, Bytes>();
  const saves = n(10_000);
  const deletes = n(500);
  let saved = 0;
  let deleted = 0;
  let tightSeen = false;
  const start = w.now;
  let pass = 0;
  const globalPass = async () => {
    w.op = 'pass';
    await w.store.globalPass();
    pass++;
    await checks.after('pass');
  };
  while (saved < saves) {
    // An evening of 50 to 500 saves, then a gap of up to 10 days (P5 N3).
    const evening = 50 + Math.floor(random() * 451);
    await globalPass();
    for (let i = 0; i < evening && saved < saves; i++) {
      if (run.middle && saved === Math.floor(saves * run.middle.at)) {
        if (run.middle.quota !== undefined) {
          w.env.quota = run.middle.quota;
          checks.boundFrom = Infinity;
          await globalPass();
          checks.boundFrom = checks.ops; // from the end of the first pass after the drop
          checks.prunes = { versions: 0, trash: 0 };
        }
        if (run.middle.tight) {
          w.env.usage = (w.env.quota ?? 1000 * MB) - 10 * MB;
          tightSeen = true;
          checks.tight = true;
        }
      }
      const path = files[Math.floor(random() ** 1.5 * files.length)] as VPath;
      const old = contents.get(path);
      const data = big.has(path)
        ? incompressible(random, (0.5 + random() / 2) * MB)
        : old && random() < 0.95
          ? editText(random, old)
          : source(random, 2_000 + Math.floor(random() * 44_000));
      w.op = 'save';
      await w.vfs.writeFile(path, data);
      contents.set(path, data);
      await w.store.record(path, data, 'saved', w.now);
      saved++;
      await checks.after('save', path);
      if (random() < (deletes - deleted) / Math.max(1, saves - saved) && deleted < deletes) {
        // A file, or a folder of 5 to 20 files.
        const target = random() < 0.5 ? `/browser/course/old${deleted}` : path;
        if (target !== path) {
          const count = 5 + Math.floor(random() * 16);
          for (let k = 0; k < count; k++)
            await w.vfs.writeFile(`${target}/x${k}.X68`, source(random, 2_000 + Math.floor(random() * 44_000)));
        }
        w.op = 'delete';
        const result = await w.store.guard(target, 'delete', remover(w, target), async () => true);
        if (target === path) contents.delete(path);
        deleted++;
        await checks.after('delete');
        void result;
      }
      w.advance(Math.floor(random() * 3 * MINUTE));
      if (i % 40 === 39) await globalPass();
    }
    // Gaps of up to 10 days, scaled so that the evenings (about 275 saves each) span 90 days; the
    // clock never goes back.
    const average = (90 * DAY) / Math.max(1, saves / 275);
    const gap = Math.min(10 * DAY, Math.floor(random() * 2 * average) + 12 * HOUR);
    w.advance(Math.max(HOUR, Math.min(gap, start + 90 * DAY - w.now)));
  }
  await globalPass();
  return { w, checks, saved, deleted, passes: pass, tightSeen, files, start };
}

/**
 * The parts of run (a)'s figure, read from the database (for the owner's decision of D4, errata N3
 * "The typical-student figure"): each half's versions by kind of file (the 5 % of files of 0.5 to
 * 1 MB that do not compress, and the sources), with the ages of the earlier versions kept.
 */
async function figureParts(w: World): Promise<string> {
  const db = await readHistoryDatabase(w.factory);
  const half = {
    versions: { big: { n: 0, bytes: 0 }, sources: { n: 0, bytes: 0 } },
    trash: { big: { n: 0, bytes: 0 }, sources: { n: 0, bytes: 0 } },
  };
  const ages = { big: [] as number[], sources: [] as number[] };
  let records = { versions: 0, trash: 0 };
  for (const [id, record] of db.files) {
    if (record.trash) records = { ...records, trash: records.trash + 1 };
    else records = { ...records, versions: records.versions + 1 };
    for (const v of db.versions.get(id) ?? []) {
      const kind = v.size >= MB / 2 ? 'big' : 'sources';
      const inTrash = !!record.trash && v.seq === record.newestSeq;
      const part = half[inTrash ? 'trash' : 'versions'][kind];
      part.n++;
      part.bytes += v.stored + 128;
      if (!inTrash && v.seq !== record.newestSeq) ages[kind].push((w.now - v.time) / DAY);
    }
  }
  const mb = (bytes: number) => `${(bytes / MB).toFixed(2)} MB`;
  const span = (list: number[]) => {
    if (list.length === 0) return 'none';
    const by = (from: number, to: number) => list.filter((d) => d >= from && d < to).length;
    return (
      `${list.length} (under 1 day ${by(0, 1)}, 1 to 7 days ${by(1, 7)}, 7 to 60 days ${by(7, 60)}, ` +
      `over 60 days ${by(60, Infinity)}; the oldest ${Math.max(...list).toFixed(1)} days)`
    );
  };
  return (
    `versions half: files of 0.5 to 1 MB ${mb(half.versions.big.bytes)} (${half.versions.big.n} versions), ` +
    `sources ${mb(half.versions.sources.bytes)} (${half.versions.sources.n}), records ${mb(records.versions * 128)}; ` +
    `Trash half: files of 0.5 to 1 MB ${mb(half.trash.big.bytes)} (${half.trash.big.n} copies), ` +
    `sources ${mb(half.trash.sources.bytes)} (${half.trash.sources.n}), records ${mb(records.trash * 128)}; ` +
    `earlier versions of the sources ${span(ages.sources)}; of the files of 0.5 to 1 MB ${span(ages.big)}`
  );
}

describe('the stress runs of the history store (P5 N3)', () => {
  const timeout = 900_000;

  it(
    '(a) a student over 90 days, B = 64 MB; a burst leaves the week before untouched',
    async () => {
      const started = Date.now();
      const { w, checks, saved, deleted, start: startedAt } = await student({ quota: undefined });
      const usage = await w.store.usage();
      // The burst: 500 saves of one file in one hour, after a week of daily saves of it. In the
      // run's own store the oldest versions are pruned (B is full of the 1 MB files), so the burst is
      // measured on a store of its own, where only the schedule and the cap can remove anything.
      const b = world(undefined);
      const path = '/browser/burst/prog.X68' as VPath;
      let data: Bytes = new TextEncoder().encode('burst\r\n'.repeat(500));
      for (let day = 0; day < 14; day++) {
        data = editText(seededRandom(1000 + day), data);
        await b.vfs.writeFile(path, data);
        await b.store.record(path, data, 'saved', b.now);
        b.advance(DAY);
      }
      // Every version from before the burst: the daily versions of the week before (1 to 7 days
      // old) and of the week before that.
      const before = await b.store.versions(path);
      const weekBefore = before.filter((v) => b.now - v.time <= 7 * DAY);
      for (let i = 0; i < 500; i++) {
        data = editText(seededRandom(i + 1), data);
        await b.vfs.writeFile(path, data);
        await b.store.record(path, data, 'saved', b.now);
        b.advance(7_000);
      }
      const after = new Set((await b.store.versions(path)).map((v) => v.seq));
      const typical = usage.versionBytes + usage.trashBytes;
      console.log(
        `stress (a): ${saved} saves, ${deleted} deletes in ${((Date.now() - started) / 1000).toFixed(1)} s; ` +
          `versions half ${(usage.versionBytes / MB).toFixed(2)} MB (${usage.versions} versions), Trash half ${(usage.trashBytes / MB).toFixed(2)} MB ` +
          `(${usage.trashItems} items); the typical-student figure is ${(typical / MB).toFixed(2)} MB (D4: deltas above 16 MB); ` +
          `prunings ${JSON.stringify(checks.prunes)}; the burst kept ${before.filter((v) => after.has(v.seq)).length} of the ${before.length} ` +
          `daily versions from before it (${weekBefore.filter((v) => after.has(v.seq)).length} of ${weekBefore.length} of the week before)`,
      );
      console.log(
        `stress (a), the figure's parts after ${((w.now - startedAt) / DAY).toFixed(1)} days at B = ${(usage.budget / MB).toFixed(0)} MB: ` +
          `${await figureParts(w)}; the prunings removed ${checks.pruned.versions} versions and ${checks.pruned.items} items`,
      );
      expect(checks.failures).toEqual([]);
      expect(before.length).toBe(14);
      expect(weekBefore.length).toBe(7);
      expect(before.filter((v) => !after.has(v.seq)).map((v) => (b.now - v.time) / DAY)).toEqual([]);
    },
    timeout,
  );

  it(
    '(b) the same with B = 4 MB: both halves are pruned at least 50 times, at most once per tenth',
    async () => {
      const started = Date.now();
      const { w, checks } = await student({ quota: 40 * MB });
      const usage = await w.store.usage();
      console.log(
        `stress (b): in ${((Date.now() - started) / 1000).toFixed(1)} s; prunings ${JSON.stringify(checks.prunes)}; ` +
          `versions ${(usage.versionBytes / MB).toFixed(2)} MB, Trash ${(usage.trashBytes / MB).toFixed(2)} MB of B / 2 = ${(usage.budget / 2 / MB).toFixed(2)} MB`,
      );
      expect(checks.failures).toEqual([]);
      if (SCALE >= 1) {
        expect(checks.prunes.versions).toBeGreaterThanOrEqual(50);
        expect(checks.prunes.trash).toBeGreaterThanOrEqual(50);
      }
    },
    timeout,
  );

  it(
    '(c) 1 MB files: 1,000 saves, 200 saves of one file, and deletes of 5 MB folders',
    async () => {
      const started = Date.now();
      const w = world(undefined);
      const checks = new Checks(w);
      const random = seededRandom(5);
      for (let round = 0; round < 5; round++) {
        for (let i = 0; i < n(200); i++) {
          const path = `/browser/big/f${i}.bin.X68` as VPath;
          const data = incompressible(random, MB - 64);
          w.op = 'save';
          await w.vfs.writeFile(path, data);
          await w.store.record(path, data, 'saved', w.now);
          await checks.after('save', path);
          w.advance(MINUTE);
        }
      }
      for (let i = 0; i < n(200); i++) {
        const path = '/browser/big/one.X68' as VPath;
        const data = incompressible(random, MB - 64);
        w.op = 'save';
        await w.vfs.writeFile(path, data);
        await w.store.record(path, data, 'saved', w.now);
        await checks.after('save', path);
        w.advance(MINUTE);
      }
      // Folders whose copies count 5 MB each: five files of 1 MB that do not compress. With the rule
      // as built (pruning down to 0.9 x B / 2 with the change counted, open case 3) every second
      // delete after the sixth prunes once, so 120 deletes give the 50 prunings the run asks for.
      for (let i = 0; i < n(120); i++) {
        const folder = `/browser/del/d${i}` as VPath;
        for (let k = 0; k < 5; k++) await w.vfs.writeFile(`${folder}/p${k}.pdf`, noiseBytes(random, MB - 200));
        w.op = 'delete';
        await w.store.guard(folder, 'delete', remover(w, folder), async () => true);
        await checks.after('delete');
        w.advance(MINUTE);
      }
      const usage = await w.store.usage();
      console.log(
        `stress (c): in ${((Date.now() - started) / 1000).toFixed(1)} s; prunings ${JSON.stringify(checks.prunes)}; ` +
          `versions ${(usage.versionBytes / MB).toFixed(2)} MB, Trash ${(usage.trashBytes / MB).toFixed(2)} MB (${usage.trashItems} items)`,
      );
      expect(checks.failures).toEqual([]);
      if (SCALE >= 1) {
        expect(checks.prunes.versions).toBeGreaterThanOrEqual(50);
        expect(checks.prunes.trash).toBeGreaterThanOrEqual(50);
      }
    },
    timeout,
  );

  it(
    '(d) B lowered from 64 MB to 3.2 MB in the middle',
    async () => {
      const started = Date.now();
      const { w, checks } = await student({ quota: undefined, middle: { at: 0.3, quota: 32 * MB } });
      const usage = await w.store.usage();
      console.log(
        `stress (d): in ${((Date.now() - started) / 1000).toFixed(1)} s; prunings after the drop ${JSON.stringify(checks.prunes)}; ` +
          `versions ${(usage.versionBytes / MB).toFixed(2)} MB, Trash ${(usage.trashBytes / MB).toFixed(2)} MB of B / 2 = ${(usage.budget / 2 / MB).toFixed(2)} MB`,
      );
      expect(checks.failures).toEqual([]);
      if (SCALE >= 1) {
        expect(checks.prunes.versions).toBeGreaterThanOrEqual(50);
        expect(checks.prunes.trash).toBeGreaterThanOrEqual(50);
      }
    },
    timeout,
  );

  it(
    '(e) storage made tight in the middle: one lowering of each half, nothing kept after',
    async () => {
      const started = Date.now();
      const run = student({ quota: 1000 * MB, middle: { at: 0.5, tight: true } });
      const { w, checks, tightSeen } = await run;
      const usage = await w.store.usage();
      console.log(
        `stress (e): in ${((Date.now() - started) / 1000).toFixed(1)} s; state ${w.store.state()}; prunings ${JSON.stringify(checks.prunes)}; ` +
          `versions ${(usage.versionBytes / MB).toFixed(2)} MB, Trash ${(usage.trashBytes / MB).toFixed(2)} MB`,
      );
      console.log(`stress (e): lowerings while tight ${JSON.stringify(checks.lowerings)}`);
      expect(tightSeen).toBe(true);
      expect(checks.lowerings).toEqual({ versions: 1, trash: 1 });
      expect(w.store.state()).toBe('tight');
      expect(checks.failures).toEqual([]);
    },
    timeout,
  );
});
