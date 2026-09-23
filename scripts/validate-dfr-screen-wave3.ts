// validate-dfr-screen-wave3.ts — the dfr-screen lane of the 2026-09-18 workflow
// audit (#22 #28 #87 #114 #115 #116) plus the same-chain handoffs it applied
// (#41 Draft-CO owner gate + the fieldIssue param, #82 collaborator-honest
// incident note, #83 merge into the linked case, #89 deleted-case tombstone).
//
// The pure helpers are EXECUTED from their `>>> dfr-screen-pure` block in
// app/daily-report.tsx, and dfrDraftSignature is lifted and run too. Wiring
// that only exists inside the component is pinned by source, each pin naming
// the defect it stops from coming back. The migration (20260919140000) is
// executed in the PGlite harness by the lane; here its load-bearing clauses
// are pinned.
//
// Run via: bun scripts/validate-dfr-screen-wave3.ts

import { readFileSync } from 'fs';
import { join } from 'path';
import { calendarDayOf } from '../utils/calendarDate';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
}

type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
const Transpiler = (globalThis as unknown as { Bun: { Transpiler: TranspilerCtor } }).Bun.Transpiler;
const transpile = (src: string) => new Transpiler({ loader: 'ts' }).transformSync(src);

const DFR = read('app/daily-report.tsx');
/** Source with comments removed, so a pin can't be satisfied by a comment. */
const code = DFR.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

// ── The pure block ────────────────────────────────────────────────────────────
interface Pure {
  DFR_WEATHER_NOT_RECORDED: string;
  dfrAiWeatherStr(parts: (string | null | undefined)[]): string;
  DFR_FROM_SCHEDULE_DIVIDER: string;
  dfrAppendGenerated(typed: string, generated: string): string;
  dfrPublishControl(saved: boolean, local: boolean): { label: string; pill: boolean; pending: 'publish' | 'remove' | null };
  dfrIsProjectOwner(o: string | null | undefined, u: string | null | undefined, r: string | null | undefined): boolean;
  DFR_GC_CREATES_COS: string;
  DFR_OWNER_DECIDES_HOMEOWNER: string;
  dfrPublishAccess(o: { ownerUserId?: string | null; userId?: string | null; role?: string | null; myRole?: string | null; roleLoading?: boolean }): { allowed: boolean; reason: string | null };
  dfrSameDayReports<T extends { id: string; date: string }>(r: T[], day: string | null, ex: string | null, dayOf: (v: string) => string | null): T[];
  dfrIncidentPhotoUrls(p: { id: string; uri: string; storagePath?: string; incidentPhoto?: boolean }[], stage: (p: { id: string; uri: string }) => string | null, cap: number): string[];
  dfrSummaryIsStale(s: string, w: string | null, d: string | null): boolean;
  dfrIncidentFileNote(isOwner: boolean): string;
}
const start = DFR.indexOf('// >>> dfr-screen-pure');
const end = DFR.indexOf('// <<< dfr-screen-pure');
ok('app/daily-report.tsx carries the dfr-screen-pure block', start > -1 && end > start);
const names = ['DFR_WEATHER_NOT_RECORDED', 'dfrAiWeatherStr', 'DFR_FROM_SCHEDULE_DIVIDER', 'dfrAppendGenerated', 'dfrPublishControl',
  'dfrIsProjectOwner', 'DFR_GC_CREATES_COS', 'DFR_OWNER_DECIDES_HOMEOWNER', 'dfrPublishAccess', 'dfrSameDayReports',
  'dfrIncidentPhotoUrls', 'dfrSummaryIsStale', 'dfrIncidentFileNote'];
const block = DFR.slice(start, end);
ok('the pure block imports nothing', !/^import /m.test(block));
const P = new Function(`${transpile(block.replace(/^export /gm, ''))}\nreturn { ${names.join(', ')} };`)() as Pure;

