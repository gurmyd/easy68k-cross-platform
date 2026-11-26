// The rules of floating windows (ARCHITECTURE-PLUS P9.2): bounds, sizes, the cascade, the keys,
// the stacking, and what is stored.

import { describe, expect, it } from 'vitest';
import { FLOAT_CASCADE_STEP, MIN_FLOAT_SIZE } from '../../state/dock';
import {
  KEEP_INSIDE,
  TITLE_BAR_HEIGHT,
  boundedRect,
  firstFloatRect,
  titleButtonsWidth,
  WINDOW_BORDER,
  keyStep,
  minimumSize,
  raised,
  readFloating,
  sizedRect,
  storedFloating,
  zIndexOf,
} from './floating';

const AREA = { width: 1400, height: 800 };
const rect = (x: number, y: number, width = 300, height = 200) => ({ x, y, width, height });

describe('bounds (P9.2): at least 48 px of the title bar inside, moved back, never resized', () => {
  it('keeps a window that is inside where it is', () => {
    expect(boundedRect(rect(100, 100), AREA)).toEqual(rect(100, 100));
  });

  it('every direction: 48 px of the title bar stay inside horizontally, the whole bar vertically', () => {
    expect(boundedRect(rect(-1000, 100), AREA)).toEqual(rect(KEEP_INSIDE - 300, 100));
    expect(boundedRect(rect(5000, 100), AREA)).toEqual(rect(AREA.width - KEEP_INSIDE, 100));
    expect(boundedRect(rect(100, -50), AREA)).toEqual(rect(100, 0));
    expect(boundedRect(rect(100, 5000), AREA)).toEqual(rect(100, AREA.height - TITLE_BAR_HEIGHT));
  });

  it('a window larger than the area is moved, not resized', () => {
    const big = rect(-10, -10, 3000, 2000);
    const shown = boundedRect(big, { width: 600, height: 400 });
    expect([shown.width, shown.height]).toEqual([3000, 2000]);
    expect(shown.y).toBe(0);
  });

  it('when the window gets smaller, a window is moved back by the rule (its own rect is kept by the caller)', () => {
    const own = rect(1100, 600);
    expect(boundedRect(own, AREA)).toEqual(own);
    const small = { width: 800, height: 500 };
    const shown = boundedRect(own, small);
    expect(shown.x + KEEP_INSIDE).toBeLessThanOrEqual(small.width);
    expect(shown.y + TITLE_BAR_HEIGHT).toBeLessThanOrEqual(small.height);
    expect([shown.width, shown.height]).toEqual([own.width, own.height]);
  });
});

