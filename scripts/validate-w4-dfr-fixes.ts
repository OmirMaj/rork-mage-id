// validate-w4-dfr-fixes.ts — wave 4, lane dfr (chain C, last): #22 #58 #59/#133
// #60 #61 #62 #63 #122, the carries #17 #72 #73 #76, and time-labor's #41
// handoff (shiftAlertHours into clockCrewForDay).
//
// What is EXECUTED, not just pinned:
//   - the screen's `>>> dfr-w4-pure` block (portal state for a field seat, the
//     seat note, who filed it, the #122 case lock, the copy source, the day's
//     photos, the homeowner-update dirty test, the Draft-CO prefill);
//   - notify's `wave3-notify-text` block for field_report_filed (the day, the
//     three portal branches, the rows);
//   - aiService's dailyReportPromptDay and AIDailyReportGen's
//     scheduleDraftBlockedReason, lifted and run against the real calendarDate;
//   - utils/pdfGenerator for real (native modules stubbed): the DFR PDF's
//     "Filed by" row and the CO PDF's client-approval line.
// Wiring that only exists inside the component or the migration is pinned by
// source, each pin naming the defect it stops from coming back. The migration
// itself (20260920140000) is executed twice in PGlite by the lane's harness
// (scratchpad pgtest/w4_dfr_mig.mjs, 46 checks); its load-bearing clauses are
// pinned here too.
//
// Run via: bun scripts/validate-w4-dfr-fixes.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

process.env.TZ = 'America/Los_Angeles';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail.slice(0, 600) : JSON.stringify(detail).slice(0, 600)}` : ''}`); }
}

type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void } | undefined;
if (typeof Bun === 'undefined') {
  console.error('\n✗ validate-w4-dfr-fixes must run under bun (needs Bun.plugin to stub native modules)\n');
  process.exit(1);
}
let printedHtml = '';
Bun.plugin({
  name: 'w4-dfr-stubs',
  setup(build) {
    build.module('react-native', () => ({ exports: { Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default } }, loader: 'object' }));
    build.module('expo-print', () => ({ exports: {
      printToFileAsync: async ({ html }: { html: string }) => { printedHtml = html; return { uri: 'file:///cache/out.pdf' }; },
      printAsync: async () => {},
    }, loader: 'object' }));
    build.module('expo-sharing', () => ({ exports: { isAvailableAsync: async () => false, shareAsync: async () => {} }, loader: 'object' }));
    build.module('expo-mail-composer', () => ({ exports: {}, loader: 'object' }));
    build.module('expo-file-system/legacy', () => ({ exports: { cacheDirectory: 'file:///cache/', EncodingType: { Base64: 'base64' } }, loader: 'object' }));
    build.module('@/lib/supabase', () => ({ exports: { supabase: {}, isSupabaseConfigured: false }, loader: 'object' }));
    build.module('@/utils/storage', () => ({ exports: { resolvePhotoUrls: async () => new Map() }, loader: 'object' }));
  },
});

const cal = await import('../utils/calendarDate');
const pdf = await import('../utils/pdfGenerator');

type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
const Transpiler = (globalThis as unknown as { Bun: { Transpiler: TranspilerCtor } }).Bun.Transpiler;
const transpile = (src: string) => new Transpiler({ loader: 'ts' }).transformSync(src);
function block(src: string, open: string, close: string, label: string): string {
  const a = src.indexOf(open);
  const b = src.indexOf(close, a + 1);
  ok(`${label} carries its block`, a > -1 && b > a);
  return a > -1 && b > a ? src.slice(a, b) : '';
}

const DFR = read('app/daily-report.tsx');
const code = strip(DFR);

// ── the screen's pure block ──────────────────────────────────────────────────
interface Pure {
  dfrNewPortalState(canPublish: boolean): { status: 'draft' } | undefined;
  dfrPortalSeatNote(o: { canPublish: boolean; portalEnabled: boolean; status?: string | null; isNew: boolean }): string | null;
  dfrFiledBy(o: Record<string, unknown>): { hero: string | null; banner: string | null; document: string | null; possessive: string };
  dfrCaseNotYoursReason(o: Record<string, unknown>): string | null;
  dfrCopySource<T extends { id: string; date: string }>(r: readonly T[], day: string | null, ex: string | null, dayOf: (v: string) => string | null): T | undefined;
  dfrReportDayPhotos<T extends { timestamp?: string | null }>(p: readonly T[], day: string | null, dayOf: (v: string) => string | null): T[];
  dfrHomeownerUpdateDirty(o: { summary: string; savedSummary?: string | null; published: boolean; savedPublished: boolean }): boolean;
  dfrLeakCoPrefill(items: { description: string; estimatedPrice?: number | null }[], when: string): { prefillDescription: string; prefillLines: string; unpricedCount: number };
  dfrCaseLogLoading(o: { incidentsHydrated: boolean; caseVisible: boolean; savedHadIncident: boolean }): boolean;
  dfrClassOfCase(c: Record<string, unknown>): Record<string, unknown>;
}
const pureSrc = block(DFR, '// >>> dfr-w4-pure', '// <<< dfr-w4-pure', 'app/daily-report.tsx dfr-w4-pure');
ok('the pure block imports nothing', !/^import /m.test(pureSrc));
const names = ['dfrNewPortalState', 'dfrPortalSeatNote', 'dfrFiledBy', 'dfrCaseNotYoursReason', 'dfrCopySource', 'dfrReportDayPhotos', 'dfrHomeownerUpdateDirty', 'dfrLeakCoPrefill', 'dfrCaseLogLoading', 'dfrClassOfCase'];
const P = new Function(`${transpile(pureSrc.replace(/^export /gm, ''))}\nreturn { ${names.join(', ')} };`)() as Pure;
const dayOf = (v: string) => cal.calendarDayOf(v);

