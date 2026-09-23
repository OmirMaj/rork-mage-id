// validate-field-schedule-update.ts — a field collaborator's schedule progress
// is saved, or he is told it wasn't (audit round 2, account-data-security #25).
//
// THE BUG. Every schedule write went out as a PATCH of the projects row, which
// projects_update admits only for the owner or an editor. For role 'field',
// PostgREST answered 200 + 0 rows, the offline queue counted it as processed,
// and the foreman's "Framing → 60%" was gone on his next reload — from Home's
// Quick Field Update, from Schedule Pro, and from the daily report's ripple.
//
// THE FIX, pinned here:
//   • field writes go through public.field_update_schedule_tasks, which merges
//     ONLY progress/status/notes/actual start+finish and refuses any other key
//     (migration 20260917160000 — executed on PGlite with field / editor /
//     viewer / unrelated callers and money-key attempts before shipping);
//   • the client allowlist and the SQL allowlist are the same list;
//   • a refused or failed send is reported, never confirmed;
//   • Schedule Pro saves a field user's progress through the RPC and says
//     which other changes were not saved; the DFR ripple (a date move) is
//     blocked for field/viewer with the reason on the button.
//
// Run: bun run scripts/validate-field-schedule-update.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ScheduleTask } from '../types';
import {
  FIELD_TASK_PATCH_KEYS, FIELD_SCHEDULE_RPC,
  applyFieldTaskPatches, fieldScheduleSettingsChanged, fieldTaskDiff, scheduleWritePathForRole, sendFieldTaskPatches,
  classifyFieldSendFailure, captureFieldSendFailure, mergeFieldSendFailure, pendingFieldRetryPatches, fieldAutoRetryDelayMs,
  taskSheetLocks, TASK_SHEET_FIELD_REASON, TASK_SHEET_VIEWER_REASON,
  planFieldRetry, fieldRetrySupersededMessage, fieldRetrySupersededNotice,
} from '../utils/fieldScheduleUpdate';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const MIG = read('supabase', 'migrations', '20260917160000_field_update_schedule_tasks.sql');
const QFU = read('components', 'QuickFieldUpdate.tsx');
const SP = read('app', 'schedule-pro.tsx');
const DFR = read('app', 'daily-report.tsx');
/** The phone schedule — the PRIMARY platform's schedule editor. */
const MSS = read('components', 'schedule', 'mobile', 'MobileScheduleScreen.tsx');
/** The tablet/web schedule tab. */
const TAB = read('app', '(tabs)', 'schedule', 'index.tsx');
/** The daily-report progress ripple lives in the project context. */
const CTX = read('contexts', 'ProjectContext.tsx');
/** The AI draft review screen — where the tab's AI build lands. */
const REVIEW = read('app', 'schedule-review.tsx');

/** The text of one callback, so "the guard runs BEFORE the write" can be
 *  asserted per site rather than anywhere in a 4,600-line screen. */
function slice(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = src.indexOf(end, i);
  return j < 0 ? '' : src.slice(i, j);
}
/** True when this callback refuses the write before attempting it. */
function refusesFirst(body: string, write = 'updateProject('): boolean {
  if (!body) return false;
  const guard = body.indexOf('refuseScheduleWrite(');
  const w = body.indexOf(write);
  return guard >= 0 && w >= 0 && guard < w;
}

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
}

console.log('\nthe server function:');
{
  const allowed = /v_allowed constant text\[\] := array\[([^\]]*)\]/.exec(MIG)?.[1] ?? '';
  const sqlKeys = [...allowed.matchAll(/'([^']+)'/g)].map(m => m[1]).filter(k => k !== 'id').sort();
  ok('the SQL allowlist and FIELD_TASK_PATCH_KEYS are the same list',
    JSON.stringify(sqlKeys) === JSON.stringify([...FIELD_TASK_PATCH_KEYS].sort()), `sql=${sqlKeys} client=${FIELD_TASK_PATCH_KEYS}`);
  ok('no date-move, duration or money key is allowed',
    !sqlKeys.some(k => /startDay$|durationDays|dependencies|estimate|budget|title/.test(k) && !/^actual/.test(k)), sqlKeys.join(','));
  ok('the function the client calls is the one the migration creates', MIG.includes(`create or replace function public.${FIELD_SCHEDULE_RPC}(`));
  ok('gated on can_access_project(pid, \'field\')', /not public\.can_access_project\(p_project_id, 'field'\)/.test(MIG));
  ok('security definer with a pinned search_path', /security definer\s*\n\s*set search_path = public/.test(MIG));
  ok('anon cannot execute; authenticated can',
    /revoke all on function public\.field_update_schedule_tasks\(uuid, jsonb\) from public, anon;/.test(MIG)
    && /grant execute on function public\.field_update_schedule_tasks\(uuid, jsonb\) to authenticated;/.test(MIG));
  ok('an unknown key fails the whole call before the row is read',
    MIG.indexOf("is not a field-access schedule field") > 0 && MIG.indexOf("is not a field-access schedule field") < MIG.indexOf('for update;'));
  ok('merges onto the server copy under a row lock', /select schedule into v_schedule from public\.projects where id = p_project_id for update;/.test(MIG));
  ok('only schedule and updated_at are written', /update public\.projects\s*\n\s*set schedule = /.test(MIG) && !/set (estimate|status|collaborators|client_portal|name)\b/.test(MIG));
  ok('the header says to apply it before the OTA', /APPLY THIS MIGRATION BEFORE THE OTA/.test(MIG));
}

console.log('\nwho writes where:');
ok('field → RPC', scheduleWritePathForRole('field') === 'field_rpc');
ok('owner / editor → row PATCH', scheduleWritePathForRole('owner') === 'row' && scheduleWritePathForRole('editor') === 'row');
ok('viewer → nowhere', scheduleWritePathForRole('viewer') === 'none');
ok('role still loading → row (no read-only flash for the owner)', scheduleWritePathForRole(null) === 'row' && scheduleWritePathForRole(undefined) === 'row');

