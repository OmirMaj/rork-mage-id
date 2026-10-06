// ============================================================================
// utils/crewClockBatch.ts — clock a whole crew in, and out, in one go
// (UX wave, Lane B1).
//
// "Six guys means 13 taps to clock in and 12 to clock out, with gloves on."
// The time clock's sheet now keeps a multi-select roster and one "Clock in N"
// button, and the Live tab gets "Clock out everyone on <Job>". Every rule a
// batch must keep lives here, pure, so scripts/validate-ux-crew-batch.ts runs
// it under bun:
//
//  - A batch never skips the lapsed-card question (safety #2). Every worker in
//    the batch with an EXPIRED card is named in ONE confirm (batchLapsedText);
//    the screen offers Cancel / Leave them out / Clock in anyway.
//  - A batch never opens a second shift. A worker the fresh pull shows on the
//    clock is left out and named (splitAlreadyOnClock) — the single-tap path
//    asks "Clock in again"; a batch of six is not the place for that.
//  - Clock-out-all closes only HIS OWN open shifts on THAT job (never another
//    job, never a teammate's row, never a missed clock-out — those need their
//    real out time, one by one), at ONE chosen time that can't be in the future
//    or before any of those workers' clock-ins (planBatchClockOut, built on
//    the out-time sheet's own outTimeProblem).
//  - With no job resolved, the button is disabled and says PICK_JOB_FIRST.
// ============================================================================

import type { TimeEntry } from '@/types';
import type { DisplayLang } from '@/i18n/types';
import { t, tn } from '@/i18n/core';
import type { CertFlag } from '@/utils/safety/crewCerts';
import { formatCalendarDay } from '@/utils/calendarDate';
import { isMissedClockOut, outTimeProblem, parseClockTime, formatClockTime } from '@/utils/timeClockPayroll';
import { PICK_JOB_FIRST } from '@/utils/defaultProjectId';

export interface CrewPickMember { id: string; name: string }

/** Add or remove one worker from the picked set (order kept, no duplicates). */
export function toggleCrewPick(picked: readonly string[], id: string): string[] {
  return picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id];
}

/** The "All N on this job" chip: every AVAILABLE worker, or none when all of
 *  them are already picked (the chip toggles). */
export function toggleAllCrew(picked: readonly string[], available: readonly CrewPickMember[]): string[] {
  const ids = available.map(m => m.id);
  const allOn = ids.length > 0 && ids.every(id => picked.includes(id));
  return allOn ? [] : ids;
}

/** Only the picks that are still offered (a worker who went on the clock, or
 *  left the roster, since he was ticked drops out). */
export function livePicks(picked: readonly string[], available: readonly CrewPickMember[]): string[] {
  const ok = new Set(available.map(m => m.id));
  return picked.filter(id => ok.has(id));
}

export interface ClockInButton { label: string; disabled: boolean; reason: string | null }

/** The sheet's primary button. Never enabled without a job and a pick. */
export function clockInButton(pickedCount: number, hasJob: boolean, lang: DisplayLang = 'en'): ClockInButton {
  if (!hasJob) return { label: t('field.time.clockIn', 'Clock In', undefined, lang), disabled: true, reason: PICK_JOB_FIRST };
  if (pickedCount <= 0) return { label: t('field.time.clockIn', 'Clock In', undefined, lang), disabled: true, reason: t('field.time.batch.tickWho', 'Tick who is on site', undefined, lang) };
  return { label: t('field.time.batch.clockInN', 'Clock in {count}', { count: pickedCount }, lang), disabled: false, reason: null };
}

/** "Clock in N" on the chip that picks everyone. */
export function allCrewChipLabel(availableCount: number, allPicked: boolean, lang: DisplayLang = 'en'): string {
  if (availableCount === 0) return t('field.time.batch.nobodyLeft', 'Nobody left to clock in', undefined, lang);
  return allPicked
    ? t('field.time.batch.clearAll', 'Clear all {count}', { count: availableCount }, lang)
    : t('field.time.batch.allOnProject', 'All {count} on this project', { count: availableCount }, lang);
}

