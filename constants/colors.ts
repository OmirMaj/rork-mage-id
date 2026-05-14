function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function derivePrimaryLight(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, Math.min(s * 1.1, 1), Math.min(l + 0.12, 0.9));
}

function derivePrimaryDark(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, s, Math.max(l - 0.12, 0.1));
}

let _customPrimary: string | null = null;
let _customAccent: string | null = null;

export function setCustomColors(primary: string | null, accent: string | null) {
  _customPrimary = primary;
  _customAccent = accent;
}

// ─────────────────────────────────────────────────────────────────────
// Theme state — flipped by ThemeContext via setColorTheme().
// ─────────────────────────────────────────────────────────────────────
//
// Phase 26 (post-pre-launch-audit): the static Colors module had
// hardcoded LIGHT-theme values for `background`, `surface`, `text`,
// etc. — so any screen that referenced `Colors.surface` saw a white
// card even in dark mode. Migrated screens (those using useTheme()
// + useThemedStyles) were unaffected; non-migrated screens showed
// the broken contrast bugs in the user's screenshots.
//
// Making the theme-sensitive properties GETTERS that read from a
// module-level `_currentTheme` variable fixes the bake-in problem
// for inline-JSX reads (every render re-reads the getter, returns the
// right value). It does NOT fully fix the StyleSheet.create case
// (those styles bake at module load), but it DOES fix any file the
// app lazy-imports for the first time AFTER a theme change.
//
// Brand colors (primary, accent, semantic states like success/error)
// stay static — those carry meaning that shouldn't theme.
let _currentTheme: 'light' | 'dark' = 'light';

/** Called by ThemeContext on every resolved-theme change. */
export function setColorTheme(theme: 'light' | 'dark') {
  _currentTheme = theme;
}

/** Read the current theme — useful for branching outside React. */
export function getColorTheme(): 'light' | 'dark' {
  return _currentTheme;
}

