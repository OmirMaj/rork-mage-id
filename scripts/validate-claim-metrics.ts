// validate-claim-metrics.ts — pins the two Phase-1 claim-defense metrics.
//
// Both exist because a number computed the obvious way loses the case.
//
// 1. RFI OWNER-SIDE HOLD TIME (utils/rfiHoldTime.ts)
//    Caddell Constr. Co. v. United States (Fed. Cl. 2007): the claimant
//    measured RFI turnaround "including the time the RFIs were in Caddell's
//    hands" and lost on it. Round-trip age is not a delay measure. The
//    claimable number is the summed time a NON-GC party held the ball, folded
//    from the append-only RFIHandoff chain. A subcontractor is the GC's own
//    tier, so sub time is tracked and deliberately kept OUT of the owner-side
//    figure — lumping it in would be the same defect one level down.
//
// 2. DAILY-LOG COMPLETION (utils/dailyLogCompletion.ts)
//    FRE 803(6)(C) — routineness — is where daily logs die (Meltech Corp.,
//    ASBCA No. 61765: the PM "did not 'make[] a habit of noting'" problems).
//    "Self-serving" is expressly NOT a ground for exclusion, so the metric is
//    completion over expected working days, not report quality. A report that
//    records "nothing happened" is a COMPLETION. A Sunday on a 5-day job is
//    not a miss. And nothing may reward backfilling, because a report written
//    after the fact is not contemporaneous (Vistas Construction, ASBCA Nos.
//    58479-58488: it "essentially re-wrote these documents").
//
// Pure node:fs for the wiring checks — no bundler, no react-native import.
// Run: bun run scripts/validate-claim-metrics.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { RFI } from '../types';
import {
  computeRfiHoldTime, summarizeRfiHoldTime, holdSideOf, OWNER_SIDE_PARTIES,
} from '../utils/rfiHoldTime';
import { computeRFILatency } from '../utils/rfiLatency';
import {
  computeDailyLogCompletion, isNoWorkReport, isExpectedWorkingDay, localDayKey,
  dailyLogHeadline, dailyLogEmptyDayLine, dailyLogGapLine, dailyLogTodayLine,
  type DailyLogReport,
} from '../utils/dailyLogCompletion';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS ', name); }
  else { fail++; console.log('  FAIL ', name, detail ? `\n        ${detail}` : ''); }
}

const utc = (d: string) => `${d}T00:00:00Z`;
const ms = (d: string) => Date.parse(utc(d));

// ═══════════════════════════════════════════════════════════════════════════
// JOB 1 — RFI owner/architect hold time
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nRFI owner-side hold time (never round-trip):');

// ── The party mapping is the whole claim. Pin it. ───────────────────────────
ok('owner side is architect, engineer, owner — and only those',
  OWNER_SIDE_PARTIES.length === 3
  && OWNER_SIDE_PARTIES.includes('architect')
  && OWNER_SIDE_PARTIES.includes('engineer')
  && OWNER_SIDE_PARTIES.includes('owner'),
  `got [${OWNER_SIDE_PARTIES.join(', ')}]`);

ok('a sub is NOT owner side',
  !OWNER_SIDE_PARTIES.includes('sub') && holdSideOf('sub') === 'sub',
  'a subcontractor is the GC\'s own tier; counting its time against the owner is the Caddell defect one level down');
ok('the GC is not owner side', holdSideOf('gc') === 'gc');
ok('a closed RFI holds for nobody', holdSideOf('closed') === 'none');

// ── 1. Hold time excludes GC-held periods ──────────────────────────────────
// gc holds Jun 1-3 (2d), architect holds Jun 3-13 (10d), gc holds Jun 13-16 (3d).
const simple = computeRfiHoldTime({
  status: 'closed',
  dateSubmitted: utc('2026-06-01'),
  dateResponded: utc('2026-06-13'),
  handoffs: [
    { at: utc('2026-06-01'), fromParty: 'gc', toParty: 'gc', note: 'RFI created' },
    { at: utc('2026-06-03'), fromParty: 'gc', toParty: 'architect', note: 'Sent' },
    { at: utc('2026-06-13'), fromParty: 'architect', toParty: 'gc', note: 'Response received' },
    { at: utc('2026-06-16'), fromParty: 'gc', toParty: 'closed', note: 'RFI closed by GC' },
  ],
}, { nowMs: ms('2026-06-20') });

