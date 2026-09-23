// validate-schedule-surfaces-guards.ts — wave 3, lane schedule-surfaces.
//
// Pins the fixes for five schedule findings from the 2026-09-18 workflow audit
// (the field-send and task-sheet findings #138/#139 are pinned in
// validate-field-schedule-update.ts, next to the field RPC they depend on):
//
//   #52  Accepting an AI draft (every route lands on schedule-review) or saving
//        the template wizard over a RUNNING schedule silently wiped progress,
//        actuals, baselines and the weather delay log. Now: a confirm that
//        counts what goes, the id-independent sidecars carried, the id-keyed
//        ones dropped (never re-attached to new task ids), the new plan's own
//        start date. The phone header's one-tap voice "build" no longer shows
//        over a running schedule.
//   #53  "What-If" could only snapshot and restore — nothing edits a scenario —
//        yet the Pro paywall sold "try the what-if" and the create card said
//        changes "only affect that scenario". Renamed to Saved plans; the
//        three promises reworded (FOUNDER: interim until real scenario editing).
//   #54  A snapshot left on hid live progress from Today/Lookahead with no
//        banner outside the Gantt. Today, Lookahead, field mode and the voice
//        button now read the LIVE plan; one banner sits above every view mode
//        on both layouts; a seat that cannot clear it gets a local "show live".
//   #137 Baseline manager "Activate" moved the ghost bars but not the ACTIVE
//        chip or the slip. One resolver (named activeBaselineId, else newest)
//        for every reader; activate/capture/lock set it; delete falls back.
//   #91  Schedule Pro's gate is project-scoped (own tier OR the collaborator
//        grant), spinner only while the role loads, retry on error, and "no
//        access" said plainly.
//
// Run: bun run scripts/validate-schedule-surfaces-guards.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ProjectSchedule, ScheduleTask } from '../types';
import {
  scheduleReplacementLoss, describeScheduleReplacement, replaceRunningSchedule,
} from '../utils/scheduleEngine';
import {
  resolveActiveBaseline, getActiveBaseline, readActiveBaselineId, withActiveBaselineId,
  activeBaselineAfterChange, reapplyBaselineToTasks, scheduleProGate, baselineStampedOnTasks, type NamedBaseline,
} from '../utils/scheduleOps';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const REVIEW = read('app', 'schedule-review.tsx');
const WIZARD = read('app', 'schedule-wizard.tsx');
const MSS = read('components', 'schedule', 'mobile', 'MobileScheduleScreen.tsx');
const TAB = read('app', '(tabs)', 'schedule', 'index.tsx');
const SP = read('app', 'schedule-pro.tsx');
const SCEN = read('components', 'schedule', 'ScenariosModal.tsx');
const PAYWALL = read('components', 'Paywall.tsx');
const BMM = read('components', 'schedule', 'BaselineManagerModal.tsx');
/** Source without comments — a WHY comment may quote the copy it replaced. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
}
function slice(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = src.indexOf(end, i + start.length);
  return j < 0 ? '' : src.slice(i, j);
}

const task = (o: Partial<ScheduleTask>): ScheduleTask => ({
  id: 'x', title: 'X', phase: 'P', durationDays: 5, startDay: 1, progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started', ...o,
} as ScheduleTask);
const baseline = (id: string, ends: Record<string, [number, number]>): NamedBaseline => ({
  id, name: id, savedAt: '2026-09-01T00:00:00Z',
  tasks: Object.entries(ends).map(([tid, [s, e]]) => ({ id: tid, startDay: s, endDay: e })),
});

// ─── #52 ──────────────────────────────────────────────────────────────────
console.log('\n#52 — replacing a running schedule:');
{
  const running = {
    id: 's-old', name: 'Old', projectId: 'p1', startDate: '2026-08-03', workingDaysPerWeek: 6, bufferDays: 2,
    tasks: [
      task({ id: 'a', progress: 60 }),
      task({ id: 'b', actualStartDate: '2026-08-10' }),
      task({ id: 'c' }),
    ],
    totalDurationDays: 30, criticalPathDays: 30, laborAlignmentScore: 80, riskItems: [],
    baseline: { savedAt: 'x', tasks: [{ id: 'a', startDay: 1, endDay: 5 }] },
    baselines: [baseline('v1', { a: [1, 5] }), baseline('v2', { a: [1, 6] })],
    activeBaselineId: 'v1',
    scenarios: [{ id: 'scn', name: 'Snap', createdAt: 'x', tasks: [] }],
    activeScenarioId: 'scn',
    weatherDelayLog: [{ id: 'w1', appliedAt: 'x', dates: ['2026-08-12', '2026-08-13'], taskIds: ['a'], projectSlipDays: 2, source: 'live' }],
    weatherAlerts: [{ id: 'wa', taskId: 'a', taskName: 'A', date: '2026-08-20', condition: 'rain', dismissed: false }],
    nonWorkingDates: ['2026-09-07'],
    resources: [{ id: 'r1', name: 'Crew A' }],
    criticalFloatThresholdDays: 2,
    startDayBasis: 'workingOrdinal',
    updatedAt: 'x',
  } as unknown as ProjectSchedule;
  const loss = scheduleReplacementLoss(running);
  ok('counts what goes: tasks, tasks with progress/actuals, baselines, saved plans, the kept delay log',
    !!loss && loss.taskCount === 3 && loss.tasksWithProgress === 2 && loss.baselineCount === 2
      && loss.savedPlanCount === 1 && loss.delayLogEntries === 1 && loss.delayLogDays === 2 && loss.nonWorkingDates === 1,
    JSON.stringify(loss));
  ok('no tasks → nothing to confirm', scheduleReplacementLoss({ ...running, tasks: [] }) === null && scheduleReplacementLoss(null) === null);
  ok('a legacy single baseline (no baselines[]) still counts',
    scheduleReplacementLoss({ ...running, baselines: [] })?.baselineCount === 1);
  const msg = loss ? describeScheduleReplacement(loss, 'Henderson') : '';
  ok('the confirm says progress is LOST (it cannot follow new task ids), not kept',
    /Lost for good: progress and actual dates on 2 tasks/.test(msg) && !/progress[^.]*kept/i.test(msg), msg);
  ok('...names the baselines and saved plans that go, and the delay log that stays',
    /2 locked baselines/.test(msg) && /1 saved plan/.test(msg) && /Kept: the weather delay log \(1 entry, 2 days\)/.test(msg), msg);

  const built = {
    id: 's-new', name: 'New', projectId: 'p1', workingDaysPerWeek: 5, bufferDays: 3,
    tasks: [task({ id: 'n1' }), task({ id: 'n2' })],
    totalDurationDays: 12, criticalPathDays: 12, laborAlignmentScore: 90, riskItems: [], baseline: null, updatedAt: 'y',
  } as ProjectSchedule;
  const next = replaceRunningSchedule(running, built, { startDate: '2026-09-21' });
  ok('the new tasks and derived scalars are the build\'s', next.tasks === built.tasks && next.totalDurationDays === 12 && next.id === 's-new');
  ok('id-independent sidecars are carried: delay log, closures, resources, working week, float threshold',
    next.weatherDelayLog === running.weatherDelayLog && next.nonWorkingDates === running.nonWorkingDates
      && next.resources === running.resources && next.workingDaysPerWeek === 6 && next.criticalFloatThresholdDays === 2);
  ok('id-keyed sidecars are dropped, never re-attached to new task ids',
    next.baselines === undefined && next.baseline === null && readActiveBaselineId(next) === undefined
      && next.scenarios === undefined && next.activeScenarioId === undefined && next.weatherAlerts === undefined);
  ok('the old tasks\' day-scale answer does not carry onto a fresh build', next.startDayBasis === undefined);
  ok('the new plan\'s start date, never the old anchor', next.startDate === '2026-09-21');
  const undated = replaceRunningSchedule(running, built, { startDate: null });
  ok('...and an undated draft stays undated (no old anchor, no invented today)', !('startDate' in undated));
  const wiz = replaceRunningSchedule(running, built, { startDate: '2026-09-21', workingDaysPerWeek: 5, bufferDays: 0 });
  ok('the wizard\'s own working week and buffer win', wiz.workingDaysPerWeek === 5 && wiz.bufferDays === 0);

  const accept = slice(REVIEW, 'const accept = useCallback(', 'const regenerate');
  const confirmAt = accept.indexOf('const loss = scheduleReplacementLoss(project.schedule);');
  ok('schedule-review: Accept counts the loss after the access refusal and BEFORE anything is recorded or written',
    confirmAt > accept.indexOf("showAlert('Schedule not saved', scheduleWriteBlockedReason)")
      && confirmAt < accept.indexOf('recordPrediction(') && confirmAt < accept.indexOf('updateProject('));
  ok('...asks with the count, Replace destructive, Keep as the cancel',
    /showAlert\('Replace the running schedule\?', describeScheduleReplacement\(loss, project\.name\), \[\s*\{ text: 'Keep current schedule', style: 'cancel' \},\s*\{ text: 'Replace', style: 'destructive', onPress: \(\) => commitAccept\(\) \},/.test(accept));
  ok('...and writes through replaceRunningSchedule with the draft\'s start date (not the spread that wiped it)',
    /schedule: replaceRunningSchedule\(project\.schedule, \{ \.\.\.draft\.schedule, \.\.\.rebuilt \}, \{\s*startDate: draft\.schedule\.startDate \?\? rebuilt\.startDate \?\? null,/.test(accept)
      && !/updateProject\(project\.id, \{ schedule: \{ \.\.\.draft\.schedule, \.\.\.rebuilt \} \}\)/.test(accept));
  const wizSave = slice(WIZARD, 'const handleSave = useCallback(', 'const onSavePressed');
  const wizConfirm = slice(WIZARD, 'const onSavePressed = useCallback(', 'return (');
  ok('wizard: Save writes through replaceRunningSchedule with its own start date and working week',
    /schedule: replaceRunningSchedule\(project\.schedule, built, \{\s*startDate: isoStart,\s*workingDaysPerWeek: WIZARD_WORKING_DAYS_PER_WEEK,\s*bufferDays: 0,/.test(wizSave));
  ok('wizard: its confirm counts what goes (not just "Saving replaces it")',
    /const loss = scheduleReplacementLoss\(project\.schedule\);/.test(wizConfirm)
      && /message: describeScheduleReplacement\(loss, project\.name, \{ newWorkingDaysPerWeek: WIZARD_WORKING_DAYS_PER_WEEK \}\),/.test(wizConfirm)
      && !/Saving replaces it/.test(code(WIZARD)));
  // The wizard WRITES its own 5-day week: its confirm must not promise a
  // 6-day job keeps its week (review round 1).
  const sixDay = { ...loss!, workingDaysPerWeek: 6 };
  const wizMsg = describeScheduleReplacement(sixDay, 'Henderson', { newWorkingDaysPerWeek: 5 });
  ok('a build that sets its own working week says it CHANGES, never lists it as kept',
    /Changed: the working week goes from 6 days to 5 days\./.test(wizMsg) && !/Kept:[^\n]*working week/.test(wizMsg), wizMsg);
  ok('...the same week, or none set, is kept and said so',
    /Kept:[^\n]*the working week/.test(describeScheduleReplacement(sixDay, 'H', { newWorkingDaysPerWeek: 6 }))
      && /Kept:[^\n]*the working week/.test(describeScheduleReplacement(sixDay, 'H'))
      && !/Changed:/.test(describeScheduleReplacement(sixDay, 'H')));
  // Quick Build's template (its FAB shows over a running schedule), the
  // template picker, the offline build-from-estimate fallback and the example
  // seed all write a brand-new task list — review round 1 found the template
  // still wiped a running schedule in one tap.
  const sink = slice(TAB, 'const saveReplacingSchedule = useCallback(', 'const handleTemplateSelect');
  ok('tab: ONE replace sink — refusal, then the counted confirm, then replaceRunningSchedule',
    sink.indexOf("if (refuseScheduleWrite('Schedule changes')) return;") >= 0
      && sink.indexOf("refuseScheduleWrite(") < sink.indexOf('scheduleReplacementLoss(running)')
      && /const loss = scheduleReplacementLoss\(running\);\s*if \(!loss\) \{ commit\(\); return; \}\s*showAlert\(/.test(sink)
      && /showAlert\('Replace the running schedule\?', describeScheduleReplacement\(loss, selectedProject\?\.name\), \[\s*\{ text: 'Keep current schedule', style: 'cancel' \},\s*\{ text: 'Replace', style: 'destructive', onPress: commit \},/.test(sink)
      && /saveSchedule\(replaceRunningSchedule\(running, built, \{ startDate: running\?\.startDate \?\? null \}\), selectedProject\);/.test(sink));
  const tmpl = slice(TAB, 'const handleTemplateSelect = useCallback(', 'const handleBuildFromEstimate');
  const est = slice(TAB, 'const handleBuildFromEstimate = useCallback(', 'const handleOnRampPick');
  const ramp = slice(TAB, 'const handleOnRampPick = useCallback(', 'const togglePhaseCollapse');
  ok('tab: the template (Quick Build + picker), the estimate fallback and the example seed all go through it',
    /saveReplacingSchedule\(schedule, \(\) => \{/.test(tmpl) && !/saveSchedule\(/.test(tmpl)
      && /saveReplacingSchedule\(schedule, \(\) => \{/.test(est) && !/saveSchedule\(/.test(est)
      && /saveReplacingSchedule\(demoSchedule, \(\) => \{/.test(ramp) && !/saveSchedule\(/.test(ramp));
  ok('Quick Build hands its template to that handler', /onTemplateSelect=\{handleTemplateSelect\}/.test(TAB));
  ok('phone header: the one-tap voice "build" shows only before a schedule exists',
    /\{hasEstimate && tasks\.length === 0 && \(\s*<TouchableOpacity style=\{styles\.iconBtn\} onPress=\{\(\) => router\.push\(`\/copilot\?capabilityId=schedule/.test(MSS));
}

// ─── #53 ──────────────────────────────────────────────────────────────────
console.log('\n#53 — Saved plans are sold as what they do:');
{
  ok('the paywall no longer sells "try the what-if"', !/what-if/i.test(slice(code(PAYWALL), 'schedule_scenarios:', '};')));
  ok('...and names the feature for what it is', /schedule_scenarios: 'Saved Schedule Plans'/.test(PAYWALL));
  ok('the create card no longer promises edits "only affect that scenario"', !/only affect that\s+scenario/.test(code(SCEN)));
  ok('the help no longer offers "Overtime push" / "Rain delay" alternates', !/Overtime push|Rain delay/.test(code(SCEN)));
  ok('the empty state no longer says "start branching"', !/start branching/.test(code(SCEN)));
  ok('the help says a saved plan cannot be edited', /A saved\s+plan can\{"'"\}t be edited/.test(SCEN));
  ok('creating one saves it WITHOUT switching the screen to it',
    /onScheduleChange\(\{\s*scenarios: \[\.\.\.scenarios, scenario\],\s*\}\);/.test(slice(SCEN, 'const handleCreate', 'const handleSwitch')));
  ok('the tab button and every heading say Saved plans',
    /<Text style=\{styles\.saveBaselineBtnText\}>Saved plans<\/Text>/.test(TAB)
      && (SCEN.match(/<Text style=\{styles\.title\}>Saved plans<\/Text>/g) ?? []).length === 2
      && !/What-If/.test(code(SCEN)));
  ok('the modal gate is project-scoped (own tier OR the grant)', /useProjectAccess\(schedule\.projectId \?\? undefined\)/.test(SCEN));
}

// ─── #54 ──────────────────────────────────────────────────────────────────
console.log('\n#54 — a saved plan cannot hide live progress:');
{
  ok('Today and Lookahead read the LIVE plan on both layouts, and save to it',
    (TAB.match(/<TodayView\s*tasks=\{liveSortedTasks\}[\s\S]{0,160}onProgressUpdate=\{handleLiveProgressUpdate\}[\s\S]{0,80}onPhotoAdded=\{handleLivePhotoAdded\}/g) ?? []).length === 2
      && (TAB.match(/<LookaheadView\s*tasks=\{liveSortedTasks\}[\s\S]{0,160}onProgressUpdate=\{handleLiveProgressUpdate\}/g) ?? []).length === 2
      && !/<(TodayView|LookaheadView)\s*tasks=\{sortedTasks\}/.test(TAB));
  ok('field mode and the voice button are live too',
    /return liveSortedTasks\.filter\(t => \{/.test(slice(TAB, 'const todayTasks = useMemo(', '}, [liveSortedTasks'))
      && /onPress=\{\(\) => handleLiveProgressUpdate\(task, val\)\}/.test(TAB)
      && /<VoiceFieldButton\s*tasks=\{liveSortedTasks\}/.test(TAB));
  ok('liveSortedTasks never reads the scenario',
    /const liveSortedTasks = useMemo<ScheduleTask\[\]>\(\(\) => \{\s*if \(!activeSchedule\) return \[\];\s*if \(!activeScenarioTasks\) return sortedTasks;\s*return activeSchedule\.tasks\.slice\(\)/.test(TAB));
  ok('a live-view edit skips the snapshot refusal; a Gantt edit still gets it',
    /if \(!live && refuseWhileWhatIf\(\)\) return;/.test(TAB)
      && /const handleProgressUpdate = useCallback\(\s*\(task: ScheduleTask, nextProgress: number\) => applyProgressUpdate\(task, nextProgress, false\)/.test(TAB)
      && /if \(!opts\?\.liveTasks && whatIfEditRefusal\(existing\)\) return null;/.test(TAB));
  ok('ONE banner, rendered above every desktop view mode and in the phone header',
    // The desktop-width lane seats the banner in the reading column.
    /\{savedPlanBanner\}(?:<\/View>\s*\)\})?\s*\{viewMode === 'board' \? \(/.test(TAB)
      && /\{!isFieldMode && savedPlanBanner \? \(/.test(TAB)
      && (TAB.match(/testID="scenario-banner"/g) ?? []).length === 1
      && !/viewMode === 'gantt' && \(\s*<View style=\{styles\.ganttWrapper\}>\s*\{activeScenarioTasks && \(/.test(TAB));
  ok('...with a one-tap exit that a seat without row access can use (local "show live plan")',
    /onPress=\{exitSavedPlanView\}[^>]*testID="scenario-banner-exit"/.test(TAB)
      && /if \(scheduleWriteBlockedReason\) \{ setViewLiveScenarioId\(id\); return; \}\s*handleScheduleScenariosChange\(\{ activeScenarioId: null \}\);/.test(TAB)
      && /if \(viewLiveScenarioId === activeSchedule\.activeScenarioId\) return null;/.test(TAB));
}

// A task OPENED from Today/Lookahead (live) must not be refused as a
// saved-plan edit in the detail sheet (review round 1).
console.log('\n#54 — the task sheet opened from a live view acts on the live plan:');
{
  ok('Today and Lookahead open the sheet as LIVE (both layouts); the Gantt does not',
    (TAB.match(/<(TodayView|LookaheadView)\s*tasks=\{liveSortedTasks\}[\s\S]{0,200}?onTaskPress=\{openLiveTaskDetail\}/g) ?? []).length === 4
      && (TAB.match(/onTaskPress=\{openLiveTaskDetail\}/g) ?? []).length === 4
      && /<GanttChart [^>]*onTaskPress=\{setTaskDetailModal\}/.test(TAB));
  ok('...the live flag clears when the sheet closes, so a later Gantt open reads as the snapshot',
    /useEffect\(\(\) => \{ if \(!taskDetailModal\) setTaskDetailLive\(false\); \}, \[taskDetailModal\]\);/.test(TAB));
  ok('sheet progress, photo, edit and delete take the live path when opened live (both sheets)',
    (TAB.match(/\(taskDetailLive \? handleLiveProgressUpdate : handleProgressUpdate\)\(task, val\)/g) ?? []).length === 2
      && /\(taskDetailLive \? handleLivePhotoAdded : handlePhotoAdded\)\(task, \{/.test(TAB)
      && (TAB.match(/openEditTask\(task, taskDetailLive\)/g) ?? []).length === 2
      && (TAB.match(/const live = taskDetailLive; setTaskDetailModal\(null\); handleDeleteTask\(task\.id, live\);/g) ?? []).length === 2);
  const saveTask = slice(TAB, 'const handleSaveTask = useCallback(', 'const handleQuickAdd');
  ok('the edit save builds from the live plan and skips the snapshot refusal only when live',
    /if \(!live && refuseWhileWhatIf\(\)\) return;\s*const baseTasks = live \? liveSortedTasks : sortedTasks;/.test(saveTask)
      && /const nextTasks: ScheduleTask\[\] = baseTasks\.map\(/.test(saveTask)
      && /persistEditedTasks\(nextTasks, \{ live \}\);/.test(saveTask)
      && /handleSaveTask\(taskDraft, editingTask, editingLive\);/.test(TAB)
      // persistEditedTasks returns what it saved (null = nothing) for the AI editor's commit.
      && /if \(!opts\?\.live && refuseWhileWhatIf\(\)\) return(?: null)?;/.test(slice(TAB, 'const persistEditedTasks = useCallback(', 'const mobileCommit')));
  const del = slice(TAB, 'const handleDeleteTask = useCallback(', 'const latestScheduleRef');
  ok('delete from a live-opened sheet deletes from the live plan',
    /if \(!live && refuseWhileWhatIf\(\)\) return;/.test(del) && /\(live \? liveSortedTasks : sortedTasks\)/.test(del)
      && /\{ liveTasks: live \|\| !activeScenarioTasks \}/.test(del));
}

// ─── #137 ─────────────────────────────────────────────────────────────────
console.log('\n#137 — one active baseline for every reader:');
{
  const v1 = baseline('v1', { a: [1, 5], b: [6, 9] });
  const v2 = baseline('v2', { a: [1, 6] });
  ok('the named id wins', resolveActiveBaseline([v1, v2], 'v1')?.id === 'v1');
  ok('no id → the newest (old schedules read exactly as before)', resolveActiveBaseline([v1, v2], undefined)?.id === 'v2');
  ok('a deleted id → the newest', resolveActiveBaseline([v2], 'v1')?.id === 'v2');
  ok('none → null', resolveActiveBaseline([], 'v1') === null && getActiveBaseline(null) === null);
  const withId = withActiveBaselineId({ baselines: [v1, v2] }, 'v1');
  ok('set and read back through the schedule', readActiveBaselineId(withId) === 'v1' && getActiveBaseline(withId)?.id === 'v1');
  ok('cleared → the key is gone, not null', !('activeBaselineId' in withActiveBaselineId(withId, undefined)));
  const del = activeBaselineAfterChange('v1', [v1, v2], [v2]);
  ok('deleting the ACTIVE baseline clears the id, falls back, and asks for a re-stamp',
    del.activeBaselineId === undefined && del.active?.id === 'v2' && del.reapply);
  const other = activeBaselineAfterChange('v1', [v1, v2], [v1]);
  ok('deleting ANOTHER keeps the yardstick and the ghost bars', other.activeBaselineId === 'v1' && !other.reapply);
  const tasks = [task({ id: 'a', baselineStartDay: 1, baselineEndDay: 6 }), task({ id: 'b', baselineStartDay: 6, baselineEndDay: 9 })];
  const re = reapplyBaselineToTasks(tasks, v2);
  ok('re-stamping takes the other baseline\'s dates OFF tasks it does not name',
    re[0].baselineEndDay === 6 && re[1].baselineStartDay === undefined && re[1].baselineEndDay === undefined);
  ok('...and null clears them all', reapplyBaselineToTasks(tasks, null).every(t => t.baselineStartDay === undefined));

  ok('Schedule Pro: the slip, the chip and the Gantt read ONE resolved baseline',
    /const activeBaseline = useMemo\(\s*\(\) => resolveActiveBaseline\(namedBaselines, activeBaselineId\),/.test(SP)
      && /const active = activeBaseline;/.test(slice(SP, 'const baselineFinishDay = useMemo', 'SchedulerContext-shaped'))
      && /activeBaselineId=\{activeBaseline\?\.id \?\? null\}/.test(SP)
      && !/namedBaselines\[namedBaselines\.length - 1\]/.test(SP));
  ok('Schedule Pro: Activate sets the id and the task baselines in ONE save (the debounced persist)',
    /onActivate=\{\(baseline\) => \{[\s\S]{0,400}setActiveBaselineId\(baseline\.id\);\s*commit\(prev => reapplyBaselineToTasks\(prev, baseline\)\);/.test(SP)
      && /const withBaselines = withActiveBaselineId\(\{[\s\S]{0,300}\}, activeBaselineIdRef\.current\);/.test(SP)
      && /schedule: withActiveBaselineId\(\{ \.\.\.mergedOnUnmount, baselines: baselinesRef\.current \}, activeBaselineIdRef\.current\)/.test(SP));
  ok('Schedule Pro: deleting the active baseline re-stamps the fallback',
    /const after = activeBaselineAfterChange\(activeBaselineIdRef\.current, prevList, next\);/.test(SP)
      && /if \(after\.reapply && next\.length < prevList\.length\) \{[\s\S]{0,200}commit\(prev => reapplyBaselineToTasks\(prev, after\.active\)\);/.test(SP));
  ok('Schedule Pro: a stored id change (project switch, the phone\'s lock) is adopted',
    // wave 4 #86: …except over an Activate still waiting in the persist
    // debounce (a project switch always adopts).
    /useEffect\(\(\) => \{[\s\S]{0,600}const switched = activeIdProjectRef\.current !== project\?\.id;[\s\S]{0,120}if \(!switched && persistPendingRef\.current\) return;\s*setActiveBaselineId\(storedActiveBaselineId\);[\s\S]{0,120}\}, \[project\?\.id, storedActiveBaselineId, setActiveBaselineId\]\);/.test(SP));
  ok('phone: the slip reads the same resolver', /\(\) => getActiveBaseline\(activeSchedule\),/.test(MSS) && !/list\[list\.length - 1\] as unknown as NamedBaseline/.test(MSS));
  ok('tab: variance and ghost bars read the same resolver', /function activeNamedBaseline\(schedule: ProjectSchedule \| null\): NamedBaseline \| null \{\s*return getActiveBaseline\(schedule\);/.test(TAB));
  ok('a phone lock and a tab lock make the new capture THE yardstick',
    /schedule: withActiveBaselineId\(\{[\s\S]{0,300}baselines: \[\.\.\.existing, snap\],[\s\S]{0,80}\}, snap\.id\),/.test(MSS)
      && /schedule: withActiveBaselineId\(\{[\s\S]{0,300}baselines: \[\.\.\.existing, snap\],[\s\S]{0,80}\}, snap\.id\),/.test(TAB));
  // Undo/Redo (review round 1): history holds tasks only, so a Cmd+Z across an
  // Activate put v2's dates back while the chip and slip stayed on v1.
  const onV1 = [task({ id: 'a', baselineStartDay: 1, baselineEndDay: 5 }), task({ id: 'b', baselineStartDay: 6, baselineEndDay: 9 })];
  const onV2 = reapplyBaselineToTasks(onV1, v2);
  ok('the tasks name the baseline their ghost dates came from',
    baselineStampedOnTasks(onV1, [v1, v2], 'v2') === 'v1' && baselineStampedOnTasks(onV2, [v1, v2], 'v1') === 'v2');
  const twin = baseline('v3', { a: [1, 6] });
  ok('...an identical twin keeps the current one; else the newest match',
    baselineStampedOnTasks(onV2, [v1, v2, twin], 'v2') === 'v2' && baselineStampedOnTasks(onV2, [v1, v2, twin], 'v1') === 'v3');
  ok('...no match (hand-edited stamps) → undefined, the id is left alone',
    baselineStampedOnTasks([task({ id: 'a', baselineStartDay: 2, baselineEndDay: 7 })], [v1, v2], 'v1') === undefined
      && baselineStampedOnTasks([task({ id: 'z' })], [v1, v2], 'v1') === undefined);
  const undo = slice(SP, 'const handleUndo = useCallback(', 'const handleRedo');
  const redo = slice(SP, 'const handleRedo = useCallback(', '// Project start date');
  ok('Schedule Pro: Undo and Redo make the active id follow the restored tasks, before the persist',
    /followRestoredBaseline\(n\.present\);\s*schedulePersist\(n\.present\);/.test(undo)
      && /followRestoredBaseline\(n\.present\);\s*schedulePersist\(n\.present\);/.test(redo)
      && /const stamped = baselineStampedOnTasks\(tasks, baselinesRef\.current, current\);\s*if \(stamped === undefined\) return;[\s\S]{0,160}setActiveBaselineId\(stamped\);/.test(SP));
  ok('the compare view starts from the active baseline', /const active = \(activeBaselineId && baselines\.find\(b => b\.id === activeBaselineId\)\) \|\| baselines\[baselines\.length - 1\];/.test(BMM));
}

// ─── #91 (Schedule Pro part) ──────────────────────────────────────────────
console.log('\n#91 — Schedule Pro\'s gate:');
{
  const g = (o: Partial<Parameters<typeof scheduleProGate>[0]>) => scheduleProGate({
    canAccess: false, hasProjectId: true, roleLoading: false, roleError: false, role: 'field', ...o,
  });
  ok('own tier or the grant → open, without waiting on the role', g({ canAccess: true, roleLoading: true }) === 'open');
  ok('role loading → spinner, never a paywall flash', g({ roleLoading: true }) === 'loading');
  ok('role read failed → retry', g({ roleError: true }) === 'error');
  ok('a project named, no role once loaded → no access, said', g({ role: null }) === 'no_access');
  ok('no project → the own-tier paywall', g({ hasProjectId: false, role: null }) === 'paywall');
  ok('a role that the grant does not cover → paywall', g({ role: 'owner' }) === 'paywall');
  const outer = slice(SP, 'export default function ScheduleProScreen()', 'function ScheduleProScreenInner()');
  ok('the outer gate reads useProjectAccess + useProjectRoleState for the routed project',
    /const \{ canAccess \} = useProjectAccess\(gateProjectId \|\| undefined\);/.test(outer)
      && /const roleState = useProjectRoleState\(gateProjectId \|\| undefined\);/.test(outer)
      && /canAccess: canAccess\('schedule_gantt_pdf'\),/.test(outer)
      && !/useTierAccess/.test(outer));
  ok('...with a Try again on error and a plain no-access message',
    /onPress=\{\(\) => \{ void roleState\.refetch\(\); \}\}/.test(outer) && /You don’t have access to this schedule/.test(outer));
  ok('the inner PDF check is project-scoped too',
    /const \{ canAccess \} = useProjectAccess\(projectId \|\| undefined\);/.test(SP) && !/useTierAccess\(\)/.test(SP));
  ok('the write-path role read keeps its pinned shape', /const role = useProjectRole\(projectId\);/.test(SP));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
