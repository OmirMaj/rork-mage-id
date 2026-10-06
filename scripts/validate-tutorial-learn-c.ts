// validate-tutorial-learn-c.ts — lane C's three tutorials (schedule-say-it,
// time-clock-in, punch-list-close) are honest: sample hours never reach pay or
// the cost book, the schedule fixture never stands in for a real AI turn, and
// every success signal follows the real write.
//
// What it pins, in the order it fails:
//
//   1. SAMPLE TIME (executed — M3). A finished shift on a sample project
//      ("Sample — …") contributes NOTHING to computeLaborStats, to
//      buildLaborSamples (the cost book's feed), to a worker's overtime, to
//      selectPayrollEntries (rows AND open shifts) or to buildTimeEntriesCSV;
//      the same shift renamed out of the prefix is real labor again; and the
//      real shifts' numbers are byte-identical with or without it.
//   2. SCHEDULE FIXTURE (executed). scheduleSampleTurn answers from
//      SCHEDULE_SAMPLE only for an EXACT (normalized) sentence on a live sample
//      run; an edited sentence is refused (no relay, no meter) and any sentence
//      off a sample run is the real turn — the fixture path is unreachable on a
//      real project. The sample answer, run through the real interpreter and
//      CPM, lands the applied payload {moved 1, deltaDays 2, finishShiftDays 2}.
//   3. DEFS. The spec's titles, endings, seconds; every lane-C signal inbound.
//   4. SCREENS (source scan, comments stripped).
//      • CopilotShell: every utterance() (the only road to the relay) is
//        decided by tutorialTurn() first; the seam needs the scheduleEdit
//        capability, the run's own project AND a sample; the bundled answer
//        goes through normalizeEditOps and is labelled SAMPLE_NO_CREDITS_LABEL;
//        the refusal shown is the def's own sentence.
//      • ScheduleEditPanel: 'schedule.edit.applied' is sent only in the branch
//        AFTER commit() returned and commitRefused(wrote) was false.
//      • time-tracking / punch-list: each signal follows its real write; the
//        practice pass is OR'd into the gate and keyed to the URL project;
//        no slide is ever wrapped; nothing a sub could hear about fires on an
//        assign (the only punch notification is the sub's own mark-ready).
//      • every lane-C <TutorialTarget> is conditional on a live run there, so a
//        real job (and every phone golden) renders byte-identical.
//
// MUTATION PLANTS (each must turn this red; restore byte-identical, then cmp):
//   • utils/laborSamples.ts computeLaborStats drops `|| isSampleTimeEntry(e)`  → "computeLaborStats"
//   • utils/timeClockPayroll.ts drops `if (isSampleTimeEntry(e)) continue;`    → "selectPayrollEntries"
//   • defs/scheduleSayIt.ts `!==` → `===` in scheduleSampleTurn               → "edited sentence is refused"
//   • CopilotShell.tsx utterance() wrapper calls realUtterance(text) first    → "every turn"
//   • ScheduleEditPanel.tsx sends the signal before `const wrote = commit(`   → "after commit"
//
// Pure node:fs + direct imports of pure modules (no react-native — that
// crashes bun). fileURLToPath + join because the repo path has a space.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TimeEntry } from '../types';
import { buildLaborSamples, computeLaborStats, isSampleTimeEntry } from '../utils/laborSamples';
import { buildTimeEntriesCSV, selectPayrollEntries } from '../utils/timeClockPayroll';
import { DEFAULT_OVERTIME_RULE } from '../utils/overtime';
import { SCHEDULE_SAMPLE, sampleScheduleTasks } from '../utils/tutorial/fixtures';
import {
  SCHEDULE_SAMPLE_NO_TASK, SCHEDULE_SAMPLE_REFUSAL, scheduleAppliedPayload, scheduleSampleTurn,
} from '../utils/tutorial/defs/scheduleSayIt';
import { PUNCH_LIST_SAMPLE } from '../utils/tutorial/defs/punchListClose';
import { LANE_C_DEFS, LANE_C_SIGNALS, LANE_C_TARGETS } from '../utils/tutorial/learn/laneC';
import { interpretScheduleOps, applyEditEffects } from '../utils/copilot/scheduleEdit/interpretOps';
import { normalizeEditOps } from '../utils/copilot/scheduleEdit/editOps';
import { runCpm } from '../utils/cpm';
import type { TutorialDef } from '../utils/tutorial/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
// Block comments (JSX ones too) and whole-line // comments.
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

