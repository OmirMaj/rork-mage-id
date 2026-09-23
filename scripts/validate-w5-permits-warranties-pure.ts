// validate-w5-permits-warranties-pure.ts — wave 5, lane permits-warranties:
// the pure rules behind Warranties, the warranty walk and the permit
// inspection history. Runs the REAL modules, under two time zones.
//
//   #135 warrantyStatus / coiStatus read a bare 'YYYY-MM-DD' end as UTC
//        midnight — "Expired" from 8 pm the evening before (New York) or from
//        noon ON the last day (Auckland). Now a whole local calendar day.
//   #144 one logged claim pinned "Claim open" forever. Now only a claim with
//        no resolvedAt is open; resolved → back on the dates.
//   #136 the walk reminder read only substantialCompletionDate (0 closed jobs
//        in production had one). Now SC ?? closedAt, with the source named.
//   #142 the walk was hard-wired to 12 months of 30 days. Now the GC's months,
//        calendar months, the 90-day look-ahead and -30 days after the REAL end.
//   #143 the walk-in-progress draft codec (key prefix, merge, stale drop).
//   #145 the inspection fold no longer files a 'scheduled' twin for a visit
//        that already has a verdict (nor overwrites that verdict), and a
//        failure logged only in the history is found by openFailedInspection.
//
// The script re-runs itself under TZ=America/New_York and TZ=Pacific/Auckland
// (the zones where a UTC-midnight parse lands on the evening before / at
// midday on the day), and fails if either child fails.
//
// Run: bun run scripts/validate-w5-permits-warranties-pure.ts

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { coiStatus, warrantyStatus } from '../utils/workflowPipelines';
import {
  getUpcomingWarrantyWalks, warrantyWalkScheduleFor, describeWalkTiming, resolveWalkMonths,
  warrantyWalkLabel, warrantyWalkTitle, walkDraftKey, parseWalkDraft, walkDraftIsEmpty, emptyWalkItems,
  WALK_DRAFT_KEY_PREFIX,
} from '../utils/warrantyWalks';
import {
  foldCurrentInspection, openFailedInspection, latestCalledInspection,
} from '../utils/permitInspectionHistory';
import { isAppStorageKey } from '../utils/localCacheKeys';
import type { PermitInspection, Project } from '../types';

const ZONES = ['America/New_York', 'Pacific/Auckland'];

if (!process.env.W5_PW_CHILD) {
  let failed = false;
  for (const tz of ZONES) {
    console.log(`\n══ TZ=${tz} ══`);
    const r = spawnSync(process.execPath, ['run', fileURLToPath(import.meta.url)], {
      env: { ...process.env, TZ: tz, W5_PW_CHILD: '1' },
      stdio: 'inherit',
    });
    if (r.status !== 0) failed = true;
  }
  console.log(failed ? '\nvalidate-w5-permits-warranties-pure: FAILED' : '\nvalidate-w5-permits-warranties-pure: all zones passed');
  process.exit(failed ? 1 : 0);
}

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
/** A LOCAL wall-clock instant in whatever TZ this child runs under. */
const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

