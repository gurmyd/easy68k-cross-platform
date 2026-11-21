// A minimal .zip writer and reader (ARCHITECTURE.md 3.8.1, 5.9): the Files panel's Export... writes
// a folder or the whole browser store as a .zip, and Import... reads one back.
//
//     const bytes = writeZip([{ path: 'demo/prog.X68', data, mtime }, { path: 'demo/empty/', mtime }]);
//     const { entries, skipped } = await readZip(bytes);
//
// The writer stores files without compression ("store-only", method 0), with UTF-8 names (general
// purpose bit 11) and the local modification time in the MS-DOS fields. That is the zip every
// system's archive tool opens: Windows Explorer, macOS Archive Utility, unzip, 7-Zip.
//
// The reader takes what the writer writes and also what those tools write: method 0 and method 8
// (deflate, unpacked with the browser's DecompressionStream), names in UTF-8 or, without bit 11,
// in code page 437. It never writes outside the folder it imports into: names are cleaned by
// safeZipPath() and entries that leave the folder are skipped, as are encrypted entries, entries
// whose CRC does not match and the "__MACOSX/" resource-fork copies of macOS.
//
// Limits: no ZIP64 (an archive of 4 GB or more, or of more than 65535 entries, is refused); the
// browser store's own limits are far below that.
//
// Owner: FS1.

import type { Bytes } from '../contracts';

export interface ZipInput {
  /** '/' separators, no leading '/'. A folder entry ends in '/' and has no data. */
  path: string;
  data?: Bytes;
  /** Modification time, milliseconds since 1970 (local time is written, as Windows does). */
  mtime: number;
}

export interface ZipEntry {
  path: string; // a file: no trailing '/'; a folder: trailing '/'
  data: Bytes;
  mtime: number;
}

export interface ZipSkipped {
  path: string;
  reason: 'unsafe-name' | 'encrypted' | 'unsupported-method' | 'bad-crc' | 'corrupt' | 'resource-fork';
}

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipFormatError';
  }
}

// ---- CRC-32 (IEEE 802.3, the polynomial of zip) ----------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Bytes): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = (CRC_TABLE[(crc ^ (data[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ---- MS-DOS date and time ------------------------------------------------------------------------------

