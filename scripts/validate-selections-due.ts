// validate-selections-due.ts — a selection's pick-by date must be writable,
// and a suggested one must be grounded or absent.
//
// WHY THIS EXISTS. selection_categories.due_date feeds the owner's ranked
// "Waiting on you" list (utils/portalOwnerCore.ts) and the portal's overdue
// badge. The screen audit (2026-09-16) found nothing in the app ever wrote it:
// the Add Category modal and syncAllowancesToSelections both omitted it, and an
// existing category had no edit path. So every selection sat undated forever —
// never urgent — while the app held both numbers that set the date: the
// install task's start on the schedule and the options' leadTimeDays.
//
// ── WHAT THIS GUARD HOLDS ──────────────────────────────────────────────────
//
// A. THE MATH IS THE GANTT'S. The install date is ProjectSchedule.startDate +
//    ScheduleTask.startDay read as a WORKING ordinal (workingDaysPerWeek and
//    nonWorkingDates), exactly as scheduleEngine.getTaskDateRange and the
//    portal snapshot read it. Lead time and buffer are calendar days.
// B. REFUSE, NEVER GUESS. No schedule start date (the fall-back-to-today trap
//    behind the finish-day-jump bug), no lead time on any option, no picked
//    task, or a picked task that no longer exists ⇒ no date at all. The
//    function takes no clock, and §4 scans it for one.
// C. THE CHIP IS THE ARITHMETIC. The string shown to the GC names the task,
//    its date, the lead and whose lead it is, the buffer, and the result.
// D. AN EDIT TOUCHES ONLY due_date, through the offline queue. A whole-row
//    upsert from a stale card would reset `status` over the homeowner's pick.
// E. THE SCREEN WIRES IT. Source scan of app/selections.tsx (a .tsx this
//    runner cannot import): Add Category carries a plain date through to the
//    save, carries NO suggestion (no options exist yet at that moment), and the
//    card edit goes through the narrow writer.
//
// Run: bun run scripts/validate-selections-due.ts

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ProjectSchedule, ScheduleTask } from '@/types';

// TIMEZONE PIN. The anchor bug this guard once missed (a Supabase-round-tripped
// ISO instant re-projected into LOCAL time) only shows WEST of UTC — under UTC
// or UTC+14 every reading agrees and the guard stays green. So the run is
// pinned to a negative offset unless a caller overrides it explicitly
// (SELECTIONS_DUE_TZ=Pacific/Kiritimati to exercise the east side). Set before
// the engine's dynamic import below so every Date in it sees this zone.
process.env.TZ = process.env.SELECTIONS_DUE_TZ || 'America/Los_Angeles';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

// @types/bun is not installed (same note as validate-oac-actions.ts); only the
// sliver of Bun.plugin used below is declared.
type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: {
  plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void;
};
if (typeof Bun === 'undefined') {
  console.error('\n✗ validate-selections-due must run under bun (needs Bun.plugin to stub Supabase)\n');
  process.exit(1);
}

// selectionsEngine reaches Supabase, the Gemini relay and the offline queue —
// all of which import react-native. The pure suggestion never touches them;
// the queue stub records calls so §5 can inspect exactly what a date edit sends.
const queueCalls: { table: string; operation: string; data: Record<string, unknown> }[] = [];
Bun.plugin({
  name: 'selections-due-stubs',
  setup(build) {
    build.module('@/lib/supabase', () => ({
      exports: {
        supabase: new Proxy({}, { get() { throw new Error('supabase must not be touched by the due-date path'); } }),
        isSupabaseConfigured: true,
        SUPABASE_URL: '', SUPABASE_ANON_KEY: '',
      },
      loader: 'object',
    }));
    build.module('@/utils/mageAI', () => ({
      exports: { mageAI: async () => { throw new Error('mageAI must not be called'); } },
      loader: 'object',
    }));
    build.module('@/utils/offlineQueue', () => ({
      exports: {
        supabaseWriteDetailed: async (table: string, operation: string, data: Record<string, unknown>) => {
          queueCalls.push({ table, operation, data });
          return 'synced';
        },
      },
      loader: 'object',
    }));
  },
});

