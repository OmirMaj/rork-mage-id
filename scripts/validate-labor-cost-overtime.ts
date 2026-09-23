// validate-labor-cost-overtime.ts — wave 3, lane labor-cost (#61, #62, #65, #153, #154).
//
// Pins INTENDED semantics:
//   #65  overtime is allocated per worker per day / payroll week under the
//        GC's rule (federal weekly >40 by default, daily >8 optional), never
//        double counted, landing on the chronologically LATER shifts; the
//        current week is provisional; the stored per-shift overtimeHours is
//        never read; job cost, the cost book, the DFR and Time Tracking all
//        read the allocation.
//   #61  rates live on the account (gc_labor_rates / gc_labor_settings via
//        supabaseWrite) with the device as a cache; newest edit wins cell by
//        cell; computeJobCost reports unpriced hours and every cost screen
//        says so; Margin Alerts raises them instead of reading all-clear.
//   #62  Time Tracking gates per selected job through resolveProjectAccess
//        ('crew_time_tracking'); a seat's roster is the GC's job crew, read
//        separately from his own.
//   #153 the Labor rates sheet sets "Overtime pays ×", echoes the clamp, and
//        the bare-wage hint no longer says to fold OT into the rate.
//   #154 a margin pass that lands mid-flight re-runs from a fresh render.
//
// Run via: bun run scripts/validate-labor-cost-overtime.ts

import {
  computeOvertime, overtimeFor, describeOvertimeRule, payrollWeekStart, normalizeOvertimeRule,
  DEFAULT_OVERTIME_RULE, type OvertimeRule,
} from '../utils/overtime';
import {
  buildLaborSamples, parseCachedBook, mergeRateBooks, bookFromServer, rateMapOf, rateRowFor, settingsRowFor,
  LEGACY_CELL_TIME, type LaborRateBook,
} from '../utils/laborSamples';
import { computeJobCost, unpricedLaborFor, unpricedLaborLine } from '../utils/jobCostEngine';
import { resolveClockGate } from '../utils/collaboratorAccess';
import type { ProjectRole } from '../utils/projectRole';
import { computeAlerts, selectNotifiable, type MarginBaseline } from '../utils/marginAlerts';
import { clockCrewForDay } from '../utils/dfrClockCrew';
import type { Project, TimeEntry } from '../types';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}

// Local wall-clock instants so the day math is timezone-independent.
const at = (day: string, hh: number, mm = 0) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hh, mm).toISOString();
};
let seq = 0;
function shift(o: { worker?: string; day: string; from: number; to: number; project?: string; trade?: string; storedOt?: number; status?: TimeEntry['status']; name?: string }): TimeEntry {
  const hours = o.to - o.from;
  return {
    id: `te${++seq}`,
    projectId: o.project ?? 'henderson', projectName: o.project ?? 'Henderson',
    workerId: o.worker ?? 'jose', workerName: o.name ?? o.worker ?? 'Jose', trade: o.trade ?? 'Framing',
    clockIn: at(o.day, Math.floor(o.from), Math.round((o.from % 1) * 60)),
    clockOut: at(o.day, Math.floor(o.to), Math.round((o.to % 1) * 60)),
    breakMinutes: 0, totalHours: hours, overtimeHours: o.storedOt ?? 0,
    status: o.status ?? 'clocked_out', date: o.day,
  };
}
const DAILY8: OvertimeRule = { weeklyThreshold: 40, dailyThreshold: 8, weekStartsOn: 1 };
// 2026-09-07 is a Monday; the weeks under test are long over.
const TODAY = '2026-10-15';