// ── #135 · a bare end day covers the whole local day ─────────────────────────
console.log('\n#135 warrantyStatus — the end date is covered through its last local day:');
{
  const w = { endDate: '2026-09-22' };
  const eve = warrantyStatus(w, local(2026, 9, 21, 20, 30));
  eq('8:30 pm the evening before: still expiring, not expired', eve.key, 'expiring_soon');
  eq('…with 1 day left', eve.label, 'Expires in 1d');
  const day = warrantyStatus(w, local(2026, 9, 22, 15, 0));
  eq('3 pm ON the end date: not expired', day.key, 'expiring_soon');
  eq('…and it says "Expires today", never "Expires in 0d"', day.label, 'Expires today');
  eq('11:59 pm on the end date: still covered', warrantyStatus(w, local(2026, 9, 22, 23, 59)).key, 'expiring_soon');
  eq('12:01 am the day after: expired', warrantyStatus(w, local(2026, 9, 23, 0, 1)).key, 'expired');
  eq('31 local days out is active with the 30-day window', warrantyStatus({ endDate: '2026-10-22' }, local(2026, 9, 21, 23, 0)).key, 'active');
  eq('30 local days out is expiring', warrantyStatus({ endDate: '2026-10-21' }, local(2026, 9, 21, 23, 0)).label, 'Expires in 30d');
  // DST: New York falls back Nov 1 2026; Auckland springs forward Sep 27 2026.
  eq('across the NY DST change the count is whole days (Oct 31 → Nov 2 = 2)',
    warrantyStatus({ endDate: '2026-11-02' }, local(2026, 10, 31, 0, 30)).label, 'Expires in 2d');
  eq('across the Auckland DST change too (Sep 26 → Sep 28 = 2)',
    warrantyStatus({ endDate: '2026-09-28' }, local(2026, 9, 26, 23, 30)).label, 'Expires in 2d');
  eq('a rolled-over day (Feb 30) is no date at all, never a March expiry',
    warrantyStatus({ endDate: '2026-02-30' }, local(2026, 1, 1)).key, 'unknown');
  // An ISO instant keeps the instant rule (validate-workflow-pipelines pins it
  // in depth); one case here so a regression in the dispatch shows up too.
  const NOW = local(2026, 9, 21, 12);
  eq('a full ISO instant 12 h in the past is expired (instant rule kept)',
    warrantyStatus({ endDate: new Date(NOW - 12 * 3600000).toISOString() }, NOW).key, 'expired');
}

console.log('\n#135 coiStatus — same calendar-day rule for a bare coverage expiry:');
{
  const c = { coverages: [{ expiresAt: '2026-09-22' }] };
  eq('the evening before: expiring', coiStatus(c, local(2026, 9, 21, 20, 30)).key, 'expiring');
  eq('on the day: "Expires today"', coiStatus(c, local(2026, 9, 22, 15)).label, 'Expires today');
  eq('the day after: expired', coiStatus(c, local(2026, 9, 23, 0, 1)).key, 'expired');
  eq('the earliest coverage still decides (a lapsed day beats a far one)',
    coiStatus({ coverages: [{ expiresAt: '2027-09-22' }, { expiresAt: '2026-09-20' }] }, local(2026, 9, 21)).key, 'expired');
  eq('mixed bare day + instant: the nearer one sets the label',
    coiStatus({ coverages: [{ expiresAt: '2026-09-25' }, { expiresAt: new Date(local(2026, 10, 30)).toISOString() }] }, local(2026, 9, 21, 9)).label,
    'Expires in 4d');
}

// ── #144 · only an unresolved claim is open ──────────────────────────────────
console.log('\n#144 warrantyStatus — resolved claims hand the warranty back to its dates:');
{
  const now = local(2026, 9, 21, 12);
  eq('an open claim reads claimed', warrantyStatus({ endDate: '2027-09-22', claims: [{ id: 'a' }] }, now).key, 'claimed');
  eq('…"Claim open"', warrantyStatus({ endDate: '2027-09-22', claims: [{ id: 'a' }] }, now).label, 'Claim open');
  eq('every claim resolved → active again',
    warrantyStatus({ endDate: '2027-09-22', claims: [{ id: 'a', resolvedAt: '2026-04-02' }] }, now).key, 'active');
  eq('resolved claim + a past end date → expired (not "Claim open" forever)',
    warrantyStatus({ endDate: '2026-09-01', claims: [{ id: 'a', resolvedAt: '2026-04-02' }] }, now).key, 'expired');
  const owed = warrantyStatus({ endDate: '2026-09-01', claims: [{ id: 'a' }, { id: 'b', resolvedAt: '2026-03-01' }] }, now);
  eq('an UNRESOLVED claim past the end is still owed: claimed', owed.key, 'claimed');
  eq('…and says the warranty ended', owed.label, 'Claim open · warranty ended Sep 1, 2026');
  eq('…as a warning', owed.tone, 'warn');
  eq('a blank resolvedAt is not a resolution', warrantyStatus({ endDate: '2027-09-22', claims: [{ id: 'a', resolvedAt: ' ' }] }, now).key, 'claimed');
  eq('void still outranks an open claim', warrantyStatus({ status: 'void', endDate: '2027-09-22', claims: [{ id: 'a' }] }, now).key, 'void');
}

