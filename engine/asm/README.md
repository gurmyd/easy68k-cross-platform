# EASy68K assembler engine (WebAssembly)

The original assembler of **EASy68K v5.16.1** (Motorola 68000 editor /
assembler / simulator, Windows, Borland C++Builder, GPL) compiled to
WebAssembly, so that programs assemble in a browser or in the macOS app
exactly as they do in the real EASy68K: the same `.L68` listing and `.S68`
S-record bytes, the same messages with the same line numbers, quirks included.

It is the C++ of the original, not a re-implementation: `src/` holds the 16
original engine files with a handful of small, marked patches (`PATCHES.md`);
`shim/` replaces the Windows GUI and the Borland run-time the files expect.

Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.

## Layout

| Path | What |
|---|---|
| `asm68k.mjs` | The public API (ES module, no dependencies, Node and browsers). |
| `src/` | The original v5.16.1 engine files (byte copies + marked patches). |
| `shim/` | Stand-in for the VCL and the Borland C run-time: `ez_prelude.h` (force-included), `ez_vcl.*` (AnsiString, editor objects, date), `ez_file.cpp` (in-memory files with Windows text mode), `ez_host.cpp` + `ez_api.h` (the C interface), `include/` (stub headers). |
| `build.mjs` | Builds `engine/dist/asm68k.wasm` and `engine/dist/asm68k-loader.mjs`. |
| `native/` | `build.mjs` builds the two native test twins with MSVC; `driver.cpp` is their command line. |
| `check-patches.mjs` | Proves that `src/` differs from the original only by the hunks listed in `PATCHES.md`. |
| `PATCHES.md` | Every change to the original sources and every behavioural decision of the shim. |
| `test/` | `node --test` suites, `corpus-diff.mjs`, test programs (`cases.mjs`) and their expected outputs (`expected.mjs`). |

## Building

Needs Node 18+ and the Emscripten SDK (see `docs/porting/toolchain.md`).
`build.mjs` finds `em++` through the `EMSDK` environment variable or in
`<repository>/.toolchain/emsdk`; it runs on Windows, macOS and Linux.

```sh
node engine/asm/build.mjs                                  # -> engine/dist/asm68k.wasm + asm68k-loader.mjs
node engine/asm/build.mjs --debug --out build/asm-dist-O0  # -O0 copy, used by test/opt-levels.test.mjs
node engine/asm/native/build.mjs                           # Windows + MSVC only: the native twins in build/asm-native/
```

## Using it

```js
import { assemble, loadEditorText } from './engine/asm/asm68k.mjs';

// What the editor does when it opens a .X68 file: drop the *~Font name~ ... trailer.
const opened = loadEditorText(bytesOfProgX68);

const files = new Map([
  ['prog.X68', opened.text],          // the main source = the editor buffer
  ['macros.x68', bytesOfMacros],      // anything the program may INCLUDE ...
  ['sound.wav', bytesOfSound],        // ... or INCBIN, by name
]);
const result = await assemble('prog.X68', files,
  { tabType: opened.tabType ?? 'fixed', tabSize: opened.tabSize ?? 4 },  // plus any option below
  new Date());                                                          // the "Created On:" time

result.listing;      // Uint8Array: prog.L68, byte for byte (Windows-1252, CR LF)
result.sRecord;      // Uint8Array: prog.S68
result.messages;     // [{ line, severity, code, text, file, resolvedFile }]
result.errorCount;   // the Assembler Status dialog
result.warningCount;
result.executeEnabled;
```

### `assemble(mainName, files, options?, timestamp?) -> Promise<AssembleResult>`

