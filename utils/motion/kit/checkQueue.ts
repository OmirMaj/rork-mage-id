// checkQueue.ts — Synchronized Action Checklist beats, pure (imports ./kitSpec only).
//
// A row ticks ONLY when the host flips its status to 'done' (a queue ack, a
// server answer, a finished phase) — never on a timer. When several complete
// in one burst they tick at least 120 ms apart so each tick reads as its own
// beat, four beats at most: a fifth completion ticks with the fourth.

import { KIT_CAPS, KIT_MS } from './kitSpec';

export type CheckStatus = 'pending' | 'active' | 'done' | 'failed';

/** The check glyph's own entrance on Motion.spring.snap, as a web duration (ms). */
export const CHECK_MS = 180;

/** Each of n completions' offset in the burst: k·120 for k < 4, then with the 4th. Reduced: all 0. */
export function beatSchedule(n: number, reduced: boolean, gap: number = KIT_MS.beatGap, maxBeats: number = KIT_CAPS.checkBeats): number[] {
  const count = Math.max(0, Math.floor(Number.isFinite(n) ? n : 0));
  return Array.from({ length: count }, (_, k) => (reduced ? 0 : Math.min(k, maxBeats - 1) * gap));
}

/** The longest burst: the last beat + the check's 180 ms (≤ 540). */
export function burstMs(n: number): number {
  const b = beatSchedule(n, false);
  return b.length ? b[b.length - 1] + CHECK_MS : 0;
}

/** Rows that turned 'done' between two renders (a real completion), in row order. */
export function newlyDone(prev: Readonly<Record<string, CheckStatus>>, rows: readonly { key: string; status: CheckStatus }[]): string[] {
  return rows.filter((r) => r.status === 'done' && prev[r.key] !== undefined && prev[r.key] !== 'done').map((r) => r.key);
}

/** The beat queue between renders: when the current burst started and how many ticks it holds. */
export type BeatQueue = { burstAt: number; count: number };

/**
 * One completion's delay from `now`: ticks in one burst land 120 ms apart on
 * the burst's own clock, four beats at most (a fifth ticks with the fourth); a
 * tick after the burst has drained starts a new burst. Reduced: always 0.
 */
export function queueBeat(q: BeatQueue, now: number, reduced: boolean, gap: number = KIT_MS.beatGap, maxBeats: number = KIT_CAPS.checkBeats): { delayMs: number; queue: BeatQueue } {
  if (reduced) return { delayMs: 0, queue: { burstAt: now, count: 0 } };
  const lastBeat = q.burstAt + Math.max(0, Math.min(q.count, maxBeats) - 1) * gap;
  const fresh = q.count === 0 || now >= lastBeat + gap;
  const burstAt = fresh ? now : q.burstAt;
  const count = fresh ? 0 : q.count;
  const at = burstAt + Math.min(count, maxBeats - 1) * gap;
  return { delayMs: Math.max(0, at - now), queue: { burstAt, count: count + 1 } };
}