console.log('\n#65 overtime allocation:');
{
  // Repro A: Henderson 6–12, then Oak St 12:30–5:00 → 10.5 h in the day.
  const a1 = shift({ day: '2026-09-07', from: 6, to: 12 });
  const a2 = shift({ day: '2026-09-07', from: 12.5, to: 17, project: 'oak' });
  const daily = computeOvertime([a2, a1], DAILY8, { today: TODAY });
  ok('REPRO A: split 10.5h day under daily >8 owes 2.5h OT', overtimeFor(daily, a1.id) + overtimeFor(daily, a2.id) === 2.5);
  ok('…all of it on the LATER shift (Oak St got the late hours)', overtimeFor(daily, a1.id) === 0 && overtimeFor(daily, a2.id) === 2.5);
  const fed = computeOvertime([a1, a2], DEFAULT_OVERTIME_RULE, { today: TODAY });
  ok('…and 0 under the federal default (weekly only)', overtimeFor(fed, a1.id) === 0 && overtimeFor(fed, a2.id) === 0);

  // Repro B: four 10h days = 40h → federal OT 0 (the per-shift rule said 8).
  const four = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'].map(d => shift({ worker: 'w4', day: d, from: 6, to: 16, storedOt: 2 }));
  const f4 = computeOvertime(four, DEFAULT_OVERTIME_RULE, { today: TODAY });
  ok('REPRO B: four 10h days = 40h is 0h federal OT (stored 2h/shift ignored)', four.every(e => overtimeFor(f4, e.id) === 0));
  // Five 9h days = 45h → 5h, all on Friday's shift.
  const five = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'].map(d => shift({ worker: 'w5', day: d, from: 7, to: 16 }));
  const f5 = computeOvertime(five, DEFAULT_OVERTIME_RULE, { today: TODAY });
  ok('five 9h days = 45h → 5h OT, on the 5th day only',
    five.slice(0, 4).every(e => overtimeFor(f5, e.id) === 0) && overtimeFor(f5, five[4].id) === 5);
  // Daily + weekly never double counts: five 10h days under daily 8 = 10h OT,
  // not 10 daily + 10 weekly.
  const tens = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'].map(d => shift({ worker: 'w6', day: d, from: 6, to: 16 }));
  const t10 = computeOvertime(tens, DAILY8, { today: TODAY });
  ok('daily + weekly: five 10h days = 10h OT, no hour counted twice',
    tens.reduce((s, e) => s + overtimeFor(t10, e.id), 0) === 10);
  // Six 8h days under daily 8 = 48h, 8 of them weekly OT on day six.
  const six = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'].map(d => shift({ worker: 'w7', day: d, from: 7, to: 15 }));
  const s6 = computeOvertime(six, DAILY8, { today: TODAY });
  ok('six 8h days → 8h weekly OT on the sixth', overtimeFor(s6, six[5].id) === 8 && six.slice(0, 5).every(e => overtimeFor(s6, e.id) === 0));
  // Payroll week start matters.
  ok('week start: Sunday week holds Sun 13 with Mon 14', payrollWeekStart('2026-09-14', 0) === '2026-09-13');
  ok('week start: Monday week starts Mon 14', payrollWeekStart('2026-09-14', 1) === '2026-09-14');
  const sunWeek = [...['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'].map(d => shift({ worker: 'w8', day: d, from: 6, to: 16 })),
    shift({ worker: 'w8', day: '2026-09-13', from: 6, to: 16 })];
  const mon = computeOvertime(sunWeek, { ...DEFAULT_OVERTIME_RULE, weekStartsOn: 1 }, { today: TODAY });
  const sun = computeOvertime(sunWeek, { ...DEFAULT_OVERTIME_RULE, weekStartsOn: 0 }, { today: TODAY });
  ok('the same 50h: Mon-start week puts Sunday in the same week (10h OT)', overtimeFor(mon, sunWeek[4].id) === 10);
  ok('…Sun-start week puts Sunday in the NEXT week (0h OT)', overtimeFor(sun, sunWeek[4].id) === 0);
  // Workers apart; 'self' told apart by name.
  const selfA = shift({ worker: 'self', name: 'Luis', day: '2026-09-07', from: 6, to: 11 });
  const selfB = shift({ worker: 'self', name: 'Dana', day: '2026-09-07', from: 11, to: 16 });
  const sd = computeOvertime([selfA, selfB], DAILY8, { today: TODAY });
  ok("'self' logs are two people, not one 10h day", overtimeFor(sd, selfB.id) === 0);
  // Voice logs ('self', company name, crew-hour TOTALS) are straight time:
  // five days of "24 hours framing" under one name is not one worker's 120h week.
  const voice = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']
    .map(d => shift({ worker: 'self', name: 'Ortiz Builders', day: d, from: 0, to: 24 }));
  const va = computeOvertime(voice, DAILY8, { today: TODAY });
  ok("voice 'self' aggregates carry no OT (#65 review)", voice.every(v => overtimeFor(va, v.id) === 0) && voice.every(v => va.byEntry.has(v.id)));
  const mixed = computeOvertime([...voice, ...['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'].map(d => shift({ worker: 'w11', day: d, from: 6, to: 16 }))], DEFAULT_OVERTIME_RULE, { today: TODAY });
  ok('…and never push a real worker over 40', [...mixed.byEntry.values()].every(h => h === 0));
  // Provisional: the open week.
  const cur = shift({ worker: 'w9', day: '2026-10-14', from: 6, to: 16 });
  const old = shift({ worker: 'w9', day: '2026-09-07', from: 6, to: 16 });
  const pv = computeOvertime([cur, old], DAILY8, { today: TODAY });
  ok('the current payroll week is provisional; a closed week is not', pv.provisional.has(cur.id) && !pv.provisional.has(old.id));
  // Live shifts count only when asked.
  const live = { ...shift({ worker: 'w10', day: '2026-09-07', from: 6, to: 6 }), status: 'clocked_in' as const, clockOut: undefined, totalHours: 0 };
  const noLive = computeOvertime([live], DAILY8, { today: TODAY });
  ok('an open shift is not counted unless liveNowMs is given', !noLive.byEntry.has(live.id));
  const withLive = computeOvertime([live], DAILY8, { today: TODAY, liveNowMs: Date.parse(at('2026-09-07', 16)) });
  ok('…and with it, 10h so far is 2h daily OT, provisional', overtimeFor(withLive, live.id) === 2 && withLive.provisional.has(live.id));
  ok('rule label names the rule', describeOvertimeRule(DEFAULT_OVERTIME_RULE) === 'weekly >40' && describeOvertimeRule(DAILY8) === 'daily >8, weekly >40');
  ok('a corrupt rule falls back piece by piece', JSON.stringify(normalizeOvertimeRule({ weeklyThreshold: 'x', dailyThreshold: 8, weekStartsOn: 9 })) === JSON.stringify({ weeklyThreshold: 40, dailyThreshold: 8, weekStartsOn: 1 }));
}

