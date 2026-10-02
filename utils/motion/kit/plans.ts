// plans.ts — one pure plan<Name>(reduced, …) per kit part (rule R8).
//
// A plan is the list of steps a part runs: which target moves, from which pose
// to which, after what delay, for how long, on which spring. The React parts
// in components/motion/kit/** read their numbers FROM these plans, and
// scripts/validate-motion-kit.ts K2.6 executes every plan both ways and holds
// the Reduce Motion one to the rule: no translate, no scale, no stagger, fades
// of 100 ms at most, and the SAME end state — the same information, without
// the movement.
//
// Pure: imports only this folder.

import { CHAT_STACK, answerEntry, chipDelay, sendEntry, type ChatVariant } from './chatStack';
import { cardDelay, badgeDelay, shownSteps, stepSchedule } from './accumulate';
import { beatSchedule } from './checkQueue';
import { KIT_CAPS, KIT_DIST, KIT_MS, KIT_OPACITY, KIT_SCALE, KIT_STAGGER, type KitSpringName } from './kitSpec';
import type { RangeLayout } from './rangeGeometry';
import { webMsFor } from './springMath';
import { sequenceMs, staggerDelay } from './stagger';

export type Pose = {
  opacity: number;
  translateX: number;
  translateY: number;
  scale: number;
  scaleX: number;
  scaleY: number;
};

export const REST: Pose = { opacity: 1, translateX: 0, translateY: 0, scale: 1, scaleX: 1, scaleY: 1 };
export const HIDDEN: Pose = { ...REST, opacity: 0 };
export const pose = (p: Partial<Pose>): Pose => ({ ...REST, ...p });

/**
 * info      — carries information: its end pose must match across plans; no delay when reduced.
 * gate      — scheduled by a real event or a mount gate (the thinking row's 140 ms, the 10 s
 *             label, a scroll settling): a delay is allowed even when reduced.
 * decor     — depth layers and loops: no end-state claim, but never moves when reduced.
 * transient — unmounts at its end (a marker, a flyer, a leaving card).
 */
export type StepKind = 'info' | 'gate' | 'decor' | 'transient';

export type PlanStep = {
  target: string;
  delayMs: number;
  /** The opacity timing (and the move's timing when there is no spring). */
  durationMs: number;
  from: Pose;
  to: Pose;
  /** The move rides this spring (opacity still rides the timing). */
  spring: KitSpringName | null;
  kind: StepKind;
};

export type KitPartName =
  | 'ChatTurn' | 'ThinkingRow' | 'StaggerList' | 'CheckSync' | 'CountRoll' | 'AccumulateCards'
  | 'RangeSettle' | 'FileInto' | 'PriorityGrid' | 'FocusMarker' | 'StackPush' | 'FocusPush'
  | 'CornerTags' | 'MatrixFill';

export const KIT_PARTS: readonly KitPartName[] = [
  'ChatTurn', 'ThinkingRow', 'StaggerList', 'CheckSync', 'CountRoll', 'AccumulateCards',
  'RangeSettle', 'FileInto', 'PriorityGrid', 'FocusMarker', 'StackPush', 'FocusPush',
  'CornerTags', 'MatrixFill',
];

export type KitPlan = { part: KitPartName; reduced: boolean; steps: PlanStep[] };

const RF = KIT_MS.reducedFade;

function step(target: string, delayMs: number, durationMs: number, from: Pose, to: Pose = REST, spring: KitSpringName | null = null, kind: StepKind = 'info'): PlanStep {
  return { target, delayMs, durationMs, from, to, spring, kind };
}
/** The Reduce Motion form of an arrival: opacity only, 100 ms, no delay. */
const fadeIn = (target: string, kind: StepKind = 'info', delayMs = 0): PlanStep => step(target, delayMs, RF, HIDDEN, REST, null, kind);
/** Lands with no motion at all (a row past the cap, a reduced counter). */
const land = (target: string, to: Pose = REST, kind: StepKind = 'info'): PlanStep => step(target, 0, 0, to, to, null, kind);

// ── A1 Chat ──────────────────────────────────────────────────────────────────

