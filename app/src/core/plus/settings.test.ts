// readPlus returns the defaults for every malformed value (ARCHITECTURE-PLUS P4.2; N0 acceptance:
// "a table test").

import { describe, expect, it } from 'vitest';
import type { Settings } from '../../contracts';
import { defaultSettings } from '../settings/defaults';
import { PLUS_DEFAULTS, readPlus, withPlus } from './settings';

function stored(plus: unknown): Settings {
  const settings = defaultSettings();
  return { ...settings, app: { ...settings.app, plus } } as unknown as Settings;
}

/** [what is stored as app.plus, what readPlus returns] */
const TABLE: [string, unknown, { viewer: boolean; history: boolean }][] = [
  ['absent', undefined, { viewer: true, history: true }],
  ['null', null, { viewer: true, history: true }],
  ['a number', 7, { viewer: true, history: true }],
  ['a string', 'off', { viewer: true, history: true }],
  ['true', true, { viewer: true, history: true }],
  ['an array', [false, false], { viewer: true, history: true }],
  ['an empty object', {}, { viewer: true, history: true }],
  ['both off', { viewer: false, history: false }, { viewer: false, history: false }],
  ['viewer off', { viewer: false }, { viewer: false, history: true }],
  ['history off', { history: false }, { viewer: true, history: false }],
  ['strings', { viewer: 'false', history: 'false' }, { viewer: true, history: true }],
  ['numbers', { viewer: 0, history: 1 }, { viewer: true, history: true }],
  ['null members', { viewer: null, history: null }, { viewer: true, history: true }],
  ['one good, one bad', { viewer: false, history: 'no' }, { viewer: false, history: true }],
  ['extra members are ignored', { viewer: false, history: true, other: 1 }, { viewer: false, history: true }],
];

describe('readPlus (P4.2)', () => {
  it.each(TABLE)('%s', (_name, plus, expected) => {
    expect(readPlus(stored(plus))).toEqual(expected);
  });

  it('defaults: both switches on (D1)', () => {
    expect(PLUS_DEFAULTS).toEqual({ viewer: true, history: true });
    expect(readPlus(defaultSettings())).toEqual({ viewer: true, history: true });
  });

  it('a malformed settings document reads as the defaults', () => {
    expect(readPlus({} as Settings)).toEqual(PLUS_DEFAULTS);
    expect(readPlus({ app: null } as unknown as Settings)).toEqual(PLUS_DEFAULTS);
  });

  it('withPlus changes one switch and keeps the other and every other setting', () => {
    const before = stored({ viewer: false, history: 'x' });
    const after = withPlus(before, { history: false });
    expect(after.app.plus).toEqual({ viewer: false, history: false });
    expect(after.app.layout).toBe(before.app.layout);
    expect(after.editor).toBe(before.editor);
  });
});
