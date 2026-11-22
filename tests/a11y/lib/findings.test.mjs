// Owner: Q1.
import { describe, expect, it } from 'vitest';
import {
  classify,
  droppedLabels,
  findingsOf,
  isBlocking,
  KNOWN_CHECKS,
  partitionDroppedLabels,
  unusedKnown,
} from './findings.mjs';

const known = [{ id: 'Q1-9', rule: 'button-name', html: /e68-thing/, where: /dark/, owner: 'X', summary: '' }];

describe('classify', () => {
  it('takes colour contrast of text in a syntax colour of the original as fidelity', () => {
    for (const html of [
      '<span class="e68-syntax__unknown">X</span>',
      '<span class="e68-squiggle e68-squiggle--error" title="ERROR">B</span>',
      '<span data-element="error" style="color: red">x</span>',
    ]) {
      expect(classify({ rule: 'color-contrast', html, label: 'l' })).toEqual({ status: 'fidelity' });
    }
  });

  it('does not excuse anything else in a syntax colour, nor contrast of other text', () => {
    expect(classify({ rule: 'link-name', html: '<span class="e68-syntax__unknown">X</span>', label: 'l' }).status).toBe(
      'new',
    );
    expect(
      classify({ rule: 'color-contrast', html: '<button class="e68-button">OK</button>', label: 'l' }).status,
    ).toBe('new');
  });

  it('names a known defect by rule, markup and scan label', () => {
    expect(
      classify({ rule: 'button-name', html: '<b class="e68-thing">', label: 'chromium dark editor' }, known),
    ).toEqual({
      status: 'known',
      ref: 'Q1-9',
    });
    expect(
      classify({ rule: 'button-name', html: '<b class="e68-thing">', label: 'chromium light editor' }, known).status,
    ).toBe('new');
    expect(
      classify({ rule: 'aria-label', html: '<b class="e68-thing">', label: 'chromium dark editor' }, known).status,
    ).toBe('new');
  });
});

describe('findingsOf and unusedKnown', () => {
  const result = {
    violations: [
      {
        id: 'button-name',
        impact: 'critical',
        nodes: [
          { target: ['.a', 'b'], html: '<b class="e68-thing">', failureSummary: 'Fix  any\n of the following' },
          { target: ['.c'], html: '<i>', impact: 'serious' },
        ],
      },
    ],
  };

  it('gives one finding per rule and element, with the scan label', () => {
    expect(findingsOf(result, 'chromium dark editor')).toEqual([
      {
        label: 'chromium dark editor',
        rule: 'button-name',
        impact: 'critical',
        target: '.a b',
        html: '<b class="e68-thing">',
        summary: 'Fix any of the following',
      },
      { label: 'chromium dark editor', rule: 'button-name', impact: 'serious', target: '.c', html: '<i>', summary: '' },
    ]);
  });

  it('lists the known defects that no finding matched any more', () => {
    const findings = findingsOf(result, 'chromium dark editor');
    expect(unusedKnown(findings, known)).toEqual([]);
    expect(unusedKnown([], known).map((entry) => entry.id)).toEqual(['Q1-9']);
  });
});

describe('isBlocking and the known checks', () => {
  it('blocks on serious and critical only (6.6)', () => {
    expect(isBlocking('critical')).toBe(true);
    expect(isBlocking('serious')).toBe(true);
    expect(isBlocking('moderate')).toBe(false);
    expect(isBlocking('minor')).toBe(false);
  });

  it('finds labels that a role drops in what axe leaves for review (Q1-6)', () => {
    const result = {
      incomplete: [
        { id: 'aria-required-children', nodes: [{ target: ['#list'], html: '<div role="listbox">' }] },
        {
          id: 'aria-prohibited-attr',
          nodes: [{ target: ['.e68-easybin__digits'], html: '<span aria-label="File Split: 1 file(s)">' }],
        },
      ],
    };
    expect(droppedLabels(result)).toEqual(['.e68-easybin__digits <span aria-label="File Split: 1 file(s)">']);
    expect(droppedLabels({ incomplete: [] })).toEqual([]);
    expect(droppedLabels({})).toEqual([]);
    // The general check is never excused, not even in EASyBIN mode (review of Q1, wave three).
    expect(
      KNOWN_CHECKS.some((entry) =>
        entry.match.test('axe webkit dark easybin: no aria-label on an element whose role drops it'),
      ),
    ).toBe(false);
  });

  it('excuses none of the checks of the repaired defects Q1-1 to Q1-6', () => {
    // Closed on 21 November 2026 (docs/integration/rc.md): each of these checks must fail again
    // if its defect returns, so no known entry may match it.
    const repaired = [
      'chromium light dialog files.name: the focus returns to where it was',
      'chromium/windows walk-run: after Execute the focus is in a panel of Simulator mode',
      "webkit/mac dark: the Messages panel of Editor mode has a polite log region for the assembler's messages",
      'chromium/windows light: a row with a breakpoint says so to a screen reader',
      'webkit/mac light: a halt is announced by a live region',
      'axe chromium light easybin: the File Split digits of EASyBIN have a name that is read',
      'axe webkit dark dialog easybin.about: the File Split digits of EASyBIN have a name that is read',
    ];
    for (const name of repaired) expect(KNOWN_CHECKS.filter((entry) => entry.match.test(name))).toEqual([]);
  });

  it('judges the digits of Q1-6 apart from every other element with a dropped label', () => {
    const digits = '.e68-easybin__digits <span class="e68-easybin__digits" aria-label="File Split: 1 file(s)">';
    const other = '.e68-easybin__other <span class="e68-easybin__other" aria-label="Something">';
    expect(partitionDroppedLabels([digits, other])).toEqual({ known: [digits], other: [other] });
    expect(partitionDroppedLabels([other])).toEqual({ known: [], other: [other] });
    expect(partitionDroppedLabels([])).toEqual({ known: [], other: [] });
  });

  it('names each known check once, with an owner and an id of docs/integration/rc.md', () => {
    const ids = KNOWN_CHECKS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of KNOWN_CHECKS) {
      expect(entry.id).toMatch(/^Q1-\d+$/);
      expect(entry.owner).not.toBe('');
      expect(entry.match).toBeInstanceOf(RegExp);
    }
  });
});
