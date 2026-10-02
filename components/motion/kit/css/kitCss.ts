// kitCss.ts — the motion kit's ONLY web keyframes (see ./README.txt).
//
// On the web the kit moves through CSS, so the browser's compositor runs it:
// keyframes registered ONCE through StyleSheet.create (an inline keyframe
// object is silently dropped by react-native-web), transform / opacity only,
// every duration and delay a STRING ('35ms' — a bare number becomes px), fill
// mode 'backwards' only (the end state is the element's own style: nothing is
// retained, no transform re-roots a position:fixed child), and byte-different
// twins (rise8 / rise8B, fade / fadeB) to restart an animation on the same
// element (react-native-web names a keyframe from its content).
//
// Nothing here runs at module load except the one StyleSheet.create of the
// closed key set, exactly like components/ui/motion.ts RAW.

import { StyleSheet, type ViewStyle } from 'react-native';
import { KIT_WEB } from '@/utils/motion/kit/kitSpec';

export type KitWebKey =
  | 'rise8' | 'rise8B' | 'fade' | 'fadeB' | 'send56' | 'send44' | 'pairX6' | 'pop98'
  | 'tagTL' | 'tagTR' | 'tagBR' | 'tagBL' | 'check60' | 'rollIn6' | 'rollOut6' | 'dotPulse'
  | 'drawL' | 'drawC' | 'lift2';

type Frame = { opacity?: number; transform?: string };

function keyframes(frames: Record<string, Frame>, duration: string, ease: string, extra: Record<string, string> = {}): ViewStyle {
  return {
    animationKeyframes: [frames],
    animationDuration: duration,
    animationTimingFunction: ease,
    animationFillMode: 'backwards',
    ...extra,
  } as unknown as ViewStyle;
}

/** An arrival: from `from` to the element's own resting style. */
function entry(from: Frame, duration: string, ease: string = KIT_WEB.easeOut, extra: Record<string, string> = {}): ViewStyle {
  const to: Frame = {};
  if (from.opacity !== undefined) to.opacity = 1;
  if (from.transform !== undefined) to.transform = 'none';
  return keyframes({ from, to }, duration, ease, extra);
}

/** The user turn: travel 280 ms (Motion.spring.rise as a web duration); opacity done by 43 % (120 ms). */
function send(px: number): ViewStyle {
  return keyframes({
    '0%': { opacity: 0, transform: `translateY(${px}px) scale(0.98)` },
    '43%': { opacity: 1 },
    '100%': { opacity: 1, transform: 'none' },
  }, '280ms', KIT_WEB.easeOut);
}

const RAW: Record<KitWebKey, ViewStyle> = {
  rise8: entry({ opacity: 0, transform: 'translateY(8px)' }, '220ms'),
  // rise8's byte-different twin: a different animation-name restarts the CSS animation without a remount.
  rise8B: entry({ opacity: 0.001, transform: 'translateY(8px)' }, '220ms'),
  fade: entry({ opacity: 0 }, '160ms'),
  fadeB: entry({ opacity: 0.001 }, '160ms'),
  send56: send(56),
  send44: send(44),
  pairX6: entry({ opacity: 0, transform: 'translateX(6px)' }, '160ms'),
  pop98: entry({ opacity: 0, transform: 'scale(0.98)' }, '280ms'),
  tagTL: entry({ opacity: 0, transform: 'translate(-12px, -12px)' }, '220ms'),
  tagTR: entry({ opacity: 0, transform: 'translate(12px, -12px)' }, '220ms'),
  tagBR: entry({ opacity: 0, transform: 'translate(12px, 12px)' }, '220ms'),
  tagBL: entry({ opacity: 0, transform: 'translate(-12px, 12px)' }, '220ms'),
  check60: entry({ opacity: 0, transform: 'scale(0.6)' }, '180ms'),
  rollIn6: entry({ opacity: 0, transform: 'translateY(6px)' }, '140ms'),
  // A LEAVING layer: the element's own style must be opacity 0 (fill backwards
  // leaves it there when the 90 ms are over).
  rollOut6: keyframes({ from: { opacity: 1, transform: 'none' }, to: { opacity: 0, transform: 'translateY(-6px)' } }, '90ms', KIT_WEB.easeIn),
  // The thinking dots: rise 360 ms (30 %), fall 360 ms (to 60 %), rest. Each
  // segment eases inOut. Infinite; a hidden tab pauses it by itself.
  dotPulse: keyframes({
    '0%': { opacity: 0.3, transform: 'scale(0.8)' },
    '30%': { opacity: 1, transform: 'scale(1)' },
    '60%': { opacity: 0.3, transform: 'scale(0.8)' },
    '100%': { opacity: 0.3, transform: 'scale(0.8)' },
  }, '1200ms', KIT_WEB.easeInOut, { animationIterationCount: 'infinite' }),
  // A 2 pt rule drawing itself: from the left edge, or from its centre (the Level's track).
  drawL: entry({ transform: 'scaleX(0)' }, '240ms', KIT_WEB.easeOut, { transformOrigin: 'left' }),
  drawC: entry({ transform: 'scaleX(0)' }, '240ms'),
  // The priority cell's 2 pt nudge: up and back, nothing left at rest.
  lift2: keyframes({
    '0%': { transform: 'none' },
    '45%': { transform: 'translateY(-2px)' },
    '100%': { transform: 'none' },
  }, '520ms', KIT_WEB.easeInOut),
};

