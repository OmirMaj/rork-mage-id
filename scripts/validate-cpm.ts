// scripts/validate-cpm.ts — invariants for the CPM engine and the two DAY-NUMBER
// SCALES it lives between. Run: bun run test:cpm-invariants
//
// scripts/test-cpm.ts already covers the textbook network, cycles, link types
// and calendars. This file guards the things that were WRONG on 2026-09-07 and
// that a passing typecheck cannot see:
//
//   1. A stored WORKING ORDINAL becomes the right CALENDAR INDEX, and the
//      round trip is stable. (Typing "Mon Mar 16" stored ordinal 11 and the
//      engine planned Thu Mar 12.)
//   2. Rendering cpm.es/ef as a plain calendar date agrees with the engine, and
//      Start + Duration = Finish holds on every row by eye.
//   3. freeFloat <= totalFloat — the CPM invariant. Both are WORKING days.
//      (A(3)->B(2)->C(2) on a 5-day week reported B as "TF 0 / FF 2".)
//   4. Total float is not inflated by the weekends inside the float window.
//      (A task that can really slide Thu→Wed reported 6 days, not 4.)
//   5. The levelling preview's finish is the POST-levelling one.
//      (Three 5-day tasks on one crew: modal said "unchanged", applying moved
//      the finish from day 5 to day 19.)
//   6. Levelling never puts a Mon-Fri crew on a Saturday, and sees a task
//      assigned through `resourceIds`.
//   7. A hard date pin that the logic cannot satisfy is REPORTED.
//   8. Negative free float is surfaced, not floored to 0.
//   9. The grid label, the Gantt bar and the printed bar all resolve from the
//      SAME cpm row — and the components are still WIRED to it (§10 greps the
//      call sites, because the failure this campaign keeps hitting is a change
//      that lands in one renderer and not the others while typechecking fine).
//  10. A summary bar spans its own children, and summary rows stay out of the
//      on-screen critical-path chain (the printed report has always filtered
//      them, so the two surfaces used to disagree).
//  11. Persisting a scheduled plan is a FIXED POINT — writing cpm.es back onto
//      startDay without converting inflates the plan on the next run.
//  12. The printed PM report tells one story: no phantom baseline variance, the
//      Critical Path table and the Gantt table agree, slip is in working days,
//      and the header does not advertise a data date the engine lacks.
//  13. Last Planner windows come from the SCHEDULE, not the authored pin.
//
// Pure functions only — no React, no I/O, no network.

import {
  runCpm, runCpmForCalendar, workingOrdinalToCalendarIndex, calendarIndexToWorkingOrdinal,
  calendarDayToDate, dateToCalendarDay, workingDaysInSpan, workingDaysBetween,
  stampCriticalPath,
} from '../utils/cpm';
import {
  scheduleDayNumberFor, captureBaseline, diffAgainstBaseline, reflowFromActuals,
  buildSharePayload, tryEncodeShareToken, decodeShareToken,
  cpmOptionsFromSharePayload, tasksFromSharePayload,
} from '../utils/scheduleOps';
import { addWorkingDays } from '../utils/scheduleEngine';
import { buildCriticalPathExplanation } from '../utils/floatExplain';
import { computeSummaryRollup } from '../utils/summaryRollup';
import { assembleScheduleReport } from '../utils/scheduleReportModel';
import { renderScheduleReportHtml } from '../utils/scheduleReportHtml';
import { buildScheduledStartDays, taskWindow } from '../utils/lastPlanner';
import type { ScheduleTask } from '../types';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
}

const ISO = '2026-03-02';                 // a Monday
const START = new Date(2026, 2, 2);       // the same Monday, local
const CAL = { scheduleStartDate: ISO, workingDaysPerWeek: 5 };
const SCALE = { scheduleStartDate: ISO, workingDaysPerWeek: 5 };

function T(id: string, dur: number, deps: string[] = [], extra: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id, title: id, phase: '', durationDays: dur, startDay: 1, progress: 0, crew: '',
    dependencies: deps, notes: '', status: 'not_started', ...extra,
  } as ScheduleTask;
}
const d = (calendarIndex: number) => calendarDayToDate(START, calendarIndex).toDateString();

console.log('\nCPM engine invariants:');

// ── 1. The two scales ───────────────────────────────────────────────────────
console.log('\n1. working ordinal ↔ calendar index');
{
  // The 11th working day from Mon Mar 2 on a Mon-Fri week is Mon Mar 16.
  eq('ordinal 11 → calendar index 15', workingOrdinalToCalendarIndex(11, SCALE), 15);
  eq('  …and index 15 is Mon Mar 16', d(15), new Date(2026, 2, 16).toDateString());
  eq('ordinal 1 is index 1', workingOrdinalToCalendarIndex(1, SCALE), 1);
  eq('the round trip is stable', calendarIndexToWorkingOrdinal(workingOrdinalToCalendarIndex(11, SCALE), SCALE), 11);

  // The converter must agree with addWorkingDays, the renderer that pairs with
  // the working scale everywhere else in the app (getTaskDateRange, the CSV
  // export, icsGenerator). If these two ever drift, one of those exports is
  // silently dating tasks wrong.
  //
  // FIVE-DAY WEEK ONLY, and that is deliberate. The two helpers disagree about
  // what a SIX-day week is: utils/cpm.isWorkingDay treats wd === 6 as Mon–SAT
  // (a documented 2026 fix — collapsing every `< 7` to "skip Sat and Sun"
  // computed a 6-day schedule as a 5-day one), while
  // scheduleEngine.addWorkingDays still skips Saturday for ANY wd < 7. So on a
  // 6-day project the engine schedules Saturdays the CSV/.ics renderer refuses
  // to count — measured: ordinal 6 from Mon 2026-03-02 is Sat Mar 7 to the
  // engine and Mon Mar 9 to addWorkingDays. That is a real defect, but it lives
  // in scheduleEngine.ts, which this wave is explicitly forbidden to touch —
  // see the handoff note. Asserting the 6-day case as "expected to differ"
  // would turn a bug green, so it is left un-asserted and written down instead.
  let agree = true;
  for (let n = 1; n <= 40; n++) {
    const viaConverter = calendarDayToDate(START, workingOrdinalToCalendarIndex(n, SCALE)).toDateString();
    const viaRenderer = addWorkingDays(START, n - 1, 5).toDateString();
    if (viaConverter !== viaRenderer) { agree = false; console.log(`      ordinal ${n}: ${viaConverter} vs ${viaRenderer}`); break; }
  }
  ok('workingOrdinalToCalendarIndex matches scheduleEngine.addWorkingDays for 40 ordinals (5-day week)', agree);

  // The converter has to hold on the calendars the engine supports, not only
  // the default one — and on a schedule whose own start date is a non-working
  // day, which is reachable from the date picker.
  eq('6-day week: ordinal 6 is Sat Mar 7 (the engine works Saturdays)',
    d(workingOrdinalToCalendarIndex(6, { scheduleStartDate: ISO, workingDaysPerWeek: 6 })),
    new Date(2026, 2, 7).toDateString());
  eq('7-day week: the ordinal IS the calendar index',
    workingOrdinalToCalendarIndex(23, { scheduleStartDate: ISO, workingDaysPerWeek: 7 }), 23);
  {
    // Start on Sat 2026-03-07, Mon-Fri week. Ordinal 1 is index 1 by
    // convention (walkWorkingDays cannot count a start it is standing on), and
    // ordinal 2 must be the first REAL working day, Mon Mar 9 = index 3.
    const satScale = { scheduleStartDate: '2026-03-07', workingDaysPerWeek: 5 };
    eq('a schedule anchored on a Saturday still resolves its second ordinal to Monday',
      workingOrdinalToCalendarIndex(2, satScale), 3);
  }
  {
    // A closure is a non-working day like any other: ordinal 3 must step over it.
    const closed = { scheduleStartDate: ISO, workingDaysPerWeek: 5, nonWorkingDates: ['2026-03-04'] };
    eq('a closure consumes a calendar index without consuming an ordinal',
      d(workingOrdinalToCalendarIndex(3, closed)), new Date(2026, 2, 5).toDateString());
  }

  // A non-working index snaps back to the last working day, so a bar dropped
  // on a Saturday does not invent a weekend ordinal.
  eq('Saturday index 6 snaps to Friday ordinal 5', calendarIndexToWorkingOrdinal(6, SCALE), 5);

  eq('dateToCalendarDay inverts calendarDayToDate', dateToCalendarDay(START, calendarDayToDate(START, 23)), 23);
  eq('a Mon-Fri week has 10 working days in a 14-day span', workingDaysInSpan(1, 14, SCALE), 10);
}

// ── 2. A pinned start lands where it was typed ──────────────────────────────
console.log('\n2. a pinned start lands on the day it was authored');
{
  // Typing "Mon Mar 16" into the grid stores working ordinal 11
  // (scheduleOps.scheduleDayNumberFor). The engine must plan it on Mar 16.
  const r = runCpm([T('P', 3, [], { startDay: 11 })], CAL);
  const p = r.perTask.get('P')!;
  eq('startDay 11 → ES on Mon Mar 16', d(p.es), new Date(2026, 2, 16).toDateString());
  eq('  …and EF on Wed Mar 18', d(p.ef), new Date(2026, 2, 18).toDateString());
}

// ── 3. Rendering the engine's output ────────────────────────────────────────
console.log('\n3. Start + Duration = Finish on every row');
{
  const tasks = [T('A', 10), T('B', 5, ['A']), T('C', 5, ['B'])];
  const r = runCpm(tasks, CAL);
  eq('A finishes Fri Mar 13', d(r.perTask.get('A')!.ef), new Date(2026, 2, 13).toDateString());
  eq('B runs Mon Mar 16 → Fri Mar 20',
    `${d(r.perTask.get('B')!.es)}|${d(r.perTask.get('B')!.ef)}`,
    `${new Date(2026, 2, 16).toDateString()}|${new Date(2026, 2, 20).toDateString()}`);
  eq('C runs Mon Mar 23 → Fri Mar 27',
    `${d(r.perTask.get('C')!.es)}|${d(r.perTask.get('C')!.ef)}`,
    `${new Date(2026, 2, 23).toDateString()}|${new Date(2026, 2, 27).toDateString()}`);

  // The eye-check a scheduler does: the working days between the printed Start
  // and the printed Finish must equal the Duration column.
  let consistent = true;
  for (const t of tasks) {
    const row = r.perTask.get(t.id)!;
    if (workingDaysInSpan(row.es, row.ef, SCALE) !== t.durationDays) {
      consistent = false;
      console.log(`      ${t.id}: span ${workingDaysInSpan(row.es, row.ef, SCALE)} vs duration ${t.durationDays}`);
    }
  }
  ok('every row satisfies Start + Duration = Finish on the activity calendar', consistent);
}