const {
  suggestSelectionDueDate, scheduleTaskCalendarStart, saveSelectionCategoryDueDate,
  SELECTION_DUE_BUFFER_DAYS,
} = await import('../utils/selectionsEngine');
// THE schedule rule every other surface anchors on (Gantt, portal snapshot, ICS).
const { resolveScheduleAnchor, taskCalendarRange } = await import('../utils/scheduleOps');
const { toCalendarDayString } = await import('../utils/calendarDate');

function task(p: Partial<ScheduleTask> & { id: string; title: string; startDay: number }): ScheduleTask {
  return {
    phase: 'Finishes', durationDays: 3, progress: 0, crew: '', dependencies: [], notes: '',
    status: 'not_started', ...p,
  };
}

// Mon 1 Jun 2026, 5-day week.
const TASKS: ScheduleTask[] = [
  task({ id: 'demo', title: 'Demo', startDay: 1 }),
  task({ id: 'cab', title: 'Cabinet install', startDay: 3 }),   // Wed Jun 3
  task({ id: 'tile', title: 'Tile', startDay: 6 }),             // 6th working day
];
const SCHED: Pick<ProjectSchedule, 'startDate' | 'workingDaysPerWeek' | 'nonWorkingDates' | 'tasks'> = {
  startDate: '2026-06-01', workingDaysPerWeek: 5, nonWorkingDates: [], tasks: TASKS,
};
const OPTS = [
  { productName: 'Crestwood Shaker', brand: 'Wolf Classic', leadTimeDays: 42 },
  { productName: 'Hampton', brand: 'Hampton Bay', leadTimeDays: 21 },
  { productName: 'Stock white', brand: 'IKEA', leadTimeDays: undefined },
];

// ── §1 Happy path: the chip is the arithmetic ─────────────────────────────
console.log('\n§1 suggestion from a dated schedule, a picked task and a real lead time');
{
  const r = suggestSelectionDueDate({ schedule: SCHED, taskId: 'cab', options: OPTS });
  ok('suggests', r.ok === true, JSON.stringify(r));
  if (r.ok) {
    ok('install date is the task\'s working-day start (Wed Jun 3)', r.installDate === '2026-06-03', r.installDate);
    ok('uses the LONGEST lead among the options (42, not 21)', r.leadDays === 42 && r.leadOptionName === 'Wolf Classic Crestwood Shaker', `${r.leadDays} ${r.leadOptionName}`);
    ok('default buffer is applied', r.bufferDays === SELECTION_DUE_BUFFER_DAYS && SELECTION_DUE_BUFFER_DAYS === 5);
    ok('due = Jun 3 − 42 − 5 calendar days = Apr 17', r.dueDate === '2026-04-17', r.dueDate);
    ok('chip states every input and the result verbatim',
      r.chip === 'Cabinet install Jun 3 − 42d lead (Wolf Classic Crestwood Shaker) − 5d buffer → pick by Apr 17', r.chip);
  }
  const b = suggestSelectionDueDate({ schedule: SCHED, taskId: 'cab', options: OPTS, bufferDays: 0 });
  ok('an explicit buffer is honoured', b.ok && b.dueDate === '2026-04-22', JSON.stringify(b));
}

// ── §2 Working-day aware, same reading as the Gantt ───────────────────────
console.log('\n§2 the install date respects workingDaysPerWeek and nonWorkingDates');
{
  const five = suggestSelectionDueDate({ schedule: SCHED, taskId: 'tile', options: OPTS });
  ok('5-day week: 6th working day from Mon Jun 1 is Mon Jun 8 (weekend skipped)', five.ok && five.installDate === '2026-06-08', JSON.stringify(five));
  const six = suggestSelectionDueDate({ schedule: { ...SCHED, workingDaysPerWeek: 6 }, taskId: 'tile', options: OPTS });
  ok('6-day week: the same ordinal is Sat Jun 6', six.ok && six.installDate === '2026-06-06', JSON.stringify(six));
  const closed = suggestSelectionDueDate({ schedule: { ...SCHED, nonWorkingDates: ['2026-06-08'] }, taskId: 'tile', options: OPTS });
  ok('a closure day is skipped too (Tue Jun 9)', closed.ok && closed.installDate === '2026-06-09', JSON.stringify(closed));
  ok('scheduleTaskCalendarStart agrees with the suggestion', scheduleTaskCalendarStart(SCHED, 6) === '2026-06-08');
  // Calendar-day subtraction across the US DST change (Nov 1 2026).
  const dst = suggestSelectionDueDate({
    schedule: { ...SCHED, startDate: '2026-11-02', tasks: [task({ id: 'x', title: 'Vanity set', startDay: 3 })] },
    taskId: 'x', options: [{ productName: 'Vanity', brand: '', leadTimeDays: 7 }],
  });
  ok('counting back across a DST change lands on the right day (Nov 4 − 12 = Oct 23)', dst.ok && dst.dueDate === '2026-10-23', JSON.stringify(dst));
  const straddle = suggestSelectionDueDate({
    schedule: { ...SCHED, startDate: '2027-01-04', tasks: [task({ id: 'y', title: 'Counter set', startDay: 1 })] },
    taskId: 'y', options: [{ productName: 'Quartz', brand: 'Caesarstone', leadTimeDays: 30 }],
  });
  ok('a chip that straddles a year names both years',
    straddle.ok && straddle.chip === 'Counter set Jan 4, 2027 − 30d lead (Caesarstone Quartz) − 5d buffer → pick by Nov 30, 2026', straddle.ok ? straddle.chip : JSON.stringify(straddle));
}

