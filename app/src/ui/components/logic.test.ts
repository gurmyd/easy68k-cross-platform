// Unit tests of the kit's pure logic: access keys, arrow-key movement, menu
// keys, pop-up placement, splitter and spin arithmetic, virtual rows, the
// focus trap, message-box answers.

import { describe, expect, it } from 'vitest';
import { isImeKey, trapOrder, trapStep } from './focus';
import { menuKeyAction, type MenuEntry, type MenuKeyEvent } from './menu-model';
import { messageBoxEscapeResult } from './MessageBox';
import { findMnemonic, findTypeahead, mnemonicKeyOf, parseMnemonic, stripMnemonic } from './mnemonic';
import { placePopup } from './position';
import { moveIndex, pageIndex } from './roving';
import { parseSpinText, spinKeyValue } from './spin';
import { splitterDragValue, splitterKeyValue } from './splitter-model';
import { rowsPerPage, scrollTopFor, visibleRange } from './virtual';

describe('mnemonic', () => {
  it('parses the original captions', () => {
    expect(parseMnemonic('&Open File...')).toEqual({ text: 'Open File...', index: 0, key: 'o' });
    expect(parseMnemonic('Save &As...')).toEqual({ text: 'Save As...', index: 5, key: 'a' });
    expect(parseMnemonic('C&lose File')).toEqual({ text: 'Close File', index: 1, key: 'l' });
    expect(parseMnemonic('Printer Setup...')).toEqual({ text: 'Printer Setup...', index: -1, key: null });
    expect(parseMnemonic('Find && Replace')).toEqual({ text: 'Find & Replace', index: -1, key: null });
    expect(parseMnemonic('A&&B &C')).toEqual({ text: 'A&B C', index: 4, key: 'c' });
    expect(parseMnemonic('Trailing &')).toEqual({ text: 'Trailing &', index: -1, key: null });
    expect(stripMnemonic('Unco&mment Selection')).toBe('Uncomment Selection');
  });

  it('takes the letter from the key, or from the key position with Alt or a non-Latin layout (K6)', () => {
    expect(mnemonicKeyOf({ key: 'f', code: 'KeyF', altKey: false })).toBe('f');
    expect(mnemonicKeyOf({ key: 'F', code: 'KeyF', altKey: false })).toBe('f');
    // Option+O on a Mac gives 'ø'; AZERTY: the key labelled A is at KeyQ.
    expect(mnemonicKeyOf({ key: 'ø', code: 'KeyO', altKey: true })).toBe('o');
    expect(mnemonicKeyOf({ key: 'a', code: 'KeyQ', altKey: false })).toBe('a');
    expect(mnemonicKeyOf({ key: 'а', code: 'KeyF', altKey: false })).toBe('f'); // Cyrillic а
    expect(mnemonicKeyOf({ key: 'Enter', code: 'Enter', altKey: false })).toBeNull();
    expect(mnemonicKeyOf({ key: '1', code: 'Digit1', altKey: false })).toBe('1');
  });

  it('finds the next item with an access key, wrapping, and says whether it is unique', () => {
    const captions = ['&Run', 'Run To &Cursor', null, '&Auto Trace', '&Step Over', '&Trace Into', 'R&ewind Program'];
    expect(findMnemonic(captions, 'c', -1)).toEqual({ index: 1, unique: true });
    expect(findMnemonic(captions, 'x', -1)).toBeNull();
    const twice = ['&Save', '&Search', 'Other'];
    expect(findMnemonic(twice, 's', -1)).toEqual({ index: 0, unique: false });
    expect(findMnemonic(twice, 's', 0)).toEqual({ index: 1, unique: false });
    expect(findMnemonic(twice, 's', 1)).toEqual({ index: 0, unique: false });
  });

  it('type-ahead finds the next label starting with the text', () => {
    const labels = ['Code', 'Comment', null, 'Directive', 'Label'];
    expect(findTypeahead(labels, 'c', -1)).toBe(0);
    expect(findTypeahead(labels, 'c', 0)).toBe(1);
    expect(findTypeahead(labels, 'co', -1)).toBe(0);
    expect(findTypeahead(labels, 'com', -1)).toBe(1);
    expect(findTypeahead(labels, 'z', 0)).toBe(-1);
  });
});

