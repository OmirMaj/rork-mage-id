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
  // Accent FILL under WHITE text — founder decision #1. The brand hue gives
  // white only 2.87:1 (fails AA); this darkened companion clears 4.5:1 (white
  // on #BC440C = 5.29:1). A GETTER mirroring `get accent()` so the five button
  // files that read `Colors.accentFill` (rather than the themed `t.accentFill`)
  // resolve it the same way. #BC440C is the same value in light and its dark
  // equivalent — white clears AA on it in either theme — so it returns
  // unconditionally, matching Theme.light.accentFill / Theme.dark.accentFill.
  get accentFill() { return '#BC440C'; },

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

  // ── Status bar-fill colors — drive the Gantt "Color: Status" mode ──
  // SOLID, saturated fills (not the translucent chip tints) so a bar reads as
  // a strong block at any zoom. Semantics match GridPane's statusChip():
  //   done         → green   (successDark #2E7D32 — darker than #34C759 so
  //                           white bar labels clear WCAG on the fill)
  //   in_progress  → blue    (info #007AFF)
  //   on_hold      → amber   (warning #FF9500)
  //   not_started  → neutral (solid mid-gray; the translucent fillTertiary is
  //                           too faint to read as a bar, so this is opaque)
  // `barLabelColorFor()` picks black/white text per fill brightness, so these
  // stay legible without hardcoding a label color at the call site.
  statusFills: {
    done:        '#2E7D32',
    in_progress: '#007AFF',
    on_hold:     '#FF9500',
    not_started: '#8E9299',
  } as const,

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
  neutralSoft: string;
  line: string;
  accent: string;
  accentHot: string;
  accentSoft: string;
  accentLabel: string;
  accentFill: string;
  success: string;
  successSoft: string;
  successLabel: string;
  warningSoft: string;
  warningLabel: string;
  dangerSoft: string;
  dangerLabel: string;
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
    // A genuinely faint NEUTRAL fill — rgba of the ink (#2B3038 = 43,48,56) at
    // 6% alpha, a barely-there tint used DIRECTLY (no `+ 'NN'` suffix, so RN
    // renders it correctly). This replaces the broken `t.textMuted + '14'`
    // pattern, where RN's normalizeColor keeps the rgba() prefix and DROPS the
    // suffix, rendering the ~40% textMuted token as a heavy opaque grey slab.
    // At 6% over surface #FFFFFF it composites to ~rgb(242,243,243), leaving
    // textSecondary text on it at 3.67:1 — indistinguishable from the 3.82:1 it
    // reads on bare surface (the fill is nearly transparent).
    neutralSoft: 'rgba(43,48,56,0.06)',
    line: 'rgba(43,48,56,0.12)',
    accent: '#FF6A1A',
    accentHot: '#FF8533',
    accentSoft: 'rgba(255,106,26,0.12)',
    // Orange TEXT on a light background (caption sizes included). The brand
    // #FF6A1A measures only 2.87:1 on surface — unreadable as text. The old
    // accentLabel #C44A0F cleared 4.5:1 on plain surface (4.85) and bg (4.57)
    // but FELL BELOW it on the tinted surfaces the label actually lands on:
    // 4.23:1 on surfaceAlt #F4EFE6, and 4.04:1 on accentSoft-over-bg (a chip
    // tint). #B23E08 keeps the hue (HSL 19°, essentially the same orange as
    // #FF6A1A's 21°) while clearing 4.5:1 on EVERY light backdrop it can sit on:
    //   surface #FFFFFF 5.86 · bg #FBF8F2 5.53 · surfaceAlt #F4EFE6 5.11 ·
    //   accentSoft/surface 5.16 · accentSoft/bg 4.89 · accentSoft/surfaceAlt 4.55.
    accentLabel: '#B23E08',
    // White TEXT on an orange FILL (buttons: "Next", "Mark paid", "Create your
    // first project"). The brand #FF6A1A gives white only 2.87:1. accent stays
    // #FF6A1A for large non-text chrome (icons, burn bars, progress) where the
    // 3:1 rule applies; button fills that carry white text use this darker
    // #BC440C, on which white measures 5.29:1. Same hue family (HSL 19°).
    accentFill: '#BC440C',
    success: '#2E7D44',
    successSoft: 'rgba(46,125,68,0.12)',
    // Caption-size green text (Custom badge, bulk labels) on successSoft sat at
    // 4.34:1 with plain `success` — under AA 4.5:1. #256B39 is 5.53:1 on
    // successSoft-over-white and 6.48:1 on white, still clearly green.
    successLabel: '#256B39',
    warningSoft: 'rgba(255,149,0,0.12)',
    // Label tokens are applied at caption sizes, so they must clear AA 4.5:1
    // on both the page bg and their soft fill. The old #E65100 sat at ~3.4:1
    // on warningSoft-over-white; #B84A00 is ~4.8:1 there (and ~5.2:1 on
    // white) while staying recognizably amber.
    warningLabel: '#B84A00',
    dangerSoft: 'rgba(200,64,56,0.12)',
    // Darker than `danger` (#C84038, ~4.3:1 — borderline at caption sizes):
    // #B93A32 is ~4.8:1 on dangerSoft-over-white, ~5.7:1 on white.
    dangerLabel: '#B93A32',
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
    // Dark-theme twin of neutralSoft — rgba of the dark ink (#9AA3AD =
    // 154,163,173, the textSecondary hue) at 8% alpha. Used DIRECTLY (no
    // suffix). At 8% over surface #14181D it composites to ~rgb(31,35,41),
    // leaving textSecondary text on it at 6.18:1 vs 6.97:1 on bare surface — a
    // barely-there tint, never the opaque slab the dropped-suffix bug produced.
    neutralSoft: 'rgba(154,163,173,0.08)',
    line: 'rgba(255,255,255,0.06)',
    accent: '#FF6A1A',
    accentHot: '#FF8533',
    accentSoft: 'rgba(255,106,26,0.16)',
    // On dark surfaces the brand orange is already bright enough as text —
    // #FF6A1A measures 6.22:1 on surface #14181D, 6.79:1 on bg #0B0D10,
    // 5.78:1 on surfaceAlt #1A1F26, and 5.01:1 on accentSoft-over-surface —
    // so accentLabel mirrors accent here (as successLabel/dangerLabel do).
    accentLabel: '#FF6A1A',
    // White text on an orange fill still needs 4.5:1; brand #FF6A1A gives white
    // 2.87:1 in either theme, so the button fill darkens to #BC440C (white 5.29:1)
    // in dark mode too. It still reads clearly orange against the dark surface.
    accentFill: '#BC440C',
    success: '#4ED37A',
    successSoft: 'rgba(78,211,122,0.12)',
    // Dark surfaces need bright ink; #4ED37A is 7.40:1 on dark successSoft, so
    // successLabel mirrors success here (as dangerLabel mirrors danger in dark).
    successLabel: '#4ED37A',
    warningSoft: 'rgba(255,149,0,0.16)',
    warningLabel: '#FF9500',
    dangerSoft: 'rgba(255,90,81,0.16)',
    dangerLabel: '#FF5A51',
    danger: '#FF5A51',
    info: '#4EA7FF',
  },
};