// ── 1. sample time never reaches pay or the cost book ───────────────────────
console.log('sample time (M3)');
{
  const SAMPLE = "Sample — Sarah's Place";
  const hh = (n: number) => String(n).padStart(2, '0');
  const shift = (id: string, projectId: string, projectName: string, day: string, hours: number, status: TimeEntry['status'] = 'clocked_out', startHour = 8): TimeEntry => ({
    id, projectId, projectName, workerId: 'w1', workerName: 'Mike Rivera', trade: 'Carpentry',
    clockIn: `${day}T${hh(startHour)}:00:00`, ...(status === 'clocked_out' ? { clockOut: `${day}T${hh(startHour + hours)}:00:00` } : {}),
    breakMinutes: 0, totalHours: status === 'clocked_out' ? hours : 0, overtimeHours: 0, status, date: day,
  });
  // A full real week (Mon–Fri, 8 h) plus one 6 h sample shift on the Monday
  // BEFORE the real one — counted toward the week, it would push 6 h of the
  // real Friday into overtime (the allocation is chronological).
  const realWeek = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']
    .map((d, i) => shift(`r${i}`, '11111111-1111-4111-8111-111111111111', 'Henderson Kitchen', d, 8));
  const sampleShift = shift('s1', '22222222-2222-4222-8222-222222222222', SAMPLE, '2026-09-28', 6, 'clocked_out', 1);
  const sampleOpen = shift('s2', '22222222-2222-4222-8222-222222222222', SAMPLE, '2026-10-02', 0, 'clocked_in');
  const rates = { carpentry: 60 };

  ok('isSampleTimeEntry: the byte-exact sample prefix only',
    isSampleTimeEntry(sampleShift) && !isSampleTimeEntry(realWeek[0]) && !isSampleTimeEntry(null)
      && !isSampleTimeEntry({ projectName: 'Sample - Sarah' }) && !isSampleTimeEntry({ projectName: 'sample — x' }));

  const statsReal = computeLaborStats(realWeek, rates);
  const statsMixed = computeLaborStats([...realWeek, sampleShift, sampleOpen], rates);
  const statsSample = computeLaborStats([sampleShift], rates);
  ok('computeLaborStats: a sample shift adds nothing (eligible, sampled, hours)',
    JSON.stringify(statsMixed) === JSON.stringify(statsReal) && statsSample.eligibleEntries === 0 && statsSample.sampledEntries === 0 && statsSample.sampledHours === 0,
    `real ${JSON.stringify(statsReal)} · mixed ${JSON.stringify(statsMixed)} · sample ${JSON.stringify(statsSample)}`);

  const booksReal = buildLaborSamples(realWeek, rates, 1.5, DEFAULT_OVERTIME_RULE);
  const booksMixed = buildLaborSamples([...realWeek, sampleShift, sampleOpen], rates, 1.5, DEFAULT_OVERTIME_RULE);
  ok('buildLaborSamples (the cost book): no sample group, and the real cost is unchanged (no overtime from sample hours)',
    JSON.stringify(booksMixed) === JSON.stringify(booksReal) && buildLaborSamples([sampleShift], rates).length === 0 && booksReal.length === 1,
    `real ${JSON.stringify(booksReal.map(b => [b.projectName, b.actualUnit, b.quantity]))} · mixed ${JSON.stringify(booksMixed.map(b => [b.projectName, b.actualUnit, b.quantity]))}`);

  const renamed = { ...sampleShift, projectName: "Sarah's Place" };
  ok('the same shift on a project renamed out of the prefix IS labor (one definition of sample)',
    computeLaborStats([renamed], rates).sampledEntries === 1);

  const selMixed = selectPayrollEntries([...realWeek, sampleShift, sampleOpen], '2026-09-28', '2026-10-04');
  const selReal = selectPayrollEntries(realWeek, '2026-09-28', '2026-10-04');
  ok('selectPayrollEntries: no sample row and no sample open shift in a payroll export',
    selMixed.rows.length === 5 && selMixed.open.length === 0 && selMixed.rows.every(r => !isSampleTimeEntry(r))
      && JSON.stringify(selMixed) === JSON.stringify(selReal),
    `rows ${selMixed.rows.map(r => r.id).join(',')} · open ${selMixed.open.map(r => r.id).join(',')}`);
  const sampleOnlySel = selectPayrollEntries([sampleShift, sampleOpen], '2026-09-28', '2026-10-04', { projectId: sampleShift.projectId });
  ok('selectPayrollEntries: an export of the sample job alone holds nothing', sampleOnlySel.rows.length === 0 && sampleOnlySel.open.length === 0);

  const csvMixed = buildTimeEntriesCSV([...realWeek, sampleShift], DEFAULT_OVERTIME_RULE, [...realWeek, sampleShift, sampleOpen]);
  const csvReal = buildTimeEntriesCSV(realWeek, DEFAULT_OVERTIME_RULE, realWeek);
  ok('buildTimeEntriesCSV: a sample row handed in is dropped and counts toward no overtime',
    csvMixed === csvReal && !csvMixed.includes('Sample') && csvMixed.split('\n').length === 6);
}

