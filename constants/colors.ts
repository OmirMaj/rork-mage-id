// Colors — single source of truth.
//
// Theme-aware: every surface + text token below is a *getter* that
// reads from `_currentTheme`. ThemeContext flips `_currentTheme` via
// `setColorTheme()` whenever the user toggles light/dark/system.
//
// Important caveat: StyleSheet.create() captures values at module
// load time. Files that put `Colors.text` inside StyleSheet.create
// won't observe theme changes after their first render (the captured
// value is frozen). The fix is either:
//   1. Read Colors at render time via inline JSX styles, or
//   2. Use `useThemedColors()` hook + recompute styles per render.
// New screens should prefer pattern #2; legacy screens that haven't
// migrated still benefit from this module's getter pattern when their
// files are first imported AFTER a theme change (lazy-loaded routes).

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

// ─────────────────────────────────────────────────────────────────────
// Theme state
// ─────────────────────────────────────────────────────────────────────

let _customPrimary: string | null = null;
let _customAccent: string | null = null;
let _currentTheme: 'light' | 'dark' = 'light';

/** Set the user's primary/accent overrides. Called from settings. */
export function setCustomColors(primary: string | null, accent: string | null) {
  _customPrimary = primary;
  _customAccent = accent;
}

/** Set the current theme. Called by ThemeContext whenever the resolved
 *  theme (light/dark) changes. Affects all theme-aware getters below.
 *  Does NOT force re-renders on its own — pair with a React key bump
 *  at the root to force any inline-style consumers to re-evaluate. */
export function setColorTheme(theme: 'light' | 'dark') {
  _currentTheme = theme;
}

/** Read the current theme. Used by getters + by consumers that need to
 *  branch on theme outside a React tree. */
export function getColorTheme(): 'light' | 'dark' {
  return _currentTheme;
}

// ─────────────────────────────────────────────────────────────────────
// Theme-aware Colors object
// ─────────────────────────────────────────────────────────────────────
//
// Surface + text tokens are getters that branch on `_currentTheme`.
// Brand tokens (primary, accent), neutrals (ink/steel/cream — they're
// brand reference colors), and semantic states (success/warning/error)
// stay constant across themes.

export const Colors = {
  // ── Brand: primary + accent (user-customizable, theme-stable) ──
  get primary() {
    const base = _customPrimary || '#1A6B3C';
    // In dark mode, lift the green so it reads against ink surfaces.
    // Mirrors the dark palette in hooks/useThemedColors.ts.
    return _currentTheme === 'dark' ? '#22C55E' : base;
  },
  get primaryLight() {
    return _customPrimary ? derivePrimaryLight(_customPrimary) : '#2A9055';
  },
  get primaryDark() {
    return _customPrimary ? derivePrimaryDark(_customPrimary) : '#0F4526';
  },
  // Brand amber — matches /marketing/landing.css `--amber: #FF6A1A`
  // and app/onboarding.tsx BRAND.orange. Was iOS-system #FF9500 which
  // collapsed the brand voice once users left onboarding. Now the
  // accent is THE brand color, used for primary CTAs sitewide.
  get accent() { return _customAccent || '#FF6A1A'; },
  accentHot: '#FF8533',
  accentLight: '#FFCC00',
  accentMuted: '#FFE0A0',
  accentSoft: 'rgba(255, 106, 26, 0.16)',
  accentGlow: 'rgba(255, 106, 26, 0.35)',

  // ── Brand neutrals — fixed reference colors ──
  // Ported from /marketing/landing.css. Used on hero / empty states /
  // Permit Q&A so the app carries the same voice as marketing.
  ink: '#0B0D10',
  steel: '#14181D',
  concrete: '#2A2F36',
  cream: '#F4EFE6',
  bone: '#E8E1D4',
  off: '#FBF8F2',

  // ── Surfaces — theme-aware ──
  get background() {
    return _currentTheme === 'dark' ? '#0B0D10' : '#F2F2F7';
  },
  get surface() {
    return _currentTheme === 'dark' ? '#14181D' : '#FFFFFF';
  },
  get surfaceAlt() {
    return _currentTheme === 'dark' ? '#1A1F26' : '#F2F2F7';
  },
  get surfaceElevated() {
    return _currentTheme === 'dark' ? '#1F252D' : '#FFFFFF';
  },
  get card() {
    return _currentTheme === 'dark' ? '#14181D' : '#FFFFFF';
  },
  // Card outline. Soft system-gray (Apple's default separator color) in
  // light, faint cream in dark.
  get cardBorder() {
    return _currentTheme === 'dark'
      ? 'rgba(255,255,255,0.08)'
      : 'rgba(60,60,67,0.18)';
  },

  // ── Text — theme-aware ──
  // This is the one the user calls out: "names don't change color."
  // In dark mode, text inverts to cream so names/labels stay readable
  // against the dark ink/steel surfaces.
  get text() {
    return _currentTheme === 'dark' ? '#F4EFE6' : '#000000';
  },
  get textSecondary() {
    return _currentTheme === 'dark'
      ? 'rgba(244,239,230,0.7)'
      : 'rgba(60,60,67,0.6)';
  },
  get textMuted() {
    return _currentTheme === 'dark'
      ? 'rgba(244,239,230,0.42)'
      : 'rgba(60,60,67,0.36)';
  },
  textOnPrimary: '#FFFFFF',
  textOnAccent: '#FFFFFF',

  // ── Borders — theme-aware ──
  get border() {
    return _currentTheme === 'dark'
      ? 'rgba(255,255,255,0.12)'
      : 'rgba(60,60,67,0.18)';
  },
  get borderLight() {
    return _currentTheme === 'dark'
      ? 'rgba(255,255,255,0.06)'
      : 'rgba(60,60,67,0.08)';
  },

  // ── Semantic colors — fixed across themes (status meaning is universal) ──
  success: '#34C759',
  successLight: '#E8FAF0',
  // Material-design dark variants — used as foreground text on a *Light
  // tinted card (e.g. dark-green text on a pale-green chip).
  successDark: '#2E7D32',
  warning: '#FF9500',
  warningLight: '#FFF3E0',
  warningDark: '#E65100',
  error: '#FF3B30',
  errorLight: '#FFF0EF',
  errorDark: '#C62828',
  info: '#007AFF',
  infoLight: '#EBF3FF',
  infoDark: '#1565C0',

  // Apple iOS system purple. Used in a few places (system "Books," some
  // status indicators).
  purple: '#5856D6',
  purpleLight: '#EBEAFA',

  // Apple iOS system orange (slightly cooler than warning). Used on
  // chips that aren't strictly "warning" semantically.
  orange: '#FF6A1A',

  // ── Shadows + overlays — theme-aware ──
  get shadow() {
    return _currentTheme === 'dark' ? 'rgba(0,0,0,0.40)' : 'rgba(0,0,0,0.05)';
  },
  get overlay() {
    return _currentTheme === 'dark' ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.45)';
  },

  // ── Fills — theme-aware ──
  get fillTertiary() {
    return _currentTheme === 'dark'
      ? 'rgba(244,239,230,0.06)'
      : 'rgba(120,120,128,0.12)';
  },
  get fillSecondary() {
    return _currentTheme === 'dark'
      ? 'rgba(244,239,230,0.10)'
      : 'rgba(120,120,128,0.08)';
  },

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