ok('hold time counts only the architect-held interval', simple.ownerSideDays === 10, `got ${simple.ownerSideDays}, expected 10`);
ok('GC-held days are captured separately, not in the claim', simple.gcDays === 5, `got ${simple.gcDays}, expected 5`);
ok('round-trip elapsed is larger than owner-side hold',
  simple.elapsedDays === 12 && simple.elapsedDays > simple.ownerSideDays,
  `elapsed ${simple.elapsedDays}, hold ${simple.ownerSideDays}`);
ok('a closed RFI is not accruing', simple.accruing === false);
ok('sub days are zero when no sub ever held it', simple.subDays === 0);

// ── 2. Multiple bounces sum correctly ──────────────────────────────────────
// arch 3d + arch 4d + owner 5d = 12 owner-side; gc 2 + 1 + 2 + 2 = 7.
const bounced = computeRfiHoldTime({
  status: 'closed',
  dateSubmitted: utc('2026-06-01'),
  dateResponded: utc('2026-06-18'),
  handoffs: [
    { at: utc('2026-06-01'), fromParty: 'gc', toParty: 'gc' },
    { at: utc('2026-06-03'), fromParty: 'gc', toParty: 'architect' },
    { at: utc('2026-06-06'), fromParty: 'architect', toParty: 'gc' },
    { at: utc('2026-06-07'), fromParty: 'gc', toParty: 'architect' },
    { at: utc('2026-06-11'), fromParty: 'architect', toParty: 'gc' },
    { at: utc('2026-06-13'), fromParty: 'gc', toParty: 'owner' },
    { at: utc('2026-06-18'), fromParty: 'owner', toParty: 'gc' },
    { at: utc('2026-06-20'), fromParty: 'gc', toParty: 'closed' },
  ],
}, { nowMs: ms('2026-06-30') });

ok('three separate owner-side holds sum (3 + 4 + 5)', bounced.ownerSideDays === 12, `got ${bounced.ownerSideDays}`);
ok('four separate GC holds sum (2 + 1 + 2 + 2)', bounced.gcDays === 7, `got ${bounced.gcDays}`);
// Custody is a partition: every day between the first handoff and the last
// segment's end belongs to exactly one side. (Here the chain runs two days
// past dateResponded because the GC sat on the answer before closing it, so
// the custody span is 19 while the round-trip elapsed is 17.)
ok('custody partitions the whole span with nothing double-counted',
  bounced.ownerSideDays + bounced.gcDays + bounced.subDays === 19,
  `owner ${bounced.ownerSideDays} + gc ${bounced.gcDays} + sub ${bounced.subDays}`);
ok('the claim figure is strictly smaller than round-trip whenever the GC held it at all',
  bounced.ownerSideDays < bounced.elapsedDays,
  `hold ${bounced.ownerSideDays} vs elapsed ${bounced.elapsedDays}`);
ok('every custody interval is recorded', bounced.segments.length === 8, `got ${bounced.segments.length}`);
ok('no interval is negative', bounced.segments.every(s => s.days >= 0));

// ── 3. Legacy rows with no handoff chain ───────────────────────────────────
const legacy = computeRfiHoldTime({
  status: 'answered',
  dateSubmitted: utc('2026-06-01'),
  dateResponded: utc('2026-06-11'),
  handoffs: undefined,
}, { nowMs: ms('2026-06-20') });

ok('a legacy RFI with no chain is NOT measurable', legacy.measurable === false);
ok('an unmeasurable RFI reports zero, and the caller must read it as unknown',
  legacy.ownerSideDays === 0 && legacy.gcDays === 0 && legacy.subDays === 0);
ok('round-trip elapsed still computes without a chain', legacy.elapsedDays === 10, `got ${legacy.elapsedDays}`);

const emptyChain = computeRfiHoldTime({
  status: 'open', dateSubmitted: utc('2026-06-01'), handoffs: [],
}, { nowMs: ms('2026-06-11') });
ok('an empty handoff array is treated the same as a missing one', emptyChain.measurable === false);

// A chain that exists but was never sent is measurable, and the honest answer
// is that the owner has held it for zero days.
const neverSent = computeRfiHoldTime({
  status: 'open',
  dateSubmitted: utc('2026-06-01'),
  handoffs: [{ at: utc('2026-06-01'), fromParty: 'gc', toParty: 'gc', note: 'RFI created' }],
}, { nowMs: ms('2026-06-11') });
ok('a never-sent RFI is measurable and owner-side is genuinely zero',
  neverSent.measurable === true && neverSent.ownerSideDays === 0 && neverSent.gcDays === 10,
  `measurable=${neverSent.measurable} owner=${neverSent.ownerSideDays} gc=${neverSent.gcDays}`);

