/**
 * Theme Management Service
 * Handles theme switching and CSS variable injection for the 12 Tribes platform
 */

const STORAGE_KEY = '12tribes_theme';
const DEFAULT_THEME = 'dark';

/**
 * Theme definitions with color tokens
 */
const THEMES = {
  dark: {
    name: 'Dark',
    label: 'dark',
    colors: {
      background: '#0f1225',
      surface: 'rgba(22, 24, 48, 0.5)',
      glass: 'rgba(255, 255, 255, 0.05)',
      text: '#ffffff',
      textSecondary: 'rgba(255, 255, 255, 0.6)',
      textTertiary: 'rgba(255, 255, 255, 0.4)',
      accent: '#00D4FF',
      accentHover: '#00B0D4',
      accentActive: '#0099B3',
      success: '#00FF00',
      danger: '#FF0000',
      warning: '#FFD700',
      border: 'rgba(255, 255, 255, 0.1)',
      borderLight: 'rgba(255, 255, 255, 0.05)',
      glow: 'rgba(0, 212, 255, 0.1)',
      glowIntense: 'rgba(0, 212, 255, 0.3)',
      overlay: 'rgba(10, 10, 26, 0.8)',
      scrollbar: 'rgba(0, 212, 255, 0.3)',
      scrollbarTrack: 'rgba(255, 255, 255, 0.05)'
    },
    preview: {
      primary: '#00D4FF',
      secondary: '#0a0a1a',
      accent: '#ffffff'
    }
  },
  light: {
    name: 'Light',
    label: 'light',
    colors: {
      background: '#F2F4F8',
      surface: 'rgba(255, 255, 255, 0.8)',
      glass: 'rgba(255, 255, 255, 0.6)',
      text: '#111827',
      textSecondary: 'rgba(17, 24, 39, 0.6)',
      textTertiary: 'rgba(17, 24, 39, 0.4)',
      accent: '#0077CC',
      accentHover: '#005FA3',
      accentActive: '#004D85',
      success: '#059669',
      danger: '#DC2626',
      warning: '#D97706',
      border: 'rgba(0, 0, 0, 0.1)',
      borderLight: 'rgba(0, 0, 0, 0.05)',
      glow: 'rgba(0, 119, 204, 0.08)',
      glowIntense: 'rgba(0, 119, 204, 0.2)',
      overlay: 'rgba(245, 247, 250, 0.85)',
      scrollbar: 'rgba(0, 119, 204, 0.3)',
      scrollbarTrack: 'rgba(0, 0, 0, 0.05)',
      glassBg: 'rgba(255, 255, 255, 0.7)',
      glassBorder: 'rgba(0, 0, 0, 0.08)',
      glassShadow: '0 4px 24px rgba(0,0,0,0.06), 0 0 0 0.5px rgba(0,0,0,0.04)',
      cardBg: '#ffffff',
      navText: 'rgba(17, 24, 39, 0.5)',
      navActive: '#0077CC',
      navActiveBg: 'rgba(0, 119, 204, 0.1)',
      inputBg: 'rgba(0, 0, 0, 0.03)',
      inputBorder: 'rgba(0, 0, 0, 0.08)',
    },
    preview: {
      primary: '#0077CC',
      secondary: '#F5F7FA',
      accent: '#111827'
    }
  },
  midnight: {
    name: 'Midnight',
    label: 'midnight',
    colors: {
      background: '#000000',
      surface: 'rgba(5, 5, 15, 0.7)',
      glass: 'rgba(255, 255, 255, 0.04)',
      text: '#ffffff',
      textSecondary: 'rgba(255, 255, 255, 0.5)',
      textTertiary: 'rgba(255, 255, 255, 0.3)',
      accent: '#00D4FF',
      accentHover: '#00B0D4',
      accentActive: '#0099B3',
      success: '#00FF00',
      danger: '#FF0000',
      warning: '#FFD700',
      border: 'rgba(255, 255, 255, 0.08)',
      borderLight: 'rgba(255, 255, 255, 0.03)',
      glow: 'rgba(0, 212, 255, 0.08)',
      glowIntense: 'rgba(0, 212, 255, 0.25)',
      overlay: 'rgba(0, 0, 0, 0.9)',
      scrollbar: 'rgba(0, 212, 255, 0.25)',
      scrollbarTrack: 'rgba(255, 255, 255, 0.03)'
    },
    preview: {
      primary: '#00D4FF',
      secondary: '#000000',
      accent: '#ffffff'
    }
  }
};