// ── #136 / #142 · the warranty walk ──────────────────────────────────────────
console.log('\n#136/#142 warranty walks — start date, the GC\'s months, calendar months:');
const proj = (over: Partial<Project>): Project => ({
  id: over.id ?? 'p', name: over.name ?? 'Job', status: 'closed', ...over,
} as unknown as Project);
{
  const now = new Date(2026, 8, 23, 12); // Sep 23 2026, local noon
  // Closed ~10.5 months ago, no G704: the walk (12-mo warranty) is due in ~2 weeks.
  const closedOnly = proj({ id: 'c', closedAt: new Date(2025, 10, 8, 15).toISOString() });
  const a = getUpcomingWarrantyWalks([closedOnly], 12, now);
  eq('a job closed without a G704 still gets a walk reminder', a.length, 1);
  eq('…counted from the close date', a[0]?.warrantyStartSource, 'closed');
  eq('…walk due Oct 8 2026 (11 calendar months after Nov 8 2025)', a[0]?.walkDueDate, '2026-10-08');
  ok('…and the banner line says it counts from the close', describeWalkTiming(a[0]!).includes('counted from close date'));
  const both = proj({ id: 'b', closedAt: new Date(2025, 10, 8, 15).toISOString(), substantialCompletionDate: '2025-10-20' });
  const b = warrantyWalkScheduleFor(both, 12, now);
  eq('with both set, substantial completion wins', b?.warrantyStartSource, 'substantial_completion');
  eq('…walk = SC + 11 months', b?.walkDueDate, '2026-09-20');
  ok('…and the banner line does not claim a close-date count', !describeWalkTiming(getUpcomingWarrantyWalks([both], 12, now)[0]!).includes('close'));
  eq('a REOPENED job with a stale closedAt has not started its warranty',
    getUpcomingWarrantyWalks([proj({ id: 'r', status: 'in_progress', closedAt: new Date(2025, 10, 8).toISOString() })], 12, now).length, 0);
  eq('no start date at all → no alert', getUpcomingWarrantyWalks([proj({ id: 'n' })], 12, now).length, 0);
  eq('a logged walk suppresses it', getUpcomingWarrantyWalks([proj({ ...both, warrantyWalkCompletedAt: '2026-09-01T10:00:00Z' })], 12, now).length, 0);

  // 24 months from Jan 31 2026 — the clamped month-end case.
  const sc24 = proj({ id: 'x', substantialCompletionDate: '2026-01-31' });
  const s24 = warrantyWalkScheduleFor(sc24, 24, now);
  eq('24 months from 2026-01-31: walk 2027-12-31', s24?.walkDueDate, '2027-12-31');
  eq('…expires 2028-01-31', s24?.warrantyExpiresAt, '2028-01-31');
  eq('…no alert at month 13 (the old 12-month rule fired here)',
    getUpcomingWarrantyWalks([sc24], 24, new Date(2027, 1, 28, 12)).length, 0);
  eq('…an alert 60 days before the walk', getUpcomingWarrantyWalks([sc24], 24, new Date(2027, 10, 1, 12))[0]?.daysUntilWalk, 60);
  eq('…still flagged 20 days after the REAL expiry', getUpcomingWarrantyWalks([sc24], 24, new Date(2028, 1, 20, 12)).length, 1);
  eq('…dropped 31 days after it', getUpcomingWarrantyWalks([sc24], 24, new Date(2028, 2, 2, 12)).length, 0);
  const s60 = warrantyWalkScheduleFor(proj({ substantialCompletionDate: '2021-11-15' }), 60, now);
  eq('60 months: walk at month 59', s60?.walkDueDate, '2026-10-15');
  eq('…expiry at month 60', s60?.warrantyExpiresAt, '2026-11-15');
  const s3 = warrantyWalkScheduleFor(proj({ substantialCompletionDate: '2026-08-01' }), 3, now);
  eq('3 months or less: walk two weeks before expiry', s3?.walkDueDate, '2026-10-18');
  eq('12 months from 2025-10-23 is due today', getUpcomingWarrantyWalks([proj({ substantialCompletionDate: '2025-10-23' })], 12, now)[0]?.daysUntilWalk, 0);
  eq('…and urgent', getUpcomingWarrantyWalks([proj({ substantialCompletionDate: '2025-10-23' })], 12, now)[0]?.severity, 'urgent');
  const assumed = getUpcomingWarrantyWalks([proj({ substantialCompletionDate: '2025-10-23' })], null, now)[0];
  eq('no warranty set → 12 months, FLAGGED as assumed', [assumed?.warrantyMonths, assumed?.warrantyMonthsAssumed], [12, true]);
  eq('the one-arg call (Home until it passes the months) still works', getUpcomingWarrantyWalks([proj({ substantialCompletionDate: '2025-10-23' })]).length >= 0, true);
  eq('his months are not flagged', resolveWalkMonths(24), { months: 24, assumed: false });
  eq('a nonsense month count falls back, flagged', resolveWalkMonths(0), { months: 12, assumed: true });
  eq('labels: 12 → 11-month, 24 → 23-month, 3 → pre-expiry', [warrantyWalkLabel(12), warrantyWalkLabel(24), warrantyWalkLabel(3)], ['11-month', '23-month', 'pre-expiry']);
  eq('title', warrantyWalkTitle(24), '23-month warranty walk');
  // An SC stored as an instant late in the local evening is still that local day.
  eq('an SC instant names its LOCAL day', warrantyWalkScheduleFor(proj({ substantialCompletionDate: new Date(2025, 9, 20, 22, 30).toISOString() }), 12, now)?.warrantyStartDate, '2025-10-20');
}

