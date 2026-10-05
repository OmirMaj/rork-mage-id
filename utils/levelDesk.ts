// levelDesk.ts — "The Level" composed for laptops and monitors (lane LOADERDESK).
//
// The founder: "the loading animation is so tiny on monitor and laptop
// screens". The phone picture capped small (a 240 px launch level, a 64 pt
// gate) reads as 9–17 % of a wide window. This is the wide-canvas composition:
// the SAME mark, motion language, clock and colours, sized proportionally
// (clamp) and set on a DATUM — one true horizontal running out of the level to
// both screen edges, ending in a tick like a dimension line.
//
// THE TIER is ONE pure function of (window width, Platform.OS), never a hook:
// every native platform at ANY width is 'phone' (an iPad or a Chromebook app
// keeps today's picture byte-for-byte), and so is the web below 768 px. The
// pre-JS still in public/index.html mirrors it with three @media rules and
// scripts/validate-level-desk.ts ties the two together.
//
//   phone    any non-web platform, or web < 768
//   tablet   web 768 – 1279
//   laptop   web 1280 – 1919
//   monitor  web ≥ 1920
//
// THE WEB LAUNCH PALETTE (orchestrator decision, 2026-10-01). The web has no
// native splash to match, so its launch (the pre-JS still, BrandSplash,
// BootShell) opens on the GREEN brand — the concrete ground and the brand-green
// level — at every width; on a dark page, its dark twin (WEB_LAUNCH_DARK: the
// green-black ground, the on-dark green, the dark ink), so a dark-mode user
// never cuts from a light launch to the dark app. The native splash stays the baked (orange) PNG until
// the next native build, so the NATIVE_SPLASH_* replica stays for native only.
// Colours come from constants/colors.ts tokens; no literal lives here.
//
// Pure TypeScript: NO react-native import, NO hex. utils/levelTimeline.ts is
// not edited — the desk geometry continues its table past 120 px here.

import {
  LEVEL_MAX_W,
  LVL_MIN_W,
  SPLASH_MARK_H,
  SPLASH_MARK_W,
  SPLASH_MARK_X0,
  SPLASH_MARK_Y0,
  levelGeometry,
  levelParts,
  splashRect,
  type LevelGeometry,
  type LevelParts,
  type LevelRect,
  type SplashRect,
} from './levelTimeline';
import { BRAND_ACCENT, BRAND_ACCENT_ON_DARK, Theme, deriveAccentPalette, getCustomPrimary } from '../constants/colors';

// ── The tier ─────────────────────────────────────────────────────────────────

export type LoaderTier = 'phone' | 'tablet' | 'laptop' | 'monitor';
export type DeskTier = Exclude<LoaderTier, 'phone'>;

/** The first window width (CSS px) of each desk tier. */
export const DESK_MIN_W = { tablet: 768, laptop: 1280, monitor: 1920 } as const;

/** Non-web → 'phone' at every width. Web: by window CSS width. */
export function loaderTier(width: number, platform: string): LoaderTier {
  if (platform !== 'web' || !Number.isFinite(width) || width < DESK_MIN_W.tablet) return 'phone';
  if (width < DESK_MIN_W.laptop) return 'tablet';
  if (width < DESK_MIN_W.monitor) return 'laptop';
  return 'monitor';
}

// ── The tables ───────────────────────────────────────────────────────────────

/**
 * The launch level per desk tier: markW = clamp(minPx, vw·W, maxPx) (the 438 × 30
 * splash box scales with it), and the "MAGE ID" wordmark above it.
 * Continuous at every boundary: 768 → 240 (= the web phone's cap), 1280 → 360,
 * 1920 → 480.
 */
export const DESK_SPLASH = {
  tablet: { minPx: 240, vw: 0.3, maxPx: 360, wordmarkLarge: false, tracking: 3.4, wordmarkH: 34, wordmarkGap: 32 },
  laptop: { minPx: 360, vw: 0.28, maxPx: 480, wordmarkLarge: true, tracking: 4.4, wordmarkH: 42, wordmarkGap: 40 },
  monitor: { minPx: 480, vw: 0.25, maxPx: 640, wordmarkLarge: true, tracking: 4.4, wordmarkH: 42, wordmarkGap: 48 },
} as const;

/**
 * The datum: two 9 px boxes, each a 1 px line on the level's centre line with a
 * 1 × 9 tick at its OUTER end, from the gutter to 24 px short of the level.
 * View opacity only (never an alpha suffix).
 */
