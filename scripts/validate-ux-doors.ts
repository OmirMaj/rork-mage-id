// validate-ux-doors.ts — UX wave, Lane D ("the doors").
//
// Part 1 runs the pure rules in utils/uxDoors.ts under bun: the job-picker
// order (D1), the always-pick rows and the "+ New job" chain (D1), the + menu's
// Field float (D3), which jobs get the field quick row (D2), the optional
// client fields (D4) and the sidebar's combined toggle count (D6).
//
// Part 2 pins the wiring in the files that use them, because a rule nobody
// calls proves nothing: the job page's field row and its route-contract
// hrefs, the proposal button that snapshots instead of gating, the client
// fields on the New Project form and the edit-job sheet, and Home's chain
// from "+ New job" into the wizard.
//
// Pure node:fs + pure modules only (no react-native import; bun crashes on it).
// Run: bun scripts/validate-ux-doors.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  sortJobsForPicker, pickerRank, alwaysPicksJob, newJobThenFor, readNewJobThen,
  fieldGroupFirst, moneyRowsHidden, showsFieldRow, clientFieldsProblem, hasClientInput,
  editedPrimaryContact, combineRowCounts, FIELD_MORNING_END_HOUR,
} from '../utils/uxDoors';
import type { RowCount } from '../utils/sidebarCounts';
import { buildPaletteRows } from '../utils/paletteRows';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

let failures = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  PASS  ' + name); return; }
  failures += 1;
  console.error('  FAIL  ' + name + (detail ? `\n        ${detail}` : ''));
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log('\nux-doors validation (Lane D):');

// ── 1. Pure rules ────────────────────────────────────────────────────────────

// D1 — the picker order.
{
  const J = (id: string, status: string, updatedAt: string) => ({ id, status: status as 'draft', updatedAt });
  const jobs = [
    J('closed-new', 'closed', '2026-09-26T10:00:00Z'),
    J('done', 'completed', '2026-09-26T09:00:00Z'),
    J('old-live', 'in_progress', '2026-01-01T00:00:00Z'),
    J('new-draft', 'draft', '2026-09-20T00:00:00Z'),
    J('recent-est', 'estimated', '2026-02-01T00:00:00Z'),
    J('closed-old', 'closed', '2025-01-01T00:00:00Z'),
  ];
  const got = sortJobsForPicker(jobs, ['recent-est', 'ghost', 'done']).map(j => j.id);
  ok(`D1 live jobs first (recent first, then newest update), completed, then closed (${got.join(', ')})`,
    eq(got, ['recent-est', 'new-draft', 'old-live', 'done', 'closed-new', 'closed-old']));
  ok('D1 a closed job is never the top row, even when it was touched last',
    sortJobsForPicker([J('c', 'closed', '2026-09-27T00:00:00Z'), J('a', 'draft', '2020-01-01T00:00:00Z')], ['c'])[0].id === 'a');
  ok('D1 the sort never drops or adds a job and keeps ties stable',
    sortJobsForPicker(jobs).length === jobs.length
    && eq(sortJobsForPicker([J('x', 'draft', 'bad'), J('y', 'draft', 'bad')]).map(j => j.id), ['x', 'y']));
  ok('D1 pickerRank: closed 2, completed 1, everything else 0',
    pickerRank('closed') === 2 && pickerRank('completed') === 1 && pickerRank('in_progress') === 0 && pickerRank(undefined) === 0);
}

// D1 — the always-pick rows and the "+ New job" chain.
{
  ok('D1 Estimate, Schedule and Scope Sheet always pick the job; Daily Report and Invoice do not',
    alwaysPicksJob('Estimate') && alwaysPicksJob('Schedule') && alwaysPicksJob('Scope Sheet')
    && !alwaysPicksJob('Daily Report') && !alwaysPicksJob('Invoice') && !alwaysPicksJob('estimate'));
  ok('D1 "+ New job" chains Estimate → the estimate wizard, Schedule → the schedule wizard, Scope Sheet → no chain',
    newJobThenFor('Estimate') === 'estimate' && newJobThenFor('Schedule') === 'schedule' && newJobThenFor('Scope Sheet') === null);
  ok("D1 Home reads ?then= strictly (only 'estimate' / 'schedule'; arrays use the first value)",
    readNewJobThen('estimate') === 'estimate' && readNewJobThen(['schedule', 'x']) === 'schedule'
    && readNewJobThen('Estimate') === null && readNewJobThen('') === null && readNewJobThen(undefined) === null);
}

