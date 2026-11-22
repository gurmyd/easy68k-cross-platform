// The model test of the safety net (ARCHITECTURE-PLUS P3.3.1, P5 N3): seeded sequences of 200
// steps of the command driver of fs/history-model.ts, beside the reference model, with the seven
// properties checked after every step. Seeds 1 to 2,000 in CI (EASY68K_HISTORY_SEEDS overrides the
// count; EASY68K_HISTORY_SEED=<n> runs one seed alone and prints its steps). On a failure the seed,
// the step and the sequence up to it are printed.
//
// Hashing and compression are Node's, made synchronous (node:crypto, node:zlib) so that the order
// in which two windows' awaits interleave is the same on every run of a seed.

import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createHistoryStore, type HistoryDeps } from './history-db';
import { createChannelHub, createFakeLocks, createMemoryHistoryService, historyDatabaseOf } from './history-memory';
import { runModelSequence, type DriverStore, type DriverWorld } from './history-model';

const ONE = process.env.EASY68K_HISTORY_SEED ? Number(process.env.EASY68K_HISTORY_SEED) : null;
const SEEDS = ONE !== null ? 1 : Number(process.env.EASY68K_HISTORY_SEEDS ?? (process.env.CI ? 2000 : 100));
const STEPS = Number(process.env.EASY68K_HISTORY_STEPS ?? 200);
const FIRST = ONE ?? 1;

/** SHA-256 that resolves in a microtask. */
const subtle = {
  digest: async (_algorithm: string, data: BufferSource) => {
    const bytes = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
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
        parts.push(ArrayBuffer.isView(chunk) ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength) : new Uint8Array(chunk));
      },
      flush(controller) {
        controller.enqueue(new Uint8Array(deflateRawSync(Buffer.concat(parts))));
      },
    });
    this.readable = stream.readable;
    this.writable = stream.writable;
  }
}

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
        ? { CompressionStream: SyncCompression as never, DecompressionStream: globalThis.DecompressionStream }
        : {},
      locks,
      channel: (name) => hub.open(name),
      estimate: async () => (world.quota === undefined ? {} : { quota: world.quota, usage: world.usage }),
    };
    void factory;
    return createHistoryStore(deps, { schedulePass: false, windowId: `w${++n}`, newId: () => `id${(++ids).toString().padStart(6, '0')}` });
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

describe('the model test of the safety net (P3.3.1)', () => {
  for (const mode of ['store', 'memory'] as const) {
    it(
      `${SEEDS} seeds x ${STEPS} steps hold the seven properties (${mode === 'store' ? 'createHistoryService, two windows, faults' : 'createMemoryHistoryService'})`,
      async () => {
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
      },
      600_000,
    );
  }
});