// ── #143 · the walk draft codec ──────────────────────────────────────────────
console.log('\n#143 walk draft — key, merge onto today\'s checklist, stale drop:');
{
  const ids = ['a', 'b', 'c'];
  ok('the key has an app prefix (inside the tenant sweep)', isAppStorageKey(walkDraftKey('proj-1')) && WALK_DRAFT_KEY_PREFIX.startsWith('mageid_'));
  const raw = JSON.stringify({
    items: { a: { checked: true, needsAttention: false, notes: '' }, b: { checked: false, needsAttention: true, notes: 'gap at sill' }, gone: { checked: true } },
    overallNotes: 'owner asked about the gutters', updatedAt: '2026-09-20T15:00:00.000Z',
  });
  const d = parseWalkDraft(raw, ids, null);
  eq('ticks and flags restore', [d?.items.a.checked, d?.items.b.needsAttention, d?.items.b.notes], [true, true, 'gap at sill']);
  eq('an item the checklist no longer has is dropped; a new one starts blank', [Object.keys(d?.items ?? {}), d?.items.c], [ids, { checked: false, needsAttention: false, notes: '' }]);
  eq('overall notes restore', d?.overallNotes, 'owner asked about the gutters');
  eq('a draft OLDER than the logged walk is stale', parseWalkDraft(raw, ids, '2026-09-21T09:00:00.000Z'), null);
  ok('a draft started AFTER a logged walk (a re-walk) restores', parseWalkDraft(raw, ids, '2026-09-01T09:00:00.000Z') !== null);
  eq('unreadable JSON is no draft, not a crash', parseWalkDraft('{nope', ids), null);
  eq('an empty draft is no draft', parseWalkDraft(JSON.stringify({ items: {}, overallNotes: '  ', updatedAt: '2026-09-20T15:00:00Z' }), ids), null);
  eq('malformed fields read as empty', parseWalkDraft(JSON.stringify({ items: { a: { checked: 'yes', notes: 5 } }, overallNotes: 'x', updatedAt: '2026-09-20T15:00:00Z' }), ids)?.items.a, { checked: false, needsAttention: false, notes: '' });
  ok('walkDraftIsEmpty: blank walk', walkDraftIsEmpty(emptyWalkItems(ids), ''));
  ok('walkDraftIsEmpty: a note alone is not empty', !walkDraftIsEmpty({ ...emptyWalkItems(ids), a: { checked: false, needsAttention: false, notes: 'x' } }, ''));
}

