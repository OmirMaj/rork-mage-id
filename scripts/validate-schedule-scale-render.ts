// scripts/validate-schedule-scale-render.ts
//
// Audit #51 + #140 — the phone draws where the ENGINE schedules, and it hears
// the foreman's save while it is open.
//
// #51. The GC stretched Framing 10d → 15d on the web. Schedule Pro stores only
// the edit (buildScheduleFromTasks with criticalPathDays skips the reflow), so
// Drywall's stored startDay — its PIN — did not move. The web grid prints CPM
// es and moved it; the iPhone list, the iPhone timeline and the Lookahead
// printed the pin and kept last week's dates while the phone's own finish line
// moved. Pinned: every one of them reads scheduledTaskRange / CPM placements,
// a drag earlier than the predecessors allow says why it snapped back, and
// nothing writes es back into startDay (that would freeze every derived date).
// #140. Only Schedule Pro subscribed to the project row. Pinned: the phone
// Schedule tab mounts useLiveSchedule into absorbServerSchedule on its own
// channel, and the open task sheet follows the stored task.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runCpm, calendarDayToDate } from '../utils/cpm';
import {
  scheduledPlacements, scheduledTaskRange, scheduledWorkingDayLabel, taskCalendarRange,
  startDaySnapBack, followStoredTask, placementDayOffsets, startDayNumberFor,
} from '../utils/scheduleOps';
import { parseCalendarDay, addCalendarDays } from '../utils/calendarDate';
import { addWorkingDays } from '../utils/scheduleEngine';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ''}`); }
}
function eq<T>(name: string, got: T, want: T) { ok(name, JSON.stringify(got) === JSON.stringify(want), { got, want }); }
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const START = '2026-03-02';   // Monday
const CAL = { scheduleStartDate: START, workingDaysPerWeek: 5, nonWorkingDates: ['2026-03-20'] };
const T = (id: string, startDay: number, dur: number, deps: string[] = []): ScheduleTask => ({
  id, title: id, phase: 'General', startDay, durationDays: dur, progress: 0, crew: '',
  dependencies: deps, notes: '', status: 'not_started',
} as ScheduleTask);
const base = parseCalendarDay(START)!;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

console.log('\n#51 the phone prints the engine dates, not the pin:');
{
  // Framing lengthened 10 → 15 on the web; Drywall's pin (11) was not rewritten.
  const tasks = [T('Framing', 1, 15), T('Drywall', 11, 5, ['Framing'])];
  const cpm = runCpm(tasks, CAL);
  const placed = scheduledPlacements(cpm, true);
  const dry = tasks[1];
  const byEngine = scheduledTaskRange(dry, placed.get('Drywall'), base, 5, CAL.nonWorkingDates);
  const byPin = taskCalendarRange(dry, base, 5, CAL.nonWorkingDates);
  const fr = scheduledTaskRange(tasks[0], placed.get('Framing'), base, 5, CAL.nonWorkingDates);
  ok('the pin reading overlaps Framing (the bug)', byPin.start <= fr.end, { pin: iso(byPin.start), framingEnd: iso(fr.end) });
  ok('the engine reading starts after Framing ends', byEngine.start > fr.end, { engine: iso(byEngine.start), framingEnd: iso(fr.end) });
  eq('...on the engine es date', iso(byEngine.start), iso(calendarDayToDate(base, cpm.perTask.get('Drywall')!.es)));
  eq('the closure (Fri Mar 20) is honoured — Framing ends Mon Mar 23, not Fri Mar 20', iso(fr.end), '2026-03-23');
  eq('no placement falls back to the pin walk', iso(scheduledTaskRange(dry, undefined, base, 5, CAL.nonWorkingDates).start), iso(byPin.start));
  // Undated: raw-day engine, working-day labels.
  const raw = runCpm(tasks);
  eq('undated rows print the scheduled day window', scheduledWorkingDayLabel(dry, scheduledPlacements(raw, false).get('Drywall')), 'Day 16 – 20');
  eq('...not the pin window', scheduledWorkingDayLabel(dry, undefined), 'Day 11 – 15');
  ok('rendering never rewrites the pin', dry.startDay === 11);
}

console.log('\n#51 undated timeline — engine counts are WORKING days, walked, never drawn raw:');
{
  // Review repro: undated a(1,5d) → b(6,5d) → c(11,5d); the phone draws on a
  // preview anchor that starts on a FRIDAY. Raw-day runCpm gives b es=6 ef=10.
  const tasks = [T('a', 1, 5), T('b', 6, 5, ['a']), T('c', 11, 5, ['b'])];
  const raw = runCpm(tasks, { workingDaysPerWeek: 5 });
  const pl = scheduledPlacements(raw, false);
  const fri = parseCalendarDay('2026-09-18')!;   // Friday preview anchor
  const off = (d: Date) => Math.round((d.getTime() - fri.getTime()) / 86400000);
  // Exactly MobileGantt's offsetOfWorkingDay: calendar offset of working day n (0-indexed).
  const offsetOfWorkingDay = (n: number) => off(addWorkingDays(fri, Math.max(0, n), 5));
  const b = placementDayOffsets(pl.get('b')!, offsetOfWorkingDay);
  eq('b is drawn at working day 6 = offsetOfWorkingDay(5) (next Friday, offset 7)', b.startOffset, offsetOfWorkingDay(5));
  eq('...offset 7, not the raw es-1 = 5 (a Wednesday)', b.startOffset, 7);
  const isWeekend = (o: number) => { const d = addCalendarDays(fri, o).getDay(); return d === 0 || d === 6; };
  const all = ['a', 'b', 'c'].map(id => placementDayOffsets(pl.get(id)!, offsetOfWorkingDay));
  ok('no undated bar starts or ends on a weekend column', all.every(x => !isWeekend(x.startOffset) && !isWeekend(x.endOffset)), all);
  // A +1-column drag from where the bar is drawn (MobileGantt dragToStartDay)
  // never writes an EARLIER pin than the one drawn.
  for (const id of ['a', 'b', 'c']) {
    const p = pl.get(id)!;
    const s0 = placementDayOffsets(p, offsetOfWorkingDay).startOffset;
    for (const cols of [1, 2, 3]) {
      const next = startDayNumberFor(fri, addCalendarDays(fri, s0 + cols), 5);
      ok(`${id}: a +${cols}-column drag never lowers startDay (es ${p.es} → ${next})`, next >= p.es && next > (tasks.find(t => t.id === id)!.startDay - 1));
    }
  }
  // Dated placements stay calendar offsets, unwalked.
  const dated = scheduledPlacements(runCpm(tasks, { scheduleStartDate: '2026-09-07', workingDaysPerWeek: 5 }), true);
  eq('dated: offset is es - 1 (calendar index)', placementDayOffsets(dated.get('b')!, () => { throw new Error('dated must not walk'); }).startOffset, dated.get('b')!.es - 1);
  // The list's dated reader walks a working placement too (defensive).
  const r = scheduledTaskRange(tasks[1], pl.get('b'), fri, 5);
  eq('scheduledTaskRange walks a working placement', [iso(r.start), iso(r.end)], ['2026-09-25', '2026-10-01']);
}

console.log('\n#51 a drag earlier than the links allow says why:');
{
  const tasks = [T('Framing', 1, 10), T('Drywall', 3, 5, ['Framing'])];
  const cpm = runCpm(tasks, CAL);
  const snap = startDaySnapBack(tasks, 'Drywall', cpm, CAL);
  ok('snap-back reported with the predecessor named', !!snap && snap.waitsOn === 'Framing' && snap.scheduledCalendarDay === cpm.perTask.get('Drywall')!.es, snap);
  eq('a drag that fits reports nothing', startDaySnapBack([tasks[0], { ...tasks[1], startDay: 20 }], 'Drywall', runCpm([tasks[0], { ...tasks[1], startDay: 20 }], CAL), CAL), null);
}

console.log('\n#140 the open sheet follows the stored task:');
{
  const stored = { ...T('F', 1, 5), progress: 20, notes: 'a' } as ScheduleTask;
  const peer = { ...stored, progress: 80 } as ScheduleTask;
  const r1 = followStoredTask(stored, stored, peer);
  eq('an untouched field takes the peer value', [r1.task.progress, r1.peerChangedKeys], [80, ['progress']]);
  const mine = { ...stored, notes: 'mine' } as ScheduleTask;
  const r2 = followStoredTask(mine, stored, { ...stored, notes: 'theirs', progress: 80 } as ScheduleTask);
  eq('his own in-flight change is kept; the other field follows', [r2.task.notes, r2.task.progress], ['mine', 80]);
  const r3 = followStoredTask(stored, stored, stored);
  ok('nothing moved → the same object (setState no-op)', r3.task === stored);
}

console.log('\nwiring:');
{
  const list = strip(src('components/schedule/mobile/MobileScheduleList.tsx'));
  ok('MobileScheduleList prints scheduledTaskRange / scheduledWorkingDayLabel from placements',
    /scheduledTaskRange\(t, placement, base/.test(list) && /scheduledWorkingDayLabel\(t, placement\)/.test(list)
    && !/taskCalendarRange\(t, base/.test(list));
  const gantt = strip(src('components/schedule/mobile/MobileGantt.tsx'));
  ok('MobileGantt draws bars at the engine es/ef',
    /const placed = placements\?\.get\(r\.task\.id\);/.test(gantt)
    && /\(\{ startOffset, endOffset \} = placementDayOffsets\(placed, offsetOfWorkingDay\)\);/.test(gantt)
    && !/startOffset = Math\.max\(0, placed\.es - 1\)/.test(gantt));
  ok('...a drag starts from where the bar is drawn, and a zero-column hold writes nothing',
    /dragToStartDay\(startOffset, e\.translationX\)/.test(gantt) && /if \(Math\.round\(e\.translationX \/ dayW\) === 0\) return;/.test(gantt));
  const la = strip(src('components/schedule/LookaheadView.tsx'));
  ok('LookaheadView buckets by CPM on the schedule calendar incl. closures',
    /runCpm\(tasks, \{[\s\S]{0,160}nonWorkingDates: schedule\.nonWorkingDates/.test(la)
    && /scheduledTaskRange\(t, placements\.get\(t\.id\)/.test(la) && !/getTaskDateRange/.test(la));
  const screen = src('components/schedule/mobile/MobileScheduleScreen.tsx');
  ok('MobileScheduleScreen hands reportCpm placements to the list and the timeline',
    /const placementsDated = !!anchor\.iso;/.test(screen)
    && /const placements = useMemo\(\(\) => scheduledPlacements\(reportCpm, placementsDated\), \[reportCpm, placementsDated\]\);/.test(screen)
    && /scheduleStartDate: anchor\.iso \?\? undefined/.test(screen)
    && (screen.match(/placements=\{placements\}/g) ?? []).length === 2);
  ok('...says why a moved bar snapped back', /startDaySnapBack\(nextTasks, stamped\.id, runCpm\(nextTasks, scheduleCalendar\), scheduleCalendar\)/.test(screen));
  ok('...and never writes an engine date back into startDay', !/startDay: (?:cpm|reportCpm|placed|placement)/.test(strip(screen)));
  ok('the phone tab subscribes live into absorbServerSchedule on its own scope',
    /useLiveSchedule\(liveProjectId, onPeerSchedule, onLiveGap, 'schedule-tab'\);/.test(screen)
    && /absorbServerSchedule\(liveProjectId, copy\.tasks\)/.test(screen));
  ok('...re-reads the row after a socket gap', /from\('projects'\)\.select\('schedule'\)\.eq\('id', pid\)/.test(screen));
  ok('...and the open sheet follows the stored task', /followStoredTask\(\s*open,/.test(screen));
  const hook = src('hooks/useLiveSchedule.ts');
  ok('each useLiveSchedule mount owns its channel topic',
    /\.channel\(`project-live:\$\{projectId\}:\$\{topicSuffix\}`\)/.test(hook) && /mountSeq \+= 1/.test(hook));
  ok('Schedule Pro keeps its subscription call', /useLiveSchedule\(project\?\.id, onPeerSchedule, onLiveGap\);/.test(src('app/schedule-pro.tsx')));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
