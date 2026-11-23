// The numbers of the safety net (ARCHITECTURE-PLUS P3.3.4, P3.3.5). Owner: N3.
//
// Pure; runs under Node. Every limit of the history is here, once, so that the store, its model
// test and the stress test read the same numbers.

/** One megabyte (1 MB = 1,048,576 bytes, as P3.2.6 counts). */
export const MB = 1 << 20;
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Each record counts 128 bytes, and each version its content's stored size plus 128 (P3.3.4). */
export const RECORD_BYTES = 128;

/** The largest file given versions, and the largest version the versions half admits (P3.3.4). */
export const LARGEST_VERSION = MB;
/** The largest copy kept in the Trash, per file (P3.3.4). */
export const LARGEST_COPY = 20 * MB;
/** Versions per record after each kept version (P3.3.4). */
export const MAX_VERSIONS = 200;
/** The newest versions the thinning schedule always keeps (P3.3.4). */
export const ALWAYS_KEPT = 10;

/** A Trash item stays at most this long (P3.3.4). */
export const TRASH_AGE = 30 * DAY;
/** A version older than this is dropped, except the newest of a living record (P3.3.4). */
export const VERSION_AGE = 60 * DAY;

/** B = min(64 MB, 10 % of the quota); 64 MB without an estimate (P3.3.4). */
export const BUDGET_MAX = 64 * MB;
export const BUDGET_SHARE = 0.1;
/** Admission prunes a half down to this share of B / 2 (P3.3.4). */
export const PRUNE_TO = 0.9;

/** Storage is tight below this much free space (`quota - usage`), P3.3.4. */
export const TIGHT_FREE = 32 * MB;
/** A pass that sees more free space than this arms the lowering again (P3.3.4). */
export const REARM_FREE = 64 * MB;

/** The global pass works in transactions of at most this many records (P3.3.4). */
export const PASS_RECORDS = 500;
/** The global pass: first 10 s after the window opens, then every 10 minutes (P3.3.4). */
export const PASS_FIRST_DELAY = 10_000;
export const PASS_INTERVAL = 10 * MINUTE;

/** `record()` calls wait in a queue of at most 16 MB (P3.3.5). */
export const RECORD_QUEUE_BYTES = 16 * MB;
/** An open that does not succeed within 5 s makes the history unavailable (P3.3.5), until the
 *  browser answers that open (errata N3, "A slow open"). */
export const OPEN_TIMEOUT = 5_000;

/**
 * How long another window's mark on an item it is deleting protects that item from pruning when
 * there are no Web Locks to tell whether that window is still open (errata N3, open case 2).
 */
export const PENDING_TTL = HOUR;

/** The database and its version, for good (P3.3.5). */
export const HISTORY_DB_NAME = 'easy68k-history';
export const HISTORY_DB_VERSION = 1;
/** The Web Lock of the global pass, the BroadcastChannel of changes (P3.3.4, P3.3.8). */
export const PASS_LOCK = 'easy68k.history.pass';
export const HISTORY_CHANNEL = 'easy68k.history';
/** Each window holds this lock (with its own id appended) while it is open (errata N3, case 2). */
export const WINDOW_LOCK_PREFIX = 'easy68k.history.window.';

/** What a `quota` gives for B (P3.3.4). */
export function budgetFor(quota: number | undefined): number {
  if (quota === undefined || !Number.isFinite(quota) || quota <= 0) return BUDGET_MAX;
  return Math.min(BUDGET_MAX, Math.floor(quota * BUDGET_SHARE));
}

/** True when `quota - usage` is below 32 MB (P3.3.4); false without an estimate. */
export function isTight(estimate: { quota?: number; usage?: number } | null): boolean {
  if (!estimate || estimate.quota === undefined) return false;
  return estimate.quota - (estimate.usage ?? 0) < TIGHT_FREE;
}

/** Free space (`quota - usage`), or null without an estimate. */
export function freeSpace(estimate: { quota?: number; usage?: number } | null): number | null {
  if (!estimate || estimate.quota === undefined) return null;
  return estimate.quota - (estimate.usage ?? 0);
}
