// The assembler engine behind the contract types (ARCHITECTURE.md 3.2; docs/ENGINE-BINDING.md).
//
// engine/asm/asm68k.mjs is plain JavaScript. This file loads it (loader.ts), tells it where its
// loader and its compiled .wasm are, and gives its `assemble()` the type of `AsmEngine`. The module
// already returns exactly the fields of `AsmResult`, so results pass through untouched.
//
// One difference is absorbed here: when a new WebAssembly instance cannot be created (the browser is
// out of memory, for example) the module's promise never settles. The binding notices that failure
// and returns a `fatal` result instead (see `assemble` below).
//
// Owner: W4.

import type { AsmEngine, AsmOptions, AsmResult, Bytes } from '../contracts';
import { countInstance, loadEngine, withInstantiateRoute, type LoadedEngine } from './loader';

/** The exports of engine/asm/asm68k.mjs that the binding uses. */
interface AsmModule {
  initAssembler(config: { wasmModule: WebAssembly.Module; loaderUrl: string }): Promise<void>;
  assemble(
    mainName: string,
    files: ReadonlyMap<string, Bytes>,
    options: AsmOptions,
    timestamp: Date,
  ): Promise<AsmResult>;
  changeFileExt(name: string, ext: string): string;
}

let ready: Promise<LoadedEngine> | undefined;

/** Loads the engine once and hands the module its compiled .wasm and the URL of its loader. */
function loadAssembler(): Promise<LoadedEngine> {
  if (!ready) {
    const pending = loadEngine('asm').then(async (engine) => {
      const api = engine.api as unknown as AsmModule;
      await api.initAssembler({ wasmModule: engine.wasm, loaderUrl: engine.loaderUrl });
      return engine;
    });
    ready = pending;
    pending.catch(() => {
      if (ready === pending) ready = undefined;
    });
  }
  return ready;
}

/**
 * A result that says the assembly did not take place, with every other field empty: the shape the
 * module itself returns when a run ends abnormally.
 */
export function fatalResult(api: Pick<AsmModule, 'changeFileExt'>, mainName: string, fatal: string): AsmResult {
  return {
    listing: null,
    listingName: api.changeFileExt(mainName, '.L68'),
    sRecord: null,
    sRecordName: api.changeFileExt(mainName, '.S68'),
    messages: [],
    errorCount: 0,
    warningCount: 0,
    executeEnabled: false,
    dialogs: [],
    status: -1,
    fatal,
  };
}

/**
 * Runs the module's `assemble()`.
 *
 * The module creates a fresh WebAssembly instance for every assembly, from inside, with
 * `WebAssembly.instantiate(compiled module)`. If that call fails, the module has no path that
 * reports it: the promise of `assemble()` stays pending for ever and the failure becomes an
 * unhandled rejection. So the call is watched (`withInstantiateRoute`): a failure ends the wait with
 * a `fatal` result, and the module is answered with a promise that never settles in place of the
 * rejected one, which is what its code can cope with.
 */
function assemble(
  engine: LoadedEngine,
  mainName: string,
  files: ReadonlyMap<string, Bytes>,
  options: AsmOptions,
  timestamp: Date,
): Promise<AsmResult> {
  const api = engine.api as unknown as AsmModule;
  let instanceFailed: (result: AsmResult) => void = () => {};
  const failure = new Promise<AsmResult>((resolve) => {
    instanceFailed = resolve;
  });
  return withInstantiateRoute(
    (source, imports, original) => {
      if (source !== engine.wasm) return null;
      countInstance('asm', 'hook'); // the module's own instantiateWasm hook is asking
      return original(source, imports).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        instanceFailed(fatalResult(api, mainName, `The assembler could not start: ${reason}`));
        return new Promise<never>(() => {});
      });
    },
    // The module tells a Map from a plain object with `instanceof Map`; a copy is always one.
    () => Promise.race([api.assemble(mainName, new Map(files), options, timestamp), failure]),
  );
}

/**
 * The assembler. The first call loads the engine; every `assemble()` then runs in a fresh
 * WebAssembly instance of the once-compiled module.
 *
 * `assemble()` resolves for everything that can happen to a program, including an abnormal end of
 * the engine (`fatal`). It rejects only for arguments the contract forbids: a `mainName` that is not
 * a key of `files`, a `tabSize` that is not an integer from -99 to 99, an invalid `Date`.
 */
export async function createAsmEngine(): Promise<AsmEngine> {
  const engine = await loadAssembler();
  return {
    assemble: (mainName, files, options, timestamp) => assemble(engine, mainName, files, options, timestamp),
  };
}