export function planChatTurn(reduced: boolean, role: 'user' | 'assistant', variant: ChatVariant = 'page'): KitPlan {
  const steps: PlanStep[] = [];
  if (role === 'user') {
    const e = sendEntry(variant, reduced);
    steps.push(reduced
      ? fadeIn('turn')
      : step('turn', 0, e.fadeMs, pose({ opacity: 0, translateY: e.fromY, scale: e.fromScale }), REST, 'rise'));
  } else {
    const a = answerEntry(reduced);
    steps.push(reduced ? fadeIn('turn') : step('turn', a.delayMs, a.fadeMs, pose({ opacity: 0, translateY: a.fromY })));
  }
  return { part: 'ChatTurn', reduced, steps };
}

/** Chip i under an answer (cap 8: chip 8+ arrives with chip 7). */
export function planChips(reduced: boolean, count: number): PlanStep[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) =>
    reduced ? fadeIn(`chip-${i}`) : step(`chip-${i}`, chipDelay(i, false), CHAT_STACK.chips.fadeMs, HIDDEN));
}

export function planThinkingRow(reduced: boolean): KitPlan {
  const T = CHAT_STACK.thinking;
  const steps: PlanStep[] = reduced
    ? [
        step('row', T.delayMs, RF, HIDDEN, REST, null, 'gate'),
        land('dots', pose({ opacity: T.dot.reducedOpacity }), 'decor'),
        step('label', T.stillWorkingAfterMs, RF, HIDDEN, REST, null, 'gate'),
        step('row-exit', 0, RF, REST, HIDDEN, null, 'transient'),
      ]
    : [
        step('row', T.delayMs, T.fadeMs, pose({ opacity: 0, translateY: T.fromY }), REST, null, 'gate'),
        step('dots', 0, T.dot.periodMs, pose({ opacity: T.dot.low, scale: T.dot.scaleLow }), pose({ opacity: T.dot.low, scale: T.dot.scaleLow }), null, 'decor'),
        step('label', T.stillWorkingAfterMs, T.fadeMs, HIDDEN, REST, null, 'gate'),
        step('row-exit', 0, CHAT_STACK.thinkingOut.fadeMs, REST, HIDDEN, null, 'transient'),
      ];
  return { part: 'ThinkingRow', reduced, steps };
}

// ── A2 Sequential list ───────────────────────────────────────────────────────

export function planStaggerList(reduced: boolean, count: number, cap: number = KIT_STAGGER.cap): KitPlan {
  const steps = Array.from({ length: Math.max(0, count) }, (_, i) => {
    if (reduced) return fadeIn(`row-${i}`);
    const d = staggerDelay(i, cap);
    return d == null ? land(`row-${i}`) : step(`row-${i}`, d, KIT_MS.enter, pose({ opacity: 0, translateY: KIT_DIST.rise }));
  });
  return { part: 'StaggerList', reduced, steps };
}

// ── A3 Checklist ─────────────────────────────────────────────────────────────

export function planCheckSync(reduced: boolean, doneCount: number): KitPlan {
  const beats = beatSchedule(doneCount, reduced);
  const steps: PlanStep[] = [];
  beats.forEach((b, i) => {
    if (reduced) {
      steps.push(fadeIn(`check-${i}`), fadeIn(`tint-${i}`));
    } else {
      steps.push(step(`check-${i}`, b, KIT_MS.fade, pose({ opacity: 0, scale: KIT_SCALE.checkFrom }), REST, 'snap'));
      steps.push(step(`tint-${i}`, b, KIT_MS.fade, HIDDEN));
    }
  });
  if (!reduced && beats.length) steps.push(step('marker', KIT_MS.pairLag, KIT_MS.glide, REST, REST, 'glideLead', 'transient'));
  return { part: 'CheckSync', reduced, steps };
}

// ── A4 Accumulate + count ────────────────────────────────────────────────────

/** The counter's shown steps (≤ 6), each a text change at its scheduled time. */
export function planCountRoll(reduced: boolean, stepCount: number, times?: readonly number[]): KitPlan {
  const n = Math.max(0, Math.min(stepCount, KIT_CAPS.accumulate));
  if (reduced || n === 0) return { part: 'CountRoll', reduced, steps: [land('value')] };
  const at = times ?? stepSchedule(n);
  const steps: PlanStep[] = [];
  for (let k = 0; k < n; k++) {
    const t = at[k] ?? at[at.length - 1] ?? 0;
    if (k > 0) steps.push(step(`out-${k - 1}`, t, KIT_MS.rollOut, REST, pose({ opacity: 0, translateY: -KIT_DIST.roll }), null, 'transient'));
    steps.push(step('value', t, KIT_MS.rollIn, pose({ opacity: 0, translateY: KIT_DIST.roll })));
  }
  return { part: 'CountRoll', reduced, steps };
}

