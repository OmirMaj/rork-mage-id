// validate-tomorrow-lineup.ts — the next-day lineup states only what the
// records carry (utils/tomorrowLineup).
//
// Pins: tasks land on the day through the schedule's own calendar helpers
// (utils/scheduleOps — the same ones the 6 AM brief is held to), unassigned
// tasks become a gap, finished tasks drop out, confirmed vs requested access
// wording, every inspection is "time not set", deliveries reach a sub ONLY
// through commitmentId → Commitment.subcontractorId, a sub with no phone or
// email is flagged, the empty-day and no-schedule sentences, no invented time
// in any message (a property over generated fixtures), and no send API in the
// module's imports.
//
// Run: bun run scripts/validate-tomorrow-lineup.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Commitment, Permit, ScheduleTask, Subcontractor } from '../types';
import type { Delivery } from '../utils/deliverySchedule';
import type { AccessReservation } from '../utils/buildingAccess';
import {
  buildLineup, nextWorkingDay, lineupHeadline, dayPhraseFor, NO_SCHEDULE_NOTE, TIME_NOT_SET, type LineupInput,
} from '../utils/tomorrowLineup';
import { resolveScheduleAnchor, scheduleDayOnCalendar, isTaskActiveOnScheduleDay } from '../utils/scheduleOps';
import { parseCalendarDay, toCalendarDayString, addCalendarDays } from '../utils/calendarDate';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// ── Fixtures: a Tue Sep 1 2026 start, 5-day week. Tue Sep 29 = working day 21.
const T = (id: string, startDay: number, durationDays: number, over: Partial<ScheduleTask> = {}): ScheduleTask =>
  ({ id, title: id, phase: '', startDay, durationDays, status: 'not_started', progress: 0, crew: '', dependencies: [], notes: '', ...over } as unknown as ScheduleTask);
const sub = (id: string, name: string, over: Partial<Subcontractor> = {}): Subcontractor =>
  ({ id, companyName: name, contactName: '', phone: '555-0100', email: '', trade: '', ...over } as Subcontractor);
const SUBS = [sub('A', 'Acme Drywall'), sub('B', 'Bolt Electric'), sub('N', 'Nocontact Tile', { phone: '', email: '' })];
const COMMITS = [
  { id: 'kA', projectId: 'P', subcontractorId: 'A', type: 'subcontract' },
  { id: 'kNone', projectId: 'P', type: 'purchase_order' },
] as unknown as Commitment[];
const TASKS = [
  T('hang', 18, 5, { title: 'Hang board', phase: '2nd fl', assignedSubId: 'A' }),
  T('rough', 21, 1, { title: 'Rough-in', assignedSubId: 'B' }),
  T('tile', 21, 2, { title: 'Set tile', assignedSubId: 'N' }),
  T('clean', 20, 3, { title: 'Clean-up' }),
  T('done', 19, 5, { title: 'Finished work', status: 'done', assignedSubId: 'A' }),
  T('pct', 19, 5, { title: 'At 100', progress: 100, status: 'in_progress', assignedSubId: 'A' }),
  T('later', 30, 2, { title: 'Later task', assignedSubId: 'A' }),
];
const SCHED = { startDate: '2026-09-01', workingDaysPerWeek: 5, tasks: TASKS };
const DELIV = (id: string, over: Partial<Delivery>): Delivery =>
  ({ id, projectId: 'P', description: 'Load', supplier: 'Supply Co', expectedDate: '2026-09-29', status: 'confirmed', createdAt: '', updatedAt: '', ...over } as Delivery);
const RES = (id: string, over: Partial<AccessReservation>): AccessReservation =>
  ({ id, projectId: 'P', kind: 'freight_elevator', date: '2026-09-29', status: 'confirmed', createdAt: '', updatedAt: '', ...over } as AccessReservation);
const PERMIT = (inspections: Permit['inspections']): Permit =>
  ({ id: 'pm1', projectId: 'P', projectName: 'Main', type: 'plumbing', jurisdiction: 'NYC', status: 'approved', appliedDate: '', fee: 0, inspections } as unknown as Permit);
const NOW = new Date(2026, 8, 28, 16, 0, 0); // Mon Sep 28, 4 pm local

const input = (over: Partial<LineupInput> = {}): LineupInput => ({
  project: { id: 'P', name: 'Main St', location: '123 Main St' },
  date: '2026-09-29',
  schedule: SCHED,
  subs: SUBS,
  commitments: COMMITS,
  deliveries: [],
  accessReservations: [],
  permits: [],
  now: NOW,
  ...over,
});