// D3 — the Field float.
{
  const at = (iso: string) => new Date(iso);
  // Local-time constructors, so the rule is checked in the zone it reads.
  const wedMorning = new Date(2026, 8, 23, FIELD_MORNING_END_HOUR - 1, 59);
  const wedEleven = new Date(2026, 8, 23, FIELD_MORNING_END_HOUR, 0);
  const satMorning = new Date(2026, 8, 26, 8, 0);
  const sunMorning = new Date(2026, 8, 27, 7, 0);
  ok('D3 a weekday before 11 am floats the Field group; 11:00 does not',
    fieldGroupFirst(wedMorning, 'owner') && !fieldGroupFirst(wedEleven, 'owner'));
  ok('D3 Saturday and Sunday mornings do not float it; the field role floats it any time',
    !fieldGroupFirst(satMorning, null) && !fieldGroupFirst(sunMorning, 'editor')
    && fieldGroupFirst(satMorning, 'field') && fieldGroupFirst(wedEleven, 'field') && fieldGroupFirst(at('2026-09-23T23:00:00'), 'field'));
  ok('D3 Money rows hide for the field role: a field default job, or no default and every job field',
    moneyRowsHidden('field', ['owner']) && moneyRowsHidden(null, ['field', 'field'])
    && !moneyRowsHidden(null, ['field', 'editor']) && !moneyRowsHidden(null, ['field', null])
    && !moneyRowsHidden('owner', ['field']) && !moneyRowsHidden(null, []));
}

// D2 — which jobs get the field row.
{
  ok('D2 only an in_progress job gets the field row; draft / estimated / completed / closed keep the office row',
    showsFieldRow('in_progress') && !showsFieldRow('draft') && !showsFieldRow('estimated')
    && !showsFieldRow('completed') && !showsFieldRow('closed') && !showsFieldRow(undefined));
}

// D4 — the client fields.
{
  ok('D4 blank client fields are fine (optional)', clientFieldsProblem({}) === null && clientFieldsProblem({ name: '  ', email: '', phone: ' ' }) === null);
  ok('D4 a typed email that cannot be used is said, not dropped', typeof clientFieldsProblem({ email: 'tom@' }) === 'string' && typeof clientFieldsProblem({ email: 'tom reyes' }) === 'string');
  ok('D4 a typed phone under 7 digits is said', typeof clientFieldsProblem({ phone: '555-12' }) === 'string' && clientFieldsProblem({ phone: '(212) 555-0148' }) === null);
  ok('D4 a good name / email / phone passes', clientFieldsProblem({ name: 'Tom Reyes', email: 'tom@arch.com', phone: '212 555 0148' }) === null);
  ok('D4 hasClientInput sees any typed field', hasClientInput({ name: 'T' }) && !hasClientInput({ name: ' ', email: '' }));

  const none = editedPrimaryContact(undefined, {});
  ok('D4 nothing typed on a new job writes nothing', none.changed === false && none.next === undefined);
  const fresh = editedPrimaryContact(undefined, { name: ' Tom Reyes ', email: 'tom@arch.com', phone: '' });
  ok('D4 a new job gets exactly the typed fields, trimmed (through seedClientEverywhere)',
    fresh.changed && eq(fresh.next, { name: 'Tom Reyes', email: 'tom@arch.com' }));
  const prev = { name: 'Meredith Harlow', phone: '(503) 555-0148', email: 'm.harlow@example.test' };
  const same = editedPrimaryContact(prev, { ...prev });
  ok('D4 the edit sheet saved unchanged writes nothing', same.changed === false);
  const cleared = editedPrimaryContact(prev, { name: 'Meredith Harlow', phone: '(503) 555-0148', email: '' });
  ok('D4 an email CLEARED in the edit sheet is removed (it must not stay on file as the next recipient)',
    cleared.changed && eq(cleared.next, { name: 'Meredith Harlow', phone: '(503) 555-0148' }));
  const allCleared = editedPrimaryContact(prev, { name: '', phone: '', email: '' });
  ok('D4 clearing every field leaves no contact (written as null)', allCleared.changed && allCleared.next === undefined);
  const changedEmail = editedPrimaryContact(prev, { ...prev, email: 'new@x.co' });
  ok('D4 a changed email replaces the old one, the rest kept', changedEmail.changed && changedEmail.next?.email === 'new@x.co' && changedEmail.next?.phone === prev.phone);
}