// ── §2b Stored-instant anchors: the Gantt's date, in any zone ─────────────
console.log(`\n§2b an ISO-instant startDate anchors on the Gantt's day (TZ=${process.env.TZ})`);
{
  ok('the timezone pin took effect (a west-of-UTC run has a positive offset)',
    process.env.SELECTIONS_DUE_TZ ? true : new Date(2026, 5, 1).getTimezoneOffset() > 0,
    String(new Date(2026, 5, 1).getTimezoneOffset()));
  for (const startDate of ['2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00+00:00', '2026-06-01T23:30:00.000Z']) {
    const sched = { ...SCHED, startDate };
    const r = suggestSelectionDueDate({ schedule: sched, taskId: 'cab', options: OPTS });
    ok(`${startDate}: install is Wed Jun 3 and pick-by Apr 17`,
      r.ok && r.installDate === '2026-06-03' && r.dueDate === '2026-04-17', JSON.stringify(r));
    ok(`${startDate}: picker row date is Jun 3 too`, scheduleTaskCalendarStart(sched, 3) === '2026-06-03',
      String(scheduleTaskCalendarStart(sched, 3)));
    // Head-to-head with the shared rule, for every task, so the suggestion
    // can never drift from what the Gantt draws.
    const anchor = resolveScheduleAnchor(sched).date;
    for (const t of TASKS) {
      const gantt = anchor ? toCalendarDayString(taskCalendarRange(t, anchor, sched.workingDaysPerWeek, sched.nonWorkingDates).start) : null;
      ok(`${startDate}: "${t.title}" matches resolveScheduleAnchor + taskCalendarRange (${gantt})`,
        gantt !== null && scheduleTaskCalendarStart(sched, t.startDay) === gantt,
        `engine ${scheduleTaskCalendarStart(sched, t.startDay)} vs gantt ${gantt}`);
    }
  }
}

