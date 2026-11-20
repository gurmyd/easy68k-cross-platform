// asm68k.mjs - public API of the EASy68K v5.16.1 assembler engine (WebAssembly).
//
// Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.
//
// The engine is the original C++ assembler of EASy68K v5.16.1 compiled to
// WebAssembly (engine/dist/asm68k.wasm, built by engine/asm/build.mjs). This
// module is the only thing a caller needs:
//
//     import { assemble, loadEditorText } from './engine/asm/asm68k.mjs';
//     const files = new Map([['prog.X68', bytes]]);
//     const result = await assemble('prog.X68', files, {}, new Date());
//     result.listing   // Uint8Array, the .L68 file, byte-exact
//     result.sRecord   // Uint8Array, the .S68 file, byte-exact
//     result.messages  // [{ line, severity, code, text, file, resolvedFile }]
//
// It runs unchanged in Node (18+) and in browsers (Safari 15.2+, Chrome, Firefox):
// plain ES module, no dependencies, the .wasm is a separate file.
//
// Every assembly runs in a FRESH WebAssembly instance (the module is compiled
// once and cached): the original engine keeps state in globals that one run
// leaves behind for the next (docs/porting/assembler.md 1.8), so a fresh
// instance is the only way to get the same result every time.
//
// Bytes, not strings: source files are Windows-1252 bytes and are passed
// through untouched; outputs come back as the exact bytes the Windows
// original writes (CR LF line ends). File names and message texts are
// JavaScript strings, converted to and from Windows-1252.

/**
 * Tab expansion used for the source text in the listing (Editor Options,
 * per document; the `*~Tab type~` trailer of a .X68 file overrides it).
 * @typedef {'assembly' | 'fixed'} TabType
 */

/**
 * The assembler options. The first eight are the check boxes of the original's
 * "Assembler Options" dialog that reach the assembler (the ninth box, "Auto
 * Save", is an editor matter); defaults are the values a fresh installation of
 * EASy68K 5.16.1 uses (optionsS.dfm and the shipped settings.dat agree).
 *
 * @typedef {object} AssembleOptions
 * @property {boolean} [generateListing=true]      "Generate List File" (listFlag; also decides whether the .L68 is created)
 * @property {boolean} [generateSRecord=true]      "Generate S-Record" (objFlag)
 * @property {boolean} [constantsExpanded=false]   "Constants Expanded" (CEXflag; OPT CEX/NOCEX)
 * @property {boolean} [bitFieldInstructions=true] "Assemble Bit Field Instructions" (BITflag; OPT BIT)
 * @property {boolean} [crossReference=true]       "Cross Reference" = symbol table at the end of the listing (CREflag; OPT CRE)
 * @property {boolean} [macrosExpanded=false]      "Macros Expanded" (MEXflag; OPT MEX/NOMEX)
 * @property {boolean} [structuredExpanded=false]  "Structured Expanded" (SEXflag; OPT SEX/NOSEX)
 * @property {boolean} [showWarnings=true]         "Show Warnings" (WARflag; OPT WAR/NOWAR). Hidden warnings are still counted.
 * @property {TabType | 0 | 1} [tabType='fixed']   Editor Options tab type of the document (0 = Assembly, 1 = Fixed)
 * @property {number} [tabSize=4]                  Editor Options fixed tab size of the document (integer -99..99;
 *                                                 the editor allows 4..20, a file trailer up to 99; 0 behaves as in
 *                                                 the original: every listed line with a tab raises an exception message)
 */

/**
 * Local date and time printed on the "Created On:" line of the listing, as
 * the original prints `DateTimeToStr(Now())` on a US-English Windows system
 * ("11/20/2026 1:07:46 PM"; exactly midnight prints the date only).
 * A `Date` is read with its local-time getters.
 * @typedef {Date | {year:number, month:number, day:number, hour?:number, minute?:number, second?:number}} Timestamp
 */

/**
 * One row of the editor's message list (ERROR.CPP printError()).
 * @typedef {object} AsmMessage
 * @property {number} line          The number in the "Line" column: the physical line of the file the message
 *                                  belongs to (0 for an internal exception message). Quirks such as macro
 *                                  continuation lines are reproduced (docs/porting/assembler.md 4.4).
 * @property {'warning' | 'error'} severity  Class of the status code (0x1xx = warning, otherwise error).
 * @property {number} code          The engine's status code (asm.h), e.g. 0x401 for "Invalid syntax".
 * @property {string} text          The message exactly as shown, e.g. "ERROR: Invalid syntax" (FAIL texts verbatim).
 * @property {string | null} file   null for the main source; otherwise the INCLUDE file name exactly as the
 *                                  assembler holds it (upper-cased unless written in single quotes).
 * @property {string | null} resolvedFile  For an include file: the key of `files` it was read from.
 */

