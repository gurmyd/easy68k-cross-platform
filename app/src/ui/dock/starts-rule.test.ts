// The rule by which check-dock.mjs's pass `starts` derives main's figures where Tab does not stop
// at plain buttons (starts-rule.mjs, errata N1 29), on the figures of the run that showed the need:
// GitHub's macOS runner, push run 45096191683 (commit c3d1074), job "browser-checks (macos-latest,
// interface)". starts-rule.mac-run.json holds every `webkit/starts` line of that job's log for the
// five places of the pass (the key of check-dock.main.json, the log's line, its verdict and what
// the run observed); check-dock.main.json is main's record. Made-up changes of those figures must
// still fail.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  expectedStep,
  expectedWalk,
  isPlainControl,
  mainHere,
  plainOrder,
  skippedStops,
  type Step,
  type Walk,
  withoutStops,
} from './starts-rule.mjs';

const here = dirname(fileURLToPath(import.meta.url));
type Figure = Walk[] | Walk | Step;
const MAIN = JSON.parse(readFileSync(join(here, 'check-dock.main.json'), 'utf8')) as Record<string, Figure>;
const MAC = JSON.parse(readFileSync(join(here, 'starts-rule.mac-run.json'), 'utf8')) as Record<
  string,
  { line: number; passed: boolean; observed: Figure }
>;

const PLACES = ['editor', 'editor (1000 px)', 'simulator wide', 'simulator narrow', 'easybin'];
const BACK = 'gone at the end, window back, Shift+Tab';
const FORTH = 'gone at the start, window back, Tab';

/** The elements of the page, as check-dock.mjs reads them for the entries that occur here. */
function elementOf(entry: string): { tag: string; type: string; tabindex: boolean } {
  const [role = '', name = ''] = entry.split('|');
  // The toolbar's and the mode switch's buttons hold a tabindex of their own (a roving tab stop).
  if (role === 'button') return { tag: 'button', type: '', tabindex: name === 'Theme' || name.startsWith('Open (') };
  if (entry === 'input||easybin') return { tag: 'input', type: 'radio', tabindex: false };
  if (role === 'input') return { tag: 'input', type: 'text', tabindex: false };
  if (role === 'select' || role === 'textarea') return { tag: role, type: '', tabindex: false };
  return { tag: 'div', type: '', tabindex: true };
}

const kindOf = (what: string) =>
  what.includes('window back') ? 'walks' : what.includes('beside each stop') ? 'walk' : 'step';

/**
 * The pass's verdict on one place, as check-dock.mjs reaches it: the stops skipped, whether they
 * are plain controls, and the keys whose figure differs from main's on this system.
 */
function verdict(
  where: string,
  observed: Record<string, Figure>,
  buttonsStop: boolean,
  element = elementOf,
): { skipped: string[]; plain: boolean; failing: string[] } {
  const key = (what: string) => `webkit|${where}|${what}`;
  const mainBack = MAIN[key(BACK)] as Walk[];
  const mainForth = MAIN[key(FORTH)] as Walk[];
  const skipped = buttonsStop
    ? []
    : skippedStops(
        [...mainBack, ...mainForth],
        [...(observed[key(BACK)] as Walk[]), ...(observed[key(FORTH)] as Walk[])],
      );
  const plain = skipped.every((entry) => isPlainControl(element(entry)));
  const recordedPlain = { forward: mainForth[0] ?? [], backward: mainBack[0] ?? [] };
  const failing: string[] = [];
  for (const [k, figure] of Object.entries(observed)) {
    if (!k.startsWith(`webkit|${where}|`)) continue;
    const what = k.slice(`webkit|${where}|`.length);
    const kind = kindOf(what);
    const main = mainHere(kind, MAIN[k], skipped, recordedPlain, what.endsWith('Shift+Tab'));
    const ok = main !== null && main !== undefined && JSON.stringify(main) === JSON.stringify(figure);
    if (!ok || (kind === 'walks' && !plain)) failing.push(k);
  }
  return { skipped, plain, failing };
}

