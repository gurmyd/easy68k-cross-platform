// Loads the two WebAssembly engines for the binding (ARCHITECTURE.md 3.2; docs/ENGINE-BINDING.md).
//
// Each engine is three files:
//
//   engine/<name>/<name>68k.mjs        the engine's own API module (tracked source)
//   engine/dist/<name>68k-loader.mjs   the Emscripten loader its build wrote (git-ignored)
//   engine/dist/<name>68k.wasm         the engine itself                     (git-ignored)
//
// They are found by URL and loaded when an engine is first asked for, never bundled:
//
// - Vite, development server: `new URL('<literal>', import.meta.url)` becomes a /@fs/ URL.
// - Vite, production build: the same expression copies the file to dist/assets/ under a hashed name
//   and yields its URL relative to this bundle, so nothing depends on where the build is served
//   from (the site root, a GitHub Pages sub-path, the desktop app's app:// origin). A missing engine
//   is a build warning, not a build failure, and is reported when the engine is asked for.
// - Node (Vitest, tools): the URLs are file: URLs; the .wasm is read with node:fs.
//
// Each .wasm is compiled once per page. Every engine instance is a new WebAssembly instance of that
// compiled module.
//
// Owner: W4.

/** Which engine: the assembler or the simulator. */
export type EngineName = 'asm' | 'sim';

/** Where the three files of an engine are. */
export interface EngineFiles {
  api: URL;
  loader: URL;
  wasm: URL;
}

/** The object an Emscripten loader creates: exports of the .wasm (`_name`) and memory views. */
export type EmscriptenModule = Record<string, unknown>;

/** The default export of an Emscripten loader module. */
export type ModuleFactory = (moduleArg?: Record<string, unknown>) => Promise<EmscriptenModule>;

export interface LoadedEngine {
  name: EngineName;
  /** The exports of the engine's API module. It is plain JavaScript, so asm.ts and sim.ts type it. */
  api: Record<string, unknown>;
  /** The compiled .wasm. */
  wasm: WebAssembly.Module;
  /** Absolute URL of the Emscripten loader module that belongs to `wasm`. */
  loaderUrl: string;
  /** The loader's factory, creating each instance from `wasm` instead of fetching and compiling the
   *  file again. Use it wherever the engine expects the loader's default export. */
  createModule: ModuleFactory;
}

/** How an engine was loaded so far (for tests and for docs/ENGINE-BINDING.md). */
export interface EngineLoadInfo {
  /** Times the .wasm was compiled: 1 after the first use, however many instances exist. */
  compilations: number;
  /** WebAssembly instances asked for from the compiled module through `createModule` (the simulator's).
   *  The assembler's module creates its instances itself, from the same compiled module; they are not
   *  counted here. */
  instances: number;
}

/** Thrown when an engine cannot be loaded. `cause` is the underlying error. */
export class EngineLoadError extends Error {
  override name = 'EngineLoadError';
}

// Vite recognises `new URL('<literal>', import.meta.url)` only when it is written out like this.
const ENGINE_FILES: Record<EngineName, EngineFiles> = {
  asm: {
    api: new URL('../../../engine/asm/asm68k.mjs', import.meta.url),
    loader: new URL('../../../engine/dist/asm68k-loader.mjs', import.meta.url),
    wasm: new URL('../../../engine/dist/asm68k.wasm', import.meta.url),
  },
  sim: {
    api: new URL('../../../engine/sim/sim68k.mjs', import.meta.url),
    loader: new URL('../../../engine/dist/sim68k-loader.mjs', import.meta.url),
    wasm: new URL('../../../engine/dist/sim68k.wasm', import.meta.url),
  },
};

const ENGINE_TITLE: Record<EngineName, string> = { asm: 'assembler', sim: 'simulator' };

const loadInfo: Record<EngineName, EngineLoadInfo> = {
  asm: { compilations: 0, instances: 0 },
  sim: { compilations: 0, instances: 0 },
};

const cache: Partial<Record<EngineName, Promise<LoadedEngine>>> = {};

/** The files `loadEngine(name)` loads. */
export function engineFiles(name: EngineName): EngineFiles {
  return { ...ENGINE_FILES[name] };
}

/** A copy of the load counters of one engine. */
export function engineLoadInfo(name: EngineName): EngineLoadInfo {
  return { ...loadInfo[name] };
}

/**
 * Loads an engine: imports its two modules and compiles its .wasm. The result is cached, so every
 * later call returns the same modules and the same compiled .wasm. A failed load is not cached: the
 * next call tries again.
 */