/**
 * A message box the original would have shown during the assembly (for
 * example "Unable to create listing file"). Normally empty.
 * @typedef {object} AsmDialog
 * @property {string} caption
 * @property {string} text
 */

/**
 * @typedef {object} AssembleResult
 * @property {Uint8Array | null} listing   The .L68 file, or null when "Generate List File" is off.
 * @property {string} listingName          Its name: the main name with the extension replaced by ".L68".
 * @property {Uint8Array | null} sRecord   The .S68 file, or null when "Generate S-Record" is off.
 * @property {string} sRecordName          Its name (".S68").
 * @property {AsmMessage[]} messages       The message list, in the order the editor shows it.
 * @property {number} errorCount           "Errors:" of the Assembler Status dialog.
 * @property {number} warningCount         "Warnings:" of the Assembler Status dialog (hidden warnings included).
 * @property {boolean} executeEnabled      Whether the dialog's Execute button is enabled (errorCount === 0).
 * @property {AsmDialog[]} dialogs         Message boxes the original would have shown.
 * @property {number} status               assembleFile()'s return value (0, or 0x400 when the source could not be read).
 * @property {string | null} fatal         null normally. Otherwise the run ended abnormally (the original would have
 *                                         ended the editor process, or the WebAssembly instance trapped); the other
 *                                         fields are then empty.
 */

/** The defaults of AssembleOptions. */
export const DEFAULT_OPTIONS = Object.freeze({
  generateListing: true,
  generateSRecord: true,
  constantsExpanded: false,
  bitFieldInstructions: true,
  crossReference: true,
  macrosExpanded: false,
  structuredExpanded: false,
  showWarnings: true,
  tabType: 'fixed',
  tabSize: 4,
});

// ---------------------------------------------------------------- Windows-1252

const CP1252_HIGH = [
  0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8D, 0x017D, 0x8F,
  0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x9D, 0x017E, 0x0178,
];

/**
 * Windows-1252 bytes -> string (bytes 0x81, 0x8D, 0x8F, 0x90, 0x9D map to the same code points).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decodeCp1252(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    s += String.fromCharCode(b >= 0x80 && b < 0xA0 ? CP1252_HIGH[b - 0x80] : b);
  }
  return s;
}

/**
 * String -> Windows-1252 bytes. Characters that Windows-1252 cannot represent
 * become '?', as Windows' best-fit conversion would mostly do.
 * @param {string} text
 * @returns {Uint8Array}
 */
export function encodeCp1252(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80 || (c >= 0xA0 && c <= 0xFF)) out[i] = c;
    else {
      const k = CP1252_HIGH.indexOf(c);
      out[i] = k >= 0 ? 0x80 + k : 0x3F;
    }
  }
  return out;
}

// ----------------------------------------------------- what the editor does

/**
 * What the original editor does when it opens a source file
 * (TTextStuff::LoadFile, textS.cpp:107-206): it removes the font/tab trailer
 * lines (`*~Font name~...~`, `*~Font size~..~`, `*~Tab type~.~`, `*~Tab size~..~`)
 * found among the last four lines, and takes the tab settings from them. The
 * assembler never sees those lines. Pass `text` of the result to assemble()
 * as the main source, and its `tabType` / `tabSize` (when not null) as options.
 *
 * The returned text is what the editor's "SaveToFile" writes for the
 * assembler: every line, the last one included, ends in CR LF. Line breaks
 * in the input are CR LF, LF or CR, as for the VCL TStrings class. (How the
 * original's rich-edit control treats a lone LF or CR is UNVERIFIED.)
 *
 * @param {Uint8Array} fileBytes  the .X68 file as stored on disk
 * @returns {{ text: Uint8Array, tabType: TabType | null, tabSize: number | null,
 *             fontName: string | null, fontSize: number | null }}
 */