// ── §3 Refusals: any missing input ⇒ no date ──────────────────────────────
console.log('\n§3 refuses rather than guesses');
{
  const noDate = (r: ReturnType<typeof suggestSelectionDueDate>) => r.ok === false && !('dueDate' in r);
  const cases: [string, ReturnType<typeof suggestSelectionDueDate>, string][] = [
    ['no schedule at all', suggestSelectionDueDate({ schedule: undefined, taskId: 'cab', options: OPTS }), 'no-schedule-start'],
    ['schedule with no startDate (never falls back to today)', suggestSelectionDueDate({ schedule: { ...SCHED, startDate: undefined }, taskId: 'cab', options: OPTS }), 'no-schedule-start'],
    ['schedule with an empty startDate', suggestSelectionDueDate({ schedule: { ...SCHED, startDate: '' }, taskId: 'cab', options: OPTS }), 'no-schedule-start'],
    ['schedule with a non-date startDate (Feb 30)', suggestSelectionDueDate({ schedule: { ...SCHED, startDate: '2026-02-30' }, taskId: 'cab', options: OPTS }), 'no-schedule-start'],
    ['no options yet (the Add Category moment)', suggestSelectionDueDate({ schedule: SCHED, taskId: 'cab', options: [] }), 'no-lead-time'],
    ['only GC-added options with no lead time', suggestSelectionDueDate({ schedule: SCHED, taskId: 'cab', options: [{ productName: 'A', brand: '', leadTimeDays: undefined }] }), 'no-lead-time'],
    ['garbage lead times (NaN, negative)', suggestSelectionDueDate({ schedule: SCHED, taskId: 'cab', options: [{ productName: 'A', brand: '', leadTimeDays: Number.NaN }, { productName: 'B', brand: '', leadTimeDays: -3 }] }), 'no-lead-time'],
    ['no task picked (no name matching)', suggestSelectionDueDate({ schedule: SCHED, taskId: undefined, options: OPTS }), 'no-task-picked'],
    ['picked task was deleted from the schedule', suggestSelectionDueDate({ schedule: SCHED, taskId: 'gone', options: OPTS }), 'task-not-found'],
  ];
  for (const [name, r, reason] of cases) {
    ok(`${name} ⇒ ${reason}, no date`, noDate(r) && r.ok === false && r.reason === reason && r.message.length > 0, JSON.stringify(r));
  }
  ok('a category literally named after a task still needs the task picked',
    suggestSelectionDueDate({ schedule: SCHED, taskId: null, options: OPTS }).ok === false);
  ok('scheduleTaskCalendarStart without a start date is null, not today',
    scheduleTaskCalendarStart({ ...SCHED, startDate: undefined }, 3) === null);
}