export const DESK_DATUM = {
  gapPx: 24, gutterVw: 0.06, gutterMin: 32, gutterMax: 160, lineH: 1, tickH: 9, tickW: 1,
  splashOpacity: 0.12, themeOpacity: 0.3,
} as const;

/** The full-screen gate's caption per desk tier (its level width is screenLevelW, below). */
export const DESK_SCREEN = {
  tablet: { caption: 'footnoteEmphasized', captionGap: 12, captionMaxW: 320 },
  laptop: { caption: 'headline', captionGap: 20, captionMaxW: 480 },
  monitor: { caption: 'headline', captionGap: 20, captionMaxW: 480 },
} as const;

/**
 * The full-screen gate's level, every platform: the LAUNCH mark's width for the
 * same window, rounded, never under minPx or over maxPx (= the widest launch
 * mark, DESK_SPLASH.monitor.maxPx).
 */
export const SCREEN_LEVEL = { minPx: 120, maxPx: 640 } as const;

/** ConstructionLoader size="lg" on the desk web (S1). */
export const DESK_INLINE_LG = { tablet: 120, laptop: 160, monitor: 200 } as const;

/** The table geometry continued past its 120 row (levelTimeline LEVEL_ANCHORS / CAP_ANCHORS). */
export const LEVEL_DESK_ANCHORS = {
  widths: [120, 240], bubbleW: [18, 36], bubbleH: [7, 13], amp: [28, 60],
  trackH: [2, 4], capH: [10, 18], stretch: 0.14, squash: 0.1,
} as const;
/** The last anchor row. Past it the 240 row scales in proportion, up to LEVEL_DESK_SCALE_MAX_W. */
export const LEVEL_DESK_MAX_W = 240;
export const LEVEL_DESK_SCALE_MAX_W = 640;

// ── The web launch palette ───────────────────────────────────────────────────
//
// THE WEB LAUNCH FOLLOWS LIGHT / DARK. A dark-mode web user must not open on
// the concrete ground and then cut to the dark app, so the launch takes the
// scheme the app is about to resolve: the page's data-theme tag (the theme-boot
// script in public/index.html writes it before first paint, from the stored
// mageid_theme pref or else the OS), and the OS prefers-color-scheme when the
// tag is absent. The pre-JS still mirrors this with one
// @media (prefers-color-scheme: dark) block plus html[data-theme='dark'] rules,
// so the CSS still and the first JS frame are the same colours.

export type LaunchScheme = 'light' | 'dark';

export interface WebLaunchColors { bg: string; accent: string; cap: string; fg: string }

/** Tokens only: the concrete ground, the brand green, the light ink. */
export const WEB_LAUNCH = {
  bg: Theme.light.bg,
  accent: BRAND_ACCENT,
  cap: Theme.light.text,
  fg: Theme.light.text,
} as const;

/**
 * The dark twin, tokens only: the green-black ground (Theme.dark.bg), the brand
 * as it reads on dark (BRAND_ACCENT_ON_DARK — the brand itself is 2.80:1 there),
 * and the dark theme's ink.
 */
export const WEB_LAUNCH_DARK = {
  bg: Theme.dark.bg,
  accent: BRAND_ACCENT_ON_DARK,
  cap: Theme.dark.text,
  fg: Theme.dark.text,
} as const;

/**
 * The launch's scheme from what the page knows before JS: the data-theme tag
 * wins when it is 'light' or 'dark' (exactly the app's own resolution), else
 * the OS preference. Pure: the caller reads the DOM.
 */
export function webLaunchScheme(dataTheme: string | null | undefined, osDark: boolean): LaunchScheme {
  if (dataTheme === 'dark' || dataTheme === 'light') return dataTheme;
  return osDark ? 'dark' : 'light';
}

/** WEB_LAUNCH, or WEB_LAUNCH_DARK for the dark scheme. */
export function webLaunchColors(scheme: LaunchScheme = 'light'): WebLaunchColors {
  return scheme === 'dark' ? WEB_LAUNCH_DARK : WEB_LAUNCH;
}

/** The user's hue on the scheme's ground (equals webLaunchColors(scheme).accent on the default brand). */
export function webLaunchHue(scheme: LaunchScheme = 'light'): string {
  return deriveAccentPalette(getCustomPrimary(), scheme).accent;
}

