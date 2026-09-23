// validate-w4-safety-fixes.ts — wave 4, lane safety (#119, #120, #121, #123,
// #124, #125).
//
//  #119 a foreman's injury report reaches an open GC app: SafetyContext
//       re-reads on foreground / web visibility / screen focus / pull-to-
//       refresh, listens to safety_incidents realtime, and the owner is
//       notified (safety_incident_filed, no PHI) with a route to THAT case.
//  #120 on a crew seat the toolbox / JHA sign-off use the GC's crew and card
//       dates (useProjectCrew), and say when the card check could not run.
//  #121 crew seats are told they see only what they filed.
//  #123 the three safety AI buttons are gated on the viewer's own Business
//       tier; "AI limit reached" only for a real cap.
//  #124 the 300A hours pre-fill drops shifts on jobs that aren't his
//       establishment — the same set the case list drops.
//  #125 offline with no cached role → "Waiting for signal", never a paywall.
//
// Pure helpers are executed; screens are pinned by source. Every pin below
// was mutation-tested against the pre-fix code.
//
// Run: bun run scripts/validate-w4-safety-fixes.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  shouldRunSafetyRefresh, SAFETY_REFRESH_MIN_GAP_MS, SAFETY_PROJECT_TABLES,
  crewCardCheck, CREW_CARDS_UNAVAILABLE, crewListNote, crewEmptyTitle,
  safetyAiBlockedReason, safetyAiServerRefusal, aiLimitAlertTitle,
} from '../utils/safety/safetyRefresh';
import {
  sharedProjectIds, hoursEntriesForOwnEstablishment, incidentsForOwnEstablishment, prefillHoursFromTimeEntries,
} from '../utils/safety/oshaLog';
import {
  mergeLocalOnly, pendingIdsForTable, pendingDeleteIdsForTable, emptyReadAuthoritative,
} from '../utils/projectContextPure';
import type { SafetyIncident } from '../types';

const ROOT = join(__dirname, '..');
const read = (p: string) => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const CTX = read('contexts/SafetyContext.tsx');
const HUB = read('app/safety.tsx');
const INC = read('app/safety-incidents.tsx');
const OSHA = read('app/safety-osha.tsx');
const JHA = read('app/safety-jha.tsx');
const TBX = read('app/safety-toolbox.tsx');
const HAZ = read('app/safety-hazards.tsx');
const NOTIFY = read('supabase/functions/notify/index.ts');
const SETTINGS = read('app/notifications-settings.tsx');
const MIG = read('supabase/migrations/20260920110000_safety_incident_realtime_notify.sql');

