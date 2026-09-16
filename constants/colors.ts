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

/** The MAGE brand hue — deep equipment green. The seed for the accent family
 *  when the user has picked nothing, and the one hue whose family is
 *  hand-measured rather than solved.
 *
 *  Rebrand 2026-09-16: orange-on-cream with a serif display face
 *  is one of the most recognisable generated-app looks there is, and MAGE was
 *  exactly that template, so the ground and the display face moved with the
 *  hue. #2F6B3A gives white 6.39:1 and measures 5.44:1 on the concrete bg —
 *  unlike the orange it replaces, it is legible as TEXT and as a FILL under
 *  white in the light theme without a darkened companion.
 *
 *  It is NOT the hue to paint on a dark ground: #2F6B3A on #151816 is 2.80:1.
 *  Dark UI resolves the brand through BRAND_ACCENT_ON_DARK instead (see
 *  BRAND_ACCENT_FAMILY.dark), and so should anything that picks a brand ink
 *  by hand — a logo "ID" on a dark splash included. */
export const BRAND_ACCENT = '#2F6B3A';

/** The brand as it reads on the DARK ground — 6.93:1 on #151816, 5.66:1 on the
 *  worst dark surface. Same hue family, lifted; this is what `accent` resolves
 *  to in the dark theme when no custom hue is set. */
export const BRAND_ACCENT_ON_DARK = '#5DB36E';

// ─────────────────────────────────────────────────────────────────────
// The user's brand hue — Settings → APP THEME.
//
// ONE hue, not two. The picker ships nine presets each carrying a `primary`
// AND an `accent`, and before 2026-09-07 the second half fed `Colors.accent`
// while the palette every screen is actually drawn in (`Theme.light.accent`
// and its four siblings) was a frozen brand-hue literal. Picking Navy
// therefore repainted the 420 `Colors.primary|accent` reads and left the
// 3,395 `t.accent*` reads on the brand — which is not "a themed app", it is a
// broken-looking one (audit 2026-09-07, "Do next" 4). The palette is now a
// single-hue FAMILY derived from `primary` (see deriveAccentPalette below),
// so the two colour systems land on the same hue. The preset's second swatch
// no longer paints anything; it survives only in the persisted
// `AppSettings.themeColors` shape (and the Supabase `theme_colors` column),
// so older rows still round-trip.
//
// The listener set exists because contexts/ThemeContext.tsx has to REBUILD
// its palette when this changes. Without it the picker would still need the
// app restart its own confirmation alert used to promise.
let _customPrimary: string | null = null;
const _primaryListeners = new Set<() => void>();

/**
 * Set the user's brand hue; `null` restores the MAGE default. Anything that
 * is not a 6-digit hex is refused rather than trusted — this value round-trips
 * through AsyncStorage and a Supabase jsonb column, and a malformed hue would
 * NaN its way through hexToHsl into an unreadable palette.
 */
export function setCustomPrimary(primary: string | null) {
  const next = primary && /^#[0-9a-fA-F]{6}$/.test(primary) ? primary : null;
  if (_customPrimary === next) return;
  _customPrimary = next;
  _primaryListeners.forEach((fn) => fn());
}

/** The hue in force right now — the seed for every accent token. */
export function getCustomPrimary(): string {
  return _customPrimary || BRAND_ACCENT;
}

