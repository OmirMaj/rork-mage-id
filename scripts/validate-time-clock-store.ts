// validate-time-clock-store.ts — the time clock is ONE store, its shift alerts
// are cancelled by entry, and every day it shows is the local day.
//
// Audit round 2:
//   #8 useTimeEntries kept entries in per-mount useState. The Time Tracking
//      screen and the global voice mic (BrainSurface → UniversalMicButton)
//      were two copies that each wrote their whole array to
//      mageid_time_entries — a voice log on the mic's launch-time copy erased
//      the morning's clock-ins from the mirror job cost reads. And each copy
//      remembered the OS ids of the shift alerts IT posted in its own ref, so
//      after a relaunch (or on the other copy) clock-out cancelled nothing and
//      "Jose reached 8h" arrived after Jose went home.
//   #9 clockIn stamped `date` with the UTC day, History parsed that bare day as
//      UTC midnight (the day before, everywhere in the US), Hours Today used
//      the UTC today, the mic logged "2 hours punch" at 6 pm Friday as a
//      Saturday shift, and the payroll CSV printed clock times in UTC.
//   #2 (clock-in half) nothing warned when a crew member with a lapsed card
//      was clocked in.
//   #28 the only server read was `.eq('user_id', me)`, so the hours a foreman
//      clocked for his crew on the GC's job never reached the GC's job
//      costing / WIP / budget / cost book. They now arrive in a SEPARATE
//      read (teamEntries) that must never leak into `entries` — the array
//      clock-out and delete act on.
//
// The store is exercised for REAL (react-test-renderer, a real QueryClient)
// with AsyncStorage, the OS notification queue, auth and Supabase stubbed.
//
// Run via: bun run scripts/validate-time-clock-store.ts

// Pacific time: every UTC-day defect in #9 is visible west of Greenwich. Set
// before any Date is constructed.
process.env.TZ = 'America/Los_Angeles';

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
function expect<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// Declared locally (same as validate-photo-drain): the repo has no bun types,
// and only the sliver of Bun.plugin used below is described.
type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: {
  plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void;
};
// react-test-renderer ships no types here either; this is the part used.
interface TestRendererInstance { update: (el: unknown) => void; unmount: () => void }
interface TestRendererModule {
  create: (el: unknown) => TestRendererInstance;
  act: (cb: () => Promise<void>) => Promise<void>;
}

// ── Stubs ───────────────────────────────────────────────────────────────
const store = new Map<string, string>();
interface OsRequest { identifier: string; content: { title: string; data: Record<string, unknown> }; fireAt: number }
let osQueue: OsRequest[] = [];
let osSeq = 0;
const auth: { user: { id: string } | null; isLoading: boolean } = { user: { id: 'u1' }, isLoading: false };