/** The element of a map or a list that must be there. */
function get<T>(from: Record<string, T> | T[], at: string | number): T {
  const value = (from as Record<string | number, T | undefined>)[at];
  if (value === undefined) throw new Error(`no ${String(at)}`);
  return value;
}

const macObserved = (): Record<string, Figure> =>
  Object.fromEntries(Object.entries(MAC).map(([k, v]) => [k, structuredClone(v.observed)]));

/** The twelve failures of the log and the stops the run lacks in each (the plain controls). */
const THE_TWELVE: Record<string, string[]> = {
  'webkit|simulator wide|gone at the start, window back, Tab': [
    'button|Clear Cycles|registers',
    'button|Full Screen (Alt+Enter)|output',
    'button|Collapse the Output panel|output',
  ],
  'webkit|simulator wide|gone beside each stop, Tab': [
    'button|Clear Cycles|registers',
    'button|Full Screen (Alt+Enter)|output',
    'button|Collapse the Output panel|output',
  ],
  'webkit|simulator wide|gone beside each stop, Shift+Tab': [
    'button|Collapse the Output panel|output',
    'button|Full Screen (Alt+Enter)|output',
    'button|Clear Cycles|registers',
  ],
  'webkit|simulator narrow|gone at the start, window back, Tab': [
    'button|Clear Cycles|registers',
    'button|Full Screen (Alt+Enter)|output',
  ],
  'webkit|simulator narrow|gone beside each stop, Tab': [
    'button|Clear Cycles|registers',
    'button|Full Screen (Alt+Enter)|output',
  ],
  'webkit|simulator narrow|gone beside each stop, Shift+Tab': [
    'button|Full Screen (Alt+Enter)|output',
    'button|Clear Cycles|registers',
  ],
  'webkit|easybin|gone at the end, window back, Shift+Tab': [
    'button|Page down|easybin',
    'button|Page up|easybin',
    'button|Row down|easybin',
    'button|Row up|easybin',
    'button|Fill|easybin',
    'button|Copy|easybin',
    'button|Save Binary...|easybin',
    'input||easybin',
    'button|Open S-Record...|easybin',
  ],
  'webkit|easybin|gone at the start, window back, Tab': [
    'button|Open S-Record...|easybin',
    'input||easybin',
    'button|Save Binary...|easybin',
    'button|Copy|easybin',
    'button|Fill|easybin',
    'button|Row up|easybin',
    'button|Row down|easybin',
    'button|Page up|easybin',
    'button|Page down|easybin',
  ],
  'webkit|easybin|gone beside each stop, Tab': [
    'button|Open S-Record...|easybin',
    'input||easybin',
    'button|Save Binary...|easybin',
    'button|Copy|easybin',
    'button|Fill|easybin',
    'button|Row up|easybin',
    'button|Row down|easybin',
    'button|Page up|easybin',
    'button|Page down|easybin',
  ],
  // The one walk that also holds two stops more than main's record: main's WebKit skipped `Fill
  // byte` and `Size` only in the steps that started at `Fill` and `Copy`, which this system never
  // starts from (rule 3 puts them back).
  'webkit|easybin|gone beside each stop, Shift+Tab': [
    'button|Page down|easybin',
    'button|Page up|easybin',
    'button|Row down|easybin',
    'button|Row up|easybin',
    'button|Fill|easybin',
    'button|Copy|easybin',
    'button|Save Binary...|easybin',
    'input||easybin',
    'button|Open S-Record...|easybin',
  ],
  'webkit|easybin|a click on the status bar, Shift+Tab': ['button|Page down|easybin'],
  'webkit|easybin|Help > About opened and closed with Escape, Shift+Tab': ['button|Page down|easybin'],
};

