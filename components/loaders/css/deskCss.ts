// deskCss.ts — the fades the wide-canvas ScreenLoader shares with its level
// (lane LOADERDESK). Web only (the desk tier exists only on the web).
//
// The level's own reveal and exit are LevelMarkWeb's (CSS). The datum and the
// caption must arrive and leave WITH it, so they take:
//   - the SAME reveal class (levelRevealStyle(revealDelayMs): invisible through
//     the plateau, then 170 ms) — reused from levelCss, not re-declared;
//   - on `done`, the level's exit fade as a transition: opacity 140 ms
//     ACCELERATE after 200 ms (gone at +340, the same instant as the mark), or
//     the Reduce-Motion 160 ms;
//   - on a restart (done true → false), back to full in 170 ms DECELERATE.
// No keyframes here: transitions only, opacity only, every duration a string
// (RN-web reads a bare number as px). Registered through StyleSheet.create.

import { StyleSheet, type ViewStyle } from 'react-native';
import { LOADER } from '@/utils/levelTimeline';
import { CSS_ACCELERATE, CSS_DECELERATE, levelRevealStyle } from './levelCss';

const ms = (v: number) => `${v}ms`;
const S = LOADER.settle;

export const DESK_FADE = StyleSheet.create({
  /** Resting: a restart transitions back to full (170 ms, no delay). */
  base: {
    transitionProperty: 'opacity',
    transitionDuration: ms(LOADER.enter.visFadeMs),
    transitionDelay: '0ms',
    transitionTimingFunction: CSS_DECELERATE,
  } as unknown as ViewStyle,
  /** `done`: 140 ms ACCELERATE from +200 — gone at +340 with the mark. */
  out: {
    opacity: 0,
    transitionProperty: 'opacity',
    transitionDuration: ms(S.visMs),
    transitionDelay: ms(S.visAtMs),
    transitionTimingFunction: CSS_ACCELERATE,
  } as unknown as ViewStyle,
  /** `done` under Reduce Motion: 160 ms, no delay (LevelMarkWeb's rm exit). */
  outRm: {
    opacity: 0,
    transitionProperty: 'opacity',
    transitionDuration: ms(LOADER.rmSettleMs),
    transitionDelay: '0ms',
    transitionTimingFunction: CSS_ACCELERATE,
  } as unknown as ViewStyle,
});

/** The style a desk companion (datum slot, caption) carries: reveal with the level, leave with it. */
export function deskFadeStyle(revealDelayMs: number, done: boolean, reduce: boolean): ViewStyle[] {
  const out: ViewStyle[] = [DESK_FADE.base];
  if (revealDelayMs > 0) out.push(levelRevealStyle(revealDelayMs));
  if (done) out.push(reduce ? DESK_FADE.outRm : DESK_FADE.out);
  return out;
}
