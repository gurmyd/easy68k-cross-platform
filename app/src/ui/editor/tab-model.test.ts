import { describe, expect, it } from 'vitest';
import { TabType } from '../../contracts';
import {
  nextTabStop,
  originalTabSpaces,
  previousTabStop,
  tabKeySpaces,
  tabModeText,
  tabWidths,
  visualColumn,
} from './tab-model';

const fixed = (tabSize: number) => ({ tabType: TabType.Fixed, tabSize });
const assembly = (tabSize = 4) => ({ tabType: TabType.Assembly, tabSize });

describe('tab stops (editor-ui §8.1, §8.3; ARCHITECTURE.md 2.4)', () => {
  it('Assembly: 12, 20, 44, then multiples of the fixed size', () => {
    const stops: number[] = [];
    let column = 0;
    for (let i = 0; i < 6; i++) {
      column = nextTabStop(column, assembly(4));
      stops.push(column);
    }
    expect(stops).toEqual([12, 20, 44, 48, 52, 56]);
    expect(nextTabStop(44, assembly(8))).toBe(48);
    expect(nextTabStop(44, assembly(7))).toBe(49);
  });

  it('Fixed: multiples of the size; a size that is not positive counts as 8 for display', () => {
    expect([0, 1, 3, 4, 7].map((c) => nextTabStop(c, fixed(4)))).toEqual([4, 4, 4, 8, 8]);
    expect(nextTabStop(0, fixed(0))).toBe(8);
    expect(nextTabStop(9, fixed(-3))).toBe(16);
  });

  it('previous stop, for Shift+Tab', () => {
    expect([0, 1, 12, 13, 20, 21, 44, 45, 48, 49].map((c) => previousTabStop(c, assembly(4)))).toEqual([
      0, 0, 0, 12, 12, 20, 20, 44, 44, 48,
    ]);
    expect([0, 3, 4, 5, 8].map((c) => previousTabStop(c, fixed(4)))).toEqual([0, 0, 0, 4, 4]);
  });
});

describe('tab characters are displayed at columns 12, 20, 44 (20.3, third item)', () => {
  it('three tabs on an empty line', () => {
    expect(tabWidths('\t\t\t', assembly())).toEqual([12, 8, 24]);
    expect(visualColumn('\t\t\tX', 3, assembly())).toBe(44);
  });

  it('a label then tabs: every tab reaches the next stop after the column it starts in', () => {
    // "START:" occupies 0-5, the tab reaches 12; "MOVE.B" 12-17, the tab reaches 20.
    const line = 'START:\tMOVE.B\t#1,D0\tcomment';
    expect(tabWidths(line, assembly())).toEqual([6, 2, 19]);
    expect(visualColumn(line, line.indexOf('#'), assembly())).toBe(20);
    expect(visualColumn(line, line.indexOf('c'), assembly())).toBe(44);
  });

  it('a tab typed past column 12 goes to 20, unlike the original status bar, which counted tabs (§7.2 quirk b)', () => {
    const line = 'ABCDEFGHIJKLMN\tX';
    expect(visualColumn(line, line.length - 1, assembly())).toBe(20);
  });

  it('fixed tabs', () => {
    expect(tabWidths('a\tbc\t\t', fixed(4))).toEqual([3, 2, 4]);
  });
});

describe('true visual column (status bar, note 17)', () => {
  it('counts characters and expands tabs with the document stops', () => {
    expect(visualColumn('', 0, fixed(4))).toBe(0);
    expect(visualColumn('    MOVE', 8, fixed(4))).toBe(8);
    expect(visualColumn('\tMOVE', 1, fixed(4))).toBe(4);
    expect(visualColumn('\tMOVE', 1, fixed(8))).toBe(8);
    expect(visualColumn('\tMOVE', 1, assembly())).toBe(12);
  });
});

describe('Tab key with Real Tabs off (editor-ui §20.3, note 12)', () => {
  it('Fixed tabs, size 4: columns 0, 1, 3, 4 insert 4, 3, 1, 4 spaces', () => {
    expect([0, 1, 3, 4].map((c) => tabKeySpaces(c, fixed(4)))).toEqual([4, 3, 1, 4]);
  });

  it('Assembly tabs: column 0 -> 12 spaces; 5 -> 7; 13 -> 7; 21 -> 23', () => {
    expect([0, 5, 13, 21].map((c) => tabKeySpaces(c, assembly()))).toEqual([12, 7, 7, 23]);
  });

  it('Assembly tabs at 12, 20 and 44 and beyond advance to the next stop (the original inserts nothing)', () => {
    expect([12, 20, 44, 45, 50].map((c) => tabKeySpaces(c, assembly(4)))).toEqual([8, 24, 4, 3, 2]);
    expect([12, 20, 44, 45].map((c) => originalTabSpaces(c, assembly(4)))).toEqual([0, 0, 0, 0]);
  });

  it('Fixed tabs with size 0 insert nothing, as in the original', () => {
    expect(tabKeySpaces(3, fixed(0))).toBe(0);
  });

  it("the original's rule (listing and printing) for reference", () => {
    expect([0, 5, 12, 13, 20, 21, 43].map((c) => originalTabSpaces(c, assembly()))).toEqual([12, 7, 0, 7, 0, 23, 1]);
    expect([0, 1, 3, 4].map((c) => originalTabSpaces(c, fixed(4)))).toEqual([4, 3, 1, 4]);
  });
});

describe('status bar text', () => {
  it('names the tab mode', () => {
    expect(tabModeText(fixed(4))).toBe('Fixed tabs 4');
    expect(tabModeText(assembly(8))).toBe('Assembly tabs');
  });
});