// ── 2. the schedule fixture path ────────────────────────────────────────────
console.log('schedule fixture');
{
  let n = 0;
  const tasks = sampleScheduleTasks(() => `t${++n}`);
  const drywall = tasks.find(t => /drywall/i.test(t.title))!;
  const exact = scheduleSampleTurn(SCHEDULE_SAMPLE.sentence, true, tasks);
  ok('the exact sentence on a live sample run is the bundled answer (no relay)',
    exact.kind === 'sample' && JSON.stringify(exact.ops) === JSON.stringify([{ op: 'move', task: drywall.id, deltaDays: 2 }]), JSON.stringify(exact));
  const recased = scheduleSampleTurn('  push DRYWALL 2 days - board delivery slipped!! ', true, tasks);
  ok('a re-cased, re-dashed, re-spaced copy normalizes equal', recased.kind === 'sample');
  const edited = scheduleSampleTurn('Push drywall 3 days — board delivery slipped', true, tasks);
  ok('an edited sentence is refused on the sample (no relay, no meter)',
    edited.kind === 'refuse' && edited.why === 'words' && edited.reason === SCHEDULE_SAMPLE_REFUSAL, JSON.stringify(edited));
  const own = scheduleSampleTurn('Add a two-week cabinet lead time before install', true, tasks);
  ok('his own words on the sample mid-run are refused too', own.kind === 'refuse');
  ok('off a live sample run (a real project, or no run) the exact sentence is the REAL turn — the fixture is unreachable',
    scheduleSampleTurn(SCHEDULE_SAMPLE.sentence, false, tasks).kind === 'real'
      && scheduleSampleTurn('Push drywall 3 days', false, tasks).kind === 'real');
  const noTask = scheduleSampleTurn(SCHEDULE_SAMPLE.sentence, true, tasks.filter(t => t.id !== drywall.id));
  ok('a sample schedule with no drywall task: refused with the reason, nothing invented',
    noTask.kind === 'refuse' && noTask.why === 'noTask' && noTask.reason === SCHEDULE_SAMPLE_NO_TASK);
  ok('the refusal copy is the spec sentence', SCHEDULE_SAMPLE_REFUSAL === 'On the sample, use the sample sentence. Your own changes run on a real job.');

  // The bundled answer through the real normalizer, interpreter and CPM — the
  // same producer the capability's apply() hands the host's commit.
  const ops = exact.kind === 'sample' ? normalizeEditOps(exact.ops) : { ops: [], dropped: [] };
  ok('the bundled ops survive the real normalizer unchanged', ops.dropped.length === 0 && ops.ops.length === 1);
  for (const cpm of [{}, { scheduleStartDate: '2026-10-05', workingDaysPerWeek: 5 }]) {
    const { nextTasks, results } = interpretScheduleOps(ops.ops, tasks, cpm);
    const after = applyEditEffects(ops.ops, nextTasks, cpm);
    const payload = scheduleAppliedPayload(tasks, after, runCpm(tasks, cpm).projectFinish, runCpm(after, cpm).projectFinish);
    ok(`the sample apply lands moved 1, deltaDays 2, finishShiftDays 2 (${cpm && 'scheduleStartDate' in cpm ? 'calendar' : 'raw days'})`,
      results.every(r => r.ok) && payload.moved === 1 && payload.deltaDays === 2 && payload.finishShiftDays === 2, JSON.stringify(payload));
  }
  const mixed = scheduleAppliedPayload([{ id: 'a', startDay: 1 }, { id: 'b', startDay: 5 }], [{ id: 'a', startDay: 2 }, { id: 'b', startDay: 8 }], 10, 10);
  ok('scheduleAppliedPayload: unequal shifts name no deltaDays; a held finish is 0',
    mixed.moved === 2 && !('deltaDays' in mixed) && mixed.finishShiftDays === 0, JSON.stringify(mixed));
  ok('scheduleAppliedPayload: nothing moved → moved 0, no deltaDays',
    JSON.stringify(scheduleAppliedPayload([{ id: 'a', startDay: 1 }], [{ id: 'a', startDay: 1 }], 5, 5)) === JSON.stringify({ moved: 0, finishShiftDays: 0 }));
}

