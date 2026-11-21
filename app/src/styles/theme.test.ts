import { describe, expect, it } from 'vitest';
import { applyThemeSetting, resolveTheme, type DarkQuery } from './theme';

function fakeQuery(initial: boolean) {
  const listeners = new Set<() => void>();
  const query: DarkQuery & { set(value: boolean): void; count(): number } = {
    matches: initial,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    set(value) {
      (this as { matches: boolean }).matches = value;
      for (const listener of listeners) listener();
    },
    count: () => listeners.size,
  };
  return query;
}

function fakeRoot() {
  const attributes = new Map<string, string>();
  return { setAttribute: (name: string, value: string) => attributes.set(name, value), attributes };
}

describe('resolveTheme', () => {
  it.each([
    ['light', false, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    ['dark', true, 'dark'],
    ['system', false, 'light'],
    ['system', true, 'dark'],
  ] as const)('%s with system dark = %s gives %s', (setting, prefersDark, expected) => {
    expect(resolveTheme(setting, prefersDark)).toBe(expected);
  });
});

describe('applyThemeSetting', () => {
  it('sets data-theme for a fixed setting and does not listen', () => {
    const root = fakeRoot();
    const query = fakeQuery(true);
    applyThemeSetting('light', { root, darkQuery: query });
    expect(root.attributes.get('data-theme')).toBe('light');
    expect(query.count()).toBe(0);
  });

  it('follows the system preference for "system" until disposed', () => {
    const root = fakeRoot();
    const query = fakeQuery(false);
    const seen: string[] = [];
    const dispose = applyThemeSetting('system', { root, darkQuery: query }, (theme) => seen.push(theme));
    expect(root.attributes.get('data-theme')).toBe('light');
    query.set(true);
    expect(root.attributes.get('data-theme')).toBe('dark');
    dispose();
    expect(query.count()).toBe(0);
    query.set(false);
    expect(root.attributes.get('data-theme')).toBe('dark');
    expect(seen).toEqual(['light', 'dark']);
  });

  it('falls back to light when there is no media query API', () => {
    const root = fakeRoot();
    applyThemeSetting('system', { root, darkQuery: null });
    expect(root.attributes.get('data-theme')).toBe('light');
  });
});