// ── 1. Tasks through the real calendar helper ──────────────────────────────
console.log('\ntasks on the day (utils/scheduleOps):');
{
  const L = buildLineup(input());
  const byId = new Map(L.perSub.map(s => [s.sub.id, s]));
  eq('Acme gets the spanning task only', byId.get('A')?.tasks.map(t => t.id), ['hang']);
  eq('Bolt gets its one-day task', byId.get('B')?.tasks.map(t => t.id), ['rough']);
  ok('a task marked done is excluded', !L.perSub.some(s => s.tasks.some(t => t.id === 'done')));
  ok('a task at 100% is excluded', !L.perSub.some(s => s.tasks.some(t => t.id === 'pct')));
  ok('a later task is not on the day', !L.perSub.some(s => s.tasks.some(t => t.id === 'later')));
  ok('the area rides with the task', byId.get('A')!.message.includes('Hang board (2nd fl)'));

  // Agreement with the helpers over three weeks of days.
  const anchor = resolveScheduleAnchor(SCHED).date!;
  let mismatches = 0; let first = '';
  for (let off = -3; off < 40; off++) {
    const d = addCalendarDays(anchor, off);
    const iso = toCalendarDayString(d);
    const n = scheduleDayOnCalendar(anchor, d, 5);
    const want = n == null ? [] : TASKS.filter(t => t.assignedSubId && isTaskActiveOnScheduleDay(t, n)).map(t => t.id).sort();
    const got = buildLineup(input({ date: iso })).perSub.flatMap(s => s.tasks.map(t => t.id)).sort();
    if (want.join() !== got.join()) { mismatches++; if (!first) first = `${iso}: want ${want} got ${got}`; }
  }
  ok('lineup == isTaskActiveOnScheduleDay(scheduleDayOnCalendar) for 43 days', mismatches === 0, first);

  const sat = buildLineup(input({ date: '2026-10-03' }));
  ok('a Saturday on a 5-day week has no tasks and says why', sat.perSub.length === 0 && sat.gaps.some(g => /not a working day/.test(g)), JSON.stringify(sat.gaps));
}

// ── 2. Gaps ────────────────────────────────────────────────────────────────
console.log('\ngaps:');
{
  const L = buildLineup(input());
  ok('unassigned tasks → a gap naming them', L.gaps.some(g => g.startsWith("1 task tomorrow has no sub assigned — it's not in any message: Clean-up")), JSON.stringify(L.gaps));
  ok('…and they are in no message', !L.perSub.some(s => s.message.includes('Clean-up')));
  const withGhost = buildLineup(input({ schedule: { ...SCHED, tasks: [...TASKS, T('ghost', 21, 1, { title: 'Ghost work', assignedSubId: 'GONE' })] } }));
  ok('a task assigned to a deleted sub → a gap, no message', withGhost.gaps.some(g => g.includes('Ghost work')) && !withGhost.perSub.some(s => s.sub.id === 'GONE'));
}

// ── 3. Access wording ──────────────────────────────────────────────────────
console.log('\naccess:');
{
  const L = buildLineup(input({
    accessReservations: [
      RES('r1', { window: '07:00-09:00', confirmationRef: 'BK-12' }),
      RES('r2', { kind: 'dock', status: 'requested', window: '10:00-11:00' }),
      RES('r3', { kind: 'after_hours', status: 'denied' }),
      RES('r4', { kind: 'hot_work', status: 'cancelled' }),
      RES('r5', { kind: 'badging', window: undefined }),
    ],
  }));
  const msg = L.perSub.find(s => s.sub.id === 'A')!.message;
  ok('a confirmed slot is "booked" with its window and ref', msg.includes('freight elevator booked 07:00-09:00, ref BK-12'), msg);
  ok('a requested slot says the building has not confirmed it', msg.includes('loading dock 10:00-11:00 requested, not yet confirmed by the building') && !/loading dock booked/.test(msg), msg);
  ok('a confirmed slot with no window says time not set', msg.includes(`badging booked (${TIME_NOT_SET})`), msg);
  ok('denied / cancelled slots are in no message', !/after-hours|hot work/.test(msg));
  ok('…and each is named in the gaps', L.gaps.some(g => /after-hours work.*denied by the building/.test(g)) && L.gaps.some(g => /hot work permit.*cancelled/.test(g)));
}

