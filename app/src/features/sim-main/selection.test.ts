// Pure rules of the listing: the third-visible-row scroll, tab expansion, the cycle text; and the
// Find dialog's search state (sim-ui §5, §6.1, §6.4, §6.7).

import { describe, expect, it } from 'vitest';
import { ListingFinder } from './find-model';
import { cyclesText, expandTabs, fullyVisibleRows, listingMetrics, thirdRowScroll } from './selection';

describe('thirdRowScroll (sim-ui §6.4)', () => {
  // 1000 rows, 10 on screen.
  it('does not move while the row is on screen', () => {
    expect(thirdRowScroll(100, 100, 10, 1000)).toBeNull();
    expect(thirdRowScroll(109, 100, 10, 1000)).toBeNull();
  });

  it('puts a row above or below the window on the third visible row', () => {
    expect(thirdRowScroll(99, 100, 10, 1000)).toBe(97);
    expect(thirdRowScroll(110, 100, 10, 1000)).toBe(108); // just below: the port scrolls (differences)
    expect(thirdRowScroll(500, 0, 10, 1000)).toBe(498);
  });

  it('stays inside the list: never above row 0, never past the last full page', () => {
    expect(thirdRowScroll(1, 50, 10, 1000)).toBe(0);
    expect(thirdRowScroll(999, 0, 10, 1000)).toBe(990);
    expect(thirdRowScroll(5, 0, 10, 8)).toBeNull();
  });

  it('ignores rows that do not exist and windows without whole rows', () => {
    expect(thirdRowScroll(-1, 0, 10, 100)).toBeNull();
    expect(thirdRowScroll(100, 0, 10, 100)).toBeNull();
    expect(thirdRowScroll(20, 0, 0.5, 100)).toBe(18);
  });
});

describe('fullyVisibleRows and listingMetrics', () => {
  it('counts only whole rows', () => {
    expect(fullyVisibleRows(0, 160, 16)).toEqual({ top: 0, shown: 10 });
    expect(fullyVisibleRows(8, 160, 16)).toEqual({ top: 1, shown: 9 }); // half a row at each end
    expect(fullyVisibleRows(32, 170, 16)).toEqual({ top: 2, shown: 10 });
    expect(fullyVisibleRows(0, 0, 16)).toEqual({ top: 0, shown: 1 });
  });

  it('10 pt is the original 13 px font in 16 px rows; other sizes keep the proportion', () => {
    expect(listingMetrics(10)).toEqual({ fontPx: 13.33, rowHeight: 16 });
    expect(listingMetrics(12)).toEqual({ fontPx: 16, rowHeight: 19 });
    expect(listingMetrics(8).rowHeight).toBe(13);
    expect(listingMetrics(Number.NaN)).toEqual(listingMetrics(10));
  });
});

describe('expandTabs (8-column stops, sim-ui §6.1)', () => {
  it('expands to the next multiple of 8', () => {
    expect(expandTabs('\tA')).toBe('        A');
    expect(expandTabs('ABC\tD')).toBe('ABC     D');
    expect(expandTabs('ABCDEFGH\tI')).toBe('ABCDEFGH        I');
    expect(expandTabs('no tabs')).toBe('no tabs');
  });
});

describe('cyclesText (sim-ui §5, section 1.4 note 32)', () => {
  it('decimal without separators, the full 64-bit value, Overflow above 2^48-1', () => {
    expect(cyclesText(0n)).toBe('0');
    expect(cyclesText(1234567n)).toBe('1234567');
    expect(cyclesText(4294967296n)).toBe('4294967296'); // the original's %u would wrap here
    expect(cyclesText(0xffffffffffffn)).toBe('281474976710655');
    expect(cyclesText(0x1000000000000n)).toBe('Overflow');
  });
});

describe('ListingFinder (the static row index and findNext of sim-ui §6.7)', () => {
  // Rows 3, 5 and 7 contain "MOVE".
  const rows = ['h', 'h', 'h', 'MOVE 1', 'x', 'move 2', 'x', 'Move 3', 'x'];
  const listing = {
    rows,
    find(text: string, from: number) {
      for (let row = Math.max(3, from); row < rows.length; row++) {
        if ((rows[row] ?? '').toUpperCase().includes(text.toUpperCase())) return row;
      }
      return -1;
    },
  };

  it('the button searches from the top first, then from the row after the previous hit', () => {
    const finder = new ListingFinder();
    expect(finder.pressFind(listing, 'move')).toEqual({ hit: 3, searched: true });
    expect(finder.pressFind(listing, 'move')).toEqual({ hit: 5, searched: true });
    expect(finder.pressFind(listing, 'move')).toEqual({ hit: 7, searched: true });
  });

  it('no wrap-around: after the last hit a search finds nothing, and the next one does not even run', () => {
    const finder = new ListingFinder();
    finder.pressFind(listing, 'Move 3');
    expect(finder.pressFind(listing, 'Move 3')).toEqual({ hit: null, searched: true });
    expect(finder.pressFind(listing, 'Move 3')).toEqual({ hit: null, searched: false });
  });

  it('changing the text or showing the dialog restarts the button from the top', () => {
    const finder = new ListingFinder();
    finder.pressFind(listing, 'move');
    finder.pressFind(listing, 'move');
    finder.restart();
    expect(finder.pressFind(listing, 'move')).toEqual({ hit: 3, searched: true });
  });

  it('F3 always continues from the stored row, also right after a restart; nothing for an empty text', () => {
    const finder = new ListingFinder();
    finder.pressFind(listing, 'move'); // row 3
    finder.restart(); // the text was changed ...
    expect(finder.pressF3(listing, 'move')).toEqual({ hit: 5, searched: true }); // ... F3 still goes on
    expect(finder.pressF3(listing, '')).toEqual({ hit: null, searched: false });
    expect(finder.pressF3(listing, 'move')).toEqual({ hit: 7, searched: true });
  });

  it('the first F3 of a window starts at row 3', () => {
    expect(new ListingFinder().pressF3(listing, 'move')).toEqual({ hit: 3, searched: true });
  });
});
