Status: applied at the wave-0 gate. Item 1: a failed instantiation, and any other failure to start an instance (the .wasm or the loader cannot be loaded), makes assemble() resolve with fatal "The assembler could not start: <reason>" (the text the binding used and the contract names), not "stopped abnormally". Item 2 as asked. The interception in app/src/engine/asm.ts is removed.

# Request from W4 to the assembler engine package (`engine/asm`)

Found while binding `engine/asm/asm68k.mjs` and `engine/dist/asm68k-loader.mjs` to the application
(`app/src/engine/`, `docs/ENGINE-BINDING.md`). The engine loads and runs unchanged in Node 24,
headless Chromium 159 and WebKit 27.2: `smoke.X68` gives the same bytes in all three, 500 consecutive
assemblies succeed, and the structured-code "Invalid syntax" path (a C++ exception thrown and caught
inside the `.wasm`) works in both browsers. **Nothing below is needed for the application to work.**

## 1. `assemble()` never settles when no instance can be created (`asm68k.mjs`, `newInstance()`)

**Now.**

```js
return createModule({
  instantiateWasm(imports, receive) {
    WebAssembly.instantiate(module, imports).then((instance) => receive(instance, module));
    return {};
  },
  ...
```

If `WebAssembly.instantiate` rejects (the browser cannot allocate the 16 MiB, for example - the
situation of ARCHITECTURE.md R-19), nothing calls `receive`, the loader's promise stays pending, and
so does the promise `assemble()` returned. The rejection itself is unhandled.

**Reproduce** (Node): replace `WebAssembly.instantiate` by `() => Promise.reject(new RangeError('x'))`
and call `assemble(...)`: an `unhandledRejection`, and the promise is still pending after any wait.

**Workaround in the binding** (`app/src/engine/asm.ts`, `assemble`): while the module's `assemble()`
runs, the binding watches `WebAssembly.instantiate` calls for the assembler's compiled module. On a
failure it resolves with a `fatal` result (`The assembler could not start: <reason>`) and hands the
module a promise that stays pending in place of the rejected one.

**Asked.** Make the failure reach the caller, for example:

```js
async function newInstance() {
  const module = await getCompiled();
  ...
  return new Promise((resolve, reject) => {
    createModule({
      instantiateWasm(imports, receive) {
        WebAssembly.instantiate(module, imports).then((instance) => receive(instance, module), reject);
        return {};
      },
      print() {},
      printErr() {},
    }).then(resolve, reject);
  });
}
```

and, in `assemble()`, turn a rejection of `newInstance()` into the `fatal` result the function
already returns for a trap (`The assembler stopped abnormally: ...`), so that "assembler problems
never throw" stays true.

## 2. A warning from the Vite development server (`asm68k.mjs`, `newInstance()`)

**Now.** `import(String(new URL(String(loaderLocation), import.meta.url)))` makes `vite dev` print,
once per start:

```
The above dynamic import cannot be analyzed by Vite. ... you can use the /* @vite-ignore */ comment
inside the import() call to suppress this warning.
  Plugin: vite:import-analysis
  File: <repository>/engine/asm/asm68k.mjs
```

**Asked.** `import(/* @vite-ignore */ String(new URL(...)))`, as `sim68k.mjs` already has it for its
own loader import. The comment has no effect outside Vite.

## 3. Observations, no change asked

- The binding always calls `initAssembler({ wasmModule, loaderUrl })`, once per page, so the
  module's own lookups (`../dist/asm68k.wasm`, the literal `import('../dist/asm68k-loader.mjs')`)
  are not used by the application. They matter in one way: because of that literal import,
  `asm68k.mjs` cannot be bundled into an application that must also build without `engine/dist/`.
  The binding therefore loads the module by URL (`docs/porting/errata/W4.md`, entry 4).
- `status` is -1 on a fatal result; `DEFAULT_OPTIONS.tabType` is the string `'fixed'` while the
  application passes 0 / 1. Both are fine as they are.