// ── #145 · the inspection history ────────────────────────────────────────────
console.log('\n#145 inspection history — no twin for a called visit, failures found:');
{
  const row = (over: Partial<PermitInspection>): PermitInspection => ({
    id: 'r', name: 'Rough electrical', scheduledFor: '2026-09-17', result: 'failed',
    notes: 'Box fill at the kitchen island', recordedAt: '2026-09-17T18:00:00.000Z', ...over,
  });
  const logged = [row({})];
  const kept = foldCurrentInspection({
    inspections: logged, status: 'inspection_scheduled', inspectionDate: '2026-09-17', inspectionNotes: '',
    phase: undefined, now: '2026-09-17T19:00:00.000Z', newId: () => 'twin',
  });
  eq('a logged Failed on the booked day + "Keep as scheduled" → no Scheduled twin', kept.map(i => i.id), ['r']);
  const named = foldCurrentInspection({
    inspections: [row({ name: 'Foundation', id: 'f' })], status: 'inspection_scheduled', inspectionDate: '2026-09-17',
    inspectionNotes: '', phase: 'Foundation', now: '2026-09-17T19:00:00.000Z', newId: () => 'twin',
  });
  eq('a same-name head re-saved as scheduled does NOT erase the verdict', [named.length, named[0].result, named[0].notes], [1, 'failed', 'Box fill at the kitchen island']);
  const other = foldCurrentInspection({
    inspections: [row({ name: 'Foundation', id: 'f' })], status: 'inspection_scheduled', inspectionDate: '2026-09-17',
    inspectionNotes: '', phase: 'Framing', now: '2026-09-17T19:00:00.000Z', newId: () => 'framing',
  });
  eq('a DIFFERENT named inspection booked the same day still gets its own row', other.length, 2);

  eq('a failure logged only in the history is open', openFailedInspection(logged, { status: 'inspection_scheduled', inspectionDate: '2026-09-17' })?.id, 'r');
  eq('…also with the permit status still "approved"', openFailedInspection(logged, { status: 'approved' })?.id, 'r');
  eq('a re-inspection booked LATER in the head closes it', openFailedInspection(logged, { status: 'inspection_scheduled', inspectionDate: '2026-09-24' }), null);
  eq('a later scheduled row closes it', openFailedInspection([row({ id: 'n', result: 'scheduled', scheduledFor: '2026-09-24', recordedAt: '2026-09-18T00:00:00Z' }), ...logged]), null);
  eq('a later pass closes it', openFailedInspection([row({ id: 'p', result: 'passed', scheduledFor: '2026-09-24' }), ...logged]), null);
  eq('a newest cancelled row does not hide the failure', openFailedInspection([row({ id: 'x', result: 'cancelled', scheduledFor: '2026-09-18' }), ...logged])?.id, 'r');
  eq('latestCalledInspection skips bookings', latestCalledInspection([row({ id: 's', result: 'scheduled', scheduledFor: '2026-10-01' }), ...logged])?.id, 'r');
  eq('no called rows → null', latestCalledInspection([row({ result: 'scheduled' })]), null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
