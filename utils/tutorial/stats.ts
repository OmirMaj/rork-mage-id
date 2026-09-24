// utils/tutorial/stats.ts — the finale's measured stat.
//
// 'Report filed in 34 s · 3 sections from one note' is the tutorial's
// equivalent of the reference video's '$0 logged'. It is MEASURED: the time
// from entering the first do step to the success signal, plus counts read from
// the real signal payloads. Never an invented comparison ('10x faster than
// paper') — the brain-center honesty rule. When either timestamp is missing
// (he skipped the step, or restored mid-run) there is no stat at all.

import type { PayloadRecord, RunningState, TutorialDef } from './types';

/** '34 s' under a minute, '2 m 14 s' after. Rounded to whole seconds, at
 *  least 1 s (a 0 s stat reads like a bug). */
export function formatDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000));
  if (total < 60) return `${total} s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m} m` : `${m} m ${s} s`;
}

/** Measured milliseconds from the first action to the success signal, or
 *  null when either end was not observed in THIS run. */
export function measuredMs(def: TutorialDef, run: Pick<RunningState, 'firstActionAt' | 'signalAt'>): number | null {
  const end = run.signalAt[def.stat.signal];
  const start = run.firstActionAt;
  if (typeof end !== 'number' || typeof start !== 'number' || end < start) return null;
  return end - start;
}

export function statLine(def: TutorialDef, run: Pick<RunningState, 'firstActionAt' | 'signalAt' | 'payloads'>): string | null {
  const ms = measuredMs(def, run);
  if (ms === null) return null;
  const extras = (def.stat.extras?.(run.payloads as PayloadRecord) ?? []).filter(
    (x): x is string => typeof x === 'string' && x.trim().length > 0,
  );
  return [`${def.stat.lead} ${formatDuration(ms)}`, ...extras].join(' · ');
}

/** 'photo, pin and trade' — an English list for the extras. */
export function listJoin(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
