// defs/scheduleSayIt.ts — "Move a task by saying it".
//
// The schedule tab's AI editor ("Tell me what to change" → ScheduleEditPanel →
// the scheduleEdit copilot) on the SAMPLE job, whose schedule the sandbox
// writes once ('schedule' need: SAMPLE_SCHEDULE_TASKS, one drywall task). He
// says one change, reads the ripple, applies it, and goes back to the job.
//
// THE FIXTURE SEAM (components/copilot/CopilotShell.tsx). On the sample while
// this run is live, a sentence that normalizes EQUAL to SCHEDULE_SAMPLE.sentence
// never reaches the relay: SCHEDULE_SAMPLE.ops(tasks) is the answer, run through
// the real normalizer and shown in the real review (ScheduleDiffView) labelled
// SAMPLE_NO_CREDITS_LABEL. Anything else typed or spoken there is refused with
// SCHEDULE_SAMPLE_REFUSAL — no AI call, no meter. On every other project, and
// on the sample with no run, the editor is exactly what it was (scheduleSampleTurn
// below answers 'real'). Apply goes through the host's own commit; the
// 'schedule.edit.applied' signal fires only after that commit reports success
// (components/copilot/ScheduleEditPanel.tsx).
//
// No tier gate: the schedule tab and its editor are on every plan (the tab's
// only schedule_gantt_pdf check is the Schedule Pro door), so the practice pass
// opens nothing here. Data plus two pure helpers; imports types and fixtures only.

import type { CopyCtx, PayloadRecord, TutorialDef } from '../types';
import { SCHEDULE_SAMPLE, type SampleMoveOp } from '../fixtures';

const SCHED = { pathname: '/schedule', projectParam: 'projectId' } as const;
const HUB = { pathname: '/project-detail', projectParam: 'id' } as const;

/** What the editor says when he types his own words on the sample mid-run. */
export const SCHEDULE_SAMPLE_REFUSAL = 'On the sample, use the sample sentence. Your own changes run on a real job.';

/** The sample sentence on a sample whose schedule has no drywall task (the
 *  sandbox writes one, so this is a stale sample): nothing to move. */
export const SCHEDULE_SAMPLE_NO_TASK = 'This sample schedule has no drywall task to move.';

/** One turn of the schedule editor, decided BEFORE any AI call.
 *  'real'   — not a live run on a sample: the real turn (relay + meter).
 *  'sample' — the bundled answer; the relay is never called.
 *  'refuse' — his own words on the sample during the run: nothing is called. */
export type ScheduleSampleTurn =
  | { kind: 'real' }
  | { kind: 'sample'; ops: SampleMoveOp[] }
  | { kind: 'refuse'; why: 'words' | 'noTask'; reason: string };

/** Pure. `runOnSample` is true only when a tutorial run is live on THIS
 *  project AND the project is a sample (the screen checks both). */
export function scheduleSampleTurn(
  text: string,
  runOnSample: boolean,
  tasks: readonly { id: string; title: string }[],
): ScheduleSampleTurn {
  if (!runOnSample) return { kind: 'real' };
  if (SCHEDULE_SAMPLE.normalize(text) !== SCHEDULE_SAMPLE.normalize(SCHEDULE_SAMPLE.sentence)) {
    return { kind: 'refuse', why: 'words', reason: SCHEDULE_SAMPLE_REFUSAL };
  }
  const ops = SCHEDULE_SAMPLE.ops(tasks.map(t => ({ id: t.id, name: t.title })));
  return ops.length > 0 ? { kind: 'sample', ops } : { kind: 'refuse', why: 'noTask', reason: SCHEDULE_SAMPLE_NO_TASK };
}

/** The 'schedule.edit.applied' payload from a commit that LANDED: the tasks
 *  as they were, the tasks the commit wrote, and the CPM finish of each (the
 *  panel runs runCpm with the host's calendar). `moved` counts tasks whose own
 *  start changed; `deltaDays` is their shift when they all moved by one amount
 *  (absent otherwise — the copy then names no number). Pure. */
export function scheduleAppliedPayload(
  before: readonly { id: string; startDay: number }[],
  after: readonly { id: string; startDay: number }[],
  finishBefore: number,
  finishAfter: number,
): { moved: number; deltaDays?: number; finishShiftDays?: number } {
  const was = new Map(before.map(t => [t.id, t.startDay] as const));
  const shifts: number[] = [];
  for (const t of after) {
    const s = was.get(t.id);
    if (s !== undefined && s !== t.startDay) shifts.push(t.startDay - s);
  }
  const one = shifts.length > 0 && shifts.every(d => d === shifts[0]) ? shifts[0] : undefined;
  const finish = Number.isFinite(finishBefore) && Number.isFinite(finishAfter) ? finishAfter - finishBefore : undefined;
  return {
    moved: shifts.length,
    ...(one !== undefined ? { deltaDays: one } : {}),
    ...(finish !== undefined ? { finishShiftDays: finish } : {}),
  };
}

