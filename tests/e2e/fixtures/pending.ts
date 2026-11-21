// Tests of features that wave 2 is building while these tests are written (ARCHITECTURE.md 9.4, X1):
// written against the specification and marked expected-fail until the feature lands, with the
// package id in the reason, so that they turn themselves on. Owner: X1.
//
// "Landed" is decided in the page, from what a user can see: the feature's command is enabled in
// the state where the specification says it is (a stub feature registers no handler, and a command
// without a handler is disabled, ARCHITECTURE.md 3.12.2). When the probe says the feature is there,
// the test runs as an ordinary test and any failure is a real one, to be sent to the package's owner
// by the integration gate (9.5). When it is not, the test is marked `test.fail()` and stops at once,
// so a missing feature costs no time-outs.

import { expect, test } from '@playwright/test';

/** The wave-2 packages whose features the end-to-end suites wait for. */
export type PendingPackage = 'E4' | 'E5' | 'E6' | 'FS2';

interface Probe {
  /** What the package builds (for the reason text). */
  readonly feature: string;
  /**
   * Command ids that are enabled in Editor mode, with the start-up document active, once the
   * package has landed. Empty when the test supplies its own probe.
   */
  readonly commands: readonly string[];
}

export const PENDING: Readonly<Record<PendingPackage, Probe>> = {
  E4: {
    feature: 'Assembler Options, Editor Options and Import/Export Settings',
    commands: ['ed.options.assembler', 'ed.options.editor'],
  },
  E5: {
    feature: 'Assemble Source, the Messages panel and the Assembler Status dialog',
    commands: ['ed.project.assemble'],
  },
  E6: { feature: 'Find, Find And Replace and Print', commands: ['ed.edit.find', 'ed.edit.replace', 'ed.file.print'] },
  FS2: { feature: 'the File System Access folder (Open folder...)', commands: [] },
};

/** The reason text of an expected failure. */
export function pendingReason(pkg: PendingPackage): string {
  return `${pkg}: ${PENDING[pkg].feature} not built yet (wave 2); this test turns itself on when it lands`;
}

/** What the probe needs from the page: whether a command is enabled (toolbar button or menu entry). */
export interface ProbeHost {
  commandEnabled(id: string): Promise<boolean>;
}

/** Whether a wave-2 package has landed, judged by its commands (or by `custom` when given). */
export async function landed(host: ProbeHost, pkg: PendingPackage, custom?: () => Promise<boolean>): Promise<boolean> {
  if (custom) return custom();
  for (const id of PENDING[pkg].commands) {
    if (!(await host.commandEnabled(id))) return false;
  }
  return true;
}

/**
 * Call at the start of a test of a pending feature, with the application open in Editor mode and
 * the start-up document active: while the feature is missing the test is marked as an expected
 * failure and ends at once; otherwise this does nothing.
 */
export async function requirePackage(
  host: ProbeHost,
  pkg: PendingPackage,
  custom?: () => Promise<boolean>,
): Promise<void> {
  const ok = await landed(host, pkg, custom);
  test.fail(!ok, pendingReason(pkg));
  expect(ok, pendingReason(pkg)).toBe(true);
}