export function planAccumulateCards(reduced: boolean, n: number, badge = true): KitPlan {
  const steps: PlanStep[] = [];
  for (let i = 0; i < n; i++) {
    steps.push(reduced ? fadeIn(`card-${i}`) : step(`card-${i}`, cardDelay(i), KIT_MS.enter, pose({ opacity: 0, translateY: KIT_DIST.rise })));
  }
  steps.push(...planCountRoll(reduced, shownSteps(Array.from({ length: n }, (_, i) => i)).length).steps);
  if (badge && n > 0) {
    steps.push(reduced ? fadeIn('badge') : step('badge', badgeDelay(n), KIT_MS.enter, pose({ opacity: 0, scale: KIT_SCALE.from }), REST, 'rise'));
  }
  return { part: 'AccumulateCards', reduced, steps };
}

// ── A5 Range ─────────────────────────────────────────────────────────────────

export function planRangeSettle(reduced: boolean, layout: RangeLayout): KitPlan {
  const hasBubble = layout.expectedX != null;
  if (reduced || layout.single) {
    const steps = reduced
      ? [fadeIn('track'), fadeIn('low'), ...(layout.single ? [] : [fadeIn('high')]), ...(hasBubble ? [fadeIn('bubble')] : [])]
      : [land('track'), land('low')];
    return { part: 'RangeSettle', reduced, steps };
  }
  const steps: PlanStep[] = [
    step('track', 0, KIT_MS.layout, pose({ scaleX: 0 })),
    // Labels keep opacity 1 the whole way (both endpoints legible) and never scale.
    step('low', 0, 0, pose({ translateX: layout.lowFromX }), REST, 'glideLead'),
    step('high', 0, 0, pose({ translateX: layout.highFromX }), REST, 'glideTrail'),
  ];
  if (hasBubble) steps.push(step('bubble', KIT_MS.priorityAfter, 0, pose({ translateX: layout.bubbleFromX }), REST, 'rise'));
  return { part: 'RangeSettle', reduced, steps };
}

// ── A6 Filing ────────────────────────────────────────────────────────────────

export function planFileInto(reduced: boolean, n: number): KitPlan {
  if (reduced || n <= 0) return { part: 'FileInto', reduced, steps: [land('folder'), reduced ? fadeIn('count') : land('count')] };
  const fly = Math.min(n, KIT_CAPS.flyers);
  const travel = webMsFor('sheet');
  const steps: PlanStep[] = [];
  for (let i = 0; i < fly; i++) {
    steps.push(step(`flyer-${i}`, i * KIT_MS.pairLag, travel, REST, pose({ opacity: 0, scale: KIT_SCALE.flyMin }), 'sheet', 'transient'));
  }
  // The folder receives when the first flyer arrives, and comes straight back.
  steps.push(step('folder', travel, 0, REST, pose({ scale: KIT_SCALE.receive }), 'snap'));
  steps.push(step('folder', travel + webMsFor('snap'), 0, pose({ scale: KIT_SCALE.receive }), REST, 'snap'));
  steps.push(step('count', travel, KIT_MS.rollIn, pose({ opacity: 0, translateY: KIT_DIST.roll })));
  return { part: 'FileInto', reduced, steps };
}

/** A flyer's fade: opacity 1 → 0 over its last 120 ms. */
export const FLYER_FADE_MS = 120;

// ── A7 Priority grid ─────────────────────────────────────────────────────────

/** When the priority emphasis starts: the last animated cell's start + its entrance + 120. */
export function priorityAt(count: number, cap: number = KIT_STAGGER.cap): number {
  return sequenceMs(count, cap) + KIT_MS.priorityAfter;
}