// ── 4. Inspections: always "time not set" ──────────────────────────────────
console.log('\ninspections:');
{
  const L = buildLineup(input({
    permits: [PERMIT([
      { id: 'i1', name: 'Plumbing rough', scheduledFor: '2026-09-29', result: 'scheduled', recordedAt: '' },
      { id: 'i2', name: 'Final inspection', scheduledFor: '2026-09-29', result: 'scheduled', recordedAt: '' },
      { id: 'i3', name: 'Footing', scheduledFor: '2026-09-29', result: 'passed', recordedAt: '' },
      { id: 'i4', name: 'Framing', scheduledFor: '2026-09-30', result: 'scheduled', recordedAt: '' },
    ])],
  }));
  eq('every scheduled inspection on the day reads "time not set"', L.siteWide.inspections.map(i => i.text),
    ['Plumbing rough inspection — time not set', 'Final inspection — time not set']);
  ok('a passed or other-day inspection is left out', !L.siteWide.inspections.some(i => /Footing|Framing/.test(i.text)));
  ok('every message carries them', L.perSub.every(s => s.message.includes('Plumbing rough inspection — time not set')));
}

// ── 5. Deliveries tie through records only ─────────────────────────────────
console.log('\ndeliveries:');
{
  const L = buildLineup(input({
    deliveries: [
      DELIV('d1', { description: 'Board', commitmentId: 'kA', window: '08:00-09:00' }),
      DELIV('d2', { description: 'Conduit for Bolt Electric', commitmentId: undefined }),
      DELIV('d3', { description: 'Fixtures', commitmentId: 'kNone' }),
      DELIV('d4', { description: 'Studs', commitmentId: 'kA', status: 'scheduled' }),
      DELIV('d5', { description: 'Cancelled load', commitmentId: 'kA', status: 'cancelled' }),
    ],
  }));
  const a = L.perSub.find(s => s.sub.id === 'A')!;
  const b = L.perSub.find(s => s.sub.id === 'B')!;
  ok("a delivery on sub A's subcontract lands in A's message", a.message.includes('Board from Supply Co, window 08:00-09:00'), a.message);
  ok("one with no time says so, and an unconfirmed one says the supplier hasn't confirmed", a.message.includes(`Studs from Supply Co, ${TIME_NOT_SET} (not confirmed by the supplier)`), a.message);
  ok('a description naming sub B does NOT go to B', !b.message.includes('Conduit'));
  eq('no commitmentId / a commitment with no sub → site-wide', L.siteWide.deliveries.map(d => d.id), ['d2', 'd3']);
  ok('a cancelled delivery is nowhere', !JSON.stringify(L).includes('Cancelled load'));
}

// ── 6. Contacts, empty day, no schedule ────────────────────────────────────
console.log('\ncontacts and empty states:');
{
  const L = buildLineup(input());
  ok('a sub with no phone and no email is flagged', L.perSub.find(s => s.sub.id === 'N')!.noContact === true);
  ok('…and still gets a message', L.perSub.find(s => s.sub.id === 'N')!.message.startsWith('Nocontact Tile:'));
  ok('a sub with a phone is not flagged', L.perSub.find(s => s.sub.id === 'A')!.noContact === false);

  const empty = buildLineup(input({ schedule: { ...SCHED, tasks: [T('x', 60, 1, { assignedSubId: 'A' })] } }));
  eq('nothing on the day → "Nothing scheduled for <date> on this project"', empty.emptyNote, 'Nothing scheduled for Tue, Sep 29 on this project');
  eq('no schedule → the no-schedule sentence', buildLineup(input({ schedule: null })).emptyNote, NO_SCHEDULE_NOTE);
  eq('a schedule with no tasks → the no-schedule sentence', buildLineup(input({ schedule: { ...SCHED, tasks: [] } })).emptyNote, NO_SCHEDULE_NOTE);
  const undated = buildLineup(input({ schedule: { ...SCHED, startDate: undefined } }));
  ok('an undated schedule says it cannot place tasks', undated.emptyNote === NO_SCHEDULE_NOTE && undated.gaps.some(g => /no start date/.test(g)));
  const siteOnly = buildLineup(input({ schedule: null, deliveries: [DELIV('d9', { description: 'Pallets' })] }));
  ok('no schedule but a site delivery → not empty, and the gap says why no tasks', siteOnly.emptyNote === null && siteOnly.gaps.includes(NO_SCHEDULE_NOTE));
}