/** The splash tone's colours on the web (the LevelPalette shape of components/loaders/themeFallback). */
export function webLaunchPalette(color?: string, scheme: LaunchScheme = 'light'): { bubble: string; track: string; cap: string; grad: string; beat: string; lvl: string } {
  const c = webLaunchColors(scheme);
  const a = c.accent;
  return { bubble: color ?? a, track: a, cap: c.cap, grad: c.cap, beat: a, lvl: a };
}

// ── The launch composition ───────────────────────────────────────────────────

const clamp = (lo: number, v: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** clamp(round(0.06 · W), 32, 160): where the datum ends. */
export function deskGutter(width: number): number {
  const D = DESK_DATUM;
  return clamp(D.gutterMin, Math.round(D.gutterVw * width), D.gutterMax);
}

/** The launch mark width for a desk tier: clamp(minPx, vw · W, maxPx). */
export function deskSplashMarkW(width: number, tier: DeskTier): number {
  const T = DESK_SPLASH[tier];
  return clamp(T.minPx, T.vw * width, T.maxPx);
}

export interface DatumRect { left: number; top: number; width: number; height: number }

export interface DeskLaunchLayout {
  tier: DeskTier;
  /** The 438:30 mark, centred on (W/2, H/2) exactly like splashRect. */
  rect: SplashRect;
  /** The wordmark's full-width box: its bottom edge sits `wordmarkGap` above the level's centre line. */
  wordmarkBox: { top: number; height: number; left: 0; right: 0 };
  wordmarkLarge: boolean;
  datum: { left: DatumRect; right: DatumRect };
}

/** The desk launch picture for a window, or null on 'phone' (the phone path is untouched). */
export function deskLaunchLayout(width: number, height: number, platform: string): DeskLaunchLayout | null {
  const tier = loaderTier(width, platform);
  if (tier === 'phone') return null;
  const T = DESK_SPLASH[tier];
  const s = deskSplashMarkW(width, tier) / SPLASH_MARK_W;
  // splashRect's own expressions, with this scale.
  const imgLeft = (width - 1024 * s) / 2;
  const imgTop = (height - 1024 * s) / 2;
  const rect: SplashRect = {
    s, imgLeft, imgTop,
    markLeft: imgLeft + SPLASH_MARK_X0 * s,
    markTop: imgTop + SPLASH_MARK_Y0 * s,
    markW: SPLASH_MARK_W * s,
    markH: SPLASH_MARK_H * s,
  };
  const cy = height / 2;
  const D = DESK_DATUM;
  const g = deskGutter(width);
  const top = cy - D.tickH / 2;
  const innerL = rect.markLeft - D.gapPx;
  const innerR = rect.markLeft + rect.markW + D.gapPx;
  return {
    tier,
    rect,
    wordmarkBox: { top: cy - T.wordmarkGap - T.wordmarkH, height: T.wordmarkH, left: 0, right: 0 },
    wordmarkLarge: T.wordmarkLarge,
    datum: {
      left: { left: g, top, width: innerL - g, height: D.tickH },
      right: { left: innerR, top, width: width - g - innerR, height: D.tickH },
    },
  };
}

/** The launch mark rect any host draws: the desk rect on a desk tier, else splashRect. */
export function launchRect(width: number, height: number, platform: string): SplashRect {
  return deskLaunchLayout(width, height, platform)?.rect ?? splashRect(width, height, platform);
}

// ── The full-screen gate ─────────────────────────────────────────────────────

/**
 * THE ONE RULE for a full-screen loader's level (ScreenLoader: the sign-in
 * reload veil, the account-switch gate, <Loading scope="screen">): it is drawn
 * as wide as the launch mark for the same window — launchRect's markW, so
 * 438/1024 of the shorter side on a phone (capped at 240 on the web below 768)
 * and DESK_SPLASH's clamp on a desk tier — rounded to a whole point and held
 * inside SCREEN_LEVEL. The founder (2026-10-04): "after logging in the loading
 * screen is a very small level" — it was a fixed 64 pt (16 % of an iPhone)
 * right after a 167 pt launch mark. Inline loaders (buttons, rows, cards) do
 * not come through here; they keep their own small sizes.
 */
export function screenLevelW(width: number, height: number, platform: string): number {
  const w = launchRect(width, height, platform).markW;
  if (!Number.isFinite(w)) return SCREEN_LEVEL.minPx;
  return clamp(SCREEN_LEVEL.minPx, Math.round(w), SCREEN_LEVEL.maxPx);
}

function lerp2(xs: readonly [number, number] | readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[1]) return ys[1];
  return ys[0] + ((ys[1] - ys[0]) * (x - xs[0])) / (xs[1] - xs[0]);
}