// ── 4. Still-open RFIs accrue to now ───────────────────────────────────────
const openRfi = {
  status: 'open' as const,
  dateSubmitted: utc('2026-06-01'),
  handoffs: [
    { at: utc('2026-06-01'), fromParty: 'gc' as const, toParty: 'gc' as const },
    { at: utc('2026-06-03'), fromParty: 'gc' as const, toParty: 'architect' as const },
  ],
};
const openAt10 = computeRfiHoldTime(openRfi, { nowMs: ms('2026-06-10') });
const openAt20 = computeRfiHoldTime(openRfi, { nowMs: ms('2026-06-20') });
ok('an open RFI accrues owner-side days to now', openAt10.ownerSideDays === 7, `got ${openAt10.ownerSideDays}`);
ok('the same open RFI accrues further ten days later', openAt20.ownerSideDays === 17, `got ${openAt20.ownerSideDays}`);
ok('an open owner-side hold reports as accruing', openAt10.accruing === true);

const openBallBack = computeRfiHoldTime({
  status: 'open',
  dateSubmitted: utc('2026-06-01'),
  handoffs: [
    { at: utc('2026-06-01'), fromParty: 'gc', toParty: 'architect' },
    { at: utc('2026-06-08'), fromParty: 'architect', toParty: 'gc' },
  ],
}, { nowMs: ms('2026-06-20') });
ok('an open RFI sitting in the GC\'s court does NOT accrue owner-side days',
  openBallBack.ownerSideDays === 7 && openBallBack.accruing === false && openBallBack.gcDays === 12,
  `owner=${openBallBack.ownerSideDays} accruing=${openBallBack.accruing} gc=${openBallBack.gcDays}`);

// A resolved RFI must not keep accruing against `now`.
const resolvedNoTerminalHandoff = computeRfiHoldTime({
  status: 'answered',
  dateSubmitted: utc('2026-06-01'),
  dateResponded: utc('2026-06-09'),
  handoffs: [{ at: utc('2026-06-01'), fromParty: 'gc', toParty: 'architect' }],
}, { nowMs: ms('2026-12-31') });
ok('a resolved RFI stops accruing at the response, not at today',
  resolvedNoTerminalHandoff.ownerSideDays === 8,
  `got ${resolvedNoTerminalHandoff.ownerSideDays}, expected 8`);

// ── 5. The sub-party decision, on real data ────────────────────────────────
const subOnly = computeRfiHoldTime({
  status: 'closed',
  dateSubmitted: utc('2026-06-01'),
  dateResponded: utc('2026-06-09'),
  handoffs: [
    { at: utc('2026-06-01'), fromParty: 'gc', toParty: 'sub', note: 'Routed to framer' },
    { at: utc('2026-06-09'), fromParty: 'sub', toParty: 'gc' },
  ],
}, { nowMs: ms('2026-06-20') });
ok('eight days held by a sub add ZERO to the owner-side figure', subOnly.ownerSideDays === 0, `got ${subOnly.ownerSideDays}`);
ok('sub-held days are still counted and reported', subOnly.subDays === 8, `got ${subOnly.subDays}`);
ok('sub time is not silently merged into the GC bucket either', subOnly.gcDays === 0, `got ${subOnly.gcDays}`);

const mixed = computeRfiHoldTime({
  status: 'closed',
  dateSubmitted: utc('2026-06-01'),
  dateResponded: utc('2026-06-11'),
  handoffs: [
    { at: utc('2026-06-01'), fromParty: 'gc', toParty: 'architect' },
    { at: utc('2026-06-05'), fromParty: 'architect', toParty: 'sub' },
    { at: utc('2026-06-11'), fromParty: 'sub', toParty: 'gc' },
  ],
}, { nowMs: ms('2026-06-20') });
ok('a mixed chain splits owner-side from sub time', mixed.ownerSideDays === 4 && mixed.subDays === 6,
  `owner=${mixed.ownerSideDays} sub=${mixed.subDays}`);