/** The recorded figure's entries that the observed one lacks, in recorded order (multiset). */
function missing(record: Figure, observed: Figure): string[] {
  const flat = (f: Figure) => (Array.isArray(f) ? (f.flat() as string[]) : [f.to]);
  const left = [...flat(observed)];
  const out: string[] = [];
  for (const entry of flat(record)) {
    const at = left.indexOf(entry);
    if (at >= 0) left.splice(at, 1);
    else out.push(entry);
  }
  return out;
}

describe('the macOS run of push run 45096191683', () => {
  it('has the twelve failures of the log, and 58 checks that passed', () => {
    const failed = Object.entries(MAC).filter(([, v]) => !v.passed);
    expect(Object.keys(MAC)).toHaveLength(70);
    expect(failed.map(([k]) => k).sort()).toEqual(Object.keys(THE_TWELVE).sort());
    expect(failed.map(([, v]) => v.line).sort((a, b) => a - b)).toEqual([
      3820, 3821, 3822, 3835, 3836, 3837, 3849, 3850, 3851, 3852, 3854, 3860,
    ]);
  });

  it('the exact comparison (Tab stops at buttons) gives the log’s verdicts', () => {
    const failing = PLACES.flatMap((where) => verdict(where, macObserved(), true).failing);
    expect(failing.sort()).toEqual(Object.keys(THE_TWELVE).sort());
  });

  it('in each of the twelve the run lacks exactly plain controls, and is otherwise main’s order', () => {
    for (const [k, stops] of Object.entries(THE_TWELVE)) {
      const record = get(MAIN, k);
      const observed = get(MAC, k).observed;
      expect(missing(record, observed), k).toEqual(stops);
      expect(
        stops.every((entry) => isPlainControl(elementOf(entry))),
        k,
      ).toBe(true);
      // What remains of the record keeps its order: the observed figure is the record without
      // those stops, but for the one walk of rule 3, which holds two stops more.
      const set = new Set(stops);
      const rest = Array.isArray(record)
        ? JSON.stringify((record as unknown[]).map((w) => (Array.isArray(w) ? w.filter((e) => !set.has(e)) : w)))
        : '';
      if (k === 'webkit|easybin|gone beside each stop, Shift+Tab') {
        expect(missing(observed, record)).toEqual(['input|Fill byte|easybin', 'input|Size|easybin']);
      } else if (Array.isArray(record) && Array.isArray(record[0])) {
        expect(JSON.stringify(observed), k).toBe(rest);
      } else if (Array.isArray(record)) {
        expect(observed, k).toEqual((record as Walk).filter((e) => !set.has(e)));
      }
    }
  });

  it('the rule derives main’s figures on that system: all 70 checks pass', () => {
    const skippedOf: Record<string, string[]> = {};
    for (const where of PLACES) {
      const result = verdict(where, macObserved(), false);
      expect(result.failing, where).toEqual([]);
      expect(result.plain, where).toBe(true);
      skippedOf[where] = result.skipped;
    }
    expect(skippedOf).toEqual({
      editor: [],
      'editor (1000 px)': [],
      'simulator wide': [
        'button|Clear Cycles|registers',
        'button|Full Screen (Alt+Enter)|output',
        'button|Collapse the Output panel|output',
      ],
      'simulator narrow': ['button|Clear Cycles|registers', 'button|Full Screen (Alt+Enter)|output'],
      easybin: [
        'button|Page down|easybin',
        'button|Page up|easybin',
        'button|Row down|easybin',
        'button|Row up|easybin',
        'button|Fill|easybin',
        'button|Copy|easybin',
        'button|Save Binary...|easybin',
        'input||easybin',
        'button|Open S-Record...|easybin',
      ],
    });
  });
});