describe('roving (2.11 arrow keys)', () => {
  const skipped = new Set([1, 3]);
  const isSkipped = (i: number) => skipped.has(i);

  it('moves with the arrows of its orientation, skipping and wrapping', () => {
    expect(moveIndex(5, 0, 'ArrowRight', { orientation: 'horizontal', isSkipped })).toBe(2);
    expect(moveIndex(5, 4, 'ArrowRight', { orientation: 'horizontal', isSkipped })).toBe(0);
    expect(moveIndex(5, 0, 'ArrowLeft', { orientation: 'horizontal', isSkipped })).toBe(4);
    expect(moveIndex(5, 0, 'ArrowDown', { orientation: 'horizontal' })).toBeNull();
    expect(moveIndex(5, 2, 'ArrowDown', { orientation: 'vertical', isSkipped })).toBe(4);
  });

  it('Home and End go to the first and last item that can take the focus', () => {
    expect(moveIndex(5, 2, 'Home', { orientation: 'vertical', isSkipped: (i) => i === 0 })).toBe(1);
    expect(moveIndex(5, 2, 'End', { orientation: 'vertical', isSkipped: (i) => i === 4 })).toBe(3);
  });

  it('without wrap it stops at the ends; from nothing it starts at an end', () => {
    expect(moveIndex(3, 2, 'ArrowDown', { orientation: 'vertical', wrap: false })).toBe(2);
    expect(moveIndex(3, -1, 'ArrowDown', { orientation: 'vertical' })).toBe(0);
    expect(moveIndex(3, -1, 'ArrowUp', { orientation: 'vertical' })).toBe(2);
    expect(moveIndex(3, 0, 'ArrowDown', { orientation: 'vertical', isSkipped: () => true })).toBeNull();
    expect(moveIndex(0, -1, 'Home', { orientation: 'vertical' })).toBeNull();
  });

  it('pages by a viewport less one row, clamped', () => {
    expect(pageIndex(100, 0, 'PageDown', 10)).toBe(9);
    expect(pageIndex(100, 95, 'PageDown', 10)).toBe(99);
    expect(pageIndex(100, 5, 'PageUp', 10)).toBe(0);
  });
});