// ── 4. Float units ──────────────────────────────────────────────────────────
console.log('\n4. free float ≤ total float, both in working days');
{
  const chain = [T('A', 3), T('B', 2, ['A']), T('C', 2, ['B'])];
  const rc = runCpm(chain, CAL);
  const b = rc.perTask.get('B')!;
  eq('a pure chain gives B TF 0 / FF 0', `${b.totalFloat}/${b.freeFloat}`, '0/0');

  const diamond = [T('A', 2), T('B', 3, ['A']), T('C', 5, ['A']), T('D', 4, ['B', 'C'])];
  const rd = runCpm(diamond, CAL);
  const db = rd.perTask.get('B')!;
  eq('the diamond gives B TF 2 / FF 2 on a 5-day week', `${db.totalFloat}/${db.freeFloat}`, '2/2');
  const d7 = runCpm(diamond, { scheduleStartDate: ISO, workingDaysPerWeek: 7 }).perTask.get('B')!;
  eq('  …matching the 7-day control', `${d7.totalFloat}/${d7.freeFloat}`, '2/2');

  // The invariant itself, over a fixture that spans several weekends.
  const wide = [T('Y', 8), T('X', 1, [], { startDay: 4 }), T('Z', 1, ['Y', 'X'])];
  const rw = runCpm(wide, CAL);
  let holds = true;
  rw.perTask.forEach((row, id) => {
    if (row.freeFloat > row.totalFloat) { holds = false; console.log(`      ${id}: FF ${row.freeFloat} > TF ${row.totalFloat}`); }
  });
  ok('freeFloat ≤ totalFloat for every task', holds);

  // X sits on Thu and can slide to the following Wed: Fri, Mon, Tue, Wed = 4
  // WORKING days. The raw index difference was 6.
  eq('a float window spanning a weekend reports working days, not calendar days',
    rw.perTask.get('X')!.totalFloat, 4);

  // ── The invariant, fuzzed ────────────────────────────────────────────────
  // Three hand-built fixtures are not a proof: the units bug produced FF > TF
  // on 629 of 4,909 rows of randomly generated FS chains on a 5-day week, and
  // any of these three could have missed it. This walks 1,500 random networks
  // across all three calendars and both a Monday and a Saturday anchor.
  //
  // SCOPE, and it is a real limit rather than a convenience: the invariant is
  // asserted over FS links with lag >= 0 — which is 100% of what the wizard,
  // the AI generator and every shipped template emit, and what DCMA #2/#4 tell
  // a contractor to keep it to. It does NOT hold universally, and that is not
  // this fix: a lead, an SS/FF/SF link or a hard pin can floor a successor's ES
  // above what its own link requires, and then "how far can this task slip
  // before its successor moves" (free float) genuinely exceeds "how far before
  // the project finish moves" (total float). Measured against the pre-change
  // engine on a 7-day week — where the two day-scales coincide and this fix is
  // a no-op by construction — those cases were 357/4,876 before and 357/4,876
  // after: untouched, pre-existing, and a property of constraints rather than
  // of units. See the notFixed entry.
  {
    const mulberry = (a: number) => () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let rows = 0; let violations = 0; let firstBad = '';
    for (const start of [ISO, '2026-03-07']) {
      for (const wd of [5, 6, 7]) {
        for (let seed = 0; seed < 250; seed++) {
          const rnd = mulberry(seed * 13 + wd);
          const n = 3 + Math.floor(rnd() * 6);
          const net: ScheduleTask[] = [];
          for (let i = 0; i < n; i++) {
            const deps: string[] = [];
            const links: { taskId: string; type: 'FS'; lagDays: number }[] = [];
            for (let j = 0; j < i; j++) {
              if (rnd() < 0.4) {
                deps.push(`t${j}`);
                links.push({ taskId: `t${j}`, type: 'FS', lagDays: Math.floor(rnd() * 4) });
              }
            }
            net.push(T(`t${i}`, 1 + Math.floor(rnd() * 10), deps, {
              startDay: 1 + Math.floor(rnd() * 6),
              dependencyLinks: links.length ? links : undefined,
            }));
          }
          const res = runCpm(net, { scheduleStartDate: start, workingDaysPerWeek: wd });
          if (res.perTask.size === 0) continue;
          for (const t of net) {
            const row = res.perTask.get(t.id)!;
            rows++;
            if (row.freeFloat > row.totalFloat) {
              violations++;
              if (!firstBad) firstBad = `${start} wd${wd} seed${seed} ${t.id}: FF ${row.freeFloat} > TF ${row.totalFloat}`;
            }
          }
        }
      }
    }
    ok(`freeFloat ≤ totalFloat across ${rows} fuzzed FS rows on 5/6/7-day weeks`,
      violations === 0, firstBad);
  }

  // …and the documented exception, asserted rather than left as folklore, so a
  // future reader does not "fix" it back into a clamp. A(5d) is critical (it
  // sets the finish) yet its SS successor is PINNED three working days out, so
  // A really can slip 3 days without moving B: FF 3 with TF 0 is the honest
  // pair, and clamping either one would hide a real fact.
  {
    const pinned = runCpm([
      T('A', 5),
      T('B', 2, ['A'], { startDay: 4, dependencyLinks: [{ taskId: 'A', type: 'SS', lagDays: 0 }] }),
    ], CAL);
    const a = pinned.perTask.get('A')!;
    ok('a pin on a successor can legitimately put free float above total float',
      a.freeFloat > a.totalFloat, { tf: a.totalFloat, ff: a.freeFloat });
  }
}

// ── 5. Negative free float is not hidden ────────────────────────────────────
console.log('\n5. negative free float surfaces');
{
  const r = runCpm([
    T('P', 10),
    T('S', 2, ['P'], { anchorType: 'must-start-on', anchorDate: '2026-03-04' }),
  ], CAL);
  ok('a successor pinned inside its predecessor gives P negative free float',
    r.perTask.get('P')!.freeFloat < 0, r.perTask.get('P')!.freeFloat);
}

// ── 6. Hard constraints are reported ────────────────────────────────────────
console.log('\n6. an unsatisfiable hard pin is reported');
{
  const r = runCpm([
    T('P', 10),
    T('S', 2, ['P'], { anchorType: 'must-start-on', anchorDate: '2026-03-04' }),
  ], CAL);
  const anchorConflicts = r.conflicts.filter(c => c.kind === 'anchor_violation');
  ok('must-start-on inside a predecessor emits an anchor_violation', anchorConflicts.length === 1,
    r.conflicts.map(c => c.message));
  ok('  …and the message names the gap in working days',
    /\d+ working day\(s\)/.test(anchorConflicts[0]?.message ?? ''), anchorConflicts[0]?.message);

  // must-finish-on on a Saturday: reachable, and it must NOT blame dependencies
  // that do not exist.
  const sat = runCpm([
    T('P', 2),
    T('S', 2, [], { anchorType: 'must-finish-on', anchorDate: '2026-03-07' }),
  ], CAL);
  const satMsg = sat.conflicts.find(c => c.kind === 'anchor_violation')?.message ?? '';
  ok('a must-finish-on on a non-working day is reported', satMsg.length > 0);
  ok('  …and does NOT blame dependencies it does not have',
    !/dependencies/.test(satMsg) && /non-working day/.test(satMsg), satMsg);

  // The OTHER half of the must-finish-on case, and the one that hurts: the
  // predecessors physically cannot deliver by the pinned finish. The forward
  // pass walks ES back FROM the anchor, so `r.ef` is forced EQUAL to the anchor
  // and the old `r.ef !== clamp.efExact` test was dead code for exactly this
  // shape. Measured before the fix: S landed Mar 5-6, INSIDE P's Mar 2-13 span,
  // and runCpm reported `conflicts: []`.
  const mfo = runCpm([
    T('P', 10),
    T('S', 2, ['P'], { anchorType: 'must-finish-on', anchorDate: '2026-03-06' }),
  ], CAL);
  const mfoMsg = mfo.conflicts.find(c => c.kind === 'anchor_violation')?.message ?? '';
  ok('an unsatisfiable must-finish-on emits an anchor_violation', mfoMsg.length > 0, mfo.conflicts);
  ok('  …and the message names the gap in working days',
    /\d+ working day\(s\)/.test(mfoMsg), mfoMsg);
  ok('  …and the fixture really is one where the pin wins and the row looks fine',
    mfo.perTask.get('S')!.ef === 5 && mfo.perTask.get('S')!.es < mfo.perTask.get('P')!.ef,
    { S: mfo.perTask.get('S'), P: mfo.perTask.get('P') });

  // …and the FALSE POSITIVE the must-start-on branch shipped with. `depEs` used
  // to be seeded from the authored pin rather than from the dependency network,
  // so a task with NO predecessors at all — every wizard/AI row carries a
  // startDay — accused predecessors that do not exist the moment a user pinned
  // it earlier than the day it was authored on.
  const lone = runCpm([
    T('S', 2, [], { startDay: 5, anchorType: 'must-start-on', anchorDate: '2026-03-03' }),
  ], CAL);
  eq('a must-start-on pin on a task with no predecessors reports nothing',
    lone.conflicts.map(c => c.message), []);
  eq('  …and the pin still wins over the stale authored startDay',
    d(lone.perTask.get('S')!.es), new Date(2026, 2, 3).toDateString());

  // …and the same false positive WITH a predecessor, which is what isolates the
  // seed from the gate. P finishes Tue Mar 3, so the logic can deliver S by its
  // Thu Mar 5 pin — nothing is wrong. But S also carries a late authored
  // startDay (ordinal 15), and folding that into the dependency basis makes the
  // engine accuse predecessors that are, in fact, early.
  const satisfiable = runCpm([
    T('P', 2),
    T('S', 2, ['P'], { startDay: 15, anchorType: 'must-start-on', anchorDate: '2026-03-05' }),
  ], CAL);
  ok('the fixture really is satisfiable — P finishes before the pin',
    satisfiable.perTask.get('P')!.ef < satisfiable.perTask.get('S')!.es,
    { P: satisfiable.perTask.get('P')!.ef, S: satisfiable.perTask.get('S')!.es });
  eq('a satisfiable must-start-on with a LATE authored pin reports nothing',
    satisfiable.conflicts.filter(c => c.kind === 'anchor_violation').map(c => c.message), []);

  // The `hasIncomingLink` gate earns its keep on ONE shape that the "seed depEs
  // at 1" rule alone does not cover: an anchor date BEFORE the schedule start,
  // which computeAnchor maps to a calendar index below 1. Then `depEs` (1) is
  // greater than `esExact` on a task with no predecessors at all, and without
  // the gate the engine blames feeding work that does not exist.
  const early = runCpm([
    T('S', 2, [], { anchorType: 'must-start-on', anchorDate: '2026-02-20' }),
  ], CAL);
  ok('the fixture really does pin before day 1', early.perTask.get('S')!.es < 1,
    early.perTask.get('S')!.es);
  eq('a pin before the schedule start on a task with no predecessors reports nothing',
    early.conflicts.map(c => c.message), []);
}