export function planPriorityGrid(reduced: boolean, count: number, cap: number = KIT_STAGGER.cap): KitPlan {
  const steps = planStaggerList(reduced, count, cap).steps.map((s) => ({ ...s, target: s.target.replace('row-', 'cell-') }));
  if (reduced) {
    steps.push(fadeIn('rule'));
  } else {
    const at = priorityAt(count, cap);
    steps.push(step('rule', at, KIT_MS.layout, pose({ scaleX: 0 })));
    // A 2 pt nudge that comes back: the rule is what stays (nothing transformed at rest).
    steps.push(step('lift', at, 0, REST, pose({ translateY: -KIT_DIST.focusLift }), 'rise', 'decor'));
    steps.push(step('lift', at + KIT_MS.layout, 0, pose({ translateY: -KIT_DIST.focusLift }), REST, 'rise', 'decor'));
  }
  // A later priority change: the old cell's rule fades out (120 ms, the thinking
  // row's exit fade; 100 ms reduced) and unmounts at its end.
  steps.push(step('rule-old', 0, reduced ? RF : CHAT_STACK.thinkingOut.fadeMs, REST, HIDDEN, null, 'transient'));
  return { part: 'PriorityGrid', reduced, steps };
}

// ── A8 Focus marker ──────────────────────────────────────────────────────────

export function planFocusMarker(reduced: boolean, travel = 48, delayMs = 0): KitPlan {
  const steps: PlanStep[] = [land('active')];
  if (!reduced) steps.push(step('marker', delayMs, 0, pose({ translateY: -travel }), REST, 'glideLead', 'transient'));
  return { part: 'FocusMarker', reduced, steps };
}

// ── A9 Stack push ────────────────────────────────────────────────────────────

/** Depth k's resting pose (k ≤ 2): up 8·k, smaller by 0.04·k, fainter by 0.2·k. */
export function depthPose(k: number): Pose {
  const d = Math.max(0, Math.min(k, KIT_CAPS.stackLayers - 1));
  return pose({ translateY: -KIT_DIST.depthY * d, scale: 1 - KIT_SCALE.depthStep * d, opacity: 1 - KIT_OPACITY.depthStep * d });
}

export function planStackPush(reduced: boolean, direction: 1 | -1 = 1): KitPlan {
  if (reduced) {
    return { part: 'StackPush', reduced, steps: [step('leaving', 0, RF, REST, HIDDEN, null, 'transient'), fadeIn('front')] };
  }
  const steps: PlanStep[] = direction === 1
    ? [
        step('leaving', 0, KIT_MS.exit, REST, pose({ opacity: 0, translateX: -24 }), null, 'transient'),
        step('front', 0, 0, depthPose(1), REST, 'rise'),
        step('depth1', 0, 0, depthPose(2), depthPose(1), 'rise', 'decor'),
        step('depth2', 0, KIT_MS.fade, pose({ ...depthPose(2), opacity: 0 }), depthPose(2), 'rise', 'decor'),
      ]
    : [
        step('leaving', 0, 0, REST, depthPose(1), 'rise', 'transient'),
        step('front', 0, KIT_MS.fade, pose({ opacity: 0, translateX: -24 }), REST, 'rise'),
        step('depth1', 0, 0, depthPose(1), depthPose(2), 'rise', 'decor'),
      ];
  return { part: 'StackPush', reduced, steps };
}

// ── A10 Focus push ───────────────────────────────────────────────────────────

/** The longest wait for the scroll to settle before the rule draws. */
export const FOCUS_SETTLE_MAX_MS = KIT_MS.glide;

export function planFocusPush(reduced: boolean): KitPlan {
  const steps = reduced
    ? [land('rule'), fadeIn('heading')]
    : [step('rule', FOCUS_SETTLE_MAX_MS, KIT_MS.layout, pose({ scaleX: 0 }), REST, null, 'gate'), step('heading', 0, KIT_MS.swap, HIDDEN)];
  return { part: 'FocusPush', reduced, steps };
}

// ── A11 Corner tags ──────────────────────────────────────────────────────────

export type Corner = 'tl' | 'tr' | 'br' | 'bl';
export const CORNER_ORDER: readonly Corner[] = ['tl', 'tr', 'br', 'bl'];
const CORNER_SIGN: Record<Corner, [number, number]> = { tl: [-1, -1], tr: [1, -1], br: [1, 1], bl: [-1, 1] };

/** A corner's start: 12 pt further out along its diagonal. */
export function cornerFrom(c: Corner): Pose {
  const [sx, sy] = CORNER_SIGN[c];
  return pose({ opacity: 0, translateX: sx * KIT_DIST.tagInset, translateY: sy * KIT_DIST.tagInset });
}

export function planCornerTags(reduced: boolean, corners: readonly Corner[] = CORNER_ORDER): KitPlan {
  const present = CORNER_ORDER.filter((c) => corners.includes(c)).slice(0, KIT_CAPS.tags);
  const steps = present.map((c, i) => (reduced ? fadeIn(`tag-${c}`) : step(`tag-${c}`, i * KIT_MS.tagStagger, KIT_MS.enter, cornerFrom(c))));
  return { part: 'CornerTags', reduced, steps };
}