/**
 * Resolve 'auto' to the actual theme based on system preference
 * @returns {string} Resolved theme name
 */
function resolveAutoTheme() {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
  return prefersDark ? 'dark' : 'light';
}

/**
 * Get the stored preference (may be 'auto')
 * @returns {string} Raw stored preference
 */
export function getThemePreference() {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
}

/**
 * Get current active theme name (resolves 'auto' to actual theme)
 * @returns {string} Theme name (dark, light, midnight)
 */
export function getTheme() {
  if (typeof window === 'undefined') return DEFAULT_THEME;

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'auto') return resolveAutoTheme();
  if (stored && THEMES[stored]) {
    return stored;
  }
  return DEFAULT_THEME;
}

/**
 * Set theme and persist preference
 * @param {string} themeName - Theme name (dark, light, midnight, auto)
 * @returns {boolean} Success status
 */
export function setTheme(themeName) {
  if (typeof window === 'undefined') return false;

  if (themeName !== 'auto' && !THEMES[themeName]) {
    console.warn(`Theme "${themeName}" not found`);
    return false;
  }

  localStorage.setItem(STORAGE_KEY, themeName);
  const resolved = themeName === 'auto' ? resolveAutoTheme() : themeName;
  applyTheme(resolved);
  return true;
}

/**
 * Get complete color object for a theme
 * @param {string} themeName - Theme name
 * @returns {object} Color tokens object
 */
export function getThemeColors(themeName = null) {
  const name = themeName || getTheme();
  if (!THEMES[name]) {
    return THEMES[DEFAULT_THEME].colors;
  }
  return THEMES[name].colors;
}

/**
 * Apply theme by injecting CSS variables into document
 * @param {string} themeName - Theme name
 */