export const Colors = {
  // Default brand is MAGE Orange. The forest-green that used to be the
  // default is still available as a THEME_PRESETS option for users who
  // explicitly want it. Anywhere downstream using `Colors.primary` now
  // gets the brand orange unless the user has selected a theme that
  // calls setCustomColors() with a different primary.
  get primary() { return _customPrimary || '#FF6A1A'; },
  get primaryLight() { return _customPrimary ? derivePrimaryLight(_customPrimary) : '#FF8533'; },
  get primaryDark() { return _customPrimary ? derivePrimaryDark(_customPrimary) : '#C44A0F'; },
  // Accent paired with the brand-orange primary. Same hex as the orange
  // ThemeColors.accent so the two color systems stay aligned.
  get accent() { return _customAccent || '#FF6A1A'; },
  accentLight: '#FFCC00',
  accentMuted: '#FFE0A0',

  // ── Surfaces — THEME-AWARE GETTERS (read _currentTheme at access) ──
  get background()       { return _currentTheme === 'dark' ? '#0B0D10' : '#F2F2F7'; },
  get surface()          { return _currentTheme === 'dark' ? '#14181D' : '#FFFFFF'; },
  get surfaceAlt()       { return _currentTheme === 'dark' ? '#1A1F26' : '#F2F2F7'; },
  get surfaceElevated()  { return _currentTheme === 'dark' ? '#1F252D' : '#FFFFFF'; },
  get card()             { return _currentTheme === 'dark' ? '#14181D' : '#FFFFFF'; },
  // Card outline. Soft system-gray in light (Apple's default separator),
  // faint cream in dark. Same identity ("subtle border") either way.
  get cardBorder()       { return _currentTheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(60,60,67,0.18)'; },

  // ── Text — theme-aware ──
  get text()             { return _currentTheme === 'dark' ? '#F4EFE6' : '#000000'; },
  get textSecondary()    { return _currentTheme === 'dark' ? 'rgba(244,239,230,0.7)' : 'rgba(60,60,67,0.6)'; },
  get textMuted()        { return _currentTheme === 'dark' ? 'rgba(244,239,230,0.42)' : 'rgba(60,60,67,0.36)'; },
  textOnPrimary: '#FFFFFF',
  textOnAccent: '#FFFFFF',

  // ── Borders — theme-aware ──
  get border()           { return _currentTheme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(60,60,67,0.18)'; },
  get borderLight()      { return _currentTheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(60,60,67,0.08)'; },

  success: '#34C759',
  successLight: '#E8FAF0',
  // Material-design dark variants — used as foreground text on a *Light
  // tinted card (e.g. dark-green text on a pale-green chip). Audit found
  // 26 inline `#2E7D32`s, 16 `#1E8E4A`s — both consolidate here.
  successDark: '#2E7D32',
  warning: '#FF9500',
  warningLight: '#FFF3E0',
  warningDark: '#E65100',   // 19 inline uses
  error: '#FF3B30',
  errorLight: '#FFF0EF',
  errorDark: '#C62828',     // 19 inline uses
  info: '#007AFF',
  infoLight: '#EBF3FF',
  infoDark: '#1565C0',      // 8 inline uses

  // Apple iOS system purple. Used in a few places (system "Books," some
  // status indicators). 18 inline uses — surfacing as a token.
  purple: '#5856D6',
  purpleLight: '#EBEAFA',

  // Apple iOS system orange (slightly cooler than warning). Used on
  // chips that aren't strictly "warning" semantically.
  orange: '#FF6A1A',        // 11 inline uses

  // ── Shadows + overlays — theme-aware ──
  get shadow()           { return _currentTheme === 'dark' ? 'rgba(0,0,0,0.40)' : 'rgba(0,0,0,0.05)'; },
  get overlay()          { return _currentTheme === 'dark' ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.45)'; },

  // ── Fills — theme-aware ──
  get fillTertiary()     { return _currentTheme === 'dark' ? 'rgba(244,239,230,0.06)' : 'rgba(120,120,128,0.12)'; },
  get fillSecondary()    { return _currentTheme === 'dark' ? 'rgba(244,239,230,0.10)' : 'rgba(120,120,128,0.08)'; },

  // ── Trade colors (Phase 27) — drive Gantt bar + Board phase-dot ──
  // Industry-conventional palette. Saturation-matched for dark mode
  // contrast against `surface` #14181D. Brand amber anchors `general`
  // so the most common bars still feel like MAGE ID.
  tradeColors: {
    general:      '#FF6A1A',
    concrete:     '#90A4AE',
    framing:      '#8D6E63',
    electrical:   '#4FC3F7',
    plumbing:     '#26C6DA',
    hvac:         '#FFA726',
    roofing:      '#EF5350',
    steel:        '#AB47BC',
    demo:         '#FBC02D',
    landscaping:  '#66BB6A',
    finish:       '#F4EFE6',
    closeout:     '#7986CB',
  } as const,

  // Status-pill semantic shortcuts (derived from existing tokens)
  pillOnTrack:  '#4ED37A',
  pillAtRisk:   '#FFA726',
  pillLate:     '#FF5A51',
};

export default {
  light: {
    text: Colors.text,
    background: Colors.background,
    tint: Colors.primary,
    tabIconDefault: Colors.textMuted,
    tabIconSelected: Colors.primary,
  },
};

// ─────────────────────────────────────────────────────────────────────
// Theme — Phase 1. Two variants (light default, dark opt-in).
//
// Consumers do NOT read from here directly. They call useTheme() from
// contexts/ThemeContext.tsx which returns the resolved palette. Reading
// from Theme.light.* or Theme.dark.* directly bypasses the theme system
// and breaks the dark-mode toggle — don't do it.
// ─────────────────────────────────────────────────────────────────────

export type ThemeColors = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  line: string;
  accent: string;
  accentHot: string;
  accentSoft: string;
  accentLabel: string;
  success: string;
  successSoft: string;
  danger: string;
  info: string;
};

export const Theme: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    bg: '#FBF8F2',
    surface: '#FFFFFF',
    surfaceAlt: '#F4EFE6',
    text: '#2B3038',
    textSecondary: 'rgba(43,48,56,0.6)',
    textMuted: 'rgba(43,48,56,0.4)',
    line: 'rgba(43,48,56,0.12)',
    accent: '#FF6A1A',
    accentHot: '#FF8533',
    accentSoft: 'rgba(255,106,26,0.12)',
    accentLabel: '#C44A0F',
    success: '#2E7D44',
    successSoft: 'rgba(46,125,68,0.12)',
    danger: '#C84038',
    info: '#1565C0',
  },
  dark: {
    bg: '#0B0D10',
    surface: '#14181D',
    surfaceAlt: '#1A1F26',
    text: '#F4EFE6',
    textSecondary: '#9AA3AD',
    textMuted: 'rgba(154,163,173,0.6)',
    line: 'rgba(255,255,255,0.06)',
    accent: '#FF6A1A',
    accentHot: '#FF8533',
    accentSoft: 'rgba(255,106,26,0.16)',
    accentLabel: '#FF6A1A',
    success: '#4ED37A',
    successSoft: 'rgba(78,211,122,0.12)',
    danger: '#FF5A51',
    info: '#4EA7FF',
  },
};