- **`mainName`**: name of the main source, a key of `files`. Names follow
  Windows rules everywhere: case-insensitive, `\` or `/`, relative names
  relative to one common root; INCLUDE / INCBIN names are resolved against the
  folder of `mainName` (also for nested includes, as in the original). A name
  such as `C:\course\x.x68` in an INCLUDE matches only a file supplied under
  that drive-letter name.
- **`files`**: `Map<string, Uint8Array>` or a plain object. The entry of the
  main source is the **editor buffer** (no trailer), saved as the editor saves
  it: every line followed by CR LF (CR LF, LF or a lone CR break lines). Other entries are read exactly as the original reads files from
  disk: text mode for INCLUDE (CR LF -> LF, Ctrl-Z ends the file), raw bytes
  for INCBIN.
- **`options`** (all optional; the defaults are a fresh EASy68K 5.16.1
  installation):

  | Option | Default | Original |
  |---|---|---|
  | `generateListing` | `true` | Generate List File |
  | `generateSRecord` | `true` | Generate S-Record |
  | `constantsExpanded` | `false` | Constants Expanded (`OPT CEX`) |
  | `bitFieldInstructions` | `true` | Assemble Bit Field Instructions (`OPT BIT`) |
  | `crossReference` | `true` | Cross Reference = symbol table (`OPT CRE`) |
  | `macrosExpanded` | `false` | Macros Expanded (`OPT MEX`) |
  | `structuredExpanded` | `false` | Structured Expanded (`OPT SEX`) |
  | `showWarnings` | `true` | Show Warnings (`OPT WAR`) |
  | `tabType` | `'fixed'` | Editor Options tab type of the document: `'assembly'` / `'fixed'` (or 0 / 1) |
  | `tabSize` | `4` | Editor Options fixed tab size (integer -99..99) |

- **`timestamp`**: a `Date` (local time) or `{ year, month, day, hour, minute,
  second }`; printed as on a US-English Windows system (`11/20/2026 1:07:46 PM`).
- Every call runs in a **fresh WebAssembly instance** (the module is compiled
  once); the original keeps state between runs in globals.
- Invalid arguments throw (`TypeError`, `RangeError`, or `Error` when the main
  file is missing). Assembler problems never throw: they are messages, or a
  `fatal` result when the run ends abnormally or the engine cannot be started
  (`The assembler could not start: ...`, for example when no WebAssembly
  instance can be created).

### The result

| Field | Meaning |
|---|---|
| `listing`, `listingName` | The `.L68` bytes (`null` when "Generate List File" is off) and its name (`mainName` with `.L68`). |
| `sRecord`, `sRecordName` | The `.S68` bytes (`null` when "Generate S-Record" is off) and its name. |
| `messages` | The editor's message list, in order. `line`: the number the original shows (the line of the file the message belongs to; 0 for an internal exception message). `severity`: `'warning'` / `'error'`. `code`: the engine's status code (e.g. `0x401`). `text`: exactly as shown (`ERROR: Invalid syntax`; FAIL texts verbatim). `file`: `null` for the main source, else the INCLUDE name as the assembler holds it; `resolvedFile`: the key of `files` it came from. |
| `errorCount`, `warningCount` | The counts of the Assembler Status dialog (hidden warnings are counted, as in the original). |
| `executeEnabled` | Whether the dialog's Execute button is enabled. |
| `dialogs` | Message boxes the original would have shown (normally none). |
| `status` | `assembleFile()`'s return value. |
| `fatal` | `null`, or a text when the run ended abnormally (all other fields are then empty). |

Other exports: `loadEditorText(bytes)` (the editor's load: strip the trailer,
read its tab type / size and font), `decodeCp1252`, `encodeCp1252`,
`changeFileExt`, `DEFAULT_OPTIONS`, and `initAssembler({ wasmUrl, wasmBinary,
wasmModule, loaderUrl })` for hosting the `.wasm` elsewhere.

Everything is bytes: give the engine Windows-1252 text, decode its output as
Windows-1252 (`decodeCp1252`). Never pass program text through a UTF-8 string.

## Testing

```sh
cd engine/asm
node --test                          # all suites (native and -O0 parts skip when not built)
node check-patches.mjs               # src/ against the original sources
node test/corpus-diff.mjs            # ~490 example programs through wasm, both twins and the 5.15.4 oracle
node test/tools/snapshot.mjs         # regenerate test/expected.mjs from the native twin (review the diff!)
```

- `test/cases.mjs` - about 90 small programs, one per behaviour of
  `docs/porting/assembler.md` section 3 (line syntax, expressions, every
  directive, INCLUDE/INCBIN, conditionals, macros, structured code, the
  quirks), each run with listing, S-records and messages compared in full
  (`cases.test.mjs`). Their expected outputs (`expected.mjs`) come from the
  native twin and were checked against the specification.
- `test/spec.test.mjs` - the key claims of the specification with hand-written
  expected values (the two v5.16.1 regressions in OPPARSE.CPP, the SIMHALT
  S-record quirk, the pass-1-to-pass-2 option leak, CR LF / LF / Ctrl-Z,
  includes, INCBIN, `%` in macros, 256 nested macro calls, long lines, the
  date line).
- `test/native.test.mjs` - every case through both native twins (MSVC, x86,
  no optimisation): the twin built from the same sources must agree exactly,
  the twin built from the unpatched sources may differ only where a patch
  applies.
- `test/opt-levels.test.mjs` - every case through the -O0 build.
- `test/api.test.mjs` - the JavaScript API.

All test programs were written for this project; the corpus run only reads
the example programs under `reference/` (not part of the repository).

## Known limits

- The behaviour is the original's, including its bugs; see
  `docs/porting/assembler.md` and `PATCHES.md`. Where the original's result
  depends on uninitialised memory (bytes emitted for an undefined symbol and
  similar), the port gives a fixed result (0) instead.
- UNVERIFIED against the real EASy68K.EXE (listed in `PATCHES.md`): `%` that
  forms a valid printf conversion in a macro body line, a lone CR inside an
  include file, bytes >= $80 outside quotes, the number of files that can be
  open at once, macro recursion deeper than about 85 levels (the original
  probably runs out of stack).
- Tested in Node 24 only. The build targets browsers (Safari 15.2+, Chrome,
  Firefox; legacy WebAssembly exception handling) but has not been run in one
  yet.