// ── 3. defs ─────────────────────────────────────────────────────────────────
console.log('defs');
{
  const byId = new Map<string, TutorialDef>(LANE_C_DEFS.map(d => [d.id, d]));
  const want: [string, string, string, number, string][] = [
    ['schedule-say-it', 'Move a task by saying it', 'Drywall moved 2 days and the finish date updated', 35, 'schedule'],
    ['time-clock-in', 'Clock Your Crew In and Out', 'A shift on the sample that never reaches payroll', 40, 'site'],
    ['punch-list-close', 'Add, Assign and Close a Punch Item', "A closed item on the sample's punch list", 40, 'site'],
  ];
  for (const [id, title, endsWith, seconds, group] of want) {
    const d = byId.get(id);
    ok(`${id}: spec title, ending, seconds and group`, !!d && d.title === title && d.endsWith === endsWith && d.seconds === seconds && d.group === group,
      d ? JSON.stringify([d.title, d.endsWith, d.seconds, d.group]) : 'missing');
  }
  ok('time-clock-in and punch-list-close practise only their own feature; schedule-say-it needs none (the editor has no tier gate)',
    JSON.stringify(byId.get('time-clock-in')?.practiceFeatures) === '["subcontractor_management"]'
      && JSON.stringify(byId.get('punch-list-close')?.practiceFeatures) === '["punch_list_closeout"]'
      && JSON.stringify(byId.get('schedule-say-it')?.practiceFeatures) === '[]'
      && JSON.stringify(byId.get('schedule-say-it')?.needs) === '["schedule"]');
  ok('no lane-C signal is outbound', Object.values(LANE_C_SIGNALS).every(s => s.outbound === false));
  const tc = byId.get('time-clock-in');
  const detailText = (tc?.steps ?? []).map(s => (typeof s.detail === 'string' ? s.detail : '')).join(' | ');
  ok('time clock copy: the empty-roster card and the payroll line are the spec sentences',
    !!tc?.steps[0].textByTarget?.['time.noCrew']?.toString().startsWith('Add your crew first')
      && detailText.includes('The time clock clocks in people from your crew list.')
      && detailText.includes('Sample hours stay out of payroll and your labor rates.'));
  ok('the punch sample line is its own (not the punch walk one) and names a sample room',
    PUNCH_LIST_SAMPLE.line === 'Touch up paint at the hall closet' && PUNCH_LIST_SAMPLE.room === 'Hall');
  ok('every lane-C step on the editor draws on the scheduleEdit layer, and its targets live there',
    (byId.get('schedule-say-it')?.steps ?? []).filter(s => s.layer === 'scheduleEdit').every(s => {
      const t = Array.isArray(s.target) ? s.target[0] : s.target;
      return typeof t === 'string' && t in LANE_C_TARGETS && LANE_C_TARGETS[t as keyof typeof LANE_C_TARGETS].layer === 'scheduleEdit';
    }));
}