describe('made-up runs that must fail', () => {
  const EASYBIN_FORTH = 'webkit|easybin|gone at the start, window back, Tab';
  const WIDE_FORTH = 'webkit|simulator wide|gone at the start, window back, Tab';

  it('a stop missing that is not a plain button (a text field) fails', () => {
    for (const walks of [EASYBIN_FORTH, 'webkit|easybin|gone at the end, window back, Shift+Tab']) {
      const observed = macObserved();
      observed[walks] = (observed[walks] as Walk[]).map((w) => w.filter((e) => e !== 'input|To|easybin'));
      const result = verdict('easybin', observed, false);
      expect(result.failing.length, walks).toBeGreaterThan(0);
    }
    // Missing from both plain walks it counts as skipped, and is not a plain control.
    const observed = macObserved();
    for (const walks of [EASYBIN_FORTH, 'webkit|easybin|gone at the end, window back, Shift+Tab'])
      observed[walks] = (observed[walks] as Walk[]).map((w) => w.filter((e) => e !== 'input|To|easybin'));
    const result = verdict('easybin', observed, false);
    expect(result.skipped).toContain('input|To|easybin');
    expect(result.plain).toBe(false);
    expect(result.failing).toContain(EASYBIN_FORTH);
  });

  it('a stop missing that is a tab stop of its own (the toolbar’s Open) fails', () => {
    const observed = macObserved();
    for (const walks of [WIDE_FORTH])
      observed[walks] = (observed[walks] as Walk[]).map((w) => w.filter((e) => e !== 'button|Open (Ctrl+O)|-'));
    const result = verdict('simulator wide', observed, false);
    expect(result.plain).toBe(false);
    expect(result.failing).toContain(WIDE_FORTH);
  });

  it('a plain button missing from one walk only, where the plain walk reaches it, fails', () => {
    const observed = macObserved();
    const key = 'webkit|easybin|gone beside each stop, Tab';
    // The plain walks say this system reaches no plain button; give one back to the plain walk
    // and the record must hold it everywhere.
    const plainWalk = observed[EASYBIN_FORTH] as Walk[];
    const first = [...(plainWalk[0] ?? [])];
    first.splice(first.indexOf('input|From|easybin'), 0, 'button|Save Binary...|easybin');
    plainWalk[0] = first;
    const result = verdict('easybin', observed, false);
    expect(result.skipped).not.toContain('button|Save Binary...|easybin');
    expect(result.failing).toContain(key);
  });

  it('one of several stops of the same name missing (a register field) fails', () => {
    const observed = macObserved();
    const walk = get(observed[WIDE_FORTH] as Walk[], 0);
    walk.splice(walk.indexOf('input||registers'), 1);
    const result = verdict('simulator wide', observed, false);
    expect(result.skipped).not.toContain('input||registers');
    expect(result.failing).toContain(WIDE_FORTH);
  });

  it('two stops in another order fail', () => {
    for (const k of [EASYBIN_FORTH, 'webkit|easybin|gone beside each stop, Shift+Tab', WIDE_FORTH]) {
      const observed = macObserved();
      const figure = observed[k] as Walk[] | Walk;
      const walk = (Array.isArray(figure[0]) ? figure[0] : figure) as Walk;
      expect(walk[1]).not.toBe(walk[2]);
      const [one = '', two = ''] = [walk[1], walk[2]];
      walk[1] = two;
      walk[2] = one;
      const where = k.split('|')[1] ?? '';
      expect(verdict(where, observed, false).failing, k).toContain(k);
    }
  });

  it('a stop added fails', () => {
    for (const k of [EASYBIN_FORTH, 'webkit|easybin|gone beside each stop, Shift+Tab', WIDE_FORTH]) {
      const observed = macObserved();
      const figure = observed[k] as Walk[] | Walk;
      const walk = (Array.isArray(figure[0]) ? figure[0] : figure) as Walk;
      walk.splice(3, 0, 'button|Something new|-');
      const where = k.split('|')[1] ?? '';
      expect(verdict(where, observed, false).failing, k).toContain(k);
    }
  });

  it('a single step that goes elsewhere than the next stop that is not skipped fails', () => {
    const observed = macObserved();
    const k = 'webkit|easybin|a click on the status bar, Shift+Tab';
    observed[k] = { from: 'body', to: 'input|Address|easybin' };
    expect(verdict('easybin', observed, false).failing).toEqual([k]);
  });

  it('the macOS figures fail where Tab stops at buttons: there the comparison stays exact', () => {
    const failing = PLACES.flatMap((where) => verdict(where, macObserved(), true).failing);
    expect(failing).toHaveLength(12);
  });
});

