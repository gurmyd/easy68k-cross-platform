# The engine binding (`app/src/engine/`)

How the application loads the two WebAssembly engines, what each file of the binding does, every
difference found between the engine modules and section 3.2 of `ARCHITECTURE.md`, and what was done
about each. Owner: work package W4. State: 2026-11-20, engines as built on that day
(`asm68k.wasm` 136,962 bytes, `sim68k.wasm` 160,409 bytes, Emscripten 7.0.0).

Contents: 1 the files - 2 how the engines are loaded - 3 where it was run - 4 differences from
section 3.2 - 5 what the engine packages are asked to change - 6 for packages that use the binding -
7 measurements - 8 not verified.

---

## 1. The files

| File | Does |
|---|---|
| `index.ts` | The application's entry: `createAsmEngine()`, `createSimEngine(host)`, `releaseSimEngine(engine)`. Nothing else is exported from it. |
| `loader.ts` | Finds the six engine files, imports the modules, compiles each `.wasm` once, and creates instances from the compiled module. |
| `asm.ts` | `engine/asm/asm68k.mjs` behind the type `AsmEngine`. |
| `sim.ts` | `engine/sim/sim68k.mjs` behind the type `SimEngine`; the mirror of the host's method list and default results. |
| `testing.ts` | Test helpers for every package: recording host, the real engine for unit tests, fault injector, assembling and running 68000 programs, a program that calls every TRAP #15 task. Never imported by the application. |
| `*.test.ts` | The tests of the above. `browser.test.ts` runs in Chromium and WebKit. |
| `fake-asm.ts` | W1's scripted assembler for unit tests that need a particular result. Not part of the binding. |

The application never imports `engine/asm`, `engine/sim` or `engine/dist` directly.

## 2. How the engines are loaded

Each engine is three files:

| | Assembler | Simulator | Tracked |
|---|---|---|---|
| API module | `engine/asm/asm68k.mjs` | `engine/sim/sim68k.mjs` | yes |
| Emscripten loader | `engine/dist/asm68k-loader.mjs` | `engine/dist/sim68k-loader.mjs` | no (build output) |
| WebAssembly | `engine/dist/asm68k.wasm` | `engine/dist/sim68k.wasm` | no (build output) |

`loader.ts` names all six as `new URL('<relative path>', import.meta.url)` and loads them when an
engine is first asked for: the two modules with `import(url)`, the `.wasm` with `fetch(url)`
(`node:fs` under Node) followed by `WebAssembly.compile(bytes)`. None of the six is bundled; they
reach the browser byte for byte as the engine packages built and tested them.

| Where | What `new URL(..., import.meta.url)` becomes | Result |
|---|---|---|
| Vite development server | `/@fs/<repository>/engine/...` | The dev server serves the files. The two API modules pass through Vite's import analysis without a warning (both mark their computed `import()` with `/* @vite-ignore */`). |
| Vite production build | The file is copied to `dist/assets/` under a content-hashed name (`sim68k-<hash>.wasm`, `sim68k-loader-<hash>.mjs`, `sim68k-<hash>.mjs`, and the same three for `asm68k`), and the expression becomes `new URL('<hashed name>', import.meta.url)` | Six assets next to the application's own script. URLs are relative to that script, so the build works at any base path. |
| Node (Vitest, tools) | a `file:` URL | Modules are imported from disk; the `.wasm` is read with `process.getBuiltinModule('node:fs/promises')` (no `import` of a Node module, which a browser bundle could not resolve, and none that the layer rule of `eslint.config.js` would refuse). |
| Desktop app, `app://easy68k/...` | as the production build | See 2.4. |

### 2.1 One compilation, many instances

- `loadEngine(name)` caches its promise: the modules are imported once and the `.wasm` is compiled
  once per page. A failed load is not cached, so a later call tries again.
- Every `createSimEngine()` creates a new WebAssembly instance of the compiled simulator module
  (64 MiB of memory each). `releaseSimEngine()` drops the binding's reference to it.
