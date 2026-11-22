// The model test of the safety net (ARCHITECTURE-PLUS P3.3.1, P5 N3): seeded sequences of 200
// steps of the command driver of fs/history-model.ts, beside the reference model, with the seven
// properties checked after every step. Seeds 1 to 2,000 in CI, split over 4 processes that run at
// the same time (EASY68K_HISTORY_SEEDS and EASY68K_HISTORY_SHARDS override the count and the split;
// EASY68K_HISTORY_SEED=<n> runs one seed alone and prints its steps; EASY68K_HISTORY_FIRST=<n> starts
// the range elsewhere, so that CI can run it in parts, docs/requests/N3-model-test-ci.md). Seeds
// outside that range that once failed run every time as named cases (REGRESSION_SEEDS). On a failure
// the seed, the step and the sequence up to it are printed; EASY68K_HISTORY_DEBUG=1 prints the
// database, the promises and the restores of every step as well.
//
// Hashing and compression are Node's, made synchronous (node:crypto, node:zlib) so that the order
// in which two windows' awaits interleave is the same on every run of a seed.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createHistoryStore, type HistoryDeps } from './history-db';
import { createChannelHub, createFakeLocks, createMemoryHistoryService, historyDatabaseOf } from './history-memory';
import { MODEL_CODEC, runModelSequence, type DriverStore, type DriverWorld } from './history-model';

const ONE = process.env.EASY68K_HISTORY_SEED ? Number(process.env.EASY68K_HISTORY_SEED) : null;
const SEEDS = ONE !== null ? 1 : Number(process.env.EASY68K_HISTORY_SEEDS ?? (process.env.CI ? 2000 : 20));
const CHILD = process.env.EASY68K_HISTORY_CHILD === '1';
const SHARDS = ONE !== null || CHILD ? 1 : Number(process.env.EASY68K_HISTORY_SHARDS ?? (process.env.CI ? 4 : 1));
const STEPS = Number(process.env.EASY68K_HISTORY_STEPS ?? 200);
const FIRST = ONE ?? Number(process.env.EASY68K_HISTORY_FIRST ?? 1);

/** SHA-256 that resolves in a microtask. */
const subtle = {
  digest: async (_algorithm: string, data: BufferSource) => {
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
    const out = createHash('sha256').update(bytes).digest();
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  },
} as unknown as SubtleCrypto;

/** deflate-raw in a TransformStream that answers in microtasks. */
class SyncCompression {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<BufferSource>;
  constructor(_format: string) {
    const parts: Uint8Array[] = [];
    const stream = new TransformStream<BufferSource, Uint8Array>({
      transform(chunk) {
        parts.push(
          ArrayBuffer.isView(chunk)
            ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
            : new Uint8Array(chunk),
        );
      },
      flush(controller) {
        controller.enqueue(new Uint8Array(deflateRawSync(Buffer.concat(parts))));
      },
    });
    this.readable = stream.readable;
    this.writable = stream.writable;
  }
}

/** inflate-raw in a TransformStream that answers in microtasks. */
class SyncDecompression {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<BufferSource>;
  constructor(_format: string) {
    const parts: Uint8Array[] = [];
    const stream = new TransformStream<BufferSource, Uint8Array>({
      transform(chunk) {
        parts.push(
          ArrayBuffer.isView(chunk)
            ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
            : new Uint8Array(chunk),
        );
      },
      flush(controller) {
        controller.enqueue(new Uint8Array(inflateRawSync(Buffer.concat(parts))));
      },
    });
    this.readable = stream.readable;
    this.writable = stream.writable;
  }
}

// The checker's hash and inflation: the same results, without the thread pool.
MODEL_CODEC.sha256 = async (data) => {
  const out = createHash('sha256').update(data).digest();
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
};
MODEL_CODEC.inflateRaw = (data) => new Uint8Array(inflateRawSync(data));

const never = { setTimer: () => () => {}, onFrame: () => () => {} };

/** Several windows on one database: the same locks and channel for every store of a factory. */
function windowsOn(factory: IDBFactory, compressed: boolean) {
  const locks = createFakeLocks();
  const hub = createChannelHub();
  let n = 0;
  let ids = 0;
  return (world: DriverWorld): DriverStore => {
    const deps: HistoryDeps = {
      vfs: world.storeVfs,
      settings: world.settings as never,
      clock: world.clock,
      scheduler: never,
      indexedDB: world.factory,
      IDBKeyRange,
      subtle,
      compression: compressed
        ? { CompressionStream: SyncCompression as never, DecompressionStream: SyncDecompression as never }
        : {},
      locks,
      channel: (name) => hub.open(name),
      estimate: async () => (world.quota === undefined ? {} : { quota: world.quota, usage: world.usage }),
    };
    void factory;
    return createHistoryStore(deps, {
      schedulePass: false,
      windowId: `w${++n}`,
      newId: () => `id${(++ids).toString().padStart(6, '0')}`,
    });
  };
}