describe('the parts of the rule', () => {
  it('isPlainControl: buttons, check boxes, radio buttons and file fields without a tabindex', () => {
    expect(isPlainControl({ tag: 'BUTTON', type: '', tabindex: false })).toBe(true);
    expect(isPlainControl({ tag: 'button', type: 'submit', tabindex: false })).toBe(true);
    for (const type of ['checkbox', 'radio', 'file', 'submit'])
      expect(isPlainControl({ tag: 'input', type, tabindex: false }), type).toBe(true);
    expect(isPlainControl({ tag: 'button', type: '', tabindex: true })).toBe(false);
    for (const type of ['', 'text', 'search', 'number'])
      expect(isPlainControl({ tag: 'input', type, tabindex: false }), type).toBe(false);
    expect(isPlainControl({ tag: 'select', type: '', tabindex: false })).toBe(false);
    expect(isPlainControl({ tag: 'div', type: '', tabindex: true })).toBe(false);
  });

  it('with nothing skipped every figure is the record itself', () => {
    const record = [['a', 'b', 'body']];
    expect(mainHere('walks', record, [], { forward: ['a'], backward: ['a'] }, false)).toBe(record);
    const step = { from: 'a', to: 'b' };
    expect(mainHere('step', step, [], { forward: ['a'], backward: ['a'] }, true)).toBe(step);
    expect(mainHere('walk', undefined, ['b'], { forward: ['a'], backward: ['a'] }, true)).toBeUndefined();
  });

  it('plainOrder joins the walk from the start with what follows the key field', () => {
    expect(plainOrder(['a', 'b', 'body'], ['b', 'a', 'body'])).toEqual(['a', 'b']);
    expect(plainOrder(['a', 'textarea|k|output'], ['y', 'x', 'textarea|k|output'])).toEqual([
      'a',
      'textarea|k|output',
      'x',
      'y',
    ]);
  });

  it('withoutStops takes the stops out and merges walks that become equal', () => {
    expect(
      withoutStops(
        [
          ['a', 'B', 'c'],
          ['a', 'c'],
        ],
        ['B'],
      ),
    ).toEqual([['a', 'c']]);
  });

  it('expectedWalk puts back only what a step from a skipped stop passed over', () => {
    const order = ['a', 'B', 'c', 'D', 'e', 'f'];
    // a -> B, B -> D (passed over c), D -> f (passed over e), f -> body
    expect(expectedWalk(['a', 'B', 'D', 'f', 'body'], ['B', 'D'], order)).toEqual(['a', 'c', 'e', 'f', 'body']);
    // a step from a stop that is not skipped keeps what it passed over out
    expect(expectedWalk(['a', 'c', 'f', 'body'], ['B', 'D'], order)).toEqual(['a', 'c', 'f', 'body']);
    // a skipped stop that is not in the order, or a next stop not after it: no figure
    expect(expectedWalk(['a', 'X', 'c'], ['X'], order)).toBeNull();
    expect(expectedWalk(['c', 'D', 'a'], ['D'], order)).toBeNull();
  });

  it('expectedStep goes on to the next stop that is not skipped', () => {
    const order = ['a', 'B', 'C', 'd'];
    expect(expectedStep({ from: 'x', to: 'B' }, ['B', 'C'], order)).toEqual({ from: 'x', to: 'd' });
    expect(expectedStep({ from: 'x', to: 'C' }, ['C', 'd'], order)).toEqual({ from: 'x', to: 'body' });
    expect(expectedStep({ from: 'B', to: 'd' }, ['B'], order)).toBeNull();
    expect(expectedStep({ from: 'x', to: 'a' }, ['B'], order)).toEqual({ from: 'x', to: 'a' });
  });
});