// ── 7. No invented time (property over generated fixtures) ─────────────────
console.log('\nno invented time:');
{
  const TIME = /\b\d{1,2}:\d{2}\b|\b\d{1,2}\s?(?:am|pm|a\.m\.|p\.m\.)\b/gi;
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const windows = ['07:00-09:00', '8-10', '10:30-11:15', undefined, undefined, 'morning'];
  let violations = 0; let first = '';
  for (let k = 0; k < 300; k++) {
    const dels: Delivery[] = []; const res: AccessReservation[] = [];
    for (let i = 0; i < rnd(4); i++) dels.push(DELIV(`d${k}-${i}`, { commitmentId: rnd(2) ? 'kA' : undefined, window: windows[rnd(windows.length)], status: rnd(2) ? 'confirmed' : 'scheduled' }));
    for (let i = 0; i < rnd(3); i++) res.push(RES(`r${k}-${i}`, { window: windows[rnd(windows.length)], status: (['confirmed', 'requested', 'denied'] as const)[rnd(3)] }));
    const L = buildLineup(input({ deliveries: dels, accessReservations: res, permits: [PERMIT([{ id: 'i', name: `Insp ${k}`, scheduledFor: '2026-09-29', result: 'scheduled', recordedAt: '' }])] }));
    const allowed = [...dels.map(d => d.window), ...res.map(r => r.window)].filter(Boolean).join(' ');
    for (const s of L.perSub) {
      for (const m of s.message.match(TIME) ?? []) {
        if (!allowed.includes(m)) { violations++; if (!first) first = `${m} in: ${s.message}`; }
      }
    }
  }
  ok('every time in 300 generated lineups comes from a record window', violations === 0, first);
}

// ── 8. Days, headline ──────────────────────────────────────────────────────
console.log('\nthe day and the headline:');
{
  eq('Friday → Monday on a 5-day week', nextWorkingDay(new Date(2026, 8, 25, 10), { workingDaysPerWeek: 5 }), '2026-09-28');
  eq('Friday → Saturday on a 6-day week', nextWorkingDay(new Date(2026, 8, 25, 10), { workingDaysPerWeek: 6 }), '2026-09-26');
  eq('a site closure is skipped', nextWorkingDay(new Date(2026, 8, 25, 10), { workingDaysPerWeek: 5, nonWorkingDates: ['2026-09-28'] }), '2026-09-29');
  eq('no schedule → simply tomorrow', nextWorkingDay(new Date(2026, 8, 25, 10), null), '2026-09-26');
  eq('after 3 pm: ready to send', lineupHeadline(new Date(2026, 8, 28, 15, 0)), "Tomorrow's lineup — ready to send");
  eq('before 3 pm: a preview', lineupHeadline(new Date(2026, 8, 28, 14, 59)), "Tomorrow's lineup (preview — schedules can still change today)");
  eq('"tomorrow" only when it is', [dayPhraseFor('2026-09-29', NOW), dayPhraseFor('2026-09-30', NOW)], ['tomorrow (Tue, Sep 29)', 'on Wed, Sep 30']);
  ok('parseCalendarDay round-trip sanity', toCalendarDayString(parseCalendarDay('2026-09-29')!) === '2026-09-29');
  const long = buildLineup(input({ schedule: { ...SCHED, tasks: Array.from({ length: 40 }, (_, i) => T(`t${i}`, 21, 1, { title: `A fairly long task name number ${i}`, phase: 'Level 2 east wing', assignedSubId: 'A' })) } }));
  const m = long.perSub.find(s => s.sub.id === 'A')!.message;
  ok('a crowded day stays near one SMS screen (≤ ~600 chars) and says how many more', m.length <= 650 && /\+\d+ more/.test(m), `${m.length}: ${m}`);
}

