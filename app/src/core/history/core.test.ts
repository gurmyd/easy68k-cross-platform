// The pure parts of the history: places, the untracked rule, the size formatter, the limits and the
// thinning schedule on hand-made timelines (ARCHITECTURE-PLUS P3.2.6, P3.3.3, P3.3.4, P4.3).

import { describe, expect, it } from 'vitest';
import { BUDGET_MAX, DAY, HOUR, MB, MINUTE, budgetFor, isTight } from './limits';
import { belowGit, besideName, childPrefix, placeOf, placeWithin, touchesGit, untrackedReason } from './places';
import { keepAtLevel, scheduleKeep, widenedKeep, type Dated } from './schedule';
import { formatSize } from './size';

const NOW = Date.UTC(2026, 10, 22, 20, 0, 0);
const text = new TextEncoder().encode('MOVE.B D0,D1\r\n');

describe('places (P4.3)', () => {
  it.each([
    ['/browser/demo/prog.X68', null, 'browser:/DEMO/PROG.X68'],
    ['/folder/sub/Prog.X68', 'r1', 'folder:r1/sub/Prog.X68'],
    ['/folder/sub/Prog.X68', null, null],
    ['/linked/3/lab1.X68', null, 'linked:3/lab1.X68'],
    ['/disk/Users/me/a.X68', null, 'disk:/Users/me/a.X68'],
    ['/memory/Examples/a.X68', null, null],
    ['not a path', null, null],
  ])('%s', (path, root, place) => {
    expect(placeOf(path, root)).toBe(place);
  });

  it('folds only the browser store', () => {
    expect(placeOf('/browser/A.x68')).toBe(placeOf('/browser/a.X68'));
    expect(placeOf('/folder/A.x68', 'r')).not.toBe(placeOf('/folder/a.X68', 'r'));
  });

  it('prefixes of folders and roots', () => {
    expect(childPrefix('browser:/DEMO')).toBe('browser:/DEMO/');
    expect(childPrefix('browser:/')).toBe('browser:/');
    expect(childPrefix('linked:')).toBe('linked:');
    expect(placeWithin('browser:/DEMO/A', 'browser:/DEMO')).toBe(true);
    expect(placeWithin('browser:/DEMOX/A', 'browser:/DEMO')).toBe(false);
  });

  it('the .git rules (P3.3.10)', () => {
    expect(belowGit('/folder/.git/config')).toBe(true);
    expect(belowGit('/folder/a/.GiT/x/y')).toBe(true);
    expect(belowGit('/folder/.git')).toBe(false);
    expect(belowGit('/folder/.github/x')).toBe(false);
    expect(touchesGit('/folder/.git')).toBe(true);
    expect(touchesGit('/git/a')).toBe(false); // a mount named git is not a folder named .git
  });

  it('the untracked rule (P3.3.3)', () => {
    expect(untrackedReason('/browser/demo/prog.X68', text.length, text)).toBeNull();
    expect(untrackedReason('/memory/a.X68', 3, text)).toBe('memory');
    expect(untrackedReason('/folder/.git/HEAD', 3, text)).toBe('git');
    expect(untrackedReason('/browser/a.l68', 3, text)).toBe('generated');
    expect(untrackedReason('/browser/a.S68', 3, text)).toBe('generated');
    expect(untrackedReason('/browser/a.X68', MB, text)).toBeNull();
    expect(untrackedReason('/browser/a.X68', MB + 1, text)).toBe('too-large');
    const binary = new Uint8Array(9000).fill(65);
    binary[8191] = 0;
    expect(untrackedReason('/browser/a.bin', binary.length, binary)).toBe('not-text');
    binary[8191] = 65;
    binary[8192] = 0;
    expect(untrackedReason('/browser/a.bin', binary.length, binary)).toBeNull();
  });

  it('the name of a restored file kept beside (P3.3.8)', () => {
    expect(besideName('/browser/demo/prog.X68', 1)).toBe('/browser/demo/prog (restored).X68');
    expect(besideName('/browser/demo/prog.X68', 2)).toBe('/browser/demo/prog (restored 2).X68');
    expect(besideName('/browser/README', 1)).toBe('/browser/README (restored)');
  });
});

describe('sizes (P3.2.6)', () => {
  it.each([
    [0, '0 bytes'],
    [1, '1 byte'],
    [1023, '1023 bytes'],
    [1024, '1.0 kB'],
    [7475, '7.3 kB'],
    [1024 * 1024 - 1, '1.0 MB'],
    [48.2 * MB, '48.2 MB'],
    [1.8 * 1024 * MB, '1.8 GB'],
  ])('%d is %s', (bytes, out) => {
    expect(formatSize(bytes)).toBe(out);
  });
});