/**
 * Split the batch into who can be clocked in and who is already on the clock
 * (per the latest pull). `onClock` maps workerId → where/who, as the screen's
 * openShiftByWorker does.
 */
export function splitAlreadyOnClock<M extends CrewPickMember>(
  members: readonly M[],
  onClock: ReadonlyMap<string, unknown>,
  lang: DisplayLang = 'en',
): { go: M[]; alreadyOn: M[]; note: string | null } {
  const go: M[] = [];
  const alreadyOn: M[] = [];
  for (const m of members) (onClock.has(m.id) ? alreadyOn : go).push(m);
  const note = alreadyOn.length === 0 ? null
    : tn('field.time.batch.alreadyOnNote', alreadyOn.length, {
      one: '{names} is already on the clock, so they were left out. A second shift is paid twice.',
      other: '{names} are already on the clock, so they were left out. A second shift is paid twice.',
    }, { names: listNames(alreadyOn.map(m => m.name), lang) }, lang);
  return { go, alreadyOn, note };
}

/**
 * ONE confirm naming every worker in the batch whose card has EXPIRED
 * (expiring cards are shown on the row, not asked about — the single-tap path
 * asks only about expired ones too, lapsedCertConfirmText). null when nobody
 * in the batch has a lapsed card.
 */
export function batchLapsedText(
  members: readonly CrewPickMember[],
  flagsById: Readonly<Record<string, readonly CertFlag[] | undefined>>,
  lang: DisplayLang = 'en',
): { names: string[]; ids: string[]; message: string } | null {
  const lines: string[] = [];
  const names: string[] = [];
  const ids: string[] = [];
  for (const m of members) {
    const expired = (flagsById[m.id] ?? []).filter(f => f.status === 'expired');
    if (expired.length === 0) continue;
    names.push(m.name);
    ids.push(m.id);
    // Each card reads through safety's own key (the same words on the single-tap confirm).
    const cards = expired.map(f => t('safety.cert.lapsedItem', '{type} (expired {date})', {
      type: f.type,
      date: formatCalendarDay(f.expiresDate, { month: 'short', day: 'numeric' }, lang === 'es' ? 'es' : 'en') || f.expiresDate,
    }, lang)).join(', ');
    lines.push(t('field.time.batch.lapsedLine', '{name}: {cards}', { name: m.name, cards }, lang));
  }
  if (lines.length === 0) return null;
  const message = tn('field.time.batch.lapsedMessage', lines.length, {
    one: '{count} crew member you picked has a lapsed card.\n\n{lines}\n\nClock them in anyway, or leave them out?',
    other: '{count} crew members you picked have a lapsed card.\n\n{lines}\n\nClock them in anyway, or leave them out?',
  }, { lines: lines.join('\n') }, lang);
  return { names, ids, message };
}

/** "Ava, Ben and Carl". */
export function listNames(names: readonly string[], lang: DisplayLang = 'en'): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return t('field.time.list.two', '{first} and {last}', { first: names[0], last: names[1] }, lang);
  return t('field.time.list.many', '{rest} and {last}', { rest: names.slice(0, -1).join(', '), last: names[names.length - 1] }, lang);
}

// ── Clock out everyone on a job ─────────────────────────────────────────────

const isOpen = (e: TimeEntry) => e.status !== 'clocked_out' && !e.clockOut;

/** His open, non-missed shifts on this job — what "Clock out everyone" closes. */
export function batchClockOutTargets(
  ownEntries: readonly TimeEntry[],
  projectId: string | null | undefined,
  nowMs: number,
  alertHours: number,
): TimeEntry[] {
  if (!projectId) return [];
  return ownEntries.filter(e => isOpen(e) && e.projectId === projectId && !isMissedClockOut(e, nowMs, alertHours));
}

/**
 * The jobs that get a "Clock out everyone" button: the job he is looking at
 * when one is resolved; otherwise (All jobs, nothing picked yet) every job
 * where HE has two or more open, non-missed shifts — one button per job, in
 * the order the shifts started. Never a guessed job: each button names its own.
 */
