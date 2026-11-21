// Test support: builds a small .zip archive in memory, so that the tests of unzip.ts and of
// tools/fetch-site-examples.mjs need no archive file in the repository.
//
// No run-time imports besides node:* (see unzip.ts).

import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipInput {
  name: string;
  data: Uint8Array | string;
  /** 0 = stored, 8 = deflated (default). */
  method?: 0 | 8;
  /** For tests of the reader's checks: the CRC-32 to write instead of the right one. */
  crc?: number;
  /** General-purpose flags (bit 0 = encrypted, bit 11 = UTF-8 name). */
  flags?: number;
}

/** A .zip archive with the given entries. A name that ends in `/` is a folder entry. */
export function makeZip(entries: ZipInput[]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(typeof entry.data === 'string' ? Buffer.from(entry.data, 'latin1') : entry.data);
    const method = entry.method ?? 8;
    const stored = method === 8 ? deflateRawSync(data) : data;
    const crc = entry.crc ?? crc32(data);
    const flags = entry.flags ?? 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, stored);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(flags, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(stored.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += local.length + name.length + stored.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, directory, end]));
}