// D6 — the toggle's combined count.
{
  const rc = (open: number, alert: number, label: string): RowCount => ({ open, alert, pill: String(open), label });
  ok('D6 nothing counted → no toggle count (never a 0)', combineRowCounts([undefined, undefined], ['RFIs', 'Submittals']) === undefined);
  const both = combineRowCounts([rc(3, 1, '3 open, 1 overdue'), rc(2, 0, '2 open')], ['RFIs', 'Submittals']);
  ok('D6 RFIs + Submittals add up, the overdue alert survives, the label names each part',
    !!both && both.open === 5 && both.alert === 1 && both.pill === '5' && both.label === 'RFIs 3 open, 1 overdue; Submittals 2 open');
  const onlyRfi = combineRowCounts([rc(1, 1, '1 open, 1 overdue'), undefined], ['RFIs', 'Submittals']);
  ok('D6 one overdue RFI alone still reaches the toggle with its dot', !!onlyRfi && onlyRfi.open === 1 && onlyRfi.alert === 1);
  ok("D6 past 99 the pill reads '99+'", combineRowCounts([rc(80, 0, '80 open'), rc(40, 0, '40 open')], ['a', 'b'])?.pill === '99+');
}

// ── 2. Wiring ───────────────────────────────────────────────────────────────

{
  const pd = read('app', 'project-detail.tsx');
  ok('D2 the job page computes fieldRow from showsFieldRow(project.status)', /const fieldRow = showsFieldRow\(project\?\.status\);/.test(pd));
  ok('D2 the field row pushes the route-contract doors for THIS job (daily report, photo, punch new=1, clock in)',
    /router\.push\(routeHref\('\/daily-report', \{ projectId: project\.id \}\)\)/.test(pd)
    && /router\.push\(photoTriageHref\(project\.id\)\)/.test(pd)
    && /router\.push\(punchListNewHref\(project\.id\)\)/.test(pd)
    && /router\.push\(clockInHref\(project\.id\)\)/.test(pd)
    && /testID="project-field-actions"/.test(pd));
  ok('D2 Voice is HELD with A3: the job page has no Voice door (the global mic takes no job and could file to another one)',
    !/openVoice/.test(pd) && !/key: 'voice'/.test(pd) && !/useSearch/.test(pd));
  ok('D2 the Photo lock is project-aware (canAccessProject), like the lineup row',
    /const photoLock = canAccessProject\('photo_documentation'\) \? null : tileLockReason\('photos', hubRole,/.test(pd));
  ok('D2 a live job with no schedule / no estimate still has its create doors (moved into Field Ops / Money, same testIDs)',
    /\.\.\.\(!project\.schedule \? \[\{ key: 'build-schedule', label: 'Build schedule', Icon: CalendarDays, testID: 'project-create-schedule-btn', onPress: buildSchedule \}\] : \[\]\),/.test(pd)
    && /\[\{ key: 'create-estimate', label: 'Create estimate', Icon: Receipt, testID: 'project-create-estimate-btn', onPress: \(\) => router\.push\(routeHref\('\/estimate-wizard', \{ projectId: project\.id \}\)\) \}\]\),/.test(pd));
  ok('D2 a live job WITH an estimate keeps its one-tap door into the estimate editor (Money: Estimate, same testID)',
    /money: hubPerms\.showMoney \? \[[\s\S]{0,200}\.\.\.\(hasAnyEstimate\s*\? \[\{ key: 'view-estimate', label: 'Estimate', Icon: Receipt, testID: 'project-view-estimate-btn', onPress: \(\) => router\.replace\(routeHref\('\/\(tabs\)\/estimate\/full', \{ projectId: project\.id \}\)\) \}\]\s*: \[\{ key: 'create-estimate'/.test(pd));
  ok('D2 a locked field door says why (tileLockReason) and names it in the a11y label',
    /accessibilityLabel=\{a\.lock \? `\$\{a\.label\}\. \$\{a\.lock\}` : a\.label\}/.test(pd)
    && /tileLockReason\('punchList', hubRole,/.test(pd) && /tileLockReason\('timeTracking', hubRole,/.test(pd));
  ok('D2 the office row is kept for jobs that are not live ({!fieldRow && …}) and its buttons move into the groups for live ones',
    /\{!fieldRow && \(\s*<>/.test(pd)
    && /testID: 'project-weekly-snapshot-btn'/.test(pd) && /testID: 'project-cash-flow-btn'/.test(pd) && /testID: 'project-payment-forecast-btn'/.test(pd)
    && /money: hubPerms\.showMoney \? \[/.test(pd));
  ok("D2 a live job offers Tomorrow's lineup (route contract), gated on schedule_gantt_pdf with its reason",
    /router\.push\(tomorrowLineupHref\(project\.id\)\)/.test(pd)
    && /const lineupLock = canAccessProject\('schedule_gantt_pdf'\) \? null : tileLockReason\('lineup', hubRole, requiredTierFor\('schedule_gantt_pdf'\)\);/.test(pd));
  ok('D2 ProjectHero leads on a live job only for a role that may see money (and renders once)',
    /\{fieldRow && canViewFinancials\(hubRole\) \? <ProjectHero project=\{project\} pulse=\{pulse\} \/> : null\}/.test(pd)
    && /\{fieldRow && canViewFinancials\(hubRole\) \? null : <ProjectHero project=\{project\} pulse=\{pulse\} \/>\}/.test(pd));
  ok('D2 on a phone the Punch List tile opens the punch list (no preview sheet)',
    /if \(!isDesktop && tile\.key === 'punchList'\) \{ router\.push\(routeHref\('\/punch-list', \{ projectId: id \?\? '' \}\)\); return; \}/.test(pd));
  ok('D2 a live job\'s collapsed Documentation group names its open RFIs (the RFI log\'s counters)',
    /const rfiCounts = fieldRow \? rfiLogCounts\(projectRFIs, new Date\(\)\) : null;/.test(pd) && /testID="tile-group-docs-rfis"/.test(pd));
  ok('D4 "Create Proposal" has no disabled gate: it snapshots (snapshotPatch manual) and opens /contract?fromRevision',
    !/save a revision first/.test(pd) && !/create-proposal-disabled/.test(pd)
    && /const patch = snapshotPatch\(project, 'manual'\);/.test(pd)
    && /navigateFromTile\(\{ pathname: '\/contract', params: \{ projectId: id, fromRevision: revisionId \} \}\)/.test(pd)
    && /From an older revision<\/Text>/.test(pd));
  ok('D4 the edit sheet carries the client (validated, then editedPrimaryContact)',
    /testID="edit-client-email-input"/.test(pd) && /const clientProblem = clientFieldsProblem\(clientTyped\);/.test(pd)
    && /\.\.\.\(client\.changed \? \{ primaryContact: client\.next \} : \{\}\),/.test(pd));
}

{
  const home = read('app', '(tabs)', '(home)', 'index.tsx');
  ok('D4 the New Project form has the optional client fields, validated, written as primaryContact',
    /testID="project-client-name-input"/.test(home) && /testID="project-client-phone-input"/.test(home) && /testID="project-client-email-input"/.test(home)
    && /const clientProblem = clientFieldsProblem\(clientTyped\);/.test(home)
    && /const client = editedPrimaryContact\(undefined, clientTyped\);/.test(home)
    && /\.\.\.\(client\.next \? \{ primaryContact: client\.next \} : \{\}\),/.test(home));
  ok('D1 "+ New job" chains into the wizard for the NEW job (the create modal\'s own id), else the usual next-step sheet',
    /if \(then === 'estimate'\) \{\s*router\.push\(\{ pathname: '\/estimate-wizard', params: \{ projectId: id \} \} as never\);/.test(home)
    && /\} else if \(then === 'schedule'\) \{\s*router\.push\(\{ pathname: '\/schedule-wizard', params: \{ projectId: id, scratch: '1' \} \} as never\);/.test(home)
    && /setShowNextStepModal\(true\);/.test(home));
  ok('D1 the chain is read from ?then= and from the CreateMenu callback, and cleared when the modal closes without a job',
    /startCreate\(readNewJobThen\(thenParam\)\);/.test(home)
    && /onCreateProject=\{\(then\) => startCreate\(then \?\? null\)\}/.test(home)
    && /const closeCreateModal = useCallback\(\(\) => \{\s*setShowCreateModal\(false\);\s*setCreateThen\(null\);/.test(home));
  ok('D1 the chain is armed only when the create modal will open (the project-cap paywall leaves it null, so a later New Project is not thrown into a wizard)',
    /setCreateThen\(canCreateProject\(realProjectCount\) \? then : null\);\s*handleCreatePress\(\);/.test(home)
    && (home.match(/setCreateThen\(/g) ?? []).length === 3);
}

// D1 in Cmd+K (utils/paletteRows): Estimate, Schedule and Scope Sheet never
// go silently to the active job. "For a new project" leads (chained to its
// wizard), then named jobs, the active one first; other scoped rows keep the
// active job, unchanged.
{
  const opts = [
    { label: 'Estimate', subtitle: 'Price a job', href: '/estimate-wizard', scoped: true },
    { label: 'Schedule', subtitle: 'Plan the work', href: '/schedule-wizard', scoped: true },
    { label: 'RFI', subtitle: 'Ask the architect', href: '/rfi', scoped: true },
  ];
  const active = { id: 'live', name: 'Henderson' };
  const mru = [{ id: 'lead', name: 'Birch ADU' }, { id: 'live', name: 'Henderson' }, { id: 'old', name: 'Cedar roof' }];
  const build = (query: string, activeJob: typeof active | null) => buildPaletteRows({
    query, minimal: false, activeJob, recentJobs: mru, projectHits: [], createOptions: opts,
    featureHits: [], records: [], recentSearches: [],
  }).filter(r => r.lane === 'actions');
  const est = build('estimate', active);
  ok('D1 palette: "Estimate" leads with a for-a-new-project row chained to the estimate wizard',
    est[0]?.ref.kind === 'needs-project' && (est[0].ref as { then?: string }).then === 'estimate' && est[0].sublabel === 'For a new project',
    JSON.stringify(est[0]));
  const estJobs = est.filter(r => r.ref.kind === 'create').map(r => (r.ref as { projectId: string }).projectId);
  ok('D1 palette: then named jobs, the active job first, each one named (never one silent active-job row)',
    eq(estJobs, ['live', 'lead', 'old']) && est.filter(r => r.ref.kind === 'create').every(r => !!r.sublabel), JSON.stringify(estJobs));
  const sch = build('schedule', null);
  ok('D1 palette: "Schedule" with no active job: new-project row (schedule chain), then the recent jobs',
    sch[0]?.ref.kind === 'needs-project' && (sch[0].ref as { then?: string }).then === 'schedule'
    && eq(sch.filter(r => r.ref.kind === 'create').map(r => (r.ref as { projectId: string }).projectId), ['lead', 'live', 'old']));
  const rfi = build('rfi', active);
  ok('D1 palette: other scoped rows (RFI) still go to the active job, one row',
    rfi.length === 1 && rfi[0].ref.kind === 'create' && (rfi[0].ref as { projectId: string }).projectId === 'live');
  const cp = read('components', 'search', 'CommandPalette.tsx');
  ok('D1 palette: the new-project row passes its chain to Home (?openCreate=1&then=)',
    /router\.push\(routeHref\('\/', ref\.then \? \{ openCreate: '1', then: ref\.then \} : \{ openCreate: '1' \}\)\);/.test(cp));
}

if (failures > 0) {
  console.error(`\nux-doors validation FAILED (${failures})\n`);
  process.exit(1);
}
console.log('\n  PASS  ux-doors: the job page, the + menu, the New Project form and the rail open the right door\n');