// ── A12 Matrix ───────────────────────────────────────────────────────────────

export function planMatrixFill(reduced: boolean, rows: number): KitPlan {
  const steps: PlanStep[] = [];
  for (let i = 0; i < Math.max(0, rows); i++) {
    if (reduced) { steps.push(fadeIn(`label-${i}`), fadeIn(`evidence-${i}`)); continue; }
    const d = staggerDelay(i, KIT_CAPS.matrixRows);
    if (d == null) { steps.push(land(`label-${i}`), land(`evidence-${i}`)); continue; }
    steps.push(step(`label-${i}`, d, KIT_MS.fade, HIDDEN));
    steps.push(step(`evidence-${i}`, d + KIT_MS.pairLag, KIT_MS.fade, pose({ opacity: 0, translateX: KIT_DIST.pairX })));
  }
  return { part: 'MatrixFill', reduced, steps };
}

// ── checks the validator and the parts share ─────────────────────────────────

/** The information each target ends on (info + gate steps; the latest-ending step wins). */
export function endState(plan: KitPlan): Record<string, Pose> {
  const out: Record<string, { at: number; to: Pose }> = {};
  for (const s of plan.steps) {
    if (s.kind !== 'info' && s.kind !== 'gate') continue;
    const at = s.delayMs + s.durationMs;
    const prev = out[s.target];
    if (!prev || at >= prev.at) out[s.target] = { at, to: s.to };
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.to]));
}

const sameTransform = (a: Pose, b: Pose) =>
  a.translateX === b.translateX && a.translateY === b.translateY && a.scale === b.scale && a.scaleX === b.scaleX && a.scaleY === b.scaleY;

/** Same targets, same opacity, and the same transform wherever the target is visible. */
export function sameEnd(a: KitPlan, b: KitPlan): string[] {
  const ea = endState(a);
  const eb = endState(b);
  const problems: string[] = [];
  for (const k of new Set([...Object.keys(ea), ...Object.keys(eb)])) {
    const x = ea[k];
    const y = eb[k];
    if (!x || !y) { problems.push(`${k}: only in ${x ? 'the motion' : 'the reduced'} plan`); continue; }
    if (x.opacity !== y.opacity) problems.push(`${k}: opacity ${x.opacity} vs ${y.opacity}`);
    else if (x.opacity > 0 && !sameTransform(x, y)) problems.push(`${k}: a different resting transform`);
  }
  return problems;
}

/** The Reduce Motion rules on one plan (empty = clean). */
export function reducedProblems(plan: KitPlan): string[] {
  const out: string[] = [];
  for (const s of plan.steps) {
    const tag = `${plan.part}.${s.target}`;
    for (const p of [s.from, s.to]) {
      if (p.translateX !== 0 || p.translateY !== 0) out.push(`${tag}: translate when reduced`);
      if (p.scale !== 1 || p.scaleX !== 1 || p.scaleY !== 1) out.push(`${tag}: scale when reduced`);
    }
    if (s.durationMs > KIT_MS.reducedFade) out.push(`${tag}: ${s.durationMs} ms > ${KIT_MS.reducedFade} when reduced`);
    if (s.spring) out.push(`${tag}: a spring when reduced`);
    if (s.delayMs !== 0 && s.kind !== 'gate') out.push(`${tag}: a ${s.delayMs} ms stagger when reduced`);
  }
  return out;
}

/** What useEntrance needs from one step. */
export type StepEntrance = {
  delayMs: number;
  fadeMs: number;
  fromOpacity: number;
  fromY: number;
  fromX: number;
  fromScale: number;
  fromScaleX: number;
  spring: KitSpringName | null;
};

export function entranceOf(s: PlanStep): StepEntrance {
  return {
    delayMs: s.delayMs,
    fadeMs: s.durationMs,
    fromOpacity: s.from.opacity,
    fromY: s.from.translateY,
    fromX: s.from.translateX,
    fromScale: s.from.scale,
    fromScaleX: s.from.scaleX,
    spring: s.spring,
  };
}

/** The step for `target` (the first one), or null. */
export function stepFor(plan: KitPlan, target: string): PlanStep | null {
  return plan.steps.find((s) => s.target === target) ?? null;
}