// ── #28 — the schedule generator never replaces what he typed ────────────────
console.log('\n#28 schedule generator appends, weather unknown stays unknown:');
{
  const typed = 'Framed the east wall.\nSet 4 headers.';
  const out = P.dfrAppendGenerated(typed, '[Completed] Framing');
  ok('typed text survives, character for character', out.startsWith(typed));
  ok('generated lines land under the "From schedule" divider', out === `${typed}\n\n— From schedule —\n[Completed] Framing`, out);
  ok('an empty field takes the generated lines as-is', P.dfrAppendGenerated('   ', 'x') === 'x');
  ok('nothing generated → the field is untouched', P.dfrAppendGenerated(typed, '  ') === typed);
  ok('no weather recorded → "Not recorded", never "Clear"', P.dfrAiWeatherStr(['', undefined]) === 'Not recorded' && P.DFR_WEATHER_NOT_RECORDED === 'Not recorded');
  ok('recorded weather passes through', P.dfrAiWeatherStr(['Rain', '54°F']) === 'Rain · 54°F');
  ok("no `|| 'Clear'` fallback left on the screen", !/\|\|\s*'Clear'/.test(code));
  ok('both AI generators take dfrAiWeatherStr', (code.match(/weatherStr=\{dfrAiWeatherStr\(\[weather\.conditions, weather\.temperature\]\)\}/g) ?? []).length === 2);
  ok('the schedule generator appends work performed', /setWorkPerformed\(prev => dfrAppendGenerated\(prev, workText\)\)/.test(code));
  ok('the schedule generator appends issues', /setIssuesAndDelays\(prev => dfrAppendGenerated\(prev, result\.issuesAndDelays\.join\('\\n'\)\)\)/.test(code));
  ok('no bare setWorkPerformed(workText) replace remains', !/setWorkPerformed\(workText\)/.test(code));
  const AI = read('utils/aiService.ts');
  const gen = AI.slice(AI.indexOf('export async function generateDailyReport'), AI.indexOf('export const homeownerSummarySchema'));
  ok('generateDailyReport treats "Not recorded" as unknown weather', /\/\^not recorded\$\/i/.test(gen) && /WEATHER: \$\{weatherLine\}/.test(gen) && /Do not describe or assume it/.test(gen));
  ok('the homeowner prompt says unknown weather is unknown', /WEATHER ON SITE: \$\{weatherLine \|\| 'Not recorded — unknown\. Do not mention or assume the weather\.'\}/.test(AI));
}

