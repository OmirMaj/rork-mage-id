// validate-ux-lane-b — on-site operations, friendlier (UX wave, Lane B).
//
// WHAT IT PROVES, per item (the pure rules run under bun; the wiring is pinned
// by reading the screens):
//   B1  crew batch: multi-select, "Clock in N" disabled without a job
//       (PICK_JOB_FIRST) or a pick; ONE lapsed-card confirm names every
//       expired card in the batch; a worker already on the clock is left out;
//       clock-out-all closes only HIS open, non-missed shifts on THAT job at
//       one time that is never in the future or before a clock-in.
//   B2  punch: recent-location chips = last 5 distinct on this job.
//   B3  RFI: typing the answer on an OPEN RFI defaults it to Answered; clearing
//       returns it to Open; "Keep it open" sticks; a non-open record is never
//       touched.
//   B4  lineup: a sub with a phone opens Messages addressed to him with the
//       whole text; no phone → share sheet; no row ever reads "Sent".
//   B5  Tomorrow: the next WORKING day (Friday → Monday), the tasks on it,
//       plain empty sentences, Send hidden when there is nothing.
//   B6  "It's here now": delivery + receipt linked both ways, received-by
//       defaulted, no typed dates, a due/late load from the same supplier is
//       offered instead of a duplicate; a scanned ticket pre-fills.
//   B7  code check: Bid Advisor hidden from a job, Back names the job, a mic
//       and "Check a photo".
//
// Run: bun run scripts/validate-ux-lane-b.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { TimeEntry, ScheduleTask } from '../types';
import type { CertFlag } from '../utils/safety/crewCerts';
import type { Delivery } from '../utils/deliverySchedule';
import {
  toggleCrewPick, toggleAllCrew, livePicks, clockInButton, allCrewChipLabel, splitAlreadyOnClock,
  batchLapsedText, listNames, batchClockOutTargets, batchClockOutJobs, batchOutMs, planBatchClockOut,
} from '../utils/crewClockBatch';
import { PICK_JOB_FIRST } from '../utils/defaultProjectId';
import { recentDistinct, recentPunchLocations, recentSuppliers } from '../utils/recentChips';
import { initialAnswerState, afterAnswerEdit, afterStatusPick, answeredChipText } from '../utils/rfiAnswerDefault';
import {
  lineupSendRoute, lineupRowStatusLabel, textablePhone, queueAfter, queueBanner, textAllLabel,
  OPENED_IN_MESSAGES, YOU_MARKED_SENT,
} from '../utils/lineupTexts';
import { tomorrowBlock, TOMORROW_NOTHING, TOMORROW_NO_START } from '../utils/tomorrowBlock';
import { arrivalProblem, arrivalDayProblem, buildArrival, deliveredAtFor, isUnplannedArrival, lateMatchForSupplier, ARRIVAL_DAY_FUTURE } from '../utils/deliveryArrival';
import { slipDays } from '../utils/supplierScorecard';
import { deliveryArrivalFromScan, scanArrivalParams, scanOpensArrival, resolveDestination } from '../utils/scanRouting';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS  ' + name); return; }
  fail++;
  console.error('  FAIL  ' + name + (detail ? `\n        ${detail}` : ''));
}
function eq<T>(name: string, actual: T, expected: T) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── B1 crew batch ───────────────────────────────────────────────────────────
console.log('\nB1 crew batch:');
const crew = [{ id: 'a', name: 'Ava' }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Carl' }];
eq('toggle adds then removes', toggleCrewPick(toggleCrewPick([], 'a'), 'a'), []);
eq('toggle keeps order', toggleCrewPick(['b'], 'a'), ['b', 'a']);
eq('All N picks every available worker', toggleAllCrew(['a'], crew), ['a', 'b', 'c']);
eq('All N again clears', toggleAllCrew(['a', 'b', 'c'], crew), []);
eq('All N on an empty roster picks nobody', toggleAllCrew([], []), []);
eq('a pick that went on the clock drops out', livePicks(['a', 'z'], crew), ['a']);
eq('no job → disabled with PICK_JOB_FIRST', clockInButton(3, false), { label: 'Clock in', disabled: true, reason: PICK_JOB_FIRST });
eq('job, nobody ticked → disabled', clockInButton(0, true).disabled, true);
eq('job + 6 ticked → "Clock in 6"', clockInButton(6, true), { label: 'Clock in 6', disabled: false, reason: null });
eq('chip label', allCrewChipLabel(6, false), 'All 6 on this project');
eq('chip label when all picked', allCrewChipLabel(6, true), 'Clear all 6');
const split = splitAlreadyOnClock(crew, new Map([['b', { projectName: 'Other job' }]]));
eq('already-on-clock worker is left out', split.go.map(m => m.id), ['a', 'c']);
ok('…and named', !!split.note && /Ben is already on the clock/.test(split.note), split.note ?? '');
eq('nobody on the clock → no note', splitAlreadyOnClock(crew, new Map()).note, null);
const flag = (status: 'expired' | 'expiring', type: string): CertFlag => ({ certId: type, type, expiresDate: '2026-09-12', status, label: '' });
const lapsed = batchLapsedText(crew, { a: [flag('expired', 'SST')], b: [flag('expiring', 'OSHA 30')], c: [flag('expired', 'OSHA 10'), flag('expired', 'SST')] });
ok('ONE confirm lists every expired card in the batch', !!lapsed && lapsed.names.join(',') === 'Ava,Carl' && /Ava: SST/.test(lapsed.message) && /Carl: OSHA 10 .*, SST/.test(lapsed.message), lapsed?.message);
ok('an expiring (not expired) card is not asked about', !!lapsed && !/Ben/.test(lapsed.message));
ok('the confirm counts them', !!lapsed && /^2 crew members you picked have a lapsed card/.test(lapsed.message));
eq('nobody lapsed → no confirm', batchLapsedText(crew, {}), null);
eq('names', listNames(['A', 'B', 'C']), 'A, B and C');

const NOW = new Date(2026, 8, 24, 15, 30, 0).getTime(); // Thu 3:30 pm local
const at = (h: number, m = 0) => new Date(2026, 8, 24, h, m, 0).toISOString();
const entry = (id: string, projectId: string, clockIn: string, over: Partial<TimeEntry> = {}): TimeEntry => ({
  id, projectId, projectName: projectId, workerId: id, workerName: id.toUpperCase(), trade: '', clockIn,
  breakMinutes: 0, totalHours: 0, overtimeHours: 0, status: 'clocked_in', date: '2026-09-24', ...over,
} as TimeEntry);
const own = [
  entry('w1', 'P', at(7)),
  entry('w2', 'P', at(7, 30), { status: 'break' }),
  entry('w3', 'OTHER', at(7)),
  entry('w4', 'P', at(7), { status: 'clocked_out', clockOut: at(12) }),
  entry('w5', 'P', new Date(2026, 8, 22, 7, 0).toISOString(), { date: '2026-09-22' }), // missed (earlier day)
];
eq('targets: his open shifts on THIS job, missed and other jobs left out', batchClockOutTargets(own, 'P', NOW, 8).map(e => e.id), ['w1', 'w2']);
eq('no job → no targets', batchClockOutTargets(own, null, NOW, 8), []);
eq('clock-out-all buttons: the job in view', batchClockOutJobs(own, 'P', NOW, 8), [{ projectId: 'P', count: 2 }]);
eq('…a job in view with one shift gets no button', batchClockOutJobs(own, 'OTHER', NOW, 8), []);
eq('…no job resolved: the job where he has 2+ open shifts', batchClockOutJobs(own, null, NOW, 8), [{ projectId: 'P', count: 2 }]);
eq('…no job resolved, two such jobs: one button each', batchClockOutJobs([...own, entry('w6', 'OTHER', at(8))], null, NOW, 8), [{ projectId: 'P', count: 2 }, { projectId: 'OTHER', count: 2 }]);
const outMs = batchOutMs('3:30 pm', NOW);
eq('"3:30 pm" is today at 15:30', new Date(outMs).getHours() * 60 + new Date(outMs).getMinutes(), 15 * 60 + 30);
ok('garbage time is NaN', Number.isNaN(batchOutMs('lunch', NOW)));
const okPlan = planBatchClockOut({ ownEntries: own, projectId: 'P', jobName: 'Henderson', outMs, nowMs: NOW, alertHours: 8 });
ok('a valid time: no problem, the count and time in the title', okPlan.problem === null && okPlan.title === 'Clock out 2 at 3:30 pm?', `${okPlan.title} / ${okPlan.problem}`);
ok('…the confirm says other projects are not touched', /other projects/.test(okPlan.message));
ok('…and says a running break is taken off (not "break off")', /a running break is taken off/.test(okPlan.message) && !/break off/.test(okPlan.message));
const future = planBatchClockOut({ ownEntries: own, projectId: 'P', jobName: 'Henderson', outMs: NOW + 2 * 3_600_000, nowMs: NOW, alertHours: 8 });
ok('a future time is refused', !!future.problem && /later than now/.test(future.problem), future.problem ?? '');
const beforeIn = planBatchClockOut({ ownEntries: own, projectId: 'P', jobName: 'Henderson', outMs: batchOutMs('7:15 am', NOW), nowMs: NOW, alertHours: 8 });
ok('a time before a worker\'s clock-in is refused and names him', !!beforeIn.problem && /^W2: .*after the clock-in/.test(beforeIn.problem), beforeIn.problem ?? '');
const none = planBatchClockOut({ ownEntries: own, projectId: 'EMPTY', jobName: 'Empty', outMs, nowMs: NOW, alertHours: 8 });
ok('nobody on the job → a sentence, zero targets', none.targets.length === 0 && /Nobody you clocked in/.test(none.problem ?? ''));

// ── B2 recent chips ─────────────────────────────────────────────────────────
console.log('\nB2 recent locations:');
eq('distinct, newest first, first spelling wins', recentDistinct([
  { text: 'Kitchen', at: '2026-09-01' }, { text: 'kitchen ', at: '2026-09-03' }, { text: '', at: '2026-09-09' }, { text: 'Bath', at: '2026-09-02' },
]), ['kitchen', 'Bath']);
const items = ['A', 'B', 'C', 'D', 'E', 'F', 'A'].map((loc, i) => ({ projectId: 'P', location: loc, createdAt: `2026-09-${String(10 + i).padStart(2, '0')}` }));
eq('last 5 distinct on this job', recentPunchLocations([...items, { projectId: 'Q', location: 'Z', createdAt: '2026-09-30' }], 'P', l => (l ?? '').trim() || null), ['A', 'F', 'E', 'D', 'C']);
eq('the legacy placeholder never becomes a chip', recentPunchLocations([{ projectId: 'P', location: 'Unspecified', createdAt: '1' }], 'P', l => (l && l !== 'Unspecified' ? l : null)), []);
eq('suppliers from deliveries and receipts', recentSuppliers(
  [{ projectId: 'P', supplier: 'ABC Supply', updatedAt: '2026-09-01' }],
  [{ projectId: 'P', supplier: 'Home Depot', receivedAt: '2026-09-05' }, { projectId: 'Q', supplier: 'Elsewhere', receivedAt: '2026-09-09' }],
  'P'), ['Home Depot', 'ABC Supply']);

// ── B3 RFI answer default ───────────────────────────────────────────────────
console.log('\nB3 RFI answer:');
let st = initialAnswerState('open');
st = afterAnswerEdit(st, 'Use the LVL', 'open');
eq('typing on an open RFI → Answered (auto)', st, { status: 'answered', auto: true, keepOpen: false });
eq('…with the chip', answeredChipText(st), 'Will save as Answered');
eq('clearing before save → Open again', afterAnswerEdit(st, '   ', 'open'), { status: 'open', auto: false, keepOpen: false });
const kept = afterStatusPick(st, 'open');
eq('"Keep it open" sticks while he types', afterAnswerEdit(kept, 'Use the LVL, 2 ply', 'open').status, 'open');
eq('re-picking Open on a plain open RFI is not an override', afterStatusPick(initialAnswerState('open'), 'open').keepOpen, false);
eq('an answered record is never touched', afterAnswerEdit(initialAnswerState('answered'), '', 'answered'), initialAnswerState('answered'));
eq('a closed record is never touched', afterAnswerEdit(initialAnswerState('closed'), 'x', 'closed').status, 'closed');
eq('only an OPEN saved record defaults (form open, record answered → untouched)', afterAnswerEdit(initialAnswerState('open'), 'x', 'answered'), initialAnswerState('open'));

// ── B4 lineup texts ─────────────────────────────────────────────────────────
console.log('\nB4 lineup texts:');
const body = 'Tomorrow (Fri, Sep 25) at Main St:\nHang board (2nd fl) & tape';
const r = lineupSendRoute({ phone: '(555) 800-0001' }, body, 'ios');
ok('a sub with a phone opens Messages addressed to him with the whole text', r.kind === 'sms' && r.url === `sms:5558000001&body=${encodeURIComponent(body)}`, JSON.stringify(r));
const ra = lineupSendRoute({ phone: '555-800-0001' }, body, 'android');
ok('android/web use ?body=', ra.kind === 'sms' && ra.url.startsWith('sms:5558000001?body='));
eq('no phone → share sheet', lineupSendRoute({ phone: '' }, body, 'ios').kind, 'share');
eq('a 3-digit scrap is not a phone', textablePhone('555'), null);
const labels = (['opened', 'shared', 'marked_sent', 'not_sent'] as const).map(lineupRowStatusLabel);
ok('no row status ever reads exactly "Sent"', labels.every(l => l !== 'Sent' && !/^Sent\b/.test(l ?? '')), labels.join(' | '));
eq('opened reads Opened in Messages', lineupRowStatusLabel('opened'), OPENED_IN_MESSAGES);
eq('web yes reads as his word', lineupRowStatusLabel('marked_sent'), YOU_MARKED_SENT);
eq('queue steps one at a time', queueAfter(['a', 'b', 'c'], 'a'), ['b', 'c']);
eq('banner', queueBanner(['b', 'c'], 3, id => ({ b: 'Bolt', c: 'Cap' } as Record<string, string>)[id]), 'Next: Bolt (2 of 3)');
eq('empty queue → no banner', queueBanner([], 3, () => ''), null);
eq('Text all 4', textAllLabel(4), 'Text all 4');

// ── B5 Tomorrow ─────────────────────────────────────────────────────────────
console.log('\nB5 Tomorrow:');
const T = (id: string, startDay: number, durationDays: number, over: Partial<ScheduleTask> = {}): ScheduleTask =>
  ({ id, title: id, phase: '', startDay, durationDays, status: 'not_started', progress: 0, crew: '', dependencies: [], notes: '', ...over } as unknown as ScheduleTask);
// Mon 2026-09-14 start, 5-day week. Fri 09-18 = day 5, Mon 09-21 = day 6.
const sched = { startDate: '2026-09-14', workingDaysPerWeek: 5, tasks: [T('fri', 5, 1), T('mon', 6, 2), T('done', 6, 1, { status: 'done' })] };
const fri = tomorrowBlock(sched, new Date(2026, 8, 18, 10));
eq('on a Friday, tomorrow is Monday', fri.date, '2026-09-21');
eq('…with Monday\'s open tasks only', fri.tasks.map(t => t.id), ['mon']);
eq('…and Send shown', fri.canSend, true);
const closure = tomorrowBlock({ ...sched, nonWorkingDates: ['2026-09-21'] }, new Date(2026, 8, 18, 10));
eq('a site closure is skipped', closure.date, '2026-09-22');
const empty = tomorrowBlock({ ...sched, tasks: [T('x', 1, 1)] }, new Date(2026, 8, 18, 10));
ok('nothing on the day: says so, hides Send', empty.emptyNote === TOMORROW_NOTHING && !empty.canSend && empty.tasks.length === 0);
const undated = tomorrowBlock({ workingDaysPerWeek: 5, tasks: [T('x', 1, 1)] }, new Date(2026, 8, 18, 10));
ok('no start date: says so, hides Send', undated.emptyNote === TOMORROW_NO_START && !undated.canSend);
ok('no schedule: plain sentence', tomorrowBlock(null, new Date(2026, 8, 18, 10)).emptyNote === TOMORROW_NOTHING);

// ── B6 It's here now ────────────────────────────────────────────────────────
console.log('\nB6 It\'s here now:');
eq('what is required', arrivalProblem({ what: ' ', supplier: 'ABC', date: '2026-09-24' }, '2026-09-27'), 'Say what arrived.');
eq('supplier is required', arrivalProblem({ what: 'Board', supplier: '', date: '2026-09-24' }, '2026-09-27'), 'Name the supplier.');
eq('a typed non-day is refused', arrivalProblem({ what: 'Board', supplier: 'ABC', date: '9/24' }, '2026-09-27'), 'Pick the day it arrived.');
eq('Feb 30 is refused', arrivalProblem({ what: 'Board', supplier: 'ABC', date: '2026-02-30' }, '2026-09-27'), 'Pick the day it arrived.');
const built = buildArrival({
  projectId: 'P', deliveryId: 'd1', receiptId: 'r1', now: new Date('2026-09-24T14:00:00Z'),
  draft: { what: ' 40 sheets 5/8 board ', supplier: ' ABC Supply ', receivedBy: '', date: '2026-09-24', ticketUri: 'u/P/ph1.jpg' },
});
ok('delivery and receipt are linked both ways', built.delivery.receiptId === 'r1' && built.receipt.deliveryId === 'd1');
ok('the delivery is born delivered on the picked day', built.delivery.status === 'delivered' && built.delivery.expectedDate === '2026-09-24' && !!built.delivery.deliveredAt);
ok('the receipt carries the ticket photo and the line', built.receipt.bolPhotoUri === 'u/P/ph1.jpg' && built.receipt.items[0]?.description === '40 sheets 5/8 board');
ok('blank received-by falls back to "Site", never a guessed name', built.receipt.receivedBy === 'Site' && built.delivery.receivedBy === 'Site');
ok('no damage is invented', built.receipt.hasDamage === false);
let threw = false;
try { buildArrival({ projectId: 'P', deliveryId: 'd', receiptId: 'r', now: new Date(), draft: { what: '', supplier: 'x', receivedBy: '', date: '2026-09-24' } }); } catch { threw = true; }
ok('an invalid draft throws (the belt to the disabled Save)', threw);
const dl = (id: string, supplier: string, expectedDate: string, status: Delivery['status'] = 'scheduled'): Delivery =>
  ({ id, projectId: 'P', description: id, supplier, expectedDate, status, createdAt: '', updatedAt: '' });
const pool = [dl('late2', 'ABC Supply', '2026-09-20'), dl('late1', 'abc  supply', '2026-09-18'), dl('future', 'ABC Supply', '2026-09-30'), dl('done', 'ABC Supply', '2026-09-10', 'delivered'), dl('x', 'Other', '2026-09-01')];
eq('the oldest due/late open load from that supplier is offered', lateMatchForSupplier(pool, 'P', 'ABC Supply', '2026-09-24')?.id, 'late1');
eq('a future load is not offered', lateMatchForSupplier([dl('f', 'ABC', '2026-09-30')], 'P', 'ABC', '2026-09-24'), null);
eq('a delivered load is not offered', lateMatchForSupplier([dl('d', 'ABC', '2026-09-01', 'delivered')], 'P', 'ABC', '2026-09-24'), null);
eq('a day that has not come yet is refused (a scanned ticket dated tomorrow)', arrivalProblem({ what: 'Board', supplier: 'ABC', date: '2026-09-28' }, '2026-09-27'), ARRIVAL_DAY_FUTURE);
eq('…today is fine', arrivalDayProblem('2026-09-27', '2026-09-27'), null);
eq('…and so is an earlier day', arrivalDayProblem('2026-09-20', '2026-09-27'), null);
// Fix round 1 — the supplier scorecard reads expectedDate as the promise and
// deliveredAt as the arrival. An unlogged load must not be "late" by the days
// he back-dated, and must be recognisable as never-promised.
const backDated = buildArrival({
  projectId: 'P', deliveryId: 'd2', receiptId: 'r2', now: new Date('2026-09-27T14:00:00Z'),
  draft: { what: 'Mud', supplier: 'ABC Supply', receivedBy: 'Omir', date: '2026-09-25' },
});
eq('a back-dated arrival: deliveredAt is the PICKED day, not the save time', (backDated.delivery.deliveredAt ?? '').slice(0, 10), '2026-09-25');
eq('…so the scorecard reads no slip (was 2 days late)', slipDays(backDated.delivery), 0);
ok('…and it is marked never-promised (created after it was delivered)', isUnplannedArrival(backDated.delivery));
ok('a same-day arrival keeps the real instant and is never-promised', built.delivery.deliveredAt === '2026-09-24T14:00:00.000Z' && isUnplannedArrival(built.delivery));
eq('an evening save (UTC already tomorrow) still lands on the picked day', deliveredAtFor('2026-09-24', new Date('2026-09-25T01:30:00Z')), '2026-09-24T12:00:00.000Z');
const evening = buildArrival({ projectId: 'P', deliveryId: 'd3', receiptId: 'r3', now: new Date('2026-09-25T01:30:00Z'), draft: { what: 'Mud', supplier: 'ABC', receivedBy: '', date: '2026-09-24' } });
ok('…and is still never-promised', isUnplannedArrival(evening.delivery));
ok('a load scheduled first and received later IS a promise', !isUnplannedArrival({ status: 'delivered', createdAt: '2026-09-20T13:00:00.000Z', deliveredAt: deliveredAtFor('2026-09-24', new Date('2026-09-24T15:00:00Z')) }));
ok('an open load is never "unplanned"', !isUnplannedArrival({ status: 'scheduled', createdAt: '2026-09-24T13:00:00.000Z', deliveredAt: undefined }));
let futureThrew = false;
try { buildArrival({ projectId: 'P', deliveryId: 'd', receiptId: 'r', now: new Date(2026, 8, 27, 10), draft: { what: 'x', supplier: 'y', receivedBy: '', date: '2026-09-28' } }); } catch { futureThrew = true; }
ok('buildArrival refuses a day after today (the belt)', futureThrew);
eq('blank supplier → nothing offered', lateMatchForSupplier(pool, 'P', ' ', '2026-09-24'), null);

console.log('\nB6 scan → It\'s here now:');
ok('a delivery ticket opens the sheet', scanOpensArrival('delivery_ticket') && !scanOpensArrival('invoice'));
eq('the ticket still files as an image (no domain record from the scan)', resolveDestination('delivery_ticket').recordKind, 'file_only');
const pre = deliveryArrivalFromScan({ supplier: 'ABC Supply', date: '2026-09-24', items: ['Board', 'Mud', 'Tape', 'Screws'], poNumber: 'PO-7' });
eq('items become one line, capped', pre.what, 'Board, Mud, Tape +1 more');
eq('a real day pre-fills', pre.date, '2026-09-24');
eq('a printed "3/4/26" does not', deliveryArrivalFromScan({ date: '3/4/26' }).date, null);
eq('no items → the ticket number', deliveryArrivalFromScan({ ticketNumber: 'T-9' }).what, 'Ticket T-9');
eq('blank values are left out of the params', scanArrivalParams({ what: '', supplier: 'ABC', date: null, poNumber: '' }, 'p/x.jpg'), { fromScan: '1', supplier: 'ABC', ticket: 'p/x.jpg' });

// ── Wiring (the screens) ────────────────────────────────────────────────────
console.log('\nwiring:');
const TT = read('app/time-tracking.tsx');
ok('time clock defaults the job with pickDefaultProjectId (never projects[0])', /pickDefaultProjectId\(/.test(TT) && !/:\s*projects\[0\]\.id/.test(TT));
ok('time clock honours clockIn=1', /openClockIn/.test(TT));
ok('the batch runs the lapsed-card confirm (batchLapsedText)', /batchLapsedText\(/.test(TT));
ok('the batch keeps the not-synced refusal', /hasn\\u2019t synced to your account yet/.test(TT));
ok('clock-out-all goes through planBatchClockOut and doClockOut', /planBatchClockOut\(/.test(TT) && /doClockOut\(e\.id, outIso\)/.test(TT));
ok('the single-tap clock-in still exists', /const handleClockIn = useCallback/.test(TT));
ok('clock-out-all buttons come from batchClockOutJobs (one per job when none is picked)', /batchClockOutJobs\(/.test(TT) && /batchOutJobs\.map\(/.test(TT));

const PL = read('app/punch-list.tsx');
ok('punch: a sticky Add bar outside the list footer', /testID="punch-add-bar"/.test(PL) && !/listFooter[\s\S]{0,400}testID="add-punch-item"/.test(PL));
ok('punch: honours new=1', /openNew/.test(PL));
ok('punch: a mic on Description (VoiceRecorder, phone only)', /<VoiceRecorder[\s\S]{0,400}punch/i.test(PL) && /Platform\.OS !== 'web'/.test(PL));
ok('punch: recent-location chips', /recentPunchLocations\(/.test(PL));

const RF = read('app/rfi.tsx');
ok('rfi: the responseShown gate is gone', !/responseShown/.test(RF));
ok('rfi: "Record the answer" sits under the Question', /testID="rfi-question"[\s\S]{0,2500}RECORD_ANSWER_LABEL/.test(RF));
ok('rfi: the answer default runs through afterAnswerEdit', /afterAnswerEdit\(/.test(RF));
ok('rfi: "Keep theirs" goes through onChangeAnswer (the Answered default re-evaluates)', /testID="rfi-conflict-keep-theirs"[\s\S]{0,300}onPress=\{\(\) => \{ onChangeAnswer\(responseConflict\.theirs\);/.test(RF));

const LU = read('app/tomorrow-lineup.tsx');
ok('lineup: Send routes through lineupSendRoute (smsUrl) and opens it', /const route = lineupSendRoute\(s\.sub, message, Platform\.OS\);\s*if \(route\.kind === 'share'\)/.test(LU) && /await Linking\.openURL\(route\.url\)/.test(LU));
ok('lineup: web asks "Did you send it?"', /Did you send it\?/.test(LU));
ok('lineup: no size="sm" on the per-sub Send (gloves)', !/label="Send…" size="sm"/.test(LU));
ok('lineup: the reminder row is untouched', /<LineupReminderRow \/>/.test(LU));

const TV = read('components/schedule/TodayView.tsx');
ok('TodayView: a Tomorrow block via tomorrowBlock()', /tomorrowBlock\(/.test(TV) && /testID="today-tomorrow"/.test(TV));
ok('TodayView: the lineup door checks schedule_gantt_pdf', /schedule_gantt_pdf/.test(TV) && /tomorrowLineupHref\(/.test(TV));

const DL = read('app/deliveries.tsx');
ok('deliveries: no typed YYYY-MM-DD left', !/YYYY-MM-DD"/.test(DL));
ok('deliveries: honours arrived=1', /openArrived/.test(DL));
ok('deliveries: "It\'s here now" writes through buildArrival + the context writers', /buildArrival\(/.test(DL) && /addDelivery\(delivery\)/.test(DL) && /addDeliveryReceipt\(receipt\)/.test(DL));
ok('deliveries: never supabase.from directly', !/supabase\.from\(/.test(DL));
ok('deliveries: "Mark this one received" stamps deliveredAt on the picked day', /deliveredAt: extra\?\.date \? deliveredAtFor\(extra\.date, now\) : now\.toISOString\(\)/.test(DL));
ok('deliveries: the sheet checks the day against today (both paths)', /arrivalProblem\(form, todayLocal\(\)\)/.test(DL) && /arrivalDayProblem\(form\.date, todayLocal\(\)\)/.test(DL));

const SC = read('app/scan.tsx');
ok('scan: a filed delivery ticket opens It\'s here now', /scanOpensArrival\(/.test(SC) && /deliveryArrivedHref\(/.test(SC));

const CA = read('app/(tabs)/construction-ai/index.tsx');
ok('code check: Bid Advisor hidden when opened from a record', /fromRecord[\s\S]{0,200}construction-ai-bid-advisor|!fromRecord \?/.test(CA));
ok('code check: Back names the job', /HiddenTabBackLink[\s\S]{0,300}backLabel/.test(CA));
ok('code check: "Check a photo" opens CodeLookSheet', /code-check-photo/.test(CA) && /<CodeLookSheet/.test(CA));
const PC = read('components/codeThread/ProjectCodeChecksCard.tsx');
ok('job card: "Check a photo" beside "Code check this job"', /codethread-check-photo/.test(PC) && /<CodeLookSheet/.test(PC));

// ── B5 on the phone ─────────────────────────────────────────────────────────
// The iPhone's schedule tab is MobileScheduleScreen, which never mounts
// TodayView, so the Tomorrow answer lives in MobileTomorrowCard there: the
// same pure rule, the same schedule_gantt_pdf-gated door, locked with a reason.
console.log('\nB5 Tomorrow on the phone:');
{
  const card = read('components/schedule/mobile/MobileTomorrowCard.tsx');
  const screen = read('components/schedule/mobile/MobileScheduleScreen.tsx');
  ok('phone: the schedule tab mounts MobileTomorrowCard with the tasks it shows', /<MobileTomorrowCard projectId=\{selectedProject\.id\} schedule=\{activeSchedule\} tasks=\{tasks\} \/>/.test(screen));
  ok('phone: only on a dated schedule (an undated one has no day to name)', /\{!isUndated && activeSchedule \? \(\s*<MobileTomorrowCard/.test(screen));
  ok('phone: the card reads tomorrowBlock (the same rule as TodayView)', /tomorrowBlock\(\{ \.\.\.schedule, tasks \}, new Date\(\)\)/.test(card));
  ok('phone: the lineup door checks schedule_gantt_pdf through useProjectAccess', /useProjectAccess\(projectId\)/.test(card) && /access\.canAccess\('schedule_gantt_pdf'\)/.test(card));
  ok('phone: the door goes to /tomorrow-lineup and shows only when there is something to send', /router\.push\(tomorrowLineupHref\(projectId\)\)/.test(card) && /\{block\.canSend \? \(/.test(card));
  ok('phone: locked, it names the plan instead of disappearing', /testID="schedule-tomorrow-locked"/.test(card) && /is on the \$\{plan\} plan/.test(card));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
