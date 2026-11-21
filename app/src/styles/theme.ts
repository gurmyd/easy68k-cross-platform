// Theme switching (ARCHITECTURE.md 2.8). Owner: W2.
//
// tokens.css holds the light values on :root and the dark values under
// :root[data-theme="dark"]. This module sets that attribute from the user's
// setting (AppSettings.theme, 3.10): 'light', 'dark', or 'system', which
// follows prefers-color-scheme and keeps following it while the page runs.
//
// The browser objects are passed in, so the logic runs under Node in tests.

export type ThemeSetting = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_SETTINGS: readonly ThemeSetting[] = ['system', 'light', 'dark'];

/** The media query that tells whether the system prefers dark colours. */
export const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The theme to show for a setting, given the system's preference. */
export function resolveTheme(setting: ThemeSetting, systemPrefersDark: boolean): Theme {
  if (setting === 'light' || setting === 'dark') return setting;
  return systemPrefersDark ? 'dark' : 'light';
}

/** The parts of a MediaQueryList that applyThemeSetting uses. */
export interface DarkQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

export interface ThemeTarget {
  /** Usually document.documentElement. */
  root: { setAttribute(name: string, value: string): void };
  /** Usually window.matchMedia(DARK_QUERY); null when there is no such API. */
  darkQuery: DarkQuery | null;
}

/**
 * Sets data-theme on the root for `setting` and, for 'system', keeps it in
 * step with the system's preference. Returns a function that stops listening.
 * Call it again (after disposing the previous one) when the setting changes.
 */
export function applyThemeSetting(
  setting: ThemeSetting,
  target: ThemeTarget = browserThemeTarget(),
  onChange?: (theme: Theme) => void,
): () => void {
  const apply = () => {
    const theme = resolveTheme(setting, target.darkQuery?.matches ?? false);
    target.root.setAttribute('data-theme', theme);
    onChange?.(theme);
  };
  apply();
  if (setting !== 'system' || !target.darkQuery) return () => {};
  const query = target.darkQuery;
  query.addEventListener('change', apply);
  return () => query.removeEventListener('change', apply);
}

/** The document root and the dark-mode media query of the current page. */
export function browserThemeTarget(): ThemeTarget {
  return {
    root: document.documentElement,
    darkQuery: typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null,
  };
}
