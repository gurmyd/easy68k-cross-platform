// Owner: Q1.
import { describe, expect, it } from 'vitest';
import { classify, droppedLabels, findingsOf, isBlocking, KNOWN_CHECKS, unusedKnown } from './findings.mjs';

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
    const q16 = KNOWN_CHECKS.find((entry) => entry.id === 'Q1-6');
    expect(q16.match.test('axe chromium light easybin: no aria-label on an element whose role drops it')).toBe(true);
    // The About dialog of EASyBIN mode is scanned over the workspace behind it.
    expect(
      q16.match.test('axe webkit dark dialog easybin.about: no aria-label on an element whose role drops it'),
    ).toBe(true);
    expect(q16.match.test('axe chromium light editor:no aria-label on an element whose role drops it')).toBe(false);
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
