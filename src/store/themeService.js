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
      // Deep navy — gradient applied via CSS, this is the fallback
      background: '#0B0F1E',
      surface: 'rgba(14, 18, 38, 0.65)',
      glass: 'rgba(255, 255, 255, 0.055)',
      // Text
      text: '#F1F5FF',
      textSecondary: 'rgba(241, 245, 255, 0.58)',
      textTertiary: 'rgba(241, 245, 255, 0.35)',
      // Accent — electric cyan
      accent: '#00D4FF',
      accentHover: '#00BBDF',
      accentActive: '#009EBF',
      // ── Semantic colors — refined fintech palette, NOT terminal-era primaries ──
      success: '#10B981',   // Emerald-500 — clean, modern
      danger:  '#F87171',   // Red-400 — visible but not aggressive
      warning: '#FBBF24',   // Amber-400 — warm gold without harshness
      // Borders — fine, directional
      border: 'rgba(255, 255, 255, 0.08)',
      borderLight: 'rgba(255, 255, 255, 0.04)',
      // Glows
      glow: 'rgba(0, 212, 255, 0.09)',
      glowIntense: 'rgba(0, 212, 255, 0.22)',
      // Overlay
      overlay: 'rgba(7, 10, 22, 0.85)',
      // Scrollbar
      scrollbar: 'rgba(0, 212, 255, 0.22)',
      scrollbarTrack: 'rgba(255, 255, 255, 0.04)',
    },
    preview: {
      primary: '#00D4FF',
      secondary: '#0B0F1E',
      accent: '#F1F5FF'
    }
  },
  light: {
    name: 'Light',
    label: 'light',
    colors: {
      // Page background — near-white with faint cool tint (gradient applied via CSS)
      background: '#F9FBFF',
      // Frosted glass surfaces
      surface: 'rgba(255, 255, 255, 0.82)',
      glass: 'rgba(255, 255, 255, 0.72)',
      // Text — high-contrast dark slate hierarchy
      text: '#0F172A',
      textSecondary: 'rgba(15, 23, 42, 0.62)',
      textTertiary: 'rgba(15, 23, 42, 0.38)',
      // Accent — rich financial blue
      accent: '#0066CC',
      accentHover: '#0052A3',
      accentActive: '#003D7A',
      // Semantic colors
      success: '#059669',
      danger: '#DC2626',
      warning: '#D97706',
      // Borders — fine and airy
      border: 'rgba(0, 0, 0, 0.07)',
      borderLight: 'rgba(0, 0, 0, 0.04)',
      // Glow — blue-tinted, soft
      glow: 'rgba(0, 102, 204, 0.07)',
      glowIntense: 'rgba(0, 102, 204, 0.18)',
      // Overlays
      overlay: 'rgba(240, 246, 255, 0.88)',
      // Scrollbar
      scrollbar: 'rgba(15, 23, 42, 0.15)',
      scrollbarTrack: 'rgba(15, 23, 42, 0.03)',
      // Glass card tokens
      glassBg: 'rgba(255, 255, 255, 0.78)',
      glassBorder: 'rgba(0, 0, 0, 0.06)',
      glassShadow: '0 2px 4px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.07), 0 0 0 0.5px rgba(0,0,0,0.05), inset 0 0.5px 0 rgba(255,255,255,1)',
      cardBg: '#ffffff',
      // Nav
      navText: 'rgba(15, 23, 42, 0.48)',
      navActive: '#0066CC',
      navActiveBg: 'rgba(0, 102, 204, 0.09)',
      // Inputs
      inputBg: 'rgba(255, 255, 255, 0.75)',
      inputBorder: 'rgba(0, 0, 0, 0.12)',
    },
    preview: {
      primary: '#0066CC',
      secondary: '#F4F8FF',
      accent: '#0F172A'
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
