// The thinning schedule of earlier versions (ARCHITECTURE-PLUS P3.3.4). Owner: N3.
//
// Pure; runs under Node. Applied to one record after each version kept for it, and in its widest
// form to every living record when the versions half is pruned (step 1 of P3.3.4):
//
//   the newest 10 versions always;
//   younger than 1 day:  the newest in each 5-minute slot;
//   1 to 7 days:         the newest in each hour;
//   7 to 60 days:        the newest in each day;
//   older than 60 days:  dropped, except the record's newest.
//
// When that keeps more than 200, the 5-minute slots widen to 15, 30 and 60 minutes, then the hourly
// slots to 2 and 4 hours, and then the oldest are dropped (a guard: fully widened, the schedule
// keeps at most 10 + 24 + 36 + 53 = 123).
//
// Decisions (errata N3, entry "schedule"): slots are aligned to multiples of their width since
// 1970 in UTC, so that every window computes the same slots; "older than 60 days" wins over "the
// newest 10" (a version older than 60 days is dropped unless it is its record's newest); the
// record's newest version (its `newestSeq`, the copy of a record in the Trash) is always kept.

import { ALWAYS_KEPT, DAY, HOUR, MAX_VERSIONS, MINUTE, VERSION_AGE } from './limits';

/** What the schedule needs of a version. */
export interface Dated {
  seq: number;
  time: number;
}

/** The width of the young slots (minutes) and of the middle slots (hours). */
export interface ScheduleLevel {
  minutes: number;
  hours: number;
}

/** The levels of widening, narrowest first (P3.3.4). */
export const SCHEDULE_LEVELS: readonly ScheduleLevel[] = [
  { minutes: 5, hours: 1 },
  { minutes: 15, hours: 1 },
  { minutes: 30, hours: 1 },
  { minutes: 60, hours: 1 },
  { minutes: 60, hours: 2 },
  { minutes: 60, hours: 4 },
];
/** The widened schedule of pruning step 1: 60-minute and 4-hour slots (P3.3.4). */
export const WIDEST_LEVEL: ScheduleLevel = { minutes: 60, hours: 4 };

/** Newest first: by time, then by seq. */
function newestFirst(a: Dated, b: Dated): number {
  return b.time - a.time || b.seq - a.seq;
}

/** The seqs the schedule keeps at one level. */
export function keepAtLevel(
  versions: readonly Dated[],
  now: number,
  newestSeq: number,
  level: ScheduleLevel,
): Set<number> {
  const sorted = [...versions].sort(newestFirst);
  const keep = new Set<number>();
  if (versions.some((v) => v.seq === newestSeq)) keep.add(newestSeq);
  let always = 0;
  const slots = new Set<string>();
  for (const v of sorted) {
    const age = Math.max(0, now - v.time);
    if (age > VERSION_AGE) continue;
    if (always < ALWAYS_KEPT) {
      always++;
      keep.add(v.seq);
    }
    const slot =
      age < DAY
        ? `m${Math.floor(v.time / (level.minutes * MINUTE))}`
        : age < 7 * DAY
          ? `h${Math.floor(v.time / (level.hours * HOUR))}`
          : `d${Math.floor(v.time / DAY)}`;
    if (!slots.has(slot)) {
      slots.add(slot);
      keep.add(v.seq);
    }
  }
  return keep;
}

/** The seqs kept after a version was kept for this record: the schedule, widened as needed, and the cap. */
export function scheduleKeep(versions: readonly Dated[], now: number, newestSeq: number): Set<number> {
  for (const level of SCHEDULE_LEVELS) {
    const keep = keepAtLevel(versions, now, newestSeq, level);
    if (keep.size <= MAX_VERSIONS) return keep;
  }
  // The guard: never reached in practice, since the widest level keeps at most 123.
  const keep = keepAtLevel(versions, now, newestSeq, WIDEST_LEVEL);
  const oldestFirst = versions.filter((v) => keep.has(v.seq)).sort((a, b) => -newestFirst(a, b));
  for (const v of oldestFirst) {
    if (keep.size <= MAX_VERSIONS) break;
    if (v.seq !== newestSeq) keep.delete(v.seq);
  }
  return keep;
}

/** The seqs the widened schedule of pruning step 1 keeps (P3.3.4). */
export function widenedKeep(versions: readonly Dated[], now: number, newestSeq: number): Set<number> {
  return keepAtLevel(versions, now, newestSeq, WIDEST_LEVEL);
}