// ── #119 ────────────────────────────────────────────────────────────────
console.log('\n#119 the GC sees a foreman\'s case without a relaunch');
{
  const base = { canSync: true, hydrated: true, inFlight: false, lastAt: null as number | null, now: 100_000 };
  ok('first automatic refresh runs', shouldRunSafetyRefresh(base));
  ok('never before the mount hydrate (it would race it)', !shouldRunSafetyRefresh({ ...base, hydrated: false }));
  ok('never signed out', !shouldRunSafetyRefresh({ ...base, canSync: false }));
  ok('one read at a time', !shouldRunSafetyRefresh({ ...base, inFlight: true }));
  ok('focus + foreground together read once', !shouldRunSafetyRefresh({ ...base, lastAt: base.now - 1000 }));
  ok('…and again after the gap', shouldRunSafetyRefresh({ ...base, lastAt: base.now - SAFETY_REFRESH_MIN_GAP_MS }));
  ok('pull-to-refresh skips the gap', shouldRunSafetyRefresh({ ...base, lastAt: base.now - 10, force: true }));
  ok('the five project-scoped tables, not the company ones',
    [...SAFETY_PROJECT_TABLES].sort().join(',') === 'hazards,jhas,safety_incidents,safety_inspections,toolbox_talks');

  ok('SafetyContext re-reads on the RETURN to the foreground',
    /AppState\.addEventListener\('change'/.test(CTX) && /next === 'active' && prev != null && prev !== 'active'/.test(CTX));
  ok('…and on web tab visibility', /document\.addEventListener\('visibilitychange', onVis\)/.test(CTX) && /document\.visibilityState === 'visible'/.test(CTX));
  ok('…and on safety_incidents realtime INSERT and UPDATE (re-read, never splice)',
    /\.on\('postgres_changes', \{ event: 'INSERT', schema: 'public', table: INCIDENTS_TABLE \}, bump\)/.test(CTX)
    && /\.on\('postgres_changes', \{ event: 'UPDATE', schema: 'public', table: INCIDENTS_TABLE \}, bump\)/.test(CTX)
    && /rereadTables\(new Set\(\[INCIDENTS_TABLE\]\)\)/.test(CTX) && /supabase\.removeChannel\(channel\)/.test(CTX));
  ok('refresh reads the five tables through the guarded path and is exposed',
    /rereadTables\(new Set\(SAFETY_PROJECT_TABLES\)\)/.test(CTX) && /\n {4}refresh,\n {2}\};/.test(CTX));
  ok('a refresh is dropped after an account switch or a local write in flight',
    /if \(gen !== genRef\.current\) return;/.test(CTX) && /!== before\) return;/.test(CTX) && /genRef\.current \+= 1;/.test(CTX));
  for (const [name, src] of [['hub', HUB], ['incidents', INC], ['OSHA 300', OSHA]] as const) {
    ok(`${name} re-reads on focus`, /useFocusEffect\(useCallback\(\(\) => \{ void refresh\(\); \}, \[refresh\]\)\);/.test(src));
  }
  ok('incidents has pull-to-refresh that forces a read',
    /refreshControl=\{<RefreshControl refreshing=\{pulling\} onRefresh=\{onPull\}/.test(INC) && /refresh\(\{ force: true \}\)/.test(INC));
  ok('incidents opens ?incidentId= into that case', /incidentId\?: string;/.test(INC) && /items\.find\(i => i\.id === incidentId\)/.test(INC));

  ok('migration: safety_incidents joins supabase_realtime (idempotently)',
    /alter publication supabase_realtime add table public\.safety_incidents/.test(MIG) && /tablename = 'safety_incidents'/.test(MIG));
  ok('migration: AFTER INSERT trigger raises safety_incident_filed via fire_notify',
    /after insert on public\.safety_incidents/.test(MIG) && /perform public\.fire_notify\(\s*'safety_incident_filed',\s*'safety_incidents',/.test(MIG));

  // The wording, evaluated from notify's marker blocks.
  type Text = { prefKey: string; pushTitle: string; pushBody: string; emailSubject: string; title: string; subtitle: string; rows: [string, string, boolean?][]; ctaLabel: string } | null;
  type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
  const Transpiler = (globalThis as unknown as { Bun: { Transpiler: TranspilerCtor } }).Bun.Transpiler;
  const blk = (m: string) => { const a = NOTIFY.indexOf(`// >>> ${m}`); const b = NOTIFY.indexOf(`// <<< ${m}`); return a > -1 && b > a ? NOTIFY.slice(a, b) : ''; };
  const code = `${blk('notify-format')}\n${blk('wave3-notify-text')}`;
  let N: { wave3NotifyText: (e: string, p: Record<string, unknown>, proj: string) => Text } | null = null;
  try {
    const js = new Transpiler({ loader: 'ts' }).transformSync(code.replace(/^export /gm, ''));
    N = new Function(`${js}\nreturn { wave3NotifyText };`)();
  } catch (e) { ok('notify text blocks evaluate', false, String(e)); }
  const t = N?.wave3NotifyText('safety_incident_filed', { author_name: 'Jose R', severity: 'high', project_id: 'p', incident_id: 'i' }, 'Henderson') ?? null;
  ok('push: "<author> filed an incident report on <project>. Open it in Safety."',
    t?.pushBody === 'Jose R filed an incident report on Henderson. Open it in Safety.', t?.pushBody);
  ok('prefKey safety_incident', t?.prefKey === 'safety_incident');
  ok('no severity or injury wording in anything sent', !!t && !/high|injur|severity/i.test(JSON.stringify(t)), JSON.stringify(t));
  const anon = N?.wave3NotifyText('safety_incident_filed', {}, 'Henderson') ?? null;
  ok('no author → a neutral name, not an address', anon?.pushBody === 'Someone on your team filed an incident report on Henderson. Open it in Safety.');
  ok('notify dispatches it to the GC with the case id in the push', /case 'safety_incident_filed':\s*case 'punch_marked_ready': \{/.test(NOTIFY) && /incidentId: payload\.incident_id \?\? undefined/.test(NOTIFY));
  ok('settings lists the safety_incident prefKey (every prefKey has a mute row)',
    /\n {4}key: 'safety_incident',\n {4}label: '/.test(SETTINGS) && /\| 'safety_incident'/.test(SETTINGS));
}

// ── #120 ────────────────────────────────────────────────────────────────
console.log('\n#120 the GC\'s crew cards reach the foreman\'s sign-off');
{
  ok('owner seat → his own records', crewCardCheck({ isCrewSeat: false, isLoading: false, fetchedAt: null }) === 'own');
  ok('crew seat with a list (fresh or saved) → ready', crewCardCheck({ isCrewSeat: true, isLoading: false, fetchedAt: '2026-09-19T12:00:00Z' }) === 'ready');
  ok('crew seat still reading → loading', crewCardCheck({ isCrewSeat: true, isLoading: true, fetchedAt: null }) === 'loading');
  ok('crew seat, paused/failed with nothing saved → unavailable, never clean', crewCardCheck({ isCrewSeat: true, isLoading: false, fetchedAt: null }) === 'unavailable');
  ok('the unavailable line names why and offers Retry', /lapsed-card checks didn't run/.test(CREW_CARDS_UNAVAILABLE) && /Retry/.test(CREW_CARDS_UNAVAILABLE));
  for (const [name, src] of [['toolbox', TBX], ['JHA', JHA]] as const) {
    ok(`${name}: crew seat reads useProjectCrew(projectId, seat === 'crew')`,
      /const isCrewSeat = seat === 'crew';/.test(src) && /useProjectCrew\(projectId, isCrewSeat\)/.test(src));
    ok(`${name}: roster + certificates come from the GC on a crew seat`,
      /isCrewSeat \? projectCrew\.crew : getCrewForProject\(projectId \?\? ''\)/.test(src)
      && /const certifications = isCrewSeat \? projectCrew\.certifications : ownCertifications;/.test(src));
    ok(`${name}: loading / unavailable is said, with Retry wired to refetch`,
      /cardCheck === 'loading' \? CREW_CARDS_LOADING : CREW_CARDS_UNAVAILABLE/.test(src) && /onPress=\{projectCrew\.refetch\}/.test(src));
  }
  ok('JHA keeps the active-only filter on the picker', /\)\.filter\(m => m\.status === 'active'\)/.test(JHA));
}

// ── #121 ────────────────────────────────────────────────────────────────
console.log('\n#121 a crew seat is told what he sees');
{
  ok('hub says he files, it goes to the owner, he sees his own',
    /You can file JHAs, toolbox talks, hazards and incident reports here\. They go to the job\\'s owner\. You\\'ll see the ones you file, not the GC\\'s\./.test(HUB));
  ok('hub no longer says "run their JHAs"', !/run their JHAs/.test(HUB));
  for (const [name, src, kind] of [['JHA', JHA, 'jha'], ['toolbox', TBX, 'toolbox'], ['hazards', HAZ, 'hazard']] as const) {
    ok(`${name}: crew note on the list`, new RegExp(`\\{crewListNote\\('${kind}'\\)\\}`).test(src));
    ok(`${name}: crew empty state`, new RegExp(`crewEmptyTitle\\('${kind}'\\)`).test(src));
  }
  ok('the notes do not borrow the incident privacy rule', !/1904/.test(crewListNote('jha') + crewListNote('toolbox') + crewListNote('hazard')));
  ok('empty title says "you haven\'t filed", not "none"', crewEmptyTitle('jha') === "You haven't filed any JHAs on this job");
}

// ── #123 ────────────────────────────────────────────────────────────────
console.log('\n#123 safety AI is gated on his own Business tier');
{
  for (const k of ['hazard_scan', 'incident_draft', 'jha_generate'] as const) {
    ok(`${k}: Business or above → allowed`, safetyAiBlockedReason(k, true) === null);
    const r = safetyAiBlockedReason(k, false) ?? '';
    ok(`${k}: below Business → names Business, never promises Pro`, /Business plan/.test(r) && !/\bPro\b/.test(r), r);
  }
  ok('a server 403 reads the same as the button', safetyAiServerRefusal('hazard_scan', 403) === safetyAiBlockedReason('hazard_scan', false) && safetyAiServerRefusal('hazard_scan', 500) === null);
  ok('"AI limit reached" only for a real cap', aiLimitAlertTitle('daily_cap') === 'AI limit reached' && aiLimitAlertTitle('smart_cap') === 'AI limit reached' && aiLimitAlertTitle('lifetime_cap') === 'AI limit reached');
  ok('a tier block is a "Business feature"', aiLimitAlertTitle('pro_only') === 'Business feature' && aiLimitAlertTitle(undefined) === 'Business feature');
  const wired: [string, string, string, string][] = [
    ['hazard scan', HAZ, 'scanBlocked', "safetyAiBlockedReason('hazard_scan', isBusinessOrAbove)"],
    ['incident draft', INC, 'draftBlocked', "safetyAiBlockedReason('incident_draft', isBusinessOrAbove)"],
    ['JHA generate', JHA, 'generateBlocked', "safetyAiBlockedReason('jha_generate', isBusinessOrAbove)"],
  ];
  for (const [name, src, v, call] of wired) {
    ok(`${name}: gate computed from his own tier`, src.includes(`const ${v} = ${call};`));
    ok(`${name}: button disabled with the reason shown`, new RegExp(`disabled=\\{[^}]*!!${v}`).test(src) && new RegExp(`\\{${v} \\? \\(\\s*<Text[^>]*>\\{${v}\\}</Text>`).test(src));
    ok(`${name}: refused before checkAILimit, alert title follows the reason`,
      src.indexOf(`if (${v}) { showAlert('Business feature', ${v}); return; }`) > -1
      && src.indexOf(`if (${v}) {`) < src.indexOf('await checkAILimit(')
      && /showAlert\(aiLimitAlertTitle\(check\.reason\)/.test(src));
    ok(`${name}: no hard-coded "AI limit reached" left`, !/showAlert\('AI limit reached'/.test(src));
  }
}

// ── #124 ────────────────────────────────────────────────────────────────
console.log('\n#124 the 300A hours follow the establishment the cases do');
{
  const ME = 'me';
  const projects = [
    { id: 'own', ownerUserId: ME },
    { id: 'gc-job', ownerUserId: 'gc' },
    { id: 'collab-no-owner', myRole: 'field' },
  ];
  const shared = sharedProjectIds(projects, ME);
  ok('a job someone else owns is shared', shared.has('gc-job'));
  ok('a collaborator role with no owner id loaded is shared', shared.has('collab-no-owner'));
  ok('his own job is not', !shared.has('own'));
  const E = (projectId: string, h: number, workerId = 'w1') => ({ workerId, projectId, date: '2026-03-02', totalHours: h });
  const entries = [E('own', 8), E('gc-job', 10), E('', 2), E('unknown', 3), E('collab-no-owner', 4)];
  const kept = hoursEntriesForOwnEstablishment(entries, projects, ME);
  ok('own-job, shop and unknown-project shifts are kept; shared ones dropped',
    kept.map(e => e.projectId).join(',') === 'own,,unknown', kept.map(e => e.projectId).join(','));
  const pre = prefillHoursFromTimeEntries(kept, '2026');
  ok('the pre-fill no longer counts his shift on the GC\'s job', pre.totalHours === 13, String(pre.totalHours));
  const inc = (id: string, projectId: string) => ({ id, projectId } as unknown as SafetyIncident);
  const cases = incidentsForOwnEstablishment([inc('a', 'own'), inc('b', 'gc-job'), inc('c', 'unknown'), inc('d', 'collab-no-owner')], projects, ME);
  ok('the case list drops exactly the same projects', cases.map(c => c.projectId).join(',') === 'own,unknown');
  ok('the OSHA screen filters the entries before the pre-fill',
    /prefillHoursFromTimeEntries\(\s*hoursEntriesForOwnEstablishment\(timeEntries, projects, user\?\.id\),/.test(OSHA));
}

// ── #125 ────────────────────────────────────────────────────────────────
console.log('\n#125 offline with no cached role says so');
{
  const gate = HUB.slice(HUB.indexOf('export function SafetyAccessBlocked'), HUB.indexOf('/**', HUB.indexOf('export function SafetyAccessBlocked') + 10));
  const pausedAt = gate.indexOf('if (roleState.isPaused && roleState.role === null && roleState.reason)');
  ok('a paused read with a reason and no role is its own branch', pausedAt > -1);
  ok('…after loading / error and before the paywall',
    gate.indexOf('roleState.isError') < pausedAt && pausedAt < gate.indexOf('<Paywall'));
  const branch = pausedAt > -1 ? gate.slice(pausedAt, gate.indexOf('<Paywall')) : '';
  ok('…titled "Waiting for signal", shows the reason, Try again refetches, testID safety-gate-offline',
    /testID="safety-gate-offline"/.test(branch) && /Waiting for signal/.test(branch) && /\{roleState\.reason\}/.test(branch) && /roleState\.refetch\(\)/.test(branch));
}

// ── #119 review round 1 ─────────────────────────────────────────────────
console.log('\n#119 review round 1: re-reads keep queued deletes hidden and ignore untrusted empty answers');
{
  const CTX = read('contexts/SafetyContext.tsx');
  const hyd = CTX.slice(CTX.indexOf('async function hydrateCollection'), CTX.indexOf('async function sessionBearer'));
  // Behaviour: the merge exactly as hydrateCollection calls it.
  type R = { id: string };
  const queue = [{ table: 'hazards', operation: 'delete', data: { id: 'h1' } }];
  const merged = mergeLocalOnly<R>([{ id: 'h1' }, { id: 'h2' }], [{ id: 'h2' }], pendingIdsForTable(queue, 'hazards'),
    { deletedIds: pendingDeleteIdsForTable(queue, 'hazards') });
  ok('a hazard whose DELETE is queued stays hidden when the server still has it', merged.map(r => r.id).join(',') === 'h2');
  ok('hydrateCollection passes the queued-delete ids to the merge',
    // Integration round 2: the keep set also holds the rows under Not saved.
    /mergeLocalOnly\(\s*mapped,\s*prior,\s*new Set\(\[\.\.\.pendingIdsForTable\(queue, table\), \.\.\.unsaved\]\),\s*\{ deletedIds: pendingDeleteIdsForTable\(queue, table\) \},\s*\)/.test(hyd));
  // Empty-answer guard.
  ok('an empty re-read over a non-empty cache must prove the bearer before it replaces the list',
    /if \(!persist && mapped\.length === 0 && prior\.length > 0\) \{[\s\S]*emptyReadAuthoritative\(\{[\s\S]*bearerBefore,[\s\S]*bearerAfter: after\.token,[\s\S]*\}\);\s*if \(!trusted\) return null;/.test(hyd));
  ok('the bearer is read BEFORE the SELECT on a re-read',
    hyd.indexOf('const bearerBefore = persist ? null : await sessionBearer()') > -1
    && hyd.indexOf('const bearerBefore') < hyd.indexOf("supabase.from(table).select('*')"));
  ok('a re-read passes the provider user and drops a null (untrusted) answer',
    /hydrateCollection\(table, key, true, map, false, userId\);\s*\/\/[^\n]*\n\s*if \(r === null\) return;/.test(CTX));
  ok('an anon-key answer (no bearer before) is not authoritative',
    !emptyReadAuthoritative({ loadUserId: 'u', liveUserId: 'u', sessionUserId: 'u', bearerBefore: null, bearerAfter: 't' }));
  ok('a refreshed token between before and after is not authoritative',
    !emptyReadAuthoritative({ loadUserId: 'u', liveUserId: 'u', sessionUserId: 'u', bearerBefore: 't1', bearerAfter: 't2' }));
  ok('the same user token before and after is authoritative',
    emptyReadAuthoritative({ loadUserId: 'u', liveUserId: 'u', sessionUserId: 'u', bearerBefore: 't', bearerAfter: 't' }));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