// ── 7. Levelling ────────────────────────────────────────────────────────────
console.log('\n7. resource levelling');
{
  const crew = (id: string) => T(id, 5, [], { crew: 'framers' });
  const tasks = [crew('A'), crew('B'), crew('C')];
  const lev = runCpm(tasks, { ...CAL, levelResources: true });
  const applied = tasks.map(t => ({ ...t, startDay: lev.leveledStartDays!.get(t.id)! }));
  const truth = runCpm(applied, CAL).projectFinish;
  eq('leveledProjectFinish is the finish you actually get', lev.leveledProjectFinish, truth);
  ok('  …and it is NOT the unlevelled finish', lev.leveledProjectFinish !== lev.projectFinish,
    { levelled: lev.leveledProjectFinish, unlevelled: lev.projectFinish });

  // Levelling must move the second task PAST the first on the working calendar.
  // Asserting only "the levelled start is not a Saturday" is not enough: the
  // ordinal round trip snaps a Saturday back to the Friday before it, so a
  // leveller that walks raw calendar days looks clean while stacking both
  // tasks on the same Friday — which is the overlap it was asked to remove.
  // The first task must SPAN A WEEKEND (6 working days from a Monday finishes
  // the following Monday), or a leveller that computes its end cursor as a raw
  // `start + dur - 1` lands the second task on top of the first and the test
  // never notices.
  const pairTasks = [
    T('R1', 6, [], { crew: 'framers' }),
    T('R2', 3, [], { crew: 'framers' }),
  ];
  const sat2 = runCpm(pairTasks, { ...CAL, levelResources: true });
  const settled = runCpm(
    pairTasks.map(t => ({ ...t, startDay: sat2.leveledStartDays!.get(t.id)! })),
    CAL,
  );
  const r1 = settled.perTask.get('R1')!, r2 = settled.perTask.get('R2')!;
  ok('the levelled pair no longer overlaps on the calendar',
    r1.ef < r2.es || r2.ef < r1.es, { r1: [r1.es, r1.ef], r2: [r2.es, r2.ef] });
  let allWorking = true;
  for (const row of [r1, r2]) {
    const dow = calendarDayToDate(START, row.es).getDay();
    if (dow === 0 || dow === 6) { allWorking = false; console.log(`      start ${d(row.es)}`); }
  }
  ok('no levelled start lands on a weekend for a Mon-Fri crew', allWorking);

  // And the case where the busy cursor lands on a FRIDAY, so a raw `+1` cursor
  // hands the crew a Saturday. Both fixtures are needed: the 6d/3d pair above
  // catches a raw END span, this 5d/5d pair catches a raw NEXT-DAY step.
  const fridayPair = [
    T('F1', 5, [], { crew: 'roofers' }),
    T('F2', 5, [], { crew: 'roofers' }),
  ];
  const fridayLev = runCpm(fridayPair, { ...CAL, levelResources: true });
  const fridaySettled = runCpm(
    fridayPair.map(t => ({ ...t, startDay: fridayLev.leveledStartDays!.get(t.id)! })),
    CAL,
  );
  const f1 = fridaySettled.perTask.get('F1')!, f2 = fridaySettled.perTask.get('F2')!;
  ok('a Friday-ending predecessor pushes its crew-mate to MONDAY, not Saturday',
    (f1.ef < f2.es || f2.ef < f1.es)
    && ![f1.es, f2.es].some(e => [0, 6].includes(calendarDayToDate(START, e).getDay())),
    { f1: [d(f1.es), d(f1.ef)], f2: [d(f2.es), d(f2.ef)] });

  // resourceIds — the field schedule-pro builds per-task calendars from — has
  // to be a levelling resource too, or work assigned through the resource
  // picker is invisible to "Fix overloads".
  const byResource = runCpm([
    T('S1', 5, [], { resourceIds: ['res-1'] }),
    T('S2', 5, [], { resourceIds: ['res-1'] }),
  ], { ...CAL, levelResources: true });
  ok('a task assigned through resourceIds is levelled',
    byResource.leveledStartDays!.get('S2') !== 1, [...byResource.leveledStartDays!.entries()]);

  // Levelling must reason about where CPM SCHEDULES a task, not where it was
  // pinned. P→Q already separates these two tile tasks in time; a leveller that
  // seeds from `startDay` sees them both sitting on day 1, "resolves" an
  // overlap that does not exist, and hands the user a shift list of phantoms.
  const separated = [
    T('P', 5),
    T('Q', 5, ['P'], { crew: 'tile' }),
    T('RR', 5, [], { crew: 'tile' }),
  ];
  const sepRes = runCpm(separated, { ...CAL, levelResources: true });
  eq('a dependency already separates two same-crew tasks → nothing is moved',
    [...sepRes.leveledStartDays!.entries()].filter(([, v]) => v !== 1).length, 0);

  // A delay bigger than the task's float has to be called out as moving the
  // end date, not filed as a routine overallocation.
  const overFloat = runCpm([
    T('R1', 5, [], { crew: 'framers' }),
    T('R2', 5, [], { crew: 'framers' }),
    T('AFTER', 2, ['R2']),
  ], { ...CAL, levelResources: true });
  ok('consuming more float than exists is reported as pushing the finish',
    overFloat.conflicts.some(c => c.kind === 'resource_delayed_project'),
    overFloat.conflicts.map(c => c.message));

  // Untouched tasks keep their EXACT authored startDay. The fixture has to
  // include a task whose scheduled ES differs from its pin (BYSTANDER is pushed
  // to day 13 by a 10-day predecessor while its own startDay stays 1) or a
  // leveller that writes back everyone's scheduled position passes anyway — and
  // summarizeLeveling then reports a shift nobody made.
  const mixed = [
    T('LEAD', 10),
    T('BYSTANDER', 3, ['LEAD']),
    T('Z1', 5, [], { crew: 'movers' }),
    T('Z2', 5, [], { crew: 'movers' }),
  ];
  const noop = runCpm(mixed, { ...CAL, levelResources: true });
  eq('a dependency-pushed task that levelling never touched keeps its authored startDay',
    noop.leveledStartDays!.get('BYSTANDER'), 1);
  ok('  …while the task levelling DID move reports a new one',
    noop.leveledStartDays!.get('Z2') !== 1, [...noop.leveledStartDays!.entries()]);
}

// ── 8. The critical path is the engine's, not a stored guess ────────────────
console.log('\n8. stampCriticalPath');
{
  const tasks = [
    T('A', 10, [], { isCriticalPath: false }),
    T('B', 2, [], { isCriticalPath: true }),   // parallel + short = NOT critical
  ];
  const r = runCpm(tasks, CAL);
  const stamped = stampCriticalPath(tasks, r);
  eq('the real critical task is flagged', stamped.find(t => t.id === 'A')!.isCriticalPath, true);
  eq('the guessed one is cleared', stamped.find(t => t.id === 'B')!.isCriticalPath, false);

  // A cycle makes perTask empty. Stamping from that would tell the client
  // portal the job has no critical path at all.
  const cyclic = [T('A', 1, ['B']), T('B', 1, ['A'])];
  const cyclicRes = runCpm(cyclic, CAL);
  ok('a cycle leaves the last known-good flags alone', stampCriticalPath(cyclic, cyclicRes) === cyclic);
}

// ── 9. The grid and the Gantt must date the same task the same way ──────────
// These two panes sit side by side in the default 'split' layout, so any
// disagreement between them is the first thing a user sees.
//
// 2026-09-11: this section USED to compute `calendarDayToDate(START, row.es)`
// twice, call one of them "grid" and the other "bar", and assert they were
// equal. That is a tautology — it could not fail for any input, and it was
// green while the shipped grid was up to six days out and printed a Saturday
// finish on a Mon-Fri job. The bug was never in the RENDERER; it was in the
// engine run BEHIND the renderer: GridPane called `runCpm(tasks)` with no
// options at all, so es/ef came back as raw working ordinals which the
// calendar renderer then added as calendar days.
//
// So the grid side now goes through `runCpmForCalendar` — the SAME exported
// function GridPane.tsx calls — and the Gantt/print side through the
// calendar-aware run schedule-pro builds. §10 greps that GridPane still calls
// it (a grep is the right tool for "is it still wired", and the wrong tool for
// "is the wiring correct", which is what this section measures).
console.log('\n9. grid ↔ Gantt parity');
{
  const tasks = [T('A', 10), T('B', 5, ['A']), T('C', 5, ['B'])];
  // The Gantt / schedule-pro side.
  const r = runCpm(tasks, CAL);
  // The GRID side, composed exactly as components/schedule/GridPane.tsx does.
  const gridCpm = runCpmForCalendar(tasks, START, 5, []);
  let parity = true;
  for (const t of tasks) {
    const row = r.perTask.get(t.id)!;
    const gridRow = gridCpm.perTask.get(t.id)!;
    // GridPane: renderCalendarDate(cpmRow.es / cpmRow.ef)
    const gridStart = calendarDayToDate(START, gridRow.es).toDateString();
    const gridFinish = calendarDayToDate(START, gridRow.ef).toDateString();
    // InteractiveGantt: x = (calStart - 1) * pxPerDay on a calendar axis whose
    // column d is addDays(projectStartDate, d - 1); gutter label uses the same.
    const barStart = calendarDayToDate(START, row.es).toDateString();
    const barFinish = calendarDayToDate(START, row.ef).toDateString();
    // printableGanttHtml: barX = LABEL_W + (es - 1) * px, span = ef - es + 1
    const printSpan = row.ef - row.es + 1;
    if (gridStart !== barStart || gridFinish !== barFinish || printSpan < t.durationDays) {
      parity = false;
      console.log(`      ${t.id}: grid ${gridStart}→${gridFinish} vs bar ${barStart}→${barFinish}`);
    }
  }
  ok('grid label, Gantt bar and print bar all resolve to the same dates', parity);

  // The "by eye" test a superintendent actually applies to a grid row, run on
  // the GRID's own engine result: Start + Duration must equal Finish. With
  // `runCpm(tasks)` this read 8 / 3 / 4 for tasks of 10 / 5 / 5 days.
  let spansMatch = true;
  for (const t of tasks) {
    const gridRow = gridCpm.perTask.get(t.id)!;
    const span = workingDaysInSpan(gridRow.es, gridRow.ef, SCALE);
    if (span !== t.durationDays) {
      spansMatch = false;
      console.log(`      ${t.id}: durationDays ${t.durationDays} but the row spans ${span} working days`);
    }
  }
  ok('every grid row satisfies Start + Duration = Finish on the grid\'s own cpm', spansMatch);

  // And the concrete dates, which is what the 2026-09-07 audit reported.
  eq('the grid dates A / B / C exactly as the engine does',
    tasks.map(t => {
      const g = gridCpm.perTask.get(t.id)!;
      return `${d(g.es)}→${d(g.ef)}`;
    }),
    [
      `${new Date(2026, 2, 2).toDateString()}→${new Date(2026, 2, 13).toDateString()}`,
      `${new Date(2026, 2, 16).toDateString()}→${new Date(2026, 2, 20).toDateString()}`,
      `${new Date(2026, 2, 23).toDateString()}→${new Date(2026, 2, 27).toDateString()}`,
    ]);

  // A closure, from GridPane's own `nonWorkingDates` prop doc: "a grid that
  // ignores them puts every task after a closure one working day early".
  {
    const START2 = new Date(2026, 8, 7);          // Mon Sep 7
    const CAL2 = { scheduleStartDate: '2026-09-07', workingDaysPerWeek: 5, nonWorkingDates: ['2026-09-08'] };
    const one = [T('X', 1, [], { startDay: 6 })];
    const gridRow = runCpmForCalendar(one, START2, 5, ['2026-09-08']).perTask.get('X')!;
    eq('a closure moves the grid row too — startDay 6 is Tue Sep 15, not Sat Sep 12',
      calendarDayToDate(START2, gridRow.es).toDateString(),
      calendarDayToDate(START2, runCpm(one, CAL2).perTask.get('X')!.es).toDateString());
    eq('  …and that date is Tue Sep 15',
      calendarDayToDate(START2, gridRow.es).toDateString(), new Date(2026, 8, 15).toDateString());
  }

  // ── The grid's date CELLS commit without corrupting anything ──────────────
  // Opening Start or Finish and accepting the date already shown must produce
  // an EMPTY patch. B is pinned at ordinal 6 but pushed to 11 by A, which is
  // the case that used to rewrite durationDays behind the user's back.
  {
    const pinned = [
      T('A', 10, [], { startDay: 1 }),
      T('B', 5, ['A'], { startDay: 6 }),
      T('C', 5, ['B'], { startDay: 16 }),
    ];
    const gcpm = runCpmForCalendar(pinned, START, 5, []);
    const patches: string[] = [];
    for (const t of pinned) {
      const row = gcpm.perTask.get(t.id)!;
      // beginEdit seeds from renderCalendarIso(es/ef); commitEdit re-reads it
      // through dateToDayNumber (= scheduleOps.scheduleDayNumberFor) and
      // compares against calendarToOrdinal(es).
      const shownOrdinal = calendarIndexToWorkingOrdinal(row.es, SCALE);
      const startCommit = scheduleDayNumberFor(START, calendarDayToDate(START, row.es), 5, []);
      const finishCommit = scheduleDayNumberFor(START, calendarDayToDate(START, row.ef), 5, []);
      if (startCommit !== shownOrdinal) patches.push(`${t.id}: startDay ${shownOrdinal}→${startCommit}`);
      const reDur = finishCommit - shownOrdinal + 1;
      if (reDur !== t.durationDays) patches.push(`${t.id}: durationDays ${t.durationDays}→${reDur}`);
    }
    eq('re-committing the Start and Finish a dependency-pushed row already shows writes nothing',
      patches, []);
  }

  // ── What the calendar-aware run actually buys the grid ───────────────────
  // Worth spelling out, because the 2026-09-07 audit's headline ("the grid
  // printed Tue Mar 17 against an engine finish of Fri Mar 13") does NOT
  // reproduce: rendered the way it was actually composed — `runCpm(tasks)`
  // (raw-day mode) through `addWorkingDays` — the pre-change grid AGREED with
  // the engine on plain FS chains and on closures, because in raw mode es/ef
  // are working ordinals and addWorkingDays is the matching renderer.
  //
  // The real cost of running the engine with no options is everything the
  // calendar unlocks. Each of these is a case where the grid row and the Gantt
  // bar next to it disagreed.
  {
    const raw = (t: ScheduleTask[]) => runCpm(t);
    // 1. Anchors are DROPPED without a scheduleStartDate (see computeAnchor).
    const anchored = [T('A', 5), T('P', 3, [], { startDay: 2, anchorType: 'must-start-on', anchorDate: '2026-03-23' })];
    eq('raw-day mode ignores a must-start-on anchor entirely',
      raw(anchored).perTask.get('P')!.es, 2);
    eq('  …the calendar-aware grid run honours it — Mon Mar 23',
      d(runCpmForCalendar(anchored, START, 5, []).perTask.get('P')!.es),
      new Date(2026, 2, 23).toDateString());

    // 2. criticalFloatThresholdDays — the near-critical highlight.
    const near = [T('LONG', 20), T('NEAR', 18), T('END', 1, ['LONG', 'NEAR'])];
    eq('raw-day mode cannot honour the near-critical threshold',
      raw(near).perTask.get('NEAR')!.isCritical, false);
    eq('  …the grid run can, when the parent passes one',
      runCpmForCalendar(near, START, 5, [], { criticalFloatThresholdDays: 3 }).perTask.get('NEAR')!.isCritical, true);

    // 3. Per-task calendars — a Mon-Sat crew.
    const sat = [T('SAT', 6, [], { startDay: 1 })];
    const satCal = new Map([['SAT', { workingDaysPerWeek: 6, closures: [] as string[] }]]);
    eq('a Mon-Sat task finishes Sat Mar 7 when the grid run knows its calendar',
      d(runCpmForCalendar(sat, START, 5, [], { taskCalendars: satCal }).perTask.get('SAT')!.ef),
      new Date(2026, 2, 7).toDateString());

    // 4. The Due-by cell. `deadlineDay` is a raw calendar delta; the finish it
    //    is compared against has to be one too.
    const withDeadline = [T('A', 10, [], { startDay: 1, deadline: '2026-03-13' })];
    const deadlineDay = dateToCalendarDay(START, new Date(2026, 2, 13));
    const label = (ef: number) => (ef > deadlineDay ? `${ef - deadlineDay}d late` : ef < deadlineDay ? `${deadlineDay - ef}d early` : 'on time');
    eq('raw-day mode made the Due-by cell say "2d early" on a task that lands ON its deadline',
      label(raw(withDeadline).perTask.get('A')!.ef), '2d early');
    eq('  …the grid run says "on time"',
      label(runCpmForCalendar(withDeadline, START, 5, []).perTask.get('A')!.ef), 'on time');
    ok('and the cell derives deadlineDay through dateToCalendarDay, not a raw ms divide',
      /return dateToCalendarDay\(projectStartDate, new Date\(parsed\)\);/.test(src('components/schedule/GridPane.tsx')));
  }

  // A Gantt drag: the pixel delta is CALENDAR, the stored value is a WORKING
  // ordinal. Dragging B one calendar column right from Mon Mar 16 must store
  // the ordinal for Tue Mar 17 — not Mar 16 + one working day counted twice.
  const bCal = r.perTask.get('B')!.es;
  const droppedOrdinal = calendarIndexToWorkingOrdinal(bCal + 1, SCALE);
  eq('dragging a bar one column right stores the ordinal of the NEXT day',
    d(workingOrdinalToCalendarIndex(droppedOrdinal, SCALE)), new Date(2026, 2, 17).toDateString());

  // A resize: a bar stretched across a weekend gains CALENDAR width but the
  // stored duration is WORKING days.
  eq('stretching a 5-day bar across a weekend still stores 5 working days',
    workingDaysInSpan(1, 7, SCALE), 5);
}