// ── #22 — the publish flag is saved state, stated against what is saved ──────
console.log('\n#22 publish toggle is unsaved work and says what is saved:');
{
  const c = P.dfrPublishControl;
  ok('unsaved publish reads "Publishes when you save", no pill', c(false, true).label === 'Publishes when you save' && !c(false, true).pill && c(false, true).pending === 'publish');
  ok('unsaved unpublish reads "Removed when you save", pill stays (homeowner still sees it)', c(true, false).label === 'Removed when you save' && c(true, false).pill && c(true, false).pending === 'remove');
  ok('saved + published is the only "published" state', c(true, true).pill && c(true, true).pending === null && !/when you save/.test(c(true, true).label));
  ok('never "Showing in portal" off the local toggle', !/'Showing in portal'/.test(code));
  // dfrDraftSignature — lifted and run.
  const sigStart = DFR.indexOf('function dfrDraftSignature(');
  const sigEnd = DFR.indexOf('\n}\n', sigStart) + 3;
  const sig = new Function(`${transpile(DFR.slice(sigStart, sigEnd))}\nreturn dfrDraftSignature;`)() as (c: Record<string, unknown>) => string;
  const base = {
    reportDate: '2026-09-18T15:00:00.000Z', weather: {}, manpower: [], workPerformed: '', workProgress: [],
    materialsDelivered: [], issuesAndDelays: '', photos: [{ id: 'p1', uri: 'file:///a.jpg' }], incident: { hasIncident: false }, homeownerSummary: 'Hi',
  };
  ok('toggling publish changes the signature (back/swipe now ask)', sig({ ...base, hsPublished: true }) !== sig({ ...base, hsPublished: false }));
  ok('a draft from before the flag reads as not published (still restores)', sig(base) === sig({ ...base, hsPublished: false }));
  ok('marking an incident photo is an edit', sig({ ...base, photos: [{ id: 'p1', uri: 'file:///a.jpg', incidentPhoto: true }] }) !== sig(base));
  ok('DfrDraftContent carries an OPTIONAL hsPublished', /hsPublished\?: boolean;/.test(code));
  ok('draftContent includes hsPublished (value and deps)', /homeownerSummary, hsPublished,\n\s*\}\), \[[^\]]*homeownerSummary, hsPublished\]/.test(code));
  ok('the saved baseline reads the saved flag', /hsPublished: existingReport\?\.homeownerSummaryPublished \?\? false,/.test(code));
  ok('Restore brings the flag back', /setHsPublished\(draft\.hsPublished \?\? false\)/.test(code));
  ok('the pill and label come from dfrPublishControl(saved, local)', /const hsControl = dfrPublishControl\(hsPublishedSaved, hsPublished\)/.test(code) && /\{hsControl\.pill && \(/.test(code) && /\{hsControl\.label\}/.test(code));
}

// ── #115 — the summary is for the report's day ───────────────────────────────
console.log('\n#115 homeowner summary dated the report day:');
{
  const fnStart = code.indexOf('const handleGenerateHomeownerSummary = useCallback(');
  const fn = code.slice(fnStart, code.indexOf('// ─── Profit Leak scan', fnStart) > 0 ? code.indexOf('const currentLeakHash', fnStart) : fnStart + 3000);
  ok('the prompt DFR is dated reportDate', /date: reportDate,/.test(fn) && !/existingReport\?\.date \?\? new Date\(\)\.toISOString\(\)/.test(fn));
  ok('reportDate is in the callback deps', /settings, reportDate\]\);/.test(fn));
  ok('a generated summary remembers its day', /setHsWrittenForDay\(calendarDayOf\(reportDate\)\)/.test(fn));
  ok('re-dated after writing → stale', P.dfrSummaryIsStale('Big day', '2026-09-14', '2026-09-18'));
  ok('same day → not stale', !P.dfrSummaryIsStale('Big day', '2026-09-18', '2026-09-18'));
  ok('no summary → nothing to be stale', !P.dfrSummaryIsStale('  ', '2026-09-14', '2026-09-18'));
  ok('a stale summary cannot be published (taking it down stays allowed)', /hsStale && !hsPublished \? 'Written for a different day/.test(code));
}