ok('an engineer counts as owner side',
  computeRfiHoldTime({
    status: 'closed', dateSubmitted: utc('2026-06-01'), dateResponded: utc('2026-06-06'),
    handoffs: [
      { at: utc('2026-06-01'), fromParty: 'gc', toParty: 'engineer' },
      { at: utc('2026-06-06'), fromParty: 'engineer', toParty: 'gc' },
    ],
  }, { nowMs: ms('2026-06-20') }).ownerSideDays === 5);

// ── Defensive: an out-of-order chain must not produce negative time ────────
const outOfOrder = computeRfiHoldTime({
  status: 'closed',
  dateSubmitted: utc('2026-06-01'),
  dateResponded: utc('2026-06-11'),
  handoffs: [
    { at: utc('2026-06-11'), fromParty: 'architect', toParty: 'gc' },
    { at: utc('2026-06-01'), fromParty: 'gc', toParty: 'architect' },
  ],
}, { nowMs: ms('2026-06-20') });
ok('an out-of-order chain is sorted, not miscounted',
  outOfOrder.ownerSideDays === 10 && outOfOrder.segments.every(s => s.days >= 0),
  `got ${outOfOrder.ownerSideDays}`);

// ── Aggregate: unmeasurable RFIs are excluded, never zero-filled ───────────
const summary = summarizeRfiHoldTime([
  { status: 'closed', dateSubmitted: utc('2026-06-01'), dateResponded: utc('2026-06-13'),
    handoffs: [
      { at: utc('2026-06-01'), fromParty: 'gc', toParty: 'architect' },
      { at: utc('2026-06-13'), fromParty: 'architect', toParty: 'gc' },
    ] },
  { status: 'closed', dateSubmitted: utc('2026-06-01'), dateResponded: utc('2026-06-05'),
    handoffs: [
      { at: utc('2026-06-01'), fromParty: 'gc', toParty: 'owner' },
      { at: utc('2026-06-05'), fromParty: 'owner', toParty: 'gc' },
    ] },
  { status: 'answered', dateSubmitted: utc('2026-06-01'), dateResponded: utc('2026-06-20'), handoffs: undefined },
], { nowMs: ms('2026-06-30') });

ok('the aggregate counts only RFIs with a handoff log', summary.measuredCount === 2, `got ${summary.measuredCount}`);
ok('legacy RFIs are reported as excluded, not folded in as zero', summary.unmeasurableCount === 1, `got ${summary.unmeasurableCount}`);
ok('owner-side days total across RFIs (12 + 4)', summary.totalOwnerSideDays === 16, `got ${summary.totalOwnerSideDays}`);
ok('the longest single hold is surfaced', summary.maxOwnerSideDays === 12, `got ${summary.maxOwnerSideDays}`);
ok('the fact line says the GC\'s own turnaround is excluded',
  !!summary.factLine && /excluded/i.test(summary.factLine), summary.factLine ?? 'null');
ok('the fact line discloses the excluded legacy RFIs',
  !!summary.factLine && /no handoff log/i.test(summary.factLine), summary.factLine ?? 'null');
ok('an all-legacy project produces no hold fact line at all',
  summarizeRfiHoldTime([{ status: 'open', dateSubmitted: utc('2026-06-01') }]).factLine === null);

// ── The two numbers must stay distinguishable in the shared summary ────────
const baseRFI: RFI = {
  id: 'r1', projectId: 'p1', number: 1, subject: 'S', question: 'Q',
  submittedBy: 'gc', assignedTo: 'architect', status: 'closed', priority: 'normal',
  attachments: [], dateSubmitted: utc('2026-06-01'), dateRequired: utc('2026-06-10'),
  dateResponded: utc('2026-06-13'),
  handoffs: [
    { at: utc('2026-06-01'), fromParty: 'gc', toParty: 'gc' },
    { at: utc('2026-06-03'), fromParty: 'gc', toParty: 'architect' },
    { at: utc('2026-06-13'), fromParty: 'architect', toParty: 'gc' },
  ],
  createdAt: utc('2026-06-01'), updatedAt: utc('2026-06-01'),
};
const latency = computeRFILatency([baseRFI, { ...baseRFI, id: 'r2' }], { nowMs: ms('2026-06-30') });
ok('computeRFILatency still reports round-trip median', latency.medianResponseDays === 12, `got ${latency.medianResponseDays}`);
ok('computeRFILatency now also reports owner-side hold', latency.hold.totalOwnerSideDays === 20, `got ${latency.hold.totalOwnerSideDays}`);
ok('the round-trip line and the hold line are different strings',
  !!latency.factLine && !!latency.holdFactLine && latency.factLine !== latency.holdFactLine);
