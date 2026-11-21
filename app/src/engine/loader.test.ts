// loader.ts: where the engine files are, loading and caching, one compilation per .wasm, instances
// from the compiled module, and what is reported when an engine cannot be loaded (W4, 9.1).
// This file runs under Node; browser.test.ts proves the same loader under Vite in Chromium and WebKit.

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  engineFiles,
  engineLoadInfo,
  EngineLoadError,
  loadEngine,
  loadEngineFrom,
  withInstantiateRoute,
  type EmscriptenModule,
} from './loader';

const repo = (file: string) => fileURLToPath(new URL(`../../../${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(repo(`engine/dist/${file}`)),
);
const fileUrl = (file: string) => pathToFileURL(repo(file));

/** What the simulator's API module adds before it calls the loader (engine/sim/sim68k.mjs, createSim). */
const simModuleArg = () => ({ host: {}, simMemoryBase: 0 });
const call = (module: EmscriptenModule, name: string, ...args: number[]) =>
  (module[name] as (...a: number[]) => number)(...args);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('engineFiles', () => {
  it('names the API module in engine/<name> and the build outputs in engine/dist', () => {
    expect(engineFiles('asm')).toEqual({
      api: fileUrl('engine/asm/asm68k.mjs'),
      loader: fileUrl('engine/dist/asm68k-loader.mjs'),
      wasm: fileUrl('engine/dist/asm68k.wasm'),
    });
    expect(engineFiles('sim')).toEqual({
      api: fileUrl('engine/sim/sim68k.mjs'),
      loader: fileUrl('engine/dist/sim68k-loader.mjs'),
      wasm: fileUrl('engine/dist/sim68k.wasm'),
    });
    expect(existsSync(repo('engine/asm/asm68k.mjs'))).toBe(true);
    expect(existsSync(repo('engine/sim/sim68k.mjs'))).toBe(true);
  });
});

describe.skipIf(!enginesBuilt)('loadEngine (needs engine/dist)', () => {
  it('loads the API module, the loader and the compiled .wasm of each engine', async () => {
    const asm = await loadEngine('asm');
    expect(typeof asm.api.assemble).toBe('function');
    expect(asm.wasm).toBeInstanceOf(WebAssembly.Module);
    expect(asm.loaderUrl).toBe(fileUrl('engine/dist/asm68k-loader.mjs').href);

    const sim = await loadEngine('sim');
    expect(typeof sim.api.createSim).toBe('function');
    expect(sim.wasm).toBeInstanceOf(WebAssembly.Module);
    // The .wasm imports exactly the host functions of shim/host.h plus two of the C run time.
    const imports = WebAssembly.Module.imports(sim.wasm).map((entry) => entry.name);
    expect(imports.filter((name) => name.startsWith('host_')).length).toBe(93);
    expect(imports.filter((name) => !name.startsWith('host_')).sort()).toEqual(['_abort_js', 'emscripten_resize_heap']);
  });

  it('is cached: the same modules and the same compilation for every caller', async () => {
    const compile = vi.spyOn(WebAssembly, 'compile');
    const [a, b] = await Promise.all([loadEngine('sim'), loadEngine('sim')]);
    expect(a).toBe(b);
    expect(await loadEngine('sim')).toBe(a);
    expect(compile).not.toHaveBeenCalled(); // compiled by an earlier test, never again
    expect(engineLoadInfo('sim').compilations).toBe(1);
    expect(engineLoadInfo('asm').compilations).toBe(1);
  });

  it('creates every simulator instance from the compiled module, never from bytes', async () => {
    const sim = await loadEngine('sim');
    const original = WebAssembly.instantiate;
    const instantiate = vi.spyOn(WebAssembly, 'instantiate');
    const before = engineLoadInfo('sim').instances;

    const modules = await Promise.all([1, 2, 3].map(() => sim.createModule(simModuleArg())));
    expect(engineLoadInfo('sim').instances).toBe(before + 3);
    // What reached the real WebAssembly.instantiate was the compiled module each time.
    expect(instantiate.mock.calls.map(([source]) => source)).toEqual([sim.wasm, sim.wasm, sim.wasm]);

    // Three independent instances: each has its own memory.
    const memories = modules.map((module) => (module.HEAPU8 as Uint8Array).buffer);
    expect(new Set(memories).size).toBe(3);
    expect(memories.every((memory) => memory.byteLength === 64 * 1024 * 1024)).toBe(true);
    for (const module of modules) expect(call(module, '_sim_memory')).toBeGreaterThan(0);

    instantiate.mockRestore();
    expect(WebAssembly.instantiate).toBe(original); // the route was taken down again
  });

  it("the simulator's loader has no instantiateWasm hook yet; the assembler's has", async () => {
    // When this fails because the simulator's route became "hook", engine/sim/build.mjs has gained
    // `instantiateWasm` (docs/requests/W4-engine-sim.md): update docs/ENGINE-BINDING.md and consider
    // removing the interception in loader.ts.
    await (await loadEngine('sim')).createModule(simModuleArg());
    expect(engineLoadInfo('sim').route).toBe('intercepted');

    const asm = await (await loadEngine('asm')).createModule();
    expect(engineLoadInfo('asm').route).toBe('hook');
    expect(call(asm, '_ez_alloc', 16)).toBeGreaterThan(0);
  });

  it('reports an instance that cannot be created, and the next one works', async () => {
    const sim = await loadEngine('sim');
    vi.spyOn(WebAssembly, 'instantiate').mockRejectedValueOnce(new RangeError('Out of memory'));
    const failure = await sim.createModule(simModuleArg()).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(EngineLoadError);
    expect((failure as Error).message).toMatch(
      /^A new instance of the simulator engine could not be created: .*Out of memory/,
    );
    vi.restoreAllMocks();
    const module = await sim.createModule(simModuleArg());
    expect(call(module, '_sim_memory')).toBeGreaterThan(0);
  });

  it('an instance and an unrelated WebAssembly.instantiate call asked for together both succeed', async () => {
    const sim = await loadEngine('sim');
    // The smallest module: magic and version.
    const empty = Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00);
    const [module, other] = await Promise.all([sim.createModule(simModuleArg()), WebAssembly.instantiate(empty)]);
    expect(call(module, '_sim_memory')).toBeGreaterThan(0);
    expect(other.instance).toBeInstanceOf(WebAssembly.Instance);
  });
});

describe.skipIf(!enginesBuilt)('loadEngineFrom: what is said when an engine cannot be loaded', () => {
  const failure = (files: Partial<ReturnType<typeof engineFiles>>) =>
    loadEngineFrom('sim', { ...engineFiles('sim'), ...files }).then(
      () => {
        throw new Error('loaded');
      },
      (error: unknown) => error as EngineLoadError,
    );

  it('a missing .wasm: names the file and how to get the engines', async () => {
    const error = await failure({ wasm: fileUrl('engine/dist/missing.wasm') });
    expect(error).toBeInstanceOf(EngineLoadError);
    expect(error.name).toBe('EngineLoadError');
    expect(error.message).toMatch(/^The simulator engine could not be loaded: .*missing\.wasm/);
    expect(error.message).toContain('"npm run build:engines" (needs Emscripten) or "npm run fetch:engines"');
    expect(error.cause).toBeInstanceOf(Error);
  });

  it('a missing loader module', async () => {
    const error = await failure({ loader: fileUrl('engine/dist/missing-loader.mjs') });
    expect(error.message).toMatch(/^The simulator engine could not be loaded: .*missing-loader\.mjs/);
  });

  it('a file that is not WebAssembly (a server answering with its start page)', async () => {
    const error = await failure({ wasm: fileUrl('engine/sim/README.md') });
    expect(error.message).toContain('engine/sim/README.md is not a WebAssembly file');
  });

  it('a module that is not an Emscripten loader', async () => {
    const error = await failure({ loader: fileUrl('engine/sim/sim68k.mjs') });
    expect(error.message).toContain('has no default export (it is not an Emscripten loader module)');
  });

  it('an uncached load from the standard files compiles again and works', async () => {
    const before = engineLoadInfo('sim').compilations;
    const engine = await loadEngineFrom('sim', engineFiles('sim'));
    expect(engineLoadInfo('sim').compilations).toBe(before + 1);
    expect(call(await engine.createModule(simModuleArg()), '_sim_memory')).toBeGreaterThan(0);
  });
});

describe('withInstantiateRoute', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  it('runs tasks one at a time and restores WebAssembly.instantiate after each, also after a failure', async () => {
    const original = WebAssembly.instantiate;
    const events: string[] = [];
    const first = withInstantiateRoute(
      () => null,
      async () => {
        events.push('first starts');
        expect(WebAssembly.instantiate).not.toBe(original);
        await tick();
        events.push('first ends');
        throw new Error('first failed');
      },
    );
    const second = withInstantiateRoute(
      () => null,
      async () => {
        events.push('second starts');
        await tick();
        events.push('second ends');
        return 2;
      },
    );
    await expect(first).rejects.toThrow('first failed');
    expect(await second).toBe(2);
    expect(events).toEqual(['first starts', 'first ends', 'second starts', 'second ends']);
    expect(WebAssembly.instantiate).toBe(original);
  });

  it('a call the route does not claim goes to the real function', async () => {
    const empty = Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00);
    const result = await withInstantiateRoute(
      () => null,
      () => WebAssembly.instantiate(empty),
    );
    expect(result.module).toBeInstanceOf(WebAssembly.Module);
    expect(result.instance).toBeInstanceOf(WebAssembly.Instance);
  });

  it("gives the route the call and the real function; a claimed call gets the route's answer", async () => {
    const seen: unknown[] = [];
    const answer = await withInstantiateRoute(
      (source, imports, real) => {
        seen.push(source, imports, typeof real);
        return source === 'mine' ? Promise.resolve('answered') : null;
      },
      () => (WebAssembly.instantiate as unknown as (s: unknown, i?: unknown) => Promise<unknown>)('mine', { env: {} }),
    );
    expect(answer).toBe('answered');
    expect(seen).toEqual(['mine', { env: {} }, 'function']);
  });
});