const days = (n: number) => `${n} day${Math.abs(n) === 1 ? '' : 's'}`;

function applied(p: PayloadRecord) {
  return p['schedule.edit.applied'];
}

function finishLine(ctx: CopyCtx): string {
  const f = applied(ctx.payloads)?.finishShiftDays;
  if (typeof f !== 'number') return 'Saved to the sample schedule.';
  if (f === 0) return 'The finish date held.';
  return f > 0 ? `The finish date moved ${days(f)} later.` : `The finish date moved ${days(-f)} earlier.`;
}

export const scheduleSayIt: TutorialDef = {
  id: 'schedule-say-it',
  version: 1,
  title: 'Move a task by saying it',
  seconds: 35,
  endsWith: 'Drywall moved 2 days and the finish date updated',
  group: 'schedule',
  personas: ['contractor', 'both'],
  // The editor writes outside a field seat's schedule door.
  fieldSeatOk: false,
  sandbox: 'sarahs-place',
  needs: ['schedule'],
  practiceFeatures: [],
  start: {
    // focus + classic: a fresh arrival nonce selects the sample on the tab,
    // and classic === focus keeps desktop Pro users on this screen
    // (utils/scheduleRoute.classicRedirect). from=job draws the phone's
    // back-to-the-job link the last do step uses.
    pathname: '/schedule',
    params: id => {
      const nonce = `tutorial-${Date.now().toString(36)}`;
      return { projectId: id, focus: nonce, classic: nonce, from: 'job' };
    },
  },
  steps: [
    {
      id: 'schedule-open',
      kind: 'do',
      route: SCHED,
      target: 'schedule.sayIt',
      text: '{Tap} Tell me what to change',
      detail: 'Say a change in plain words. You see the ripple before anything moves.',
      gesture: 'tap',
      until: { mounted: 'scheduleEdit.input' },
      checkpoint: true,
    },
    {
      id: 'schedule-say',
      kind: 'do',
      route: SCHED,
      layer: 'scheduleEdit',
      target: 'scheduleEdit.input',
      text: 'Use the sample sentence, then {tap} Continue',
      detail: 'Push drywall 2 days — board delivery slipped. The sample uses no AI credits.',
      gesture: 'tap',
      until: { signal: 'schedule.edit.previewed' },
      assist: 'schedule.useSampleSentence',
    },
    {
      id: 'schedule-diff',
      kind: 'look',
      route: SCHED,
      layer: 'scheduleEdit',
      target: 'scheduleEdit.diff',
      text: 'This is the ripple, before anything moves.',
      detail: 'Each task that shifts is listed, with the new finish date.',
      gesture: 'none',
    },
    {
      id: 'schedule-apply',
      kind: 'do',
      route: SCHED,
      layer: 'scheduleEdit',
      target: 'scheduleEdit.apply',
      text: '{Tap} Apply to save the change',
      detail: 'It saves to the sample schedule only. Undo is on the next card.',
      gesture: 'tap',
      until: { signal: 'schedule.edit.applied' },
      success: {
        title: ctx => {
          const d = applied(ctx.payloads)?.deltaDays;
          return typeof d === 'number' && d > 0 ? `Drywall moved ${days(d)}` : 'Schedule changed';
        },
        sub: finishLine,
      },
    },
    {
      id: 'schedule-back',
      kind: 'do',
      route: SCHED,
      target: 'schedule.backToJob',
      text: "{Tap} the job's name to go back",
      // Shown once the editor's card is closed (Done): while its sheet is up
      // the scheduleEdit layer is mounted and this root step draws nothing.
      // The link is the phone's (HiddenTabBackLink draws none on a desktop,
      // where the card offers Skip and Resume takes him to the job).
      detail: 'The change is saved on the sample schedule.',
      gesture: 'tap',
      until: { route: HUB },
    },
    {
      id: 'schedule-result',
      kind: 'look',
      route: HUB,
      target: ['hub.tile.schedule', 'hub.group.field'],
      text: 'The schedule lives here on the job.',
      textByTarget: { 'hub.group.field': 'The schedule is under Field Ops.' },
      detail: "Open it to see drywall's new dates.",
      gesture: 'none',
    },
  ],
  stat: {
    signal: 'schedule.edit.applied',
    lead: 'Schedule changed in',
    extras: p => {
      const f = applied(p)?.finishShiftDays;
      return [typeof f === 'number' && f !== 0 ? `finish ${f > 0 ? '+' : '−'}${days(Math.abs(f))}` : null];
    },
  },
  handoff: {
    pathname: '/schedule',
    projectParam: 'projectId',
    realJobLabel: name => `Change ${name}'s schedule →`,
    roles: ['owner', 'editor'],
  },
};