ok('the hold line is labelled owner-side so it cannot be read as round-trip',
  !!latency.holdFactLine && /owner-side hold/i.test(latency.holdFactLine), latency.holdFactLine ?? 'null');


// ═══════════════════════════════════════════════════════════════════════════
// JOB 2 — Daily-log completion over working days
// ═══════════════════════════════════════════════════════════════════════════
console.log('\ndaily-log completion (a filed dead day is a completion):');

// 2026-06-01 is a Monday. Jun 1-5 and Jun 8-12 are weekdays; Jun 6-7 a weekend.
const at = (d: string) => `${d}T12:00:00`;           // local noon — TZ-stable
const workday = (d: string): DailyLogReport => ({
  date: at(d),
  manpower: [{ id: 'm', trade: 'Framing', company: 'Acme', headcount: 4, hoursWorked: 8 }],
  photos: [],
  materialsDelivered: [],
});
const deadDay = (d: string): DailyLogReport => ({
  date: at(d), manpower: [], photos: [], materialsDelivered: [],
});
const WEEKDAYS = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05',
  '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12'];
const CAL5 = { workingDaysPerWeek: 5 };
const TODAY = at('2026-06-12');

// ── "nothing happened" classification ──────────────────────────────────────
ok('a report with no crew, no progress, no materials, no photos is a no-work day',
  isNoWorkReport(deadDay('2026-06-03')) === true);
ok('free text does not make a day a work day — "rain, no work" is still a dead day',
  isNoWorkReport({
    ...deadDay('2026-06-03'),
    workPerformed: 'Rain all day. No work on site.',
    issuesAndDelays: 'Site flooded at the south footing.',
  }) === true);
ok('crew on site means it is not a no-work day', isNoWorkReport(workday('2026-06-03')) === false);
ok('a zero-headcount manpower row does not fake a work day',
  isNoWorkReport({ date: at('2026-06-03'), manpower: [{ id: 'm', trade: 'x', company: 'y', headcount: 0, hoursWorked: 0 }] }) === true);
ok('a photo counts as something documented',
  isNoWorkReport({ date: at('2026-06-03'), manpower: [], photos: [{ id: 'p', uri: 'file://x', timestamp: at('2026-06-03'), caption: '' } as never] }) === false);
ok('a material delivery counts as something happening',
  isNoWorkReport({ date: at('2026-06-03'), manpower: [], materialsDelivered: ['20 sheets 5/8 drywall'] }) === false);
ok('a blank material string does not count as a delivery',
  isNoWorkReport({ date: at('2026-06-03'), manpower: [], materialsDelivered: ['   '] }) === true);

// ── A "nothing happened" report is a COMPLETION, not a gap ─────────────────
const withDeadDay = computeDailyLogCompletion({
  reports: WEEKDAYS.map(d => (d === '2026-06-03' ? deadDay(d) : workday(d))),
  calendar: CAL5,
  todayISO: TODAY,
});
ok('an empty report counts as a completion, not a gap',
  withDeadDay.filedDays === 10 && withDeadDay.missedDays === 0,
  `filed=${withDeadDay.filedDays} missed=${withDeadDay.missedDays}`);
ok('the dead day does not break the streak', withDeadDay.currentStreak === 10, `got ${withDeadDay.currentStreak}`);
ok('dead days are counted separately so the surface can say they count',
  withDeadDay.emptyDayFilings === 1, `got ${withDeadDay.emptyDayFilings}`);
ok('a fully covered stretch reads as complete', withDeadDay.completionRate === 1);

// ── Non-working days are never misses ──────────────────────────────────────
ok('Saturday is not expected on a 5-day week', isExpectedWorkingDay('2026-06-06', CAL5) === false);
ok('Sunday is not expected on a 5-day week', isExpectedWorkingDay('2026-06-07', CAL5) === false);
ok('Sunday IS expected on a 7-day project', isExpectedWorkingDay('2026-06-07', { workingDaysPerWeek: 7 }) === true);
ok('a weekday is expected by default', isExpectedWorkingDay('2026-06-03') === true);
ok('a scheduled closure is never expected',
  isExpectedWorkingDay('2026-06-10', { workingDaysPerWeek: 5, nonWorkingDates: ['2026-06-10'] }) === false);

