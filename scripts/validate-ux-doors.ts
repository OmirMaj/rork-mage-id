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
  lineupToolsDoor, planName, chainContractFromLoad, moneyChainForRole,
} from '../utils/uxDoors';
import { subsPayRows, centsLabel, dollarsToCents, PAY_NEEDS_ROSTER_SUB, SUBS_PAY_EMPTY, SUB_NOT_NAMED, NAME_THE_SUB } from '../utils/subsPayRows';
import { jobBackLink } from '../utils/uxRoutes';
import { formatMoney } from '../utils/formatters';
import type { RowCount } from '../utils/sidebarCounts';
import { buildPaletteRows } from '../utils/paletteRows';
import { PANEL_SECTION_KEYS, SECTION_TITLES, sectionTitle, desktopTileTarget } from '../utils/projectWorkspaceLayout';

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
  // W1 UXDOORS: the Voice door (flipped from "HELD with A3" once openVoice
  // took a projectId): native only, files to THIS job, starts recording.
  ok('D2 Voice door: native only (Platform.OS !== \'web\'), after Clock in, openVoice({ projectId: project.id, autoStart: true })',
    /\{ key: 'clock-in', label: 'Clock in'[^\n]*\n[\s\S]{0,400}\.\.\.\(Platform\.OS !== 'web' \? \[\{\s*key: 'voice', label: 'Voice', Icon: Mic, lock: voiceLock,/.test(pd)
    && /openVoice\(\{ projectId: project\.id, autoStart: true \}\);/.test(pd)
    && /const \{ openVoice \} = useSearch\(\);/.test(pd)
    && !/Voice is\s+HELD/.test(pd));
  ok('D2 Voice door: a seat that cannot file says why instead of recording (projectRecordWriteBlock)',
    /const voiceLock = projectRecordWriteBlock\(hubRole \?\? undefined\);/.test(pd)
    && /if \(voiceLock\) \{ showAlert\("Can't record here", voiceLock\); return; \}/.test(pd));
  ok('D2 the Photo lock is project-aware (canAccessProject), like the lineup row',
    /const photoLock = canAccessProject\('photo_documentation'\) \? null : tileLockReason\('photos', hubRole,/.test(pd));
  ok('D2 a live job with no schedule / no estimate still has its create doors (moved into Field Ops / Money, same testIDs)',
    /\.\.\.\(!project\.schedule \? \[\{ key: 'build-schedule', label: 'Build schedule', Icon: CalendarDays, testID: 'project-create-schedule-btn', onPress: buildSchedule \}\] : \[\]\),/.test(pd)
    && /\[\{ key: 'create-estimate', label: 'Create estimate', Icon: Receipt, testID: 'project-create-estimate-btn', onPress: \(\) => router\.push\(routeHref\('\/estimate-wizard', \{ projectId: project\.id \}\)\) \}\]\),/.test(pd));
  ok('D2 a live job WITH an estimate keeps its one-tap door into the estimate editor (Money: Estimate, same testID)',
    /money: hubPerms\.showMoney \? \[[\s\S]{0,200}\.\.\.\(hasAnyEstimate\s*\? \[\{ key: 'view-estimate', label: 'Estimate', Icon: Receipt, testID: 'project-view-estimate-btn', onPress: \(\) => router\.replace\(estimateFromJobHref\(project\.id\)\) \}\]\s*: \[\{ key: 'create-estimate'/.test(pd));
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

// ── 3. W1 UXDOORS: Back returns to the job (D2) ─────────────────────────────
// Every job-page door into the schedule tab and the Full Estimator carries
// from=job; the three receivers draw "< <job name>" → /project-detail?id=
// ONLY with from=job, and today's link (or none) without it.
{
  const pd = read('app', 'project-detail.tsx');
  const schedDoors = (pd.match(/scheduleFromJobFocusHref\(id \?\? '', String\(Date\.now\(\)\)\)/g) ?? []).length;
  ok('D2 senders: every phone door into the schedule tab carries from=job (scheduleFromJobFocusHref, keeps the focus nonce) — 4 sites',
    schedDoors === 4 && !/pathname: '\/\(tabs\)\/schedule'/.test(pd) && !/routeHref\('\/\(tabs\)\/schedule'/.test(pd), `found ${schedDoors}`);
  ok('D2 senders: the phone line of openSchedule is one of them (desktop web keeps scheduleDestination)',
    /if \(href\.pathname === '\/schedule-pro'\) router\.push\(href\); else router\.replace\(href\);\s*return;\s*\}[\s\S]{0,200}router\.replace\(scheduleFromJobFocusHref\(id \?\? '', String\(Date\.now\(\)\)\)\);/.test(pd));
  const estDoors = (pd.match(/router\.replace\(estimateFromJobHref\((project\.id|id \?\? '')\)\)/g) ?? []).length;
  ok('D2 senders: every Estimate door carries from=job (estimateFromJobHref) — 3 sites, no bare /(tabs)/estimate/full left',
    estDoors === 3 && !/'\/\(tabs\)\/estimate\/full'/.test(pd), `found ${estDoors}`);

  const cls = read('app', '(tabs)', 'schedule', 'index.tsx');
  ok('D2 receiver (classic tab): the job link only with from=job, "Schedules" otherwise, byte for byte',
    /const jobBack = jobBackLink\(\s*readUxDoorParams\(\{ from: routeFrom \}\)\.fromJob,\s*routeProjectId \? projects\.find\(p => p\.id === routeProjectId\) : null,\s*\);/.test(cls)
    && /\{jobBack \? \(\s*<HiddenTabBackLink\s+label=\{jobBack\.label\}\s+href=\{jobBack\.href\}[\s\S]{0,120}testID="schedule-back-to-job"\s*\/>\s*\) : \(\s*<HiddenTabBackLink\s+label="Schedules"\s+href="\/\(tabs\)\/discover\/schedule"\s+style=\{styles\.backToSchedules\}\s+testID="schedule-back-to-schedules"\s*\/>\s*\)\}/.test(cls));
  const mob = read('components', 'schedule', 'mobile', 'MobileScheduleScreen.tsx');
  ok('D2 receiver (iPhone schedule): a job link only with from=job, nothing otherwise',
    /const jobBack = jobBackLink\(\s*readUxDoorParams\(\{ from: routeFrom \}\)\.fromJob,\s*routeProjectId \? projects\.find\(\(p\) => p\.id === routeProjectId\) : null,\s*\);/.test(mob)
    && /\{jobBack \? \(\s*<HiddenTabBackLink label=\{jobBack\.label\} href=\{jobBack\.href\}[^>]*testID="schedule-back-to-job" \/>\s*\) : null\}/.test(mob)
    && (mob.match(/<HiddenTabBackLink\b/g) ?? []).length === 1);
  const est = read('app', '(tabs)', 'estimate', 'full.tsx');
  ok('D2 receiver (Full Estimator): a job link only with from=job, nothing otherwise',
    /const jobBack = jobBackLink\(\s*readUxDoorParams\(\{ from: navFrom \}\)\.fromJob,\s*navProjectId \? projects\.find\(p => p\.id === navProjectId\) : null,\s*\);/.test(est)
    && /\{jobBack \? \(\s*<HiddenTabBackLink label=\{jobBack\.label\} href=\{jobBack\.href\}[^>]*testID="estimate-back-to-job" \/>\s*\) : null\}/.test(est)
    && (est.match(/<HiddenTabBackLink\b/g) ?? []).length === 1);
  ok('D2 jobBackLink: the job name → /project-detail?id=, and null without from=job',
    eq(jobBackLink(true, { id: 'p 1', name: 'Henderson' }), { label: 'Henderson', href: '/project-detail?id=p%201' })
    && jobBackLink(false, { id: 'p1', name: 'Henderson' }) === null && jobBackLink(true, null) === null);
}

// ── 4. W1 UXDOORS: the Tools sheet's lineup row ─────────────────────────────
{
  const open = lineupToolsDoor({ projectId: 'p 1', canAccess: true, requiredTier: 'pro' });
  ok('lineup: with the plan and a default job → /tomorrow-lineup?projectId=<job>', eq(open, { kind: 'open', path: '/tomorrow-lineup?projectId=p%201' }), JSON.stringify(open));
  ok('lineup: with the plan and no default job → the bare screen (it asks)', eq(lineupToolsDoor({ projectId: null, canAccess: true, requiredTier: 'pro' }), { kind: 'open', path: '/tomorrow-lineup' }));
  const locked = lineupToolsDoor({ projectId: 'p1', canAccess: false, requiredTier: 'pro' });
  ok('lineup: without the plan → locked, the subtitle names the plan (VOICE plan-limit form), never a route',
    locked.kind === 'locked' && locked.subtitle === "Tomorrow's lineup is on the Pro plan" && locked.title === locked.subtitle && !('path' in locked));
  ok('planName: "business" → "Business"', planName('business') === 'Business' && planName('') === '');
  const ts = read('components', 'summary', 'ToolsSheet.tsx');
  const rows = ts.slice(ts.indexOf('const SHEET_ROWS'), ts.indexOf('];', ts.indexOf('const SHEET_ROWS')));
  const lines = rows.split('\n').filter(l => /\bfeature: '/.test(l));
  ok("ToolsSheet: Tomorrow's lineup is still the LAST row, its route literal unchanged", /feature: 'tomorrow-lineup', route: '\/tomorrow-lineup'/.test(lines[lines.length - 1] ?? ''));
  ok('ToolsSheet: the default job is pickDefaultProjectId (never a guess) and the gate is the screen\'s (useProjectAccess on that job, schedule_gantt_pdf)',
    /const lineupProjectId = pickDefaultProjectId\(\{ activeProjectId, recentProjectIds, projects \}\);/.test(ts)
    && /const \{ canAccess, requiredTierFor \} = useProjectAccess\(lineupProjectId \?\? undefined\);/.test(ts)
    && /canAccess: canAccess\('schedule_gantt_pdf'\),/.test(ts) && /requiredTier: requiredTierFor\('schedule_gantt_pdf'\),/.test(ts));
  // Plain trade (2026-10-05): a locked row is no longer a Lock glyph swapped in
  // for the tool's own — it keeps its glyph, hatched and muted (NavRow `locked`,
  // components/ui/toolList.tsx), and still says why in its subtitle.
  ok('ToolsSheet: a locked tap explains the plan with a See plans path (/paywall); the row is hatched as locked and says why',
    /showAlert\(lineupDoor\.title, lineupDoor\.message, \[\s*\{ text: 'Not now', style: 'cancel' \},\s*\{ text: 'See plans', onPress: \(\) => onNavigate\('\/paywall'\) \},\s*\]\);/.test(ts)
    && /Icon=\{row\.Icon\}\s+locked=\{!!locked\}/.test(ts) && /subtitle=\{locked \? locked\.subtitle : row\.subtitle\}/.test(ts));
  ok('ToolsSheet: every other row still navigates by the registry route', /if \(row\.feature !== 'tomorrow-lineup'\) \{ onNavigate\(featureFor\(row\.feature\)\.route\); return; \}/.test(ts));
}

// ── 5. W1 UXDOORS: Subs & pay, the deposit, the chain (D5) ──────────────────
{
  const commitments = [
    { id: 'c1', projectId: 'p1', number: 'SC-01', type: 'subcontract' as const, subcontractorId: 's1', vendorName: undefined, description: 'Electrical', amount: 12000, changeAmount: 500.25, paidToDate: 4000.1 },
    { id: 'c2', projectId: 'p1', number: 'SC-02', type: 'subcontract' as const, subcontractorId: 's2', vendorName: undefined, description: 'Plumbing', amount: 8000, paidToDate: 0 },
    { id: 'c3', projectId: 'p1', number: 'PO-01', type: 'purchase_order' as const, subcontractorId: undefined, vendorName: 'Lumber Co', description: 'Framing package', amount: 3000.5 },
    { id: 'c4', projectId: 'p2', number: 'SC-09', type: 'subcontract' as const, subcontractorId: 's1', vendorName: undefined, description: 'Other job', amount: 1 },
  ];
  const subs = [{ id: 's1', companyName: 'Sparky Electric', email: 'ops@sparky.com' }, { id: 's2', companyName: 'Flow Plumbing' }];
  const bills = [
    { commitmentId: 'c1', status: 'submitted' as const, amount: 1200.5 },
    { commitmentId: 'c1', status: 'approved' as const, amount: 999 },
    { commitmentId: 'c1', status: 'rejected' as const, amount: 50 },
    { commitmentId: 'c2', status: 'paid' as const, amount: 10 },
  ];
  const rows = subsPayRows({ projectId: 'p1', commitments, subs, subBills: bills });
  ok('D5: 3 commitments on this job → 3 rows (another job\'s commitment is left out)', eq(rows.map(r => r.commitmentId), ['c1', 'c2', 'c3']));
  ok('D5: approved bills is the ledger\'s paidToDate, to the cent; the contract adds the approved CO change',
    eq(rows.map(r => [r.contractCents, r.paidCents]), [[1250025, 400010], [800000, 0], [300050, 0]]));
  ok('D5: the open bill counts only bills awaiting review (an approved bill is already inside paid to date)',
    eq(rows.map(r => r.openBillCents), [120050, 0, 0]));
  ok('D5: bills not read → no open-bill figure at all (null, never a guessed $0)',
    subsPayRows({ projectId: 'p1', commitments, subs, subBills: null }).every(r => r.openBillCents === null));
  ok('D5: Pay → /sub-portal-setup?projectId&subId for a roster sub', eq(rows[0].payHref, { pathname: '/sub-portal-setup', params: { projectId: 'p1', subId: 's1' } }));
  ok('D5: a vendor with no roster sub has no Pay door and says why', rows[2].payHref === null && rows[2].payBlockedReason === PAY_NEEDS_ROSTER_SUB);
  ok('D5: Get waiver carries prefillSubName + prefillCommitmentId (+ the roster id and email on file), never subId or an amount',
    eq(rows[0].waiverHref, { pathname: '/lien-waivers', params: { projectId: 'p1', prefillSubName: 'Sparky Electric', prefillCommitmentId: 'c1', prefillSubCompanyId: 's1', prefillSubEmail: 'ops@sparky.com' } })
    && rows.every(r => r.waiverHref != null && !('subId' in r.waiverHref.params) && !('prefillAmount' in r.waiverHref.params) && !('prefillWaiverType' in r.waiverHref.params)));
  ok('D5: the vendor row\'s waiver names the vendor and its commitment only', eq(rows[2].waiverHref?.params, { projectId: 'p1', prefillSubName: 'Lumber Co', prefillCommitmentId: 'c3' }));
  // A commitment with no roster sub and no vendor name is SHOWN (never "no subs
  // on this project" while commitments exist), with no Pay and no waiver door.
  const nameless = subsPayRows({ projectId: 'p1', commitments: [{ id: 'c9', projectId: 'p1', number: 'SC-07', type: 'subcontract' as const, subcontractorId: undefined, vendorName: '  ', description: 'Drywall', amount: 5000, paidToDate: 250 }], subs, subBills: [] });
  ok('D5: a nameless commitment still makes a row (SUB_NOT_NAMED), with no Pay, no waiver and the reason',
    nameless.length === 1 && nameless[0].name === SUB_NOT_NAMED && nameless[0].detail === 'SC-07 · Drywall'
    && nameless[0].payHref === null && nameless[0].waiverHref === null && nameless[0].payBlockedReason === NAME_THE_SUB
    && nameless[0].contractCents === 500000 && nameless[0].paidCents === 25000);
  const srcRows = read('utils', 'subsPayRows.ts');
  ok('D5: the figures come from the ledger\'s own helpers (jobCostEngine commitmentValue / commitmentPaidToDate), not a re-derivation',
    /dollarsToCents\(commitmentValue\(c as Commitment\)\)/.test(srcRows) && /dollarsToCents\(commitmentPaidToDate\(c as Commitment\)\)/.test(srcRows));
  const tile = read('components', 'project', 'SubsPayTile.tsx');
  ok('D5: the tile says "Approved bills" (the rollup counts approved-but-unpaid bills), never "Paid to date"; Get waiver is off when there is no waiver door',
    />Approved bills</.test(tile) && !/Paid to date/.test(tile) && /disabled=\{!r\.waiverHref\}/.test(tile));
  ok('D5: no commitments → no rows, and the empty line reads "No subs on this project yet"',
    subsPayRows({ projectId: 'p1', commitments: [], subs, subBills: [] }).length === 0 && SUBS_PAY_EMPTY.title === 'No subs on this project yet');
  ok('D5: every amount prints cents', centsLabel(450000) === '$4,500.00' && centsLabel(120050) === '$1,200.50' && dollarsToCents(Number.NaN) === 0);

  const pd = read('app', 'project-detail.tsx');
  ok('D5: Subs & pay is a Money tile (phone / tablet section), hidden with the money tiles and from view-only seats',
    /tileKeys: \['budget', 'contract', 'selections', 'linkedEstimate', 'changeOrders', 'invoices', 'subsPay', 'lienWaivers', 'closeoutBinder', 'handover'\]/.test(pd)
    && /const HUB_MONEY_TILE_KEYS: readonly string\[\] = \[[^\]]*'subsPay'\];/.test(pd)
    && /if \(key === 'subsPay' && !perms\.showSubsPay\) return false;/.test(pd)
    && /showSubsPay: role === 'owner',/.test(pd)
    && /\{activeTile === 'subsPay' && hubPerms\.showMoney && hubPerms\.showSubsPay && \(\s*<SubsPayTile\s+rows=\{subsPayRowList\}/.test(pd));
  // Desktop (2026-10-02): the Money column lists Subs & pay too and opens it in
  // the side panel. The tile is on every layout (no `!isDesktop ?` gate), the
  // panel knows the key and titles it, and both headers read sectionTitle.
  ok('D5 desktop: the Subs & pay tile is not gated off desktop',
    !/!isDesktop \? \[\{ key: 'subsPay'/.test(pd)
    && /\n\s*\{ key: 'subsPay' as SectionKey, label: 'Subs & pay', icon: HandCoins, count: subsPayRowList\.length as number \| null \},/.test(pd));
  ok("D5 desktop: SECTION_TITLES.subsPay === 'Subs & pay' and sectionTitle reads it",
    SECTION_TITLES.subsPay === 'Subs & pay' && sectionTitle('subsPay') === 'Subs & pay', SECTION_TITLES.subsPay);
  ok("D5 desktop: PANEL_SECTION_KEYS has 'subsPay', so the desktop row opens the side panel",
    (PANEL_SECTION_KEYS as readonly string[]).includes('subsPay') && desktopTileTarget('subsPay', 'p1').kind === 'panel');
  ok('D5 desktop: both section headers print sectionTitle(activeTile), with no subsPay special case',
    !/activeTile === 'subsPay' \? 'Subs & pay'/.test(pd)
    && /title=\{sectionTitle\(activeTile\)\}/.test(pd)
    && /<Text style=\{styles\.sectionModalTitle\} numberOfLines=\{1\}>\s*\{sectionTitle\(activeTile\)\}/.test(pd));
  ok('D5: the rows come from subsPayRows over the context\'s commitments; the bills are read only while the section is open',
    /useSubSubmittedInvoices\(\{ projectId: activeTile === 'subsPay' \? \(id \?\? undefined\) : undefined \}\)/.test(pd)
    && /subsPayRows\(\{\s*projectId: id \?\? '',\s*commitments: projectCommitments,/.test(pd));
  ok('D5: the scoped NextStepHero gets the fetched contract and this job\'s change orders; no subPaidNoWaiver (no new read)',
    /scopeToProjectId=\{project\?\.id\}[\s\S]{0,600}contract=\{moneyChain\.contract\}\s*changeOrders=\{moneyChain\.changeOrders\}\s*testID="project-next-step"/.test(pd)
    && !/subPaidNoWaiver=/.test(pd));
  // fetchActiveContract folds a failed read into null ("none on file"), so the
  // page reads loadActiveContract, which says whether the read worked.
  ok('D5: chainContractFromLoad — ok+row → the row; ok+none → null; a failed read → undefined (never "none on file")',
    eq(chainContractFromLoad({ ok: true, contract: { id: 'c1' } }), { id: 'c1' })
    && chainContractFromLoad({ ok: true, contract: null }) === null
    && chainContractFromLoad({ ok: false }) === undefined);
  ok('D5: moneyChainForRole — the owner gets the contract and COs; editor, viewer, field and unknown seats get undefined (RLS hides both from them)',
    eq(moneyChainForRole('owner', null, [1]), { contract: null, changeOrders: [1] })
    && ['editor', 'viewer', 'field', null, undefined].every(r => eq(moneyChainForRole(r, { id: 'c1' }, [1]), { contract: undefined, changeOrders: undefined })));
  ok('D5: the page reads loadActiveContract (not fetchActiveContract), maps it with chainContractFromLoad, and gates the chain on the role',
    /loadActiveContract\(id\)\.catch\(/.test(pd) && !/fetchActiveContract/.test(pd.replace(/\/\/.*$/gm, ''))
    && /setChainContract\(chainContractFromLoad\(contractLoad\)\);/.test(pd)
    && /const contract = contractLoad\.ok \? contractLoad\.contract : null;/.test(pd)
    && /const moneyChain = moneyChainForRole\(hubRole, chainContract, changeOrders\);/.test(pd));
  const home = read('app', '(tabs)', '(home)', 'index.tsx');
  ok('D5: Home\'s NextStepHero is untouched (no contract, no change orders)', !/<NextStepHero[\s\S]{0,400}contract=\{/.test(home));
  ok('D5: the Invoices section leads with "Bill deposit · $4,500.00" only when nextBillableMilestone offers one (contract-sourced, cents)',
    /const depositToBill = nextBillableMilestone\(\{\s*contract: moneyChain\.contract,\s*invoices: projectInvoices,/.test(pd)
    && /\{depositToBill \? \(\s*<TouchableOpacity[\s\S]{0,120}onPress=\{\(\) => navigateFromTile\(depositToBill\.href\)\}[\s\S]{0,400}\{`Bill \$\{depositToBill\.kind\} · \$\{formatMoney\(depositToBill\.amount, 2\)\}`\}[\s\S]{0,80}\) : null\}\s*\{\/\* Bill by voice/.test(pd)
    && `Bill deposit · ${formatMoney(4500, 2)}` === 'Bill deposit · $4,500.00');
  ok('D5: the deposit sits inside the owner-only branch (billBlockedReason), before today\'s buttons',
    /\{billBlockedReason \? \([\s\S]{0,200}\) : \(<>\s*\{\/\* W1 UXDOORS \(D5\)[\s\S]{0,600}\{depositToBill \?/.test(pd));
}

if (failures > 0) {
  console.error(`\nux-doors validation FAILED (${failures})\n`);
  process.exit(1);
}
console.log('\n  PASS  ux-doors: the job page, the + menu, the New Project form and the rail open the right door\n');