describe('menu keys (2.11)', () => {
  const items: MenuEntry[] = [
    { type: 'item', id: 'open', caption: '&Open...', shortcut: 'Ctrl+O' },
    { type: 'item', id: 'data', caption: 'Open &Data...' },
    { type: 'separator' },
    { type: 'check', id: 'exc', caption: '&Enable Exceptions', checked: true },
    { type: 'item', id: 'off', caption: '&Printer Setup...', disabled: true },
    { type: 'submenu', id: 'size', caption: 'Output Window &Size', items: [] },
    { type: 'item', id: 'exit', caption: 'E&xit' },
  ];
  const key = (k: string, extra: Partial<MenuKeyEvent> = {}): MenuKeyEvent => ({
    key: k,
    code: k.length === 1 ? `Key${k.toUpperCase()}` : k,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...extra,
  });

  it('Up / Down skip separators and wrap; disabled items can be focused', () => {
    expect(menuKeyAction(items, 1, key('ArrowDown'), false)).toEqual({ type: 'focus', index: 3 });
    expect(menuKeyAction(items, 3, key('ArrowUp'), false)).toEqual({ type: 'focus', index: 1 });
    expect(menuKeyAction(items, 3, key('ArrowDown'), false)).toEqual({ type: 'focus', index: 4 });
    expect(menuKeyAction(items, 6, key('ArrowDown'), false)).toEqual({ type: 'focus', index: 0 });
    expect(menuKeyAction(items, -1, key('ArrowDown'), false)).toEqual({ type: 'focus', index: 0 });
    expect(menuKeyAction(items, 2, key('End'), false)).toEqual({ type: 'focus', index: 6 });
  });

  it('Enter and Space choose an enabled item, open a sub-menu, and ignore a disabled item', () => {
    expect(menuKeyAction(items, 0, key('Enter'), false)).toEqual({ type: 'activate', index: 0 });
    expect(menuKeyAction(items, 3, key(' '), false)).toEqual({ type: 'activate', index: 3 });
    expect(menuKeyAction(items, 4, key('Enter'), false)).toEqual({ type: 'none' });
    expect(menuKeyAction(items, 5, key('Enter'), false)).toEqual({ type: 'openSubmenu', index: 5 });
  });

  it('Right opens a sub-menu or moves to the next menu; Left goes back', () => {
    expect(menuKeyAction(items, 5, key('ArrowRight'), false)).toEqual({ type: 'openSubmenu', index: 5 });
    expect(menuKeyAction(items, 0, key('ArrowRight'), false)).toEqual({ type: 'close', reason: 'right' });
    expect(menuKeyAction(items, 0, key('ArrowLeft'), false)).toEqual({ type: 'close', reason: 'left' });
    expect(menuKeyAction(items, 0, key('ArrowLeft'), true)).toEqual({ type: 'close', reason: 'escape' });
    expect(menuKeyAction(items, 0, key('Escape'), false)).toEqual({ type: 'close', reason: 'escape' });
    expect(menuKeyAction(items, 0, key('Tab'), false)).toEqual({ type: 'close', reason: 'tab' });
  });

  it('an access key chooses its item; a disabled one is only focused', () => {
    expect(menuKeyAction(items, 0, key('x'), false)).toEqual({ type: 'activate', index: 6 });
    expect(menuKeyAction(items, 0, key('d'), false)).toEqual({ type: 'activate', index: 1 });
    expect(menuKeyAction(items, 0, key('s'), false)).toEqual({ type: 'openSubmenu', index: 5 });
    expect(menuKeyAction(items, 0, key('p'), false)).toEqual({ type: 'focus', index: 4 });
    // Option+X on a Mac: the key position decides.
    expect(menuKeyAction(items, 0, key('≈', { code: 'KeyX', altKey: true }), false)).toEqual({
      type: 'activate',
      index: 6,
    });
    // Shortcuts are not menu keys.
    expect(menuKeyAction(items, 0, key('o', { ctrlKey: true }), false)).toBeNull();
  });

  it('two items with one access key: the key moves between them', () => {
    const shared: MenuEntry[] = [
      { type: 'item', id: 'a', caption: '&Find...' },
      { type: 'item', id: 'b', caption: '&Fill' },
    ];
    expect(menuKeyAction(shared, -1, key('f'), false)).toEqual({ type: 'focus', index: 0 });
    expect(menuKeyAction(shared, 0, key('f'), false)).toEqual({ type: 'focus', index: 1 });
  });
});

describe('placePopup', () => {
  const viewport = { width: 800, height: 600 };
  it('puts a menu under its title and flips it above when there is no room', () => {
    expect(placePopup({ x: 10, y: 0, width: 40, height: 22 }, { width: 200, height: 300 }, viewport, 'below')).toEqual({
      x: 10,
      y: 24,
    });
    expect(
      placePopup({ x: 10, y: 500, width: 40, height: 22 }, { width: 200, height: 300 }, viewport, 'below'),
    ).toEqual({
      x: 10,
      y: 198,
    });
  });

  it('puts a sub-menu to the right, or to the left at the screen edge', () => {
    expect(
      placePopup({ x: 100, y: 50, width: 200, height: 26 }, { width: 180, height: 100 }, viewport, 'right'),
    ).toEqual({
      x: 296,
      y: 46,
    });
    expect(
      placePopup({ x: 500, y: 50, width: 200, height: 26 }, { width: 180, height: 100 }, viewport, 'right'),
    ).toEqual({
      x: 324,
      y: 46,
    });
  });

  it('opens a context menu at the point, flipping at the edges, and keeps it on screen', () => {
    expect(placePopup({ x: 700, y: 550, width: 0, height: 0 }, { width: 200, height: 150 }, viewport, 'point')).toEqual(
      {
        x: 500,
        y: 400,
      },
    );
    const huge = placePopup({ x: 10, y: 10, width: 0, height: 0 }, { width: 900, height: 700 }, viewport, 'point');
    expect(huge).toEqual({ x: 4, y: 4 });
  });

  it('centres a tool-tip under its anchor', () => {
    expect(
      placePopup({ x: 100, y: 10, width: 28, height: 28 }, { width: 60, height: 20 }, viewport, 'tooltip'),
    ).toEqual({
      x: 84,
      y: 44,
    });
  });
});

