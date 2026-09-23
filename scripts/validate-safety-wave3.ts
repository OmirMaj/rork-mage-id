// validate-safety-wave3.ts — the safety lane of the 2026-09-18 workflow audit
// (#81 #82 #83 #84 #85 #86 #88 #89 #167 #168 #169 #170).
//
// Pure functions are RUN (the DFR merge, the 300 row, the year rule, the
// establishment filter, the hydrate merge, the seat rules). Screen wiring that
// only exists inside a component is pinned by source, each pin naming the
// defect it stops from coming back.
//
// Run via: bun scripts/validate-safety-wave3.ts

import { readFileSync } from 'node:fs';
import {
  buildSafetyIncidentFromDfr, safetyIncidentIdForReport, cleanPeopleInvolved, recordableWorkerProblem,
  injuredPersonOf, strictCalendarDay, safetyDateProblem, safetySeatFor, safetyDeleteBlockedReason,
  safetyWriteBlockedReason, type DfrIncidentSource, type IncidentClassInput,
} from '../utils/safety/osha';
import {
  buildOsha300Log, oshaRowFromIncident, availableOshaYears, recordablesWithUnreadableDates,
  incidentsForOwnEstablishment, currentOshaYear, oshaYearOf, osha300ToCsv,
} from '../utils/safety/oshaLog';
import { mergeLocalOnly, pendingIdsForTable } from '../utils/projectContextPure';
import type { SafetyIncident } from '../types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail !== undefined ? `\n      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''); }
}
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const NOW = '2026-09-18T15:00:00.000Z';
function incident(o: Partial<SafetyIncident> = {}): SafetyIncident {
  return {
    id: 'i1', projectId: 'p1', type: 'injury', severity: 'medium', occurredAt: '2026-09-17',
    description: 'Cut hand on sheet metal', location: 'Level 2 east', peopleInvolved: [], photoUrls: [],
    correctiveActions: [], treatment: 'medical_beyond_first_aid', daysAway: 0, daysRestricted: 0,
    restrictedDuty: false, lostConsciousness: false, fatality: false, oshaRecordable: true,
    status: 'open', reportedBy: 'Super', createdBy: 'Super', createdAt: '2026-09-17T20:00:00.000Z',
    updatedAt: '2026-09-17T20:00:00.000Z', ...o,
  } as SafetyIncident;
}
function klass(o: Partial<IncidentClassInput> = {}): IncidentClassInput {
  return { type: 'injury', treatment: 'medical_beyond_first_aid', daysAway: 0, restrictedDuty: false, lostConsciousness: false, fatality: false, ...o };
}
function dfr(o: Partial<DfrIncidentSource> = {}): DfrIncidentSource {
  return {
    reportId: '0b7d6c1e-2f4a-4c1b-9a8e-3d5f6a7b8c9d', projectId: 'p1', occurredOn: '2026-09-17',
    severity: 'moderate', description: 'Cut hand on sheet metal', peopleInvolved: 'Jose R',
    correctiveAction: 'Issue cut-resistant gloves', reportedBy: 'Super', location: '100 Main St',
    photoUrls: ['file:///dfr/1.jpg'], classification: klass(), daysRestricted: 0, author: 'Super', now: NOW,
    ...o,
  };
}