export function loadEngine(name: EngineName): Promise<LoadedEngine> {
  let pending = cache[name];
  if (!pending) {
    pending = loadEngineFrom(name, ENGINE_FILES[name]);
    cache[name] = pending;
    pending.catch(() => {
      if (cache[name] === pending) delete cache[name];
    });
  }
  return pending;
}

/** Loads an engine from the given files, without the cache. `loadEngine` is this with the standard files. */
export async function loadEngineFrom(name: EngineName, files: EngineFiles): Promise<LoadedEngine> {
  try {
    const [api, loader, wasm] = await Promise.all([
      importModule(files.api),
      importModule(files.loader),
      compile(name, files.wasm),
    ]);
    const factory = loader.default;
    if (typeof factory !== 'function') {
      throw new Error(`${files.loader.href} has no default export (it is not an Emscripten loader module)`);
    }
    return {
      name,
      api,
      wasm,
      loaderUrl: files.loader.href,
      createModule: instantiateFrom(name, factory as ModuleFactory, wasm),
    };
  } catch (error) {
    throw new EngineLoadError(
      `The ${ENGINE_TITLE[name]} engine could not be loaded: ${describe(error)}. ` +
        'If engine/dist/ is missing or out of date, run "npm run build:engines" (needs Emscripten) or "npm run fetch:engines".',
      { cause: error },
    );
  }
}

async function importModule(url: URL): Promise<Record<string, unknown>> {
  return (await import(/* @vite-ignore */ url.href)) as Record<string, unknown>;
}

async function compile(name: EngineName, url: URL): Promise<WebAssembly.Module> {
  const bytes = await readBytes(url);
  // A server that answers a missing file with its start page would otherwise surface as a
  // CompileError about a "magic word".
  if (bytes.length < 4 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    throw new Error(`${url.href} is not a WebAssembly file`);
  }
  const module = await WebAssembly.compile(bytes);
  loadInfo[name].compilations += 1;
  return module;
}

/**
 * The bytes of a file. They are fetched whole and compiled from memory; streaming compilation would
 * save nothing for files of this size and would depend on the server's `Content-Type`.
 */
async function readBytes(url: URL): Promise<Uint8Array<ArrayBuffer>> {
  if (url.protocol === 'file:') {
    // Node: fetch() does not read file: URLs. process.getBuiltinModule() reaches node:fs without an
    // import statement, which a browser bundle could not resolve.
    const node = typeof process === 'undefined' ? undefined : process;
    if (typeof node?.getBuiltinModule !== 'function') {
      throw new Error(`${url.href} is a file: URL, which can only be read under Node`);
    }
    return node.getBuiltinModule('node:fs/promises').readFile(url);
  }
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`${url.href}: HTTP ${response.status} ${response.statusText}`.trimEnd());
  return new Uint8Array(await response.arrayBuffer());
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---- instances from the compiled module -----------------------------------------------------------

/**
 * Wraps an Emscripten loader factory so that every instance comes from the compiled module `wasm`.
 * The loader is given Emscripten's `instantiateWasm` hook, which both engines' loaders accept
 * (`-sINCOMING_MODULE_JS_API` in engine/asm/build.mjs and engine/sim/build.mjs), so it neither
 * fetches nor compiles the .wasm. A failed instantiation rejects the returned promise with an
 * `EngineLoadError`: the loader on its own would wait for `receive` for ever.
 */
function instantiateFrom(name: EngineName, factory: ModuleFactory, wasm: WebAssembly.Module): ModuleFactory {
  return (moduleArg = {}) => {
    const complaints: string[] = [];
    let creating = true;
    return new Promise<EmscriptenModule>((resolve, reject) => {
      // Emscripten's module object is the argument itself: the engine's API module and the loader's
      // import glue both keep using it, so the properties are added to it, not to a copy.
      Object.assign(moduleArg, {
        instantiateWasm(
          imports: WebAssembly.Imports,
          receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
        ) {
          loadInfo[name].instances += 1;
          WebAssembly.instantiate(wasm, imports).then((instance) => receive(instance, wasm), reject);
          return {};
        },
        // The loader reports a failed start here before it rejects: kept for the error below. What
        // the engine prints later (an abort while it runs) goes to the console.
        printErr: (text: unknown) => (creating ? complaints.push(String(text)) : console.error(text)),
      });
      factory(moduleArg).then(resolve, reject);
    })
      .catch((error: unknown) => {
        const detail = [describe(error), ...complaints].join('; ');
        throw new EngineLoadError(
          `A new instance of the ${ENGINE_TITLE[name]} engine could not be created: ${detail}`,
          { cause: error },
        );
      })
      .finally(() => {
        creating = false;
      });
  };
}
