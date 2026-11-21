// The .zip writer and reader of the Files panel (ARCHITECTURE.md 3.8.1, 5.9).

import { crc32 as zlibCrc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Bytes } from '../contracts';
import {
  ZipFormatError,
  crc32,
  dosDateTime,
  fromDosDateTime,
  looksLikeZip,
  readZip,
  safeZipPath,
  writeZip,
  type ZipInput,
} from './zip';

const ascii = (text: string): Bytes => Uint8Array.from(text, (c) => c.charCodeAt(0));
const when = new Date(2026, 10, 20, 14, 30, 44).getTime();

/** A .zip built by hand the way other tools build them (deflate, no UTF-8 flag, data descriptors absent). */
function foreignZip(files: { name: Bytes; data: Bytes; method: 0 | 8; flags?: number }[]): Bytes {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const { time, date } = dosDateTime(when);
  for (const file of files) {
    const packed = file.method === 8 ? new Uint8Array(deflateRawSync(file.data)) : file.data;
    const local = new Uint8Array(30 + file.name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, file.flags ?? 0, true);
    lv.setUint16(8, file.method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc32(file.data), true);
    lv.setUint32(18, packed.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, file.name.length, true);
    local.set(file.name, 30);
    const header = new Uint8Array(46 + file.name.length);
    const cv = new DataView(header.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, file.flags ?? 0, true);
    cv.setUint16(10, file.method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc32(file.data), true);
    cv.setUint32(20, packed.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, file.name.length, true);
    cv.setUint32(42, offset, true);
    header.set(file.name, 46);
    parts.push(local, packed);
    central.push(header);
    offset += local.length + packed.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

describe('crc32 and MS-DOS times', () => {
  it('crc32 equals zlib for empty, short and long inputs', () => {
    const long = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 7) & 0xff);
    for (const data of [new Uint8Array(0), ascii('123456789'), long]) expect(crc32(data)).toBe(zlibCrc32(data));
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
  });

  it('a local time survives the MS-DOS fields to the even second', () => {
    const { time, date } = dosDateTime(when);
    expect(fromDosDateTime(time, date)).toBe(new Date(2026, 10, 20, 14, 30, 44).getTime());
    const odd = dosDateTime(when + 1000);
    expect(fromDosDateTime(odd.time, odd.date)).toBe(when);
  });

  it('times before 1980 are written as 1 January 1980', () => {
    const { time, date } = dosDateTime(0);
    expect(new Date(fromDosDateTime(time, date)).getFullYear()).toBe(1980);
  });
});

describe('safeZipPath', () => {
  it('keeps ordinary names and folders', () => {
    expect(safeZipPath('demo/prog.X68')).toBe('demo/prog.X68');
    expect(safeZipPath('demo/empty/')).toBe('demo/empty/');
    expect(safeZipPath('Übung 1/Prüfung.X68')).toBe('Übung 1/Prüfung.X68');
  });
  it('reads backslashes as separators and drops roots and drive letters', () => {
    expect(safeZipPath('demo\\sub\\a.X68')).toBe('demo/sub/a.X68');
    expect(safeZipPath('/abs/a.X68')).toBe('abs/a.X68');
    expect(safeZipPath('C:\\work\\a.X68')).toBe('work/a.X68');
    expect(safeZipPath('./a/./b')).toBe('a/b');
  });
  it('refuses names that leave the folder or are empty', () => {
    expect(safeZipPath('../evil.txt')).toBeNull();
    expect(safeZipPath('a/../../evil.txt')).toBeNull();
    expect(safeZipPath('a\\..\\b')).toBeNull();
    expect(safeZipPath('')).toBeNull();
    expect(safeZipPath('/')).toBeNull();
    expect(safeZipPath('a/\u0001b')).toBeNull();
  });
});

