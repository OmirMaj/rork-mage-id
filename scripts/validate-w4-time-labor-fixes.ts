// validate-w4-time-labor-fixes.ts — wave 4, lane time-labor (chain C1).
//
//   #41  a forgotten clock-out kept adding hours to the LIVE overtime split, so
//        Tuesday's 8 h and Wednesday's 5 h read as overtime on the OT tile and
//        on a new daily report. Missed open shifts now feed nobody's totals.
//   #99  a foreman was offered a worker the GC already had on the clock, and
//        the GC then paid him twice. Every open row blocks the name (greyed,
//        with who has him); other people's open shifts show read-only; a
//        double-clocked worker is flagged.
//   #100 with no signal a foreman could clock nobody in: the GC's crew list was
//        network-only. It is saved per user + job and served, dated, offline.
//   #101 closing the Labor rates sheet wrote EVERY field, so a stale untouched
//        field cleared / rolled back a rate set on another device. Now only the
//        fields he changed; untouched fields follow the book while open.
//   #103 a shift deleted on one device stayed forever on the others. A row the
//        device saw on the server and that is gone on a COMPLETE pull is
//        dropped — never a legacy no-job row, never a queued one.
//   #104 Job Costing sent him to set a rate for a trade the sheet never listed.
//   #105 no pull-to-refresh; a foreman's clock-ins never showed on the GC's
//        open screen; clock-in never checked a stale list.
//   #106 "Logged by jose@… logged this shift".
//
// Pure rules run directly; screen wiring is pinned by source.
// Run via: bun run scripts/validate-w4-time-labor-fixes.ts