export function loadEditorText(fileBytes) {
  /** @type {Uint8Array[]} */
  const lines = [];
  let start = 0;
  let i = 0;
  while (i < fileBytes.length) {
    const b = fileBytes[i];
    if (b === 0x0D || b === 0x0A) {
      lines.push(fileBytes.subarray(start, i));
      i += b === 0x0D && fileBytes[i + 1] === 0x0A ? 2 : 1;
      start = i;
    } else i++;
  }
  if (start < fileBytes.length) lines.push(fileBytes.subarray(start));

  let tabType = null, tabSize = null, fontName = null, fontSize = null;
  const asText = (line) => decodeCp1252(line);
  /** Characters from 1-based position `from` up to (not including) the next '~'. */
  const field = (s, from, max) => {
    let t = '';
    for (let k = from - 1; k < s.length && s[k] !== '~' && t.length < max; k++) t += s[k];
    return t;
  };
  // textS.cpp:140: for (cnt = count; cnt > count-5; cnt--) - index count is past the end
  const count = lines.length;
  for (let cnt = count; cnt > count - 5; cnt--) {
    if (cnt < 0 || cnt >= lines.length) continue;
    const s = asText(lines[cnt]);
    if (s.startsWith('*~Tab size~')) {
      tabSize = Number.parseInt(field(s, 12, 2), 10);
      if (Number.isNaN(tabSize)) tabSize = 0;             // atoi("")
      lines.splice(cnt, 1);
    } else if (s.startsWith('*~Tab type~')) {
      tabType = s[11] === '0' ? 'assembly' : 'fixed';
      lines.splice(cnt, 1);
    } else if (s.startsWith('*~Font size~')) {
      fontSize = Number.parseInt(field(s, 13, 2), 10);
      if (Number.isNaN(fontSize)) fontSize = 0;
      lines.splice(cnt, 1);
    } else if (s.startsWith('*~Font name~')) {
      fontName = field(s, 13, Infinity);
      lines.splice(cnt, 1);
    }
  }
  return { text: saveToFileBytes(lines), tabType, tabSize, fontName, fontSize };
}

/**
 * Lines -> bytes as TStrings::SaveToFile writes them: each line followed by CR LF.
 * @param {Uint8Array[]} lines
 * @returns {Uint8Array}
 */
function saveToFileBytes(lines) {
  let n = 0;
  for (const l of lines) n += l.length + 2;
  const out = new Uint8Array(n);
  let p = 0;
  for (const l of lines) {
    out.set(l, p);
    p += l.length;
    out[p++] = 0x0D;
    out[p++] = 0x0A;
  }
  return out;
}

// ------------------------------------------------------------------ the module

/** @type {Promise<WebAssembly.Module> | null} */
let compiled = null;
/** @type {any} */
let createModule = null;
/** @type {URL | string | null} */
let wasmLocation = null;
/** @type {URL | string | null} */
let loaderLocation = null;

/**
 * Optional: tell the module where asm68k.wasm is, or hand it the bytes or a
 * compiled module (for bundlers, workers or offline use). Without a call the
 * file is expected at ../dist/asm68k.wasm relative to this module, and the loader
 * that belongs to it at ../dist/asm68k-loader.mjs (`loaderUrl` replaces it, for
 * example to use a debug build; it must be the loader built with that .wasm).
 * @param {{ wasmUrl?: URL | string, wasmBinary?: ArrayBuffer | Uint8Array, wasmModule?: WebAssembly.Module,
 *           loaderUrl?: URL | string }} [config]
 * @returns {Promise<void>}  resolves when the module is compiled
 */
export async function initAssembler(config = {}) {
  if (config.loaderUrl) { loaderLocation = config.loaderUrl; createModule = null; }
  if (config.wasmModule) compiled = Promise.resolve(config.wasmModule);
  else if (config.wasmBinary) compiled = WebAssembly.compile(config.wasmBinary);
  else {
    if (config.wasmUrl) wasmLocation = config.wasmUrl;
    compiled = null;
  }
  await getCompiled();
}