ok('an unlogged weekend produces no misses',
  withDeadDay.missedDays === 0 && withDeadDay.expectedDays === 10,
  `expected=${withDeadDay.expectedDays} missed=${withDeadDay.missedDays}`);

const withHoliday = computeDailyLogCompletion({
  reports: WEEKDAYS.filter(d => d !== '2026-06-10').map(workday),
  calendar: { workingDaysPerWeek: 5, nonWorkingDates: ['2026-06-10'] },
  todayISO: TODAY,
});
ok('an unlogged site-closure day is not a miss',
  withHoliday.missedDays === 0 && withHoliday.expectedDays === 9,
  `expected=${withHoliday.expectedDays} missed=${withHoliday.missedDays}`);
ok('a closure does not break the streak either', withHoliday.currentStreak === 9, `got ${withHoliday.currentStreak}`);

// ── A gap is detected correctly ────────────────────────────────────────────
const withGap = computeDailyLogCompletion({
  reports: WEEKDAYS.filter(d => d !== '2026-06-10').map(workday),
  calendar: CAL5,
  todayISO: TODAY,
});
ok('a skipped working day is a miss', withGap.missedDays === 1, `got ${withGap.missedDays}`);
ok('the missed day is named', withGap.missedDates[0] === '2026-06-10', `got ${withGap.missedDates[0]}`);
ok('the streak restarts after the gap', withGap.currentStreak === 2, `got ${withGap.currentStreak}`);
ok('the longest run before the gap is kept', withGap.longestStreak === 7, `got ${withGap.longestStreak}`);
ok('the completion rate reflects the hole', Math.round(withGap.completionRate * 100) === 90,
  `got ${Math.round(withGap.completionRate * 100)}`);
ok('the gap line states the fact', /no log/i.test(dailyLogGapLine(withGap) ?? ''), dailyLogGapLine(withGap) ?? 'null');
ok('the gap line says filing late does not close the gap',
  /does not close it/i.test(dailyLogGapLine(withGap) ?? ''), dailyLogGapLine(withGap) ?? 'null');
ok('no gap line when the record is unbroken', dailyLogGapLine(withDeadDay) === null);

// ── Today is not a miss until the day is over ──────────────────────────────
const todayUnfiled = computeDailyLogCompletion({
  reports: WEEKDAYS.filter(d => d !== '2026-06-12').map(workday),
  calendar: CAL5,
  todayISO: TODAY,
});
ok('today counts as expected but not yet as a miss',
  todayUnfiled.todayExpected === true && todayUnfiled.todayFiled === false && todayUnfiled.missedDays === 0,
  `expected=${todayUnfiled.todayExpected} filed=${todayUnfiled.todayFiled} missed=${todayUnfiled.missedDays}`);
ok('an in-progress today is excluded from the closed-day denominator',
  todayUnfiled.closedExpectedDays === 9, `got ${todayUnfiled.closedExpectedDays}`);
ok('today\'s prompt appears when today is owed',
  /Today has no log yet/.test(dailyLogTodayLine(todayUnfiled) ?? ''), dailyLogTodayLine(todayUnfiled) ?? 'null');
ok('today\'s prompt says a dead day is still worth filing',
  /still the day to record/i.test(dailyLogTodayLine(todayUnfiled) ?? ''), dailyLogTodayLine(todayUnfiled) ?? 'null');
ok('no prompt once today is filed', dailyLogTodayLine(withDeadDay) === null);

const saturdayToday = computeDailyLogCompletion({
  reports: WEEKDAYS.map(workday),
  calendar: CAL5,
  todayISO: at('2026-06-13'),
});
ok('a Saturday is never prompted for on a 5-day job',
  saturdayToday.todayExpected === false && dailyLogTodayLine(saturdayToday) === null);

// ── Window and record-start honesty ────────────────────────────────────────
ok('no reports at all means there is no record to grade',
  computeDailyLogCompletion({ reports: [], calendar: CAL5, todayISO: TODAY }).hasRecord === false);

const lateAdopter = computeDailyLogCompletion({
  reports: ['2026-06-11', '2026-06-12'].map(workday),
  calendar: CAL5,
  startDateISO: '2026-04-01',
  todayISO: TODAY,
});
ok('the window never reaches back before the first filed report',
  lateAdopter.windowStart === '2026-06-11' && lateAdopter.missedDays === 0,
  `windowStart=${lateAdopter.windowStart} missed=${lateAdopter.missedDays}`);

