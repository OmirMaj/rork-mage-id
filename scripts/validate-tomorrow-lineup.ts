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
import {
  lineupLanguageFor, lineupRowStatusLabel, lineupRowStatusLabelIn, noPhoneNote, textAllLabel, queueBanner, NO_PHONE_NOTE,
  OPENED_IN_MESSAGES, SHARE_SHEET_OPENED, YOU_MARKED_SENT, NOT_SENT_YET, type LineupRowStatus,
} from '../utils/lineupTexts';
import { LANGUAGE_PICKER_ENABLED } from '../i18n/flags';
import { subcontractorLanguageFromRow, subcontractorLanguageColumn } from '../utils/projectContextPure';

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
  ok('unassigned tasks → a gap naming them', L.gaps.some(g => g.startsWith("1 task tomorrow has no sub assigned, so it's not in any message: Clean-up")), JSON.stringify(L.gaps));
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
    ['Plumbing rough inspection, time not set', 'Final inspection, time not set']);
  ok('a passed or other-day inspection is left out', !L.siteWide.inspections.some(i => /Footing|Framing/.test(i.text)));
  ok('every message carries them', L.perSub.every(s => s.message.includes('Plumbing rough inspection, time not set')));
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
  eq('after 3 pm: ready to send', lineupHeadline(new Date(2026, 8, 28, 15, 0)), "Tomorrow's lineup is ready to send");
  eq('before 3 pm: a preview', lineupHeadline(new Date(2026, 8, 28, 14, 59)), "Tomorrow's lineup (preview, schedules can still change today)");
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