describe('sizes (P9.2)', () => {
  it('the smallest size is the panel minimum, and not less than 160 by 96', () => {
    expect(minimumSize()).toEqual(MIN_FLOAT_SIZE);
    expect(minimumSize({ width: 100, height: 50 })).toEqual({ width: 160, height: 96 });
    expect(minimumSize({ width: 400, height: 300 })).toEqual({ width: 400, height: 300 });
  });

  it('a resize by any edge or corner keeps the minimum; the opposite edge stays', () => {
    const min = minimumSize();
    const start = rect(200, 200, 300, 200);
    expect(sizedRect(start, 'e', 50, 0, min, AREA)).toEqual(rect(200, 200, 350, 200));
    expect(sizedRect(start, 's', 0, -500, min, AREA)).toEqual(rect(200, 200, 300, 96));
    const west = sizedRect(start, 'w', 500, 0, min, AREA);
    expect([west.x + west.width, west.width]).toEqual([500, 160]);
    const north = sizedRect(start, 'n', 0, -500, min, AREA);
    expect([north.y, north.y + north.height]).toEqual([0, 400]);
    expect(sizedRect(start, 'se', 10, 20, min, AREA)).toEqual(rect(200, 200, 310, 220));
    const nw = sizedRect(start, 'nw', -10, -20, min, AREA);
    expect(nw).toEqual(rect(190, 180, 310, 220));
  });

  it('the first float: the docked size, at most three quarters of the dock', () => {
    const first = firstFloatRect(rect(700, 500, 700, 300), AREA, []);
    expect([first.width, first.height]).toEqual([700, 300]);
    const huge = firstFloatRect(rect(0, 0, 1400, 800), AREA, []);
    expect([huge.width, huge.height]).toEqual([1050, 600]);
    // At least the minimum, also for a panel docked small.
    const tiny = firstFloatRect(rect(0, 0, 50, 30), AREA, []);
    expect([tiny.width, tiny.height]).toEqual([160, 96]);
  });

  it('P9.8 point 2: the first free place of the rule of point 1, not 24 px off its docked place', () => {
    // Nothing floats: the top right corner of the dock, wherever the panel was docked.
    expect(firstFloatRect(rect(700, 500, 700, 300), AREA, [])).toEqual(rect(700, 0, 700, 300));
    expect(firstFloatRect(rect(0, 0, 300, 200), AREA, [])).toEqual(rect(1100, 0, 300, 200));
    // Another window at the top right: below it in the same column.
    const below = firstFloatRect(rect(0, 0, 300, 200), AREA, [rect(1100, 0, 300, 400)]);
    expect(below).toEqual(rect(1100, 400, 300, 200));
    // The column full: a further column to the left, over no other window.
    const left = firstFloatRect(rect(0, 0, 300, 200), AREA, [rect(1100, 0, 300, 700)]);
    expect(left).toEqual(rect(800, 0, 300, 200));
  });

  it('P9.8 point 2: never over the tab strip of the group it came from', () => {
    const strip = rect(700, 0, 700, 29);
    const placed = firstFloatRect(rect(700, 29, 700, 300), AREA, [], minimumSize(), strip);
    expect(placed.y).toBeGreaterThanOrEqual(29);
    expect(placed).toEqual(rect(700, 29, 700, 300));
  });

  it('no free place: cascaded 24 px from the last window, still not over the strip', () => {
    const others = [rect(0, 0, 1400, 800)];
    const next = firstFloatRect(rect(0, 0, 200, 150), AREA, others);
    expect([next.x, next.y]).toEqual([FLOAT_CASCADE_STEP, FLOAT_CASCADE_STEP]);
    const strip = rect(0, 0, 1400, 40);
    const moved = firstFloatRect(rect(0, 0, 200, 150), AREA, others, minimumSize(), strip);
    expect(moved.y).toBe(40);
  });
});

describe('bounds (P9.8 point 4): the title area, not the buttons', () => {
  it('a window pushed left keeps 48 px of its title area inside, besides its buttons', () => {
    const buttons = titleButtonsWidth(true);
    const shown = boundedRect(rect(-3000, 100, 662, 300), AREA, buttons);
    // The title area ends at x + width - buttons.
    expect(shown.x + shown.width - buttons).toBe(KEEP_INSIDE);
    const dockOnly = boundedRect(rect(-3000, 100, 662, 300), AREA, titleButtonsWidth(false));
    expect(dockOnly.x + dockOnly.width - titleButtonsWidth(false)).toBe(KEEP_INSIDE);
  });

  it('pushed right, the title area starts 48 px from the right edge (it is at the left of the bar, inside the border)', () => {
    expect(boundedRect(rect(5000, 100, 662, 300), AREA, titleButtonsWidth(true)).x).toBe(
      AREA.width - KEEP_INSIDE - WINDOW_BORDER,
    );
  });

  it('the buttons are wider for a panel with an x', () => {
    expect(titleButtonsWidth(true)).toBeGreaterThan(titleButtonsWidth(false));
  });
});

describe('keys and stacking (P9.2)', () => {
  it('arrows 16 px, with Shift 1 px; other keys are not steps', () => {
    expect(keyStep('ArrowLeft', false)).toEqual({ dx: -16, dy: 0 });
    expect(keyStep('ArrowDown', true)).toEqual({ dx: 0, dy: 1 });
    expect(keyStep('Home', false)).toBeNull();
  });

  it('the stack orders z only; raising puts a window at the front', () => {
    const stack = raised(['memory', 'hardware', 'log'], 'memory');
    expect(stack).toEqual(['hardware', 'log', 'memory']);
    expect(zIndexOf(stack, 'memory')).toBeGreaterThan(zIndexOf(stack, 'log'));
    // Above the splitters (10), below the modeless dialogs (20) and the full screen (19).
    for (const panel of stack) {
      expect(zIndexOf(stack, panel)).toBeGreaterThan(10);
      expect(zIndexOf(stack, panel)).toBeLessThan(19);
    }
  });
});

