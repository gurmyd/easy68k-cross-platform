// Comparison of the port's artifacts with the official ones, and the mismatch report
// (ARCHITECTURE.md 6.2.2, 6.4; acceptance of T3: "a report of every mismatch between the port and
// the official binary, each assigned to the engine or to a host package"). Owner: T3.
//
// Imports nothing but Node and programs.ts's types, so that a script can use it too.

import type { ConformanceProgram } from './programs';

export interface FirstDifference {
  /** 1-based line number (lines split at LF; CR kept) where the two first differ. */
  line: number;
  expected: string;
  actual: string;
  /** Lines in the official and the port's artifact. */
  expectedLines: number;
  actualLines: number;
}

/** The first line at which two masked texts differ, or null when they are equal. */
export function firstDifference(expected: string, actual: string): FirstDifference | null {
  if (expected === actual) return null;
  const e = expected.split('\n');
  const a = actual.split('\n');
  let i = 0;
  while (i < e.length && i < a.length && e[i] === a[i]) i++;
  return {
    line: i + 1,
    expected: e[i] ?? '<end of file>',
    actual: a[i] ?? '<end of file>',
    expectedLines: e.length,
    actualLines: a.length,
  };
}

/** Owners a mismatch can be assigned to (ARCHITECTURE.md section 8). */
export const OWNERS = {
  engine: 'the simulator engine (engine/sim, owner W4 for the binding)',
  W1: 'the null serial and network devices (W1)',
  SH1: 'surface (SH1)',
  SH3: 'text screen (SH3)',
  SH4: 'keyboard and Output (SH4)',
  SH6: 'program files (SH6)',
  SH7: 'hardware (SH7)',
  SH8: 'run controller (SH8)',
  U4: 'log service (U4)',
  oracle: 'the Wine oracle itself (a property of Wine, not of the original)',
  harness: 'the conformance harness or its doubles (T3)',
} as const;
export type Owner = keyof typeof OWNERS;

/** One accepted mismatch: what differs, why, and whose it is. */
export interface KnownDifference {
  owner: Owner;
  summary: string;
  /** Where it was reported (an errata entry, a request) or the evidence. */
  evidence?: string;
}

/** `<program id>|<recipe>|<artifact kind>` -> the known difference, e.g. `trap15-a/a00-grid|report|result`. */
export type KnownDifferences = Record<string, KnownDifference>;

export interface Mismatch {
  key: string;
  program: ConformanceProgram;
  recipe: string;
  kind: string;
  difference: FirstDifference;
  known: KnownDifference | null;
}

const escapeCell = (text: string): string =>
  text
    .replace(/\r/g, '\\r')
    .replace(/[^\t\n\x20-\x7e]/gu, (ch) => `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`)
    .replace(/\|/g, '\\|')
    .slice(0, 160);

/** MISMATCHES.md: every mismatch with its owner, grouped by owner. */
export function renderMismatchReport(
  mismatches: readonly Mismatch[],
  counts: { programs: number; runs: number; equal: number; skipped: string[]; parts: string; metrics: string },
): string {
  const lines = [
    '# Mismatches between the port and the official SIM68K.exe',
    '',
    'Written by `EASY68K_SIM_REPORT=1 npx vitest run --config tests/conformance/sim/vitest.config.ts`',
    '(tests/conformance/sim/conformance.test.ts); do not edit. The causes and owners are kept in',
    '`known-differences.json`; docs/porting/errata/T3.md explains them.',
    '',
    `Host parts: ${counts.parts}. Text metrics: ${counts.metrics}.`,
    '',
    '| | Count |',
    '|---|---|',
    `| Programs compared | ${counts.programs} |`,
    `| Artifacts compared | ${counts.runs} |`,
    `| Equal to the official result | ${counts.equal} |`,
    `| Different, with an owner | ${mismatches.filter((m) => m.known).length} |`,
    `| Different, not yet assigned | ${mismatches.filter((m) => !m.known).length} |`,
    '',
  ];
  if (counts.skipped.length)
    lines.push(`Not compared (no official result): ${counts.skipped.map((s) => `\`${s}\``).join(', ')}.`, '');
  const byOwner = new Map<string, Mismatch[]>();
  for (const m of mismatches) {
    const owner = m.known?.owner ?? 'unassigned';
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), m]);
  }
  for (const [owner, list] of [...byOwner.entries()].sort()) {
    const title = owner === 'unassigned' ? 'Not yet assigned' : OWNERS[owner as Owner];
    lines.push(
      `## ${title}`,
      '',
      '| Program | Recipe | First difference | Official | Port | Cause |',
      '|---|---|---|---|---|---|',
    );
    for (const m of list) {
      lines.push(
        `| \`${m.program.id}\` | ${m.recipe} ${m.kind} | line ${m.difference.line} | \`${escapeCell(m.difference.expected)}\` | \`${escapeCell(m.difference.actual)}\` | ${escapeCell(m.known?.summary ?? '')} |`,
      );
    }
    lines.push('');
  }
  if (mismatches.length === 0) lines.push('No mismatch.', '');
  return lines.join('\n');
}