describe('the budget (P3.3.4)', () => {
  it('B = min(64 MB, 10 % of the quota), 64 MB without an estimate', () => {
    expect(budgetFor(undefined)).toBe(BUDGET_MAX);
    expect(budgetFor(400 * MB)).toBe(40 * MB);
    expect(budgetFor(10_000 * MB)).toBe(64 * MB);
    expect(isTight({ quota: 100 * MB, usage: 68 * MB + 1 })).toBe(true);
    expect(isTight({ quota: 100 * MB, usage: 68 * MB })).toBe(false);
    expect(isTight(null)).toBe(false);
  });
});

/** Versions at these ages (newest last = highest seq). */
function timeline(ages: number[]): Dated[] {
  return ages
    .map((age) => NOW - age)
    .sort((a, b) => a - b)
    .map((time, i) => ({ seq: i + 1, time }));
}

const kept = (versions: Dated[], keep: Set<number>) =>
  versions.filter((v) => keep.has(v.seq)).map((v) => (NOW - v.time) / MINUTE);

describe('the thinning schedule (P3.3.4), hand-made timelines', () => {
  it.each<[string, number[], number[]]>([
    ['ten saves a minute apart: all ten kept', Array.from({ length: 10 }, (_, i) => i * MINUTE), Array.from({ length: 10 }, (_, i) => 9 - i)],
    [
      // the newest 10 (0..9 min), then one per 5-minute slot for the rest
      'twenty saves a minute apart today',
      Array.from({ length: 20 }, (_, i) => i * MINUTE),
      [16, 11, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0], // slots end at 19:45 and 19:50 (aligned to the hour)
    ],
    [
      // 1 to 7 days: the newest in each hour
      'yesterday: four saves in one hour, two in another, plus ten today',
      [
        ...Array.from({ length: 10 }, (_, i) => i * MINUTE),
        DAY + 10 * MINUTE,
        DAY + 20 * MINUTE,
        DAY + 30 * MINUTE,
        DAY + 40 * MINUTE,
        DAY + 2 * HOUR + 5 * MINUTE,
        DAY + 2 * HOUR + 15 * MINUTE,
      ],
      [(DAY + 2 * HOUR + 5 * MINUTE) / MINUTE, (DAY + 10 * MINUTE) / MINUTE, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
    ],
    [
      // 7 to 60 days: the newest in each day; older than 60 days: dropped, except the newest
      'old days',
      [...Array.from({ length: 10 }, (_, i) => i * MINUTE), 10 * DAY, 10 * DAY + HOUR, 59 * DAY, 61 * DAY],
      [59 * DAY / MINUTE, (10 * DAY) / MINUTE, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
    ],
  ])('%s', (_name, ages, expected) => {
    const versions = timeline(ages);
    const newest = versions[versions.length - 1]?.seq ?? 0;
    expect(kept(versions, scheduleKeep(versions, NOW, newest)).sort((a, b) => b - a)).toEqual(expected);
  });

  it('a version older than 60 days stays only when it is the newest', () => {
    const versions = timeline([61 * DAY]);
    expect(scheduleKeep(versions, NOW, 1)).toEqual(new Set([1]));
    const two = timeline([61 * DAY, 62 * DAY]);
    expect(scheduleKeep(two, NOW, 2)).toEqual(new Set([2]));
  });

  it('one save every 5 minutes for 24 hours: at most 200, the widening keeps every hour', () => {
    const versions = timeline(Array.from({ length: 288 }, (_, i) => i * 5 * MINUTE));
    const newest = versions[versions.length - 1]?.seq ?? 0;
    // At 5 minutes it would keep 288: too many, so the slots widen to 15 minutes (96 + overlap).
    expect(keepAtLevel(versions, NOW, newest, { minutes: 5, hours: 1 }).size).toBe(288);
    const keep = scheduleKeep(versions, NOW, newest);
    expect(keep.size).toBeLessThanOrEqual(200);
    expect(keep.size).toBeGreaterThan(24);
    expect(keep).toEqual(keepAtLevel(versions, NOW, newest, { minutes: 15, hours: 1 }));
  });

  it('a burst never pushes out older days', () => {
    const days = Array.from({ length: 50 }, (_, i) => (8 + i) * DAY);
    const burst = Array.from({ length: 500 }, (_, i) => i * 7_000); // 500 saves in about an hour
    const versions = timeline([...days, ...burst]);
    const newest = versions[versions.length - 1]?.seq ?? 0;
    const keep = scheduleKeep(versions, NOW, newest);
    expect(keep.size).toBeLessThanOrEqual(200);
    for (const v of versions) if (NOW - v.time >= 8 * DAY) expect(keep.has(v.seq)).toBe(true);
  });

  it('fully widened, the schedule keeps at most 123', () => {
    const ages = Array.from({ length: 60 * 24 * 12 }, (_, i) => i * 5 * MINUTE); // every 5 minutes for 60 days
    const versions = timeline(ages);
    const newest = versions[versions.length - 1]?.seq ?? 0;
    expect(widenedKeep(versions, NOW, newest).size).toBeLessThanOrEqual(123 + 2);
    expect(scheduleKeep(versions, NOW, newest).size).toBeLessThanOrEqual(200);
  });
});