const multiSameDay = computeDailyLogCompletion({
  reports: [deadDay('2026-06-11'), workday('2026-06-11'), workday('2026-06-12')],
  calendar: CAL5,
  todayISO: TODAY,
});
ok('two reports on one day count as one filed day',
  multiSameDay.filedDays === 2 && multiSameDay.emptyDayFilings === 0,
  `filed=${multiSameDay.filedDays} empty=${multiSameDay.emptyDayFilings}`);

ok('a bare YYYY-MM-DD is not shifted a day by timezone', localDayKey('2026-06-01') === '2026-06-01');
ok('a local timestamp resolves to its local day', localDayKey(at('2026-06-01')) === '2026-06-01');

// ── The headline states the number ─────────────────────────────────────────
const headline = dailyLogHeadline(withDeadDay);
ok('the headline states coverage over working days',
  headline === 'Daily log covers 10 of 10 working days.', headline ?? 'null');
ok('the empty-day line says those days count',
  /count/i.test(dailyLogEmptyDayLine(withDeadDay) ?? ''), dailyLogEmptyDayLine(withDeadDay) ?? 'null');
ok('no headline before there is a record', dailyLogHeadline(computeDailyLogCompletion({ reports: [], todayISO: TODAY })) === null);

// ═══════════════════════════════════════════════════════════════════════════
// HOUSE VOICE — this is evidentiary hygiene, not a game
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nhouse voice (no gamification):');

const ALL_COPY = [
  headline,
  dailyLogEmptyDayLine(withDeadDay),
  dailyLogGapLine(withGap),
  dailyLogTodayLine(todayUnfiled),
  summary.factLine,
  latency.holdFactLine,
].filter((s): s is string => typeof s === 'string');

ok('every generated line is non-empty', ALL_COPY.length === 6, `got ${ALL_COPY.length} of 6`);
ok('no generated line uses hype punctuation',
  ALL_COPY.every(s => !s.includes('!')),
  ALL_COPY.find(s => s.includes('!')));

const HYPE = /\b(congrat|awesome|amazing|great job|nice work|keep it up|well done|you rock|badge|trophy|streak|points|score|level up|unlocked)\b/i;
const hypeHit = ALL_COPY.find(s => HYPE.test(s));
ok('no generated line gamifies the record', !hypeHit, hypeHit);

const card = read('components/home/DailyLogCard.tsx');
ok('the home card does not gamify', !HYPE.test(card.replace(/^\s*\/\/.*$/gm, '')));
ok('the home card self-hides when there is nothing to act on', /if \(rows\.length === 0\) return null;/.test(card));

// ═══════════════════════════════════════════════════════════════════════════
// WIRING — a metric nobody sees is not a feature
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nsurfaces:');

const rfiScreen = read('app/rfi.tsx');
ok('the RFI screen computes hold time', /computeRfiHoldTime/.test(rfiScreen));
ok('the RFI screen labels the owner-side hold', /Owner side held it/.test(rfiScreen));
ok('the RFI screen labels the round-trip figure as round trip', /round trip/i.test(rfiScreen));
ok('the RFI screen states that a sub\'s time is the GC\'s side', /sub/i.test(rfiScreen) && /not theirs/i.test(rfiScreen));
ok('the RFI screen says an RFI with no chain is unknown, not zero', /unknown, not zero/i.test(rfiScreen));
ok('the overdue banner carries the hold figure', /Owner side has held it/.test(rfiScreen));

const facts = read('utils/oneMind/factBlocks.ts');
ok('the brain\'s RFI fact block carries the hold line', /holdFactLine/.test(facts));

const detail = read('app/project-detail.tsx');
ok('the project\'s Daily Reports section shows the standing number', /computeDailyLogCompletion/.test(detail));
ok('the project screen renders the record block', /dfr-record-block/.test(detail));

const home = read('app/(tabs)/(home)/index.tsx');
ok('the home screen mounts the daily-log card', /<DailyLogCard \/>/.test(home));

const dfr = read('app/daily-report.tsx');
ok('filing a dead day is one tap', /handleFileNoWorkDay/.test(dfr));
ok('the dead-day path files zero crew rather than inventing any',
  /manpower: \[\],\n\s*workPerformed: text,/.test(dfr));
ok('the dead-day shortcut only offers itself on an untouched new report',
  /showNoWorkShortcut = !existingReport/.test(dfr));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