console.log('\nsplitting an edit into what field access saves:');
{
  const t = (o: Partial<ScheduleTask>): ScheduleTask => ({
    id: 'x', title: 'X', phase: 'P', durationDays: 5, startDay: 1, progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started', ...o,
  } as ScheduleTask);
  const before = [t({ id: 'a', title: 'Framing' }), t({ id: 'b', title: 'Drywall', startDay: 6 })];
  const progressOnly = fieldTaskDiff(before, [t({ id: 'a', title: 'Framing', progress: 60, status: 'in_progress' }), before[1]]);
  ok('progress + status → one patch, nothing blocked',
    JSON.stringify(progressOnly) === JSON.stringify({ patches: [{ id: 'a', progress: 60, status: 'in_progress' }], blocked: [] }), JSON.stringify(progressOnly));
  const moved = fieldTaskDiff(before, [t({ id: 'a', title: 'Framing', progress: 10, startDay: 3 }), before[1]]);
  ok('a date move is blocked, but the progress on the same task still saves',
    moved.blocked.join() === 'Framing' && moved.patches.length === 1 && !('startDay' in moved.patches[0]), JSON.stringify(moved));
  const added = fieldTaskDiff(before, [...before, t({ id: 'c', title: 'Paint' })]);
  ok('an added task is blocked', added.blocked.join() === 'Paint' && added.patches.length === 0);
  ok('a removed task is blocked', fieldTaskDiff(before, [before[0]]).blocked.join() === 'Drywall');
  ok('engine stamps (critical path) are neither sent nor blocked',
    JSON.stringify(fieldTaskDiff(before, [{ ...before[0], isCriticalPath: true }, before[1]])) === JSON.stringify({ patches: [], blocked: [] }));
  const cleared = fieldTaskDiff([t({ id: 'a', actualEndDate: '2026-09-17T12:00:00Z' })], [t({ id: 'a' })]);
  ok('clearing an actual sends null (the server accepts null)', cleared.patches[0]?.actualEndDate === null, JSON.stringify(cleared));
  const applied = applyFieldTaskPatches(before, [{ id: 'a', progress: 60, startDay: 99 } as never]);
  ok('the local copy only takes allowlisted keys', applied[0].progress === 60 && applied[0].startDay === 1 && applied[1] === before[1]);
  ok('settings: an untouched baselines list ([] vs absent) is not a change', !fieldScheduleSettingsChanged({ name: 'S' }, { name: 'S', baselines: [] }));
  ok('settings: closures edited is a change', fieldScheduleSettingsChanged({ nonWorkingDates: [] }, { nonWorkingDates: ['2026-09-18'] }));
}

console.log('\nsending:');
{
  const calls: unknown[] = [];
  const client = (res: { data?: unknown; error?: { message: string; code?: string } | null; throws?: boolean }) => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (res.throws) return Promise.reject(new Error('Network request failed'));
      return Promise.resolve({ data: res.data ?? null, error: res.error ?? null });
    },
  });
  const patches = [{ id: 'a', progress: 60 }];
  const okRes = await sendFieldTaskPatches(client({ data: { applied: ['a'], missing: [] } }), 'p1', patches);
  ok('success resolves ok with the RPC args the migration expects',
    okRes.ok && JSON.stringify(calls[0]) === JSON.stringify({ fn: FIELD_SCHEDULE_RPC, args: { p_project_id: 'p1', p_task_patches: patches } }), JSON.stringify(calls[0]));
  const missing = await sendFieldTaskPatches(client({ data: { applied: [], missing: ['a'] } }), 'p1', patches);
  ok('a task deleted meanwhile is reported as missing', missing.ok && missing.missing.join() === 'a');
  for (const [label, res, re] of [
    ['RLS/role refusal', { error: { message: 'field access required', code: '42501' } }, /^Not saved — your access/],
    ['function not deployed yet', { error: { message: 'Could not find the function', code: 'PGRST202' } }, /^Not saved — progress updates on field access are not switched on/],
    ['disallowed key', { error: { message: 'field_update_schedule_tasks: "startDay" is not a field-access schedule field', code: '22023' } }, /^Not saved — "startDay" is not/],
    ['offline', { throws: true }, /^Not saved — no connection/],
  ] as const) {
    const r = await sendFieldTaskPatches(client(res), 'p1', patches);
    ok(`${label} → not ok, and the message says not saved`, !r.ok && re.test(r.message), JSON.stringify(r));
  }
  const before = calls.length;
  const empty = await sendFieldTaskPatches(client({}), 'p1', []);
  ok('nothing to send makes no call', empty.ok && calls.length === before);
}

