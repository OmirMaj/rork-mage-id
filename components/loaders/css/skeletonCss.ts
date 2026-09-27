// skeletonCss.ts — the WEB skeleton "breath wave": ONE keyframe set and 16
// phase buckets, compiled once through StyleSheet.create at module load.
//
// WHY CSS. On the web an Animated loop is a JS loop that re-renders every
// placeholder block each frame, exactly while the screen is busy loading. The
// browser runs a CSS animation off the main thread instead.
//
// THE NUMBERS are CORE's (utils/levelTimeline.ts): the keyframes are the 33
// samples of skeletonWave(0) — absolute opacities, alpha 0.09 at rest dipping
// 40 % as the soft bump passes — at 0 %, 3.125 %, … 100 %, over
// LOADER.skeleton.periodMs (1600 ms), linear, forever.
//
// THE PHASE. Native bakes a block's phase φ into its interpolation's output,
// so the bump reaches that block φ of a cycle LATER. A negative CSS delay of
// −(b/16)·period starts bucket b's animation b/16 of a cycle EARLIER, so a
// block whose phase is φ takes bucket b = (16 − round(16φ)) mod 16: its shift
// −b/16 ≡ φ (mod 1), and the wave travels top-left → bottom-right on the web
// exactly as it does on the phone (scripts/validate-level-content.ts proves
// the two agree at every sample).
//
// RULES (scripts/validate-motion.ts rule 4 and its web notes): keyframes only
// through StyleSheet.create (an inline style with animationKeyframes is
// silently dropped by react-native-web), every duration and delay a STRING (a
// bare number becomes px), fill mode 'backwards' only, opacity only.

import { StyleSheet, type ViewStyle } from 'react-native';
import { LOADER, skeletonWave } from '@/utils/levelTimeline';

/** How many phase buckets the web quantises a block's phase into. */
export const SKELETON_BUCKETS = 16;

const pct = (k: number, n: number): string => `${Number(((k * 100) / (n - 1)).toFixed(4))}%`;

/** The 33 keyframe stops: '0%' … '100%' → { opacity } (skeletonWave(0)). */
export function skeletonKeyframes(): Record<string, { opacity: number }> {
  const wave = skeletonWave(0);
  const n = wave.outputRange.length;
  const frames: Record<string, { opacity: number }> = {};
  wave.outputRange.forEach((opacity, k) => { frames[pct(k, n)] = { opacity }; });
  return frames;
}

/** Bucket b's CSS delay: −round(b/16 × period) ms, as a STRING. */
export function skeletonBucketDelay(bucket: number): string {
  return `-${Math.round((bucket / SKELETON_BUCKETS) * LOADER.skeleton.periodMs)}ms`;
}

/** The bucket whose delay reproduces phase φ (see THE PHASE above). */
export function skeletonBucketFor(phase: number): number {
  const p = Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;
  return (SKELETON_BUCKETS - (Math.round(p * SKELETON_BUCKETS) % SKELETON_BUCKETS)) % SKELETON_BUCKETS;
}

const KEYFRAMES = [skeletonKeyframes()];

function bucketStyle(bucket: number): ViewStyle {
  return {
    animationKeyframes: KEYFRAMES,
    animationDuration: `${LOADER.skeleton.periodMs}ms`,
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
    animationFillMode: 'backwards',
    animationDelay: skeletonBucketDelay(bucket),
  } as unknown as ViewStyle;
}

const RAW: Record<string, ViewStyle> = {};
for (let b = 0; b < SKELETON_BUCKETS; b++) RAW[`b${b}`] = bucketStyle(b);

/** Registered once: one class per bucket, one shared keyframe name. */
const BUCKETS = StyleSheet.create(RAW);

/** The registered wave style for a block whose phase is φ (web only). */
export function skeletonWaveStyle(phase: number): ViewStyle {
  return BUCKETS[`b${skeletonBucketFor(phase)}`];
}