// ── #116 — who decides what the homeowner sees ───────────────────────────────
console.log('\n#116 only owner/editor publish; field reports notify the GC:');
{
  const a = P.dfrPublishAccess;
  ok('owner by the offline ownerUserId stamp', a({ ownerUserId: 'u1', userId: 'u1', role: null, myRole: undefined, roleLoading: true }).allowed);
  ok('owner by the live role', a({ ownerUserId: 'x', userId: 'u1', role: 'owner' }).allowed);
  ok('editor may publish', a({ ownerUserId: 'x', userId: 'u1', role: 'editor' }).allowed);
  ok('editor by the offline myRole stamp', a({ ownerUserId: 'x', userId: 'u1', role: null, myRole: 'editor' }).allowed);
  const f = a({ ownerUserId: 'x', userId: 'u1', role: 'field' });
  ok('field seat blocked, with the reason', !f.allowed && f.reason === 'The project owner decides what the homeowner sees.');
  ok('viewer seat blocked', !a({ ownerUserId: 'x', userId: 'u1', role: 'viewer' }).allowed);
  ok('offline field seat (myRole only) blocked', !a({ ownerUserId: 'x', userId: 'u1', role: null, myRole: 'field' }).allowed);
  ok("a collaborator's role still loading is held, and says so", a({ ownerUserId: 'x', userId: 'u1', role: null, roleLoading: true }).reason === 'Checking your role on this job…');
  ok('the live role outranks a stale stamp (field → editor promotion)', a({ ownerUserId: 'x', userId: 'u1', role: 'editor', myRole: 'field' }).allowed);
  ok('the publish toggle is disabled with the reason', /disabled=\{!!hsPublishBlockedReason\}/.test(code) && /!publishAccess\.allowed\s*\?\s*publishAccess\.reason/.test(code) && /testID="hs-publish-blocked"/.test(code));
  ok('SendToClientButton renders only for publishers (its Recall ignores canSend)', /\{existingReport && publishAccess\.allowed && \(\s*<View[^>]*>\s*<SendToClientButton/.test(code));
  // Wave 4 #17/#59: the note now covers a NEW report too (the foreman is told
  // the GC reviews it before he files), through dfrPortalSeatNote — which is
  // null for a publisher, so it still never renders for owner/editor.
  ok('field/viewer see where the report stands and why', /const portalSeatNote = dfrPortalSeatNote\(\{\s*canPublish: publishAccess\.allowed,/.test(code) && /\{portalSeatNote && \(/.test(code) && /testID="dfr-portal-owner-decides"/.test(code));
  ok('a field seat may not edit a PUBLISHED summary', /const hsTextLockedReason: string \| null = !publishAccess\.allowed && hsPublishedSaved/.test(code));
  ok('save writes the SAVED flag/text for a non-publisher (mirrors the trigger)',
    /const hsPublishedOut = publishAccess\.allowed \? hsPublished : savedPublished;/.test(code)
    && /homeownerSummaryPublished: hsPublishedOut,[\s\S]*homeownerSummaryPublished: hsPublishedOut,/.test(code));
  ok('the published note claims only "once the report has synced"', /The homeowner&apos;s portal shows this update once the report has synced\./.test(code));
  ok('the role hook keeps its call shape', /useProjectRoleState\(projectId \|\| undefined\)/.test(code));

  const MIG = read('supabase/migrations/20260919140000_dfr_portal_publish_owner.sql');
  const sqlCode = MIG.replace(/--.*$/gm, '');
  ok('migration: publish tier is owner-or-editor', /can_access_project\(NEW\.project_id, 'editor'\)/.test(sqlCode));
  ok('migration: a field UPDATE keeps the saved flag and portal_state (not a raise that drops his report)',
    /NEW\.homeowner_summary_published := OLD\.homeowner_summary_published;/.test(sqlCode) && /NEW\.portal_state := OLD\.portal_state;/.test(sqlCode) && !/raise exception/i.test(sqlCode));
  ok('migration: a published summary text is kept too', /NEW\.homeowner_summary := OLD\.homeowner_summary;/.test(sqlCode));
  ok('migration: a field INSERT cannot publish', /NEW\.homeowner_summary_published := false;/.test(sqlCode));
  ok("migration: a field INSERT honours the owner's auto-share off", /v_auto ->> 'dailyReports'/.test(sqlCode) && /jsonb_build_object\('status', 'draft'\)/.test(sqlCode));
  // Integration critic server r1: NULL portal_state reads as SHARED (isShared),
  // so the default of the coalesce must NOT be 'draft' — an omitted column
  // would publish. PGlite: pgtest/dfr_screen_mig.mjs (NULL + JSON-null cases).
  ok("migration: an INSERT that omits portal_state is forced to draft too (NULL reads as shared)",
    /coalesce\(NEW\.portal_state ->> 'status', ''\) <> 'draft'/.test(sqlCode) && !/coalesce\(NEW\.portal_state ->> 'status', 'draft'\)/.test(sqlCode));
  ok('migration: BEFORE INSERT OR UPDATE trigger', /before insert or update on public\.daily_reports/i.test(sqlCode));
  ok('migration: field_report_filed fires on a non-owner INSERT only',
    /after insert on public\.daily_reports/i.test(sqlCode) && /v_owner = NEW\.user_id then\s*return NEW;/.test(sqlCode)
    && /'field_report_filed',\s*'daily_reports',/.test(sqlCode));
  ok('migration: payload is exactly {project_id, report_id, author_name}',
    /jsonb_build_object\(\s*'project_id', NEW\.project_id,\s*'report_id', NEW\.id,\s*'author_name', v_author\s*\)/.test(sqlCode));
  ok('migration: idempotent (drop trigger if exists ×2, create or replace ×2)',
    (sqlCode.match(/drop trigger if exists/g) ?? []).length === 2 && (sqlCode.match(/create or replace function/g) ?? []).length === 2);
  const NOTIFY = read('supabase/functions/notify/routes.ts');
  ok('notify routes field_report_filed to the report (invoice-send-pay lane)', /case 'field_report_filed'/.test(NOTIFY));
}

// ── #114 — a day that already has a report says so ───────────────────────────
console.log('\n#114 same-day report offered, never forced:');
{
  const reports = [
    { id: 'a', date: '2026-09-18T13:00:00.000Z' },
    { id: 'b', date: '2026-09-18' },
    { id: 'c', date: '2026-09-17T15:00:00.000Z' },
  ];
  const day = calendarDayOf('2026-09-18T16:00:00.000Z');
  const hits = P.dfrSameDayReports(reports, day, null, v => calendarDayOf(v)).map(r => r.id);
  ok('instant and bare-day reports on the day both match (calendarDayOf on both sides)', hits.includes('a') && hits.includes('b') && !hits.includes('c'), hits);
  // Local 10 pm and 1 am on the 18th: in any non-UTC zone one of these has a
  // UTC prefix naming another day — a raw slice(0, 10) compare misses it.
  const late = new Date(2026, 8, 18, 22, 0).toISOString();
  const early = new Date(2026, 8, 18, 1, 0).toISOString();
  const local = P.dfrSameDayReports([{ id: 'late', date: late }, { id: 'early', date: early }], '2026-09-18', null, v => calendarDayOf(v)).map(r => r.id);
  ok('a report filed late or early in the LOCAL day still matches that day', local.length === 2, { late, early, local });
  ok('this report itself is excluded', !P.dfrSameDayReports(reports, day, 'a', v => calendarDayOf(v)).some(r => r.id === 'a'));
  ok('no day → nothing', P.dfrSameDayReports(reports, null, null, v => calendarDayOf(v)).length === 0);
  ok('only a NEW report is checked, re-run on date change', /reportId \? \[\] : dfrSameDayReports\(existingReports, reportCalendarDay, stableReportId/.test(code));
  ok('the banner offers "Open it" (replace, not a silent redirect)', /testID="dfr-same-day-banner"/.test(code) && /router\.replace\(\{ pathname: '\/daily-report', params: \{ projectId, reportId: otherId \} \}/.test(code));
  ok('a dirty form is kept as a draft before opening the other report', /void AsyncStorage\.setItem\(draftKey, JSON\.stringify\(draft\)\)\.catch\(\(\) => \{\}\)\.finally\(go\)/.test(code));
  ok('a `date` param starts a new report on that day', /!reportId && typeof paramDate === 'string' \? parseCalendarDay\(paramDate\) : null/.test(code));
  const CARD = read('components/home/DailyLogCard.tsx');
  ok('DailyLogCard gap rows open their most recent missing day', /const gapDay = needsToday \? undefined : r\.c\.missedDates\[0\];/.test(CARD) && /onPress=\{\(\) => open\(r\.projectId, gapDay\)\}/.test(CARD) && /params: missingDay \? \{ projectId, date: missingDay \} : \{ projectId \}/.test(CARD));
}

// ── #87 / #83 / #89 / #82 — the incident filed from the report ──────────────
console.log('\n#87 #83 #89 #82 incident from the report:');
{
  const staged: string[] = [];
  const stage = (p: { id: string; uri: string }) => { staged.push(p.id); return p.uri.startsWith('file://') ? `u/p/${p.id}.jpg` : null; };
  const photos = [
    { id: 'd1', uri: 'file:///delivery.jpg' },
    { id: 's1', uri: 'file:///scene.jpg', incidentPhoto: true },
    { id: 's2', uri: 'https://signed/x', storagePath: 'u/p/s2.jpg', incidentPhoto: true },
  ];
  const urls = P.dfrIncidentPhotoUrls(photos, stage, 8);
  ok('only marked photos go on the case', !urls.some(u => u.includes('d1')), urls);
  ok('an unsaved photo is staged to its durable path, never file://', urls.includes('u/p/s1.jpg') && !urls.some(u => u.startsWith('file://')), urls);
  ok('a saved photo uses its storagePath (no restage)', urls.includes('u/p/s2.jpg') && !staged.includes('s2'));
  ok('signed out (stage → null) keeps the device URI (SafetyContext keeps it local)', P.dfrIncidentPhotoUrls([{ id: 'x', uri: 'file:///x.jpg', incidentPhoto: true }], () => null, 8)[0] === 'file:///x.jpg');
  ok('capped at the incident form limit', P.dfrIncidentPhotoUrls(Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, uri: `https://x/${i}`, storagePath: `s/${i}`, incidentPhoto: true })), () => null, 8).length === 8);
  ok('nothing marked → no photos', P.dfrIncidentPhotoUrls(photos.map(p => ({ ...p, incidentPhoto: false })), stage, 8).length === 0);
  ok('the case is built from marked, staged photos', /photoUrls: dfrIncidentPhotoUrls\(photos as DfrPhotoWithFlag\[\], stageIncidentPhoto, MAX_INCIDENT_PHOTOS\)/.test(code) && !/photoUrls: photos\.map\(p => p\.uri\)/.test(code));
  ok('staging uses the same deterministic path + queue as stageDfrPhotos',
    /buildPhotoStoragePath\(uid, projectId, p\.id, ext\)/.test(code) && /queuePhotoUpload\(\{ photoId: p\.id, userId: uid, projectId, localUri: p\.uri, storagePath, contentType: contentTypeForExt\(ext\) \}\)/.test(code));
  // (wave 4 integration round 1: the builder takes the linked case as a
  // parameter so a write held until the injury log loads merges into the
  // case the log then holds — same merge, both paths.)
  ok('#83: the builder merges into the linked case',
    /\}, linked\);/.test(code)
      && /const caseRecord = buildCase\(linkedIncident, incidentClassInput, [^;]+\);\s*if \(linkedIncident\) updateIncident\(caseRecord\.id, caseRecord\);/.test(code));
  ok('#89: a case deleted in Incidents is not re-filed on save', /const caseDeletedInLog = !linkedIncident && isIncidentDeleted\(dfrCaseId\);/.test(code) && /if \(incident\.hasIncident && projectId && !caseDeletedInLog && !caseNotYoursReason\)/.test(code));
  ok('#89: the report says so and offers "File it again"', /The case from this report was deleted in Incidents, so saving will not file it again\./.test(code) && /clearIncidentTombstone\(dfrCaseId\)/.test(code));
  ok('#82: a collaborator is not promised "your" record or the OSHA 300', P.dfrIncidentFileNote(false) === 'Filed with this report. Only you and the job\u2019s owner can see it; the owner keeps the OSHA 300.' && !/your/i.test(P.dfrIncidentFileNote(false)));
  ok('#82: the will-file note reads the owner rule', /\{dfrIncidentFileNote\(isProjectOwner\)\}/.test(code));
  ok('#83: a filed case points to Incidents for people/actions/photos', /Case filed — edit people, actions and photos in Incidents/.test(code));
}

// ── #41 — only the owner drafts a change order; fieldIssue lands here ────────
console.log('\n#41 Draft-CO owner gate and the fieldIssue handoff:');
{
  ok('owner by stamp, else by role', P.dfrIsProjectOwner('u1', 'u1', null) && P.dfrIsProjectOwner('x', 'u1', 'owner') && !P.dfrIsProjectOwner('x', 'u1', 'editor') && !P.dfrIsProjectOwner(undefined, 'u1', null));
  ok('the reason is the handoff copy', P.DFR_GC_CREATES_COS === 'Your GC creates change orders — this goes to them as a field issue in this report.');
  ok('the Draft-CO button is disabled for non-owners', /disabled=\{leakIsStale \|\| !isProjectOwner\}/.test(code) && /testID="leak-draft-co-blocked"/.test(code));
  ok('the handler refuses too', /if \(!isProjectOwner\) \{ showAlert\('Change orders', DFR_GC_CREATES_COS\); return; \}/.test(code));
  ok('fieldIssue prefills a NEW report\'s issues', /const fi = typeof paramFieldIssue === 'string' \? paramFieldIssue\.trim\(\) : '';/.test(code) && /if \(existingReport\) return existingReport\.issuesAndDelays \?\? '';/.test(code));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