/** Registered once, so each key compiles to one class. */
const REGISTERED = StyleSheet.create(RAW);

const CACHE = new Map<string, ViewStyle>();
const CACHE_MAX = 256;

function remember(id: string, make: () => ViewStyle): ViewStyle {
  const hit = CACHE.get(id);
  if (hit) return hit;
  const s = make();
  if (CACHE.size < CACHE_MAX) CACHE.set(id, s);
  return s;
}

const ms = (n: number): string => `${Math.max(0, Math.round(n))}ms`;

/** The registered style for `key`, with its delay as a CSS string (registered and cached per delay). */
export function kitWebStyle(key: KitWebKey, delayMs = 0): ViewStyle {
  const d = Math.max(0, Math.round(delayMs));
  if (d === 0) return REGISTERED[key];
  return remember(`${key}|${d}`, () => StyleSheet.create({ s: { ...RAW[key], animationDelay: ms(d) } as ViewStyle }).s);
}

/**
 * A one-off travel to the element's own place: from translate(dx, dy) scale(s)
 * (and an optional start opacity) over `durationMs`, eased out, after
 * `delayMs`. Numbers are rounded to 0.5 px so the cache stays small.
 */
export function kitTravel(dx: number, dy: number, durationMs: number, delayMs = 0, opts: { scale?: number; opacity?: number } = {}): ViewStyle {
  const r = (n: number) => Math.round(n * 2) / 2;
  const s = opts.scale !== undefined ? Math.round(opts.scale * 1000) / 1000 : 1;
  const from: Frame = { transform: `translate(${r(dx)}px, ${r(dy)}px)${s !== 1 ? ` scale(${s})` : ''}` };
  const to: Frame = { transform: 'none' };
  if (opts.opacity !== undefined) { from.opacity = opts.opacity; to.opacity = 1; }
  const id = `travel|${from.transform}|${from.opacity ?? ''}|${Math.round(durationMs)}|${Math.round(delayMs)}`;
  return remember(id, () => StyleSheet.create({
    s: { ...keyframes({ from, to }, ms(durationMs), KIT_WEB.easeOut), animationDelay: ms(delayMs) } as ViewStyle,
  }).s);
}

/**
 * A flyer: from its own box (the source) to translate(dx, dy) scale(s), fading
 * out over its last `fadeMs`. The element's own style is opacity 0, so it is
 * gone when the keyframes end (fill backwards).
 */
export function kitFlight(dx: number, dy: number, scale: number, durationMs: number, delayMs: number, fadeMs: number): ViewStyle {
  const r = (n: number) => Math.round(n * 2) / 2;
  const s = Math.round(scale * 1000) / 1000;
  const hold = Math.max(0, Math.min(99, Math.round(((durationMs - fadeMs) / durationMs) * 100)));
  const end = `translate(${r(dx)}px, ${r(dy)}px) scale(${s})`;
  return remember(`flight|${end}|${Math.round(durationMs)}|${Math.round(delayMs)}|${hold}`, () => StyleSheet.create({
    s: {
      ...keyframes({
        '0%': { opacity: 1, transform: 'none' },
        [`${hold}%`]: { opacity: 1 },
        '100%': { opacity: 0, transform: end },
      }, ms(durationMs), KIT_WEB.easeOut),
      animationDelay: ms(delayMs),
    } as ViewStyle,
  }).s);
}

/** A pose for kitPose: opacity and a translate / scale (no other property exists here). */
export type KitPose = { opacity: number; x: number; y: number; scale: number };

/** A pose as a CSS transform string ('none' at rest). */
export function poseTransform(p: KitPose): string {
  const parts: string[] = [];
  if (p.x) parts.push(`translateX(${Math.round(p.x * 2) / 2}px)`);
  if (p.y) parts.push(`translateY(${Math.round(p.y * 2) / 2}px)`);
  if (p.scale !== 1) parts.push(`scale(${Math.round(p.scale * 1000) / 1000})`);
  return parts.length ? parts.join(' ') : 'none';
}

/**
 * One layer moving between two poses (a stack card stepping forward). The
 * element's OWN style must already be the `to` pose: fill backwards leaves it
 * there when the keyframes end.
 */
export function kitPose(from: KitPose, to: KitPose, durationMs: number, ease: 'out' | 'in' = 'out'): ViewStyle {
  const f: Frame = { opacity: Math.round(from.opacity * 1000) / 1000, transform: poseTransform(from) };
  const t: Frame = { opacity: Math.round(to.opacity * 1000) / 1000, transform: poseTransform(to) };
  return remember(`pose|${f.opacity}|${f.transform}|${t.opacity}|${t.transform}|${Math.round(durationMs)}|${ease}`, () => StyleSheet.create({
    s: keyframes({ from: f, to: t }, ms(durationMs), ease === 'in' ? KIT_WEB.easeIn : KIT_WEB.easeOut),
  }).s);
}

/** A leaving fade (the element's own style must already be opacity 0). */
export function kitFadeOut(durationMs: number, delayMs = 0): ViewStyle {
  return remember(`out|${Math.round(durationMs)}|${Math.round(delayMs)}`, () => StyleSheet.create({
    s: { ...keyframes({ from: { opacity: 1 }, to: { opacity: 0 } }, ms(durationMs), KIT_WEB.easeIn), animationDelay: ms(delayMs) } as ViewStyle,
  }).s);
}

/** Every closed key (for the tests). */
export const KIT_WEB_KEYS = Object.keys(RAW) as KitWebKey[];