// A fake Supabase that answers the store's reads from these tables, applying
// eq / neq / in the way PostgREST does. Empty by default, so the pulls are
// no-ops for every section that does not fill it. (RLS itself is exercised
// on PGlite; this checks the SCOPE the client asks for.)
type Row = Record<string, unknown>;
// `maxRows` is PostgREST's max_rows: every response is cut to it, with or
// without a range, and nothing says so.
const server: { projects: Row[]; project_collaborators: Row[]; time_entries: Row[]; maxRows: number } = {
  projects: [], project_collaborators: [], time_entries: [], maxRows: 1000,
};
function fakeFrom(table: 'projects' | 'project_collaborators' | 'time_entries') {
  const filters: Array<(r: Row) => boolean> = [];
  let span: [number, number] | null = null;
  const b = {
    select: () => b,
    order: () => b,
    range: (a: number, z: number) => { span = [a, z]; return b; },
    eq: (c: string, v: unknown) => { filters.push(r => r[c] === v); return b; },
    neq: (c: string, v: unknown) => { filters.push(r => r[c] !== v); return b; },
    in: (c: string, vs: unknown[]) => { filters.push(r => vs.includes(r[c])); return b; },
    then: (res: (v: { data: Row[]; error: null }) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({
        data: (() => {
          const all = (server[table] ?? []).filter(r => filters.every(f => f(r)));
          const [a, z] = span ?? [0, all.length - 1];
          return all.slice(a, Math.min(z + 1, a + server.maxRows));
        })(),
        error: null,
      }).then(res, rej),
  };
  return b;
}

Bun.plugin({
  name: 'time-clock-stubs',
  setup(build) {
    build.module('react-native', () => ({ exports: { Platform: { OS: 'ios' }, AppState: { addEventListener: () => ({ remove: () => {} }) } }, loader: 'object' }));
    build.module('@react-native-async-storage/async-storage', () => ({
      exports: {
        default: {
          getItem: async (k: string) => store.get(k) ?? null,
          setItem: async (k: string, v: string) => { store.set(k, v); },
          removeItem: async (k: string) => { store.delete(k); },
        },
      },
      loader: 'object',
    }));
    build.module('expo-notifications', () => ({
      exports: { getAllScheduledNotificationsAsync: async () => osQueue.map(r => ({ ...r })) },
      loader: 'object',
    }));
    build.module('@/utils/notifications', () => ({
      exports: {
        // The real one returns an OS-generated id and takes no identifier.
        scheduleLocalNotificationAt: async (o: { title: string; fireAt: Date; data?: Record<string, unknown> }) => {
          const identifier = `os-${++osSeq}`;
          osQueue.push({ identifier, content: { title: o.title, data: o.data ?? {} }, fireAt: o.fireAt.getTime() });
          return identifier;
        },
        cancelScheduledNotification: async (id: string | null | undefined) => {
          osQueue = osQueue.filter(r => r.identifier !== id);
        },
      },
      loader: 'object',
    }));
    build.module('@/lib/supabase', () => ({
      exports: { isSupabaseConfigured: true, supabase: { from: fakeFrom } },
      loader: 'object',
    }));
    build.module('@/utils/offlineQueue', () => ({
      exports: { supabaseWrite: async () => undefined },
      loader: 'object',
    }));
    build.module('@/contexts/AuthContext', () => ({
      exports: { useAuth: () => ({ user: auth.user, isLoading: auth.isLoading }) },
      loader: 'object',
    }));
  },
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// react-test-renderer 19 prints a deprecation notice per create(); it is noise here.
const origError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) return;
  origError(...args);
};

const React = await import('react');
// A non-literal specifier keeps tsc from demanding a declaration file.
const RTR_SPECIFIER: string = 'react-test-renderer';
const TestRenderer = (await import(RTR_SPECIFIER)).default as TestRendererModule;
const { act } = TestRenderer;
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const TE = await import('../hooks/useTimeEntries');
const { TimeEntriesProvider } = await import('../contexts/TimeEntriesContext');
import type { TimeEntry } from '../types';

type Store = ReturnType<typeof TE.useTimeEntries>;

async function settle() {
  for (let i = 0; i < 12; i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  }
}
function stored(): TimeEntry[] {
  const raw = store.get(TE.TIME_ENTRIES_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as TimeEntry[]) : [];
}
function alertsFor(entryId: string) {
  return osQueue.filter(r => r.content.data.kind === 'shift_alert' && r.content.data.entryId === entryId);
}

/** Mount the app's provider shape with two independent consumers — the Time
 *  Tracking screen and the global mic — and hand back what each one sees. */
async function mountApp(queryClient = new QueryClient()) {
  const seen: { screen: Store | null; mic: Store | null } = { screen: null, mic: null };
  function Screen() { seen.screen = TE.useTimeEntries(); return null; }
  function Mic() { seen.mic = TE.useTimeEntries(); return null; }
  const tree = () => React.createElement(QueryClientProvider, { client: queryClient },
    React.createElement(TimeEntriesProvider, null,
      React.createElement(Screen), React.createElement(Mic)));
  let renderer!: TestRendererInstance;
  await act(async () => { renderer = TestRenderer.create(tree()); });
  await settle();
  const rerender = async () => { await act(async () => { renderer.update(tree()); }); await settle(); };
  return { seen, renderer, queryClient, rerender };
}

function liveEntry(over: Partial<TimeEntry>): TimeEntry {
  return {
    id: 'jose', projectId: 'p1', projectName: 'Henderson', workerId: 'w-jose', workerName: 'Jose Ruiz',
    trade: 'Framing', clockIn: new Date(Date.now() - 4.5 * 3_600_000).toISOString(),
    breakMinutes: 0, totalHours: 0, overtimeHours: 0, status: 'clocked_in', date: '2026-09-17', ...over,
  };
}

// ── #9 pure: the local day and the local clock ─────────────────────────
console.log('\n#9 every day shown is the day the shift was worked (TZ=America/Los_Angeles):');
// 5:15 pm Thursday Sep 17 PDT = 00:15Z Friday. The old writer stored '2026-09-18'.
expect('an evening punch saved with the UTC day files under Thursday, not Friday',
  TE.timeEntryDay({ clockIn: '2026-09-18T00:15:00.000Z', date: '2026-09-18' }), '2026-09-17');
expect('a 6:30 am punch is Thursday',
  TE.timeEntryDay({ clockIn: '2026-09-17T13:30:00.000Z', date: '2026-09-17' }), '2026-09-17');
expect('a row with no usable clock-in falls back to its stored date',
  TE.timeEntryDay({ clockIn: 'garbage', date: '2026-09-10' }), '2026-09-10');
expect('CSV clock-in is the local wall clock, not UTC',
  TE.formatClockForCsv('2026-09-17T13:30:00.000Z'), '2026-09-17 06:30');
const csv = TE.buildTimeEntriesCSV([liveEntry({
  id: 'x', clockIn: '2026-09-18T00:15:00.000Z', clockOut: '2026-09-18T03:15:00.000Z', date: '2026-09-18',
  status: 'clocked_out', totalHours: 3,
})]);
const row = csv.split('\n')[1] ?? '';
ok('CSV row: Date is the worked day, clock columns are local, no ISO Z stamps',
  row.startsWith('2026-09-17,') && row.includes('2026-09-17 17:15') && row.includes('2026-09-17 20:15') && !/T\d\d:\d\d:\d\d/.test(row),
  row);

// ── #8 pure: the reconcile plan ─────────────────────────────────────────
console.log('\n#8 shift alerts are reconciled by entry:');
const scheduled = TE.scheduledShiftAlertsFrom([
  { identifier: 'os-a', content: { data: { kind: 'shift_alert', entryId: 'jose' } } },
  { identifier: 'os-b', content: { data: { kind: 'shift_alert', entryId: 'jose' } } },
  { identifier: 'os-c', content: { data: { kind: 'shift_alert', entryId: 'gone' } } },
  { identifier: 'shift-alert:mia', content: { data: {} } },
  { identifier: 'os-other', content: { data: { kind: 'invoice_due' } } },
]);
expect('picks shift alerts by data kind and by the shift-alert: identifier, nothing else',
  scheduled.map(s => `${s.identifier}=${s.entryId}`), ['os-a=jose', 'os-b=jose', 'os-c=gone', 'shift-alert:mia=mia']);
expect('every queued alert for an entry is found, however many mounts posted one',
  TE.shiftAlertIdsForEntry(scheduled, 'jose'), ['os-a', 'os-b']);
const now = Date.parse('2026-09-17T18:00:00.000Z');
const plan = TE.planShiftAlertReconcile(scheduled, [
  liveEntry({ id: 'jose', clockIn: '2026-09-17T13:30:00.000Z' }),
  liveEntry({ id: 'break', status: 'break', clockIn: '2026-09-17T13:30:00.000Z' }),
  liveEntry({ id: 'done', status: 'clocked_out', clockIn: '2026-09-17T13:30:00.000Z' }),
  liveEntry({ id: 'late', clockIn: '2026-09-17T09:00:00.000Z' }),
], 8, now);
expect('reconcile cancels every queued shift alert (stale + duplicates)', plan.cancel, ['os-a', 'os-b', 'os-c', 'shift-alert:mia']);
expect('…and re-posts exactly one per clocked-in shift not yet past its threshold',
  plan.schedule.map(s => `${s.entry.id}@${new Date(s.fireAtMs).toISOString()}`), ['jose@2026-09-17T21:30:00.000Z']);

// ── #8 live: one store, two consumers ──────────────────────────────────
console.log('\n#8 the screen and the mic share one store:');
{
  store.clear(); osQueue = [];
  const qc = new QueryClient();
  let invalidations = 0;
  const origInvalidate = qc.invalidateQueries.bind(qc);
  qc.invalidateQueries = ((filters?: { queryKey?: readonly unknown[] }) => {
    if (JSON.stringify(filters?.queryKey) === JSON.stringify(TE.TIME_ENTRIES_MIRROR_QUERY_KEY)) invalidations++;
    return origInvalidate(filters as never);
  }) as typeof qc.invalidateQueries;
  const { seen, renderer } = await mountApp(qc);
  const ids: string[] = [];
  await act(async () => {
    for (const n of ['Ana', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay']) {
      ids.push(seen.screen!.clockIn({ projectId: 'p1', projectName: 'Henderson', workerId: `w-${n}`, workerName: n }).id);
    }
  });
  await settle();
  await act(async () => { seen.screen!.clockOut(ids[0]); seen.screen!.clockOut(ids[1]); });
  await settle();
  const before = invalidations;
  // 3 pm: "put me down for 2 hours punch" into the Brain mic.
  await act(async () => { seen.mic!.addManualEntry({ projectId: 'p1', projectName: 'Henderson', workerName: 'Me', hours: 2, trade: 'Punch' }); });
  await settle();
  ok('the mic sees the screen\'s clock-ins (one array, not a copy)', seen.mic!.entries.length === 7, `mic sees ${seen.mic!.entries.length}`);
  ok('a voice log does not erase the six clock-ins from storage', stored().length === 7, `storage has ${stored().length}`);
  ok('the two clocked-out shifts stay clocked out on disk',
    stored().filter(e => ids.slice(0, 2).includes(e.id) && e.status === 'clocked_out').length === 2);
  ok('each write invalidates the mirror job cost / WIP / budget read', invalidations > before, `invalidations ${before} → ${invalidations}`);
  ok('clocked-in shifts have exactly one alert each; clocked-out have none',
    ids.slice(2).every(id => alertsFor(id).length === 1) && ids.slice(0, 2).every(id => alertsFor(id).length === 0),
    JSON.stringify(osQueue.map(r => r.content.data.entryId)));
  const manual = stored().find(e => e.workerId === 'self');
  ok('the voice log is filed under today\'s LOCAL day', !!manual && manual.date === TE.timeEntryDay(manual) && manual.date === (() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })(), JSON.stringify(manual?.date));
  await act(async () => { renderer.unmount(); });
}

console.log('\n#8 a relaunch leaves no ghost alert:');
{
  // Jose was clocked in at 6:30; iOS killed the app; the alert that launch
  // posted is still queued at the OS level with an id no ref remembers.
  store.clear(); osQueue = [];
  const jose = liveEntry({ id: 'jose' });
  store.set(TE.TIME_ENTRIES_STORAGE_KEY, JSON.stringify([jose]));
  osQueue.push({ identifier: 'os-killed-launch', content: { title: 'Jose Ruiz reached 8h', data: { kind: 'shift_alert', entryId: 'jose' } }, fireAt: Date.now() + 3.5 * 3_600_000 });
  const first = await mountApp();
  ok('relaunch: one alert for Jose, not the killed launch\'s plus a new one', alertsFor('jose').length === 1, `${alertsFor('jose').length} queued`);
  await act(async () => { first.renderer.unmount(); });
  // Leave and come back (a second mount of the tree).
  const second = await mountApp();
  ok('remount: still exactly one', alertsFor('jose').length === 1, `${alertsFor('jose').length} queued`);
  await act(async () => { second.seen.screen!.clockOut('jose'); });
  await settle();
  ok('clock-out cancels it — no "clock Jose out" after Jose went home', alertsFor('jose').length === 0, `${alertsFor('jose').length} still queued`);
  await act(async () => { second.renderer.unmount(); });
}

console.log('\n#8 a cold start is not an account switch:');
{
  store.clear(); osQueue = [];
  const offline = liveEntry({ id: 'offline-clockin' });
  store.set(TE.TIME_ENTRIES_STORAGE_KEY, JSON.stringify([offline]));
  auth.user = null; auth.isLoading = true;
  const app = await mountApp();
  auth.user = { id: 'u1' }; auth.isLoading = false;
  // Re-render so the provider sees the restored session.
  await app.rerender();
  ok('the un-synced clock-in survives the session restore', stored().some(e => e.id === 'offline-clockin'), JSON.stringify(stored().map(e => e.id)));
  await act(async () => { app.renderer.unmount(); });
}

// ── #28 team hours ─────────────────────────────────────────────────────
console.log("\n#28 a foreman's crew hours reach the GC's costing — and never his timesheet:");
{
  const scope = TE.teamScopeProjectIds(
    [{ id: 'p1' }],
    [
      { project_id: 'pE', role: 'editor', status: 'accepted' },
      { project_id: 'pV', role: 'viewer', status: 'accepted' },
      { project_id: 'pF', role: 'field', status: 'accepted' },
      { project_id: 'pR', role: 'editor', status: 'revoked' },
    ],
  );
  // Field seats are in since integration round 1 (the super on field access
  // files the DFR); they never reach costing — see costingTeamRows below.
  expect('scope = owned + editor/viewer/field memberships; never revoked', scope.sort(), ['p1', 'pE', 'pF', 'pV']);

  const row = (id: string, user: string, project: string, status = 'clocked_out') => ({
    id, user_id: user, project_id: project, project_name: project, worker_id: `w-${id}`, worker_name: id,
    trade: 'Framing', clock_in: '2026-09-17T13:30:00.000Z', clock_out: status === 'clocked_out' ? '2026-09-17T21:30:00.000Z' : null,
    break_minutes: 0, break_started_at: null, total_hours: status === 'clocked_out' ? 8 : 0, overtime_hours: 0,
    status, notes: null as string | null, gps_lat: null as number | null, gps_lng: null as number | null, date: '2026-09-17',
  });
  // Another contractor's crew GPS fix and shift note: the mock server ignores
  // the column list, so these arrive on the row and the store must drop them.
  const withPrivate = <T extends object>(r: T) => ({ ...r, notes: 'gate code 4417', gps_lat: 36.03, gps_lng: -114.98 });
  store.clear(); osQueue = [];
  server.projects = [{ id: 'p1', user_id: 'u1' }, { id: 'pX', user_id: 'stranger' }];
  server.project_collaborators = [
    { project_id: 'pE', user_id: 'u1', role: 'editor', status: 'accepted' },
    { project_id: 'pF', user_id: 'u1', role: 'field', status: 'accepted' },
  ];
  server.time_entries = [
    row('mine', 'u1', 'p1'),
    row('framer-1', 'foreman', 'p1'),
    row('framer-open', 'foreman', 'p1', 'clocked_in'),
    withPrivate(row('editor-job', 'someone', 'pE')),
    row('field-job', 'gc2', 'pF'),
    row('stranger', 'stranger', 'pX'),
  ];
  const app = await mountApp();
  const own = app.seen.screen!.entries.map(e => e.id).sort();
  const team = app.seen.screen!.teamEntries.map(e => e.id).sort();
  expect("the timesheet (entries) is still ONLY the user's own shifts", own, ['mine']);
  expect("team hours = others' shifts on owned + editor/viewer/field jobs", team, ['editor-job', 'field-job', 'framer-1', 'framer-open']);
  ok("the foreman's OPEN shift is not in liveEntries — the GC cannot clock it out",
    !app.seen.screen!.liveEntries.some(e => e.id === 'framer-open'));
  ok('each team row keeps its author ("logged by")',
    app.seen.screen!.teamEntries.find(e => e.id === 'framer-1')?.loggedByUserId === 'foreman');
  const onDisk = JSON.parse(store.get(TE.TIME_ENTRIES_TEAM_STORAGE_KEY) ?? '[]') as TimeEntry[];
  expect('team hours persist under their own key', onDisk.map(e => e.id).sort(), ['editor-job', 'field-job', 'framer-1', 'framer-open']);
  expect('…and the own-shift key never holds them', stored().map(e => e.id), ['mine']);
  ok('each team row says whether the job is OWNED (stamped at fetch)',
    onDisk.find(e => e.id === 'framer-1') !== undefined
    && (onDisk as (TimeEntry & { onOwnedProject?: boolean })[]).find(e => e.id === 'framer-1')?.onOwnedProject === true
    && (onDisk as (TimeEntry & { onOwnedProject?: boolean })[]).find(e => e.id === 'editor-job')?.onOwnedProject === false);
  const leaks = (rows: object[]) => rows.filter(e => 'gpsLat' in e || 'gpsLng' in e || 'notes' in e).length;
  ok("no team row keeps another company's crew GPS or notes — in memory or on disk",
    leaks(app.seen.screen!.teamEntries) === 0 && leaks(onDisk) === 0,
    `${leaks(app.seen.screen!.teamEntries)} in memory, ${leaks(onDisk)} on disk`);
  const mirror = (await TE.loadTimeEntriesMirror()).map(e => e.id).sort();
  // Owned jobs only: an editor seat on another contractor's job must not put
  // THAT company's crew hours into this company's cost book or 300A hours.
  expect('the costing mirror is own + team on OWNED jobs (not the editor seat)', mirror, ['framer-1', 'framer-open', 'mine']);
  expect('costingTeamRows fails closed on a row persisted before the flag existed',
    TE.costingTeamRows([{ ...liveEntry({ id: 'legacy' }), loggedByUserId: 'x' }]).map(e => e.id), []);
  expect('mergeTimeEntriesMirror never counts a shift twice',
    TE.mergeTimeEntriesMirror([liveEntry({ id: 'a' })], [liveEntry({ id: 'a' }), liveEntry({ id: 'b' })]).map(e => e.id), ['a', 'b']);
  // Sign-out: the team copy goes with the rest. (Signed out, no pull runs to
  // overwrite it — the reset alone has to clear it.)
  auth.user = null;
  server.time_entries = []; server.projects = []; server.project_collaborators = [];
  await app.rerender();
  ok('signing out clears the team hours too', app.seen.screen!.teamEntries.length === 0
    && (JSON.parse(store.get(TE.TIME_ENTRIES_TEAM_STORAGE_KEY) ?? '[]') as unknown[]).length === 0);
  auth.user = { id: 'u1' };
  await act(async () => { app.renderer.unmount(); });
}

// ── #28 team read past the API's max_rows (integration round 1) ────────
console.log("\nthe team read pages past PostgREST's max_rows instead of dropping the oldest shifts:");
{
  store.clear(); osQueue = [];
  server.maxRows = 2;
  server.projects = [{ id: 'p1', user_id: 'u1' }];
  server.project_collaborators = [];
  server.time_entries = Array.from({ length: 5 }, (_, i) => ({
    id: `crew-${i}`, user_id: 'foreman', project_id: 'p1', project_name: 'p1', worker_id: `w${i}`, worker_name: `w${i}`,
    trade: 'Framing', clock_in: `2026-09-1${i}T13:30:00.000Z`, clock_out: `2026-09-1${i}T21:30:00.000Z`,
    break_minutes: 0, break_started_at: null, total_hours: 8, overtime_hours: 0, status: 'clocked_out', date: `2026-09-1${i}`,
  }));
  const app = await mountApp();
  const got = app.seen.screen!.teamEntries.map(e => e.id).sort();
  expect('all 5 crew shifts arrive with a server cap of 2 rows per response', got, ['crew-0', 'crew-1', 'crew-2', 'crew-3', 'crew-4']);
  await act(async () => { app.renderer.unmount(); });
  server.maxRows = 1000;
  server.time_entries = []; server.projects = []; server.project_collaborators = [];
}

// ── Source-level wiring ────────────────────────────────────────────────
console.log('\nwiring:');
const hookSrc = src('hooks/useTimeEntries.ts');
const layout = src('app/_layout.tsx');
const screen = src('app/time-tracking.tsx');
const mic = src('components/UniversalMicButton.tsx');
const laborRates = src('hooks/useLaborRates.ts');
// The team read asks the server for the costing / crew columns only. A
// `select('*')` would download the GPS and notes of every crew on every
// editor/viewer seat — the strip above would hide it in memory, but the bytes
// would still have crossed the wire to this device.
{
  const teamRead = hookSrc.slice(hookSrc.indexOf('.neq(\'user_id\', userId)') - 200, hookSrc.indexOf('.neq(\'user_id\', userId)'));
  ok('the team read selects TEAM_TIME_ENTRY_COLUMNS, not *', /\.select\(TEAM_TIME_ENTRY_COLUMNS\)/.test(teamRead), teamRead.trim().slice(-80));
  ok('TEAM_TIME_ENTRY_COLUMNS never names gps_lat, gps_lng or notes',
    typeof TE.TEAM_TIME_ENTRY_COLUMNS === 'string' && !/gps_lat|gps_lng|\bnotes\b|\*/.test(TE.TEAM_TIME_ENTRY_COLUMNS));
  ok('a persisted team copy is scrubbed on hydrate', /parsed as TeamTimeEntry\[\]\)\.map\(teamRowForDevice\)/.test(hookSrc));
  ok('team hours re-pull when the app returns to the foreground',
    /AppState\.addEventListener\('change'[\s\S]{0,400}setPullNonce\(/.test(hookSrc));
}
const ctxSrc = src('contexts/TimeEntriesContext.tsx');

// The mirror READER is hooks/useLaborRates' useTimeEntriesMirror — what job
// costing, WIP, the budget dashboard, reports, the cost book and OSHA 300A all
// read. A HARD check now (it was a soft "pending" print that stayed green
// while every one of those surfaces still showed $0 foreman-run labour): its
// queryFn must be the own + owned-team loader, not a private own-key read.
{
  const hookBody = laborRates.slice(laborRates.indexOf('export function useTimeEntriesMirror('));
  const queryFn = /queryFn:\s*(\w+)/.exec(hookBody)?.[1];
  ok('useTimeEntriesMirror reads own + team hours (queryFn: loadTimeEntriesMirror)', queryFn === 'loadTimeEntriesMirror', `queryFn: ${queryFn}`);
  ok('…and useLaborRates has no private own-key-only mirror loader left',
    !/AsyncStorage\.getItem\(TIME_ENTRIES_STORAGE_KEY\)/.test(laborRates));
}
const mirrorLiteral = laborRates.match(/ENTRIES_MIRROR_QUERY\s*=\s*(\[[^\]]*\])/)?.[1];
ok('the store invalidates the SAME key useTimeEntriesMirror reads',
  !!mirrorLiteral && JSON.stringify(JSON.parse(mirrorLiteral.replace(/'/g, '"'))) === JSON.stringify(TE.TIME_ENTRIES_MIRROR_QUERY_KEY),
  `useLaborRates: ${mirrorLiteral}`);
ok('no per-mount alert id map (the ref clock-out could not see past)', !/scheduledAlertIdsRef/.test(hookSrc));
ok('useTimeEntries reads the context and never mounts its own store',
  /export function useTimeEntries\(\)[^{]*\{\s*const store = useContext\(TimeEntriesStoreContext\)/.test(hookSrc));
const storeMounts = ['contexts/TimeEntriesContext.tsx', 'app/time-tracking.tsx', 'components/UniversalMicButton.tsx', 'components/brain/BrainSurface.tsx', 'app/_layout.tsx']
  .filter(f => /useTimeEntriesStore\(\)/.test(src(f)));
expect('the store is mounted in exactly one place', storeMounts, ['contexts/TimeEntriesContext.tsx']);
ok('TimeEntriesContext renders the store into the context', /TimeEntriesStoreContext\.Provider value=\{store\}/.test(ctxSrc));
const iAuth = layout.indexOf('<AuthProvider>');
const iQuery = layout.indexOf('<QueryClientProvider');
const iTE = layout.indexOf('<TimeEntriesProvider>');
const iTEClose = layout.indexOf('</TimeEntriesProvider>');
const iBrain = layout.indexOf('<BrainSurface />');
const iNav = layout.indexOf('<RootLayoutNav />');
ok('TimeEntriesProvider sits below QueryClientProvider and AuthProvider, around BrainSurface and RootLayoutNav',
  iQuery >= 0 && iAuth > iQuery && iTE > iAuth && iBrain > iTE && iNav > iTE && iTEClose > iBrain && iTEClose > iNav,
  `query ${iQuery} auth ${iAuth} te ${iTE} brain ${iBrain} nav ${iNav} close ${iTEClose}`);

const utcDay = /toISOString\(\)\s*\.\s*(split\(\s*'T'\s*\)\s*\[0\]|slice\(\s*0\s*,\s*10\s*\))/;
ok('hooks/useTimeEntries never writes a UTC day', !utcDay.test(hookSrc));
ok('time-tracking never computes a UTC today', !utcDay.test(screen));
ok('the voice field-update never uses a UTC today', !/const today = now\.split\('T'\)\[0\]/.test(mic) && !utcDay.test(mic.slice(mic.indexOf("parsed.kind === 'field_update'"))));
ok('time-tracking never parses a stored bare day with new Date()', !/new Date\((entry|correcting|e)\.date\)/.test(screen));
ok('Hours Today and History read the day through timeEntryDay',
  /timeEntryDay\(e\) === today/.test(screen) && (screen.match(/formatCalendarDay\(timeEntryDay\(/g) ?? []).length >= 4);

console.log('\n#2 clock-in checks certifications:');
ok('time-tracking reads certifications through SafetyContext', /const \{ certifications \} = useSafety\(\)/.test(screen));
ok('each roster row gets certFlagsForWorker by the crew member id (exact join)', /certFlagsForWorker\(certifications, m\.id, today\)/.test(screen));
ok('the roster row renders the flags as chips', /certFlagsByMember\[member\.id\][\s\S]{0,300}<StatusPill/.test(screen));
const clockInBody = screen.slice(screen.indexOf('const handleClockIn = useCallback'), screen.indexOf('// Payroll CSV export'));
ok('handleClockIn asks before clocking in a lapsed card, naming it',
  /lapsedCertConfirmText\(member\.name, certFlagsByMember\[member\.id\]/.test(clockInBody)
  && /if \(warn\) \{[\s\S]*showAlert\('Certification lapsed', warn[\s\S]*onPress: commit[\s\S]*return;\s*\}\s*commit\(\);/.test(clockInBody),
  'the confirm must run before commit(), and commit() only after it or when nothing lapsed');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
process.exit(0);