console.log('\n#65 every consumer reads the allocation:');
{
  const project = { id: 'henderson', name: 'Henderson' } as unknown as Project;
  const base = { project, commitments: [], invoices: [], changeOrders: [], laborRates: { framing: 50 } };
  // Stored per-shift OT is a lie here (4h on a 9h shift); the week is 9h.
  const lone = shift({ worker: 'x1', day: '2026-09-07', from: 7, to: 16, storedOt: 4 });
  ok('job cost ignores the stored per-shift OT (9h × $50 = $450)', computeJobCost({ ...base, timeEntries: [lone] }).actual === 450);
  // Cross-job: 36h on Oak St Mon–Thu then 8h on Henderson Friday → Henderson
  // carries the 4h premium (the later hours), Oak St none.
  const oak = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'].map(d => shift({ worker: 'x2', day: d, from: 7, to: 16, project: 'oak' }));
  const fri = shift({ worker: 'x2', day: '2026-09-11', from: 7, to: 15 });
  const hend = computeJobCost({ ...base, timeEntries: [...oak, fri] });
  ok('Henderson (the late hours) carries the OT premium: 4 × 50 + 4 × 75 = $500', hend.actual === 500, String(hend.actual));
  const samples = buildLaborSamples([...oak, fri], { framing: 50 });
  const hs = samples.find(s => s.projectId === 'henderson')!;
  const os = samples.find(s => s.projectId === 'oak')!;
  ok('the cost book prices the same allocation (Henderson $62.50/h, Oak St $50/h)', hs.actualUnit === 62.5 && os.actualUnit === 50);
  // DFR: 9h shift, stored OT 1 → 0 under the federal default.
  const dfr = clockCrewForDay([lone], 'henderson', '2026-09-07', 'Ortiz', Date.parse(at('2026-09-08', 12)));
  ok('the DFR roster reads the allocation, not the stored figure', dfr?.overtimeHours === 0, JSON.stringify(dfr));
  const dfrDaily = clockCrewForDay([lone], 'henderson', '2026-09-07', 'Ortiz', Date.parse(at('2026-09-08', 12)), DAILY8);
  ok('…and the GC\'s daily rule when the caller passes it (1h)', dfrDaily?.overtimeHours === 1);
  const dfrSrc = src('utils/dfrClockCrew.ts');
  ok('dfrClockCrew never reads e.overtimeHours', !/e\.overtimeHours/.test(dfrSrc));
  const engine = src('utils/jobCostEngine.ts');
  ok('the engine prices from overtimeFor, never the entry itself', /overtimeHours: overtimeFor\(ot, e\.id\)/.test(engine) && !/priceLaborEntry\(e,/.test(engine));
}

console.log('\n#61 unpriced crew hours are said, not silently $0:');
{
  const project = { id: 'henderson', name: 'Henderson' } as unknown as Project;
  const e1 = shift({ worker: 'u1', day: '2026-09-07', from: 7, to: 16, trade: 'Framing' });
  const e2 = shift({ worker: 'u2', day: '2026-09-07', from: 7, to: 12.5, trade: 'Crew' });
  const e3 = shift({ worker: 'u3', day: '2026-09-07', from: 7, to: 15, trade: 'Tile', project: 'oak' });
  const sum = computeJobCost({ project, commitments: [], invoices: [], changeOrders: [], timeEntries: [e1, e2, e3], laborRates: { framing: 50 } });
  ok('computeJobCost returns the unpriced hours on THIS job only', sum.unpricedLaborHours === 5.5, String(sum.unpricedLaborHours));
  ok('…and the trades missing a rate', JSON.stringify(sum.unpricedTrades) === '["general"]');
  ok('priced hours still price', sum.actual === 450);
  ok('unpricedLaborFor agrees', unpricedLaborFor('henderson', [e1, e2, e3], { framing: 50 }).hours === 5.5);
  ok('the line uses the WIP-style wording', unpricedLaborLine(5.5) === '5.5 crew hours on this job have no rate, so labor is not in these numbers.');
  ok('no line when every hour is priced', unpricedLaborLine(0) === '');
  const jc = src('app/job-costing.tsx');
  ok('Job Costing shows the line and links to Time Tracking',
    /summary\.unpricedLaborHours > 0/.test(jc) && /unpricedLaborLine\(summary\.unpricedLaborHours\)/.test(jc) && /pathname: '\/time-tracking'/.test(jc));
  const le = src('app/living-estimate.tsx');
  ok('the Living Estimate shows the line and never "On track" while hours are unpriced',
    /unpricedLaborFor\(project\.id, timeEntries, laborRates\)/.test(le) && /laborGap \? 'Labor unpriced' : 'On track'/.test(le));

  // Margin Alerts: raised as a warning card, never a push, and quiet once seen.
  const b = (h: number): MarginBaseline => ({
    projectId: 'henderson', health: 'healthy', band: 'low', score: 10, marginPct: 0.2, erosionPoints: 0,
    erosionStep: 0, bidAtCost: false, costBasis: 'all_sources', unpricedLaborHours: h, asOf: '2026-09-18',
  });
  const first = computeAlerts({ henderson: b(5.5) }, { henderson: 'Henderson' }, {});
  const card = first.find(a => a.kind === 'unpriced_labor');
  ok('Margin Alerts raises unpriced hours instead of reading all-clear', !!card && /5\.5 crew hours on Henderson have no rate/.test(card.title), JSON.stringify(first));
  ok('…as a warning, never a lock-screen push', !!card && card.severity === 'warning' && selectNotifiable(first).every(a => a.kind !== 'unpriced_labor'));
  ok('…quiet once acknowledged at the same hours', computeAlerts({ henderson: b(5.5) }, { henderson: 'Henderson' }, { henderson: b(5.5) }).every(a => a.kind !== 'unpriced_labor'));
  ok('…raised again when more unpriced hours land', computeAlerts({ henderson: b(9) }, { henderson: 'Henderson' }, { henderson: b(5.5) }).some(a => a.kind === 'unpriced_labor'));
  ok('…and not at all with every hour priced', computeAlerts({ henderson: b(0) }, { henderson: 'Henderson' }, {}).every(a => a.kind !== 'unpriced_labor'));
  // #104 (integration round 1): the card opens the Labor rates sheet on the
  // first unpriced trade, like Job Costing and the Living Estimate.
  const withTrade = computeAlerts({ henderson: { ...b(5.5), unpricedTrade: 'general' } }, { henderson: 'Henderson' }, {}).find(a => a.kind === 'unpriced_labor');
  ok('the unpriced-labor alert carries the first unpriced trade', withTrade?.unpricedTrade === 'general', JSON.stringify(withTrade));
  ok('…taken from unpricedLaborFor on the baseline',
    /const unpriced = unpricedLaborFor\(project\.id, costSources\?\.timeEntries, costSources\?\.laborRates\);/.test(src('utils/marginAlerts.ts'))
      && /\.\.\.\(unpriced\.trades\[0\] \? \{ unpricedTrade: unpriced\.trades\[0\] \} : \{\}\)/.test(src('utils/marginAlerts.ts')));
  const ma = src('app/margin-alerts.tsx');
  ok('Margin Alerts opens the rates sheet on that trade',
    /pathname: '\/time-tracking', params: \{ projectId: a\.projectId, openRates: '1', \.\.\.\(a\.unpricedTrade \? \{ rateTrade: a\.unpricedTrade \} : \{\}\) \}/.test(ma));
}

console.log('\n#61 the rate book follows the account:');
{
  const v1 = parseCachedBook({ framing: 65, tile: 'x', drywall: -3 }, '2');
  ok('a v1 device map is read, junk dropped, dated legacy', JSON.stringify(rateMapOf(v1)) === '{"framing":65}' && v1.rates.framing.updatedAt === LEGACY_CELL_TIME);
  ok('…and the v1 multiplier key is carried', v1.settings?.overtimeMultiplier === 2);
  const server = bookFromServer([
    { trade_key: 'framing', rate: '70.00', updated_at: '2026-09-18T10:00:00.000+00:00' },
    { trade_key: 'electrical', rate: null, updated_at: '2026-09-18T09:00:00Z' },
  ], null);
  const m1 = mergeRateBooks(v1, server);
  ok('the account wins over a legacy device cell', rateMapOf(m1.merged).framing === 70 && !m1.pushRates.includes('framing'));
  ok('a cleared account rate stays cleared (null, not a delete)', !('electrical' in rateMapOf(m1.merged)) && m1.merged.rates.electrical.rate === null);
  ok('a device multiplier the account lacks goes up', m1.pushSettings && m1.merged.settings?.overtimeMultiplier === 2);
  const local: LaborRateBook = { rates: { framing: { rate: 72, updatedAt: '2026-09-18T11:00:00Z' }, tile: { rate: 55, updatedAt: '2026-09-18T08:00:00Z' } }, settings: null };
  const m2 = mergeRateBooks(local, server);
  ok('a NEWER device edit wins and is pushed; a trade the account lacks is pushed',
    rateMapOf(m2.merged).framing === 72 && JSON.stringify(m2.pushRates) === '["framing","tile"]');
  const tie = mergeRateBooks({ rates: { framing: { rate: 1, updatedAt: '2026-09-18T10:00:00Z' } }, settings: null }, server);
  ok('a tie keeps the account copy', rateMapOf(tie.merged).framing === 70 && tie.pushRates.length === 0);
  const row = rateRowFor('u-1', 'framing', { rate: 65.456, updatedAt: '2026-09-18T10:00:00Z' });
  ok('rate rows carry id <user>:<trade> and cents', row.id === 'u-1:framing' && row.rate === 65.46 && row.user_id === 'u-1');
  const srow = settingsRowFor('u-1', { overtimeMultiplier: 15, overtimeRule: DAILY8, updatedAt: 'x' });
  ok('settings row is clamped and keyed by user', srow.id === 'u-1' && srow.overtime_multiplier === 3 && srow.ot_daily_threshold === 8);
  const hook = src('hooks/useLaborRates.ts');
  ok('useLaborRates reads the account and writes through supabaseWrite',
    /from\('gc_labor_rates'\)/.test(hook) && /supabaseWrite\('gc_labor_rates', 'upsert'/.test(hook) && /supabaseWrite\('gc_labor_settings', 'upsert'/.test(hook));
  ok('…keyed per user in the query cache', /\[RATES_QUERY, userId\]/.test(hook));
  // Cache first (review): `rates` must never wait on the network round trip.
  const bookQuery = hook.slice(hook.indexOf('const { data, isLoading } = useQuery({'), hook.indexOf('const { data: fromAccount } = useQuery({'));
  ok('the rates query reads only the device cache (no network on the path to rates)',
    bookQuery.length > 0 && /await readCache\(userId\)/.test(bookQuery) && !/supabase|syncBookWithAccount/.test(bookQuery));
  ok('…and the account read runs as a separate background sync that publishes into it',
    /queryFn: \(\) => syncBookWithAccount\(/.test(hook) && /queryClient\.setQueryData<BookState>\(queryKey, \{ book: merged \}\)/.test(hook));
  const jcHold = src('app/job-costing.tsx');
  ok('Job Costing holds the unpriced banner while the rate book is loading',
    /isLoading: laborRatesLoading \} = useLaborRates\(\)/.test(jcHold) && /!laborRatesLoading && summary\.unpricedLaborHours > 0/.test(jcHold));
  ok('the rates are never parked in DEVICE_SCOPED_KEYS (a cross-tenant leak)', !/mageid_labor/.test(src('utils/localCacheKeys.ts').match(/DEVICE_SCOPED_KEYS[\s\S]*?\]/)?.[0] ?? ''));
  const mig = src('supabase/migrations/20260919180000_gc_labor_rates_and_project_crew.sql');
  ok('the migration makes per-user tables, not the shared market labor_rates',
    /create table if not exists public\.gc_labor_rates/.test(mig) && /create table if not exists public\.gc_labor_settings/.test(mig) && !/alter table public\.labor_rates/.test(mig));
}

console.log('\n#62 a field / editor seat clocks the GC crew on the GC job:');
{
  const tt = src('app/time-tracking.tsx');
  ok('the per-job gate resolves through resolveClockGate against the selected job role',
    /resolveClockGate\(\{/.test(tt) && /ownTierAllows: canAccessOwnTier\('subcontractor_management'\)/.test(tt)
    && /stampedRole = selectedProject\?\.myRole/.test(tt)
    && /useProjectRoleState\(gateProjectId\)/.test(tt) && /useProjectAccess\(gateProjectId\)/.test(tt));
  ok('the outer Business wall only stands with no seat anywhere', /if \(!ownTier && !hasSeat\)/.test(tt));
  ok('the gate UI: spinner, retry, reason', /clockGate\.kind === 'loading'/.test(tt) && /testID="clock-in-gate-retry"/.test(tt) && /clockGate\.reason/.test(tt));
  const L = (role: ProjectRole, isLoading = false, isError = false) => ({ role, isLoading, isError });
  const g = (stampedRole: ProjectRole | undefined, ownTierAllows: boolean, live: ReturnType<typeof L>) =>
    resolveClockGate({ hasProject: true, stampedRole, ownTierAllows, live }).kind;
  ok('OFFLINE: his own job with Business clocks in while the role read errors', g(undefined, true, L(null, false, true)) === 'ok');
  ok('OFFLINE: …and while it is still loading (paused query)', g(undefined, true, L(null, true)) === 'ok');
  ok('his own job without Business is blocked with the reason, not a spinner', g(undefined, false, L(null, true)) === 'blocked');
  ok('OFFLINE: a job stamped field falls back to the stamp on a failed read', g('field', false, L(null, false, true)) === 'ok');
  ok('a job stamped viewer spins while loading and offers retry on error', g('viewer', false, L(null, true)) === 'loading' && g('viewer', false, L(null, false, true)) === 'error');
  ok('gating contract: a RESOLVED null role on a seat job states why', g('field', false, L(null)) === 'blocked');
  ok('a live viewer is blocked; a live field seat is let in', g('field', false, L('viewer')) === 'blocked' && g('viewer', false, L('field')) === 'ok');
  ok('blocked jobs are listed with the reason', /blockedProjects\.map/.test(tt) && /needs a field or editor seat/.test(tt));
  ok('a seat\'s roster and cert chips come from the GC\'s job crew', /useProjectCrew\(gateProjectId, isSeat[,)]/.test(tt) && /isSeat \? projectCrew\.certifications : ownCertifications/.test(tt));
  ok('labor rates / dollars show only on his own book', /\{ownTier \? \(\s*<TouchableOpacity/.test(tt) && /\{!ownTier \? null : laborStats\.sampledEntries > 0/.test(tt));
  const crew = src('contexts/CrewContext.tsx');
  ok('his own roster read names himself (the GC crew never lands in it)', /\.or\(`user_id\.eq\.\$\{userId\},claimed_by_user_id\.eq\.\$\{userId\}`\)/.test(crew));
  ok('the job crew arrives through the two narrow reads', /rpc\('project_crew_roster'/.test(crew) && /rpc\('project_crew_cert_flags'/.test(crew));
}

console.log('\n#65 / #153 Time Tracking reads the allocation and sets the multiplier:');
{
  const tt = src('app/time-tracking.tsx');
  ok('OT badge and today tile read overtimeFor, never entry.overtimeHours', /overtimeFor\(overtime, entry\.id\)/.test(tt) && /overtimeFor\(overtime, e\.id\)/.test(tt) && !/entry\.overtimeHours|e\.overtimeHours/.test(tt));
  ok('"Overtime pays ×" saves with the rates and echoes the clamp',
    /Overtime pays ×/.test(tt) && /onBlur=\{echoClampedMultiplier\}/.test(tt) && /setOvertimeSettings\(\{/.test(tt) && /normalizeOvertimeMultiplier\(n\)/.test(tt));
  ok('the default is shown as the default', /time-and-a-half, the default/.test(tt));
  ok('the bare-wage hint no longer folds OT into the rate', !/comp, taxes, OT, and small tools/.test(tt));
  ok('the correction copy no longer promises "over 8h"', !/recalculated over 8h/.test(tt) && /describeOvertimeRule\(overtimeRule\)/.test(tt));
  const ute = src('hooks/useTimeEntries.ts');
  ok('computeShiftHours documents its OT as the unread legacy per-shift figure', /NOTHING in this build\s+\/\/?\s*\*?\s*reads it|NOTHING in this build/.test(ute));
}

console.log('\n#154 a pass that lands mid-flight re-runs with fresh inputs:');
{
  const m = src('components/MarginAlertManager.tsx');
  ok('the guard queues instead of dropping', /if \(running\.current\) \{ pending\.current = true; return; \}/.test(m));
  ok('finally bumps a tick (fresh render), guarded by mounted', /if \(pending\.current && mounted\.current\) \{\s*pending\.current = false;\s*setRerunTick\(t => t \+ 1\);/.test(m));
  ok('the tick is an effect dependency', /costSources, rerunTick\]\);/.test(m));
  ok('it forwards the OT rule with the rest of the cost streams', /overtimeMultiplier, overtimeRule, equipment/.test(m));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