console.log('\nthe three screens:');
ok('Quick Field Update routes by the project\'s role', /const writePath = scheduleWritePathForRole\(project\.myRole\);/.test(QFU));
ok('...the field branch is live (not a dead path the row write shadows)',
  /if \(writePath === 'field_rpc'\) \{\s*const fieldPatch = /.test(QFU) && QFU.indexOf("if (writePath === 'field_rpc')") < QFU.indexOf('await sendFieldTaskPatches('));
ok('...field sends through the RPC and returns the failure instead of confirming',
  /const sent = await sendFieldTaskPatches\(supabase, project\.id, \[fieldPatch\]\);\s*if \(!sent\.ok\) return \{ ok: false, message: sent\.message \};/.test(QFU));
ok('...the local copy is only updated after the server said yes',
  QFU.indexOf('await sendFieldTaskPatches(') < QFU.indexOf('applyFieldTaskPatches(tasks, [fieldPatch])'));
ok('...a refused update is shown as an error, not "success"', /outcome\.kind === 'refused'\) \{\s*\/\/[^\n]*\n\s*setFeedback\(\{ kind: 'error'/.test(QFU));
ok('...viewer is refused up front with the reason', /if \(writePath === 'none'\) \{\s*return \{ ok: false, message: `Not saved — you have view-only access/.test(QFU));
ok('Schedule Pro no longer gates on `role !== \'viewer\'` alone', !/const canEdit = role !== 'viewer';/.test(SP));
// While useProjectRole is still null (loading, or its read failed) a KNOWN
// field user must not fall back to the row PATCH that silently drops his edit:
// the loader-stamped project.myRole fills the gap. Owners have no myRole, so
// they still get 'row' with no read-only flash.
ok('Schedule Pro picks its write path from the caller\'s role, falling back to the loaded project.myRole',
  /const writePath = scheduleWritePathForRole\(role \?\? project\?\.myRole\);/.test(SP));
ok('...and project is in scope before the write path reads it', SP.indexOf('const project = useMemo(') > -1
  && SP.indexOf('const project = useMemo(') < SP.indexOf('const writePath = scheduleWritePathForRole('));
ok('Schedule Pro routes field writes to the RPC save',
  /writePath === 'field_rpc'\s*\?\s*\(id, updates\) => \{ void saveAsField\(id, updates\); \}/.test(SP));
ok('...which diffs against the loaded schedule and sends the allowed patches',
  /fieldTaskDiff\(baseTasks, updates\.schedule\.tasks\)/.test(SP) && /await sendFieldTaskPatches\(supabase, id, patches\)/.test(SP));
ok('...and says what was not saved, putting the working copy back',
  /resetWorkingTasksRef\.current\?\.\(accepted\);/.test(SP) && /Not saved: \$\{what\}\. Field access saves progress/.test(SP));
ok('Daily report ripple is blocked for field/viewer with the reason',
  /const path = scheduleWritePathForRole\(project\?\.myRole\);/.test(DFR)
  && /disabled=\{confirmableRows\.length === 0 \|\| delayRowsStale \|\| !!delayRippleBlockedReason\}/.test(DFR)
  && /if \(delayRippleBlockedReason\) \{\s*showAlert\('Schedule not changed', delayRippleBlockedReason\);/.test(DFR));

// ─────────────────────────────────────────────────────────────────────────────
// The phone schedule — MobileScheduleScreen. THE primary platform's editor, and
// the round-2 reviewer's major: its four writes (tap-to-edit persist, the
// start-day-basis answer, the baseline lock, the start date) all went down the
// projects-row PATCH that RLS refuses for a field collaborator.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nthe phone schedule:');
{
  ok('picks its write path from the caller\'s role, falling back to the loaded project.myRole',
    /const role = useProjectRole\(selectedProject\?\.id\);/.test(MSS)
    && /const writePath = scheduleWritePathForRole\(role \?\? selectedProject\?\.myRole\);/.test(MSS));
  ok('...and selectedProject is in scope before the write path reads it',
    MSS.indexOf('const selectedProject = useMemo(') > -1
    && MSS.indexOf('const selectedProject = useMemo(') < MSS.indexOf('const writePath = scheduleWritePathForRole('));
  // Two call sites: the field save and the row save (saveAsRow, which checks
  // for refused sheet values first — integration round 1). Both sit inside
  // the role-routed wrapper's branches.
  const mssRowSave = slice(MSS, 'const saveAsRow = useCallback(', 'const updateProject = useMemo<typeof updateProjectRaw>(');
  ok('every write goes through the role-routed wrapper — the raw writer is reachable ONLY from the field save and the row save',
    (MSS.match(/updateProjectRaw\(/g) ?? []).length === 2
    && (mssRowSave.match(/updateProjectRaw\(/g) ?? []).length === 1
    && /const \{\s*projects,\s*updateProject: updateProjectRaw,/.test(MSS)
    && /const updateProject = useMemo<typeof updateProjectRaw>\(\s*\(\) => \(writePath === 'row'\s*\? saveAsRow/.test(MSS),
    `updateProjectRaw( call sites: ${(MSS.match(/updateProjectRaw\(/g) ?? []).length}, expected 2`);
  ok('...the row save checks which sheet values will be refused, puts them back and says so for a change made in the sheet',
    /const refused = sent \? staleFieldEdits\(kept, sent\) : \[\];/.test(mssRowSave)
    && /touched\?\.taskId === r\.taskId && touched\.keys\.includes\(r\.key\)/.test(mssRowSave)
    && /setRowConflictNotice\(`\$\{title\}'s \$\{what\} was updated elsewhere — in the field or on another device —/.test(mssRowSave));
  ok('...onUpdateTask sets the sheet BEFORE the save, so a put-back value is not overwritten',
    /setDetailTask\(stamped\);[\s\S]{0,600}saveTasks\(tasks\.map\(\(t\) => \(t\.id === stamped\.id \? stamped : t\)\)\);/.test(MSS)
    && !/saveTasks\(tasks\.map\(\(t\) => \(t\.id === stamped\.id \? stamped : t\)\)\);\s*setDetailTask\(stamped\);/.test(MSS));
  ok('...and a refusal notice is reset when the phone switches project',
    /useEffect\(\(\) => \{ setFieldNotice\(null\); setRowConflictNotice\(null\); \}, \[selectedProject\?\.id\]\);/.test(MSS));
  ok('...field → the RPC save, viewer → no write at all',
    /writePath === 'field_rpc'\s*\?\s*\(id, updates\) => \{ void saveAsField\(id, updates\); \}\s*:\s*\(\) => \{ setFieldNotice\(VIEWER_SCHEDULE_NOTICE\); \}/.test(MSS));
  ok('...which diffs against the loaded schedule and sends the allowed patches',
    /fieldTaskDiff\(baseTasks, updates\.schedule\.tasks\)/.test(MSS)
    && /await sendFieldTaskPatches\(supabase, id, patches\)/.test(MSS));
  ok('...the local copy is only written after the server said yes',
    MSS.indexOf('await sendFieldTaskPatches(supabase, id, patches)') < MSS.indexOf('accepted = applyFieldTaskPatches(baseTasks, patches);')
    && /if \(sent\.ok\) \{\s*accepted = applyFieldTaskPatches\(baseTasks, patches\);/.test(MSS));
  ok('...a failure, a blocked change or a settings change says what was not saved',
    /if \(failure \|\| blocked\.length > 0 \|\| settingsChanged\) \{/.test(MSS)
    && /Field access saves progress, status, notes and actual start\/finish only — ask the project owner for editor access to move dates or change tasks\./.test(MSS));
  ok('...and puts the open task sheet back to what the server accepted',
    /setDetailTask\(\(t\) => \(t \? accepted\.find\(\(x\) => x\.id === t\.id\) \?\? null : t\)\);/.test(MSS));
  ok('...the standing notice tells him BEFORE he taps, and the card carries the refusal after',
    /writePath === 'none' \? \(\s*<LockedAccessCard/.test(MSS)
    && /fieldNotice \? \(\s*<LockedAccessCard/.test(MSS)
    && /testID="schedule-field-access-hint"/.test(MSS));
  // The three non-task writes: each must reach the wrapper, never the raw one.
  for (const [label, start, end] of [
    ['the tap-to-edit persist (saveTasks)', 'const saveTasks = useCallback(', 'const onUpdateTask'],
    ['the start-day-basis answer', 'const answerStartDayBasis = useCallback(', 'const reportCpm'],
    ['the baseline lock', 'const lockPlan = useCallback(', 'const requestLockPlan'],
    ['the start date', 'const applyStartDate = useCallback(', 'const [showProjectPicker'],
  ] as const) {
    const body = slice(MSS, start, end);
    ok(`${label} writes through the wrapper`,
      body.length > 0 && body.includes('updateProject(selectedProject.id') && !body.includes('updateProjectRaw('));
  }
  // The two actions that announce themselves out loud. A date re-flow and a
  // baseline are both outside the RPC, so they must refuse BEFORE the alert
  // that would otherwise say the plan moved.
  ok('the whole-plan actions (catch-up, plan lock) refuse before they confirm themselves',
    /if \(wholePlanWriteBlocked\) \{ showAlert\('Schedule not changed', wholePlanWriteBlocked\); setShowFinishSheet\(false\); return; \}/.test(MSS)
    && /if \(wholePlanWriteBlocked\) \{ showAlert\('Plan not locked', wholePlanWriteBlocked\); return; \}/.test(MSS));
  ok('...and their buttons carry the reason instead of staying live',
    /writeBlockedReason=\{wholePlanWriteBlocked\}/.test(MSS)
    && /testID="catch-up-blocked-by-access"/.test(MSS)
    && /testID="lock-plan-blocked-by-access"/.test(MSS));
  ok('an audit row is only written when the write is the one that lands',
    /if \(auditDraft && writePath === 'row'\) void appendAuditToAsyncStorage/.test(MSS)
    && /if \(writePath === 'row'\) \{\s*void appendAuditToAsyncStorage/.test(MSS));
}

// ─────────────────────────────────────────────────────────────────────────────
// The tablet/web schedule tab. None of its five writes is a progress edit, so
// the RPC cannot carry them: they are refused BEFORE the edit, out loud.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nthe schedule tab (tablet / web):');
{
  ok('resolves the write path from the caller\'s role, falling back to project.myRole',
    /const projectRole = useProjectRole\(selectedProject\?\.id\);/.test(TAB)
    && /const scheduleWritePath = scheduleWritePathForRole\(projectRole \?\? selectedProject\?\.myRole\);/.test(TAB));
  ok('the refusal names field access\'s own surfaces and view-only\'s way out',
    /Field access saves task progress, status, notes and actual start\/finish/.test(TAB)
    && /view-only access to this project, so schedule changes are not saved/.test(TAB));
  ok('the gate says why and stops the write',
    /const refuseScheduleWrite = useCallback\(\(what: string\): boolean => \{\s*if \(!scheduleWriteBlockedReason\) return false;\s*showAlert\(`\$\{what\} not saved`, scheduleWriteBlockedReason\);\s*return true;/.test(TAB));
  for (const [label, start, end] of [
    ['What-If scenarios', 'const handleScheduleScenariosChange = useCallback(', 'const refuseWhileWhatIf'],
    ['the task-list sink (saveSchedule)', 'const saveSchedule = useCallback(', 'const openStartDatePicker'],
    ['the project start date', 'const setProjectStartDate = useCallback(', '// Legacy day-scale disclosure'],
    ['the start-day-basis answer', 'const answerStartDayBasis = useCallback(', '/**\n   * Centralized persist helper'],
    ['the baseline lock', 'const commitPlanLock = useCallback(', 'const handleSaveBaseline'],
  ] as const) {
    ok(`${label} is refused before it is written`, refusesFirst(slice(TAB, start, end)));
  }
  // The AI build ends at /schedule-review, whose save is the same row PATCH —
  // so it must be refused BEFORE the generator spends a call on a plan this
  // role cannot keep.
  ok('the AI build from the estimate is refused before the generator runs',
    refusesFirst(slice(TAB, 'const handleBuildFromEstimate = useCallback(', 'const handleOnRampPick'), 'generateScheduleFromEstimate('));
  ok('the lock button refuses before it asks for a confirmation',
    (() => {
      const body = slice(TAB, 'const handleSaveBaseline = useCallback(', 'const handleTemplateSelect');
      return refusesFirst(body, 'showAlert(');
    })());
  ok('and the screen says so standing, on both layouts',
    (TAB.match(/\{scheduleWriteBlockedReason && \(\s*<LockedAccessCard/g) ?? []).length === 2,
    `LockedAccessCard banners: ${(TAB.match(/\{scheduleWriteBlockedReason && \(\s*<LockedAccessCard/g) ?? []).length}, expected 2`);
}

// ─────────────────────────────────────────────────────────────────────────────
// The AI draft's destination. The tab refuses the BUILD, but /schedule-review
// is also reachable from the on-ramp and from schedule-builder, and its accept
// writes the whole plan — a new task list, new dates, rebuilt scalars. There is
// no progress-only version of that, so it is refused at the press, before the
// screen records a prediction or says "saved" and routes to the Gantt.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nthe AI draft review screen:');
{
  ok('resolves the write path from the caller\'s role, falling back to project.myRole',
    /const projectRole = useProjectRole\(projectId\);/.test(REVIEW)
    && /const scheduleWritePath = scheduleWritePathForRole\(projectRole \?\? project\?\.myRole\);/.test(REVIEW));
  // Wave 4 (schedule lane): the wording moved to utils/fieldScheduleUpdate.ts
  // (SCHEDULE_WRITE_FIELD_REASON / _VIEWER_REASON) so the review screen and the
  // template wizard cannot drift; the screen must take its refusal from there.
  const FSU = read('utils', 'fieldScheduleUpdate.ts');
  ok('the refusal names field access\'s own surfaces and view-only\'s way out',
    /export const SCHEDULE_WRITE_FIELD_REASON =\s*'Field access saves task progress, status, notes and actual start\/finish/.test(FSU)
    && /export const SCHEDULE_WRITE_VIEWER_REASON =\s*'You have view-only access to this project, so a new schedule is not saved/.test(FSU)
    && /scheduleWriteBlockedReason as scheduleWriteBlockedReasonFor,[\s\S]{0,120}\} from '@\/utils\/fieldScheduleUpdate';/.test(REVIEW)
    && /useMemo<string \| null>\(\(\) => scheduleWriteBlockedReasonFor\(scheduleWritePath\), \[scheduleWritePath\]\)/.test(REVIEW));
  {
    const body = slice(REVIEW, 'const accept = useCallback(', 'const regenerate');
    ok('accept is refused before anything is written or recorded',
      body.length > 0
      && body.indexOf('showAlert(\'Schedule not saved\', scheduleWriteBlockedReason)') >= 0
      && body.indexOf('showAlert(\'Schedule not saved\', scheduleWriteBlockedReason)') < body.indexOf('recordPrediction(')
      && body.indexOf('showAlert(\'Schedule not saved\', scheduleWriteBlockedReason)') < body.indexOf('updateProject('));
    ok('...and the refusal is in its dependency list, so a role that resolves late is honoured',
      /\}, \[project, draft, tasks, updateProject, router, width, canAccess, preApplied, pacedIds, scheduleWriteBlockedReason\]\);/.test(REVIEW));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The daily-report progress ripple (ProjectContext.propagateProgressFromDFR) —
// the superintendent who files the report is usually the field user.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nthe daily-report progress ripple:');
{
  const body = slice(CTX, 'const propagateProgressFromDFR = useCallback(', 'const stageDfrPhotos');
  ok('the ripple is found and routes by the project\'s role',
    body.length > 0 && /const writePath = scheduleWritePathForRole\(proj\.myRole\);/.test(body));
  ok('...view-only writes nothing', /if \(writePath === 'none'\) return;/.test(body));
  ok('...field sends its progress through the RPC, not the row PATCH',
    /if \(writePath === 'field_rpc'\) \{/.test(body)
    && /fieldTaskDiff\(schedule\.tasks, nextTasks\)/.test(body)
    && /sendFieldTaskPatches\(supabase, proj\.id, patches\)/.test(body));
  ok('...the local copy is only written after the server took it, and only for what it took',
    body.indexOf('sendFieldTaskPatches(supabase, proj.id, patches)') < body.indexOf('applyFieldTaskPatches(live.tasks, accepted)')
    && /const accepted = patches\.filter\(\(p\) => !sent\.missing\.includes\(p\.id\)\);/.test(body)
    && /if \(!sent\.ok\) \{[\s\S]*?showAlert\('Schedule not updated'/.test(body));
  ok('...a refused ripple is reported, never confirmed',
    /The daily report itself saved — its progress did not reach the schedule\./.test(body));
  // The mic writes the schedule and files the report in the same tick; a
  // ripple rebuilt from the render-time `projects` closure put back a task the
  // same update had just lowered. It must read the live ref, both before the
  // diff and again after the field RPC's round trip.
  ok('...reads the LIVE project (projectsRef), not the render-time closure',
    /const proj = projectsRef\.current\.find\(p => p\.id === report\.projectId\);/.test(body)
    && /const live = projectsRef\.current\.find\(p => p\.id === proj\.id\)\?\.schedule \?\? schedule;/.test(body));
  ok('...and its deps do not pin the stale `projects` array',
    /\}, \[updateProject\]\);/.test(body) && !/\}, \[projects, updateProject\]\);/.test(body)
    && /const proj = projectsRef\.current\.find/.test(body));
  ok('...and the owner/editor path is unchanged',
    /updateProject\(proj\.id, \{\s*schedule: \{ \.\.\.schedule, tasks: nextTasks, updatedAt: new Date\(\)\.toISOString\(\) \},\s*\}\);/.test(body));
}

// The global voice mic's field_update wrote progress with the row PATCH RLS
// refuses for field users, and reported "N tasks updated" for every role.
{
  const mic = read('components', 'UniversalMicButton.tsx');
  const i = mic.indexOf('if (workProgress.length > 0) {');
  const body = i < 0 ? '' : mic.slice(i, mic.indexOf('// 3) Daily report draft', i));
  ok('the voice mic routes schedule progress by the project\'s role',
    /const writePath = scheduleWritePathForRole\(proj\.myRole\);/.test(body));
  ok('...viewer: refused with the reason, never "tasks updated"',
    /if \(writePath === 'none'\) \{\s*summaryParts\.push\(`schedule not updated — you have view-only access/.test(body));
  ok('...field: sent through the field RPC, and a failure is said, not counted',
    /const sent = await sendFieldTaskPatches\(supabase, proj\.id, patches\);\s*if \(!sent\.ok\) \{\s*summaryParts\.push\(`schedule not updated — \$\{sent\.message\}`\);/.test(body)
      && body.indexOf("writePath === 'field_rpc'") < body.indexOf('await sendFieldTaskPatches('));
  ok('...the row PATCH is reached only on the owner/editor path',
    (body.match(/ctx\.updateProject\(proj\.id, \{ schedule: \{ \.\.\.schedule, tasks: updatedTasks \} \}\)/g) ?? []).length === 1
      && body.lastIndexOf('} else {') < body.indexOf('tasks: updatedTasks }'));
}

ok('Schedule Pro writes add / delete / reflow history only on the row write path',
  /const writeAudit = useCallback\(\(entry: Parameters<typeof buildAuditEntry>\[0\]\) => \{\s*if \(!project\?\.id \|\| writePath !== 'row'\) return;/.test(SP));

// handleEdit and applyLeveling appended to the audit directly, bypassing
// writeAudit: on field access a refused date / dependency edit or a leveling
// shift still wrote a 'task_edit' / 'Resource leveling' row into his history.
// Every append in the screen must now be behind a write-path check.
{
  const appends = [...SP.matchAll(/appendAuditToAsyncStorage\(/g)].map(m => m.index ?? 0);
  const unguarded = appends.filter((i) => {
    const before = SP.slice(Math.max(0, i - 1400), i);
    return !/writePath !== 'row'\) return;\s*void $/.test(before)
      && !/if \(before && project\?\.id && auditable\) \{/.test(before)
      && !/if \(project\?\.id && writePath === 'row'\) \{\s*void $/.test(before)
      && !/if \(sent\.ok\) \{[\s\S]*const landed = patches\.filter\(p => !sent\.missing\.includes\(p\.id\)\);[\s\S]*for \(const p of landed\) \{[\s\S]*void $/.test(before);
  });
  ok('Schedule Pro: every audit append is behind a write-path check or a confirmed field save (handleEdit, leveling, writeAudit, saveAsField)',
    appends.length >= 4 && unguarded.length === 0, `${unguarded.length} unguarded of ${appends.length}`);
  // Integration round: a field edit's audit row used to be written at the tap,
  // before the RPC — an offline or refused save still left "Framing → 60%" in
  // the append-only history. handleEdit now logs the row write path only, and
  // saveAsField logs a field edit once the server has taken it.
  ok('...handleEdit logs only on the row write path',
    /const auditable = writePath === 'row';\s*if \(before && project\?\.id && auditable\) \{/.test(SP));
  const save = slice(SP, 'const saveAsField = useCallback(', 'const updateProject = useMemo<typeof updateProjectRaw>(');
  ok('...saveAsField writes the field audit row only after the RPC said yes, for the tasks it took',
    save.indexOf('await sendFieldTaskPatches(supabase, id, patches)') >= 0
      && save.indexOf('await sendFieldTaskPatches(supabase, id, patches)') < save.indexOf('appendAuditToAsyncStorage(')
      && /if \(sent\.ok\) \{[\s\S]*?appendAuditToAsyncStorage\([\s\S]*?\} else \{\s*failure = sent\.message;/.test(save)
      && /const landed = patches\.filter\(p => !sent\.missing\.includes\(p\.id\)\);/.test(save));
  ok('...a clean save clears an earlier refusal notice',
    /if \(!failure && blocked\.length === 0 && !settingsChanged\) \{[\s\S]*?if \(patches\.length > 0\) setFieldNotice\(null\);/.test(save));
  ok('...and the notice is reset when the screen switches project',
    /useEffect\(\(\) => \{ setFieldNotice\(null\); \}, \[projectId\]\);/.test(SP));
}

// ─────────────────────────────────────────────────────────────────────────────
// #138 — a send that did not land. The padlock card ("Date and task editing is
// hidden on field access") sat over every RPC failure, a lost connection
// included, and nothing ever re-sent the tap. Now: a plain alert banner with
// Retry, an automatic re-send while offline, and the card only for what access
// really refused. The phone and Schedule Pro are pinned TOGETHER.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#138 — a failed field send:');
{
  const kinds = [
    ['offline', { message: 'Network request failed' }, true, true],
    ['fetch failure', { message: 'TypeError: Failed to fetch' }, true, true],
    ['server hiccup', { message: 'internal error', code: 'XX000' }, false, true],
    ['access revoked', { message: 'field access required', code: '42501' }, false, false],
    ['not a field key', { message: 'x', code: '22023' }, false, false],
    ['not deployed', { message: 'Could not find the function', code: 'PGRST202' }, false, false],
  ] as const;
  for (const [label, err, offline, retryable] of kinds) {
    const k = classifyFieldSendFailure(err);
    ok(`${label} → offline=${offline}, retryable=${retryable}`, k.offline === offline && k.retryable === retryable, JSON.stringify(k));
  }
  const offlineRes = await sendFieldTaskPatches({ rpc: () => Promise.reject(new Error('Network request failed')) }, 'p1', [{ id: 'a', progress: 60 }]);
  ok('an offline send says so on the result (offline + retryable)', !offlineRes.ok && offlineRes.offline && offlineRes.retryable, JSON.stringify(offlineRes));

  const t = (o: Partial<ScheduleTask>): ScheduleTask => ({
    id: 'x', title: 'X', phase: 'P', durationDays: 5, startDay: 1, progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started', ...o,
  } as ScheduleTask);
  const base = [t({ id: 'a', title: 'Framing', progress: 10 }), t({ id: 'b', title: 'Drywall' })];
  const sent = { message: 'Not saved — no connection.', offline: true, retryable: true };
  const f1 = captureFieldSendFailure('p1', base, [{ id: 'a', progress: 60, status: 'in_progress' }], sent);
  ok('a failure remembers what each key held when it failed', f1.before.a.progress.value === 10 && f1.before.a.status.value === 'not_started', JSON.stringify(f1.before));
  ok('retry re-sends a key still holding that value',
    JSON.stringify(pendingFieldRetryPatches(f1, base)) === JSON.stringify([{ id: 'a', progress: 60, status: 'in_progress' }]));
  const gcMoved = [t({ id: 'a', title: 'Framing', progress: 80, status: 'in_progress', fieldEditedAt: { progress: '2026-09-18T10:00:00Z', status: '2026-09-18T10:00:00Z' } } as Partial<ScheduleTask>), base[1]];
  ok('...and drops a key someone changed since (never writes a stale value over a newer one)',
    pendingFieldRetryPatches(f1, gcMoved).length === 0, JSON.stringify(pendingFieldRetryPatches(f1, gcMoved)));
  const restamped = [t({ id: 'a', title: 'Framing', progress: 10, fieldEditedAt: { progress: '2026-09-18T10:00:00Z' } } as Partial<ScheduleTask>), base[1]];
  ok('...a key whose stamp moved (same value, newer write) is dropped too',
    JSON.stringify(pendingFieldRetryPatches(f1, restamped)) === JSON.stringify([{ id: 'a', status: 'in_progress' }]), JSON.stringify(pendingFieldRetryPatches(f1, restamped)));
  ok('...a task deleted meanwhile is dropped', pendingFieldRetryPatches(f1, [base[1]]).length === 0);
  const f2 = captureFieldSendFailure('p1', base, [{ id: 'b', notes: 'rained out' }], { message: 'Not saved — no connection (2).', offline: true, retryable: true });
  const merged = mergeFieldSendFailure(f1, f2);
  ok('a second failure on the same job folds in — Retry sends both', pendingFieldRetryPatches(merged, base).length === 2 && merged.message.endsWith('(2).'));
  ok('another job\'s failure replaces it', mergeFieldSendFailure(f1, { ...f2, projectId: 'p2' }).projectId === 'p2' && mergeFieldSendFailure(f1, { ...f2, projectId: 'p2' }).patches.length === 1);
  // The re-send is decided against a FRESH READ of the row, never this
  // device's copy (review round 1): a phone with no signal cannot have
  // received the GC's newer edit, and the RPC stamps what lands with the
  // server clock — so a retry off the local copy overwrote his 80% at noon
  // with the foreman's 9:00 60%.
  {
    const plan = await planFieldRetry(f1, async () => gcMoved);
    ok('a retry reads the row first: a newer SERVER value arrived while the send was failing → nothing is sent',
      plan.read && plan.patches.length === 0, JSON.stringify(plan));
    ok('...and he is told his change was dropped because it changed elsewhere',
      plan.read && plan.superseded.length === 1 && plan.superseded[0] === 'Framing'
        && /not sent: it was changed elsewhere while you had no signal/.test(fieldRetrySupersededMessage(plan.superseded))
        && fieldRetrySupersededNotice('p1', ['Framing']).retryable === false, JSON.stringify(plan));
    const stillSame = await planFieldRetry(f1, async () => base);
    ok('...an unchanged server row gets the held value, diffed against that read',
      stillSame.read && JSON.stringify(stillSame.patches) === JSON.stringify([{ id: 'a', progress: 60, status: 'in_progress' }])
        && stillSame.serverTasks === base && stillSame.superseded.length === 0, JSON.stringify(stillSame));
    const noRead = await planFieldRetry(f1, async () => null);
    const thrown = await planFieldRetry(f1, () => Promise.reject(new Error('Network request failed')));
    ok('...no read (still offline, or an error) → nothing is sent, the failure is kept', !noRead.read && !thrown.read);
    const already = await planFieldRetry(f1, async () => [t({ id: 'a', title: 'Framing', progress: 60, status: 'in_progress' }), base[1]]);
    ok('...a server already holding his value sends nothing and reports nothing', already.read && already.patches.length === 0 && already.superseded.length === 0);
  }
  ok('auto re-send backs off 5 s, doubling, capped at a minute',
    fieldAutoRetryDelayMs(0) === 5000 && fieldAutoRetryDelayMs(1) === 10000 && fieldAutoRetryDelayMs(3) === 40000 && fieldAutoRetryDelayMs(9) === 60000);

  for (const [label, src, saveStart, saveEnd] of [
    ['phone', MSS, 'const saveAsField = useCallback(', 'const saveAsRow = useCallback('],
    ['Schedule Pro', SP, 'const saveAsField = useCallback(', 'const [fieldConflictNotice'],
  ] as const) {
    const save = slice(src, saveStart, saveEnd);
    ok(`${label}: a failed send is captured for Retry, in the failure branch`,
      /failure = sent\.message;\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*const captured = captureFieldSendFailure\(id, baseTasks, patches, sent\);\s*setFieldFailure\(\(?prev\)? => mergeFieldSendFailure\(prev, captured\)\);/.test(save));
    ok(`${label}: the padlock notice carries ONLY what access refused, never the send failure`,
      !/\[\s*failure,/.test(save) && /if \(what\) setFieldNotice\(/.test(save));
    ok(`${label}: the failure renders in the plain alert banner, with Retry only when a retry can work`,
      /<FieldSendFailureBanner\s*message=\{fieldFailureShown\.message\}\s*onRetry=\{fieldFailureShown\.retryable \? retryFieldSend : undefined\}\s*onDismiss=\{dismissFieldFailure\}\s*autoRetrying=\{fieldFailureShown\.offline\}/.test(src)
      && /\{writePath === 'field_rpc' && fieldFailureShown \? \(/.test(src));
    const retry = slice(src, 'const retryFieldSend = useCallback(', 'const dismissFieldFailure');
    ok(`${label}: Retry READS the row and plans against it before anything is sent`,
      /const plan = await planFieldRetry\(f, async \(\) => \{\s*const \{ data, error \} = await supabase\.from\('projects'\)\.select\('schedule'\)\.eq\('id', f\.projectId\)\.maybeSingle\(\);\s*if \(error\) return null;/.test(retry)
        && retry.indexOf('planFieldRetry(') < retry.indexOf('saveAsField(')
        && !/pendingFieldRetryPatches\(f, current/.test(retry));
    ok(`${label}: no read → nothing sent, the failure kept (re-armed); a superseded value is said`,
      /if \(!plan\.read\) \{ setFieldFailure\(\(?cur\)? => \(cur === f \? \{ \.\.\.f \} : cur\)\); return; \}/.test(retry)
        && /const notice = plan\.superseded\.length > 0 \? fieldRetrySupersededNotice\(f\.projectId, plan\.superseded\) : null;/.test(retry));
    ok(`${label}: ...the send goes through saveAsField, diffed against and applied over the READ`,
      /await saveAsField\(f\.projectId, \{ schedule: \{ \.\.\.current, tasks: applyFieldTaskPatches\(plan\.serverTasks, plan\.patches\) \} \}, plan\.serverTasks\);/.test(retry)
        && /const baseTasks = serverBase \?\? currentSchedule\.tasks \?\? \[\];/.test(save));
    ok(`${label}: one retry at a time (the timer and the foreground can both fire)`,
      /if \(!f \|\| retryInFlightRef\.current\) return;/.test(retry) && /retryInFlightRef\.current = false;/.test(retry));
    ok(`${label}: an offline failure re-sends by itself (backoff + back to foreground)`,
      /if \(!fieldFailure\?\.offline\) return;\s*const h = setTimeout\(\(\) => \{ autoRetryAttemptRef\.current \+= 1; retryFieldSend\(\); \}, fieldAutoRetryDelayMs\(autoRetryAttemptRef\.current\)\);/.test(src)
      && /if \(next === 'active' && fieldFailureRef\.current\?\.offline\) retryFieldSend\(\);/.test(src));
    ok(`${label}: a superseded retryable failure stops showing`,
      /if \(!fieldFailure\.retryable\) return fieldFailure;\s*return pendingFieldRetryPatches\(fieldFailure, [^)]+\)\.length > 0 \? fieldFailure : null;/.test(src));
  }
  const card = read('components', 'LockedAccessCard.tsx');
  ok('the banner is an alert, not the padlock card', /export function FieldSendFailureBanner\(/.test(card)
    && /accessibilityRole="alert"/.test(card) && !/is hidden on field access[\s\S]*export function FieldSendFailureBanner[\s\S]*is hidden on field access/.test(card));
}

// ─────────────────────────────────────────────────────────────────────────────
// #139 — the phone task sheet says what this access saves BEFORE the tap.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#139 — the phone task sheet:');
{
  const SHEET = read('components', 'schedule', 'mobile', 'TaskDetailSheet.tsx');
  const f = taskSheetLocks('field_rpc');
  const v = taskSheetLocks('none');
  const r = taskSheetLocks('row');
  ok('field: plan controls locked, progress controls live, with the reason', f.plan && !f.progress && f.reason === TASK_SHEET_FIELD_REASON);
  ok('viewer: everything locked, with the reason', v.plan && v.progress && v.reason === TASK_SHEET_VIEWER_REASON);
  ok('owner/editor (and unset): nothing locked', !r.plan && !r.progress && r.reason === null && taskSheetLocks(undefined).reason === null);
  ok('the field reason names the checklist, the milestone and delete', /checklist/.test(TASK_SHEET_FIELD_REASON) && /milestone/.test(TASK_SHEET_FIELD_REASON) && /deleting/.test(TASK_SHEET_FIELD_REASON));
  ok('the phone passes its write path into the sheet', /onDeleteTask=\{onDeleteTask\}\s*writePath=\{writePath\}/.test(MSS));
  ok('the sheet shows the reason inline', /\{locks\.reason \? \(\s*<Text style=\{styles\.lockReason\} testID="task-sheet-access-reason">\{locks\.reason\}<\/Text>/.test(SHEET));
  ok('start and duration steppers are disabled on plan lock',
    (SHEET.match(/onInc=\{\(\) => shift(Start|Duration)\(1\)\} disabled=\{locks\.plan\} \/>/g) ?? []).length === 2);
  ok('the milestone switch is disabled', /onValueChange=\{toggleMilestone\} disabled=\{locks\.plan\}/.test(SHEET));
  ok('name and crew are not editable', (SHEET.match(/editable=\{!locks\.plan\}/g) ?? []).length === 2);
  ok('delete is disabled', /onPress=\{handleDelete\} disabled=\{locks\.plan\}/.test(SHEET));
  ok('the checklist is a read-out (no tick, no "+ add item") on plan lock',
    /\{locks\.plan\s*\? <ReadOnlyChecklist items=\{checklist\} \/>\s*: <TaskChecklist items=\{checklist\} onToggle=\{toggleChecklist\} onAdd=\{addChecklist\} \/>\}/.test(SHEET));
  ok('status, % and notes are locked for view-only only',
    /onPress=\{\(\) => setStatus\(s\)\} disabled=\{locks\.progress\}/.test(SHEET)
    && /\{locks\.progress \? null : \(\s*<PercentSlider/.test(SHEET)
    && /editable=\{!locks\.progress\}/.test(SHEET));
  ok('every locked handler refuses too (a control that slipped through cannot write)',
    ['shiftStart', 'shiftDuration', 'toggleMilestone', 'commitCrew'].every(h => new RegExp(`const ${h} = \\([^)]*\\) => \\{ if \\(locks\\.plan\\) return;`).test(SHEET))
    && /const handleDelete = \(\) => \{\s*if \(locks\.plan\) return;/.test(SHEET));
  ok('the standing hint names the checklist', /const FIELD_SCHEDULE_HINT = '[^']*ticking checklist items[^']*';/.test(MSS));
  // The checklist-ticks migration is a founder decision; until it ships, the
  // client must not claim checklist is a field key.
  ok('checklist is not a field key until its migration ships', !(FIELD_TASK_PATCH_KEYS as readonly string[]).includes('checklist'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