// ── 11. Spanish Phase 1b: each sub's text in the SUB's language (W3 ESSHELL) ──
// docs/I18N.md §9: the recipient's language, never the sender's; order
// override → the sub's record → English; never guessed; usted in anything sent
// out; dates never numeric in Spanish; "Opened in Messages" is never "Sent" in
// either language; and with Spanish switched off (LANGUAGE_PICKER_ENABLED, off
// until the bilingual review) every text is the English it was.
console.log('\nper-sub language (Spanish Phase 1b):');
{
  const ES_SUBS = [sub('A', 'Acme Drywall', { preferredLanguage: 'es' }), sub('B', 'Bolt Electric', { preferredLanguage: 'en' }), sub('N', 'Nocontact Tile', { phone: '', email: '', preferredLanguage: null })];
  const RICH = input({
    subs: ES_SUBS,
    accessReservations: [RES('r1', { window: '07:00-09:00', confirmationRef: 'BK-12' }), RES('r2', { kind: 'dock', status: 'requested', window: '10:00-11:00' }), RES('r5', { kind: 'badging', window: undefined })],
    deliveries: [DELIV('d1', { description: 'Board', commitmentId: 'kA', window: '08:00-09:00' }), DELIV('d4', { description: 'Studs', commitmentId: 'kA', status: 'scheduled' })],
    permits: [PERMIT([{ id: 'i1', name: 'Plumbing rough', scheduledFor: '2026-09-29', result: 'scheduled', recordedAt: '' }])],
  });
  const english = buildLineup(RICH);
  const on = buildLineup({ ...RICH, languageFor: s => lineupLanguageFor(s, undefined, true) });
  const byId = (L: ReturnType<typeof buildLineup>, id: string) => L.perSub.find(x => x.sub.id === id)!;

  // Gating first: the flag is off today, and off means English for everyone.
  ok('LANGUAGE_PICKER_ENABLED is still false (Spanish reaches no sub before the review)', LANGUAGE_PICKER_ENABLED === false);
  eq('flag off: a sub marked Spanish gets English (the default reads the flag)', lineupLanguageFor({ preferredLanguage: 'es' }), 'en');
  eq('flag off: even a per-send override is English', lineupLanguageFor({ preferredLanguage: 'es' }, 'es', false), 'en');
  const off = buildLineup({ ...RICH, languageFor: s => lineupLanguageFor(s) });
  eq('flag off: the Spanish-marked sub\'s message is byte-identical English', byId(off, 'A').message, byId(english, 'A').message);
  ok('flag off: every message and the whole lineup are byte-identical to the English-only build', JSON.stringify(off) === JSON.stringify(english));

  // Flag on: the recipient's language.
  eq('order: override → record → English (es record)', lineupLanguageFor({ preferredLanguage: 'es' }, undefined, true), 'es');
  eq('order: the override wins over the record', lineupLanguageFor({ preferredLanguage: 'es' }, 'en', true), 'en');
  eq('order: …both ways', lineupLanguageFor({ preferredLanguage: 'en' }, 'es', true), 'es');
  eq('order: no record → English (never guessed from a name)', lineupLanguageFor({ preferredLanguage: null }, undefined, true), 'en');
  eq('order: a junk value on the record → English', lineupLanguageFor({ preferredLanguage: 'fr' as never }, undefined, true), 'en');
  eq('the Spanish sub is marked es', byId(on, 'A').lang, 'es');
  eq('an en sub\'s message is byte-identical English', byId(on, 'B').message, byId(english, 'B').message);
  eq('a sub with no language set gets byte-identical English', byId(on, 'N').message, byId(english, 'N').message);
  ok('the app-language parts (summary, gaps, site-wide) stay in the app language', on.summary === english.summary && JSON.stringify(on.gaps) === JSON.stringify(english.gaps) && JSON.stringify(on.siteWide) === JSON.stringify(english.siteWide));

  const es = byId(on, 'A').message;
  ok('es: the text is Spanish, usted, whole sentences', es.startsWith('Acme Drywall: mañana (mar 29 sept) en 123 Main St: ') && es.endsWith('Responda para confirmar que estará ahí.'), es);
  ok('es: usted — no tú form', !/\b(tú|tienes|puedes|responde|confirmas|estarás|tu|te)\b/i.test(es), es);
  ok('es: no English sentence left in it', !/\b(at|Reply|Access:|Deliveries:|Inspections:|time not set|booked|requested|from|window|inspection|milestone|more)\b/.test(es), es);
  ok('es: the confirmed slot, the requested slot and the unset time read in Spanish', es.includes('elevador de carga: reserva confirmada, 07:00-09:00, ref. BK-12') && es.includes('muelle de carga 10:00-11:00: solicitud hecha; el edificio aún no la confirma') && es.includes('acreditación: reserva confirmada, (hora sin fijar)'), es);
  ok('es: deliveries through the record, unconfirmed said so', es.includes('Board de Supply Co, horario 08:00-09:00') && es.includes('Studs de Supply Co, hora sin fijar (sin confirmar por el proveedor)'), es);
  ok('es: the inspection is "hora sin fijar", never a guessed time', es.includes('Inspección de Plumbing rough: hora sin fijar'), es);
  ok('es: the records\' own data (task names, windows, refs) is untouched', es.includes('Hang board (2nd fl)') && es.includes('BK-12'));
  ok('es: no numeric date (9/29, 29/9, 2026-09-29)', !/\b\d{1,2}\/\d{1,2}\b|\d{4}-\d{2}-\d{2}/.test(es), es);
  eq('es: dayPhrase for tomorrow names the day in words', dayPhraseFor('2026-09-29', NOW, 'es'), 'mañana (mar 29 sept)');
  eq('es: dayPhrase for a later day', dayPhraseFor('2026-09-30', NOW, 'es'), 'el mié 30 sept');
  eq('en: dayPhrase unchanged', dayPhraseFor('2026-09-29', NOW, 'en'), 'tomorrow (Tue, Sep 29)');
  const esLong = buildLineup({ ...input({ subs: ES_SUBS, schedule: { ...SCHED, tasks: Array.from({ length: 40 }, (_, i) => T(`t${i}`, 21, 1, { title: `A fairly long task name number ${i}`, phase: 'Level 2 east wing', assignedSubId: 'A' })) } }), languageFor: s => lineupLanguageFor(s, undefined, true) });
  const esM = byId(esLong, 'A').message;
  ok('es: a crowded day stays near one SMS screen and says how many more in Spanish', esM.length <= 650 && /\+\d+ más/.test(esM), `${esM.length}: ${esM}`);

  // No invented time in Spanish either (same property as §7).
  const TIME = /\b\d{1,2}:\d{2}\b|\b\d{1,2}\s?(?:am|pm|a\.m\.|p\.m\.)\b/gi;
  let seed = 11; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const windows = ['07:00-09:00', '8-10', undefined, 'morning'];
  let bad = '';
  for (let k = 0; k < 100 && !bad; k++) {
    const dels = Array.from({ length: rnd(3) }, (_, i) => DELIV(`e${k}-${i}`, { commitmentId: 'kA', window: windows[rnd(windows.length)] }));
    const res = Array.from({ length: rnd(3) }, (_, i) => RES(`q${k}-${i}`, { window: windows[rnd(windows.length)], status: (['confirmed', 'requested'] as const)[rnd(2)] }));
    const L = buildLineup({ ...input({ subs: ES_SUBS, deliveries: dels, accessReservations: res }), languageFor: s => lineupLanguageFor(s, undefined, true) });
    const allowed = [...dels.map(d => d.window), ...res.map(r => r.window)].filter(Boolean).join(' ');
    for (const s of L.perSub) for (const m of s.message.match(TIME) ?? []) if (!allowed.includes(m)) bad = `${m} in ${s.message}`;
  }
  ok('es: every time in 100 generated Spanish lineups comes from a record window', bad === '', bad);

  // The screen's own words, in the app language (tú), English byte-identical.
  const esApp = buildLineup({ ...RICH, lang: 'es' });
  ok('app es: the summary is Spanish with a worded date', (esApp.summary ?? '').startsWith('Mañana (mar 29 sept) en 123 Main St: ') && !/\d{1,2}\/\d{1,2}/.test(esApp.summary ?? ''), esApp.summary ?? '');
  ok('app es: the unassigned-task gap is one Spanish sentence', esApp.gaps.some(g => g.startsWith('1 tarea para mañana no tiene subcontratista asignado; no va en ningún mensaje: Clean-up.')), JSON.stringify(esApp.gaps));
  ok('app es: the SUB still gets English when the app is Spanish (recipient, not sender)', byId(esApp, 'B').message === byId(english, 'B').message);
  eq('app es: headline', lineupHeadline(new Date(2026, 8, 28, 15, 0), 'es'), 'El plan de mañana está listo para enviar');
  eq('app es: the no-schedule sentence', buildLineup({ ...input({ schedule: null }), lang: 'es' }).emptyNote, 'Este proyecto no tiene cronograma. El plan toma las tareas del cronograma.');

  // Honesty in both languages.
  const statuses: LineupRowStatus[] = ['opened', 'shared', 'marked_sent', 'not_sent'];
  eq('en row labels unchanged', statuses.map(lineupRowStatusLabel), [OPENED_IN_MESSAGES, SHARE_SHEET_OPENED, YOU_MARKED_SENT, NOT_SENT_YET]);
  const esLabels = statuses.map(x => lineupRowStatusLabelIn(x, 'es'));
  eq('es: "Opened in Messages" is "Se abrió en Mensajes"', esLabels[0], 'Se abrió en Mensajes');
  ok('es: no row label is a bare "Enviado"/"Enviada"/"Sent"', esLabels.every(l => !/^(Enviad[oa]|Sent)\.?$/i.test((l ?? '').trim())), esLabels.join(' | '));
  ok('en: no row label is a bare "Sent"', statuses.map(lineupRowStatusLabel).every(l => l !== 'Sent'));

  // L1 copy fix and the helpers' English.
  eq('NO_PHONE_NOTE lost its em dash (L1)', NO_PHONE_NOTE, 'No phone on file. Send opens the share sheet so you can pick how.');
  eq('noPhoneNote() is NO_PHONE_NOTE in English', noPhoneNote(), NO_PHONE_NOTE);
  ok('noPhoneNote in Spanish is Spanish', noPhoneNote('es').startsWith('No hay teléfono registrado.'));
  eq('textAllLabel English unchanged', [textAllLabel(1), textAllLabel(4)], ['Text the sub', 'Text all 4']);
  eq('queueBanner English unchanged', queueBanner(['b', 'c'], 4, id => id.toUpperCase()), 'Next: B (3 of 4)');
}

