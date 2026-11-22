// The model test of the safety net (ARCHITECTURE-PLUS P3.3.1, P5 N3): seeded sequences of 200
// steps of the command driver of fs/history-model.ts, beside the reference model, with the seven
// properties checked after every step. Seeds 1 to 2,000 in CI, split over 4 processes that run at
// the same time (EASY68K_HISTORY_SEEDS and EASY68K_HISTORY_SHARDS override the count and the split;
// EASY68K_HISTORY_SEED=<n> runs one seed alone and prints its steps). On a failure the seed, the
// step and the sequence up to it are printed.
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