// ── 9. No send API in the module ───────────────────────────────────────────
console.log('\nstatic scan:');
{
  const src = readFileSync(join(ROOT, 'utils/tomorrowLineup.ts'), 'utf8');
  const imports = [...src.matchAll(/^\s*import[\s\S]*?from\s+['"]([^'"]+)['"]/gm)].map(m => m[0]);
  ok('no Linking / SMS / fetch / supabase / share import', imports.every(i => !/Linking|sms|fetch|supabase|shareText|Share\b|emailService|expo-/i.test(i)), imports.join('\n'));
  const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('no fetch( / Linking. / supabase. call in the code', !/\bfetch\(|\bLinking\.|\bsupabase\./.test(code));
}

// ── 10. The 3 pm weekday reminder (list 3, lane FA) ────────────────────────
// utils/lineupReminder: five fixed-id WEEKLY local notifications, Mon–Fri at
// 15:00, carrying no project/sub/schedule data; opt-in with the OS prompt only
// from his tap on the lineup screen; the OS schedule is the only state.
console.log('\nthe 3 pm weekday reminder:');
{
  const BUN_TEST = 'bun:test';
  const { mock } = (await import(BUN_TEST)) as {
    mock: { module: (specifier: string, factory: () => Record<string, unknown>) => void };
  };
  const platform = { OS: 'ios' as string };
  const calls: string[] = [];
  const scheduled = new Map<string, unknown>();
  let permission = 'granted';
  let promptAnswer = 'granted';
  let failOnSchedule = -1;
  let readThrows = false;
  const fake = {
    getPermissionsAsync: async () => { calls.push('getPermissions'); return { status: permission }; },
    requestPermissionsAsync: async () => { calls.push('requestPermissions'); permission = promptAnswer; return { status: promptAnswer }; },
    setNotificationChannelAsync: async (id: string) => { calls.push(`channel:${id}`); return null; },
    scheduleNotificationAsync: async (req: { identifier: string }) => {
      if (failOnSchedule >= 0 && scheduled.size === failOnSchedule) throw new Error('boom');
      calls.push(`schedule:${req.identifier}`); scheduled.set(req.identifier, req); return req.identifier;
    },
    cancelScheduledNotificationAsync: async (id: string) => { calls.push(`cancel:${id}`); scheduled.delete(id); },
    getAllScheduledNotificationsAsync: async () => {
      if (readThrows) throw new Error('read');
      return [...scheduled.keys(), 'some-other-nudge'].map(identifier => ({ identifier }));
    },
    AndroidImportance: { MAX: 5 },
    SchedulableTriggerInputTypes: { WEEKLY: 'weekly', TIME_INTERVAL: 'timeInterval', DATE: 'date' },
  };
  mock.module('react-native', () => ({ Platform: platform }));
  mock.module('expo-notifications', () => ({ ...fake, default: fake }));
  const R = await import('../utils/lineupReminder');
  const reset = () => { calls.length = 0; scheduled.clear(); permission = 'granted'; promptAnswer = 'granted'; failOnSchedule = -1; readThrows = false; platform.OS = 'ios'; };

  const reqs = R.lineupReminderRequests();
  eq('exactly five requests', reqs.length, 5);
  eq('Mon–Fri in expo numbering (2–6)', reqs.map(r => (r.trigger as { weekday: number }).weekday), [2, 3, 4, 5, 6]);
  ok('every trigger fires at 15:00', reqs.every(r => (r.trigger as { hour: number; minute: number }).hour === 15 && (r.trigger as { minute: number }).minute === 0));
  ok('every trigger carries `type` === WEEKLY (a type-less trigger fires immediately)', reqs.every(r => !!r.trigger && (r.trigger as { type?: string }).type === 'weekly'));
  const ids = reqs.map(r => r.identifier ?? '');
  ok('unique fixed identifiers under the prefix', new Set(ids).size === 5 && ids.every(i => i.startsWith(R.LINEUP_REMINDER_ID_PREFIX)), ids.join(','));
  ok("data is only { kind: 'tomorrow_lineup' }", reqs.every(r => JSON.stringify(r.content.data) === JSON.stringify({ kind: 'tomorrow_lineup' })));
  ok('title and body carry no project / sub / schedule placeholder', reqs.every(r => !/\$\{|\{\{|project|job\b|sub\b.*:|Acme|\d{4}-\d{2}/i.test(`${r.content.title} ${r.content.body}`)), `${reqs[0].content.title} / ${reqs[0].content.body}`);
  ok('iOS: no Android channel on the trigger', reqs.every(r => (r.trigger as { channelId?: string }).channelId === undefined));
  platform.OS = 'android';
  ok("Android: every trigger on the 'default' channel", R.lineupReminderRequests().every(r => (r.trigger as { channelId?: string }).channelId === 'default'));
  platform.OS = 'ios';
  ok('the help line says it can’t see the schedule', R.lineupReminderCopy.help.includes('can’t see your schedule'));
  ok('the help line says nothing is sent', R.lineupReminderCopy.help.includes('Nothing is sent'));

  reset();
  eq('arm (granted) → armed', await R.armLineupReminder({ prompt: true }), 'armed');
  eq('…all five scheduled', [...scheduled.keys()].sort(), [...ids].sort());
  ok('…cancels all five BEFORE scheduling any', calls.findIndex(c => c.startsWith('schedule:')) > calls.filter(c => c.startsWith('cancel:')).length - 1
    && calls.slice(0, calls.findIndex(c => c.startsWith('schedule:'))).filter(c => c.startsWith('cancel:')).length === 5, calls.join(','));
  ok('…already granted → never prompts', !calls.includes('requestPermissions'));
  eq('isLineupReminderArmed → true with all five', await R.isLineupReminderArmed(), true);
  scheduled.delete(ids[2]);
  eq('a partial set reads off (a tap re-arms cleanly)', await R.isLineupReminderArmed(), false);

  reset();
  permission = 'denied'; promptAnswer = 'denied';
  eq('prompt:false with no permission → no_permission, no prompt', await R.armLineupReminder({ prompt: false }), 'no_permission');
  ok('…never asked the OS', !calls.includes('requestPermissions') && scheduled.size === 0);
  eq('prompt:true and he declines → no_permission', await R.armLineupReminder({ prompt: true }), 'no_permission');
  ok('…asked once, scheduled nothing', calls.filter(c => c === 'requestPermissions').length === 1 && scheduled.size === 0);

  reset();
  failOnSchedule = 3;
  eq('a schedule throw → failed', await R.armLineupReminder({ prompt: true }), 'failed');
  eq('…and the half-armed week is cancelled', scheduled.size, 0);

  reset();
  platform.OS = 'android';
  await R.armLineupReminder({ prompt: true });
  ok("Android sets up the 'default' channel before scheduling", calls.indexOf('channel:default') >= 0 && calls.indexOf('channel:default') < calls.findIndex(c => c.startsWith('schedule:')));

  reset();
  await R.armLineupReminder({ prompt: true });
  calls.length = 0;
  await R.disarmLineupReminder();
  eq('disarm cancels exactly the five', calls.filter(c => c.startsWith('cancel:')).sort(), ids.map(i => `cancel:${i}`).sort());
  eq('isLineupReminderArmed → false with none', await R.isLineupReminderArmed(), false);
  readThrows = true;
  eq('an unreadable schedule → null (the screen says it couldn’t check)', await R.isLineupReminderArmed(), null);

  reset();
  platform.OS = 'web';
  eq('web: arm → web', await R.armLineupReminder({ prompt: true }), 'web');
  await R.disarmLineupReminder();
  ok('web: arm and disarm touch nothing', calls.length === 0);
  platform.OS = 'ios';

  // Static: no storage, one prompt site, one route.
  const RSRC = readFileSync(join(ROOT, 'utils/lineupReminder.ts'), 'utf8');
  ok('utils/lineupReminder.ts has no AsyncStorage (the OS schedule is the state)', !/AsyncStorage|async-storage/.test(RSRC));
  const { readdirSync, statSync } = await import('node:fs');
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|jsx?)$/.test(name) && /armLineupReminder\(\{\s*prompt:\s*true\s*\}\)/.test(readFileSync(p, 'utf8'))) hits.push(p.slice(ROOT.length + 1));
    }
  };
  for (const d of ['app', 'components', 'contexts', 'hooks', 'utils']) walk(join(ROOT, d));
  eq('armLineupReminder({ prompt: true }) is called only from app/tomorrow-lineup.tsx', hits, ['app/tomorrow-lineup.tsx']);
  const SCREEN = readFileSync(join(ROOT, 'app/tomorrow-lineup.tsx'), 'utf8');
  ok('the screen reads the OS schedule on mount and shows the help line', /isLineupReminderArmed\(\)/.test(SCREEN) && /lineupReminderCopy\.help/.test(SCREEN));
  ok('the reminder row is wrapped in a lineup- testID (stripped from goldens)', /testID="lineup-reminder"/.test(SCREEN));
  const ROUTES_SRC = readFileSync(join(ROOT, 'supabase/functions/notify/routes.ts'), 'utf8');
  ok("routes.ts maps tomorrow_lineup → /tomorrow-lineup", /case 'tomorrow_lineup':[\s\S]{0,300}pathname: '\/tomorrow-lineup'/.test(ROUTES_SRC));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