/** Subscribe to picker changes; returns the unsubscribe. */
export function subscribeCustomPrimary(fn: () => void): () => void {
  _primaryListeners.add(fn);
  return () => { _primaryListeners.delete(fn); };
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
// The BRAND hue (primary/accent) and the SIGNAL FILLS (success,
// warning, error, info) stay static — a vivid hue used as a dot, bar
// or bare chip carries meaning by being unmistakable from its
// siblings, and re-tinting it per theme breaks that. Their TEXT
// companions (successLabel / warningLabel / dangerLabel / infoLabel,
// accentLabel, accentFill) DO theme, because legibility is a property
// of the ground. Runtime audit 2026-09-06 (VIS-06) — see the block
// above those getters for the measurements.
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
  // Default brand is MAGE equipment green. Anywhere downstream using
  // `Colors.primary` gets the brand unless the user has selected a theme that
  // calls setCustomPrimary() with a different hue.
  //
  // With no custom hue the brand is THEME-AWARE here, not the static seed: the
  // old orange read on both grounds, but #2F6B3A on the dark page is 2.80:1 —
  // a primary-coloured icon or link that disappears in dark mode. A picked
  // preset keeps returning its own seed, exactly as before the rebrand.
  get primary() { return _customPrimary ?? (_currentTheme === 'dark' ? BRAND_ACCENT_ON_DARK : BRAND_ACCENT); },
  // Literal fallbacks are derivePrimaryLight/Dark(BRAND_ACCENT) spelled out —
  // same HSL move a custom hue gets (+12% / -12% lightness), so the default
  // and a picked preset relate to their primary the same way.
  get primaryLight() { return _customPrimary ? derivePrimaryLight(_customPrimary) : '#3D9A4E'; },
  get primaryDark() { return _customPrimary ? derivePrimaryDark(_customPrimary) : '#1C4023'; },
  // Accent paired with the brand primary. Resolves through the SAME derived
  // family as the themed `t.accent`, so the two colour systems cannot drift:
  // before 2026-09-07 this returned the preset's second swatch, which meant
  // saving even the DEFAULT preset quietly moved the app's accent off the
  // brand hue while every themed screen stayed on it.
  get accent() { return deriveAccentPalette(getCustomPrimary(), _currentTheme).accent; },
  accentLight: '#FFCC00',
  accentMuted: '#FFE0A0',
  // Accent FILL under WHITE text — founder decision #1. The retired orange gave
  // white only 2.87:1, which is why this token exists; the green brand gives
  // white 6.39:1 on its own, and the dark theme needs a mid green that both
  // carries white text and stays visible on the dark page (see
  // BRAND_ACCENT_FAMILY). A GETTER mirroring `get accent()` so the five button
  // files that read `Colors.accentFill` (rather than the themed `t.accentFill`)
  // resolve it the same way — including when the user has picked a non-brand
  // hue, whose own fill is solved to the same budget.
  get accentFill() { return deriveAccentPalette(getCustomPrimary(), _currentTheme).accentFill; },

  // ── Surfaces — THEME-AWARE GETTERS (read _currentTheme at access) ──
  // Concrete grounds, the same values as Theme.light/.dark below — a screen on
  // the static module and a themed screen next to it must sit on one page.
  // (Before the 2026-09-16 rebrand this module carried Apple's #F2F2F7 while
  // Theme carried cream, which was two apps.) Elevated is one step above
  // surfaceAlt in dark, so a sheet still separates from the card it covers.
  get background()       { return _currentTheme === 'dark' ? '#151816' : '#ECEDE9'; },
  get surface()          { return _currentTheme === 'dark' ? '#1D211F' : '#FFFFFF'; },
  get surfaceAlt()       { return _currentTheme === 'dark' ? '#252A27' : '#E2E4DF'; },
  get surfaceElevated()  { return _currentTheme === 'dark' ? '#2B312D' : '#FFFFFF'; },
  get card()             { return _currentTheme === 'dark' ? '#1D211F' : '#FFFFFF'; },
  // Card outline. Soft system-gray in light (Apple's default separator),
  // faint cream in dark. Same identity ("subtle border") either way.
  get cardBorder()       { return _currentTheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(60,60,67,0.18)'; },

  // ── Text — theme-aware ──
  get text()             { return _currentTheme === 'dark' ? '#F4EFE6' : '#000000'; },
  // Runtime audit 2026-09-06 (VIS-04 / VIS-17): the old alphas were Apple's
  // system label values (0.6 / 0.36), which the Release build rendered at
  // 3.44:1 and 1.96:1 on white. Both tokens carry REAL CONTENT in this app —
  // counts ("3 active"), empty-state copy ("Nothing scheduled on site today.")
  // and the cash-flow caption — not decoration, so both must clear AA 4.5:1.
  // Measured against this module's own grounds, worst first (re-measured on
  // concrete 2026-09-16 — surfaceAlt #E2E4DF light, #252A27 dark):
  //   textSecondary  light 0.82 → 5.34:1   dark 0.70 → 7.02:1
  //   textMuted      light 0.77 → 4.70:1   dark 0.55 → 4.93:1
  // The hierarchy between them is now carried by a ~1.2× contrast step plus
  // size/weight rather than by making the quieter one illegible.
  get textSecondary()    { return _currentTheme === 'dark' ? 'rgba(244,239,230,0.7)' : 'rgba(60,60,67,0.82)'; },
  get textMuted()        { return _currentTheme === 'dark' ? 'rgba(244,239,230,0.55)' : 'rgba(60,60,67,0.77)'; },
  textOnPrimary: '#FFFFFF',
  textOnAccent: '#FFFFFF',

  // ── Borders — theme-aware ──
  get border()           { return _currentTheme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(60,60,67,0.18)'; },
  get borderLight()      { return _currentTheme === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(60,60,67,0.08)'; },

  // ── Semantic status colours — SIGNAL FILLS and their LABEL INKS ──
  //
  // Two different jobs, so two different tokens. Conflating them is what the
  // runtime audit's VIS-06 fix got wrong on its first pass, and the mistake is
  // worth spelling out because the tokens read interchangeable:
  //
  //   SIGNAL FILL (`success` / `warning` / `error` / `info`)
  //       The colour IS the message. A 10pt health dot on the profit report
  //       (app/reports.tsx healthTone), the Modified/Removed chips on
  //       compare-drawings, the margin-band tints. These carry NO TEXT, so the
  //       requirement is not AA-against-the-ground — it is being unmistakable
  //       from the SIBLING states next to it. Darkening amber to #B84A00 gave
  //       it 1.06:1 against the red #C84038 dot and 1.03:1 against the green
  //       #2E7D44 one: a yellow project and a red project became the same
  //       swatch. So these stay at the vivid system hues.
  //
  //   LABEL INK (`successLabel` / `warningLabel` / `dangerLabel` / `infoLabel`)
  //       Text — a chip label, a caption, a small icon beside one. The app's
  //       chip idiom is `backgroundColor: c + '15'` with `color: c`, and the
  //       vivid hues are illegible that way: the Subs compliance badge, the
  //       single most load-bearing label on that screen, measured 2.07:1 in
  //       the Release build. Measured on their own 8% tint over surface:
  //
  //           fill  #34C759 2.08:1 · #007AFF 3.61:1 · #FF9500 2.06:1 · #FF3B30 3.18:1
  //           ink   #256B39 5.76:1 · #1565C0 5.11:1 · #B84A00 4.66:1 · #B93A32 5.01:1
  //
  // This is exactly the split `Theme.light` already ships (`danger` #C84038 the
  // fill, `dangerLabel` #B93A32 the ink; `warningSoft` the tint, `warningLabel`
  // the ink) — these getters mirror it for the screens that read the static
  // module. scripts/validate-contrast.ts check 5 holds every LABEL to AA on its
  // own tint, and check 5b holds every FILL to a minimum separation from its
  // siblings, so neither half can be "fixed" at the other's expense again.
  //
  // The BRAND hue is deliberately not in this set — it is chrome and action,
  // never state, and routes text through accentLabel / accentFill.
  //
  // SUCCESS IS TEAL, NOT GREEN (rebrand 2026-09-16). The old success green
  // #2E7D44 sits CIE76 ΔE 9.2 from the new brand #2F6B3A — under the ~10 at
  // which two colours read as one — so a primary "Walk the punch list" button
  // and a "Paid" badge would have been the same swatch. Success moved to the
  // teal family (#12806E, ΔE 21.6 from brand); scripts/validate-brand-color.ts
  // fails the build under ΔE 18. Do not "harmonise" either one onto the other. The pale `*Light` companions and `statusFills`
  // (the Gantt bar palette, which picks its own label colour by fill
  // brightness) are literals and are unaffected.

  // Signal fills — static in both themes, as they have always been. A vivid
  // hue reads correctly as a dot/bar on either ground; it is only as TEXT that
  // the light theme needs the darker ink below.
  // #12806E is the founder's teal: 4.84:1 on white, 3.78:1 on the darkest
  // light ground and ~3.9:1 on the dark page, so it holds 1.4.11's 3:1 as a
  // bare dot in both themes — which is what a static fill has to do.
  success: '#12806E',
  successLight: '#E3F1EE',
  // Dark teal used as foreground text on a *Light tinted card. Audit found
  // 26 inline `#2E7D32`s, 16 `#1E8E4A`s — both consolidate here, and moved to
  // teal with the rest of the success family (the solved light successLabel).
  successDark: '#026354',
  warning: '#FF9500',
  warningLight: '#FFF3E0',
  warningDark: '#E65100',   // 19 inline uses
  error: '#FF3B30',
  errorLight: '#FFF0EF',
  errorDark: '#C62828',     // 19 inline uses
  info: '#007AFF',
  infoLight: '#EBF3FF',
  infoDark: '#1565C0',      // 8 inline uses

  // Label inks — the value each of the four resolves to when it is TEXT (or a
  // small icon beside text). Light values are the AA-verified companions this
  // file already ships as Theme.light.successLabel / .warningLabel /
  // .dangerLabel / .info; dark values mirror Theme.dark, where the vivid hues
  // are already legible. successLabel is the teal pair from Theme below.
  get successLabel() { return _currentTheme === 'dark' ? '#1ABCA2' : '#026354'; },
  get warningLabel() { return _currentTheme === 'dark' ? '#FF9500' : '#B84A00'; },
  // Named for the semantic, not for `error`, so it matches Theme.*.dangerLabel
  // — one name for one colour across both colour systems.
  get dangerLabel()  { return _currentTheme === 'dark' ? '#FF5A51' : '#B93A32'; },
  get infoLabel()    { return _currentTheme === 'dark' ? '#4EA7FF' : '#1565C0'; },

  // Apple iOS system purple. Used in a few places (system "Books," some
  // status indicators). 18 inline uses — surfacing as a token.
  purple: '#5856D6',
  purpleLight: '#EBEAFA',

  // Apple iOS system orange. Used on chips that aren't strictly "warning"
  // semantically. Until the 2026-09-16 rebrand this was the retired BRAND
  // orange wearing the system name; it is now the real system value,
  // which is the same hue the warning family already ships.
  orange: '#FF9500',        // 11 inline uses

  // ── Shadows + overlays — theme-aware ──
  get shadow()           { return _currentTheme === 'dark' ? 'rgba(0,0,0,0.40)' : 'rgba(0,0,0,0.05)'; },
  get overlay()          { return _currentTheme === 'dark' ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.45)'; },

  // ── Fills — theme-aware ──
  get fillTertiary()     { return _currentTheme === 'dark' ? 'rgba(244,239,230,0.06)' : 'rgba(120,120,128,0.12)'; },
  get fillSecondary()    { return _currentTheme === 'dark' ? 'rgba(244,239,230,0.10)' : 'rgba(120,120,128,0.08)'; },

  // ── Status bar-fill colors — drive the Gantt "Color: Status" mode ──
  // SOLID, saturated fills (not the translucent chip tints) so a bar reads as
  // a strong block at any zoom. Semantics match GridPane's statusChip():
  //   done         → teal    (successDark #026354 — the success family, dark
  //                           enough that white bar labels clear WCAG on it;
  //                           green is the brand now, not "done")
  //   in_progress  → blue    (info #007AFF)
  //   on_hold      → amber   (warning #FF9500)
  //   not_started  → neutral (solid mid-gray; the translucent fillTertiary is
  //                           too faint to read as a bar, so this is opaque)
  // `barLabelColorFor()` picks black/white text per fill brightness, so these
  // stay legible without hardcoding a label color at the call site.
  statusFills: {
    done:        '#026354',
    in_progress: '#007AFF',
    on_hold:     '#FF9500',
    not_started: '#8E9299',
  } as const,

  // ── Trade colors (Phase 27) — drive Gantt bar + Board phase-dot ──
  // Industry-conventional palette. Saturation-matched for dark mode
  // contrast against the dark surface. The brand green anchors `general` so
  // the most common bars still feel like MAGE ID — at #357A42, a step lighter
  // than BRAND_ACCENT so the bar does not sink into the dark page, and still
  // far darker than `landscaping` #66BB6A so the two greens stay two trades.
  tradeColors: {
    general:      '#357A42',
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
  // On-track is a success state, so teal (the dark successLabel), not green.
  pillOnTrack:  '#1ABCA2',
  pillAtRisk:   '#FFA726',
  pillLate:     '#FF5A51',
};

// NOTE: every entry here is read at MODULE-EVAL time, so it may only reference
// tokens declared ABOVE this point. `Colors.accent` / `Colors.accentFill` are
// not among them — since 2026-09-07 those getters resolve through
// deriveAccentPalette, whose BRAND_ACCENT_FAMILY table is declared below, and
// naming one here would throw a TDZ ReferenceError while the module loads,
// i.e. a blank app on boot rather than a wrong colour.
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
//
// `Theme.light` is NOT a complete palette: the five accent tokens are
// deliberately missing from it (see the accent-family block below the
// object). Only the merge ThemeContext performs is a ThemeColors.
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

/** The five tokens the user's chosen hue drives. Everything else is fixed
 *  per theme, which is why these five are the ones that had to leave the
 *  frozen `Theme` object. */
export type AccentPalette = Pick<
  ThemeColors,
  'accent' | 'accentHot' | 'accentSoft' | 'accentLabel' | 'accentFill'
>;

/** A theme MINUS its accent family — what `Theme.light` / `Theme.dark` are. */
export type ThemeBase = Omit<ThemeColors, keyof AccentPalette>;

export const Theme: { light: ThemeBase; dark: ThemeBase } = {
  light: {
    // CONCRETE, not cream (rebrand 2026-09-16). A cool neutral with a trace of
    // green in it, so the brand reads as part of the ground rather than a
    // sticker on it. Cards stay pure white; `line` below is the hairline.
    bg: '#ECEDE9',
    surface: '#FFFFFF',
    surfaceAlt: '#E2E4DF',
    text: '#2B3038',
    // Runtime audit 2026-09-06 (VIS-04 / VIS-17). Sampled from the Release
    // build: textMuted rendered at 2.20:1 ("3 active", "CASH · 4WK") and
    // textSecondary at 3.82:1 — both below AA, and both carry real content
    // rather than decoration. Re-derived against the worst light ground
    // (then the cream surfaceAlt), so they hold on every surface.
    textSecondary: 'rgba(43,48,56,0.78)',
    // Re-measured on concrete 2026-09-16: surfaceAlt #E2E4DF is darker than the
    // cream it replaced, so 0.70 fell to 4.52:1. 0.72 → 4.72:1 worst ground.
    // (textSecondary 0.78 is 5.63:1 there, unchanged.)
    textMuted: 'rgba(43,48,56,0.72)',
    // A genuinely faint NEUTRAL fill — rgba of the ink (#2B3038 = 43,48,56) at
    // 6% alpha, a barely-there tint used DIRECTLY (no `+ 'NN'` suffix, so RN
    // renders it correctly). This replaces the broken `t.textMuted + '14'`
    // pattern, where RN's normalizeColor keeps the rgba() prefix and DROPS the
    // suffix, rendering the ~40% textMuted token as a heavy opaque grey slab.
    // At 6% over surface #FFFFFF it composites to ~rgb(242,243,243), leaving
    // textSecondary text on it at 6.15:1 — indistinguishable from the 6.56:1 it
    // reads on bare surface (the fill is nearly transparent).
    neutralSoft: 'rgba(43,48,56,0.06)',
    // The concrete hairline, opaque. The old rgba(ink, 0.12) composited to a
    // different grey on every ground; one hex keeps card edges identical on
    // white and on concrete. (The few `line + '60'` suffix sites now get a real
    // 8-digit hex — RN drops the suffix on an rgba() string.)
    line: '#D7DAD4',
    // TEAL, not green — see the SUCCESS IS TEAL note on the Colors module. The
    // founder's #12806E is the fill (`successSoft` is its wash). It is NOT the
    // `success` value here, because Theme.*.success is also read as chip TEXT
    // (scripts/validate-contrast.ts check 5), and #12806E on its own 8% tint
    // over white is 4.36:1 — under AA. #0F7A69 is the same teal one lightness
    // step darker: 5.24:1 on white, ≥4.5:1 on its own tint, still ΔE ≥18 from
    // the brand (validate-brand-color.ts measures it).
    success: '#0F7A69',
    successSoft: 'rgba(18,128,110,0.12)',
    // Caption-size teal text. #026354 clears 4.6:1 (4.88 worst) on every bare
    // light ground, every successSoft wash and the 8% chip tint, AND sits
    // ΔE 30.6 from taskStatusInk's not_started grey #5A6472 — the plain
    // hue-solve (#0E6557) was ΔE 29.3, under check 14's 30, i.e. a "done" and
    // a "not started" chip side by side reading as one muted colour.
    successLabel: '#026354',
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
    // Green-black, the dark twin of concrete. Warmer-neutral than the old
    // blue-black #0B0D10 so the green brand does not vibrate against it.
    bg: '#151816',
    surface: '#1D211F',
    surfaceAlt: '#252A27',
    text: '#F4EFE6',
    textSecondary: '#9AA3AD',
    // 0.6 measured 3.22:1 on surfaceAlt — same VIS-04 defect as the light
    // theme. 0.8 held on the old blue-black grounds but fell to 4.21:1 on the
    // lighter green-black surfaceAlt #252A27 (rebrand 2026-09-16); 0.88 →
    // 4.77:1 worst ground. (textSecondary is solid #9AA3AD, 5.71:1 worst.)
    textMuted: 'rgba(154,163,173,0.88)',
    // Dark-theme twin of neutralSoft — rgba of the dark ink (#9AA3AD =
    // 154,163,173, the textSecondary hue) at 8% alpha. Used DIRECTLY (no
    // suffix). At 8% over surface #14181D it composites to ~rgb(31,35,41),
    // leaving textSecondary text on it at 6.18:1 vs 6.97:1 on bare surface — a
    // barely-there tint, never the opaque slab the dropped-suffix bug produced.
    neutralSoft: 'rgba(154,163,173,0.08)',
    line: 'rgba(255,255,255,0.06)',
    // Teal lifted for the dark ground — the #12806E hue solved to clear 4.6:1
    // on every dark ground and its own wash. The old #4ED37A would now sit a
    // few ΔE from the dark brand #5DB36E, the same collision as light theme.
    success: '#1ABCA2',
    successSoft: 'rgba(26,188,162,0.12)',
    // successLabel mirrors success here (as dangerLabel mirrors danger in dark).
    successLabel: '#1ABCA2',
    warningSoft: 'rgba(255,149,0,0.16)',
    warningLabel: '#FF9500',
    dangerSoft: 'rgba(255,90,81,0.16)',
    dangerLabel: '#FF5A51',
    danger: '#FF5A51',
    info: '#4EA7FF',
  },
};

// ─────────────────────────────────────────────────────────────────────
// The accent family — DERIVED per hue, never frozen.
//
// Until 2026-09-07 these five tokens sat inside the two objects above as
// brand-hue literals, which is what made Settings → APP THEME a lie: the
// picker wrote a hue that reached `Colors.primary`/`Colors.accent` and could
// not reach `t.accent`, so eight of the nine presets repainted about 9% of
// the app and left the rest on the brand hue. Building the family from the chosen
// hue on every render is what makes the picker real.
//
// The values cannot be a table keyed by preset. `accentLabel` (coloured TEXT
// on a light ground) and `accentFill` (WHITE text on a coloured fill) each
// carry an AA 4.5:1 budget, and a lightness that is legible for the brand
// brand is not legible for Navy — a hand-picked pair per preset would be
// nine unverified guesses. So both are SOLVED: walk the hue's HSL lightness,
// hue and saturation untouched (the same hexToHsl → adjust l → hslToHex move
// derivePrimaryDark makes above), until the ratio clears the budget on the
// WORST ground the token can land on. scripts/validate-contrast.ts check 12
// re-measures every preset's family and fails the build under 4.5:1.
// ─────────────────────────────────────────────────────────────────────

type RGB = readonly [number, number, number];

function rgbOfHex(hex: string): RGB {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ] as const;
}

/** WCAG 2.x relative luminance. Same maths as scripts/validate-contrast.ts. */
function relLuminance(c: RGB): number {
  const ch = (x: number) => {
    const v = x / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
}

function contrastRatio(a: RGB, b: RGB): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Source-over composite of a translucent `fg` onto an opaque `bg`. */
function blend(fg: RGB, alpha: number, bg: RGB): RGB {
  return [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha)) as unknown as RGB;
}

/** The alpha `accentSoft` is mixed at, per theme — the chip/tint wash. */
const SOFT_ALPHA = { light: 0.12, dark: 0.16 } as const;

/**
 * Non-text chrome floor for `accent` itself (icons, burn bars, progress).
 *
 * Light is WCAG's non-text 3:1. Until the 2026-09-16 rebrand it was 2.4: the
 * retired orange measured 2.50:1 on the light surfaceAlt and founder decision
 * #1 kept it anyway, so the floor was "no preset harder to see than the brand".
 * The green brand is 4.99:1 on the worst concrete ground, so that concession
 * has nothing left to protect and the floor is the spec's own number.
 * (scripts/validate-contrast.ts still holds presets to its older 2.4 — a
 * solver floor above the guard's is the safe direction.) The dark presets
 * genuinely vanish into the dark ground (Navy #1B3A5C, Charcoal #2C2C2E) and
 * have to be lightened, and the floor they are lightened TO is 4.6, not
 * WCAG's 3:1 for non-text.
 *
 * That is an empirical number, not a stricter reading of the spec. Founder
 * decision #1 says accent is chrome and text goes through accentLabel; the
 * codebase does not obey it — 373 of the 588 `color: …accent` sites carry a
 * fontSize or a *Text/*Label style name. In the dark theme the brand hue is
 * legible as text anyway (#5DB36E is 5.66:1 on its worst dark ground), so those
 * 373 sites read fine today. Solving a picked hue to a bare 3:1 would have
 * dropped every one of them to ~3.05:1 (Navy #326CAB 3.05, Charcoal #69696E
 * 3.03) the moment a user chose any non-brand preset — an AA regression the
 * picker itself introduced, in the theme a laptop review never looks at
 * (review 2026-09-07). Solving to 4.6 instead lands the dark accent on the
 * dark accentLabel, exactly as the brand family already does.
 *
 * 4.6 is AA_TARGET's value spelled out: AA_TARGET is declared below this and
 * would be in its TDZ here.
 */
const CHROME_FLOOR = { light: 3.0, dark: 4.6 } as const;

/**
 * Solve target for the two TEXT tokens. The budget the guard enforces is AA
 * 4.5:1; solving to 4.6 keeps the shipped value off that boundary, so an
 * 8-bit rounding difference between this solver and the guard's own maths
 * cannot land a preset a hundredth under the bar it just cleared.
 */
const AA_TARGET = 4.6;

/**
 * The BUTTON floor: `accentFill` against the page it is a button on.
 *
 * Unlike `accent` this is not decoration — `accentFill` is the primary CTA
 * background at 461 call sites ("Next", "Mark paid", "Create your first
 * project"), so WCAG 1.4.11's 3:1 for a UI component boundary applies with no
 * founder-decision escape hatch. It is a SECOND constraint, not a replacement:
 * the fill still has to give white text 4.6:1, so it is squeezed from both
 * sides and can only be solved by searching outward from the seed.
 *
 * Review 2026-09-07 found this missing. Solving the fill by darkening alone
 * (white text is the only budget) returned the seed unchanged for every
 * mid-to-dark preset, which is correct in the light theme and catastrophic in
 * the dark one: Charcoal shipped a #2C2C2E button on the #0B0D10 page at
 * 1.19:1, Navy 1.42:1, Burgundy 1.72:1, Slate 1.96:1, Forest 2.53:1, Ocean
 * 2.56:1 — six of the nine presets rendering their primary action as an
 * invisible slab with floating white text. Only the brand (3.13:1) was safe,
 * which is why nothing in the preset sweep caught it.
 */
const FILL_GROUND_FLOOR = 3.0;

/**
 * Walk `seed`'s lightness in `dir` until `meets` is satisfied, keeping hue and
 * saturation. 0.005 steps are ~1.3 of 255 — finer than the 8-bit output — so
 * the first hex that clears the budget is the closest one to the user's own
 * hue that does.
 */
function solveLightness(seed: string, dir: 1 | -1, meets: (hex: string) => boolean): string {
  const { h, s, l } = hexToHsl(seed);
  for (let i = 0; i <= 200; i++) {
    const next = Math.min(0.97, Math.max(0.03, l + dir * i * 0.005));
    const hex = hslToHex(h, s, next);
    if (meets(hex)) return hex;
    if (next <= 0.03 || next >= 0.97) break;
  }
  // No lightness of this hue clears the budget. Return the extreme rather than
  // the unsolved seed, so the miss is as large as possible and check 12 names
  // the preset instead of it shipping a hair under AA. No shipped preset hits
  // this branch — that is exactly what the guard proves.
  return hslToHex(h, s, dir < 0 ? 0.03 : 0.97);
}

/**
 * Same walk, but OUTWARD from the seed in both directions at once (0, +1, -1,
 * +2, -2 …), so the first hit is the nearest lightness to the user's own hue
 * that satisfies the predicate.
 *
 * Needed wherever a token is squeezed from both sides and a single direction
 * is therefore a guess: `accentFill` has to be dark enough for white text and
 * light enough to be seen on the dark page, and which way the seed has to move
 * depends on the hue — Charcoal must lighten, a pale amber must darken.
 */
function solveNearest(seed: string, meets: (hex: string) => boolean): string | null {
  const { h, s, l } = hexToHsl(seed);
  for (let i = 0; i <= 200; i++) {
    for (const dir of i === 0 ? ([1] as const) : ([1, -1] as const)) {
      const next = l + dir * i * 0.005;
      if (next < 0.03 || next > 0.97) continue;
      const hex = hslToHex(h, s, next);
      if (meets(hex)) return hex;
    }
  }
  return null;
}

/** Build the five accent tokens for `primary` under `theme`. */
function solveAccentPalette(primary: string, theme: 'light' | 'dark'): AccentPalette {
  const grounds = [Theme[theme].bg, Theme[theme].surface, Theme[theme].surfaceAlt].map(rgbOfHex);
  const worstOn = (hex: string, gs: RGB[]) =>
    Math.min(...gs.map((g) => contrastRatio(rgbOfHex(hex), g)));

  // Light theme darkens toward the ground it sits on, dark theme lightens.
  const dir: 1 | -1 = theme === 'light' ? -1 : 1;

  const accent = solveLightness(primary, dir, (hex) => worstOn(hex, grounds) >= CHROME_FLOOR[theme]);
  const accentRgb = rgbOfHex(accent);
  const accentSoft = `rgba(${accentRgb[0]},${accentRgb[1]},${accentRgb[2]},${SOFT_ALPHA[theme]})`;
  // The lighter sibling used for gradients, hover states and tint borders.
  // NOT a text token — it is deliberately lower-contrast than accent.
  const accentHot = derivePrimaryLight(accent);

  // accentLabel must hold on the bare grounds AND on the chip idiom this app
  // ships everywhere — the label painted on an accentSoft wash of itself.
  const labelGrounds = [...grounds, ...grounds.map((g) => blend(accentRgb, SOFT_ALPHA[theme], g))];
  const accentLabel = solveLightness(accent, dir, (hex) => worstOn(hex, labelGrounds) >= AA_TARGET);

  // accentFill is a BUTTON: white text sits on it AND it has to be visible as
  // a shape on the page behind it. Two budgets pulling opposite ways, so the
  // search runs outward from the user's own hue rather than in one direction —
  // in the light theme the seed almost always already qualifies and this is a
  // no-op, in the dark theme Charcoal/Navy/Burgundy/Slate have to LIGHTEN to
  // stop being a black slab on a black page (review 2026-09-07).
  const fillMeets = (hex: string) =>
    contrastRatio(rgbOfHex(hex), [255, 255, 255]) >= AA_TARGET &&
    worstOn(hex, grounds) >= FILL_GROUND_FLOOR;
  // If no lightness of this hue can do both, keep white legible and let the
  // button be quiet — unreadable text is the worse failure. check 12 names the
  // preset either way; no shipped preset takes this branch.
  const accentFill = solveNearest(primary, fillMeets)
    ?? solveLightness(primary, -1, (hex) => contrastRatio(rgbOfHex(hex), [255, 255, 255]) >= AA_TARGET);

  return { accent, accentHot, accentSoft, accentLabel, accentFill };
}

/**
 * The brand family is measured, not solved.
 *
 * These are the five values the entire product is drawn in, and the ratios
 * below were taken against every ground each token actually lands on. Re-
 * deriving them on every boot would let a solver tweak restyle every button
 * and caption in a refactor nobody reviewed as a redesign. This is ONE measured
 * default, not a per-preset table: the solver runs for every other hue, and
 * check 12 holds all nine presets — the brand included — to the same 4.5:1
 * budget, so the default is exempt from the recomputation, never from the
 * check.
 */
const BRAND_ACCENT_FAMILY: Record<'light' | 'dark', AccentPalette> = {
  // Spelled as literal hexes, not `BRAND_ACCENT`, because this table is what
  // scripts/validate-brand-color.ts reads out of the source to re-measure the
  // brand family — its token reader wants a plain quoted hex.
  //
  // Measured 2026-09-16 against the concrete grounds (bg #ECEDE9, surface
  // #FFFFFF, surfaceAlt #E2E4DF) and the dark grounds (#151816 / #1D211F /
  // #252A27). The derivations are the solver's own moves, run once and frozen.
  light: {
    // The brand itself. As chrome it is 4.99:1 on its worst light ground —
    // the retired orange was 2.50:1 there, which is what CHROME_FLOOR.light
    // used to concede.
    accent: '#2F6B3A',
    // derivePrimaryLight(#2F6B3A). Gradients / hover / tint borders, not text.
    accentHot: '#3D9A4E',
    accentSoft: 'rgba(47,107,58,0.12)',
    // Green TEXT. The brand clears 4.5:1 on every bare light ground (4.99 worst)
    // but NOT on its own accentSoft wash over surfaceAlt (4.25:1) — the chip
    // idiom. #2C6436 is the brand hue one solver step darker and clears 4.6:1
    // on all six backdrops (bare + wash over each ground).
    accentLabel: '#2C6436',
    // White TEXT on a green FILL (buttons: "Next", "Mark paid"). The brand
    // gives white 6.39:1 and is 4.99:1 against the worst light ground, so the
    // fill IS the brand — no darkened companion needed, unlike the orange.
    accentFill: '#2F6B3A',
  },
  dark: {
    // BRAND_ACCENT_ON_DARK. #2F6B3A would be 2.80:1 on #151816; #5DB36E is
    // 6.93:1 there and 5.66:1 on surfaceAlt, so it also carries the AA text
    // budget the dark theme's 373 `color: accent` text sites lean on.
    accent: '#5DB36E',
    // derivePrimaryLight(#5DB36E).
    accentHot: '#83CA91',
    accentSoft: 'rgba(93,179,110,0.16)',
    // #5DB36E on its own 16% wash over surfaceAlt is 4.29:1; one solver step
    // lighter clears 4.6:1 on every dark backdrop.
    accentLabel: '#69B979',
    // A dark-theme BUTTON has two budgets pulling opposite ways: white text on
    // it at 4.6:1, and the button visible on the dark page at 3:1. The brand
    // #2F6B3A carries white (6.39) but is 2.28:1 on surfaceAlt — a slab you
    // cannot see; #5DB36E is visible but gives white 2.58:1. #388046 is the
    // nearest lightness of the brand hue that does both (solveNearest).
    accentFill: '#388046',
  },
};

// The solve runs ~40 lightness steps × 6 grounds; `Colors.accent` is read
// hundreds of times per render, so memoise. Bounded in practice by the number
// of presets the picker offers (nine hues × two themes).
const _accentCache = new Map<string, AccentPalette>();

/**
 * The accent family for a hue under a theme. This is what ThemeContext merges
 * onto `Theme[resolved]`, and what the `Colors.accent` / `Colors.accentFill`
 * getters resolve through, so a screen on either colour system sees one hue.
 */
export function deriveAccentPalette(primary: string, theme: 'light' | 'dark'): AccentPalette {
  // setCustomPrimary already refuses a malformed hue, but this is also called
  // straight from the Settings picker with a preset value and from the guard,
  // and a bad hex would NaN through hexToHsl into a palette of "#NaNNaNNaN".
  // Fall back to the brand rather than paint the app in nothing.
  if (!/^#[0-9a-fA-F]{6}$/.test(primary)) return BRAND_ACCENT_FAMILY[theme];
  if (primary.toUpperCase() === BRAND_ACCENT) return BRAND_ACCENT_FAMILY[theme];
  const key = `${primary}|${theme}`;
  const hit = _accentCache.get(key);
  if (hit) return hit;
  const built = solveAccentPalette(primary, theme);
  _accentCache.set(key, built);
  return built;
}

// ─── Categorical data palettes ───────────────────────────────────────────────
//
// These are DATA ENCODINGS, not chrome. A Gantt bar's colour carries which
// phase a task belongs to; a project chip's colour carries which job a row is
// about. Their job is HUE SEPARATION — two adjacent phases must not blur at
// small bar widths — which is why they contain hues (purple, pink) that
// scripts/validate-app-slop.ts bans everywhere else as generic-AI slop.
//
// They live here because that guard's own rule is "theme via
// constants/colors.ts only", and `constants/` is exempt precisely so
// deliberate palettes have a home. Before 2026-09-07 they were scattered
// across utils/scheduleEngine.ts, utils/summaryBriefing.ts and
// utils/scheduleReportHtml.ts, where the guard could not see them at all —
// widening its roots is what surfaced them. Recolouring the Gantt to satisfy a
// brand rule would have cost the separation the chart depends on; relocating
// them satisfies the rule as written and centralises three scattered tables.
//
// If you add an entry: keep it clear of its neighbours in hue, and if white
// text will sit ON it, check the ratio (Categorical.projectChip below is the
// worked example — every entry there is >= 4.5:1 against white).

/** Gantt / schedule phase bars. Hue-separated; labels pick their own ink by
 *  fill brightness, so these are NOT required to clear 4.5:1 against white. */
export const PHASE_PALETTE: Record<string, string> = {
  'Site Work':    '#3B82F6', // blue
  'Demo':         '#EF4444', // red
  'Foundation':   '#10B981', // emerald
  'Framing':      '#A855F7', // purple
  'Roofing':      '#06B6D4', // cyan
  'MEP':          '#F59E0B', // amber
  'Plumbing':     '#0EA5E9', // sky
  'Electrical':   '#EAB308', // yellow
  'HVAC':         '#14B8A6', // teal
  'Insulation':   '#F97316', // orange
  'Drywall':      '#94A3B8', // slate
  'Interior':     '#EC4899', // pink
  'Finishes':     '#22C55E', // green
  'Landscaping':  '#84CC16', // lime
  'Inspections':  '#F59E0B', // amber (matches MEP — they share the inspection cadence)
};

/** Fallback for a phase with no entry above. Warm grey, deliberately not a hue
 *  in the table so "uncategorised" never reads as a real phase. */
export const PHASE_FALLBACK = '#7A7266';

/** Summary-tab project chips. 10pt WHITE initials sit on these, so every entry
 *  must clear AA 4.5:1 against white — four of the six originals did not
 *  (worst #0FB5AE at 2.55:1, measured 2026-09-07). Darkened in place, hue
 *  families preserved so a returning user's colour memory still works. */
export const PROJECT_CHIP_PALETTE = [
  '#B4530A', // orange   5.02:1
  '#0A5EB0', // blue     6.48:1
  '#15703E', // green    6.14:1
  '#4B3BAF', // indigo   8.26:1
  '#0A7F79', // teal     4.86:1
  '#A31813', // red      7.79:1
];

/** Schedule-PDF status tags. White text, so the same 4.5:1 rule applies. */
export const REPORT_TAG_PALETTE = {
  high:        '#C2260F',
  medium:      '#FF9500',
  low:         '#8E8E93',
  inProgress:  '#4B3BAF',
};
