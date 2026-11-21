// A reader for .zip archives, enough for the archives this project downloads at test time: the
// official EASy68K distribution and the example archives of the EASy68K web site (stored and
// deflated entries, no encryption, no ZIP64).
//
// The archives are untrusted input. Every entry name is checked before it is returned: a name that
// is absolute, has a drive letter or leaves the folder with `..` is refused, and every entry's
// CRC-32 and size are verified.
//
// This file has no imports that exist at run time besides node:*, so that Node can load it directly
// (`import ... from './unzip.ts'` in a .mjs script) as well as Vitest.

import { crc32, inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  /** Path inside the archive with `/` separators, as stored (already checked to be safe). */
  name: string;
  /** True for a folder entry (its name ends in `/`); `data` is then empty. */
  directory: boolean;
  data: Uint8Array;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** Throws unless `name` stays inside the folder the archive is extracted to. */
export function assertSafeEntryName(name: string): void {
  const parts = name.split('/');
  if (
    name === '' ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    /^[A-Za-z]:/.test(name) ||
    parts.some((part) => part === '..')
  ) {
    throw new Error(`unsafe path in archive: ${JSON.stringify(name)}`);
  }
}

/**
 * The entries of a .zip archive, in the order of its central directory. Throws on anything the
 * reader does not support or that does not check out (bad signature, encryption, an unknown
 * compression method, a wrong CRC-32 or size, an unsafe name).
 */
export function unzip(archive: Uint8Array): ZipEntry[] {
  const bytes = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength);
  // The end-of-central-directory record is at the end, before an optional comment of up to 64 KiB.
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (bytes.readUInt32LE(at) === EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive (no end-of-central-directory record)');
  const count = bytes.readUInt16LE(eocd + 10);
  let at = bytes.readUInt32LE(eocd + 16);
  if (count === 0xffff || at === 0xffffffff) throw new Error('ZIP64 archives are not supported');

  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index++) {
    if (bytes.readUInt32LE(at) !== CENTRAL_SIGNATURE) throw new Error('corrupt zip archive (central directory)');
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const expectedCrc = bytes.readUInt32LE(at + 16);
    const compressedSize = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const localOffset = bytes.readUInt32LE(at + 42);
    // Bit 11: the name is UTF-8; otherwise the archive's own code page, read as Latin-1 here
    // (every name in the archives this is used for is ASCII).
    const rawName = bytes.subarray(at + 46, at + 46 + nameLength);
    const name = (flags & 0x0800 ? rawName.toString('utf8') : rawName.toString('latin1')).replaceAll('\\', '/');
    at += 46 + nameLength + extraLength + commentLength;

    assertSafeEntryName(name);
    if (flags & 0x0001) throw new Error(`${name}: encrypted entries are not supported`);
    if (bytes.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new Error(`${name}: corrupt local header`);
    const dataStart = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed);
    else throw new Error(`${name}: compression method ${method} is not supported`);
    if (data.length !== size) throw new Error(`${name}: size ${data.length}, the archive says ${size}`);
    if (crc32(data) !== expectedCrc) throw new Error(`${name}: wrong CRC-32`);
    entries.push({ name, directory: name.endsWith('/'), data: new Uint8Array(data) });
  }
  return entries;
}