/**
 * The table geometry for a drawn width: ≤ 120 IS levelGeometry (identical);
 * 120 → 240 continues it from LEVEL_DESK_ANCHORS (caps, graduations, the
 * "it's level" accent settle all as the table draws them from 96 px); past
 * 240 the 240 row scales in proportion (every part × width / 240), and the
 * width clamps at LEVEL_DESK_SCALE_MAX_W.
 */
export function levelGeometryDesk(width: number): LevelGeometry {
  if (!(width > LEVEL_MAX_W)) return levelGeometry(width);
  const drawn = Math.min(LEVEL_DESK_SCALE_MAX_W, width);
  const k = drawn > LEVEL_DESK_MAX_W ? drawn / LEVEL_DESK_MAX_W : 1;
  const w = drawn;
  const A = LEVEL_DESK_ANCHORS;
  const at = (ys: readonly number[]) => k * lerp2(A.widths, ys, Math.min(LEVEL_DESK_MAX_W, drawn));
  const bubbleW = at(A.bubbleW);
  const bubbleH = at(A.bubbleH);
  const trackH = at(A.trackH);
  const capH = at(A.capH);
  const capW = trackH;
  const boxW = w;
  const boxH = Math.max(capH, bubbleH, trackH);
  const cy = boxH / 2;
  const gw = Math.max(1, (1 * w) / 120);
  const gh = (6 * w) / 120;
  const off = 0.086 * w;
  return {
    cls: 'XL',
    boxW,
    boxH,
    track: { x: capW, y: cy - trackH / 2, w: boxW - 2 * capW, h: trackH, opacity: 0.25, radius: trackH / 2 },
    caps: { w: capW, h: capH, xL: 0, xR: boxW - capW, y: cy - capH / 2, radius: capW / 2 },
    grads: { w: gw, h: gh, xL: boxW / 2 - off - gw / 2, xR: boxW / 2 + off - gw / 2, y: cy - gh / 2, opacity: 0.55, radius: gw / 2 },
    bubble: { w: bubbleW, h: bubbleH, x: boxW / 2 - bubbleW / 2, y: cy - bubbleH / 2, radius: bubbleH / 2 },
    amp: at(A.amp),
    stretch: A.stretch,
    squash: A.squash,
  };
}

/**
 * levelParts for the desk: the splash tone and every width ≤ 120 ARE levelParts
 * (the splash already scales by s = size/438); past 120 the table tones map
 * levelGeometryDesk with levelParts' own mapping.
 */
export function levelPartsDesk(size: number, tone: 'accent' | 'onAccent' | 'muted' | 'splash'): LevelParts {
  if (tone === 'splash' || !(size > LEVEL_MAX_W)) return levelParts(size, tone);
  const g = levelGeometryDesk(size);
  const cap = (x: number): LevelRect | null => (g.caps ? { left: x, top: g.caps.y, width: g.caps.w, height: g.caps.h, radius: g.caps.radius } : null);
  const grad = (x: number): LevelRect => ({ left: x, top: g.grads!.y, width: g.grads!.w, height: g.grads!.h, radius: g.grads!.radius });
  return {
    splash: false,
    boxW: g.boxW,
    boxH: g.boxH,
    capL: cap(0),
    capR: g.caps ? cap(g.caps.xR) : null,
    track: { left: g.track.x, top: g.track.y, width: g.track.w, height: g.track.h, radius: g.track.radius },
    grads: g.grads ? [grad(g.grads.xL), grad(g.grads.xR)] : null,
    bubble: { left: g.bubble.x, top: g.bubble.y, width: g.bubble.w, height: g.bubble.h, radius: g.bubble.radius },
    amp: g.amp,
    stretch: g.stretch,
    squash: g.squash,
    trackOpacity: tone === 'onAccent' ? 0.35 : tone === 'muted' ? 0.3 : g.track.opacity,
    capOpacity: 1,
    gradOpacity: g.grads ? g.grads.opacity : 0,
    hasLvl: g.boxW >= LVL_MIN_W,
  };
}
