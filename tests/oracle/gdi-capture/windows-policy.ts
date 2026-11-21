// What `npm run oracle:gdi` does when the Windows it runs on is not the Windows the committed
// references were captured on (README.md "Another Windows"). Pure functions, tested on every system
// by tests/conformance/gdi/windows-policy.test.ts. Erasable TypeScript only (run.mjs loads it with Node's
// type stripping). Owner: T2.
//
// The committed references are the standard. A run on another Windows never replaces them (--write
// refuses there unless told explicitly) and never passes over a difference in silence:
//
//   - On the reference Windows every difference fails the run: GDI or the program changed.
//   - On another Windows whose differences are recorded in other-windows.json, the run fails when a
//     difference appears that is not recorded there, or a recorded one changes: that Windows changed.
//     A recorded difference that no longer occurs is reported, and does not fail the run.
//   - On another Windows with no record, every difference fails the run and the report prints the
//     record to add to other-windows.json once a person has looked at the differences and accepted
//     them as that Windows' own. Until then nothing has been compared against anything accepted.
//
// The identity of a Windows is what changes GDI's output in the compared files: the Windows version
// (build number), the ANSI code page and LOGPIXELSY. Font smoothing affects only the suites that
// are not compared (`machine` in cases.ts).

import { createHash } from 'node:crypto';

/** "10.0.26100 cp1252 96dpi": the part of capturedOn that the compared outputs depend on. */
export function windowsIdentity(capturedOn: {
  windows: string;
  ansiCodePage: number;
  logPixelsY: number;
  [setting: string]: unknown;
}): string {
  return `${capturedOn.windows} cp${capturedOn.ansiCodePage} ${capturedOn.logPixelsY}dpi`;
}

/** Short fingerprint of an output's canonical content (what the comparison looks at). */
export function fingerprint(canonical: string): string {
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * Decides the outcome of a comparison.
 *   machine, reference: identities (windowsIdentity) of this machine and of the references;
 *   differences: { path, fingerprint }[] of the compared outputs that differ from the references;
 *   records: the content of other-windows.json ({ [identity]: { about, differences: { [path]: fingerprint } } }).
 * Returns { fail, lines, record }: whether the run fails, the lines to report, and (for another
 * Windows with differences) the record of this Windows' differences, ready for other-windows.json.
 */
export interface Difference {
  path: string;
  fingerprint: string;
}
export type Records = Record<string, { differences?: Record<string, string> } | string>;

export function judge({
  machine,
  reference,
  differences,
  records,
}: {
  machine: string;
  reference: string;
  differences: readonly Difference[];
  records: Records;
}): { fail: boolean; lines: string[]; record: Record<string, { differences: Record<string, string> }> | null } {
  const lines: string[] = [];
  const record =
    differences.length === 0
      ? null
      : { [machine]: { differences: Object.fromEntries(differences.map((d) => [d.path, d.fingerprint])) } };
  if (machine === reference) {
    if (differences.length > 0)
      lines.push(
        `This is the Windows the references were captured on (${reference}); ${differences.length} outputs differ: ` +
          'GDI or the capture program changed. Inspect build/gdi-capture/run and, if the change is real, run with --write and commit.',
      );
    return { fail: differences.length > 0, lines, record: null };
  }
  lines.push(
    `This Windows (${machine}) is not the Windows the references were captured on (${reference}). ` +
      'The references stay the standard; they are not changed by this run.',
  );
  const entry = records[machine];
  const known = typeof entry === 'object' ? entry.differences : undefined;
  if (!known) {
    if (differences.length === 0) {
      lines.push('Every compared output equals the references on this Windows as well.');
      return { fail: false, lines, record: null };
    }
    lines.push(
      `${differences.length} outputs differ here and other-windows.json has no record of this Windows, so they are ` +
        'not accepted. After looking at them (build/gdi-capture/run), add this record to ' +
        "tests/oracle/gdi-capture/other-windows.json to accept them as this Windows' own:",
      JSON.stringify(record, null, 2),
    );
    return { fail: true, lines, record };
  }
  const unexpected = differences.filter((d) => known[d.path] !== d.fingerprint);
  const gone = Object.keys(known).filter((p) => !differences.some((d) => d.path === p));
  for (const d of unexpected)
    lines.push(
      known[d.path] === undefined
        ? `  NEW       ${d.path}: differs on this Windows and is not recorded for it`
        : `  CHANGED   ${d.path}: differs otherwise than recorded for this Windows`,
    );
  for (const p of gone) lines.push(`  agrees    ${p}: recorded as differing on this Windows, equal now`);
  lines.push(
    `${differences.length - unexpected.length} of ${differences.length} differences are recorded for this Windows` +
      (unexpected.length ? `; ${unexpected.length} are not: this Windows changed.` : '.'),
  );
  if (unexpected.length || gone.length) lines.push('Its record, as of this run:', JSON.stringify(record, null, 2));
  return { fail: unexpected.length > 0, lines, record };
}

/** Whether --write may replace the references on this machine. */
export function mayWrite({
  machine,
  reference,
  override,
}: {
  machine: string;
  reference: string | null;
  override: boolean;
}): boolean {
  return machine === reference || reference === null || override;
}