console.log('\n#59/#133 a field seat\'s report and photos land as drafts:');
{
  ok('non-publisher → {status:draft}', JSON.stringify(P.dfrNewPortalState(false)) === '{"status":"draft"}');
  ok('publisher → undefined (the context\'s auto-share default stands)', P.dfrNewPortalState(true) === undefined);
  const calls = code.match(/portalState: dfrNewPortalState\(publishAccess\.allowed\),/g) ?? [];
  ok('both mirrored-photo paths, the new report and the no-work day pass it (4 sites)', calls.length === 4, calls.length);
  const save = code.slice(code.indexOf('const handleSave = useCallback('), code.indexOf('const handleLogDelayEvent') > 0 ? code.indexOf('const handleLogDelayEvent') : code.length);
  ok('…inside handleSave: the new report and both addProjectPhoto calls', (save.match(/portalState: dfrNewPortalState\(publishAccess\.allowed\),/g) ?? []).length >= 3);
  ok('the no-work day keeps publishAccess.allowed in its deps', /\}, \[projectId, reportDate, weather, stableReportId, addDailyReport, goBack, draftKey, publishAccess\.allowed\]\);/.test(code));
}

console.log('\n#17/#59 what a field seat is told:');
{
  const n = P.dfrPortalSeatNote;
  ok('a publisher gets nothing (his SendToClientButton says it)', n({ canPublish: true, portalEnabled: true, status: 'draft', isNew: false }) === null);
  ok('no portal on the job → says so', /no homeowner portal/.test(n({ canPublish: false, portalEnabled: false, status: 'sent', isNew: false }) ?? ''));
  ok('a new report → the GC reviews it and its photos first', n({ canPublish: false, portalEnabled: true, status: null, isNew: true }) === 'Your GC reviews this report and its photos before anything reaches the homeowner.');
  ok('a draft row → the GC reviews it first', /GC reviews/.test(n({ canPublish: false, portalEnabled: true, status: 'draft', isNew: false }) ?? ''));
  ok('a row the GC shared → "Shared … by your GC" (only when it really is shared)', /^Shared in the homeowner.s portal by your GC/.test(n({ canPublish: false, portalEnabled: true, status: 'sent', isNew: false }) ?? ''));
  ok('a recalled row is not called shared', !/^Shared/.test(n({ canPublish: false, portalEnabled: true, status: 'recalled', isNew: false }) ?? ''));
  ok('the screen renders it for every seat, new reports included', /const portalSeatNote = dfrPortalSeatNote\(\{\s*canPublish: publishAccess\.allowed,\s*portalEnabled: project\.clientPortal\?\.enabled === true,/.test(code) && /\{portalSeatNote && \(/.test(code));
  ok('no unconditional "Shared in the homeowner\'s portal." for a field seat is left', !/'Shared in the homeowner\\u2019s portal\. '/.test(code));
  const BTN = read('components/SendToClientButton.tsx');
  ok('EDITOR_SEND_NOTE says "the next time your GC\'s app is open" (#17 marks on arrival now)', /the next time your GC\\u2019s app is open/.test(BTN) && /A recall takes effect right away/.test(BTN));
}

console.log('\n#63 who filed it:');
{
  const f = P.dfrFiledBy;
  const people = [{ userId: 'fm', name: '', email: 'luis@x.com' }, { userId: 'ed', name: 'Eddie', email: 'e@x.com' }];
  ok('own report → no hero line, "by you" in the banner, his name on the PDF', (() => { const r = f({ filedByUserId: 'u', viewerId: 'u', viewerName: 'Omir', ownerUserId: 'u', people }); return r.hero === null && r.banner === 'by you' && r.document === 'Omir'; })());
  ok('the owner\'s report seen by a foreman → named by role, never guessed', f({ filedByUserId: 'gc', viewerId: 'fm', ownerUserId: 'gc', people }).hero === 'Filed by the project owner');
  ok('a collaborator the owner\'s list knows → name, else invited email', f({ filedByUserId: 'ed', viewerId: 'gc', ownerUserId: 'gc', people }).hero === 'Filed by Eddie' && f({ filedByUserId: 'fm', viewerId: 'gc', ownerUserId: 'gc', people }).document === 'luis@x.com');
  ok('unresolvable → "a team member"', f({ filedByUserId: 'zz', viewerId: 'gc', ownerUserId: 'gc', people }).hero === 'Filed by a team member' && f({ filedByUserId: 'zz', viewerId: 'gc', ownerUserId: 'gc' }).document === 'A team member');
  ok('no author id at all → nothing printed', (() => { const r = f({ filedByUserId: null, viewerId: 'gc' }); return r.hero === null && r.document === null && r.banner === null; })());
  ok('the hero shows it', /\{filedBy\.hero && \(/.test(code) && /testID="dfr-filed-by"/.test(code));
  ok('the same-day banner names whose report it is', /sameDayFiledBy \? `, \$\{sameDayFiledBy\}` : ''/.test(code) && /filedByUserId: sameDayReports\[0\]\.filedByUserId/.test(code));
  ok('a new report is the viewer\'s own', /filedByUserId: existingReport \? existingReport\.filedByUserId : user\?\.id,/.test(code));
  ok('every PDF path passes filedByName (print, share, filed copy)', (code.match(/filedByName: filedBy\.document \?\? undefined/g) ?? []).length === 3);
  const html = pdf.buildDFRHtml({ id: 'r', projectId: 'p', date: '2026-09-15', weather: {}, manpower: [], workPerformed: 'x', materialsDelivered: [], issuesAndDelays: '', photos: [], status: 'sent', createdAt: '', updatedAt: '' } as never,
    { id: 'p', name: 'Maple', location: '' } as never, { companyName: 'Acme' } as never, { filedByName: 'Luis <R>' });
  ok('the DFR PDF prints a "Filed by" row, escaped', /Filed by/.test(html) && html.includes('Luis &lt;R&gt;'));
  const html2 = pdf.buildDFRHtml({ id: 'r', projectId: 'p', date: '2026-09-15', weather: {}, manpower: [], workPerformed: 'x', materialsDelivered: [], issuesAndDelays: '', photos: [], status: 'sent', createdAt: '', updatedAt: '' } as never,
    { id: 'p', name: 'Maple', location: '' } as never, { companyName: 'Acme' } as never, {});
  ok('…and none when the caller names nobody', !/Filed by/.test(html2));
  ok('#62: the PDF never prints the record\'s status (a sent report never reads "draft")', !/>\s*draft\s*</i.test(html) && !/>\s*sent\s*</i.test(html));
}

console.log('\n#122 someone else\'s case is never blind-written:');
{
  const r = P.dfrCaseNotYoursReason;
  const base = { caseVisible: false, caseDeleted: false, isOwner: false, savedHadIncident: true, filedByUserId: 'gc', viewerId: 'fm', authorPossessive: 'the project owner’s' };
  ok('foreman on the GC\'s report, case not visible → locked with the reason', /^This case is in the project owner.s injury log — tell the GC\./.test(r(base) ?? ''), r(base));
  ok('case visible → null', r({ ...base, caseVisible: true }) === null);
  ok('his own report → null (his insert is his case)', r({ ...base, filedByUserId: 'fm' }) === null);
  ok('the owner → null (he sees every case on his job)', r({ ...base, isOwner: true }) === null);
  ok('a deleted case → null (the #89 path owns it)', r({ ...base, caseDeleted: true }) === null);
  ok('a new report (no author) → null', r({ ...base, filedByUserId: undefined }) === null);
  // Review round 1: the GC's report never carried an incident, so no case
  // exists under the derived id — the foreman adding an injury must classify
  // and file it (locking there lost it from Incidents / OSHA 300).
  ok('the GC\'s report WITHOUT an incident + a foreman adding an injury → null (no lock, the case is written)', r({ ...base, savedHadIncident: false }) === null);
  ok('…the screen feeds it from the SAVED report\'s incident, not the live toggle',
    /const savedHadIncident = existingReport\?\.incident\?\.hasIncident === true;/.test(code) && /isOwner: isProjectOwner,\s*savedHadIncident,/.test(code));

  // Integration round 1: before the injury log has loaded on this phone, "not
  // visible" means "not loaded yet" — never the lock, never a skipped write.
  const L = P.dfrCaseLogLoading;
  ok('log not loaded + saved report had an incident + case not on the phone → loading',
    L({ incidentsHydrated: false, caseVisible: false, savedHadIncident: true }) === true);
  ok('…loaded, or the case is already on the phone, or no case can exist → not loading',
    !L({ incidentsHydrated: true, caseVisible: false, savedHadIncident: true })
      && !L({ incidentsHydrated: false, caseVisible: true, savedHadIncident: true })
      && !L({ incidentsHydrated: false, caseVisible: false, savedHadIncident: false }));
  ok('while loading the lock reason is not computed (no "tell the GC" on his own case)',
    /const caseNotYoursReason = caseLogLoading \? null : dfrCaseNotYoursReason\(\{/.test(code));
  ok('…the classification is not a known fact while loading', /const classificationKnown = !caseNotYoursReason && !caseLogLoading;/.test(code));
  ok('…the screen says it is loading', /\{caseLogLoading && \(\s*<Text style=\{styles\.incidentRegisterNote\} testID="dfr-incident-case-loading">Loading the injury log/.test(code));
  ok('…and the case write is HELD (fileCaseWhenHydrated), re-deciding the lock with the case in hand',
    /if \(caseLogLoading\) \{[\s\S]{0,1400}fileCaseWhenHydrated\(dfrCaseId, \(linked\) => \{\s*if \(dfrCaseNotYoursReason\(\{ caseVisible: !!linked,[\s\S]{0,200}\}\)\) return null;/.test(code));
  ok('…a case the log holds keeps its own classification (the pickers were not editable)',
    /\? buildCase\(linked, dfrClassOfCase\(linked\), linked\.daysRestricted\)/.test(code));
  const cls = P.dfrClassOfCase({ type: 'injury', treatment: 'medical_beyond_first_aid', daysAway: 3, daysRestricted: 2, restrictedDuty: true, lostConsciousness: false, fatality: false, oshaIllnessType: 'skin' });
  ok('dfrClassOfCase carries every classification field of the case',
    cls.type === 'injury' && cls.treatment === 'medical_beyond_first_aid' && cls.daysAway === 3 && cls.daysRestricted === 2 && cls.restrictedDuty === true && cls.oshaIllnessType === 'skin', JSON.stringify(cls));
  const SAFE = strip(read('contexts/SafetyContext.tsx'));
  ok('SafetyContext exposes incidentsHydrated (state, reset on an account switch, set after the hydrate)',
    /const \[incidentsHydrated, setIncidentsHydrated\] = useState\(false\);/.test(SAFE)
      && /hydratedRef\.current = false;\s*setIncidentsHydrated\(false\);\s*heldCaseWritesRef\.current = \[\];/.test(SAFE)
      && /hydratedRef\.current = true;\s*setIncidentsHydrated\(true\);/.test(SAFE)
      && /incidentsHydrated, fileCaseWhenHydrated,/.test(SAFE));
  ok('…held case writes run only once hydrated, one per render, only for the account they were made under',
    /if \(!incidentsHydrated\) return;\s*const next = heldCaseWritesRef\.current\.shift\(\);/.test(SAFE) && /if \(next\.gen === genRef\.current\) \{/.test(SAFE));
  ok('handleSave skips the case write when locked', /if \(incident\.hasIncident && projectId && !caseDeletedInLog && !caseNotYoursReason\) \{/.test(code));
  ok('…and keeps the SAVED 1904 flags instead of the blank pickers', /injuriesReported: savedRecord\?\.incident\?\.injuriesReported,/.test(code) && /oshaRecordable: savedRecord\?\.incident\?\.oshaRecordable,/.test(code));
  ok('the classification controls are disabled with the reason on screen', /testID="dfr-incident-case-not-yours"/.test(code)
    && (code.match(/pointerEvents=\{classificationKnown \? 'auto' : 'none'\}/g) ?? []).length === 2
    && (code.match(/editable=\{classificationKnown\}/g) ?? []).length === 2);
  ok('no computed verdict is shown or printed from inputs he could not see', /\{classificationKnown && \(\s*<View\s*style=\{\[styles\.oshaVerdict/.test(code)
    && /const documentClassification = incident\.hasIncident && classificationKnown \? recordability\.reason : undefined;/.test(code));
}

console.log('\n#60 today\'s report is stamped at local noon (the push reads it in the GC\'s zone):');
{
  const init = code.slice(code.indexOf('const [reportDate, setReportDate] = useState<string>('), code.indexOf('const initialReportDateRef'));
  ok('a new report for today is local noon, never the filing instant', /const today = new Date\(\);\s*today\.setHours\(12, 0, 0, 0\);\s*return today\.toISOString\(\);/.test(init) && !/return new Date\(\)\.toISOString\(\);/.test(init), init.slice(-200));
  // Behaviour: local noon of any day in any US zone reads as that same day in
  // America/New_York (the zone every production GC digests in).
  const dayIn = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const noonUtcFor = (offsetH: number) => new Date(Date.UTC(2026, 8, 15, 12 - offsetH)).toISOString(); // local noon at UTC+offsetH
  ok('…local noon in Pacific / Alaska / Hawaii reads as the same day in New York', [-7, -8, -9, -10].every(o => dayIn(noonUtcFor(o), 'America/New_York') === '2026-09-15'));
  ok('…whereas a 9:30 pm Pacific filing instant read in New York names the next day (the bug)', dayIn('2026-09-16T04:30:00.000Z', 'America/New_York') === '2026-09-16');
}

console.log('\n#61 a missed day is drafted from its own day:');
{
  const reports = [
    { id: 'mon', date: '2026-09-14T19:00:00.000Z' },
    { id: 'wed', date: '2026-09-16T19:00:00.000Z' },
    { id: 'fri', date: '2026-09-11T19:00:00.000Z' },
    { id: 'mon2', date: '2026-09-14T22:00:00.000Z' },
  ];
  ok('copy source for Tue is Monday (the later of Monday\'s two), never Wednesday', P.dfrCopySource(reports, '2026-09-15', null, dayOf)?.id === 'mon2');
  ok('copy source for Mon is Friday — a same-day report is never a source', P.dfrCopySource(reports, '2026-09-14', null, dayOf)?.id === 'fri');
  ok('nothing earlier → no button', P.dfrCopySource(reports, '2026-09-10', null, dayOf) === undefined);
  ok('the report itself is excluded', P.dfrCopySource([{ id: 'x', date: '2026-09-10' }], '2026-09-11', 'x', dayOf) === undefined);
  const photos = [{ id: 'a', timestamp: '2026-09-14T16:00:00.000Z' }, { id: 'b', timestamp: '2026-09-16T16:00:00.000Z' }, { id: 'c', timestamp: '' }, { id: 'd', timestamp: '2026-09-15T05:30:00.000Z' }];
  ok('the photos are the report day\'s (local day: 05:30Z Sep 15 is Sep 14 in LA)', P.dfrReportDayPhotos(photos, '2026-09-14', dayOf).map(p => p.id).join(',') === 'a,d');
  ok('the screen keys its photos and its copy source on reportCalendarDay',
    /dfrReportDayPhotos\(getPhotosForProject\(projectId \?\? ''\), reportCalendarDay, v => calendarDayOf\(v\)\)/.test(code)
    && /dfrCopySource\(existingReports, reportCalendarDay, stableReportId, v => calendarDayOf\(v\)\)/.test(code));
  ok('the old "today unless it has a reportId" photo filter is gone', !/new Date\(p\.timestamp\)\.toDateString\(\) === refDay/.test(code));
  ok('a backdated report names its copy source day, not "N days ago" from today', /reportCalendarDay !== carryLabelDay\s*\? carrySourceDayAbsolute\(lastReport\.date\)/.test(code));
  ok('the schedule generator is handed the report day', /<AIDailyReportGen[\s\S]{0,200}reportDay=\{reportCalendarDay\}/.test(code));
  // aiService: the prompt's day
  const AI = read('utils/aiService.ts');
  const fnSrc = AI.slice(AI.indexOf('export function dailyReportPromptDay'), AI.indexOf('export async function generateDailyReport'));
  const promptDay = new Function('calendarDayOf', 'formatCalendarDay', 'todayCalendarDay',
    `${transpile(fnSrc.replace(/^export /gm, ''))}\nreturn dailyReportPromptDay;`)(cal.calendarDayOf, cal.formatCalendarDay, cal.todayCalendarDay) as (d: string | null, now?: Date) => { label: string; isPast: boolean };
  const now = new Date(2026, 8, 16, 10);
  ok('dailyReportPromptDay: Monday on a Wednesday is past and says Monday', (() => { const d = promptDay('2026-09-14', now); return d.isPast && /Monday, September 14/.test(d.label); })(), promptDay('2026-09-14', now));
  ok('dailyReportPromptDay: today is not past', !promptDay('2026-09-16', now).isPast && !promptDay(null, now).isPast);
  const gen = AI.slice(AI.indexOf('export async function generateDailyReport'), AI.indexOf('export const homeownerSummarySchema'));
  ok('generateDailyReport takes reportDay and prints it, never new Date()', /reportDay\?: string \| null,/.test(gen) && /DATE OF THIS REPORT: \$\{day\.label\}/.test(gen) && !/new Date\(\)\.toLocaleDateString\(\)/.test(gen));
  ok('…a past day\'s task data is labelled as of now and completion is forbidden', /AS OF NOW, not as of \$\{day\.label\}/.test(gen) && /leave workCompleted empty/.test(gen));
  const GEN = read('components/AIDailyReportGen.tsx');
  const bSrc = GEN.slice(GEN.indexOf('export function scheduleDraftBlockedReason'), GEN.indexOf('export default React.memo'));
  const blocked = new Function('formatCalendarDay', 'todayCalendarDay', `${transpile(bSrc.replace(/^export /gm, ''))}\nreturn scheduleDraftBlockedReason;`)(cal.formatCalendarDay, cal.todayCalendarDay) as (d: string | null | undefined, today?: string) => string | null;
  ok('AIDailyReportGen: a past day is blocked, and says why (naming the day)', /can't write Mon, Sep 14's report/.test(blocked('2026-09-14', '2026-09-16') ?? ''), blocked('2026-09-14', '2026-09-16'));
  ok('AIDailyReportGen: today / no day → allowed', blocked('2026-09-16', '2026-09-16') === null && blocked(undefined, '2026-09-16') === null);
  ok('AIDailyReportGen: the button is disabled and the handler refuses too', /disabled=\{isLoading \|\| !!pastDayReason\}/.test(GEN) && /if \(scheduleDraftBlockedReason\(reportDay\)\) return;/.test(GEN)
    && /generateDailyReport\(projectName, tasks, weatherStr, reportDay\)/.test(GEN) && /testID="dfr-schedule-draft-blocked"/.test(GEN));
}

console.log('\n#58 the homeowner update on a submitted report:');
{
  const d = P.dfrHomeownerUpdateDirty;
  ok('same text and flag → clean', !d({ summary: ' Hi ', savedSummary: 'Hi', published: true, savedPublished: true }));
  ok('a text edit → dirty', d({ summary: 'Hi there', savedSummary: 'Hi', published: false, savedPublished: false }));
  ok('a take-down → dirty', d({ summary: 'Hi', savedSummary: 'Hi', published: false, savedPublished: true }));
  ok('the controls are open for an owner/editor on a sent report', /const hsEditableWhenLocked = reportIsSent && publishAccess\.allowed;/.test(code)
    && /const hsEditable = !isLocked \|\| hsEditableWhenLocked;/.test(code)
    && /\{hsEditable && !hsTextLockedReason && \(/.test(code) && /\{hsEditable && !hsTextLockedReason \? \(/.test(code) && /\{hsEditable && homeownerSummary\.trim\(\)\.length > 0 && \(/.test(code));
  ok('no homeowner control is still gated on !isLocked alone', !/\{!isLocked && (?:hsTextLockedReason|!hsTextLockedReason|homeownerSummary\.trim)/.test(code));
  const saveFn = code.slice(code.indexOf('const handleSaveHomeownerUpdate = useCallback('), code.indexOf('const handleBack = useCallback('));
  ok('"Save update" writes ONLY the three homeowner fields, never handleSave', /updateDailyReport\(existingReport\.id, \{\s*homeownerSummary: text \|\| undefined,\s*homeownerSummaryGeneratedAt: hsGeneratedAt,\s*homeownerSummaryPublished: publish,\s*\}\);/.test(saveFn) && !/handleSave\(/.test(saveFn) && !/status:/.test(saveFn));
  ok('…refuses a field/viewer seat and a report that is not sent', /if \(!existingReport \|\| existingReport\.status !== 'sent' \|\| !publishAccess\.allowed\) return;/.test(saveFn));
  ok('…never publishes empty text', /const publish = hsPublished && text\.length > 0;/.test(saveFn));
  ok('the button renders only while the update differs from what is saved', /\{hsEditableWhenLocked && hsUpdateDirty && \(/.test(code) && /testID="hs-save-update"/.test(code));
  const back = code.slice(code.indexOf('const handleBack = useCallback('), code.indexOf('if (!project) {'));
  ok('the back guard asks about an unsaved update BEFORE the sent-report early exit', back.indexOf('if (hsUpdateDirty) {') > -1 && back.indexOf('if (hsUpdateDirty) {') < back.indexOf("if (!isDirty || existingReport?.status === 'sent') { goBack(); return; }"));
  ok('…and offers "Save update", never "Save draft", on a sent report', /text: 'Save update', onPress: \(\) => handleSaveHomeownerUpdate\(goBack\)/.test(back));
  ok('a field/viewer seat on a sent report is told the owner decides', /testID="hs-locked-owner-decides"/.test(code));
}

console.log('\n#62 a submitted report can be printed / shared again:');
{
  ok('the locked top bar carries Print / Share PDF', /label=\{sharingPdf \? 'Making PDF…' : 'Print \/ Share PDF'\}/.test(code) && /onPress=\{handlePrintOrShareLocked\}/.test(code) && /testID="dfr-locked-print-share"/.test(code));
  const fn = code.slice(code.indexOf('const handlePrintOrShareLocked = useCallback('), code.indexOf('const handleConfirmSend = useCallback('));
  ok('web prints (the synchronous tab), the phone shares generateDFRPDF with the send path\'s inputs', /if \(Platform\.OS === 'web'\) \{ handlePrintCopy\(\); return; \}/.test(fn)
    && /generateDFRPDF\(doc, project, brandingOrBlank\(\), \{\s*photos: await resolveDfrPhotosForDocument\(doc\.photos, galleryPhotos\),\s*incidentClassification: documentClassification,/.test(fn));
  ok('…and saves nothing, stamps nothing', !/updateDailyReport|handleSave|addDailyReport/.test(fn));
  ok('…a failure says so', /showAlert\('Could not make the PDF'/.test(fn));
  ok('the document record of a sent report is "sent"', /status: existingReport\?\.status === 'sent' \? 'sent' : 'draft',/.test(code));
}

console.log('\n#76 Draft CO: client-facing description, one line per item:');
{
  const p = P.dfrLeakCoPrefill([
    { description: 'Extra framing', estimatedPrice: 1200.456 },
    { description: 'Haul-off', estimatedPrice: null },
    { description: '   ', estimatedPrice: 50 },
  ], 'Sep 15');
  const lines = JSON.parse(p.prefillLines) as Record<string, unknown>[];
  ok('description is a neutral scope sentence — no ~$, quotes or NEEDS PRICE', p.prefillDescription === 'Additional work outside the original scope, observed Sep 15.' && !/~\$|"|needs price/i.test(p.prefillDescription));
  ok('one line per item; a blank item is dropped', lines.length === 2);
  ok('a priced item: exact to the cent, tagged ai_estimated (CONTRACT 9 keys)', JSON.stringify(lines[0]) === JSON.stringify({ name: 'Extra framing', description: '', quantity: 1, unit: 'ls', unitPrice: 1200.46, priceSource: 'ai_estimated' }), lines[0]);
  ok('an unpriced item: $0, tagged needs_price', lines[1].unitPrice === 0 && lines[1].priceSource === 'needs_price' && p.unpricedCount === 1);
  const leak = code.slice(code.indexOf('const handleDraftLeakCO = useCallback('), code.indexOf('const scheduleTasks = useMemo'));
  ok('the Draft-CO handler sends prefillLines + the neutral description, not the old string', /prefillDescription: prefill\.prefillDescription,\s*prefillLines: prefill\.prefillLines,/.test(leak)
    && !/NEEDS PRICE: \$\{/.test(leak) && !/~\$\$\{/.test(leak) && !/reportQuote/.test(leak) && !/prefillAmount/.test(leak));
  ok('…still owner-only (#41)', /if \(!isProjectOwner\) \{ showAlert\('Change orders', DFR_GC_CREATES_COS\); return; \}/.test(leak));
}

console.log('\n#41 (time-labor handoff) the roster reads the GC\'s shift-alert hours:');
ok('clockCrewForDay gets shiftAlertHours as the 7th argument', /clockCrewForDay\(timeEntries, project\.id, reportCalendarDay, settings\?\.branding\?\.companyName, liveNowMs, overtimeRule, shiftAlertHours\)/.test(code)
  && /refresh: refreshTimeEntries, shiftAlertHours \} = useTimeEntries\(\);/.test(code));

// ── notify ──────────────────────────────────────────────────────────────────
console.log('\n#60/#59/#133 the "report filed" notification:');
{
  const NOTIFY = read('supabase/functions/notify/index.ts');
  const fmt = block(NOTIFY, '// >>> notify-format', '// <<< notify-format', 'notify notify-format');
  const txt = block(NOTIFY, '// >>> wave3-notify-text', '// <<< wave3-notify-text', 'notify wave3-notify-text');
  type T = { pushBody: string; emailSubject: string; subtitle: string; title: string; rows: [string, string][] } | null;
  const N = new Function(`${transpile(`${fmt}\n${txt}`.replace(/^export /gm, ''))}\nreturn { wave3NotifyText };`)() as { wave3NotifyText: (e: string, p: Record<string, unknown>, n: string) => T };
  const w = (p: Record<string, unknown>) => N.wave3NotifyText('field_report_filed', p, 'Henderson');
  const draft = w({ author_name: 'Luis', report_date: '2026-09-14', portal_status: 'draft' });
  ok('names the report\'s own day, never "today\'s"', draft?.pushBody.startsWith('Luis filed the report for Mon, Sep 14.') === true && !/today/i.test(draft?.pushBody ?? ''), draft?.pushBody);
  ok('draft → "Review it before anything goes to the homeowner."', draft?.pushBody.endsWith('Review it before anything goes to the homeowner.') === true && draft?.subtitle === 'Review it before anything goes to the homeowner.');
  const sent = w({ author_name: 'Eddie', report_date: '2026-09-14', portal_status: 'sent', in_weekly_digest: true });
  ok('shared → "already on the homeowner\'s portal and will be in Friday\'s update"', sent?.pushBody.endsWith("It's already on the homeowner's portal and will be in Friday's update. Hide it if it shouldn't be.") === true, sent?.pushBody);
  const sentNoDigest = w({ author_name: 'Eddie', report_date: '2026-09-14', portal_status: 'sent', in_weekly_digest: false });
  ok('shared, no weekly digest on the job → no Friday promise', /already on the homeowner's portal\. Hide it/.test(sentNoDigest?.pushBody ?? '') && !/Friday/.test(sentNoDigest?.pushBody ?? ''));
  const legacy = w({ author_name: 'Luis' });
  ok('an old trigger (no status, no day) makes neither promise', legacy?.pushBody === 'Luis filed a daily report. Open it to check what the homeowner can see.', legacy?.pushBody);
  ok('a garbled or instant day is never printed as a guess', /filed a daily report\./.test(w({ report_date: '2026-09-14T12:00:00Z', portal_status: 'draft' })?.pushBody ?? '') && /filed a daily report\./.test(w({ report_date: '2026-02-31', portal_status: 'draft' })?.pushBody ?? ''));
  ok('the email has a "Report date" row and the portal state', JSON.stringify(draft?.rows) === JSON.stringify([['Filed by', 'Luis'], ['Report date', 'Mon, Sep 14'], ['Homeowner portal', 'Not shown — waiting on you']]), draft?.rows);
  ok('the subject names the day too', draft?.emailSubject === 'Luis filed the report for Mon, Sep 14 · Henderson');
  ok('#73 the decline email names "Revise & re-issue"', /use Revise & re-issue on the change order if it still applies/.test(NOTIFY) && /use Revise & re-issue on the change order if appropriate/.test(NOTIFY));
  ok('the safety lane\'s case order is kept', /case 'pro_response_received':\s*case 'safety_incident_filed':\s*case 'punch_marked_ready': \{/.test(NOTIFY));
}

// ── the migration ─────────────────────────────────────────────────────────────
console.log('\n20260920140000 (executed twice in PGlite by the lane; clauses pinned):');
{
  const MIG = read('supabase/migrations/20260920140000_dfr_field_drafts_and_submit_notify.sql').replace(/--.*$/gm, '');
  const drFn = MIG.slice(MIG.indexOf('function public.trg_daily_reports_portal_owner'), MIG.indexOf('drop trigger if exists daily_reports_portal_owner'));
  ok('#59: a non-editor INSERT is draft whatever autoShare says (no autoShare lookup left)', /if coalesce\(NEW\.portal_state ->> 'status', ''\) <> 'draft' then\s*NEW\.portal_state := jsonb_build_object\('status', 'draft'\);/.test(drFn) && !/autoShare/.test(drFn));
  ok('…the UPDATE branch still keeps OLD portal_state and the published flag', /NEW\.portal_state := OLD\.portal_state;/.test(drFn) && /NEW\.homeowner_summary_published := OLD\.homeowner_summary_published;/.test(drFn));
  const psFn = MIG.slice(MIG.indexOf('function public.trg_portal_state_owner'), MIG.indexOf('drop trigger if exists photos_portal_owner'));
  ok('#22: one owner/editor guard for photos and rfis — service role and editor pass, a field UPDATE is neutralised, not raised',
    /if auth\.uid\(\) is null then\s*return NEW;/.test(psFn) && /can_access_project\(NEW\.project_id, 'editor'\)/.test(psFn)
    && /NEW\.portal_state := OLD\.portal_state;/.test(psFn) && !/raise/i.test(psFn));
  ok('#22: both tables get it, BEFORE INSERT OR UPDATE', /create trigger photos_portal_owner\s*before insert or update on public\.photos/.test(MIG) && /create trigger rfis_portal_owner\s*before insert or update on public\.rfis/.test(MIG));
  ok('#60: AFTER INSERT OR UPDATE OF status WHEN sent, edge-triggered in the body', /after insert or update of status on public\.daily_reports\s*for each row\s*when \(NEW\.status = 'sent'\)/.test(MIG)
    && /if TG_OP = 'UPDATE' and OLD\.status is not distinct from 'sent' then\s*return NEW;/.test(MIG));
  ok('CONTRACT 10 payload keys', /'project_id', NEW\.project_id,\s*'report_id', NEW\.id,\s*'author_name', v_author,\s*'report_date', v_day,\s*'portal_status', case when v_visible then 'sent' else 'draft' end,/.test(MIG));
  ok('portal_status "sent" only when the homeowner can see it (shared AND portal on AND daily reports shown)', /v_visible := v_shared\s*and coalesce\(v_portal ->> 'enabled', ''\) = 'true'\s*and coalesce\(v_portal ->> 'showDailyReports', ''\) = 'true';/.test(MIG));
  ok('a bad day never fails the submit', /exception when others then\s*v_day := null;/.test(MIG));
  ok('the owner submitting his foreman\'s draft himself is not notified (actor, not only author)', /if v_owner is null or v_owner = NEW\.user_id or v_owner = auth\.uid\(\) then\s*return NEW;/.test(MIG));
  ok('idempotent: 3 create-or-replace, 4 drop-trigger-if-exists; trigger fns not callable', (MIG.match(/create or replace function/g) ?? []).length === 3 && (MIG.match(/drop trigger if exists/g) ?? []).length === 4
    && (MIG.match(/revoke execute on function public\.trg_[a-z_]+\(\) from public, anon, authenticated;/g) ?? []).length === 3);
}

// ── #72 the CO PDF prints who approved it ────────────────────────────────────
console.log('\n#72 the change-order PDF states the client approval:');
{
  const co = (over: Record<string, unknown>) => ({
    id: 'co1', number: 3, projectId: 'p', date: '2026-09-15', description: 'Extra', reason: '', lineItems: [],
    originalContractValue: 1000, changeAmount: 100, newContractTotal: 1100, status: 'approved', auditTrail: [], approvers: [], ...over,
  });
  const project = { id: 'p', name: 'Maple' };
  const branding = { companyName: 'Acme' };
  printedHtml = '';
  await pdf.generateChangeOrderPDFUri(co({ auditTrail: [{ id: 'a1', action: 'client_signed_via_portal', actor: 'Dana <Owner>', timestamp: '2026-09-15T18:00:00.000Z', detail: 'record SHA-256 0123456789abcdef…' }] }) as never, project as never, branding as never);
  ok('an e-signed CO prints the sealed line in place of the blank signature line', /data-co-approval="client_signed"/.test(printedHtml) && printedHtml.includes('Electronically signed by Dana &lt;Owner&gt;') && /record SHA-256 0123456789abcdef/.test(printedHtml) && !/Client signature</.test(printedHtml));
  printedHtml = '';
  await pdf.generateChangeOrderPDFUri(co({}) as never, project as never, branding as never);
  ok('a manual approval says so and keeps the blank line for a wet signature', /data-co-approval="manual"/.test(printedHtml) && /no client signature on file/.test(printedHtml) && /Client signature</.test(printedHtml));
  printedHtml = '';
  await pdf.generateChangeOrderPDFUri(co({ status: 'submitted' }) as never, project as never, branding as never);
  ok('an unapproved CO prints only the blank line (coApprovalLine null)', !/data-co-approval/.test(printedHtml) && /Client signature</.test(printedHtml));
  const PDF = strip(read('utils/pdfGenerator.ts'));
  ok('generateChangeOrderPDF / -Uri keep their signatures (CONTRACT 6)', /export async function generateChangeOrderPDF\(\s*co: ChangeOrder, project: Project, branding: CompanyBranding,\s*\): Promise<void>/.test(PDF)
    && /export async function generateChangeOrderPDFUri\(\s*co: ChangeOrder, project: Project, branding: CompanyBranding,\s*\): Promise<string \| null>/.test(PDF));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