/** The MS-DOS time and date fields of a moment, in local time (2-second resolution, 1980-2107). */
export function dosDateTime(mtime: number): { time: number; date: number } {
  let d = new Date(Number.isFinite(mtime) ? mtime : 0);
  if (d.getFullYear() < 1980) d = new Date(1980, 0, 1, 0, 0, 0);
  if (d.getFullYear() > 2107) d = new Date(2107, 11, 31, 23, 59, 58);
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export function fromDosDateTime(time: number, date: number): number {
  const year = ((date >> 9) & 0x7f) + 1980;
  const month = ((date >> 5) & 0x0f) - 1;
  const day = date & 0x1f;
  const result = new Date(year, month, day || 1, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2);
  return result.getTime();
}

// ---- names -------------------------------------------------------------------------------------------

/**
 * The name of an entry as a path below the import folder, or null when it is unsafe: '\' is read
 * as '/', a leading '/' or drive letter is dropped, "." segments are dropped, and a ".." segment,
 * an empty name or a control character makes the entry unsafe. A folder keeps its trailing '/'.
 */
export function safeZipPath(name: string): string | null {
  const unified = name.replace(/\\/g, '/');
  const isFolder = unified.endsWith('/');
  let rest = unified.replace(/^[A-Za-z]:/, '');
  rest = rest.replace(/^\/+/, '');
  const segments: string[] = [];
  for (const segment of rest.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return null;
    // eslint-disable-next-line no-control-regex -- control characters are what this looks for
    if (/[\u0000-\u001f]/.test(segment)) return null;
    segments.push(segment);
  }
  if (segments.length === 0) return null;
  return segments.join('/') + (isFolder ? '/' : '');
}

const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function decodeCp437(bytes: Bytes): string {
  let out = '';
  for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : (CP437_HIGH[b - 0x80] as string);
  return out;
}

const utf8 = new TextEncoder();
const utf8Strict = new TextDecoder('utf-8', { fatal: true });

// ---- writer -----------------------------------------------------------------------------------------

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const LIMIT = 0xffffffff;

/** A store-only .zip of the given entries, in the given order. */
export function writeZip(inputs: readonly ZipInput[]): Bytes {
  if (inputs.length > 0xffff) throw new ZipFormatError('more than 65535 entries (ZIP64 is not supported)');
  const prepared = inputs.map((input) => {
    const isFolder = input.path.endsWith('/');
    const data = isFolder ? new Uint8Array(0) : (input.data ?? new Uint8Array(0));
    const name = utf8.encode(input.path);
    if (name.length > 0xffff) throw new ZipFormatError(`name too long: ${input.path}`);
    return { name, data, crc: crc32(data), ...dosDateTime(input.mtime), isFolder };
  });
  let size = 22;
  for (const entry of prepared) size += 30 + entry.name.length + entry.data.length + 46 + entry.name.length;
  if (size > LIMIT) throw new ZipFormatError('the archive would be 4 GB or larger (ZIP64 is not supported)');

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  const offsets: number[] = [];
  for (const entry of prepared) {
    offsets.push(at);
    view.setUint32(at, LOCAL_HEADER, true);
    view.setUint16(at + 4, 20, true); // version needed: 2.0
    view.setUint16(at + 6, FLAG_UTF8, true);
    view.setUint16(at + 8, 0, true); // stored
    view.setUint16(at + 10, entry.time, true);
    view.setUint16(at + 12, entry.date, true);
    view.setUint32(at + 14, entry.crc, true);
    view.setUint32(at + 18, entry.data.length, true);
    view.setUint32(at + 22, entry.data.length, true);
    view.setUint16(at + 26, entry.name.length, true);
    view.setUint16(at + 28, 0, true);
    out.set(entry.name, at + 30);
    out.set(entry.data, at + 30 + entry.name.length);
    at += 30 + entry.name.length + entry.data.length;
  }
  const centralStart = at;
  prepared.forEach((entry, i) => {
    view.setUint32(at, CENTRAL_HEADER, true);
    view.setUint16(at + 4, (3 << 8) | 20, true); // made by: Unix, 2.0 (so the mode below counts)
    view.setUint16(at + 6, 20, true);
    view.setUint16(at + 8, FLAG_UTF8, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, entry.time, true);
    view.setUint16(at + 14, entry.date, true);
    view.setUint32(at + 16, entry.crc, true);
    view.setUint32(at + 20, entry.data.length, true);
    view.setUint32(at + 24, entry.data.length, true);
    view.setUint16(at + 28, entry.name.length, true);
    view.setUint16(at + 30, 0, true); // extra
    view.setUint16(at + 32, 0, true); // comment
    view.setUint16(at + 34, 0, true); // disk
    view.setUint16(at + 36, 0, true); // internal attributes
    // External attributes: Unix mode in the high half (drwxr-xr-x / -rw-r--r--), MS-DOS folder bit.
    const mode = entry.isFolder ? 0o040755 : 0o100644;
    view.setUint32(at + 38, ((mode << 16) | (entry.isFolder ? 0x10 : 0)) >>> 0, true);
    view.setUint32(at + 42, offsets[i] as number, true);
    out.set(entry.name, at + 46);
    at += 46 + entry.name.length;
  });
  const centralSize = at - centralStart;
  view.setUint32(at, END_OF_CENTRAL, true);
  view.setUint16(at + 4, 0, true);
  view.setUint16(at + 6, 0, true);
  view.setUint16(at + 8, prepared.length, true);
  view.setUint16(at + 10, prepared.length, true);
  view.setUint32(at + 12, centralSize, true);
  view.setUint32(at + 16, centralStart, true);
  view.setUint16(at + 20, 0, true);
  return out;
}

// ---- reader -------------------------------------------------------------------------------------

/** True if the bytes start like a .zip (a local header or an empty archive). */
export function looksLikeZip(bytes: Bytes): boolean {
  if (bytes.length < 4) return false;
  const signature = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  return signature === LOCAL_HEADER || signature === END_OF_CENTRAL;
}

async function inflateRaw(data: Bytes): Promise<Bytes> {
  if (typeof DecompressionStream === 'undefined') throw new ZipFormatError('this browser cannot unpack deflate');
  const stream = new Blob([data as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The entries of a .zip, in central-directory order, with safe paths (safeZipPath). Throws
 * ZipFormatError when the bytes are not a .zip at all; entries that cannot be used are listed in
 * `skipped` and the rest is still returned.
 */
export async function readZip(bytes: Bytes): Promise<{ entries: ZipEntry[]; skipped: ZipSkipped[] }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record: 22 bytes plus a comment of up to 65535 bytes.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipFormatError('not a .zip file (no central directory)');
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralStart = view.getUint32(end + 16, true);
  if (count === 0xffff || centralStart === LIMIT || centralSize === LIMIT) {
    throw new ZipFormatError('ZIP64 archives are not supported');
  }
  if (centralStart + centralSize > end) throw new ZipFormatError('the central directory lies outside the file');

  const entries: ZipEntry[] = [];
  const skipped: ZipSkipped[] = [];
  let at = centralStart;
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || view.getUint32(at, true) !== CENTRAL_HEADER) {
      throw new ZipFormatError('the central directory is damaged');
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const time = view.getUint16(at + 12, true);
    const date = view.getUint16(at + 14, true);
    const crc = view.getUint32(at + 16, true);
    const packed = view.getUint32(at + 20, true);
    const unpacked = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const rawName = bytes.subarray(at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;

    let name: string;
    if (flags & FLAG_UTF8) {
      name = new TextDecoder().decode(rawName);
    } else {
      // Without bit 11 the name is code page 437; macOS's Archive Utility writes UTF-8 without the
      // bit, so valid UTF-8 with multi-byte sequences is taken as UTF-8.
      try {
        name = utf8Strict.decode(rawName);
      } catch {
        name = decodeCp437(rawName);
      }
    }
    if (name.startsWith('__MACOSX/') || name.split(/[\\/]/).pop()?.startsWith('._')) {
      skipped.push({ path: name, reason: 'resource-fork' });
      continue;
    }
    const path = safeZipPath(name);
    if (path === null) {
      skipped.push({ path: name, reason: 'unsafe-name' });
      continue;
    }
    const mtime = fromDosDateTime(time, date);
    if (path.endsWith('/')) {
      entries.push({ path, data: new Uint8Array(0), mtime });
      continue;
    }
    if (flags & 0x0001) {
      skipped.push({ path, reason: 'encrypted' });
      continue;
    }
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL_HEADER) {
      skipped.push({ path, reason: 'corrupt' });
      continue;
    }
    const dataStart =
      localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (dataStart + packed > bytes.length) {
      skipped.push({ path, reason: 'corrupt' });
      continue;
    }
    const raw = bytes.subarray(dataStart, dataStart + packed);
    let data: Bytes;
    if (method === 0) {
      data = raw.slice();
    } else if (method === 8) {
      try {
        data = await inflateRaw(raw);
      } catch {
        skipped.push({ path, reason: typeof DecompressionStream === 'undefined' ? 'unsupported-method' : 'corrupt' });
        continue;
      }
    } else {
      skipped.push({ path, reason: 'unsupported-method' });
      continue;
    }
    if (data.length !== unpacked || crc32(data) !== crc) {
      skipped.push({ path, reason: 'bad-crc' });
      continue;
    }
    entries.push({ path, data, mtime });
  }
  return { entries, skipped };
}