describe('writeZip and readZip', () => {
  it('round-trips files, folders, every byte value, names in UTF-8 and the times', async () => {
    const all = Uint8Array.from({ length: 1024 }, (_, i) => i & 0xff);
    const inputs: ZipInput[] = [
      { path: 'demo/', mtime: when },
      { path: 'demo/prog.X68', data: ascii('\tORG\t$1000\r\n'), mtime: when },
      { path: 'demo/all.bin', data: all, mtime: when },
      { path: 'demo/empty/', mtime: when },
      { path: 'Übung 1/Prüfung Teil-2.X68', data: ascii('x'), mtime: when },
      { path: 'zero.txt', data: new Uint8Array(0), mtime: when },
    ];
    const zip = writeZip(inputs);
    expect(looksLikeZip(zip)).toBe(true);
    const { entries, skipped } = await readZip(zip);
    expect(skipped).toEqual([]);
    expect(entries.map((e) => e.path)).toEqual(inputs.map((i) => i.path));
    expect([...(entries[2]?.data ?? [])]).toEqual([...all]);
    expect(entries[1]?.data).toEqual(ascii('\tORG\t$1000\r\n'));
    expect(entries.every((e) => e.mtime === when)).toBe(true);
  });

  it('writes the structure every archive tool expects (signatures, UTF-8 flag, stored, sizes)', () => {
    const zip = writeZip([{ path: 'a.txt', data: ascii('hello'), mtime: when }]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(6, true)).toBe(0x0800);
    expect(view.getUint16(8, true)).toBe(0);
    expect(view.getUint32(14, true)).toBe(zlibCrc32(ascii('hello')));
    expect(view.getUint32(18, true)).toBe(5);
    expect(new TextDecoder().decode(zip.subarray(30, 35))).toBe('a.txt');
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(1);
    expect(view.getUint32(end + 16, true)).toBe(30 + 5 + 5);
    expect(zip.length).toBe(30 + 5 + 5 + 46 + 5 + 22);
  });

  it('an empty archive is 22 bytes and reads back empty', async () => {
    const zip = writeZip([]);
    expect(zip.length).toBe(22);
    expect(await readZip(zip)).toEqual({ entries: [], skipped: [] });
  });

  it('reads what other tools write: deflate, code page 437 names, UTF-8 without the flag', async () => {
    const text = ascii('MOVE.B #1,D0\r\n'.repeat(200));
    const zip = foreignZip([
      { name: ascii('dir/deflated.X68'), data: text, method: 8 },
      { name: Uint8Array.of(0x81, 0x62, 0x2e, 0x74, 0x78, 0x74), data: ascii('cp437'), method: 0 }, // "üb.txt" in CP437
      { name: new TextEncoder().encode('Grüße.txt'), data: ascii('utf8'), method: 0 },
    ]);
    const { entries, skipped } = await readZip(zip);
    expect(skipped).toEqual([]);
    expect(entries.map((e) => e.path)).toEqual(['dir/deflated.X68', 'üb.txt', 'Grüße.txt']);
    expect(entries[0]?.data).toEqual(text);
  });

  it('skips unsafe, encrypted, damaged and macOS resource-fork entries and keeps the rest', async () => {
    const zip = foreignZip([
      { name: ascii('../escape.txt'), data: ascii('x'), method: 0 },
      { name: ascii('secret.txt'), data: ascii('x'), method: 0, flags: 1 },
      { name: ascii('__MACOSX/._prog.X68'), data: ascii('x'), method: 0 },
      { name: ascii('ok.txt'), data: ascii('fine'), method: 0 },
      { name: ascii('odd.txt'), data: ascii('x'), method: 0 },
    ]);
    // Damage the CRC of odd.txt in its central entry (the last central header).
    const view = new DataView(zip.buffer);
    const central = zip.length - 22 - (46 + 7);
    expect(view.getUint32(central, true)).toBe(0x02014b50);
    view.setUint32(central + 16, 0x12345678, true);
    const { entries, skipped } = await readZip(zip);
    expect(entries.map((e) => e.path)).toEqual(['ok.txt']);
    expect(skipped.map((s) => s.reason)).toEqual(['unsafe-name', 'encrypted', 'resource-fork', 'bad-crc']);
  });

  it('refuses bytes that are not a .zip', async () => {
    await expect(readZip(ascii('this is not an archive at all, really'))).rejects.toBeInstanceOf(ZipFormatError);
    expect(looksLikeZip(ascii('PK'))).toBe(false);
  });

  it('a large archive (8 MB) round-trips', async () => {
    const big = Uint8Array.from({ length: 8 << 20 }, (_, i) => (i * 31) & 0xff);
    const { entries } = await readZip(writeZip([{ path: 'big.bin', data: big, mtime: when }]));
    expect(entries[0]?.data.length).toBe(big.length);
    expect(crc32(entries[0]?.data ?? new Uint8Array(0))).toBe(crc32(big));
  }, 60_000);
});