- Every `assemble()` runs in a new instance of the compiled assembler module (16 MiB, growing on
  demand); the assembler's own module does that (assembler §1.8).
- `engineLoadInfo(name)` reports `{ compilations, instances }` for tests and for diagnosis
  (`instances` counts the simulator's; the assembler's module creates its own and they are not counted).

How an instance gets the compiled module: both loaders are built with Emscripten's
`instantiateWasm` hook (`-sINCOMING_MODULE_JS_API` in each engine's `build.mjs`), so neither
fetches nor compiles the `.wasm` itself.

- **Assembler**: `asm.ts` gives the compiled module to `initAssembler({ wasmModule, loaderUrl })`
  and the module's own hook does the rest. When an instance cannot be created, the module's
  `assemble()` resolves with a `fatal` result (A1).
- **Simulator**: `loader.ts` (`instantiateFrom`) passes the hook in the module argument of every
  `createModule` call; it instantiates the compiled module, and a failure rejects `createModule`
  with an `EngineLoadError` (S7). (`createSim()` in `sim68k.mjs` also accepts
  `options.wasmModule` for the same purpose; the binding does not need it.)

The binding never replaces `WebAssembly.instantiate`.

### 2.2 What the page needs

- Content Security Policy (7.6): `script-src 'self' 'wasm-unsafe-eval'` (modules from the app's own
  origin; compiling WebAssembly) and `connect-src 'self'` (fetching the `.wasm`). The binding never
  uses `eval`, `blob:` or `data:` URLs. Checked in both browsers with the policy as a `<meta>` tag
  and as a response header: no `securitypolicyviolation` event.
- The four `.mjs` files must be served with a JavaScript content type (browsers refuse anything else
  for a module). `vite preview` and the test server send `text/javascript`.
- The `.wasm` files may have any content type. The binding fetches them whole and compiles the
  bytes, so it does not depend on `application/wasm` (tested with `application/octet-stream`).
  Streaming compilation would save nothing for 137 kB and 160 kB.
- The engines' `.wasm` use WebAssembly exception handling in its legacy encoding. Both test browsers
  compile and execute it: a C++ exception is thrown and caught inside each engine in the browser
  tests (a structured-code error in the assembler; the recursion guard of the simulator).

### 2.3 When an engine is missing

`engine/dist/` is not in the repository. Without it:

- `npm run typecheck` and `npm run lint` are unaffected (the binding has no static import of an
  engine file).
- `npm run dev` and `npm run build` succeed. The build prints, for each missing file,
  `new URL('...', import.meta.url) doesn't exist at build time, it will remain unchanged to be
  resolved at runtime`; the dev server serves the page and answers 404 for the engine files.
  (Checked with the pinned Vite, 8.3.8, on a module that names missing files in the same way; W4 did
  not remove `engine/dist` from a working tree that others were using.)
- At run time `createAsmEngine()` / `createSimEngine()` reject with an `EngineLoadError`:
  `The simulator engine could not be loaded: <reason>. If engine/dist/ is missing or out of date,
  run "npm run build:engines" (needs Emscripten) or "npm run fetch:engines".` The same error
  reports a server that answers a missing file with its start page (`... is not a WebAssembly
  file`).
- The binding's tests that need the engines are skipped (`describe.skipIf`).

### 2.4 The desktop app's protocol

The binding does nothing special for `app://`. From the protocol handler of 7.6 it needs exactly
what a web server gives it:

1. `fetch()` works for `app://` URLs (the `supportFetchAPI` privilege), and `import()` works for
   them (`standard` and `secure`).
2. `.mjs` and `.js` are served as `text/javascript`.
3. The response carries the policy of 7.6, or the page's `<meta>` tag does.
4. The six engine assets are in the packaged `app/dist/assets/`.

It was **not run under Electron** by W4 (section 8). What was run: the production build, served
under a sub-path by a server with the handler's content-type table and the policy as a header, in
Chromium and WebKit.

## 3. Where it was run

All on Windows 11, 2026-11-20, against the real `engine/dist`:

| Environment | What ran | Result |
|---|---|---|
| Node 24.19 (Vitest) | `loader`, `asm`, `sim`, `testing`, `trap15` tests: 202 tests | pass |
| Chromium 159.0.8154.6 (Playwright 1.65.1, headless shell), production build with CSP | both engines load; the 11 fixtures of `engine/sim/test/fixtures` run to their halt with the registers, cycle counts, memory and host calls they have under Node; `smoke.X68` assembles to the same bytes; the TRAP #15 tour (94 task calls) makes the same 247 host calls; exceptions inside both engines; 200 release/create cycles; 500 assemblies; `.wasm` as `application/octet-stream`; missing-file messages | pass |
| WebKit 27.2 (Playwright build 2388, headless), production build with CSP | the same | pass |
| Chromium and WebKit, Vite development server | both engines load from `/@fs/` URLs, assemble and run a fixture | pass |

Neither engine needed a change to load in a browser.

To repeat it: `npm test -- src/engine` runs the Node tests; the browser suite is skipped unless
`EASY68K_BROWSERS` is set, so that a plain `npm test` starts no browser. `npm run
check:engine-browsers` runs it in Chromium and WebKit with `EASY68K_REQUIRE_BROWSERS=1`, which fails
instead of skipping when a browser is not installed (`npx playwright install chromium webkit`); to
run one browser, `npm test -- src/engine/browser.test.ts` with `EASY68K_BROWSERS=chromium` or
`webkit` (`all` means both).

## 4. Differences between the modules and section 3.2

The mirror tests (`sim.test.ts`, `asm.test.ts`) compare, against the real modules: the 66 members of
`Sim68k.prototype` with `SimEngine`; which of them are getters; the 93 keys and default values of
`HOST_DEFAULTS` with `SimHost`; the numbers of `Status`, `Reg`, `Box`, `Option`, `MapKind`, `Device`,
`Shift`, `Repaint`, `FileMode` with the contract's constants; the `enum`s of `shim/host.h` with
`FontTarget`, `FontSource`, `PrinterMetric`; the keys of `DEFAULT_OPTIONS` with `AsmOptions`; the
keys of a real result and of a real message with `AsmResult` and `AsmMessage`. **They all pass: the
mirror was not changed.** What differs is listed here.

### 4.1 Simulator

| # | Module | Section 3.2 / contract | What the binding does |
|---|---|---|---|
| S1 | Constant objects are named `Status`, `Option`, `Device`, `Shift`, `Repaint`, with keys in upper case (`WAIT_INPUT`) | `RunStatus`, `SimOption`, `HwDevice`, `ShiftBit`, `RepaintBit`, keys in mixed case (`WaitInput`) | Nothing at run time: the numbers are equal, and the binding passes numbers. Found by W1 (its erratum 1); the mirror test translates the names. |
| S2 | `host.createNetClient(settings, server, serverAddress)`: a copy of the server string of task 100 and its 68000 address, `A2 & $FFFFFF` (`CODE9.CPP:1266`) | `createNetClient(settings, server, serverAddress?)` (3.3.4) | Nothing: passed on as it is. (Until the wave-0 gate the engine left the address out and `sim.ts` read register A2; request 5.1, applied.) |
| S3 | No call to release an instance | `releaseSimEngine(engine)` | The application's `SimEngine` is a small forwarding object (`SimBinding`); release cuts its link to the engine's object. Afterwards every member throws `This simulator engine was released ...`. A Node test shows that the 64 MiB are then collected. |
| S4 | The loader has Emscripten's `instantiateWasm` hook | "every call gives an independent WebAssembly instance of the once-compiled module" | `loader.ts` passes the hook (2.1). (Until the wave-0 gate the loader had no hook and `loader.ts` intercepted its `WebAssembly.instantiate(bytes)` call; request 5.1, applied.) |
| S5 | Every host method is optional; a missing one answers with its `HOST_DEFAULTS` value | All 93 are required (W1, on purpose) | `createSimEngine` accepts a host with methods missing all the same and leaves them to the engine. Each method is bound to the host object, so `this` works in a host written as a class. |
| S6 | `load()` throws a `TypeError` for a program that is not a `Uint8Array`, and an `Error` for an unknown `kind` | not stated | Passed on. |
| S7 | A failure to create the instance | not stated | `createSimEngine` rejects with an `EngineLoadError` whose text includes what the loader printed. |

Confirmed as section 3.2 states them (each has a test in `sim.test.ts`):

- **Fact 1**: memory-map rows, auto-interrupt intervals, PC breakpoints (except for `kind: 'open'`,
  which clears them) and the key table of task 19 survive `load()`; only a new instance has start-up
  state. Memory itself is filled with `$FF` by every load.
- **Fact 2**: `load`, `close`, `rewind` and `cmdPause` during `WaitInput` and during `WaitDelay`
  leave `state().phase` 0 and `runMode` false; the next `run()` returns `Stopped` without executing
  anything. `run(0)` finishes a suspended step (step count +1), starts no instruction and returns
  `Running`.
- **Fact 3**: `keyDown` and `mouseDown` on an armed interrupt level set `state().runMode` and return
  nothing that says so (`keyDown` returns whether key commands are enabled); `irq()` returns true
  when execution must start; `timerTick()` of a timer that is not enabled returns false.
- Host calls made while `createSimEngine` runs: 27 calls to 15 methods, in the order of the
  original's `initSim()`.

The observations of 10.3, checked against the module:

- `cmdRunToCursor(row)` on a row without an address raises the box `Selected line does not have a
  valid address.` (`Invalid Run-To-Cursor Selection` for row -1) **and then runs the program**, as
  the original does. The port's own check of the row (note 23) is needed.
- `cyclesText` is the original's display text; `cycles` is a `bigint`.
- The module has no call that tells the engine which listing row is selected, other than
  `cmdRunToCursor`.
- `writeBytes()` and `memory` change memory without any host call: no `hardwareUpdate`, no
  `memoryLivePaint`. A panel that pokes memory repaints the Hardware panel itself.

### 4.2 Assembler

| # | Module | Section 3.2 / contract | What the binding does |
|---|---|---|---|
| A1 | When no instance can be created for an assembly (out of memory, for example; also a `.wasm` or loader that cannot be loaded when the module finds them itself), `assemble()` resolves with a `fatal` result, `The assembler could not start: <reason>`; nothing is left unhandled | `fatal`: "the run ended abnormally ... or the instance failed" | Nothing: passed on. (Until the wave-0 gate the module's promise never settled in that case and `asm.ts` intercepted `WebAssembly.instantiate`; request 5.2, applied.) |
| A2 | Invalid arguments reject: `Error` for a `mainName` that is not a key of `files`, `RangeError` for a `tabSize` outside -99..99 or an invalid `Date`, `TypeError` for wrong types | not stated | Passed on: these are the only rejections of `AsmEngine.assemble()`. Everything that can happen to a program, a trap inside the engine included, is a result. |
| A3 | `files` may be a `Map` or a plain object, told apart with `instanceof Map` | `ReadonlyMap<string, Bytes>` | The binding passes `new Map(files)`. |
| A4 | `tabType` accepts `'assembly'` / `'fixed'` as well as 0 / 1; `DEFAULT_OPTIONS.tabType` is `'fixed'` | `TabType` 0 / 1 | Numbers are passed. |
| A5 | On a fatal result `status` is -1 | "the engine's own return value" | Passed on. |
| A6 | `initAssembler()` configures the module for the whole page | one `AsmEngine` per `createAsmEngine()` call | Every `AsmEngine` shares the one compiled module; `initAssembler` is called once. |

Confirmed as section 3.2 states them (tests in `asm.test.ts`):

- **Statement 1**: LF and CR LF sources give identical output; output always has CR LF; a Ctrl-Z in
  an include file ends it; the value of the second macro in the symbol table counts two bytes per
  line end of the first.
- **Statement 2**: `INCLUDE 'Macros\IO.x68'`, `INCLUDE ../shared/data.x68` and
  `INCBIN '..\Shared/blob.bin'` from `course/lab1/prog.X68` find `course\lab1\MACROS\io.X68`,
  `course/Shared/Data.X68` and `COURSE/SHARED/BLOB.BIN`; a message from an include file carries the
  key it was read from in `resolvedFile`.
- **Statement 3**: one compilation; one `WebAssembly.instantiate(module)` per assembly; no state
  from one assembly reaches the next.
- `smoke.X68` against the native oracle: see the erratum (`docs/porting/errata/W4.md`, entry 1) for
  the two conditions the acceptance text leaves out.

The observations of 10.3, checked against the module: the main source is the entry of `files` under
`mainName` and is treated as the editor buffer (a last line without a line end gets one);
`executeEnabled` is true whenever there are no errors, also when no S-record was produced; `fatal` is
a text; hidden warnings are still counted.

## 5. What the engine packages were asked to change

Both requests (`docs/requests/W4-engine-sim.md`, `docs/requests/W4-engine-asm.md`) were applied at
the wave-0 gate, and the binding's workarounds for them were removed.

### 5.1 `engine/sim` (applied)

1. `build.mjs`: `instantiateWasm` is in `-sINCOMING_MODULE_JS_API` (S4); `createSim()` also accepts
   `options.wasmModule`.
2. `shim/host-imports.js` and `sim68k.mjs`: `host.createNetClient` receives the 68000 address of the
   server string as its third argument (S2).

### 5.2 `engine/asm` (applied)

1. `asm68k.mjs`: a failed instantiation reaches `assemble()`, which resolves with a `fatal` result
   (A1).
2. `asm68k.mjs`: the computed `import()` of the loader carries `/* @vite-ignore */`.

## 6. For packages that use the binding

- **Everyone**: `createSimEngine` and `createAsmEngine` reject with `EngineLoadError` when an engine
  cannot be loaded; show its message. `assemble()` rejects only for forbidden arguments (A2).
- **SH8 (run controller)**: a cold start is `releaseSimEngine(engine)` then
  `await createSimEngine(host)`; about 6 ms in Chromium, 15 ms in WebKit (section 7). Release first:
  two live instances are 128 MiB. Do not keep a reference to `engine.memory` or to anything derived
  from it across a release, and do not hold engines in `WeakRef`s inside a loop: a `WeakRef` keeps its
  target alive until the current task ends, which in Chromium made a 200-cycle loop run out of
  memory in a first version of the browser test.
- **E5 (assemble)**: a `fatal` result can also mean that no instance could be created
  (`The assembler could not start: ...`); it is shown like any other.
- **DV1 (service worker)**: the six engine files are in `dist/assets/` and are requested at run
  time, not through the module graph: put `assets/*.mjs` and `assets/*.wasm` in the precache list.
- **DV2 (desktop)**: section 2.4. `tests/desktop/dev` should check that both engines start under
  `app://`; W4 could not.
- **DV4 (`DesktopNet`)**: `createNetClient` receives `serverAddress` (S2) from the engine itself; it
  is never `undefined` when task 100 runs.
- **Tests of any package** (`import ... from '../engine/testing'`, relative to `app/src`):

| Helper | Use |
|---|---|
| `createRecordingHost(parts?)` | A `SimHost` whose 93 methods record their calls (`calls`, `callsTo(name)`, `methodsCalled()`, `forget()`) and return the engine's defaults. A part given in `parts` (`main`, `hardware`, `log`, `files`, `text`, `graphics`, `sound`, `serial`, `net`, `printer`) replaces the recording methods of that part; its calls are recorded too. |
| `createTestEngine(parts?)` | The real engine on such a host: `{ engine, host, calls, ..., release() }`. Start-up calls are already recorded. |
| `withFaults(engine, plan)` | A `SimEngine` that throws or returns a chosen value at a chosen call: `{ at: 'run', call: 3, throws: error }`, `{ at: 'run', returns: RunStatus.Error }`. Getters can fault too. `releaseSimEngine` works on the wrapper. |
| `assembleProgram(source, files?, options?)` | The real assembler on a source text or its lines: `{ s68, l68, result }`; throws with the messages when the program has errors. |
| `runProgram(engine, script?)` | Presses Run and serves the wait states from plain data (`keys`, `dialogs`); returns why and how the run ended. |
| `createMemoryFiles(initial?)` | A minimal `files` part: program files in a map. Not the application's file model. |
| `TRAP15_TOUR`, `trap15TourSource()`, `runTrap15Tour(test, program)` | A 68000 program that calls every TRAP #15 task, with the host methods each call reaches. Run against a composed host it visits 80 of the 93 host methods; `trap15.test.ts` shows the calls that reach the other 13. |
| `HOST_DEFAULTS`, `HOST_METHODS`, `HOST_PART_DEFAULTS` (from `../engine/sim`) | The 93 method names and their default results, whole and by part. |

`describe.skipIf(!enginesBuilt)` is the pattern for tests that need `engine/dist`.

## 7. Measurements

From `app/src/engine/browser.test.ts` on the machine of section 3 (it writes
`build/reports/engine-binding-browsers.json` on every run; the figures below are one run and vary a
little from run to run). "Collected" counts instances whose memory the browser has reclaimed,
observed with a `FinalizationRegistry`.

| | Chromium 159 | WebKit 27.2 (Playwright, Windows) |
|---|---|---|
| 200 `releaseSimEngine` / `createSimEngine` cycles (every tenth runs a program) | 1.0 s | 3.0 s |
| - instances collected 50 ms after the loop / after a collection was requested | 153 / 200 | 199 / 200 |
| - simulator memory not yet collected: start / after the loop / after the request | 64 / 3,072 / 64 MiB | 64 / 128 / 64 MiB |
| 500 consecutive assemblies | 0.17 s | 7.5 s |
| - instances collected 50 ms after the loop | 496 of 500 | 499 of 500 |
| JavaScript heap (`performance.memory`), start / end | 5.1 / 5.1 MiB | not available |
| Memory of the browser's processes (working set), before / after the test | 444 / 218 MiB | 256 / 212 MiB |
| Compilations of each `.wasm` | 1 | 1 |

"Start" is after the tests that run before this one in the same page, which is why the Chromium
processes hold more before the test than after it: the test ends with a requested collection.

Under Node the same 200 cycles take about 1.1 s and 500 assemblies about 0.4 s. The WebKit figures
are from Playwright's Windows build of WebKit; Safari on a Mac was not measured, and the manual list
(6.8) repeats the test there.

In Chromium the 200-cycle loop is one task; the instances it leaves behind are collected when the
browser needs the address space or is asked. No run needed the "return to start-up state" call that
R-19 holds in reserve.

## 8. Not verified

- **Electron and `app://`.** Electron's binary is not installed on the machine W4 ran on, and W4 did
  not start GUI programs. Section 2.4 lists what the protocol handler must provide.
- **Safari, Firefox, and Chromium or WebKit on macOS and Linux.** The browser tests ran on Windows
  only. In CI they are skipped today: the `unit` job has no browsers, and the `e2e` job, which has
  them, does not run this file until the step of `docs/requests/W4-config.md` is added.
- **A loader built on Linux.** The engine teams report that `sim68k-loader.mjs` differs by two bytes
  between a Windows and a Linux build while the `.wasm` files are identical. The binding never looks
  inside the loader, so only its hashed asset name can differ; this was not run against a Linux
  build.
- **Out-of-memory behaviour of a real browser.** The `fatal` result for a failed instantiation was
  tested with a failure injected under Node, not by exhausting a browser.