async function runSeed(seed: number, mode: 'store' | 'memory') {
  const factory = new IDBFactory();
  let memory: ReturnType<typeof createMemoryHistoryService> | null = null;
  const trace: string[] = [];
  const result = await runModelSequence({
    seed,
    steps: STEPS,
    factory,
    windows: mode === 'store',
    ...(mode === 'memory' ? { database: () => historyDatabaseOf(memory as never) } : {}),
    openWindow:
      mode === 'store'
        ? windowsOn(factory, seed % 3 !== 0)
        : (world) => {
            memory = createMemoryHistoryService({
              vfs: world.storeVfs,
              clock: world.clock,
              scheduler: never,
              settings: world.settings as never,
              ...(world.quota === undefined ? {} : { quota: world.quota }),
            });
            return memory as unknown as DriverStore;
          },
    trace: (step, text) => trace.push(`${step}: ${text}`),
  });
  if (ONE !== null) console.log(trace.join('\n'));
  return { ...result, trace };
}

function report(seed: number, mode: string, result: Awaited<ReturnType<typeof runSeed>>): string {
  const failure = result.failure;
  if (!failure) return '';
  return [
    `seed ${seed} (${mode}) failed at step ${failure.step}: ${failure.text}`,
    ...failure.violations.map((v) => `  ${v}`),
    `run it alone: EASY68K_HISTORY_SEED=${seed} npx vitest run src/fs/history-model.test.ts`,
    'the sequence:',
    ...result.trace.slice(-40).map((line) => `  ${line}`),
  ].join('\n');
}

/** Runs this file in `shards` processes at once, each on its own range of seeds. */
function runShards(shards: number): Promise<{ code: number; out: string }[]> {
  // The package's bin (vitest.mjs) is not among its exports: found next to its main file.
  const main = createRequire(import.meta.url).resolve('vitest');
  const vitest = join(dirname(main), 'vitest.mjs');
  const per = Math.ceil(SEEDS / shards);
  return Promise.all(
    Array.from({ length: shards }, (_, i) => {
      const first = FIRST + i * per;
      const count = Math.max(0, Math.min(per, FIRST + SEEDS - first));
      return new Promise<{ code: number; out: string }>((resolve) => {
        const child = spawn(
          process.execPath,
          [vitest, 'run', 'src/fs/history-model.test.ts', '--maxWorkers=1', '--silent=false'],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              EASY68K_HISTORY_CHILD: '1',
              EASY68K_HISTORY_FIRST: String(first),
              EASY68K_HISTORY_SEEDS: String(count),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let out = '';
        child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
        child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()));
        child.on('close', (code) => resolve({ code: code ?? 1, out }));
      });
    }),
  );
}