// ── 11b. The sub's language on the record (L4) ─────────────────────────────
// subcontractors.preferred_language ↔ Subcontractor.preferredLanguage. The
// column's CHECK allows only 'en' | 'es' | null: anything else sent would be a
// terminal write that takes the whole sub edit down with it.
console.log('\nthe sub\'s language on the record:');
{
  eq('row es → es', subcontractorLanguageFromRow({ preferred_language: 'es' }), { preferredLanguage: 'es' });
  eq('row en → en', subcontractorLanguageFromRow({ preferred_language: 'en' }), { preferredLanguage: 'en' });
  eq('row null → not set (absent)', subcontractorLanguageFromRow({ preferred_language: null }), {});
  eq('row junk → not set (never guessed)', subcontractorLanguageFromRow({ preferred_language: 'Spanish' }), {});
  eq('es → column', subcontractorLanguageColumn({ preferredLanguage: 'es' }), { preferred_language: 'es' });
  eq('a deliberate "Not set" (null) → null', subcontractorLanguageColumn({ preferredLanguage: null }), { preferred_language: null });
  eq('a copy that never loaded it (undefined) sends nothing', subcontractorLanguageColumn({ companyName: 'X' }), {});
  eq('anything outside the CHECK is never sent', subcontractorLanguageColumn({ preferredLanguage: 'fr' as never }), {});
  const PC = readFileSync(join(ROOT, 'contexts/ProjectContext.tsx'), 'utf8');
  const subsQ = PC.slice(PC.indexOf("queryKey: ['subcontractors', userId],"), PC.indexOf('const punchItemsQuery = useQuery({'));
  const add = PC.slice(PC.indexOf('const addSubcontractor = useCallback('), PC.indexOf('const updateSubcontractor = useCallback('));
  const upd = PC.slice(PC.indexOf('const updateSubcontractor = useCallback('), PC.indexOf('const deleteSubcontractor = useCallback('));
  const imp = PC.slice(PC.indexOf('if (payload.subcontractors?.length) {'), PC.indexOf('result.subcontractors = add.length;'));
  ok('the subs load reads it, add / edit / bulk import send it', /\.\.\.subcontractorLanguageFromRow\(r\),/.test(subsQ)
    && /\.\.\.subcontractorLanguageColumn\(sub\),/.test(add) && /\.\.\.subcontractorLanguageColumn\(s\),/.test(upd) && /\.\.\.subcontractorLanguageColumn\(s\),/.test(imp));
  const SUBS = readFileSync(join(ROOT, 'app/(tabs)/subs/index.tsx'), 'utf8');
  ok('the sub editor saves the language only with Spanish switched on', (SUBS.match(/\.\.\.\(LANGUAGE_PICKER_ENABLED \? \{ preferredLanguage \} : \{\}\)/g) ?? []).length === 2
    && /\{LANGUAGE_PICKER_ENABLED \? \(\s*<View testID="sub-language-row">/.test(SUBS));
  ok('the Language row offers English / Español endonyms and Not set, with the hint', /\[null, 'Not set'\], \['en', 'English'\], \['es', 'Español'\]/.test(SUBS) && /Used for texts we send them\./.test(SUBS));
  const SCREEN = readFileSync(join(ROOT, 'app/tomorrow-lineup.tsx'), 'utf8');
  ok('the lineup screen builds each sub\'s text through lineupLanguageFor (the flag inside it)', /languageFor: \(sub: Subcontractor\) => lineupLanguageFor\(sub, langOverride\[sub\.id\]\)/.test(SCREEN));
  ok('the "Send in" override row renders only with Spanish switched on', /\{LANGUAGE_PICKER_ENABLED \? \(\s*<View style=\{styles\.langRow\}/.test(SCREEN));
}

// ── 12. The 3 pm reminder speaks the DEVICE user's language (tú) ────────────
console.log('\nreminder copy (device language):');
{
  const R = await import('../utils/lineupReminder');
  const core = await import('../i18n/core');
  eq('English reminder copy is byte-identical', [R.lineupReminderCopy.title, R.lineupReminderCopy.toggle, R.lineupReminderCopy.web],
    ['Tomorrow’s Lineup', 'Remind Me at 3 pm on Weekdays', 'Reminders work in the iPhone app.']);
  core.setLang('es');
  try {
    eq('es: the toggle reads in Spanish at read time (a getter, not a frozen constant)', R.lineupReminderCopy.toggle, 'Recuérdame a las 3 p.m. entre semana');
    ok('es: the notification body is tú Spanish and carries no project/sub data', R.lineupReminderRequests().every(r => r.content.body === 'Son las 3 p.m.: revisa el plan de mañana y envía a cada subcontratista su mensaje.'));
  } finally {
    core.setLang('en');
  }
  eq('back in English', R.lineupReminderCopy.toggle, 'Remind Me at 3 pm on Weekdays');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