// ── §4 No clock inside the suggestion ─────────────────────────────────────
console.log('\n§4 the suggestion cannot anchor on today');
const ENGINE = readFileSync(resolve(__dirname, '../utils/selectionsEngine.ts'), 'utf8');
{
  const start = ENGINE.indexOf('// ─── Due-date suggestion');
  const body = start >= 0 ? ENGINE.slice(start) : '';
  ok('suggestion section found', body.length > 0);
  ok('no `new Date()` / Date.now() / todayCalendarDay in the suggestion section',
    !/new Date\(\s*\)|Date\.now\(|todayCalendarDay/.test(body));
  ok('no `new Date(\'YYYY-MM-DD\')` parse in the suggestion section', !/new Date\(\s*['"`]?\s*[a-zA-Z_.]*startDate/.test(body));
}

// ── §5 A date edit writes only due_date, through the queue ────────────────
console.log('\n§5 editing an existing category\'s date');
{
  queueCalls.length = 0;
  const out = await saveSelectionCategoryDueDate('cat-1', '2026-04-17');
  ok('returns the queue outcome', out === 'synced');
  const c = queueCalls[0];
  ok('one update to selection_categories through the offline queue',
    queueCalls.length === 1 && c.table === 'selection_categories' && c.operation === 'update', JSON.stringify(queueCalls));
  ok('payload is exactly { id, due_date } — status/budget/notes untouched',
    !!c && JSON.stringify(Object.keys(c.data).sort()) === JSON.stringify(['due_date', 'id']) && c.data.due_date === '2026-04-17', JSON.stringify(c?.data));
  queueCalls.length = 0;
  await saveSelectionCategoryDueDate('cat-1', null);
  ok('null clears the date', queueCalls.length === 1 && queueCalls[0].data.due_date === null);
  queueCalls.length = 0;
  await saveSelectionCategoryDueDate('cat-1', '2026-04-17T12:00:00.000Z');
  ok('a noon-UTC picker instant is stored as its calendar day', queueCalls[0]?.data.due_date === '2026-04-17', JSON.stringify(queueCalls));
  queueCalls.length = 0;
  const bad = await saveSelectionCategoryDueDate('cat-1', '2026-02-30');
  ok('a non-date is refused without a write', bad === 'failed' && queueCalls.length === 0);
}

// ── §6 The screen wires it ────────────────────────────────────────────────
console.log('\n§6 app/selections.tsx');
const SCREEN = readFileSync(resolve(__dirname, '../app/selections.tsx'), 'utf8');
{
  const handleAdd = SCREEN.slice(SCREEN.indexOf('const handleAddCategory'), SCREEN.indexOf('const handleCurate'));
  // (w5-join-screens moved the add to the queued write, saveSelectionCategoryDetailed.)
  ok('handleAddCategory passes dueDate into saveSelectionCategory', /saveSelectionCategory(?:Detailed)?\(\{[\s\S]*dueDate: input\.dueDate[\s\S]*\}\)/.test(handleAdd), handleAdd.slice(0, 400));
  const modalStart = SCREEN.indexOf('function AddCategoryModal');
  const modal = SCREEN.slice(modalStart, SCREEN.indexOf('const makeStyles'));
  ok('AddCategoryModal hands its date to onAdd', /onAdd\(\{[^}]*dueDate[^}]*\}\)/.test(modal));
  ok('AddCategoryModal offers NO suggestion (no options exist yet)', modalStart > 0 && !/suggestSelectionDueDate|InstallTaskPicker/.test(modal));
  const setDue = SCREEN.slice(SCREEN.indexOf('const handleSetDueDate'), SCREEN.indexOf('const handleChoose'));
  ok('card date edits go through saveSelectionCategoryDueDate, not the whole-row upsert',
    /saveSelectionCategoryDueDate\(/.test(setDue) && !/saveSelectionCategory\(/.test(setDue));
  ok('a failed date write is surfaced', /outcome === 'failed'[\s\S]*showAlert/.test(setDue));
  const refreshFn = SCREEN.slice(SCREEN.indexOf('const refresh = useCallback'), SCREEN.indexOf('useEffect(', SCREEN.indexOf('const refresh = useCallback')));
  ok('a queued (offline) date is remembered and overlaid on the next refresh, so the card keeps it',
    /outcome === 'queued'\) pendingDueRef\.current\[cat\.id\] = day/.test(setDue)
      && /pendingDueRef\.current/.test(refreshFn) && /dueDate: want/.test(refreshFn), refreshFn.slice(0, 300));
  ok('the card offers the suggestion only once options exist', /opts\.length > 0 && \(\s*<View style=\{styles\.suggestBlock\}/.test(SCREEN));
  ok('the suggestion renders its chip verbatim', /\{suggestion\.chip\}/.test(SCREEN));
  ok('the task picker is disabled WITH a reason', /disabled=\{!!pickerBlocked\}/.test(SCREEN) && /<Text style=\{styles\.suggestNote\}>\{pickerBlocked\}<\/Text>/.test(SCREEN));
  ok('no `new Date(\'YYYY-MM-DD\')` parse on the screen', !/new Date\(\s*['"`]\d{4}-\d{2}-\d{2}/.test(SCREEN));
  // DatePickerModal reads its seed with LOCAL getters. A `…T12:00:00Z` seed is
  // the next calendar day at UTC+13, so reopen + Confirm would move the
  // homeowner's date. Every seed must go through pickerSeed (local noon).
  const seedFn = SCREEN.slice(SCREEN.indexOf('function pickerSeed'), SCREEN.indexOf('function SummaryStat'));
  ok('pickerSeed builds a LOCAL-noon date-time (no Z / offset)',
    /return `\$\{day\.slice\(0, 10\)\}T12:00:00`;/.test(seedFn), seedFn.slice(0, 300));
  ok('no DatePickerModal is seeded with a UTC instant', !/T12:00:00Z`/.test(SCREEN));
  const seeds = SCREEN.match(/<DatePickerModal[\s\S]*?value=\{([^\n]*)\}\n/g) ?? [];
  ok('both pick-by DatePickerModals seed through pickerSeed',
    seeds.length === 2 && seeds.every(s => /pickerSeed\(/.test(s)), seeds.join('\n'));
  // The seed must round-trip through the picker's own reading in the zone
  // most likely to break it.
  const seedStr = '2026-01-17T12:00:00';
  const prevTz = process.env.TZ;
  process.env.TZ = 'Pacific/Auckland';
  const seeded = new Date(seedStr);
  const roundTrip = new Date(Date.UTC(seeded.getFullYear(), seeded.getMonth(), seeded.getDate(), 12)).toISOString().slice(0, 10);
  process.env.TZ = prevTz;
  ok('a local-noon seed reads back as the same day at UTC+13 (Auckland summer)', roundTrip === '2026-01-17', roundTrip);
  ok('a suggestion that already passed is said, not hidden or moved to today',
    /\(daysUntilCalendarDay\(suggestion\.dueDate\) \?\? 0\) < 0 \? \(\s*<Text[^>]*>\s*That date has already passed/.test(SCREEN));
}

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-selections-due: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