// ── 10. The renderers still read the ENGINE, not the stored pin ─────────────
// Section 9 proves the arithmetic. This proves the components are still wired
// to it — the failure mode this campaign keeps hitting is a change that lands
// in one call site and not the others while everything still typechecks.
console.log('\n10. renderers are wired to cpm.es/ef');
{
  const grid = src('components/schedule/GridPane.tsx');
  ok('GridPane renders the Start cell from cpmRow.es as a CALENDAR date',
    /renderCalendarDate\(cpmRow\.es\)/.test(grid));
  ok('GridPane renders the Finish cell from cpmRow.ef as a CALENDAR date',
    /renderCalendarDate\(cpmRow\.ef\)/.test(grid));
  ok('GridPane never runs a CPM value through the WORKING-day renderer',
    !/renderDate\(cpmRow\./.test(grid) && !/addWorkingDays\([^)]*cpmRow/.test(grid));
  // The wiring §9 measures. `runCpm(tasks)` here — the engine's RAW-DAY mode —
  // is what made every one of those renderer call sites print the wrong date
  // while this file was green. The grid either takes the parent's cpm or runs
  // the calendar-forcing wrapper; there is no third option.
  ok('GridPane runs the engine WITH the project calendar (or takes the parent\'s cpm)',
    /runCpmForCalendar\(tasks, projectStartDate, workingDaysPerWeek, nonWorkingDates\)/.test(grid)
    && /const cpm: CpmResult = cpmFromParent \?\? ownCpm;/.test(grid));
  ok('  …and never falls back to a calendar-less run',
    // Strip comments first: the header explains WHY `runCpm(tasks)` is wrong
    // and naming it there must not trip the guard.
    !/runCpm\(tasks\)/.test(grid.replace(/\/\/[^\n]*/g, '')));

  const ganttLayers = src('components/schedule/InteractiveGantt.tsx');
  ok('the Gantt baseline ghost is lifted from the WORKING scale onto the axis',
    /const bStart = toCal\(bStartOrd\)/.test(ganttLayers)
    && !/const bx = \(bar\.task\.baselineStartDay - 1\)/.test(ganttLayers));
  ok('the Gantt actual overlay is lifted the same way',
    /const aStart = toCal\(aStartOrd\)/.test(ganttLayers));
  ok('logStartToday and logFinishToday write ONE scale into actualStartDay',
    /actualStartDay: todayOrdinal,/.test(ganttLayers)
    && /actualEndDay: todayOrdinal,/.test(ganttLayers)
    && !/actualStartDay: todayDayNumber,/.test(ganttLayers));

  const gantt = src('components/schedule/InteractiveGantt.tsx');
  ok('the Gantt bar is positioned from the CPM early start',
    /const baseCalStart = cpmRow\?\.es/.test(gantt));
  ok('the Gantt bar is NOT positioned from task.startDay',
    !/const x = \(startDay - 1\) \* pxPerDay/.test(gantt));
  ok('the Gantt gutter date comes from the CPM row',
    /const startIdx = gutterCpm\?\.es/.test(gantt));
  ok('the drag commits through calendarIndexToWorkingOrdinal',
    /toOrdinal\(prev\.currentCalStart\)/.test(gantt));
  ok('a resize converts the calendar span back to WORKING days',
    /workingSpan\(\s*prev\.currentCalStart/.test(gantt));

  const print = src('utils/printableGanttHtml.ts');
  ok('the printable one-pager positions bars from cpm es/ef',
    /const startIndex = \(t: ScheduleTask\) => cpmRow\(t\)\?\.es/.test(print));
  ok('  …and colours the critical bars from the engine, not task.isCriticalPath',
    /const isCriticalTask = \(t: ScheduleTask\) => cpmRow\(t\)\?\.isCritical/.test(print));

  const pro = src('app/schedule-pro.tsx');
  ok('schedule-pro stamps the engine critical path onto the rows it persists',
    /stampCriticalPath\(tasks, liveCpm\)/.test(pro));
  // …and so does EVERY other persist path, or a plan edited only on mobile (or
  // only through the copilot) keeps shipping the AI generator's original guess
  // to the client portal, the schedule PDF, the printable one-pager and the
  // "On critical path" line in the calendar invite for the life of the job.
  ok('the mobile Schedule tab stamps it on its one persist sink',
    /const stamped = stampCriticalPath\(reflowed, cpmResult\)/.test(src('app/(tabs)/schedule/index.tsx'))
    && /tasks: stamped,/.test(src('app/(tabs)/schedule/index.tsx')));
  ok('the copilot reflow sink stamps it too',
    /tasks: stampCriticalPath\(tasks, cpm\)/.test(
      src('utils/copilot/scheduleEdit/applyToProjectSchedule.ts')));
  ok('  …and on the unmount flush too',
    /stampCriticalPath\(workingTasksRef\.current, liveCpm\)/.test(pro));
  ok('the levelling preview compares against the POST-levelling finish',
    /leveledResult\.leveledProjectFinish/.test(pro));
  // …and the WHY reaches the modal. levelResources computes a full `detail`
  // payload per conflict (resource, counterpart, working days delayed, float
  // available and consumed, whether the finish moves) and the preview used to
  // show a bare "Day 12 → 19" because the conflicts were dropped on the way.
  ok('the levelling preview is given the engine\'s conflicts',
    /summarizeLeveling\(rolledTasks, leveled, leveledResult\.conflicts\)/.test(pro));
  ok('  …and the modal actually renders the reason',
    /\{shift\.reason \? \([\s\S]{0,120}?styles\.shiftReason/.test(
      src('components/schedule/LevelingPreviewModal.tsx')));
  ok('the printable one-pager is fed the live CPM rows',
    /cpmByTaskId: cpmRowsForPrint/.test(pro));
  // rebaseRawToCalendar compensated for the engine misreading startDay. Now
  // that the engine converts, re-mapping first double-converts: measured on
  // A(10)->B(10)->C(5) at ordinals 1/11/21, the finish inflates Apr 3 → Apr 15.
  ok('schedule-pro no longer re-maps startDay when a start date is first set',
    !/^\s*(?:const .*=\s*)?rebaseRawToCalendar\s*\(/m.test(pro)
    && !/from '@\/utils\/scheduleRebase'/.test(pro));

  const shared = src('app/shared-schedule.tsx');
  ok('the public share link runs CPM with the sender\'s calendar',
    /runCpm\(tasks, cpmOptions\)/.test(shared));
  ok('  …and prints a finish DATE, not "finish day 33"',
    !/finish day \$\{cpm\.projectFinish\}/.test(shared));

  // Behavioural, not a grep: the summary filter has to actually drop the parent
  // row. CriticalPathPanel draws this list as an arrow-linked CHAIN, so leaving
  // a summary in renders "Framing → Frame walls → Frame roof" — a parent and
  // its own children as sequential links — while the printed report (which has
  // always filtered) shows something different for the same schedule.
  //
  // The fixture has to be ROLLED first. An un-rolled summary keeps its authored
  // 1-day duration, comes out with float, and never reaches cpm.criticalPath at
  // all — so asserting "FRAMING is not in the chain" against raw rows passes
  // whether the filter exists or not. Rolled, FRAMING spans its children, ties
  // ROOF's finish and IS critical: measured, the chain is
  // "FRAMING → WALLS → ROOF" without the filter and "WALLS → ROOF" with it.
  const wbsRaw = [
    T('FRAMING', 1, [], { isSummary: true, outlineLevel: 0 }),
    T('WALLS', 5, [], { parentId: 'FRAMING', outlineLevel: 1 }),
    T('ROOF', 5, ['WALLS'], { parentId: 'FRAMING', outlineLevel: 1 }),
  ];
  const wbs = computeSummaryRollup(wbsRaw, { scheduled: runCpm(wbsRaw, CAL).perTask, scale: SCALE });
  const wbsCpm = runCpm(wbs, CAL);
  ok('the fixture is one where the summary really IS on the engine critical path',
    wbsCpm.criticalPath.includes('FRAMING'), wbsCpm.criticalPath);
  const chain = buildCriticalPathExplanation(wbsCpm, wbs).criticalTitles.map(x => x.id);
  eq('the on-screen critical-path chain excludes summary rows, like the printed report does',
    chain, ['WALLS', 'ROOF']);
}

// ── 11. A summary bar spans its children, wherever they end up ──────────────
console.log('\n11. summary rollup');
{
  const base = [
    T('SITE', 10),
    T('FRAMING', 1, [], { isSummary: true, outlineLevel: 0 }),
    T('WALLS', 5, ['SITE'], { parentId: 'FRAMING', outlineLevel: 1 }),
    T('ROOF', 3, ['WALLS'], { parentId: 'FRAMING', outlineLevel: 1 }),
  ];
  const spanOf = (rolled: ScheduleTask[]) => {
    const r = runCpm(rolled, CAL);
    const sum = r.perTask.get('FRAMING')!;
    const kids = ['WALLS', 'ROOF'].map(id => r.perTask.get(id)!);
    return {
      summary: [sum.es, sum.ef],
      children: [Math.min(...kids.map(k => k.es)), Math.max(...kids.map(k => k.ef))],
    };
  };
  // Off the authored pins the summary sits two weeks left of its own children,
  // because SITE pushes WALLS while WALLS' stored startDay never moves.
  const onePass = spanOf(computeSummaryRollup(base));
  ok('the one-pass rollup does NOT match — this is why the two-pass exists',
    JSON.stringify(onePass.summary) !== JSON.stringify(onePass.children), onePass);

  const first = runCpm(base, CAL);
  const twoPass = spanOf(computeSummaryRollup(base, { scheduled: first.perTask, scale: SCALE }));
  eq('the two-pass summary spans exactly min(child ES) → max(child EF)',
    twoPass.summary, twoPass.children);
  eq('  …which is Mon Mar 16 → Wed Mar 25',
    [d(twoPass.summary[0]), d(twoPass.summary[1])],
    [new Date(2026, 2, 16).toDateString(), new Date(2026, 2, 25).toDateString()]);

  // Behavioural: a child on its OWN calendar has to be LOCATED on that calendar
  // by the first pass too. Run the locating pass without taskCalendars and the
  // summary is rolled onto a window the child is not actually in.
  {
    const kids = [
      T('SUM', 1, [], { isSummary: true, outlineLevel: 0 }),
      T('SAT', 6, [], { parentId: 'SUM', outlineLevel: 1, startDay: 1, resourceIds: ['r6'] }),
    ];
    const sixDay = new Map([['SAT', { workingDaysPerWeek: 6, closures: [] as string[] }]]);
    const blind = runCpm(kids, CAL).perTask.get('SAT')!;
    const aware = runCpm(kids, { ...CAL, taskCalendars: sixDay }).perTask.get('SAT')!;
    ok('a per-resource calendar really does move the child (so the fixture bites)',
      blind.ef !== aware.ef, { blind: blind.ef, aware: aware.ef });
    const rolledBlind = computeSummaryRollup(kids, { scheduled: runCpm(kids, CAL).perTask, scale: SCALE });
    const rolledAware = computeSummaryRollup(kids, { scheduled: runCpm(kids, { ...CAL, taskCalendars: sixDay }).perTask, scale: SCALE });
    const spanOfSummary = (list: ScheduleTask[]) => {
      const sum = list.find(t => t.id === 'SUM')!;
      return [sum.startDay, sum.durationDays];
    };
    ok('  …and rolling off the calendar-blind pass gives a different summary span',
      JSON.stringify(spanOfSummary(rolledBlind)) !== JSON.stringify(spanOfSummary(rolledAware)),
      { blind: spanOfSummary(rolledBlind), aware: spanOfSummary(rolledAware) });
  }
  const pro = src('app/schedule-pro.tsx');
  ok('schedule-pro passes taskCalendars to the LOCATING pass, not only the live one',
    /const firstPass = runCpm\(workingTasks, \{[^}]*taskCalendars,/s.test(pro));
}

// ── 12. Writing a schedule back is a FIXED POINT ────────────────────────────
// The engine reads `startDay` as a WORKING ORDINAL and returns CALENDAR
// indices, so any code that persists "where CPM put it" has to convert on the
// way out. Write `cpm.es` back raw and the next run reads a calendar index as
// an ordinal and inflates the whole plan — a 29-working-day kitchen remodel
// re-opens as 39 days.
//
// FIVE shipped writers used to do exactly that: app/schedule-wizard.tsx's save
// path, utils/copilot/scheduleEdit/applyToProjectSchedule.ts,
// utils/coScheduleReflowCore.ts, and both date paths in
// app/(tabs)/schedule/index.tsx (§24 covers the last two). All five are fixed
// and the greps at the end of this section hold them there — the arithmetic below can
// only show that the contract is right, not that anyone obeys it, and this
// campaign has repeatedly found a fix that landed in one call site and not the
// others while everything still typechecked.
console.log('\n12. persisting a scheduled plan round-trips');
{
  const plan = [T('A', 10), T('B', 10, ['A']), T('C', 5, ['B'])];
  const once = runCpm(plan, CAL);

  // The RIGHT way: convert back to the stored scale.
  const persistedCorrectly = plan.map(t => ({
    ...t, startDay: calendarIndexToWorkingOrdinal(once.perTask.get(t.id)!.es, SCALE),
  }));
  const twice = runCpm(persistedCorrectly, CAL);
  eq('re-running on a correctly persisted plan gives the SAME finish',
    twice.projectFinish, once.projectFinish);
  let stable = true;
  for (const t of plan) {
    if (twice.perTask.get(t.id)!.es !== once.perTask.get(t.id)!.es) stable = false;
  }
  ok('  …and every task keeps its date', stable);

  // The WRONG way, asserted so the number is on the record rather than in a
  // comment: this is exactly what the two writers named above do today.
  const persistedRaw = plan.map(t => ({ ...t, startDay: once.perTask.get(t.id)!.es }));
  const inflated = runCpm(persistedRaw, CAL);
  ok('writing cpm.es straight onto startDay inflates the plan on the next run',
    inflated.projectFinish > once.projectFinish,
    { correct: once.projectFinish, raw: inflated.projectFinish });

  // ── the three writers ────────────────────────────────────────────────────
  const wizard = src('app/schedule-wizard.tsx');
  ok('the schedule wizard converts before persisting startDay',
    /startDay: calendarIndexToWorkingOrdinal\(t\.startDay, \{/.test(wizard)
    && !/^\s*startDay: t\.startDay,$/m.test(wizard));
  const copilotApply = src('utils/copilot/scheduleEdit/applyToProjectSchedule.ts');
  ok('the copilot apply path converts too',
    /startDay: calendarIndexToWorkingOrdinal\(r\.es, cpmOptions\)/.test(copilotApply)
    && !/startDay: r\.es \}/.test(copilotApply));
  const coReflow = src('utils/coScheduleReflowCore.ts');
  ok('the change-order reflow measures its shift on the scale it adds it to',
    /const delta = calendarIndexToWorkingOrdinal\(a\.es, options\)/.test(coReflow)
    && !/const delta = a\.es - b\.es;/.test(coReflow));
  ok('  …and reports the finish move in working days',
    /workingDaysBetween\(before\.projectFinish, after\.projectFinish, options\)/.test(coReflow)
    && !/const finishDeltaDays = after\.projectFinish - before\.projectFinish;/.test(coReflow));
}

// ── 13. The printed report tells ONE story ──────────────────────────────────
// This is the artefact most likely to reach a client, a lender or a surety, so
// it is the one where being wrong costs the most. Three separate defects lived
// in it, all from mixing the two day-scales inside a single document, and all
// three are measured here against the pre-change numbers.
console.log('\n13. the PM status report');
{
  // A chain authored exactly the way scheduleAI writes one — working ordinals
  // 1 / 11 / 21 — and baselined on the spot, so every variance MUST be zero.
  const rows = [
    { id: 'A', dur: 10, sd: 1, deps: [] as string[] },
    { id: 'B', dur: 10, sd: 11, deps: ['A'] },
    { id: 'C', dur: 5, sd: 21, deps: ['B'] },
  ].map(r => T(r.id, r.dur, r.deps, {
    startDay: r.sd, phase: 'Frame', crew: 'Ace',
    baselineStartDay: r.sd, baselineEndDay: r.sd + r.dur - 1,
  }));
  const project = {
    id: 'p', name: 'Job',
    schedule: { startDate: ISO, workingDaysPerWeek: 5, tasks: rows },
  } as unknown as Parameters<typeof assembleScheduleReport>[0]['project'];
  const model = assembleScheduleReport({
    project, tasks: rows, startDateIso: ISO,
    cpm: runCpm(rows, CAL), baseline: null,
    reportDate: new Date(2026, 2, 2), company: null, nonWorkingDates: [],
  });

  // Was 8 — max(raw baseline endDay) subtracted from the calendar-aware
  // cpm.projectFinish, the phantom-slip bug schedule-pro had already fixed for
  // its own KPI header and the report never got.
  eq('a schedule baselined a second ago reports ZERO variance', model.header.forecastVarianceDays, 0);
  // Was 3 rows: C +8d, B +6d, A +2d — invented, on a plan nobody had touched.
  eq('  …and no phantom per-task slippage', model.slippages, []);
  eq('  …and nothing counted as behind', model.kpis.behindCount, 0);

  // Was: the Gantt table said A 3/2→3/13 while the Critical Path table said
  // 3/2→3/11, and C 3/30→4/3 against 3/22→3/26 — the same task, eight days
  // apart, two tables of the same PDF.
  let agrees = true;
  for (const cp of model.criticalPath) {
    const g = model.ganttRows.find(r => r.title === cp.title)!;
    if (g.startIso !== cp.startIso || g.finishIso !== cp.finishIso) {
      agrees = false;
      console.log(`      ${cp.title}: gantt ${g.startIso}→${g.finishIso} vs critical ${cp.startIso}→${cp.finishIso}`);
    }
  }
  ok('the Critical Path table and the Gantt table date the same task the same way', agrees);

  // …and when there IS real slip, it is reported in WORKING days like every
  // other variance in the app. A 5-day task that ran 7 days is 2 working days
  // late; measured as a raw calendar-index difference across the weekend it
  // spans, the same row reads +4 — which is how a two-day overrun gets
  // escalated to a client as a week.
  {
    const slipped = [T('A', 7, [], { baselineStartDay: 1, baselineEndDay: 5 })];
    const m = assembleScheduleReport({
      project: {
        id: 'p', name: 'J', schedule: { startDate: ISO, workingDaysPerWeek: 5, tasks: slipped },
      } as unknown as Parameters<typeof assembleScheduleReport>[0]['project'],
      tasks: slipped, startDateIso: ISO, cpm: runCpm(slipped, CAL), baseline: null,
      reportDate: new Date(2026, 2, 2), company: null, nonWorkingDates: [],
    });
    eq('a 5-day task that ran 7 days reports +2, not the +4 of raw calendar days',
      m.ganttRows[0].deltaDays, 2);
  }

  // finishDay(t) = startDay + dur - 1 called a 20-working-day task overdue from
  // calendar day 21; it really finishes on calendar day 26.
  const long = [T('LONG', 20)];
  const longCpm = runCpm(long, CAL);
  const longModel = assembleScheduleReport({
    project: {
      id: 'p', name: 'J', schedule: { startDate: ISO, workingDaysPerWeek: 5, tasks: long },
    } as unknown as Parameters<typeof assembleScheduleReport>[0]['project'],
    tasks: long, startDateIso: ISO, cpm: longCpm, baseline: null,
    reportDate: new Date(2026, 2, 22), company: null, nonWorkingDates: [],
  });
  eq('the engine really does finish it on calendar day 26', longCpm.projectFinish, 26);
  eq('  …so on report day 21 it is NOT overdue', longModel.kpis.overdueCount, 0);

  // The header used to print "Data date: <today>". A data date is a scheduling
  // INPUT this engine deliberately does not have (types/index.ts: "the plan
  // stays the plan until you say so"), so the label advertised a capability to
  // the one audience least able to check it.
  ok('the report header does not advertise a data date the engine does not have',
    !/Data date/i.test(renderScheduleReportHtml(model, {
      paperSize: 'a3', orientation: 'landscape',
      sections: ['kpis', 'critPath', 'gantt'],
      fitToOnePage: false, showPredecessors: false, singleWallSheet: false,
    })));
}

// ── 14. Last Planner commits against the SCHEDULE, not the pin ──────────────
console.log('\n14. Last Planner windows');
{
  // FOUNDATION runs 10 working days long. FRAMING's stored pin never moves —
  // schedule-pro deliberately does not write CPM back to startDay — so the
  // weekly board planned three weeks earlier than the Pro scheduler did.
  const lp = [T('FOUND', 20), T('FRAME', 10, ['FOUND'], { startDay: 11 }), T('DRY', 5, ['FRAME'], { startDay: 21 })];
  const sched = buildScheduledStartDays(lp, ISO, { workingDaysPerWeek: 5 });
  const frame = lp[1];
  const pinWindow = taskWindow(frame, ISO, { workingDaysPerWeek: 5 })!;
  const cpmWindow = taskWindow(frame, ISO, { workingDaysPerWeek: 5 }, sched.get('FRAME'))!;
  ok('the authored pin and the scheduled start really do disagree here',
    pinWindow.startMs !== cpmWindow.startMs);
  eq('the window starts where CPM schedules the task',
    cpmWindow.startMs,
    Date.UTC(2026, 2, 30));  // Mon Mar 30 — FOUND ends Fri Mar 27
  eq('  …and the pin-only window was two and a half weeks earlier',
    pinWindow.startMs, Date.UTC(2026, 2, 12));
}

// ── 15. The Gantt's OTHER two bar layers ───────────────────────────────────
// §9 only ever looked at the PLANNED bars. InteractiveGantt draws three layers
// on one calendar axis, and on 2026-09-11 the planned bars had been moved onto
// cpm.es/ef while the baseline ghosts and the actual-progress overlay were left
// reading raw WORKING ORDINALS off the task. The result: a baseline captured
// one second ago on a schedule nobody had touched rendered as a large slip.
// Nothing in this file could see it, because nothing rendered a ghost.
console.log('\n15. Gantt baseline ghost + actual overlay');
{
  const tasks = [T('A', 10), T('B', 5, ['A']), T('C', 5, ['B'])];
  const cpm = runCpm(tasks, CAL);
  // Baseline captured from the SCHEDULED positions, unchanged.
  const bl = captureBaseline(tasks, 'v1', undefined, { scale: SCALE, cpm });
  const withBl = tasks.map(t => {
    const b = bl.tasks.find(x => x.id === t.id)!;
    return { ...t, baselineStartDay: b.startDay, baselineEndDay: b.endDay };
  });

  const drift: string[] = [];
  for (const t of withBl) {
    const row = cpm.perTask.get(t.id)!;
    const barX = row.es - 1;
    const barW = row.ef - row.es + 1;
    // The component: toCal(baselineStartDay) / toCal(baselineEndDay).
    const ghostX = workingOrdinalToCalendarIndex(t.baselineStartDay!, SCALE) - 1;
    const ghostW = workingOrdinalToCalendarIndex(t.baselineEndDay!, SCALE)
      - workingOrdinalToCalendarIndex(t.baselineStartDay!, SCALE) + 1;
    if (ghostX !== barX || ghostW !== barW) drift.push(`${t.id}: ghost x=${ghostX} w=${ghostW} vs bar x=${barX} w=${barW}`);
  }
  eq('an UNCHANGED baseline draws its ghost exactly under its own bar', drift, []);

  // The pre-fix geometry, spelled out so the guard says what it is protecting
  // against: raw ordinals on a calendar axis put C's ghost six columns left.
  const cRow = cpm.perTask.get('C')!;
  const cTask = withBl.find(t => t.id === 'C')!;
  ok('  …and the raw-ordinal version really was six columns out',
    (cRow.es - 1) - (cTask.baselineStartDay! - 1) === 6,
    { barX: cRow.es - 1, rawGhostX: cTask.baselineStartDay! - 1 });

  // The actual overlay shares the scale. logStartToday writes a WORKING ordinal
  // (types/index.ts: "1-indexed, same basis as startDay"); logFinishToday's
  // retro-start fallback writes task.startDay, also an ordinal. Before the fix
  // the first of those wrote a CALENDAR index, so ONE field carried two scales.
  const actual = { ...withBl[2], actualStartDay: 16, actualEndDay: 20 };  // C ran exactly to plan
  const aX = workingOrdinalToCalendarIndex(actual.actualStartDay, SCALE) - 1;
  const aW = workingOrdinalToCalendarIndex(actual.actualEndDay, SCALE)
    - workingOrdinalToCalendarIndex(actual.actualStartDay, SCALE) + 1;
  eq('an actual that matches the plan draws exactly over its own bar',
    [aX, aW], [cRow.es - 1, cRow.ef - cRow.es + 1]);
}

// ── 16. The PDF export is on one axis ──────────────────────────────────────
// utils/exportSchedulePdf.ts is the sibling of the printable one-pager and goes
// to the same client. It positioned each bar's LEFT edge from cpm.es (a
// CALENDAR index) and took its WIDTH from durationDays (a WORKING-day count),
// and drew the baseline bar from raw working ordinals — the same two defects
// the one-pager had. Nothing guarded it.
console.log('\n16. schedule PDF bar geometry');
{
  const tasks = [T('A', 10), T('B', 5, ['A']), T('C', 5, ['B'])];
  const cpm = runCpm(tasks, CAL);
  const bl = captureBaseline(tasks, 'v1', undefined, { scale: SCALE, cpm });

  const bad: string[] = [];
  for (const t of tasks) {
    const row = cpm.perTask.get(t.id)!;
    const calSpan = row.ef - row.es + 1;
    // The OLD width. On a 5-day week these differ for anything spanning a
    // weekend — A is 10 working days but 12 calendar columns wide.
    if (t.durationDays === calSpan && t.durationDays === 10) bad.push(`${t.id}: fixture no longer exercises the defect`);
    const b = bl.tasks.find(x => x.id === t.id)!;
    const bLeft = workingOrdinalToCalendarIndex(b.startDay, SCALE) - 1;
    const bWidth = workingOrdinalToCalendarIndex(b.endDay, SCALE)
      - workingOrdinalToCalendarIndex(b.startDay, SCALE) + 1;
    if (bLeft !== row.es - 1 || bWidth !== calSpan) {
      bad.push(`${t.id}: baseline bar ${bLeft}/${bWidth} vs plan bar ${row.es - 1}/${calSpan}`);
    }
  }
  eq('the baseline bar sits under the plan bar on an unchanged schedule', bad, []);
  eq('a 10-working-day task is 12 calendar columns wide, not 10',
    cpm.perTask.get('A')!.ef - cpm.perTask.get('A')!.es + 1, 12);

  const pdf = src('utils/exportSchedulePdf.ts');
  ok('the PDF bar width comes from the CALENDAR span, not durationDays',
    /const calSpan = Math\.max\(dur === 0 \? 0 : 1, ef - es \+ 1\)/.test(pdf)
    && !/widthPct = Math\.max\(0\.3, \(dur \/ totalDays\)/.test(pdf));
  ok('the PDF baseline bar is lifted onto the calendar first',
    /const bStartCal = toCal\(bSnap\.startDay\)/.test(pdf));
  ok('the PDF variance columns are differenced in working days',
    /slipDays\(toCal\(bSnap\.endDay\), ef\)/.test(pdf));
  ok('app/schedule-pro.tsx hands the PDF export the project calendar',
    /await exportSchedulePdf\(\{[\s\S]{0,900}?workingDaysPerWeek: project\?\.schedule\?\.workingDaysPerWeek,[\s\S]{0,200}?nonWorkingDates: project\?\.schedule\?\.nonWorkingDates,[\s\S]{0,40}?\}\);/
      .test(src('app/schedule-pro.tsx')));
}

// ── 17. Reflow from actuals is idempotent and link-type aware ──────────────
// The header comment on reflowFromActuals asserted "Idempotent: running twice
// on the same data produces the same output" over code that incremented the
// field it had just written. Three taps of the Reflow button gave three
// different plans (A@1 B@9 C@14 → B@12 C@17 → B@15 C@20) and nobody checked,
// because the comment said it was fine.
console.log('\n17. reflowFromActuals');
{
  const withBaseline = [
    T('A', 10, [], { startDay: 1, baselineStartDay: 1, baselineEndDay: 10, actualStartDay: 5 }),
    T('B', 10, ['A'], { startDay: 11, baselineStartDay: 11, baselineEndDay: 20 }),
    T('C', 5, ['B'], { startDay: 21, baselineStartDay: 21, baselineEndDay: 25 }),
  ];
  const pos = (list: ScheduleTask[]) => list.map(t => `${t.id}@${t.startDay}`).join(' ');
  const r1 = reflowFromActuals(withBaseline);
  const r2 = reflowFromActuals(r1);
  const r3 = reflowFromActuals(r2);
  ok('the first run actually moves something', pos(r1) !== pos(withBaseline), pos(r1));
  eq('running it twice changes nothing', pos(r2), pos(r1));
  eq('running it three times changes nothing', pos(r3), pos(r1));

  // …and WITHOUT a baseline, which the old "baselineStartDay ?? startDay" basis
  // could not manage at all.
  const noBaseline = [
    T('A', 10, [], { startDay: 1, actualStartDay: 5 }),
    T('B', 10, ['A'], { startDay: 11 }),
    T('C', 5, ['B'], { startDay: 21 }),
  ];
  const n1 = reflowFromActuals(noBaseline);
  eq('idempotent without a baseline too', pos(reflowFromActuals(n1)), pos(n1));
  eq('  …and it lands where the actuals put it: A started day 5, so B starts 15',
    pos(n1), 'A@1 B@15 C@25');

  // Row order is what app/schedule-pro.tsx compares by INDEX to count moves.
  eq('the result keeps the input row order', r1.map(t => t.id), ['A', 'B', 'C']);

  // Link types. P starts on time and finishes 6 late. Its SS partner rides the
  // START, so it must not move; its FS successor waits on the FINISH.
  const typed = [
    T('P', 10, [], { startDay: 1, actualStartDay: 1, actualEndDay: 16 }),
    T('Q', 5, ['P'], { startDay: 1, dependencyLinks: [{ taskId: 'P', type: 'SS', lagDays: 0 }] }),
    T('R', 5, ['P'], { startDay: 11, dependencyLinks: [{ taskId: 'P', type: 'FS', lagDays: 0 }] }),
  ];
  const out = reflowFromActuals(typed);
  eq('an SS partner does not absorb a FINISH delay', out.find(t => t.id === 'Q')!.startDay, 1);
  eq('an FS successor does', out.find(t => t.id === 'R')!.startDay, 17);

  // A planned gap absorbs the slip instead of the task being shoved.
  const gapped = [
    T('P', 10, [], { startDay: 1, actualStartDay: 3 }),           // 2 days late
    T('S', 5, ['P'], { startDay: 20 }),                            // 9 days of gap
  ];
  eq('a successor with room does not move', reflowFromActuals(gapped).find(t => t.id === 'S')!.startDay, 20);

  // A cycle must not be "reflowed" into a guess.
  const cyc = [T('A', 2, ['B'], { actualStartDay: 3 }), T('B', 2, ['A'])];
  ok('a dependency cycle returns the input untouched', reflowFromActuals(cyc) === cyc);
}

// ── 18. Baseline variance sees a slip caused by somebody else ──────────────
// captureBaseline and diffAgainstBaseline both read task.startDay, the AUTHORED
// pin. A pin does not move when a predecessor grows, so the single most common
// real-world variance — "my drywall slipped because the foundation ran long" —
// reported nothing at all.
console.log('\n18. baseline variance');
{
  const tasks = [T('FOUNDATION', 10, [], { startDay: 1 }),
                 T('FRAMING', 10, ['FOUNDATION'], { startDay: 11 }),
                 T('DRYWALL', 5, ['FRAMING'], { startDay: 21 })];
  const bl = captureBaseline(tasks, 'v1', undefined, { scale: SCALE });
  eq('the baseline snapshots the SCHEDULED position, not the pin',
    bl.tasks.map(b => `${b.id}@${b.startDay}`), ['FOUNDATION@1', 'FRAMING@11', 'DRYWALL@21']);

  const grown = tasks.map(t => t.id === 'FOUNDATION' ? { ...t, durationDays: 20 } : t);
  const pinOnly = diffAgainstBaseline(grown, bl);
  eq('the pin-only diff still reports ONLY the task that was edited',
    pinOnly.map(r => r.taskId), ['FOUNDATION']);
  const scheduled = diffAgainstBaseline(grown, bl, { scale: SCALE });
  eq('the scheduled diff reports the two tasks it pushed as well',
    scheduled.map(r => `${r.taskId}${r.endDelta >= 0 ? '+' : ''}${r.endDelta}`).sort(),
    ['DRYWALL+10', 'FOUNDATION+10', 'FRAMING+10']);
  ok('components/schedule/BaselineManagerModal.tsx is wired to the calendar',
    /diffAgainstBaseline\(workingTasks, a, \{ scale: dayScale \}\)/.test(src('components/schedule/BaselineManagerModal.tsx'))
    && /captureBaseline\(workingTasks, name, undefined, \{ scale: dayScale \}\)/.test(src('components/schedule/BaselineManagerModal.tsx')));
  ok('  …and app/schedule-pro.tsx supplies it',
    /dayScale=\{summaryScale\}/.test(src('app/schedule-pro.tsx')));
}

// ── 19. The critical SET is not one chain ──────────────────────────────────
// cpm.criticalPath returns every zero-float task in topological order. Real
// networks routinely have two branches critical at once — utils/cpm.ts says so
// in its own header — and CriticalPathPanel drew the whole set as a single
// arrow-linked list, asserting a dependency between tasks that merely run side
// by side.
console.log('\n19. parallel critical branches');
{
  // Two independent 10-day branches into one finish milestone: both are
  // critical and neither depends on the other.
  const net = [
    T('EXCAVATE', 10, [], { startDay: 1 }),
    T('ORDER_STEEL', 10, [], { startDay: 1 }),
    T('ERECT', 5, ['EXCAVATE', 'ORDER_STEEL'], { startDay: 11 }),
  ];
  const r = runCpm(net, CAL);
  ok('the fixture really does have two simultaneously critical branches',
    ['EXCAVATE', 'ORDER_STEEL', 'ERECT'].every(id => r.criticalPath.includes(id)), r.criticalPath);
  const ex = buildCriticalPathExplanation(r, net);
  // Both branches feed ERECT, so union-find joins them into ONE component —
  // which is correct: they ARE linked, through ERECT. The defect the panel had
  // is the ORDER inside a chain, so the real test is a network with genuinely
  // disjoint critical work.
  const disjoint = [
    T('EXCAVATE', 10, [], { startDay: 1 }),
    T('FOOTINGS', 5, ['EXCAVATE'], { startDay: 11 }),
    T('PERMIT', 15, [], { startDay: 1 }),          // separate 15-day critical run
  ];
  const dr = runCpm(disjoint, CAL);
  const dex = buildCriticalPathExplanation(dr, disjoint);
  ok('the disjoint fixture has every task critical',
    ['EXCAVATE', 'FOOTINGS', 'PERMIT'].every(id => dr.criticalPath.includes(id)), dr.criticalPath);
  eq('two unconnected critical runs come back as TWO chains, not one arrow list',
    dex.criticalChains.map(c => c.map(x => x.id)), [['EXCAVATE', 'FOOTINGS'], ['PERMIT']]);
  eq('  …and the flattened set is unchanged for callers that only ask membership',
    dex.criticalTitles.map(x => x.id).sort(), ['EXCAVATE', 'FOOTINGS', 'PERMIT']);
  eq('a linear network is still exactly one chain',
    ex.criticalChains.length, 1);
  ok('CriticalPathPanel draws arrows WITHIN a chain, not across the whole set',
    /explanation\.criticalChains\.map\(\(chain, ci\)/.test(src('components/schedule/CriticalPathPanel.tsx'))
    && /i < chain\.length - 1/.test(src('components/schedule/CriticalPathPanel.tsx'))
    && !/i < explanation\.criticalTitles\.length - 1/.test(src('components/schedule/CriticalPathPanel.tsx')));
  ok('  …and says so when there is more than one',
    /parallel branches/.test(src('components/schedule/CriticalPathPanel.tsx')));
}

// ── 19b. The Last Planner label agrees with the week it is filed under ─────
// buildWeeklyWorkPlan files a row under the week CPM schedules it in. The
// screen's own `startLabelFor` built its date from `taskWindow(task, ...)` with
// no scheduled start, so the same row could read a date from a different week
// than the one it appeared in.
console.log('\n19b. Last Planner dispatch label');
{
  const tasks = [T('FOUND', 20), T('FRAME', 10, ['FOUND'], { startDay: 11 })];
  const scheduled = buildScheduledStartDays(tasks, ISO, { workingDaysPerWeek: 5 });
  const frame = tasks[1];
  const pinWin = taskWindow(frame, ISO, { workingDaysPerWeek: 5 })!;
  const schedWin = taskWindow(frame, ISO, { workingDaysPerWeek: 5 }, scheduled.get('FRAME'))!;
  ok('the fixture really does put the pin and the schedule in different weeks',
    Math.abs(schedWin.startMs - pinWin.startMs) > 7 * 86400000,
    { pin: new Date(pinWin.startMs).toDateString(), sched: new Date(schedWin.startMs).toDateString() });

  const screen = src('app/last-planner.tsx');
  ok('startLabelFor takes the scheduled starts',
    /function startLabelFor\([\s\S]{0,400}?scheduledEs: Map<string, number>/.test(screen));
  ok('  …and passes them into taskWindow',
    /taskWindow\(task, startDate, calendar, scheduledEs\.get\(task\.id\)\)/.test(screen));
  ok('  …and the caller builds them from the same engine the weekly plan uses',
    /buildScheduledStartDays\(tasks, startDate, calendar\)/.test(screen));
}

// ── 20. The engine's memo tables agree with the exported converters ─────────
// runCpm no longer walks the calendar per task. It builds an incremental
// ordinal→index table per run (makeOrdinalIndexer) and a working-day prefix
// table per calendar (makeWorkingDayCounter) — the change that took an 800-task
// import from 33x slower back under the pre-change baseline. A memoisation bug
// in either is invisible until a date is silently wrong, so pin them against
// the un-memoised exported converters over a range that spans several weekends
// AND a mid-week closure.
console.log('\n20. memoised scales match the exported converters');
{
  const CLOSED = { scheduleStartDate: ISO, workingDaysPerWeek: 5, nonWorkingDates: ['2026-03-11'] };
  const pins: ScheduleTask[] = [];
  for (let n = 1; n <= 40; n++) pins.push(T(`o${n}`, 1, [], { startDay: n }));
  const rp = runCpm(pins, CLOSED);
  let firstOrdinalBad = '';
  for (let n = 1; n <= 40 && !firstOrdinalBad; n++) {
    const want = workingOrdinalToCalendarIndex(n, CLOSED);
    const got = rp.perTask.get(`o${n}`)!.es;
    if (got !== want) firstOrdinalBad = `ordinal ${n}: engine ${got} vs converter ${want}`;
  }
  ok('the engine\'s ordinal table matches workingOrdinalToCalendarIndex for ordinals 1-40',
    firstOrdinalBad === '', firstOrdinalBad);
  ok('  …and the closure really does shift the mapping',
    workingOrdinalToCalendarIndex(10, CLOSED) !== workingOrdinalToCalendarIndex(10, SCALE),
    { closed: workingOrdinalToCalendarIndex(10, CLOSED), open: workingOrdinalToCalendarIndex(10, SCALE) });

  // Total float now comes from the prefix counter; workingDaysBetween walks.
  const wideRun = runCpm([T('L', 40), T('S', 1, [], { startDay: 2 }), T('E', 1, ['L', 'S'])], CLOSED);
  const sRow = wideRun.perTask.get('S')!;
  eq('total float from the prefix counter equals the walking workingDaysBetween',
    sRow.totalFloat, workingDaysBetween(sRow.es, sRow.ls, CLOSED));
  ok('  …over a window that really does span several weekends', sRow.ls - sRow.es > 14,
    { es: sRow.es, ls: sRow.ls });

  // NEGATIVE day indices are real. The backward pass produces LS < 1 whenever a
  // hard pin or a target finish makes the plan impossible, and `ls - es` is then
  // the negative total float that DCMA #7 and every "this cannot be built"
  // signal rest on. A prefix table that starts at index 1 and clamps below it
  // turns -12 into -0, which is not `< 0`: the impossible schedule reports
  // clean. Caught by validate-schedule-health's "#7 negative float is detected".
  const impossible = runCpm([
    T('P', 10),
    T('S', 2, ['P'], { anchorType: 'must-start-on', anchorDate: '2026-03-04' }),
  ], CAL);
  const pRow = impossible.perTask.get('P')!;
  ok('an impossible pin really does drive LS below day 1', pRow.ls < 1, pRow.ls);
  eq('  …and its negative total float survives the prefix table',
    pRow.totalFloat, workingDaysBetween(pRow.es, pRow.ls, CAL));
  ok('  …and is strictly negative, not -0', pRow.totalFloat < 0, pRow.totalFloat);
}

// ── 21. Free float is counted on the task's OWN calendar ────────────────────
// Free float answers "how many days can THIS task slip", so the unit belongs to
// the PREDECESSOR. It was being counted on the successor's calendar — identical
// on a single-calendar project (which is why the 1,500-network fuzz in §4
// cannot see it) and wrong the moment `taskCalendars` is non-empty, which is
// exactly what app/schedule-pro.tsx builds for every resourceIds-assigned task.
console.log('\n21. free float unit under per-task calendars');
{
  const perCal = new Map<string, { workingDaysPerWeek: number; closures: string[] }>([
    ['P', { workingDaysPerWeek: 7, closures: [] }],
    ['S', { workingDaysPerWeek: 5, closures: [] }],
  ]);
  const mixed = runCpm(
    [T('P', 3), T('S', 2, ['P'], { startDay: 6 })],
    { ...CAL, taskCalendars: perCal },
  );
  const pRow = mixed.perTask.get('P')!;
  const sRow = mixed.perTask.get('S')!;
  const onP = workingDaysBetween(pRow.ef + 1, sRow.es, { scheduleStartDate: ISO, workingDaysPerWeek: 7 });
  const onS = workingDaysBetween(pRow.ef + 1, sRow.es, { scheduleStartDate: ISO, workingDaysPerWeek: 5 });
  ok('the fixture really does make the two calendars disagree', onP !== onS, { onP, onS });
  eq('free float is counted on the PREDECESSOR\'s calendar', pRow.freeFloat, onP);
}

// ── 22. The Gantt drag survives a calendar it was not given before ──────────
// §9's drag assertions only ever exercised the 5-day default. InteractiveGantt
// converts between the calendar axis and the stored working scale using the
// `workingDaysPerWeek`/`nonWorkingDates` PROPS, and components/schedule/tabs/
// GanttTab.tsx passed neither to any of its three render sites — so the Pro
// scheduler's Gantt silently ran on a hard-coded 5-day, no-closure calendar.
// Measured on a 7-day project before the wiring: a bar at ordinal 10 dragged
// one column RIGHT committed ordinal 9 and the task moved one day LEFT.
console.log('\n22. drag round-trip on 6/7-day and closure calendars');
{
  const scales = [
    { label: '7-day', scale: { scheduleStartDate: ISO, workingDaysPerWeek: 7 } },
    { label: '6-day', scale: { scheduleStartDate: ISO, workingDaysPerWeek: 6 } },
    { label: '5-day + closure', scale: { scheduleStartDate: ISO, workingDaysPerWeek: 5, nonWorkingDates: ['2026-03-05'] } },
  ];
  for (const { label, scale } of scales) {
    const task = T('D', 5, [], { startDay: 10 });
    const r = runCpm([task], scale);
    const cal = r.perTask.get('D')!.es;
    // The component: currentCalStart = calStart + 1 column, then toOrdinal().
    const dropped = calendarIndexToWorkingOrdinal(cal + 1, scale);
    const after = runCpm([{ ...task, startDay: dropped }], scale).perTask.get('D')!.es;
    ok(`${label}: dragging one column right never moves the task LEFT`, after >= cal,
      { before: cal, committed: dropped, after });
    ok(`  …${label}: and it lands on the next day the calendar will work`,
      after === workingOrdinalToCalendarIndex(dropped, scale), { after, dropped });

    // A resize: the pixel span is CALENDAR, durationDays is WORKING days.
    const span = r.perTask.get('D')!.ef - cal + 1;
    eq(`  …${label}: a bar at its own width still stores its own duration`,
      workingDaysInSpan(cal, cal + span - 1, scale), 5);
  }
  // The specific pre-wiring failure: a 7-day project read through the 5-day
  // default gives a DIFFERENT ordinal, which is what made the bar walk backwards.
  const seven = { scheduleStartDate: ISO, workingDaysPerWeek: 7 };
  ok('the 5-day default really would have committed a different ordinal on a 7-day project',
    calendarIndexToWorkingOrdinal(11, SCALE) !== calendarIndexToWorkingOrdinal(11, seven),
    { asFive: calendarIndexToWorkingOrdinal(11, SCALE), asSeven: calendarIndexToWorkingOrdinal(11, seven) });
}

// ── 23. Every Gantt render site is handed the project calendar ──────────────
// §22 proves the arithmetic needs the calendar. This proves the props reach it.
// Grep, deliberately COUNTED rather than matched once: the failure was two of
// three call sites wired and the third not, which a single `.test()` passes.
console.log('\n23. the calendar reaches every InteractiveGantt');
{
  const tab = src('components/schedule/tabs/GanttTab.tsx');
  const sites = (tab.match(/<InteractiveGanttDefault\b/g) ?? []).length;
  ok('GanttTab still renders the three InteractiveGantt layouts', sites === 3, sites);
  const wired = (tab.match(/<InteractiveGanttDefault[\s\S]{0,600}?nonWorkingDates=\{nonWorkingDates\}/g) ?? []).length;
  eq('every one of them is passed nonWorkingDates', wired, sites);
  const wiredWd = (tab.match(/<InteractiveGanttDefault[\s\S]{0,600}?workingDaysPerWeek=\{workingDaysPerWeek\}/g) ?? []).length;
  eq('  …and workingDaysPerWeek', wiredWd, sites);

  const shared = src('app/shared-schedule.tsx');
  ok('the public share viewer passes the sender\'s calendar to the Gantt too',
    /workingDaysPerWeek=\{cpmOptions\.workingDaysPerWeek\}/.test(shared)
    && /nonWorkingDates=\{cpmOptions\.nonWorkingDates\}/.test(shared));

  // The completion diamond is picked by the ENGINE, matching the sibling
  // printable renderer. Two charts of one schedule must not disagree about
  // which milestone is the end of the job.
  const gantt = src('components/schedule/InteractiveGantt.tsx');
  ok('the last-milestone diamond is chosen from the CPM early start',
    /lastMilestoneId[\s\S]{0,400}?cpm\.perTask\.get\(t\.id\)\?\.es/.test(gantt));
  ok('  …not from the raw stored ordinal',
    !/lastMilestoneId[\s\S]{0,400}?const day = t\.startDay \?\? 0;/.test(gantt));
}

// ── 24. The Schedule tab writes a WORKING ORDINAL, like every other writer ──
// The engine reads `startDay` as a working ordinal. The Schedule tab's task
// editor turned a picked calendar date into a RAW day offset and stored it, so
// picking a date scheduled the task LATER than picked, by more the further out
// it was: on a 5-day week from Mon Mar 2, picking Mon Mar 16 stored 15 and the
// engine planned Fri Mar 20.
console.log('\n24. the Schedule tab date picker');
{
  const tab = src('app/(tabs)/schedule/index.tsx');
  ok('it converts a picked date through the shared startDayNumberFor helper',
    (tab.match(/startDayNumberFor\(/g) ?? []).length >= 2, tab.match(/startDayNumberFor\(/g)?.length);
  ok('  …and no longer divides raw milliseconds into a startDay',
    !/const dayOffset = Math\.round\(ms \/ \(1000 \* 60 \* 60 \* 24\)\) \+ 1;/.test(tab));

  // Behavioural: the helper's answer must schedule the task on the day picked.
  const picked = new Date(2026, 2, 16);                       // Mon Mar 16
  const ordinal = scheduleDayNumberFor(START, picked, 5);
  const placed = runCpm([T('P', 2, [], { startDay: ordinal })], CAL).perTask.get('P')!.es;
  eq('picking Mon Mar 16 schedules the task on Mon Mar 16', d(placed), picked.toDateString());
  // …and the raw-offset version does not, so the assertion above has teeth.
  const rawOffset = Math.round((picked.getTime() - START.getTime()) / 86400000) + 1;
  const misplaced = runCpm([T('P', 2, [], { startDay: rawOffset })], CAL).perTask.get('P')!.es;
  ok('  …while the raw calendar offset would have scheduled it Fri Mar 20',
    d(misplaced) === new Date(2026, 2, 20).toDateString(), d(misplaced));
}

// ── 25. A share link reproduces the sender's schedule ───────────────────────
// `decodeShareToken` rejected everything that was not v1 (`parsed.v !== 1`),
// while app/schedule-pro.tsx's Share always passes { projectId } and therefore
// always minted v3 — every link the Pro scheduler produced decoded to null and
// the recipient got the "invalid link" leaf. That fix shipped with no coverage
// at all, and neither did the v4 calendar it now carries.
console.log('\n25. share token round-trip');
{
  const tasks = [
    T('A', 10, [], { startDay: 1, title: 'Frame' }),
    T('B', 5, ['A'], { title: 'Rock', dependencyLinks: [{ taskId: 'A', type: 'SS', lagDays: 3 }] }),
  ];
  const variants: { label: string; want: number; opts: Parameters<typeof buildSharePayload>[3] }[] = [
    { label: 'v1 (bare)', want: 4, opts: {} },     // typed SS link alone already lifts it to v4
    { label: 'v3 (projectId)', want: 4, opts: { projectId: 'p1' } },
    { label: 'v4 (calendar)', want: 4, opts: { projectId: 'p1', workingDaysPerWeek: 6, nonWorkingDates: ['2026-03-11'] } },
  ];
  for (const { label, opts } of variants) {
    const payload = buildSharePayload('Job', START, tasks, opts);
    const enc = tryEncodeShareToken(payload);
    ok(`${label}: encodes inline`, enc.kind === 'inline', enc);
    if (enc.kind !== 'inline') continue;
    const back = decodeShareToken(enc.token);
    ok(`  …${label}: decodes (v${payload.v})`, back !== null);
    if (!back) continue;
    // The viewer's own path: tasksFromSharePayload + cpmOptionsFromSharePayload.
    const senderOpts = {
      scheduleStartDate: ISO,
      workingDaysPerWeek: opts?.workingDaysPerWeek ?? 5,
      nonWorkingDates: opts?.nonWorkingDates,
    };
    const sender = runCpm(tasks, senderOpts);
    const viewer = runCpm(tasksFromSharePayload(back), cpmOptionsFromSharePayload(back));
    let same = true;
    for (const t of tasks) {
      const a = sender.perTask.get(t.id)!, b = viewer.perTask.get(t.id)!;
      if (a.es !== b.es || a.ef !== b.ef) same = false;
    }
    ok(`  …${label}: the viewer reproduces the sender's dates`, same, {
      sender: [...sender.perTask].map(([k, v]) => `${k}:${v.es}-${v.ef}`),
      viewer: [...viewer.perTask].map(([k, v]) => `${k}:${v.es}-${v.ef}`),
    });
    eq(`  …${label}: and the same critical path`, viewer.criticalPath, sender.criticalPath);
  }
  // A typed link has to SURVIVE the token, or the viewer's CPM is a different
  // network from the sender's.
  const p4 = buildSharePayload('Job', START, tasks, { projectId: 'p1', workingDaysPerWeek: 6 });
  const t4 = tryEncodeShareToken(p4);
  const back4 = t4.kind === 'inline' ? decodeShareToken(t4.token) : null;
  eq('a non-trivial dependencyLink survives the token',
    back4?.tasks.find(t => t.id === 'B')?.dependencyLinks?.[0]?.type, 'SS');
  eq('  …and so does the sender\'s working week',
    cpmOptionsFromSharePayload(back4!).workingDaysPerWeek, 6);
  // …and the fallback when a legacy token carries none is 5, not the engine's 7.
  const legacy = { v: 1 as const, name: 'Job', projectStartISO: ISO, tasks: [] };
  eq('a calendar-less legacy token falls back to a 5-day week, not the engine default',
    cpmOptionsFromSharePayload(legacy).workingDaysPerWeek, 5);

  // …which is exactly why the MINTER has to send one. A 7-day project shared
  // without its calendar shows the recipient a plan the sender never made:
  const seven = { scheduleStartDate: ISO, workingDaysPerWeek: 7 };
  const senderSeven = runCpm(tasks, seven);
  const bare = buildSharePayload('Job', START, tasks);      // no calendar
  const viewerBare = runCpm(tasksFromSharePayload(bare), cpmOptionsFromSharePayload(bare));
  ok('a 7-day project shared WITHOUT its calendar shows the recipient different dates',
    viewerBare.projectFinish !== senderSeven.projectFinish,
    { sender: senderSeven.projectFinish, viewer: viewerBare.projectFinish });
  // The two minters. `buildScheduleShareUrl` pulls in expo-file-system, so this
  // half is a grep — the behavioural half is the assertion directly above.
  const exportSrc = src('utils/scheduleReportExport.ts');
  ok('buildScheduleShareUrl sends the project calendar with the link',
    /buildSharePayload\(projectName, projectStartDate, tasks, \{[\s\S]{0,200}?workingDaysPerWeek: calendar\?\.workingDaysPerWeek/.test(exportSrc));
  ok('  …and its one caller actually supplies it',
    /buildScheduleShareUrl\(project\.name, startDate, tasks, \{[\s\S]{0,200}?workingDaysPerWeek: project\.schedule\?\.workingDaysPerWeek/
      .test(src('components/schedule/mobile/ExportCenterSheet.tsx')));
  ok('  …and decodeShareToken accepts every version this module can mint',
    /version < 1 \|\| version > SHARE_PAYLOAD_VERSION/.test(src('utils/scheduleOps.ts'))
    && !/parsed\.v !== 1/.test(src('utils/scheduleOps.ts').replace(/\/\/[^\n]*/g, '')));
}

// ── 26. The printed report reads the ENGINE, not the stored pin ─────────────
// §13 proves the report's two tables agree with each other. They agree whether
// or not either reads the engine, because both go through the same accessor —
// so it passed with the fixture's pins happening to match its CPM starts. This
// fixture is built so the pins DELIBERATELY do not match.
console.log('\n26. the report model is driven by cpm');
{
  const rows = [
    T('A', 10, [], { phase: 'Frame', crew: 'Ace' }),
    T('B', 10, ['A'], { phase: 'Frame', crew: 'Ace' }),   // startDay stays the authored 1
    T('C', 5, ['B'], { phase: 'Frame', crew: 'Ace' }),
  ];
  const cpm = runCpm(rows, CAL);
  ok('the fixture really does have pins that disagree with the schedule',
    rows[2].startDay === 1 && cpm.perTask.get('C')!.es > 1, cpm.perTask.get('C')!.es);
  const project = {
    id: 'p', name: 'Job',
    schedule: { startDate: ISO, workingDaysPerWeek: 5, tasks: rows },
  } as unknown as Parameters<typeof assembleScheduleReport>[0]['project'];
  const model = assembleScheduleReport({
    project, tasks: rows, startDateIso: ISO, cpm, baseline: null,
    reportDate: new Date(2026, 2, 2), company: null, nonWorkingDates: [],
  });
  // The model formats dates for print; compare against the same rendering of
  // the engine's own index rather than against a hand-built ISO string.
  const shortOf = (calendarIndex: number) => calendarDayToDate(START, calendarIndex)
    .toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  const cRow = model.ganttRows.find(g => g.title === 'C')!;
  const cCpm = cpm.perTask.get('C')!;
  eq('the Gantt table dates C where the engine schedules it, not where it was pinned',
    cRow.startIso, shortOf(cCpm.es));
  ok('  …which is NOT the pin\'s date', cRow.startIso !== shortOf(1), cRow.startIso);

  // The bar is drawn on a CALENDAR-wide axis (totalDays = cpm.projectFinish),
  // so its width has to be the calendar span. Using the working duration made
  // every bar that crosses a weekend short and the whole chart read early. A is
  // the 10-working-day task: 12 calendar days wide.
  const aRow = model.ganttRows.find(g => g.title === 'A')!;
  const aCpm = cpm.perTask.get('A')!;
  const totalDays = cpm.projectFinish;
  ok('the fixture has a bar whose calendar span exceeds its working duration',
    aCpm.ef - aCpm.es + 1 === 12 && aRow.percent === 0, { span: aCpm.ef - aCpm.es + 1 });
  eq('the bar width is the CALENDAR span, not the working duration',
    Math.round(aRow.bar.widthPct * 1000) / 1000,
    Math.round(Math.max(0.4, (12 / totalDays) * 100) * 1000) / 1000);
  ok('  …and the working duration really would have been narrower',
    (10 / totalDays) * 100 < (12 / totalDays) * 100);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
