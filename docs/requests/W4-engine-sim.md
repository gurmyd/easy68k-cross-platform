# Request from W4 to the simulator engine package (`engine/sim`)

Found while binding `engine/sim/sim68k.mjs` and `engine/dist/sim68k-loader.mjs` to the application
(`app/src/engine/`, `docs/ENGINE-BINDING.md`). The engine loads and runs unchanged in Node 24,
headless Chromium 159 and WebKit 27.2: its 11 fixtures, a program that calls every TRAP #15 task
(all 93 host imports), 200 create / release cycles, and a C++ exception thrown and caught inside
the `.wasm`. **Nothing below is needed for the application to work**; each item removes a
workaround in the binding.

## 1. Let the loader take a compiled module (`build.mjs`)

**Now.** `LINK_FLAGS` has `-sINCOMING_MODULE_JS_API=wasmBinary,locateFile,print,printErr`. The
loader therefore ignores `instantiateWasm`, and `createSim()` can only be given the bytes of the
`.wasm`, which the loader passes to `WebAssembly.instantiate(bytes, imports)`: the 160 kB are
compiled again for every instance. The application creates a new instance at every cold start
(ARCHITECTURE.md 4.7.1) and must compile once (3.2, R-19).

**Workaround in the binding** (`app/src/engine/loader.ts`, `instantiateFrom`): it passes a 16-byte
marker as `wasmBinary` and, while the loader's factory runs, answers the loader's
`WebAssembly.instantiate(marker, imports)` call with `{ module, instance }` made from the compiled
module. That means replacing the global `WebAssembly.instantiate` for the duration of the call.

**Asked.** In `engine/sim/build.mjs`:

```js
  '-sINCOMING_MODULE_JS_API=wasmBinary,locateFile,print,printErr,instantiateWasm',
```

The binding already passes an `instantiateWasm(imports, receive)` hook on every call, so with the
rebuilt loader it is used at once and the interception is never reached. (The assembler's loader has
the hook; `engine/asm/asm68k.mjs` uses it.) Optionally `createSim()` could accept
`options.wasmModule` itself, as `initAssembler({ wasmModule })` does.

A test tells W4 when this has happened: `app/src/engine/loader.test.ts`, "the simulator's loader has
no instantiateWasm hook yet".

## 2. Give `host.createNetClient` the address of the server string

**Now.** `host_io_createNetClient(settings, server, result)` reaches the host as
`createNetClient(settings, serverBytes)`: a copy of the string, without its 68000 address. Task 100
with a host name must write the resolved address back over the string (trap15-b §12.2,
ARCHITECTURE.md 3.3.4 and 10.3), and `getLocalIP`, `sendNet` and `receiveNet` do receive addresses
(`simAddress(ptr)` in `shim/host-imports.js`).

**Workaround in the binding** (`app/src/engine/sim.ts`, `bindHost`): it wraps this one host method
and reads register A2 (`& $FFFFFF`, as `CODE9.CPP:1266`) while the call is in progress.

**Asked.** In `shim/host-imports.js`:

```js
host_io_createNetClient: (settings, server, result) => {
  simPut32(result, simHost().createNetClient(settings, simCString(server), simAddress(server)));
},
```

and the third parameter in the `SimHost` typedef of `sim68k.mjs`. The contract already declares it
(`createNetClient(settings, server, serverAddress?)`).

## 3. Observations, no change asked

- `Module.printErr` is honoured; the binding uses it to put the loader's own words into the error
  when an instance cannot be created (`failed to asynchronously prepare wasm: ...`).
- The loader module is identical in use on Windows; W4 could not compare it with a Linux build (the
  reported two-byte difference). The binding copies the file to the build as it is and never reads
  inside it.
- A host may hold its engines in `WeakRef`s only with care: in Chromium a loop that created and
  released 200 instances while keeping a `WeakRef` to each memory ran out of address space, because
  a `WeakRef` keeps its target until the current task ends. With no such reference the same loop
  succeeds in both browsers (`docs/ENGINE-BINDING.md`, section 7).