process.env.TZ = 'America/Los_Angeles';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { TimeEntry } from '../types';
import { computeOvertime, overtimeFor, isMissedOpenShift, DEFAULT_OVERTIME_RULE } from '../utils/overtime';
import { clockCrewForDay, clockCrewSourceLine } from '../utils/dfrClockCrew';
import * as P from '../utils/timeClockPayroll';
import { parseRateDraft, rateDraftBatch, reseedUntouchedDrafts, seedRateDrafts } from '../utils/laborRateDraft';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}
function expect<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const H = '11111111-1111-4111-8111-111111111111';
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00`).toISOString();
function shift(over: Partial<TimeEntry>): TimeEntry {
  return {
    id: 'x', projectId: H, projectName: 'Henderson', workerId: 'w-jose', workerName: 'Jose', trade: 'Framing',
    clockIn: at('2026-09-15', '07:00'), clockOut: at('2026-09-15', '15:00'), breakMinutes: 0,
    totalHours: 8, overtimeHours: 0, status: 'clocked_out', date: '2026-09-15', ...over,
  };
}
const open = (id: string, day: string, hhmm = '07:00'): TimeEntry =>
  shift({ id, clockIn: at(day, hhmm), clockOut: undefined, totalHours: 0, status: 'clocked_in', date: day });

console.log('\n#41 a missed clock-out feeds nobody\'s overtime:');
{
  // Mon Sep 14 open (never clocked out), Tue 8 h finished, Wed open; Wed noon.
  const mon = open('mon', '2026-09-14');
  const tue = shift({ id: 'tue', clockIn: at('2026-09-15', '07:00'), clockOut: at('2026-09-15', '15:00'), totalHours: 8 });
  const wed = open('wed', '2026-09-16');
  const now = Date.parse(at('2026-09-16', '12:00'));
  const TODAY = '2026-09-16';
  ok('Monday\'s open shift is a missed clock-out on Wednesday', isMissedOpenShift(mon, now, 8) && !isMissedOpenShift(wed, now, 8));
  ok('the payroll rule and the overtime rule agree', P.isMissedClockOut(mon, now, 8) === isMissedOpenShift(mon, now, 8)
    && P.isMissedClockOut(wed, now, 8) === isMissedOpenShift(wed, now, 8) && P.missedClockOutHours(8) === 14);
  const live = computeOvertime([mon, tue, wed], DEFAULT_OVERTIME_RULE, { today: TODAY, liveNowMs: now, missedAlertHours: 8 });
  expect('regression: 0 OT Tuesday, 0 OT Wednesday (his real week is 13 h so far)',
    [overtimeFor(live, 'tue'), overtimeFor(live, 'wed')], [0, 0]);
  ok('…and the missed shift itself carries no allocation', !live.byEntry.has('mon'));
  const legacy = computeOvertime([mon, tue, wed], DEFAULT_OVERTIME_RULE, { today: TODAY, liveNowMs: now });
  ok('without the alert hours the allocation is unchanged (other callers)', overtimeFor(legacy, 'tue') === 8);
  const wedCrew = clockCrewForDay([mon, tue, wed], H, '2026-09-16', 'Ortiz', now, DEFAULT_OVERTIME_RULE, 8);
  ok('a new Wednesday report: 1 person, 5 h, no overtime',
    wedCrew?.people === 1 && wedCrew.totalHours === 5 && wedCrew.overtimeHours === 0, JSON.stringify(wedCrew));
  const tueCrew = clockCrewForDay([mon, tue, wed], H, '2026-09-15', 'Ortiz', now);
  ok('Tuesday\'s report shows 8 h and no overtime (default alert hours)', tueCrew?.totalHours === 8 && tueCrew.overtimeHours === 0, JSON.stringify(tueCrew));
  // Integration round 1: the phantom HOURS go, the MAN stays. Monday's
  // report opened later counts him (1 person) at 0 h with no overtime, and
  // says his clock-out is missing — never null (null fell back to the
  // schedule and claimed no clock-ins had reached this phone).
  const monCrew = clockCrewForDay([mon, tue, wed], H, '2026-09-14', 'Ortiz', now, DEFAULT_OVERTIME_RULE, 8);
  ok('Monday\'s report opened later does not book ~53 running hours — he is counted at 0 h',
    monCrew !== null && monCrew.people === 1 && monCrew.totalHours === 0 && monCrew.overtimeHours === 0
      && monCrew.missedCount === 1 && monCrew.liveCount === 0, JSON.stringify(monCrew));
  ok('…and the source line says his clock-out is not entered and where to enter it',
    monCrew !== null && /1 person, 0 h · 1 clock-out not entered — their hours are left out until entered on Time Tracking/.test(clockCrewSourceLine(monCrew, 0)));
  const tt = src('app/time-tracking.tsx');
  ok('the OT tile\'s live split passes the shift-alert hours',
    /computeOvertime\(mergeTimeEntriesMirror\(entries, teamEntries\), overtimeRule, \{ liveNowMs: nowMs, missedAlertHours: shiftAlertHours \}\)/.test(tt));
  ok('overtime.ts does not import timeClockPayroll (no cycle)', !/timeClockPayroll/.test(src('utils/overtime.ts').replace(/\/\/.*$/gm, '')));
}

console.log('\n#99 a worker on the clock is never offered twice:');
{
  const tt = src('app/time-tracking.tsx');
  const block = tt.slice(tt.indexOf('const openShiftByWorker = useMemo'), tt.indexOf('const availableRoster = useMemo'));
  ok('the open-shift map reads EVERY team row, not only owned ones', /for \(const e of teamEntries\)/.test(block) && !/ownedTeam/.test(block));
  ok('…and keeps the missed-clock-out exemption', /!isMissed\(e\)/.test(block));
  ok('availableRoster filters on it', /roster\.filter\(m => !openShiftByWorker\.has\(m\.id\)\)/.test(tt));
  ok('blocked names are shown greyed with who has him', /On the clock\$\{where\} — \$\{hit\.who \? `logged by \$\{hit\.who\}` : 'you clocked him in'\}/.test(tt)
    && /testID=\{`clock-in-member-on-clock-\$\{member\.id\}`\}/.test(tt));
  ok('seat-job open shifts are listed read-only', /seatTeamOpen\.map\(e => \(\{[\s\S]{0,160}readOnly: true/.test(tt) && /readOnly=\{r\.readOnly\}/.test(tt)
    && /testID=\{`time-entry-readonly-\$\{entry\.id\}`\}/.test(tt));
  ok('a read-only row takes no action', /if \(!teamRow && !entries\.some\(x => x\.id === entry\.id\)\) return;/.test(tt));
  ok('costing, the export and closeTeamShift stay on ownedTeam',
    /\.\.\.ownedTeam\.map\(\(e: TeamTimeEntry\) => \(\{ \.\.\.e, loggedByLabel/.test(tt) && /const teamRow = ownedTeam\.find/.test(tt)
    && /const todayEntries = \[\.\.\.entries, \.\.\.ownedTeam\]/.test(tt));
  ok('a double-clocked worker is flagged', /const doubleClocked = useMemo/.test(tt) && /testID="time-tracking-double-clocked"/.test(tt) && /isn&apos;t paid twice/.test(tt));
}

console.log('\n#100 the job\'s crew is saved for no signal:');
{
  ok('key is per user and job, under the swept mageid_ prefix',
    P.projectCrewCacheKey('u1', 'p1') === 'mageid_project_crew:u1:p1' && P.PROJECT_CREW_CACHE_PREFIX.startsWith('mageid_'));
  const saved = P.savedProjectCrewFrom(
    [{ id: 'w1', fullName: 'Jose', trades: ['Framing'], status: 'active', phone: '555' } as never],
    [{ id: 'c1', workerId: 'w1', type: 'OSHA 10', expiresDate: '2026-10-01', status: 'valid', createdBy: 'gc' } as never],
    '2026-09-18T14:05:00.000Z',
  );
  ok('only id/name/trades/status and cert type/expiry are kept', JSON.stringify(saved) ===
    JSON.stringify({ fetchedAt: '2026-09-18T14:05:00.000Z', crew: [{ id: 'w1', fullName: 'Jose', trades: ['Framing'], status: 'active' }], certifications: [{ id: 'c1', workerId: 'w1', type: 'OSHA 10', expiresDate: '2026-10-01' }] }),
    JSON.stringify(saved));
  ok('a saved copy round-trips; junk reads as none',
    JSON.stringify(P.parseSavedProjectCrew(JSON.stringify(saved))) === JSON.stringify({ ...saved, certifications: [{ id: 'c1', workerId: 'w1', type: 'OSHA 10', expiresDate: '2026-10-01' }] })
    && P.parseSavedProjectCrew('{') === null && P.parseSavedProjectCrew(JSON.stringify({ crew: [] })) === null && P.parseSavedProjectCrew(null) === null);
  ok('the offline line says it is offline and from when', /^You're offline\. Crew list and certificate flags from \w{3} \d/.test(P.savedCrewLine(saved.fetchedAt, true)));
  const crew = src('contexts/CrewContext.tsx');
  ok('each read has a ~10 s abort', /PROJECT_CREW_TIMEOUT_MS = 10_000/.test(crew) && (crew.match(/\.abortSignal\(ctrl\.signal\)/g) ?? []).length === 2);
  ok('a transport failure or timeout serves the saved copy', /if \(timedOut \|\| isTransportError\(failed\)\) \{\s*const copy = await readSavedProjectCrew\(key\);\s*if \(copy\) return resultFromSaved\(copy\);/.test(crew));
  ok('a successful read is saved', /AsyncStorage\.setItem\(key, JSON\.stringify\(savedProjectCrewFrom\(crew, certifications, fetchedAt\)\)\)/.test(crew));
  ok('a cold start begins from the saved copy (placeholderData)', /placeholderData: saved && saved\.key === cacheKey && saved\.value \? resultFromSaved\(saved\.value\) : undefined/.test(crew));
  ok('a revoked seat (or a 42501 refusal) drops the saved copy',
    /if \(!revoked \|\| !cacheKey\) return;\s*void AsyncStorage\.removeItem\(cacheKey\)/.test(crew) && /code === '42501'\) void AsyncStorage\.removeItem\(key\)/.test(crew));
  ok('the state exposes fetchedAt / fromCache / isPaused and keeps the old fields',
    /fetchedAt: string \| null;/.test(crew) && /fromCache: boolean;/.test(crew) && /isPaused: boolean;/.test(crew)
    && /crew: ProjectCrewMember\[\];/.test(crew) && /isLoading: boolean;/.test(crew) && /isError: boolean;/.test(crew) && /refetch: \(\) => void;/.test(crew));
  const tt = src('app/time-tracking.tsx');
  ok('time-tracking drops the copy when the role resolves to none',
    /crewAccessRevoked = !!gateProjectId && !roleState\.isLoading && !roleState\.isError && !roleState\.isPaused && role === null/.test(tt)
    && /useProjectCrew\(gateProjectId, isSeat, \{ revoked: crewAccessRevoked \}\)/.test(tt));
  const offlineAt = tt.indexOf('testID="clock-in-crew-offline"');
  const noCrewAt = tt.indexOf('testID="clock-in-seat-no-crew"');
  ok('offline with nothing saved says so, before any "No crew assigned"', offlineAt > 0 && noCrewAt > offlineAt
    && /projectCrew\.crew\.length === 0 && \(projectCrew\.isPaused \|\| \(projectCrew\.isError && projectCrew\.offline\)\)/.test(tt));
  ok('the saved copy is labelled with its time', /savedCrewLine\(projectCrew\.fetchedAt, projectCrew\.offline \|\| projectCrew\.isPaused\)/.test(tt));
}

console.log('\n#101 closing the rates sheet writes only what he changed:');
{
  ok('"62" and "62.00" are one rate; blank / $0 / junk clear',
    parseRateDraft('62') === 62 && parseRateDraft(' $62.00 ') === 62 && parseRateDraft('') === null && parseRateDraft('0') === null && parseRateDraft('abc') === null);
  const baseline = seedRateDrafts(['framing', 'tile', 'drywall'], { framing: 55, tile: 40 });
  expect('seeded from the book', baseline, { framing: '55', tile: '40', drywall: '' });
  expect('an untouched sheet sends nothing — even after the book moved on', rateDraftBatch(baseline, baseline), {});
  expect('only the edited field is sent', rateDraftBatch({ ...baseline, tile: '45' }, baseline), { tile: 45 });
  expect('a cleared field is sent as a clear', rateDraftBatch({ ...baseline, framing: '' }, baseline), { framing: null });
  expect('retyping the same rate differently is no change', rateDraftBatch({ ...baseline, framing: '55.00' }, baseline), {});
  // The sync lands while the sheet is open: Framing $62 on the account.
  const typed = { ...baseline, tile: '45' };
  const fresh = seedRateDrafts(['framing', 'tile', 'drywall', 'electrical'], { framing: 62, tile: 41, electrical: 70 });
  const moved = reseedUntouchedDrafts(typed, baseline, fresh);
  expect('untouched fields follow the book; his edit stays; a new trade appears',
    moved?.drafts, { framing: '62', tile: '45', drywall: '', electrical: '70' });
  expect('…and closing then writes only his edit — Framing $62 is never rolled back',
    rateDraftBatch(moved!.drafts, moved!.baseline), { tile: 45 });
  ok('nothing to move → null (no re-render)', reseedUntouchedDrafts(baseline, baseline, baseline) === null);
  const tt = src('app/time-tracking.tsx');
  ok('commit sends rateDraftBatch(drafts, baseline)', /setRates\(rateDraftBatch\(rateDrafts, rateBaseline\)\)/.test(tt)
    && !/for \(const \[key, raw\] of Object\.entries\(rateDrafts\)\)/.test(tt));
  ok('opening seeds drafts AND baseline together', /setRateSheet\(\{ drafts, baseline: drafts \}\)/.test(tt));
  ok('while open, a book change re-seeds untouched fields',
    /if \(!showRatesModal\) return;[\s\S]{0,200}reseedUntouchedDrafts\(prev\.drafts, prev\.baseline, fresh\)/.test(tt));
}

console.log('\n#103 a shift deleted elsewhere leaves this device:');
{
  type R = { id: string; projectId: string; seenOnServerAt?: string; v: string };
  const local: R[] = [
    { id: 'gone-elsewhere', projectId: H, seenOnServerAt: '2026-09-10T00:00:00Z', v: 'seen' },
    { id: 'offline-clockin', projectId: H, v: 'never seen' },
    { id: 'legacy', projectId: 'unassigned', seenOnServerAt: '2026-09-10T00:00:00Z', v: 'no job' },
    { id: 'queued', projectId: H, seenOnServerAt: '2026-09-10T00:00:00Z', v: 'queued edit' },
    { id: 'kept', projectId: H, v: 'local' },
  ];
  const server: R[] = [{ id: 'kept', projectId: H, v: 'server' }];
  const pending = new Set(['queued']);
  const merged = P.mergeServerPull(local, server, pending, new Set(), {
    seenAt: '2026-09-18T12:00:00Z', pruneMissing: e => P.timeEntryGoneFromServer(e, pending, true),
  });
  expect('seen-before + gone → dropped; never seen, no-job and queued → kept',
    merged.map(r => r.id).sort(), ['kept', 'legacy', 'offline-clockin', 'queued']);
  ok('rows the server returned are stamped seenOnServerAt', merged.find(r => r.id === 'kept')?.seenOnServerAt === '2026-09-18T12:00:00Z');
  const partial = P.mergeServerPull(local, server, pending, new Set(), {
    seenAt: 'x', pruneMissing: e => P.timeEntryGoneFromServer(e, pending, false),
  });
  ok('an incomplete pull drops nothing', partial.some(r => r.id === 'gone-elsewhere'));
  ok('without options the old merge is unchanged', P.mergeServerPull(local, server, pending, new Set()).length === 5);
  const hook = src('hooks/useTimeEntries.ts');
  const ownPull = hook.slice(hook.indexOf('const queueBefore = await readTimeEntryQueue()'), hook.indexOf("// ── Pull the TEAM's hours"));
  ok('the own pull is paged and complete only on an empty page',
    /\.range\(from, from \+ TEAM_PAGE - 1\)/.test(ownPull) && /if \(rows\.length === 0\) \{ complete = true; break; \}/.test(ownPull));
  ok('it merges with the seen stamp and the complete-pull prune',
    /mergeServerPull\(prev, fromServer, pending, deleted, \{\s*seenAt: pulledAt,\s*pruneMissing: e => timeEntryGoneFromServer\(e, pending, complete\),/.test(ownPull));
  ok('TimeEntry.seenOnServerAt is never sent to the server', !/seen_on_server|seenOnServerAt:/.test(hook.slice(hook.indexOf('function toDB'), hook.indexOf('function toDB') + 900)));
}

console.log('\n#104 every trade Job Costing names is on the rates sheet:');
{
  const tt = src('app/time-tracking.tsx');
  ok('rateTrades offers the foreman\'s trades on his own jobs', /ownedTeam\.forEach\(e => offer\(e\.trade\)\)/.test(tt));
  ok('…and the trade the banner sent him for', /if \(routeRateTrade\) offer\(/.test(tt) && /autoFocus=\{t\.key === focusRateKey\}/.test(tt));
  ok('the feed line counts the costing mirror, never raw team rows',
    /computeLaborStats\(mergeTimeEntriesMirror\(entries, ownedTeam\), rates\)/.test(tt) && !/computeLaborStats\(entries, rates\)/.test(tt));
  ok('openRates=1 opens the sheet once the book has loaded',
    /routeOpenRates !== '1' \|\| !ownTier \|\| ratesLoading\) return;/.test(tt) && /openedFromBannerRef\.current = true;\s*openRatesModal\(\);/.test(tt));
  ok('Job Costing and the Living Estimate pass openRates + the trade',
    /openRates: '1', \.\.\.\(summary\.unpricedTrades\[0\] \? \{ rateTrade: summary\.unpricedTrades\[0\] \} : \{\}\)/.test(src('app/job-costing.tsx'))
    && /openRates: '1', \.\.\.\(unpriced\.trades\[0\] \? \{ rateTrade: unpriced\.trades\[0\] \} : \{\}\)/.test(src('app/living-estimate.tsx')));
}

console.log('\n#105 the screen can be refreshed, and clock-in checks again:');
{
  const tt = src('app/time-tracking.tsx');
  const hook = src('hooks/useTimeEntries.ts');
  ok('a RefreshControl spins until the pulls settle',
    /refreshControl=\{<RefreshControl refreshing=\{userPulling\} onRefresh=\{onPullToRefresh\}/.test(tt) && /await refreshEntries\(\);/.test(tt));
  ok('refresh() resolves when the own + team pulls settle (with a cap)',
    /const refresh = useCallback\(\(\): Promise<void> =>/.test(hook) && /setTimeout\(finish, 20_000\)/.test(hook)
    && (hook.match(/beginPull\(\);/g) ?? []).length === 2 && (hook.match(/\} finally \{\s*endPull\(\);/g) ?? []).length === 2);
  ok('opening Clock In re-pulls', /const openClockInSheet = useCallback\(\(\) => \{[\s\S]{0,300}void refreshEntries\(\);\s*setShowClockInModal\(true\);/.test(tt)
    && /onPress=\{openClockInSheet\}/.test(tt));
  ok('the sheet says when it could not check', /testID="clock-in-pull-failed"/.test(tt) && /pullFailed/.test(hook));
  ok('clocking in a worker already on the clock is a confirm naming who has him',
    /const already = openShiftByWorker\.get\(member\.id\);/.test(tt) && /'Already on the clock'/.test(tt) && /text: 'Clock in again', style: 'destructive', onPress: certCheck/.test(tt));
}

console.log('\n#106 the sentences use the bare name:');
{
  const hook = src('hooks/useTimeEntries.ts');
  ok('one source: teamLoggedByLabel = "Logged by " + teamLoggedByName',
    /export function teamLoggedByName\(e: Pick<TeamTimeEntry, 'loggedByName'>\): string \{\s*return e\.loggedByName\?\.trim\(\) \|\| 'a teammate';/.test(hook)
    && /return `Logged by \$\{teamLoggedByName\(e\)\}`;/.test(hook));
  const tt = src('app/time-tracking.tsx');
  ok('no sentence puts the label before "logged this shift"',
    !/\$\{loggedBy \?\? 'Someone else'\} logged this shift/.test(tt) && !/\$\{correctingTeam\} logged this shift/.test(tt)
    && /\$\{sentenceName\(loggedByName \?\? 'a teammate'\)\} logged this shift/.test(tt) && /\$\{sentenceName\(correctingTeam\)\} logged this shift/.test(tt));
  ok('the note hint and the correction hint read as sentences',
    /\{correctingTeam\}&apos;s note stays as they wrote it/.test(tt) && /This shift was logged by \$\{correctingTeam\}; it stays theirs, only its hours change\./.test(tt));
  ok('the tags keep "Logged by …"', /\{loggedBy \? <Text style=\{styles\.loggedByTag\}/.test(tt) && /\{outFor\.loggedBy \? ` \$\{outFor\.loggedBy\}\.` : ''\}/.test(tt));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