// ── #83 — a DFR re-save merges into the case, it does not replace it ─────────
console.log('\n#83 DFR re-save keeps what the log added:');
{
  const first = buildSafetyIncidentFromDfr(dfr());
  ok('first save files a case with the derived id', first.id === safetyIncidentIdForReport(dfr().reportId));
  // The safety manager edits the case in Incidents.
  const edited: SafetyIncident = {
    ...first,
    peopleInvolved: [{ name: 'Jose Ramirez', role: 'Sheet metal worker', injured: true } as SafetyIncident['peopleInvolved'][number]],
    correctiveActions: [
      { action: 'Issue cut-resistant gloves', owner: 'Super', done: true },
      { action: 'Deburr station on L2', owner: 'Safety', done: false },
      { action: 'Retrain crew', owner: 'Safety', done: true },
    ],
    photoUrls: ['u1/p1/incident-a.jpg', 'u1/p1/incident-b.jpg'],
    location: 'Level 2 east stair',
    status: 'investigating',
    oshaIllnessType: 'skin',
    createdBy: 'Safety Manager',
    reportedBy: 'Safety Manager',
    planSheetId: 'sheet-9', pinX: 0.4, pinY: 0.6,
  };
  // Next day the super fixes a typo and re-saves the report (another user).
  const resave = buildSafetyIncidentFromDfr(
    dfr({ description: 'Cut left hand on sheet metal', author: 'Foreman B', reportedBy: 'Foreman B', photoUrls: ['file:///dfr/1.jpg', 'file:///dfr/2.jpg'] }),
    edited,
  );
  ok('the injured worker keeps his job title (the 300 no longer prints a blank)', resave.peopleInvolved[0]?.role === 'Sheet metal worker');
  ok('the injured flag survives', (resave.peopleInvolved[0] as { injured?: boolean }).injured === true);
  ok('all three corrective actions survive, done marks included',
    resave.correctiveActions.length === 3 && resave.correctiveActions[0].done && resave.correctiveActions[2].done, resave.correctiveActions);
  ok('the DFR action is not appended again when the same text is already there',
    resave.correctiveActions.filter(a => a.action.toLowerCase() === 'issue cut-resistant gloves').length === 1);
  ok("the log's scene photos survive (a union, the DFR's new photo added)",
    ['u1/p1/incident-a.jpg', 'u1/p1/incident-b.jpg', 'file:///dfr/1.jpg', 'file:///dfr/2.jpg'].every(u => resave.photoUrls.includes(u)), resave.photoUrls);
  ok('the log location survives', resave.location === 'Level 2 east stair');
  ok('createdBy / reportedBy stay who first filed it', resave.createdBy === 'Safety Manager' && resave.reportedBy === 'Safety Manager');
  ok('status survives', resave.status === 'investigating');
  ok('col M (illness type) survives', resave.oshaIllnessType === 'skin');
  ok('the plan pin survives', resave.planSheetId === 'sheet-9' && resave.pinX === 0.4);
  ok('createdAt survives', resave.createdAt === first.createdAt);
  ok('the DFR-owned description DOES update', resave.description === 'Cut left hand on sheet metal');
  // A classification change on the DFR recomputes the flag, reading col M.
  const downgraded = buildSafetyIncidentFromDfr(dfr({ classification: klass({ type: 'environmental', treatment: 'medical_beyond_first_aid' }) }), edited);
  ok("the recomputed flag reads the log's illness type (a skin case stays recordable)", downgraded.oshaRecordable === true);
  const newAction = buildSafetyIncidentFromDfr(dfr({ correctiveAction: 'Guard the shear' }), edited);
  const noCol = buildSafetyIncidentFromDfr(dfr({ classification: klass({ type: 'environmental', treatment: 'medical_beyond_first_aid' }) }), { ...edited, oshaIllnessType: undefined });
  ok('…(and without col M the same inputs are not recordable, so the log value is what decided it)', noCol.oshaRecordable === false);
  ok('a NEW DFR action is appended once, undone', newAction.correctiveActions.length === 4 && newAction.correctiveActions[3].action === 'Guard the shear' && !newAction.correctiveActions[3].done);
  const blankLoc = buildSafetyIncidentFromDfr(dfr(), { ...edited, location: '  ' });
  ok('a blank log location falls back to the site address', blankLoc.location === '100 Main St');
  const nobody = buildSafetyIncidentFromDfr(dfr(), { ...edited, peopleInvolved: [] });
  ok('with nobody on the case yet, the DFR names are used', nobody.peopleInvolved[0]?.name === 'Jose R');
  ok('daily-report still calls the builder (the call site is dfr-screen\'s, it passes linkedIncident)',
    /buildSafetyIncidentFromDfr\(/.test(src('app/daily-report.tsx')));
}

// ── #88 — the injured worker on the 300 ───────────────────────────────────────
console.log('\n#88 the 300 names the injured worker:');
{
  const witnessFirst = incident({ peopleInvolved: [{ name: 'Witness W', role: 'Laborer' }, { name: 'Jose R', role: 'Carpenter', injured: true } as never] });
  const row = oshaRowFromIncident(witnessFirst, 1);
  ok('the row names the person marked injured, not peopleInvolved[0]', row.employeeName === 'Jose R' && row.jobTitle === 'Carpenter', row);
  ok('the row carries its incident id', row.incidentId === 'i1');
  const blank = oshaRowFromIncident(incident({ peopleInvolved: [{ name: '  ', role: '' }] }), 1);
  ok("a blank name / role prints '—', never an empty cell", blank.employeeName === '—' && blank.jobTitle === '—', blank);
  ok('…and the row says what is missing', blank.missing.join(',') === 'employee name,job title', blank.missing);
  const privacy = oshaRowFromIncident(incident({ peopleInvolved: [{ name: 'Jane D', role: 'Electrician', injured: true, privacyCase: true } as never] }), 1);
  ok("a privacy case prints 'Privacy case' in the name column (1904.29(b)(7))", privacy.employeeName === 'Privacy case' && privacy.missing.length === 0);
  ok('the CSV never carries the hidden name', !osha300ToCsv([privacy], { name: 'Acme', year: '2026' }).includes('Jane D'));
  ok('the CSV has no screen-only columns', !osha300ToCsv([privacy], { name: 'Acme', year: '2026' }).includes('incidentId'));
  ok('no people → blocked with a reason', /needs the injured worker/.test(recordableWorkerProblem([]) ?? ''));
  ok('two people, none marked → asks which one', /Mark which person/.test(recordableWorkerProblem([{ name: 'A', role: 'x' }, { name: 'B', role: 'y' }]) ?? ''));
  ok('one person, no job title → asks for it', /job title/.test(recordableWorkerProblem([{ name: 'A', role: ' ' }]) ?? ''));
  ok('privacy case with a job title passes', recordableWorkerProblem([{ name: '', role: 'Welder', injured: true, privacyCase: true } as never]) === null);
  ok('a complete injured worker passes', recordableWorkerProblem([{ name: 'A', role: 'Welder', injured: true } as never]) === null);
  ok('blank person rows are dropped at save', cleanPeopleInvolved([{ name: '', role: '' }, { name: 'A', role: '' }]).length === 1);
  ok('legacy cases (no flag) still read the first person', injuredPersonOf([{ name: 'Old', role: 'r' }])?.name === 'Old');
  const inc = src('app/safety-incidents.tsx');
  ok('the incident Save runs the worker check when recordable', /if \(recordable\) \{\s*const problem = recordableWorkerProblem\(people\);/.test(inc));
  ok('Save stores the cleaned people list', /peopleInvolved: people,/.test(inc));
  ok('People sits directly under the verdict (before corrective actions)',
    inc.indexOf('testID="incident-recordability"') < inc.indexOf('{/* People involved') && inc.indexOf('{/* People involved') < inc.indexOf('{/* Corrective actions */}'));
  ok('safety-incidents opens ?incidentId= into the edit form', /incidentId\?: string;/.test(inc) && /items\.find\(i => i\.id === incidentId\)/.test(inc));
  const osha = src('app/safety-osha.tsx');
  ok('300 rows are tappable and open the incident', /onPress=\{\(\) => openCase\(r\.incidentId\)\}/.test(osha) && /pathname: '\/safety-incidents', params: \{ projectId: inc\.projectId, incidentId \}/.test(osha));
  ok('rows missing a name / title say so', /Missing \{r\.missing\.join\(' and '\)\}: tap to fix/.test(osha));
}

// ── #168 — dates ─────────────────────────────────────────────────────────────
console.log('\n#168 dates are real days or refused:');
{
  ok('2026-09-18 is a day', strictCalendarDay('2026-09-18') === '2026-09-18');
  ok("'9/18/26' is refused", strictCalendarDay('9/18/26') === null);
  ok('2026-02-30 is refused', strictCalendarDay('2026-02-30') === null);
  ok('trailing junk is refused', strictCalendarDay('2026-09-18x') === null);
  ok('the refusal says why and how', /YYYY-MM-DD/.test(safetyDateProblem('9/18/26', 'Occurred date') ?? ''));
  ok('an optional blank date is fine', safetyDateProblem('', 'Due date', { optional: true }) === null);
  ok('a required blank date is refused', safetyDateProblem('', 'Occurred date') !== null);
  const bad = incident({ id: 'bad', occurredAt: '9/18/26' });
  const good = incident({ id: 'good', occurredAt: '2025-03-02' });
  ok("a '9/18/26' case is on no year's log", buildOsha300Log([bad], '9/18').length === 0 && oshaYearOf(bad) === null);
  ok("…and adds no '9/18' year chip", !availableOshaYears([bad, good], '2026').includes('9/18') && availableOshaYears([bad, good], '2026').join() === '2026,2025');
  ok('…and is named as needing a date fix', recordablesWithUnreadableDates([bad, good]).map(i => i.id).join() === 'bad');
  ok('an ISO timestamp still counts for its year', buildOsha300Log([incident({ occurredAt: '2026-01-05T08:00:00Z' })], '2026').length === 1);
  for (const [file, label] of [
    ['app/safety-incidents.tsx', 'Occurred date'], ['app/safety-toolbox.tsx', 'Talk date'], ['app/safety-jha.tsx', 'JHA date'],
    ['app/safety-hazards.tsx', 'Due date'], ['app/safety-inspections.tsx', 'Inspection date'],
  ] as const) {
    ok(`${file} refuses a bad ${label} on save`, src(file).includes(`safetyDateProblem(`) && src(file).includes(`'${label}'`));
  }
  const osha = src('app/safety-osha.tsx');
  ok('the OSHA screen shows the date-needs-fixing banner', /recordablesWithUnreadableDates\(scopedIncidents\)/.test(osha) && /testID="osha-undated-cases"/.test(osha));
}

// ── #169 — the hub tile counts what the log opens on ─────────────────────────
console.log('\n#169 hub tile = the log it opens:');
{
  ok('currentOshaYear is the local year', currentOshaYear(new Date(2026, 0, 1, 0, 30)) === '2026');
  const hub = src('app/safety.tsx');
  ok('the tile counts through buildOsha300Log for the current year', /buildOsha300Log\(scoped, oshaYear\)\.length/.test(hub) && /const oshaYear = currentOshaYear\(\);/.test(hub));
  ok('the tile is labelled with the year', /label: `OSHA 300 Log · \$\{oshaYear\}`/.test(hub));
  ok('the false "can never disagree" comment is gone', !/can never disagree/.test(hub));
  ok('the log defaults to the same helper', /const currentYear = currentOshaYear\(\);/.test(src('app/safety-osha.tsx')));
  const lastYear = incident({ id: 'old', occurredAt: '2025-06-01' });
  ok('three 2025 cases count 0 on the 2026 tile', buildOsha300Log([lastYear, { ...lastYear, id: 'o2' }, { ...lastYear, id: 'o3' }], '2026').length === 0);
}

// ── #82 — the case reaches the owner; the 300 is per establishment ──────────
console.log('\n#82 collaborator cases reach the GC; the 300 is the owner\'s:');
{
  const mig = src('supabase/migrations/20260919130000_safety_project_rls.sql');
  for (const t of ['safety_incidents', 'jhas', 'toolbox_talks', 'hazards', 'safety_inspections']) {
    ok(`migration covers ${t}`, mig.includes(`'${t}'`));
  }
  ok('SELECT = author OR project owner (collaborators see only their own)', /using \(auth\.uid\(\) = user_id or %3\$s\)/.test(mig));
  ok("INSERT requires 'field'+ access on the project", /public\.can_access_project\(project_id, 'field'\)/.test(mig));
  ok('DELETE is owner-only', /for delete to authenticated\s+using \(%3\$s or \(project_id is null and auth\.uid\(\) = user_id\)\)/.test(mig));
  const projects = [{ id: 'mine', ownerUserId: 'u1' }, { id: 'gcjob', ownerUserId: 'gc', myRole: 'field' }, { id: 'legacy-shared', myRole: 'editor' }];
  const cases = [incident({ id: 'a', projectId: 'mine' }), incident({ id: 'b', projectId: 'gcjob' }), incident({ id: 'c', projectId: 'legacy-shared' }), incident({ id: 'd', projectId: 'unknown' })];
  ok("the foreman's own 300 leaves out cases on the GC's jobs", incidentsForOwnEstablishment(cases, projects, 'u1').map(i => i.id).join() === 'a,d');
  ok('the OSHA screen and the hub both apply it',
    /incidentsForOwnEstablishment\(incidents, projects, user\?\.id\)/.test(src('app/safety-osha.tsx')) && /incidentsForOwnEstablishment\(/.test(src('app/safety.tsx')));
  const inc = src('app/safety-incidents.tsx');
  ok('collaborator copy names who sees the case and does NOT promise the OSHA 300',
    /seat === 'crew'/.test(inc) && /Only you and this job&apos;s owner can see the cases you report here/.test(inc)
      && !/testID="incident-collab-note"[^<]*OSHA 300/.test(inc));
}

// ── #85 — offline rows survive the hydrate; flushed tables re-read ──────────
console.log('\n#85 hydrate keeps queued rows:');
{
  type R = { id: string; v: string };
  const server: R[] = [{ id: 's1', v: 'server' }, { id: 'u1', v: 'server-old' }];
  const local: R[] = [{ id: 'q1', v: 'offline incident' }, { id: 'u1', v: 'local-edit' }, { id: 'gone', v: 'deleted elsewhere' }];
  const queue = [
    { table: 'safety_incidents', operation: 'insert', data: { id: 'q1' } },
    { table: 'safety_incidents', operation: 'update', data: { id: 'u1' } },
    { table: 'jhas', operation: 'insert', data: { id: 'gone' } },
  ];
  const merged = mergeLocalOnly(server, local, pendingIdsForTable(queue, 'safety_incidents'));
  ok('a queued create survives the server read', merged.some(r => r.id === 'q1'));
  ok('a row neither on the server nor queued for THIS table is dropped', !merged.some(r => r.id === 'gone'));
  ok('no duplicate ids', new Set(merged.map(r => r.id)).size === merged.length);
  const ctx = src('contexts/SafetyContext.tsx');
  ok('hydrateCollection merges before it saves the cache',
    /const merged = mergeLocalOnly\(\s*mapped,[\s\S]*pendingIdsForTable\(queue, table\),[\s\S]*?\);\s*if \(persist\) await saveLocal\(key, merged\);\s*return merged;/.test(ctx));
  // Wave 4 (#119): a re-read persists only what it applies, and only when no
  // local write to that collection happened during its round trip.
  ok('a re-read reads without persisting, then applies only if the account and the local list are unchanged',
    /hydrateCollection\(table, key, true, map, false, userId\)/.test(ctx)
    && /if \(r === null\) return;\s*if \(gen !== genRef\.current\) return;\s*if \(\(localWritesRef\.current\[key\] \?\? 0\) !== before\) return;\s*set\(r\);\s*void saveLocal\(key, r\);/.test(ctx));
  ok('every local write in the provider bumps the collection\'s write count', !/void saveLocal\(keys\./.test(ctx) && /localWritesRef\.current\[key\] = \(localWritesRef\.current\[key\] \?\? 0\) \+ 1;/.test(ctx));
  ok('flushed safety tables are re-read', /onQueueFlushed\(\(tables\) => \{ void rereadTables\(tables\); \}\)/.test(ctx)
    && /if \(!canSync \|\| !hydratedRef\.current\) return;/.test(ctx) && /targets\.filter\(t => tables\.has\(t\.table\)\)/.test(ctx));
  for (const t of ['JHAS_TABLE', 'TOOLBOX_TABLE', 'INCIDENTS_TABLE', 'HAZARDS_TABLE', 'INSPECTIONS_TABLE', 'CERTIFICATIONS_TABLE', 'TEMPLATES_TABLE']) {
    ok(`…including ${t}`, new RegExp(`mk\\(${t}, keys\\.`).test(ctx));
  }
}

// ── #89 — recordable cases can't be deleted; deleted cases stay deleted ─────
console.log('\n#89 retention:');
{
  const ctx = src('contexts/SafetyContext.tsx');
  ok('SafetyContext.deleteIncident refuses a recordable case', /if \(target && isRecordableCase\(target\)\) return false;/.test(ctx));
  ok('a deleted case is tombstoned and addIncident refuses it', /if \(tombstonesRef\.current\.has\(input\.id\)\) return false;/.test(ctx) && /isIncidentDeleted/.test(ctx));
  ok('the tombstone key sits under the mageid_ prefix', /'mageid_safety_incident_tombstones'/.test(ctx));
  const inc = src('app/safety-incidents.tsx');
  ok('the screen blocks it with the 1904.33 reason', /if \(item && isRecordableCase\(item\)\) \{\s*showAlert\(\s*'Kept on the OSHA 300',[\s\S]{0,200}1904\.33/.test(inc));
}

// ── #84 — JHA Hazards / Controls keep spaces and commas ─────────────────────
console.log('\n#84 JHA step text:');
{
  const jha = src('app/safety-jha.tsx');
  ok('Hazards is controlled by the raw text', /value=\{stepText\[s\.id\]\?\.hazards \?\? s\.hazards\.join\(', '\)\}/.test(jha));
  ok('Controls is controlled by the raw text', /value=\{stepText\[s\.id\]\?\.controls \?\? s\.controls\.join\(', '\)\}/.test(jha));
  ok('the raw text is stored per step outside `steps`', /setStepText\(prev => \(\{ \.\.\.prev, \[id\]: \{ \.\.\.prev\[id\], \[field\]: value \} \}\)\)/.test(jha));
  ok('…and never lands in the saved JHA', !/stepText/.test(jha.slice(jha.indexOf('const handleSave'), jha.indexOf('const handleActivate'))));
  ok('open / AI generate / reset clear it', (jha.match(/setStepText\(\{\}\)/g) ?? []).length >= 3);
  // The old echo, run: split/trim/join on every keystroke ate the space.
  const echo = (typed: string) => typed.split(',').map(v => v.trim()).filter(Boolean).join(', ');
  ok("(the old behaviour really did eat the space: 'Fall ' → 'Fall')", echo('Fall ') === 'Fall');
}

// ── #86 — the establishment is his company ──────────────────────────────────
console.log('\n#86 establishment name:');
{
  const osha = src('app/safety-osha.tsx').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  ok('the public companies directory is gone from the OSHA screen', !/useCompanies/.test(osha));
  ok("no 'My Company' / 'All establishments' fallback", !/'My Company'|'All establishments'/.test(osha));
  ok('the name is settings.branding.companyName', /settings\?\.branding\?\.companyName/.test(osha));
  ok('exports are disabled with the reason when it is empty',
    /Add your company name in Settings to print the OSHA 300\./.test(osha) && (osha.match(/disabled=\{!!exportBlocked\}/g) ?? []).length === 2);
  ok('…with a link to Settings', /router\.push\('\/\(tabs\)\/settings' as never\)/.test(osha));
}

// ── #167 — scan results under the scan button ───────────────────────────────
console.log('\n#167 hazard scan feedback:');
{
  const hz = src('app/safety-hazards.tsx');
  const scanBtn = hz.indexOf('testID="scan-hazards"');
  const box = hz.indexOf('<View style={styles.suggestionBox}>');
  const firstCard = hz.indexOf('{items.map(item => {');
  ok('the suggestions render after the scan button, not above the list', scanBtn > 0 && box > scanBtn && box > firstCard);
  ok('a found scan sets a count note', /hazard\$\{found\.length === 1 \? '' : 's'\} found\. Tap one below/.test(hz));
}

// ── #81 / #170 — a way in, and the foreman gets in ──────────────────────────
console.log('\n#81 / #170 entry and gates:');
{
  const hub = src('app/safety.tsx');
  ok('the hub renders ToolProjectPicker instead of the Home bounce', /<ToolProjectPicker/.test(hub) && !/'\/\(tabs\)\/\(home\)'/.test(hub));
  ok('picking sets projectId on the hub', /router\.setParams\(\{ projectId: id \}\)/.test(hub));
  ok('a collaborator-only user gets only his invited jobs', /ownTier \? projects : invitedSafetyProjects\(projects\)/.test(hub));
  ok('company records stay on his own tier', /if \(!ownTier\) return \[\];/.test(hub));
  for (const f of ['app/safety-toolbox.tsx', 'app/safety-jha.tsx', 'app/safety-hazards.tsx', 'app/safety-inspections.tsx', 'app/safety-incidents.tsx']) {
    const s = src(f);
    ok(`${f}: no "Tap Safety inside the project tile grid" dead end`, !/Tap Safety inside the project tile grid/.test(s));
  }
  for (const f of ['app/safety-toolbox.tsx', 'app/safety-jha.tsx', 'app/safety-hazards.tsx', 'app/safety-inspections.tsx']) {
    const s = src(f);
    ok(`${f}: gated per project (useProjectAccess(gateProjectId))`, /const \{ canAccess \} = useProjectAccess\(gateProjectId\);/.test(s) && !/useTierAccess\(\);\s*if \(!canAccess/.test(s));
    ok(`${f}: spinner / retry / paywall via SafetyAccessBlocked`, /return <SafetyAccessBlocked roleState=\{roleState\}/.test(s));
    ok(`${f}: delete is refused for non-owners with the reason`, /safetyDeleteBlockedReason\(seat\)/.test(s));
  }
  ok('AI metering stays on his own tier (JHA / hazards read useTierAccess().tier)',
    /const \{ tier, isBusinessOrAbove \} = useTierAccess\(\);/.test(src('app/safety-jha.tsx')) && /const \{ tier, isBusinessOrAbove \} = useTierAccess\(\);/.test(src('app/safety-hazards.tsx')));
  const gate = hub.slice(hub.indexOf('export function SafetyAccessBlocked'), hub.indexOf('/** Shared projects on which'));
  ok('the gate spins ONLY while loading, retries on error, else paywalls',
    gate.indexOf('roleState.isLoading') < gate.indexOf('roleState.isError') && gate.indexOf('roleState.isError') < gate.indexOf('<Paywall'));
  // Seats: the client half of the RLS.
  ok('owner by device copy (offline)', safetySeatFor({ ownerUserId: 'u', userId: 'u', role: null }) === 'owner');
  ok('owner by role', safetySeatFor({ role: 'owner', userId: 'u' }) === 'owner');
  ok('field → crew', safetySeatFor({ role: 'field', userId: 'u', ownerUserId: 'gc' }) === 'crew');
  ok('editor stamp while the role loads → crew', safetySeatFor({ role: null, myRole: 'editor', userId: 'u', ownerUserId: 'gc' }) === 'crew');
  ok('viewer → viewer, and may not file', safetySeatFor({ role: 'viewer', userId: 'u' }) === 'viewer' && !!safetyWriteBlockedReason('viewer'));
  ok('crew may file but not delete', safetyWriteBlockedReason('crew') === null && /Only the project owner/.test(safetyDeleteBlockedReason('crew') ?? ''));
  ok('owner may delete', safetyDeleteBlockedReason('owner') === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