describe.runIf(SHARDS > 1)('the model test of the safety net, in processes at once (P3.3.1)', () => {
  it(`${SEEDS} seeds x ${STEPS} steps in ${SHARDS} processes`, async () => {
    const started = Date.now();
    const results = await runShards(SHARDS);
    for (const { out } of results) {
      for (const line of out.split(/\r?\n/)) if (/^history model|^\+ (seed| {2})/.test(line)) console.log(line);
    }
    console.log(
      `history model: ${SEEDS} seeds in ${SHARDS} processes in ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
    const failed = results.filter((r) => r.code !== 0);
    expect(failed.map((r) => r.out.slice(-4000)).join('\n')).toBe('');
  }, 7_200_000);
});

/**
 * Seeds outside 1 to 2,000 that once failed (the second round of the gate, 2026-11-22; errata N3,
 * "What the model test found, second round of the gate"): each runs on every `npm test`, against
 * the store with two windows and faults, where it failed (of the 30 found before the repair, 14 were
 * defects of the store and 16 gaps of the model; 4063, found after it, a gap of the model; each label
 * says which). A choice added to the driver later must draw from its `later`
 * stream, or these seeds no longer replay the steps that failed.
 */
const ABORTED_MOVE = 'moved() met an aborted transaction and resolved; the history stayed at the old place (the store)';
const BESIDE_IN_FOLDER = 'a Trash restore into the folder chosen wrote beside a taken name there (the model)';
const HOLDER =
  "the version was held by the file's own record elsewhere (in the Trash, or living where a restore wrote it; the model)";
const SAME_BYTES = 'a Replace onto a file with the same bytes overwrote it, and guard had to keep it (the model)';
const REGRESSION_SEEDS: readonly [number, string][] = [
  [2217, HOLDER],
  [2738, ABORTED_MOVE],
  [2762, ABORTED_MOVE],
  [
    4063,
    // Since decision D-e (errata N3, third round of the gate) a rule of the model, not an exception
    // of the checker: a copy moving back that can be kept counts as admitted, one that cannot adds
    // nothing, and the store prunes nothing for it.
    "a Trash restore's copy that did not fit pruned the versions half and was then not kept (the model; found after the repair)",
  ],
  [4590, HOLDER],
  [4999, ABORTED_MOVE],
  [5097, ABORTED_MOVE],
  [7064, ABORTED_MOVE],
  [9397, BESIDE_IN_FOLDER],
  [9490, "a copy's identical bytes in the Trash hid the step that pruned the file's own version (the model)"],
  [10116, BESIDE_IN_FOLDER],
  [10189, ABORTED_MOVE],
  [10480, SAME_BYTES],
  [11106, ABORTED_MOVE],
  [11719, SAME_BYTES],
  [12022, ABORTED_MOVE],
  [12413, ABORTED_MOVE],
  [13319, ABORTED_MOVE],
  [14580, HOLDER],
  [15624, BESIDE_IN_FOLDER],
  [15844, HOLDER],
  [16765, ABORTED_MOVE],
  [16946, HOLDER],
  [17973, HOLDER],
  [19246, BESIDE_IN_FOLDER],
  [19390, HOLDER],
  [19531, ABORTED_MOVE],
  [20527, SAME_BYTES],
  [20540, HOLDER],
  [20602, ABORTED_MOVE],
  [21130, ABORTED_MOVE],
];

/** Seeds that failed against createMemoryHistoryService (found after the repair). */
const MEMORY_REGRESSION_SEEDS: readonly [number, string][] = [
  [3694, "a delete's own copies had left the versions half before its settle pruned it (the model)"],
  // Third round of the gate: failed about 1 run in 6 on a loaded machine (Node's own hashing and
  // compression make the order of the awaits vary); history-db.test.ts holds the case exactly.
  [
    22043,
    "guard's settle wrote records of the item as first read, after a copy's admission had pruned their older versions (the store)",
  ],
];

// They failed against createHistoryService (two windows, faults), and run there; the three the review
// named run against createMemoryHistoryService as well, and so do the seeds that failed there.
describe.runIf(ONE === null && !CHILD)('the model test: seeds that failed once (P3.3.1)', () => {
  const cases: [number, string, 'store' | 'memory'][] = [
    ...REGRESSION_SEEDS.map(([seed, what]) => [seed, what, 'store'] as [number, string, 'store']),
    ...REGRESSION_SEEDS.filter(([seed]) => [7064, 9397, 9490].includes(seed)).map(
      ([seed, what]) => [seed, what, 'memory'] as [number, string, 'memory'],
    ),
    ...MEMORY_REGRESSION_SEEDS.map(([seed, what]) => [seed, what, 'memory'] as [number, string, 'memory']),
  ];
  for (const [seed, what, mode] of cases) {
    it(`seed ${seed} (${mode}): ${what}`, async () => {
      const result = await runSeed(seed, mode);
      expect(report(seed, mode, result)).toBe('');
    }, 120_000);
  }
});

describe.runIf(SHARDS <= 1)('the model test of the safety net (P3.3.1)', () => {
  for (const mode of ['store', 'memory'] as const) {
    it(`${SEEDS} seeds x ${STEPS} steps hold the seven properties (${mode === 'store' ? 'createHistoryService, two windows, faults' : 'createMemoryHistoryService'})`, async () => {
      const started = Date.now();
      const totals: Record<string, number> = {};
      const failures: string[] = [];
      for (let seed = FIRST; seed < FIRST + SEEDS; seed++) {
        const result = await runSeed(seed, mode);
        for (const [key, value] of Object.entries(result.stats)) totals[key] = (totals[key] ?? 0) + value;
        if (result.failure) {
          failures.push(report(seed, mode, result));
          if (failures.length >= 3) break;
        }
      }
      console.log(
        `history model (${mode}): ${SEEDS} seeds x ${STEPS} steps in ${((Date.now() - started) / 1000).toFixed(1)} s; ` +
          Object.entries(totals)
            .sort()
            .map(([k, v]) => `${k} ${v}`)
            .join(', '),
      );
      expect(failures.join('\n\n')).toBe('');
    }, 3_600_000);
  }
});