describe('the stored floating windows (P9.2 Persistence)', () => {
  it('reads valid windows in their order, and remembered rects', () => {
    const raw = {
      windows: [
        { panel: 'hardware', rect: rect(1, 2), home: { near: 'output', side: 'below' } },
        { panel: 'memory', rect: rect(3, 4) },
      ],
      remembered: { log: rect(5, 6), nonsense: rect(1, 1) },
    };
    expect(readFloating(raw, 'simulator')).toEqual({
      windows: [
        { panel: 'hardware', rect: rect(1, 2), home: { near: 'output', side: 'below' } },
        { panel: 'memory', rect: rect(3, 4) },
      ],
      remembered: { log: rect(5, 6) },
    });
    expect(readFloating(undefined, 'editor')).toEqual({ windows: [], remembered: {} });
  });

  const malformed: [string, unknown][] = [
    ['not an object', 'x'],
    ['windows not a list', { windows: {} }],
    ['an unknown panel', { windows: [{ panel: 'nothing', rect: rect(0, 0) }] }],
    ['a viewer (never stored)', { windows: [{ panel: 'viewer:1', rect: rect(0, 0) }] }],
    ['a panel of the other mode', { windows: [{ panel: 'files', rect: rect(0, 0) }] }],
    [
      'a panel twice',
      {
        windows: [
          { panel: 'log', rect: rect(0, 0) },
          { panel: 'log', rect: rect(9, 9) },
        ],
      },
    ],
    ['a rect that is not one', { windows: [{ panel: 'log', rect: { x: 0, y: 0, width: 'a', height: 1 } }] }],
    ['a size of zero', { windows: [{ panel: 'log', rect: rect(0, 0, 0, 10) }] }],
    ['a place that is not finite', { windows: [{ panel: 'log', rect: { x: Infinity, y: 0, width: 9, height: 9 } }] }],
  ];
  for (const [name, raw] of malformed) {
    it(`is not read: ${name}`, () => {
      expect(readFloating(raw, 'simulator')).toBeNull();
    });
  }

  it('reads the place a window was docked at and the origin of its run; drops them when malformed', () => {
    const tree = { type: 'tabs', weight: 100, panels: ['output'], selected: 'output' };
    const readTree = (raw: unknown) => (raw === tree ? (tree as never) : undefined);
    const raw = {
      windows: [
        { panel: 'hardware', rect: rect(1, 2), place: { side: 'tab', panels: ['memory', 'hardware'] } },
        { panel: 'memory', rect: rect(3, 4), place: { side: 'below', panels: ['output'], share: 0.4 } },
        { panel: 'log', rect: rect(5, 6), place: { side: 'below', panels: ['output'], share: 2 } },
        { panel: 'stack', rect: rect(5, 6), place: { side: 'tab', panels: ['nothing'] } },
      ],
      origin: { tree, wasDefault: true, last: tree },
    };
    const read = readFloating(raw, 'simulator', readTree);
    expect(read?.windows.map((window) => window.place)).toEqual([
      { side: 'tab', panels: ['memory', 'hardware'] },
      { side: 'below', panels: ['output'], share: 0.4 },
      undefined,
      undefined,
    ]);
    expect(read?.origin).toEqual({ tree, wasDefault: true, last: tree });
    expect(readFloating({ ...raw, origin: { tree: 'x', last: tree } }, 'simulator', readTree)?.origin).toBeUndefined();
    // Written back only while a window floats.
    expect(storedFloating({ windows: [], remembered: { log: rect(1, 1) }, origin: read!.origin! })).toEqual({
      windows: [],
      remembered: { log: rect(1, 1) },
    });
  });

  it('a stored size below the minimum is read as the minimum', () => {
    expect(
      readFloating({ windows: [{ panel: 'log', rect: rect(0, 0, 10, 10) }] }, 'simulator')?.windows[0]?.rect,
    ).toEqual(rect(0, 0, 160, 96));
  });

  it('writes rounded rects, and nothing when there is nothing', () => {
    expect(storedFloating({ windows: [], remembered: {} })).toBeUndefined();
    expect(storedFloating({ windows: [{ panel: 'log', rect: rect(1.4, 2.6, 300.2, 200.5) }], remembered: {} })).toEqual(
      {
        windows: [{ panel: 'log', rect: rect(1, 3, 300, 201) }],
        remembered: {},
      },
    );
  });
});
