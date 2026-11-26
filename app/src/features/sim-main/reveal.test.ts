// revealScroll: a focused control is brought into view by the panel's own scroll area (version 1.1).

import { describe, expect, it } from 'vitest';
import { revealScroll } from './reveal';

describe('revealScroll', () => {
  const view = { top: 100, left: 10, width: 300, height: 200 };
  it('in view: unchanged', () => {
    expect(revealScroll(view, { top: 40, left: 5 }, { top: 150, left: 50, width: 40, height: 20 })).toEqual({
      top: 40,
      left: 5,
    });
  });
  it('below or right of the view: forward by what is out, with a margin', () => {
    expect(revealScroll(view, { top: 0, left: 0 }, { top: 290, left: 300, width: 40, height: 20 })).toEqual({
      top: 14,
      left: 34,
    });
  });
  it('above or left of the view: back, never below 0', () => {
    expect(revealScroll(view, { top: 50, left: 20 }, { top: 80, left: 0, width: 40, height: 20 })).toEqual({
      top: 26,
      left: 6,
    });
    expect(revealScroll(view, { top: 5, left: 0 }, { top: 98, left: 10, width: 40, height: 20 })).toEqual({
      top: 0,
      left: 0,
    });
  });
  it('larger than the view: its top and left edge', () => {
    expect(revealScroll(view, { top: 0, left: 0 }, { top: 150, left: 20, width: 400, height: 300 })).toEqual({
      top: 46,
      left: 6,
    });
  });
});