export function batchClockOutJobs(
  ownEntries: readonly TimeEntry[],
  projectId: string | null | undefined,
  nowMs: number,
  alertHours: number,
): { projectId: string; count: number }[] {
  const ids: string[] = [];
  if (projectId) ids.push(projectId);
  else {
    for (const e of ownEntries) {
      if (e.projectId && isOpen(e) && !ids.includes(e.projectId)) ids.push(e.projectId);
    }
  }
  return ids
    .map(id => ({ projectId: id, count: batchClockOutTargets(ownEntries, id, nowMs, alertHours).length }))
    .filter(j => j.count > 1);
}

/** Today's wall-clock time as epoch ms, from "3:30 pm" / "15:30"; NaN when it
 *  is not a time. The batch is for shifts started today (a missed one is left
 *  out), so the time is on today's date. */
export function batchOutMs(text: string, nowMs: number): number {
  const minutes = parseClockTime(text);
  if (minutes === null) return NaN;
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minutes / 60), minutes % 60, 0, 0).getTime();
}

/** The time the confirm offers first: now, to the minute. */
export function defaultBatchOutText(nowMs: number): string {
  return formatClockTime(nowMs);
}

export interface BatchClockOutPlan {
  targets: TimeEntry[];
  /** Why the chosen time can't be used, naming the worker; null when it can. */
  problem: string | null;
  title: string;
  message: string;
}

/**
 * The clock-out-all plan at one time. The time must pass the out-time sheet's
 * own check (outTimeProblem) for EVERY target — so never in the future and
 * never before any of their clock-ins. One failure blocks the whole batch
 * (a partial batch is a payroll surprise), and names who.
 */
export function planBatchClockOut(input: {
  ownEntries: readonly TimeEntry[];
  projectId: string | null | undefined;
  jobName: string;
  outMs: number;
  nowMs: number;
  alertHours: number;
}, lang: DisplayLang = 'en'): BatchClockOutPlan {
  const targets = batchClockOutTargets(input.ownEntries, input.projectId, input.nowMs, input.alertHours);
  const n = targets.length;
  const at = Number.isFinite(input.outMs) ? formatClockTime(input.outMs) : '';
  const title = n === 0
    ? t('field.time.batch.nobodyToClockOut', 'Nobody to clock out', undefined, lang)
    : t('field.time.batch.clockOutNAt', 'Clock out {count} at {time}?', { count: n, time: at || '—' }, lang);
  if (n === 0) {
    return { targets, problem: t('field.time.batch.nobodyOnJob', 'Nobody you clocked in is on the clock on {project}.', { project: input.jobName }, lang), title, message: '' };
  }
  let problem: string | null = null;
  for (const e of targets) {
    const p = outTimeProblem(e, input.outMs, input.nowMs, lang);
    if (p) { problem = n === 1 ? p : t('field.time.batch.workerProblem', '{name}: {problem}', { name: e.workerName, problem: p }, lang); break; }
  }
  const vars = { project: input.jobName, time: at };
  const message = n === 1
    ? (at
      ? t('field.time.batch.endsOneAt', "Ends {name}'s shift on {project} at {time}. Each keeps its own hours, and a running break is taken off. Shifts on other projects, your team's, and missed clock-outs are not touched.", { ...vars, name: targets[0].workerName }, lang)
      : t('field.time.batch.endsOne', "Ends {name}'s shift on {project} at the time you enter. Each keeps its own hours, and a running break is taken off. Shifts on other projects, your team's, and missed clock-outs are not touched.", { project: input.jobName, name: targets[0].workerName }, lang))
    : (at
      ? t('field.time.batch.endsManyAt', "Ends the shifts of {names} on {project} at {time}. Each keeps its own hours, and a running break is taken off. Shifts on other projects, your team's, and missed clock-outs are not touched.", { ...vars, names: listNames(targets.map(e => e.workerName), lang) }, lang)
      : t('field.time.batch.endsMany', "Ends the shifts of {names} on {project} at the time you enter. Each keeps its own hours, and a running break is taken off. Shifts on other projects, your team's, and missed clock-outs are not touched.", { project: input.jobName, names: listNames(targets.map(e => e.workerName), lang) }, lang));
  return { targets, problem, title, message };
}