async function getCompiled() {
  if (!compiled) {
    const url = wasmLocation ? new URL(String(wasmLocation), import.meta.url) : new URL('../dist/asm68k.wasm', import.meta.url);
    compiled = (async () => {
      if (url.protocol === 'file:') {
        const { readFile } = await import('node:fs/promises');
        return WebAssembly.compile(await readFile(url));
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error(`cannot load ${url}: HTTP ${response.status}`);
      if (typeof WebAssembly.compileStreaming === 'function' &&
          (response.headers.get('content-type') || '').startsWith('application/wasm')) {
        return WebAssembly.compileStreaming(response);
      }
      return WebAssembly.compile(await response.arrayBuffer());
    })();
    compiled.catch(() => { compiled = null; });
  }
  return compiled;
}

async function newInstance() {
  const module = await getCompiled();
  if (!createModule) {
    createModule = (await (loaderLocation
      ? import(String(new URL(String(loaderLocation), import.meta.url)))
      : import('../dist/asm68k-loader.mjs'))).default;
  }
  return createModule({
    instantiateWasm(imports, receive) {
      WebAssembly.instantiate(module, imports).then((instance) => receive(instance, module));
      return {};
    },
    print() {},
    printErr() {},
  });
}

// ------------------------------------------------------------------- helpers

/**
 * @param {Map<string, Uint8Array> | Record<string, Uint8Array>} files
 * @returns {Array<[string, Uint8Array]>}
 */
function fileEntries(files) {
  const entries = files instanceof Map ? [...files.entries()] : Object.entries(files || {});
  for (const [name, data] of entries) {
    if (typeof name !== 'string' || !(data instanceof Uint8Array)) {
      throw new TypeError(`files: every entry must be a string name and a Uint8Array (got ${typeof name} ${Object.prototype.toString.call(data)})`);
    }
  }
  return entries;
}

/** Windows-style case-insensitive key of a name, for finding the main file. */
function nameKey(name) {
  return name.replace(/\//g, '\\').toUpperCase();
}

function boolOption(options, key) {
  const v = options[key] === undefined ? DEFAULT_OPTIONS[key] : options[key];
  if (typeof v !== 'boolean') throw new TypeError(`options.${key} must be a boolean`);
  return v ? 1 : 0;
}

function timeParts(timestamp) {
  if (timestamp instanceof Date) {
    if (Number.isNaN(timestamp.getTime())) throw new RangeError('timestamp is an invalid Date');
    return [timestamp.getFullYear(), timestamp.getMonth() + 1, timestamp.getDate(),
      timestamp.getHours(), timestamp.getMinutes(), timestamp.getSeconds()];
  }
  if (timestamp && typeof timestamp === 'object') {
    const t = /** @type {any} */ (timestamp);
    const parts = [t.year, t.month, t.day, t.hour ?? 0, t.minute ?? 0, t.second ?? 0];
    if (!parts.every((x) => Number.isInteger(x))) throw new TypeError('timestamp fields must be integers');
    return parts;
  }
  throw new TypeError('timestamp must be a Date or {year, month, day, hour, minute, second}');
}

// -------------------------------------------------------------------- assemble

/**
 * Assembles a program exactly as EASy68K 5.16.1's "Assemble Source" does.
 *
 * @param {string} mainName  Name of the main source, e.g. "prog.X68" or "course/lab1/prog.X68" or
 *                           "C:\\course\\prog.X68". It must be a key of `files` (compared as Windows
 *                           does: case-insensitive, '/' = '\\'). INCLUDE and INCBIN names are
 *                           resolved against its folder.
 * @param {Map<string, Uint8Array> | Record<string, Uint8Array>} files  Every file the program may read,
 *                           by name (same naming rules as mainName; relative names are relative to the
 *                           same root). The entry of the main source is the EDITOR BUFFER: the text the
 *                           editor holds, without the `*~Font name~` trailer (see loadEditorText()). It is
 *                           saved as the editor saves it: each line, the last one included, followed by
 *                           CR LF (CR LF, LF and a lone CR are all line breaks).
 *                           Include files are read as they are, with Windows text-mode rules (CR LF ->
 *                           LF, Ctrl-Z ends the file); INCBIN files as raw bytes.
 * @param {AssembleOptions} [options]
 * @param {Timestamp} [timestamp]  For the "Created On:" line. Default: now.
 * @returns {Promise<AssembleResult>}
 */
export async function assemble(mainName, files, options = {}, timestamp = new Date()) {
  if (typeof mainName !== 'string' || !mainName) throw new TypeError('mainName must be a non-empty string');
  const entries = fileEntries(files);
  const mainEntry = entries.find(([name]) => name === mainName) ||
    entries.find(([name]) => nameKey(name) === nameKey(mainName));
  if (!mainEntry) throw new Error(`files has no entry for the main source "${mainName}"`);
  const source = mainEntry[1];   // the engine glue appends CR LF to a last line without one

  const flags = ['generateListing', 'generateSRecord', 'constantsExpanded', 'bitFieldInstructions',
    'crossReference', 'macrosExpanded', 'structuredExpanded', 'showWarnings'].map((k) => boolOption(options, k));
  const tabTypeOpt = options.tabType === undefined ? DEFAULT_OPTIONS.tabType : options.tabType;
  let tabType;
  if (tabTypeOpt === 'assembly' || tabTypeOpt === 0) tabType = 0;
  else if (tabTypeOpt === 'fixed' || tabTypeOpt === 1) tabType = 1;
  else throw new TypeError("options.tabType must be 'assembly' or 'fixed'");
  const tabSize = options.tabSize === undefined ? DEFAULT_OPTIONS.tabSize : options.tabSize;
  if (!Number.isInteger(tabSize) || tabSize < -99 || tabSize > 99) throw new RangeError('options.tabSize must be an integer from -99 to 99');
  const time = timeParts(timestamp);

  const M = await newInstance();
  const heap = () => M.HEAPU8;
  /** @param {Uint8Array} bytes @param {boolean} [nul] */
  const put = (bytes, nul = false) => {
    const p = M._ez_alloc(bytes.length + (nul ? 1 : 0));
    heap().set(bytes, p);
    if (nul) heap()[p + bytes.length] = 0;
    return p;
  };
  const cstr = (p) => {
    const h = heap();
    let e = p;
    while (h[e]) e++;
    return decodeCp1252(h.slice(p, e));
  };
  const bytesOfNode = (i) => {
    const n = M._ez_fs_size(i);
    const p = M._ez_fs_data(i);
    return n && p ? heap().slice(p, p + n) : new Uint8Array(0);
  };

  /** @type {Map<number, string>} node index -> caller's key */
  const nodeName = new Map();
  try {
    for (const [name, data] of entries) {
      const pn = put(encodeCp1252(name), true);
      const pd = put(data);
      const idx = M._ez_fs_add(pn, pd, data.length);
      if (idx >= 0) nodeName.set(idx, name);
      M._ez_free(pn);
      M._ez_free(pd);
    }
    M._ez_set_options(...flags, tabType, tabSize);
    M._ez_set_time(...time);
    const pw = put(encodeCp1252(mainName), true);
    const ps = put(source);
    const status = M._ez_assemble(pw, ps, source.length);

    /** @type {AsmMessage[]} */
    const messages = [];
    for (let i = 0, n = M._ez_msg_count(); i < n; i++) {
      const code = M._ez_msg_code(i);
      const file = cstr(M._ez_msg_file(i));
      const node = M._ez_msg_file_node(i);
      messages.push({
        line: M._ez_msg_line(i),
        severity: code > 0x100 && code < 0x200 ? 'warning' : 'error',
        code,
        text: cstr(M._ez_msg_text(i)),
        file: file || null,
        resolvedFile: file && node >= 0 ? (nodeName.get(node) ?? cstr(M._ez_fs_name(node))) : null,
      });
    }
    /** @type {AsmDialog[]} */
    const dialogs = [];
    for (let i = 0, n = M._ez_dialog_count(); i < n; i++) {
      dialogs.push({ caption: cstr(M._ez_dialog_caption(i)), text: cstr(M._ez_dialog_text(i)) });
    }
    const nl = M._ez_output_node(0);
    const ns = M._ez_output_node(1);
    return {
      listing: nl >= 0 ? bytesOfNode(nl) : null,
      listingName: changeFileExt(mainName, '.L68'),
      sRecord: ns >= 0 ? bytesOfNode(ns) : null,
      sRecordName: changeFileExt(mainName, '.S68'),
      messages,
      errorCount: M._ez_error_count(),
      warningCount: M._ez_warning_count(),
      executeEnabled: M._ez_execute_enabled() !== 0,
      dialogs,
      status,
      fatal: null,
    };
  } catch (error) {
    let exitCalled = false;
    try { exitCalled = M._ez_exit_called() !== 0; } catch { /* instance unusable */ }
    return {
      listing: null, listingName: changeFileExt(mainName, '.L68'),
      sRecord: null, sRecordName: changeFileExt(mainName, '.S68'),
      messages: [], errorCount: 0, warningCount: 0, executeEnabled: false, dialogs: [], status: -1,
      fatal: exitCalled
        ? 'The assembler called exit() ("INVALID EFFECTIVE ADDRESSING MODE!"); the original editor would have closed.'
        : `The assembler stopped abnormally: ${error && error.message ? error.message : String(error)}`,
    };
  }
}

/**
 * VCL ChangeFileExt: replace the extension after the last '.' of the file-name
 * part ('\\', '/' and ':' end the folder part), or append it.
 * @param {string} name
 * @param {string} ext
 * @returns {string}
 */
export function changeFileExt(name, ext) {
  const cut = Math.max(name.lastIndexOf('\\'), name.lastIndexOf('/'), name.lastIndexOf(':'));
  const dot = name.lastIndexOf('.');
  return (dot > cut ? name.slice(0, dot) : name) + ext;
}
