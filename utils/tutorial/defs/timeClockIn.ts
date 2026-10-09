// defs/timeClockIn.ts — "Clock your crew in and out".
//
// The real time clock (app/time-tracking.tsx) on the SAMPLE job: clock one
// person from his crew list in, watch the clock run, clock them out with the
// slide. Time Tracking is Business (subcontractor_management); Free and Pro
// practise it on the sample through the practice pass.
//
// SAMPLE HOURS NEVER REACH PAY OR THE COST BOOK. A shift on a sample project is
// skipped by utils/laborSamples (isSampleTimeEntry: computeLaborStats and
// buildLaborSamples, the cost book's feed) and by utils/timeClockPayroll
// (selectPayrollEntries and buildTimeEntriesCSV, the payroll export), and it
// counts toward nobody's overtime. scripts/validate-tutorial-learn-c.ts pins it.
//
// The crew sheet and the clock-out sheet are layer-less modals: on iOS they
// draw above the root tutorial layer, so while one is up the screen mounts the
// 'time.modalUp' sentinel and the coach draws nothing (the invoice send sheet's
// pattern). The do steps therefore light the button that OPENS each sheet and
// complete on the real write behind it.
//
// No crew on his list: the first step lights the same button as 'time.noCrew'
// and says "Add your crew first"; the sheet's own Add crew button is the way
// to the crew screen, and nothing is written. Data only.

import type { CopyCtx, TutorialDef } from '../types';

const TT = { pathname: '/time-tracking', projectParam: 'projectId' } as const;
const HUB = { pathname: '/project-detail', projectParam: 'id' } as const;

function hoursText(ctx: CopyCtx): string | null {
  const h = ctx.payloads['time.clockedOut']?.hours;
  if (typeof h !== 'number' || !Number.isFinite(h) || h < 0) return null;
  const mins = Math.round(h * 60);
  if (mins < 60) return `${mins} min`;
  const hh = Math.floor(mins / 60);
  const mm = mins % 60;
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}

export const timeClockIn: TutorialDef = {
  id: 'time-clock-in',
  version: 1,
  title: 'Clock Your Crew In and Out',
  seconds: 40,
  endsWith: 'A shift on the sample that never reaches payroll',
  group: 'site',
  personas: ['contractor', 'both'],
  fieldSeatOk: true,
  sandbox: 'sarahs-place',
  needs: [],
  practiceFeatures: ['subcontractor_management'],
  start: {
    // No clockIn=1: the crew sheet is a layer-less modal, so opening it on
    // arrival would hide the coach before the first card is read.
    pathname: '/time-tracking',
    params: id => ({ projectId: id }),
    stackUnder: { pathname: '/project-detail', params: id => ({ id }) },
  },
  steps: [
    {
      id: 'time-clock-in',
      kind: 'do',
      route: TT,
      target: ['time.clockIn', 'time.noCrew'],
      text: '{Tap} Clock In Crew, then pick one person',
      textByTarget: { 'time.noCrew': 'Add your crew first' },
      detail: 'The time clock clocks in people from your crew list.',
      gesture: 'tap',
      until: { signal: 'time.clockedIn' },
      checkpoint: true,
      success: {
        title: ctx => {
          const n = ctx.payloads['time.clockedIn']?.count;
          return typeof n === 'number' && n > 1 ? `${n} clocked in` : 'Clocked in';
        },
        sub: () => 'The clock is running on the sample job.',
      },
    },
    {
      id: 'time-running',
      kind: 'look',
      route: TT,
      target: 'time.running',
      text: 'The clock runs here, net of breaks.',
      detail: 'Sample hours stay out of payroll and your labor rates.',
      gesture: 'none',
    },
    {
      id: 'time-clock-out',
      kind: 'do',
      route: TT,
      target: 'time.clockOut',
      text: '{Tap} Clock Out, then slide to confirm',
      detail: 'The slide records the hours at the moment you let go.',
      gesture: 'tap',
      until: { signal: 'time.clockedOut' },
      success: {
        title: ctx => {
          const h = hoursText(ctx);
          return h ? `Clocked out · ${h}` : 'Clocked out';
        },
        sub: () => 'A shift on the sample that never reaches payroll.',
      },
    },
    {
      id: 'time-result',
      kind: 'look',
      route: HUB,
      target: ['hub.tile.timeTracking', 'hub.group.field'],
      text: 'The time clock lives here on the job.',
      textByTarget: { 'hub.group.field': 'The time clock is under Field Ops.' },
      detail: 'On a real job, finished shifts go to payroll export and your labor rates.',
      gesture: 'none',
    },
  ],
  stat: {
    signal: 'time.clockedOut',
    lead: 'Shift logged in',
  },
  handoff: {
    pathname: '/time-tracking',
    projectParam: 'projectId',
    params: { clockIn: '1' },
    realJobLabel: name => `Clock In Crew on ${name}`,
    feature: 'subcontractor_management',
    paywallLabel: 'Time Tracking Comes with Business: See Plans',
    roles: ['owner', 'editor', 'field'],
  },
};
