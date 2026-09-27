// codeCheckCss.ts — the code-check laser and review marks on the WEB.
//
// WHY CSS. On react-native-web the native loop CodeCheckLoader uses on iOS
// becomes a JS requestAnimationFrame loop, and it freezes exactly while the
// Construction AI screen is busy parsing the answer. A CSS animation runs on
// the browser's compositor and keeps moving.
//
// ONE TABLE. Every keyframe below is built from components/loaders/
// progressMath.ts — the same ranges the native Animated.interpolate plays —
// so the two platforms cannot drift. Rules (components/loaders/css/README.txt,
// scripts/validate-level-progress.ts): keyframes only inside StyleSheet.create
// (RN-web silently drops an inline keyframe object), durations and delays as
// 'ms' strings, fill mode 'backwards' only, transform and opacity only.

import { StyleSheet, type ViewStyle } from 'react-native';
import {
  CODE_CHECK_SWEEP_MS, MARK_STOPS, codeCheckLaserFrames, codeCheckMarkFrames, type CssFrame,
} from '@/components/loaders/progressMath';

type Keyframes = Record<string, { transform?: string; opacity: number }>;

function keyframes(frames: CssFrame[]): Keyframes {
  const out: Keyframes = {};
  for (const f of frames) out[f.pct] = f.transform ? { transform: f.transform, opacity: f.opacity } : { opacity: f.opacity };
  return out;
}

const DURATION = `${CODE_CHECK_SWEEP_MS}ms`;

/** The five review marks: registered once, at module load (they do not depend on the sheet's size). */
const MARKS = StyleSheet.create(
  Object.fromEntries(MARK_STOPS.map((stop, i) => [`m${i}`, {
    animationKeyframes: [keyframes(codeCheckMarkFrames(stop))],
    animationDuration: DURATION,
    animationDelay: '0ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
    animationFillMode: 'backwards',
  } as unknown as ViewStyle])),
) as Record<string, ViewStyle>;

/** The registered class for review mark `i` (MARK_STOPS order). */
export function codeCheckMarkStyle(i: number): ViewStyle | null {
  return MARKS[`m${i}`] ?? null;
}

/** The laser's travel depends on the sheet height, so one class per rounded height, registered on first use. */
const LASERS = new Map<number, ViewStyle>();

/** The registered laser class for a sheet `sheetH` px tall. */
export function codeCheckLaserStyle(sheetH: number): ViewStyle {
  const h = Math.max(0, Math.round(sheetH));
  const hit = LASERS.get(h);
  if (hit) return hit;
  const style = StyleSheet.create({
    laser: {
      animationKeyframes: [keyframes(codeCheckLaserFrames(h))],
      animationDuration: DURATION,
      animationDelay: '0ms',
      animationTimingFunction: 'linear',
      animationIterationCount: 'infinite',
      animationFillMode: 'backwards',
    } as unknown as ViewStyle,
  }).laser;
  LASERS.set(h, style);
  return style;
}