describe('splitter', () => {
  const range = { min: 100, max: 500, defaultValue: 240, orientation: 'vertical' as const };
  it('moves by 10 px, 50 with Shift, inverted for a pane after the bar', () => {
    expect(splitterKeyValue('ArrowRight', false, 200, range)).toBe(210);
    expect(splitterKeyValue('ArrowLeft', true, 200, range)).toBe(150);
    expect(splitterKeyValue('ArrowRight', false, 200, { ...range, invert: true })).toBe(190);
    expect(splitterKeyValue('ArrowDown', false, 200, range)).toBeNull();
    expect(splitterKeyValue('ArrowDown', false, 200, { ...range, orientation: 'horizontal' })).toBe(210);
  });

  it('Home, End and Enter go to the limits and the default; the value stays in range', () => {
    expect(splitterKeyValue('Home', false, 200, range)).toBe(100);
    expect(splitterKeyValue('End', false, 200, range)).toBe(500);
    expect(splitterKeyValue('Enter', false, 200, range)).toBe(240);
    expect(splitterKeyValue('ArrowLeft', true, 110, range)).toBe(100);
    expect(splitterDragValue(200, 1000, range)).toBe(500);
    expect(splitterDragValue(200, 30, { ...range, invert: true })).toBe(170);
  });
});

describe('spin', () => {
  const range = { min: 1, max: 32 };
  it('steps with the arrows and pages, clamped', () => {
    expect(spinKeyValue('ArrowUp', 4, range)).toBe(5);
    expect(spinKeyValue('ArrowDown', 1, range)).toBe(1);
    expect(spinKeyValue('PageUp', 4, range)).toBe(14);
    expect(spinKeyValue('End', 4, range)).toBe(32);
    expect(spinKeyValue('a', 4, range)).toBeNull();
  });

  it('parses typed whole numbers', () => {
    expect(parseSpinText(' 8 ', range)).toBe(8);
    expect(parseSpinText('99', range)).toBe(32);
    expect(parseSpinText('8.5', range)).toBeNull();
    expect(parseSpinText('', range)).toBeNull();
  });
});

describe('virtual rows', () => {
  it('renders the visible rows plus the overscan', () => {
    expect(visibleRange(0, 100, 20, 1000, 0)).toEqual({ start: 0, end: 6 });
    expect(visibleRange(210, 100, 20, 1000, 2)).toEqual({ start: 8, end: 18 });
    expect(visibleRange(19_990, 100, 20, 1000, 2)).toEqual({ start: 997, end: 1000 });
    expect(visibleRange(0, 100, 20, 0)).toEqual({ start: 0, end: 0 });
  });

  it('scrolls a row into view as little as needed, or to a chosen alignment', () => {
    expect(scrollTopFor(2, 'auto', 0, 100, 20, 1000)).toBe(0);
    expect(scrollTopFor(10, 'auto', 0, 100, 20, 1000)).toBe(120);
    expect(scrollTopFor(3, 'auto', 200, 100, 20, 1000)).toBe(60);
    expect(scrollTopFor(10, 'start', 0, 100, 20, 1000)).toBe(200);
    expect(scrollTopFor(10, 'center', 0, 100, 20, 1000)).toBe(160);
    expect(scrollTopFor(999, 'start', 0, 100, 20, 1000)).toBe(19_900);
    expect(rowsPerPage(100, 22)).toBe(4);
  });
});