// ── 4. screens ──────────────────────────────────────────────────────────────
console.log('screens');
{
  const shell = strip(read('components/copilot/CopilotShell.tsx'));
  // The hook's utterance() is the only road to the relay and the meter. The
  // shell renames it realUtterance and calls it in ONE place: its own
  // utterance() wrapper, after tutorialTurn() has had the turn.
  ok('CopilotShell: every turn (typed, spoken, auto-sent) is decided by tutorialTurn() before the hook\'s utterance()',
    /utterance: realUtterance,/.test(shell)
      && /const utterance = useCallback\(\(text: string\) => \{\s*if \(tutorialTurn\(text\)\) return;\s*realUtterance\(text\);\s*\}, \[tutorialTurn, realUtterance\]\);/.test(shell)
      && (shell.match(/realUtterance\(/g) ?? []).length === 1
      && !/convo\.utterance|\.utterance\(/.test(shell));
  ok('CopilotShell: the seam needs the scheduleEdit capability, the run on THIS project AND a sample',
    /const runOnThis = capabilityId === 'scheduleEdit' && !!ctx\.projectId && tutorialSandboxId === ctx\.projectId;/.test(shell)
      && /const sampleRun = runOnThis && isSampleProject\(ctx\.project\);/.test(shell)
      && /scheduleSampleTurn\(text, sampleRun,/.test(shell));
  const seam = shell.slice(shell.indexOf('const tutorialTurn = useCallback('), shell.indexOf("return 'sample';"));
  ok('CopilotShell: the bundled answer goes through normalizeEditOps into the draft, THEN the previewed signal',
    seam.indexOf('normalizeEditOps(turn.ops)') > 0 && seam.indexOf('patchDraft({ ops, dropped: [] })') > seam.indexOf('normalizeEditOps(turn.ops)')
      && seam.indexOf("tutorialSignal('schedule.edit.previewed'") > seam.indexOf('patchDraft(')
      && !/mageAI|checkAILimit|recordAIUsage|utterance\(/.test(seam));
  ok('CopilotShell: the bundled answer is labelled SAMPLE_NO_CREDITS_LABEL in the review', /sampleReview \? <Text[^>]*>\{SAMPLE_NO_CREDITS_LABEL\}<\/Text>/.test(shell));
  ok("CopilotShell: the refusal shown is the def's sentence (literal t() English)",
    shell.includes(`t('common.tutorial.scheduleSampleRefusal', '${SCHEDULE_SAMPLE_REFUSAL}')`)
      && shell.includes(`t('common.tutorial.scheduleSampleNoTask', '${SCHEDULE_SAMPLE_NO_TASK}')`));
  ok("CopilotShell: 'Do it for me' fills the sentence only on a sample run, never presses Continue",
    /useTutorialAssist\('schedule\.useSampleSentence', \(\) => \{\s*if \(!sampleRunRef\.current\) return;\s*setCompose\(SCHEDULE_SAMPLE\.sentence\);\s*\}\);/.test(shell));

  const panel = strip(read('components/copilot/ScheduleEditPanel.tsx'));
  const commitAt = panel.indexOf('const wrote = commit(');
  const refusedAt = panel.indexOf('if (commitRefused(wrote))', commitAt);
  const signalAt = panel.indexOf("tutorialSignal('schedule.edit.applied'");
  ok("ScheduleEditPanel: 'schedule.edit.applied' is sent only after commit() returned success",
    commitAt > 0 && refusedAt > commitAt && signalAt > refusedAt
      && /\}\s*else if \(runOnThisRef\.current && beforeRef\.current && afterRef\.current\) \{/.test(panel.slice(refusedAt, signalAt + 1))
      && (panel.match(/tutorialSignal\(/g) ?? []).length === 1);
  ok('ScheduleEditPanel: the snapshot is cleared before each commit (the signal names THIS commit)',
    /beforeRef\.current = null;\s*afterRef\.current = null;\s*const wrote = commit\(/.test(panel));
  ok('ScheduleEditPanel: the scheduleEdit layer mounts only on a run here, in the sheet and in the docked pane',
    (panel.match(/\{runOnThis \? <TutorialLayer host="scheduleEdit" \/> : null\}/g) ?? []).length === 2);

  const tt = strip(read('app/time-tracking.tsx'));
  const madeAt = tt.indexOf('if (!made) {');
  const inAt = tt.indexOf("tutorialSignal('time.clockedIn', { projectId: project.id, count: 1 })");
  const batchAt = tt.indexOf("tutorialSignal('time.clockedIn', { projectId: project.id, count: made })");
  ok('time-tracking: clock-in signals follow the written entries',
    madeAt > 0 && inAt > madeAt && batchAt > tt.indexOf('if (made === 0) return;'));
  const outAt = tt.indexOf("tutorialSignal('time.clockedOut'");
  ok('time-tracking: the clock-out signal follows a landed write only (never failed / already)',
    outAt > tt.indexOf('const outcome = await clockOutDetailed(entry.id, outIso);')
      && /if \(outcome === 'synced' \|\| outcome === 'queued' \|\| outcome === 'local'\) \{\s*tutorialSignal\('time\.clockedOut'/.test(tt));
  ok('time-tracking: the practice pass is OR\'d into the gate, keyed to the URL project, and opens only that job',
    /const practiceOpen = useTutorialPractice\(gateProjectId \|\| undefined\)\.has\('subcontractor_management'\);/.test(tt)
      && /if \(practiceOpen && !ownTier && !hasSeat\) \{\s*return <TimeTrackingScreenInner ownTier=\{ownTier\} practiceProjectId=\{gateProjectId \?\? null\} \/>;/.test(tt)
      && (tt.match(/clockableReason\(p, ownTier \|\| p\.id === practiceProjectId\)/g) ?? []).length === 2
      && /ownTierAllows: canAccessOwnTier\('subcontractor_management'\) \|\| \(!!selectedProject && selectedProject\.id === practiceProjectId\)/.test(tt));

  const pl = strip(read('app/punch-list.tsx'));
  ok('punch-list: saved follows addPunchItem; assigned follows the edit write; closed follows the close write',
    /addPunchItem\(item\);\s*tutorialSignal\('punchList\.saved'/.test(pl)
      && /\.\.\.punchPhotoPatch\(photoEdit, replacementUpload\),\s*\}\);\s*if \(assignedSub\.trim\(\)\) tutorialSignal\('punchList\.assigned'/.test(pl)
      && /updatePunchItem\(item\.id, punchStatusPatch\(item, newStatus, new Date\(\)\.toISOString\(\)\)\);\s*if \(newStatus === 'closed'\) tutorialSignal\('punchList\.closed'/.test(pl));
  ok('punch-list: the practice pass is OR\'d into the gate on the URL project',
    /const practiceOpen = useTutorialPractice\(gateProjectId\)\.has\('punch_list_closeout'\);\s*if \(practiceOpen && !canAccess\('punch_list_closeout'\)\) return <PunchListScreenInner ownTier=\{ownTier\} \/>;\s*if \(!canAccess\('punch_list_closeout'\)\) \{/.test(pl));
  ok("punch-list: 'Do it for me' only opens a prefilled form on a sample run — never Save",
    /useTutorialAssist\('punchList\.useSampleLine', \(\) => \{\s*if \(!punchSampleRef\.current\) return;[\s\S]{0,200}?setShowForm\(true\);\s*\}\);/.test(pl)
      && !/useTutorialAssist\('punchList\.useSampleLine'[\s\S]{0,300}?handleSave\(/.test(pl));

  // No slide is a tutorial step: nothing wraps a SlideToConfirm.
  const slideWrapped = [tt, pl].some(src => [...src.matchAll(/<SlideToConfirm\b/g)].some(m => {
    const before = src.slice(Math.max(0, (m.index ?? 0) - 400), m.index);
    const open = before.lastIndexOf('<TutorialTarget');
    return open >= 0 && before.indexOf('</TutorialTarget>', open) < 0;
  }));
  ok('no slide (clock-out, close the project) is ever wrapped', !slideWrapped && !pl.includes('punch-close-project-slide">') );

  // Nobody hears about an assign: the only punch notification is the sub's own
  // mark-ready from his portal, gated on a setting only that RPC sets.
  const migDir = join(ROOT, 'supabase/migrations');
  const punchNotifies: string[] = [];
  for (const f of readdirSync(migDir).filter(x => x.endsWith('.sql'))) {
    const sql = readFileSync(join(migDir, f), 'utf8');
    for (const m of sql.matchAll(/fire_notify\(\s*'([a-z_]+)',\s*'punch_items'/g)) punchNotifies.push(`${f}:${m[1]}`);
    if (/create trigger \w+\s+after (insert|update)[^;]*on public\.punch_items/i.test(sql) && !/notify_punch_marked_ready|punch_items_guard/.test(sql)) punchNotifies.push(`${f}: unknown punch_items trigger`);
  }
  ok('assigning a sub sends nothing: every punch_items notification is punch_marked_ready',
    punchNotifies.length > 0 && punchNotifies.every(x => x.endsWith(':punch_marked_ready')), punchNotifies.join(', '));

  // Every lane-C wrapper renders only during a run there.
  const GUARD = /runOnThis \?|runOnThis &&|tutorial \?|tutorialClockOut \?|if \(!runOnThis\) return|r\.entry\.id === tutorialEntryId/;
  const files = ['app/time-tracking.tsx', 'app/punch-list.tsx', 'app/(tabs)/schedule/index.tsx', 'components/schedule/mobile/MobileScheduleScreen.tsx',
    'components/copilot/CopilotShell.tsx', 'components/copilot/ScheduleDiffView.tsx'];
  const loose: string[] = [];
  for (const f of files) {
    const lines = strip(read(f)).split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('<TutorialTarget')) return;
      const win = lines.slice(Math.max(0, i - 6), i + 1).join('\n');
      if (!GUARD.test(win)) loose.push(`${f}:${i + 1}`);
    });
  }
  ok('every lane-C <TutorialTarget> is conditional on a live run on that job', loose.length === 0, loose.join(', '));
  ok('the editor sheet is never part of a schedule blocker (it hosts its own layer)',
    ![strip(read('app/(tabs)/schedule/index.tsx')), strip(read('components/schedule/mobile/MobileScheduleScreen.tsx'))]
      .some(src => { const at = src.indexOf('<TutorialTarget id="schedule.modalUp"'); return at < 0 || /editOpen/.test(src.slice(Math.max(0, at - 500), at)); }));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
