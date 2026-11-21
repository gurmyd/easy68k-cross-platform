// The application's global styles (ARCHITECTURE.md 2.8). Owner: W2.
// The entry point imports this module once: `import './styles';`.
// Component styles come with the components (app/src/ui/components/*.css).

import './tokens.css';
import './base.css';
import './components.css';

export {
  DARK_QUERY,
  THEME_SETTINGS,
  applyThemeSetting,
  browserThemeTarget,
  resolveTheme,
  type Theme,
  type ThemeSetting,
  type ThemeTarget,
} from './theme';