export function applyTheme(themeName = null) {
  if (typeof window === 'undefined') return;

  const name = themeName || getTheme();
  const theme = THEMES[name];

  if (!theme) {
    console.warn(`Theme "${name}" not found, using default`);
    return;
  }

  const root = document.documentElement;
  const colors = theme.colors;

  // Inject CSS variables
  Object.entries(colors).forEach(([key, value]) => {
    const varName = `--color-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
    root.style.setProperty(varName, value);
  });

  // Set global theme attribute for CSS selectors
  root.setAttribute('data-theme', name);
  document.body.setAttribute('data-theme', name);

  // Update CSS for common selectors
  injectThemeStyles(theme);
}

/**
 * Inject dynamic theme styles into page
 * @private
 * @param {object} theme - Theme object
 */
function injectThemeStyles(theme) {
  const colors = theme.colors;

  // Create or update style element
  let styleEl = document.getElementById('12tribes-theme-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = '12tribes-theme-styles';
    document.head.appendChild(styleEl);
  }

  const colorScheme = theme.label === 'light' ? 'light' : 'dark';
  styleEl.textContent = `
    :root[data-theme="${theme.label}"] {
      color-scheme: ${colorScheme};
    }

    [data-theme="${theme.label}"] {
      --bg-primary: ${colors.background};
      --bg-surface: ${colors.surface};
      --bg-glass: ${colors.glass};
      --text-primary: ${colors.text};
      --text-secondary: ${colors.textSecondary};
      --text-tertiary: ${colors.textTertiary};
      --accent: ${colors.accent};
      --accent-hover: ${colors.accentHover};
      --accent-active: ${colors.accentActive};
      --success: ${colors.success};
      --danger: ${colors.danger};
      --warning: ${colors.warning};
      --border: ${colors.border};
      --border-light: ${colors.borderLight};
      --glow: ${colors.glow};
      --glow-intense: ${colors.glowIntense};
      --overlay: ${colors.overlay};
    }

    /* Scrollbar styling */
    [data-theme="${theme.label}"] ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }

    [data-theme="${theme.label}"] ::-webkit-scrollbar-track {
      background: ${colors.scrollbarTrack};
    }

    [data-theme="${theme.label}"] ::-webkit-scrollbar-thumb {
      background: ${colors.scrollbar};
      border-radius: 4px;
    }

    [data-theme="${theme.label}"] ::-webkit-scrollbar-thumb:hover {
      background: ${colors.accent};
    }

    /* Selection color */
    [data-theme="${theme.label}"] ::selection {
      background-color: ${colors.accent};
      color: ${colors.background};
    }

    [data-theme="${theme.label}"] ::-moz-selection {
      background-color: ${colors.accent};
      color: ${colors.background};
    }
  `;
}

/**
 * Get available themes with preview colors
 * @returns {array} Array of theme objects with metadata
 */
export function getAvailableThemes() {
  return Object.entries(THEMES).map(([key, theme]) => ({
    id: key,
    name: theme.name,
    label: theme.label,
    preview: theme.preview,
    colors: theme.colors
  }));
}

/**
 * Get theme by name
 * @param {string} themeName - Theme name
 * @returns {object|null} Theme object or null
 */
export function getThemeByName(themeName) {
  return THEMES[themeName] || null;
}

/**
 * Check if theme exists
 * @param {string} themeName - Theme name
 * @returns {boolean}
 */
export function hasTheme(themeName) {
  return !!THEMES[themeName];
}

/**
 * Reset theme to default
 */
export function resetToDefaultTheme() {
  if (typeof window === 'undefined') return;

  localStorage.removeItem(STORAGE_KEY);
  applyTheme(DEFAULT_THEME);
}

/**
 * Get current theme details
 * @returns {object} Current theme information
 */
export function getCurrentThemeInfo() {
  const themeName = getTheme();
  const theme = THEMES[themeName];

  return {
    name: theme.name,
    label: theme.label,
    colors: theme.colors,
    preview: theme.preview
  };
}

/**
 * Initialize theme service on app load
 * Applies saved theme or default, sets up system preference listener for 'auto'
 */
export function initializeTheme() {
  if (typeof window === 'undefined') return;

  const savedTheme = localStorage.getItem(STORAGE_KEY);
  if (savedTheme === 'auto') {
    applyTheme(resolveAutoTheme());
  } else if (savedTheme && THEMES[savedTheme]) {
    applyTheme(savedTheme);
  } else {
    applyTheme(DEFAULT_THEME);
  }

  // Listen for system preference changes when in 'auto' mode
  const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (mql?.addEventListener) {
    mql.addEventListener('change', () => {
      if (localStorage.getItem(STORAGE_KEY) === 'auto') {
        applyTheme(resolveAutoTheme());
      }
    });
  }
}

/**
 * Listen for theme changes (useful for React state)
 * Returns unsubscribe function
 * @param {function} callback - Function called when theme changes
 * @returns {function} Unsubscribe function
 */
export function onThemeChange(callback) {
  if (typeof window === 'undefined') return () => {};

  const handler = () => {
    callback(getTheme());
  };

  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      handler();
    }
  });

  // Return unsubscribe function
  return () => {
    window.removeEventListener('storage', handler);
  };
}

/**
 * Get complementary color for accessibility contrast
 * @param {string} themeName - Theme name
 * @param {string} colorKey - Color token key
 * @returns {string} Hex color
 */
export function getComplementaryColor(themeName, colorKey) {
  const colors = getThemeColors(themeName);

  // Map color to complementary color for good contrast
  const complementary = {
    accent: colors.text,
    text: colors.accent,
    success: colors.background,
    danger: colors.background,
    warning: colors.background
  };

  return complementary[colorKey] || colors.text;
}

/**
 * Export theme as JSON for backup/sharing
 * @param {string} themeName - Theme name
 * @returns {string} JSON string
 */
export function exportTheme(themeName) {
  const theme = THEMES[themeName];
  if (!theme) return null;

  return JSON.stringify({
    name: theme.name,
    label: theme.label,
    colors: theme.colors,
    preview: theme.preview,
    exportedAt: new Date().toISOString()
  }, null, 2);
}

// Auto-initialize on module load
if (typeof window !== 'undefined') {
  // Use MutationObserver or ResizeObserver workaround for SSR compatibility
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeTheme);
  } else {
    initializeTheme();
  }
}
