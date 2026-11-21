// What `npm run oracle:gdi` does on a Windows other than the one the references were captured on
// (tests/oracle/gdi-capture/windows-policy.ts). Runs on every system. Owner: T2.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fingerprint, judge, mayWrite, windowsIdentity } from '../../oracle/gdi-capture/windows-policy';

const REF = '10.0.26300 cp1252 96dpi';
const RUNNER = '10.0.26100 cp1252 96dpi';
const metricsDiff = { path: 'app/public/fonts/metrics.json', fingerprint: 'aaaa' };
const atlasDiff = { path: 'app/public/fonts/bitmap/Courier-16-i.bin', fingerprint: 'bbbb' };

describe('the GDI capture on another Windows', () => {
  it('names a Windows by version, code page and DPI, not by font smoothing', () => {
    const on = { windows: '10.0.26100', ansiCodePage: 1252, logPixelsY: 96, fontSmoothing: true };
    expect(windowsIdentity(on)).toBe(RUNNER);
    expect(windowsIdentity({ ...on, fontSmoothing: false })).toBe(RUNNER);
    expect(fingerprint('x')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('on the reference Windows every difference fails', () => {
    expect(judge({ machine: REF, reference: REF, differences: [], records: {} }).fail).toBe(false);
    const v = judge({ machine: REF, reference: REF, differences: [metricsDiff], records: {} });
    expect(v.fail).toBe(true);
    expect(v.lines.join('\n')).toContain('GDI or the capture program changed');
  });

  it('on an unrecorded Windows differences fail and the record to accept them is printed', () => {
    const v = judge({ machine: RUNNER, reference: REF, differences: [metricsDiff, atlasDiff], records: {} });
    expect(v.fail).toBe(true);
    expect(v.record).toEqual({
      [RUNNER]: { differences: { [metricsDiff.path]: 'aaaa', [atlasDiff.path]: 'bbbb' } },
    });
    expect(v.lines.join('\n')).toContain('not the Windows the references were captured on');
    expect(v.lines.join('\n')).toContain(JSON.stringify(v.record, null, 2));
  });

  it('on an unrecorded Windows without differences the run passes', () => {
    expect(judge({ machine: RUNNER, reference: REF, differences: [], records: {} }).fail).toBe(false);
  });

  it('on a recorded Windows only the recorded differences pass; a new or changed one fails', () => {
    const records = { [RUNNER]: { differences: { [metricsDiff.path]: 'aaaa' } } };
    expect(judge({ machine: RUNNER, reference: REF, differences: [metricsDiff], records }).fail).toBe(false);
    const added = judge({ machine: RUNNER, reference: REF, differences: [metricsDiff, atlasDiff], records });
    expect(added.fail).toBe(true);
    expect(added.lines.join('\n')).toContain(`NEW       ${atlasDiff.path}`);
    const changed = judge({
      machine: RUNNER,
      reference: REF,
      differences: [{ ...metricsDiff, fingerprint: 'cccc' }],
      records,
    });
    expect(changed.fail).toBe(true);
    expect(changed.lines.join('\n')).toContain(`CHANGED   ${metricsDiff.path}`);
    const gone = judge({ machine: RUNNER, reference: REF, differences: [], records });
    expect(gone.fail).toBe(false);
    expect(gone.lines.join('\n')).toContain(`agrees    ${metricsDiff.path}`);
  });

  it('--write replaces the references only on their own Windows, unless told explicitly', () => {
    expect(mayWrite({ machine: REF, reference: REF, override: false })).toBe(true);
    expect(mayWrite({ machine: RUNNER, reference: REF, override: false })).toBe(false);
    expect(mayWrite({ machine: RUNNER, reference: REF, override: true })).toBe(true);
    expect(mayWrite({ machine: RUNNER, reference: null, override: false })).toBe(true);
  });

  it('other-windows.json is valid and every record has the expected shape', () => {
    const records = JSON.parse(
      readFileSync(new URL('../../oracle/gdi-capture/other-windows.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>;
    for (const [key, value] of Object.entries(records)) {
      if (key === 'about') continue;
      expect(key).toMatch(/^\d+\.\d+\.\d+ cp\d+ \d+dpi$/);
      const diffs = (value as { differences: Record<string, string> }).differences;
      for (const f of Object.values(diffs)) expect(f).toMatch(/^([0-9a-f]{16}|removed)$/);
    }
  });
});
