// Owner: Q1.
import { describe, expect, it } from 'vitest';
import { isSafariTabStop, playwrightKey } from './keys.mjs';

describe('playwrightKey', () => {
  it('spells the chords of the key table for Playwright', () => {
    expect(playwrightKey('F9')).toBe('F9');
    expect(playwrightKey('Ctrl+F2')).toBe('Control+F2');
    expect(playwrightKey('Shift+F4')).toBe('Shift+F4');
    expect(playwrightKey('Ctrl+O')).toBe('Control+KeyO');
    expect(playwrightKey('Cmd+O')).toBe('Meta+KeyO');
    expect(playwrightKey('Shift+Cmd+S')).toBe('Shift+Meta+KeyS');
  });

  it('gives the release chord of both key maps by position (rule K6)', () => {
    // chordsOn() returns Ctrl+Alt+O for both: Option is Alt in the normal form.
    expect(playwrightKey('Ctrl+Alt+O')).toBe('Control+Alt+KeyO');
  });

  it('names the named keys and the punctuation as Playwright does', () => {
    expect(playwrightKey('Alt+Enter')).toBe('Alt+Enter');
    expect(playwrightKey('Esc')).toBe('Escape');
    expect(playwrightKey('Shift+Insert')).toBe('Shift+Insert');
    expect(playwrightKey('Cmd+/')).toBe('Meta+Slash');
    expect(playwrightKey('Ctrl+Shift+.')).toBe('Control+Shift+Period');
    expect(playwrightKey('Ctrl+Shift+,')).toBe('Control+Shift+Comma');
    expect(playwrightKey('Up')).toBe('ArrowUp');
    expect(playwrightKey('Ctrl+1')).toBe('Control+Digit1');
  });

  it('takes "+" as a key', () => {
    expect(playwrightKey('Ctrl++')).toBe('Control+Equal');
  });

  it('refuses what is not a chord of the table', () => {
    expect(() => playwrightKey('')).toThrow();
    expect(() => playwrightKey('Hyper+A')).toThrow(/modifier/);
    expect(() => playwrightKey('Ctrl+F25')).toThrow(/key/);
  });
});

/** A small stand-in for a DOM element: what isSafariTabStop reads. */
function element(tag, attributes = {}, { editable = false, inModal = false } = {}) {
  return {
    tagName: tag.toUpperCase(),
    isContentEditable: editable,
    getAttribute: (name) => (name in attributes ? attributes[name] : null),
    closest: () => (inModal ? {} : null),
  };
}

describe('isSafariTabStop (Safari, "Keyboard navigation" off)', () => {
  it('stops on text fields, text areas, pop-up lists and editable content', () => {
    expect(isSafariTabStop(element('input'))).toBe(true);
    expect(isSafariTabStop(element('input', { type: 'text' }))).toBe(true);
    expect(isSafariTabStop(element('input', { type: 'search' }))).toBe(true);
    expect(isSafariTabStop(element('textarea'))).toBe(true);
    expect(isSafariTabStop(element('select'))).toBe(true);
    expect(isSafariTabStop(element('div', {}, { editable: true }))).toBe(true);
  });

  it('skips buttons, check boxes and radio buttons without an explicit tabindex', () => {
    expect(isSafariTabStop(element('button'))).toBe(false);
    expect(isSafariTabStop(element('input', { type: 'checkbox' }))).toBe(false);
    expect(isSafariTabStop(element('input', { type: 'radio' }))).toBe(false);
    expect(isSafariTabStop(element('a', { href: '#' }))).toBe(false);
  });

  it('stops on anything with an explicit tabindex of 0 or more', () => {
    expect(isSafariTabStop(element('button', { tabindex: '0' }))).toBe(true);
    expect(isSafariTabStop(element('div', { tabindex: '0', role: 'grid' }))).toBe(true);
    expect(isSafariTabStop(element('button', { tabindex: '-1' }))).toBe(false);
  });

  it('stops on every control inside a modal dialog (the dialog moves the focus itself)', () => {
    expect(isSafariTabStop(element('button', {}, { inModal: true }))).toBe(true);
  });

  it('is false for nothing', () => {
    expect(isSafariTabStop(null)).toBe(false);
  });
});