describe('focus trap', () => {
  it('wraps at the ends', () => {
    expect(trapStep(3, 2, false)).toBe(0);
    expect(trapStep(3, 0, true)).toBe(2);
    expect(trapStep(3, -1, false)).toBe(0);
    expect(trapStep(3, -1, true)).toBe(2);
    expect(trapStep(0, -1, false)).toBeNull();
    expect(trapStep(0, -1, true)).toBeNull();
  });

  it('moves on every Tab itself, not only at the ends (Safari skips buttons; errata W2 entry 13)', () => {
    // Every element once per round, in order; Shift+Tab the reverse.
    const forward: number[] = [];
    const backward: number[] = [];
    let at = 2;
    for (let i = 0; i < 5; i++) forward.push((at = trapStep(5, at, false) ?? -1));
    at = 2;
    for (let i = 0; i < 5; i++) backward.push((at = trapStep(5, at, true) ?? -1));
    expect(forward).toEqual([3, 4, 0, 1, 2]);
    expect(backward).toEqual([1, 0, 4, 3, 2]);
    expect(trapStep(1, 0, false)).toBe(0);
    expect(trapStep(1, 0, true)).toBe(0);
  });

  it('from a point between elements (focus on a non-tabbable element) goes to the neighbours of that point', () => {
    // Two elements come before the focus: Tab goes to the third, Shift+Tab to the second.
    expect(trapStep(5, -1, false, 2)).toBe(2);
    expect(trapStep(5, -1, true, 2)).toBe(1);
    // After the last one: Tab wraps to the first.
    expect(trapStep(5, -1, false, 5)).toBe(0);
    expect(trapStep(5, -1, true, 5)).toBe(4);
    // Outside the dialog or on the dialog itself (nothing before): first / last.
    expect(trapStep(5, -1, false, 0)).toBe(0);
    expect(trapStep(5, -1, true, 0)).toBe(4);
  });
});

describe('focus trap: elements that refuse the focus, and input methods', () => {
  it('tries every element once, starting where trapStep goes, in the direction of the key', () => {
    expect(trapOrder(5, 1, false)).toEqual([2, 3, 4, 0, 1]);
    expect(trapOrder(5, 1, true)).toEqual([0, 4, 3, 2, 1]);
    // From a point between elements: the neighbours of that point first.
    expect(trapOrder(5, -1, false, 2)).toEqual([2, 3, 4, 0, 1]);
    expect(trapOrder(5, -1, true, 2)).toEqual([1, 0, 4, 3, 2]);
    // From outside: first (Tab) or last (Shift+Tab) first.
    expect(trapOrder(3, -1, false)).toEqual([0, 1, 2]);
    expect(trapOrder(3, -1, true)).toEqual([2, 1, 0]);
    expect(trapOrder(1, 0, false)).toEqual([0]);
    expect(trapOrder(0, -1, false)).toEqual([]);
  });

  it('passes over an element that refuses the focus instead of staying put', () => {
    // A simulated dialog list where element 2 refuses focus(): Tab from 1 lands on 3, Shift+Tab from 3 on 1.
    const refuses = new Set([2]);
    const land = (order: number[]) => order.find((index) => !refuses.has(index));
    expect(land(trapOrder(5, 1, false))).toBe(3);
    expect(land(trapOrder(5, 3, true))).toBe(1);
  });

  it('leaves a key to the input method while it composes', () => {
    expect(isImeKey({ isComposing: true, keyCode: 9 })).toBe(true);
    expect(isImeKey({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isImeKey({ isComposing: false, keyCode: 9 })).toBe(false);
    expect(isImeKey({})).toBe(false);
  });
});

describe('message box answers to Escape (a Windows message box)', () => {
  it('Cancel when there is one, OK when it is the only button, otherwise none', () => {
    expect(messageBoxEscapeResult(['OK'])).toBe('OK');
    expect(messageBoxEscapeResult(['OK', 'Cancel'])).toBe('Cancel');
    expect(messageBoxEscapeResult(['Yes', 'No', 'Cancel'])).toBe('Cancel');
    expect(messageBoxEscapeResult(['Yes', 'No'])).toBeNull();
    expect(messageBoxEscapeResult(['Replace', 'Append', 'Cancel'])).toBe('Cancel');
  });
});
