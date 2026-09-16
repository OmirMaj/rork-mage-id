// validate-portal-link-expiry.ts — pins client portal link lifetime.
//
// WHY THIS EXISTS. A portal link is the GC's face to their customer. Two
// failure modes, both damaging in opposite directions:
//   • a link that dies early → the client hits a wall and chases the
//     contractor, who finds out their portal is broken from an annoyed customer
//   • a link that never warns → same thing, just later
//
// And one that must never happen: existing live portals must not be
// retro-expired by shipping this feature. NULL expires_at means OPEN, which
// is the state every portal created before today is in.
//
// UNTIL HANDOVER (2026-09-16). link_duration_days NULL now means the link is
// open for the whole job and closes 30 days after closeout. The app
// (expiresAtForPolicy) and the database (20260916140000 triggers) compute that
// date independently, and the setup screen pushes expires_at on every
// snapshot refresh — so if the two rules drift they overwrite each other.
// This guard EXECUTES the app rule and source-pins the SQL rule.
//
// Pins INTENDED semantics:
//   • null/undefined expiry = open ('never' kind), not 'expired'
//   • until handover: open job → no date; closed job → closedAt + 30 days;
//     'completed' is NOT handover; reopening clears the date; a fixed-duration
//     link keeps its own date whatever the job does
//   • the 'expiring_soon' warning fires at <= 3 days, so the GC is told while
//     the link still works
//   • an already-lapsed link reports 'expired' with days ELAPSED
//   • junk input (NaN, unparseable string, bad clock) never throws and never
//     silently reports 'active'
//   • a non-positive duration returns null rather than minting a link that is
//     born expired
//
// Run via: bun run test:portal-link-expiry

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  linkState,
  expiresAtForPolicy,
  isHandedOver,
  HANDOVER_GRACE_DAYS,
  PORTAL_LINK_UNTIL_HANDOVER,
  expiresAtFromDuration,
  durationLabel,
  EXPIRING_SOON_DAYS,
  DEFAULT_PORTAL_LINK_DURATION_DAYS,
  PORTAL_LINK_DURATION_OPTIONS,
} from '../utils/portalLinkExpiry';

let failures = 0;
function check(label: string, cond: boolean) {
  if (!cond) { console.error(`  FAIL: ${label}`); failures++; }
}

const NOW = Date.parse('2026-08-26T12:00:00.000Z');
const days = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

// ── the rule that protects every existing portal ────────────────────────────
check('null expiry = never (NOT expired)', linkState(null, NOW).kind === 'never');
check('undefined expiry = never', linkState(undefined, NOW).kind === 'never');
check('never has no daysLeft', linkState(null, NOW).daysLeft === null);
check('a dateless link reads as open until handover', /until handover/i.test(linkState(null, NOW).label));
check('…and never as "never expires" (that option is retired)', !/never/i.test(linkState(null, NOW).label));

// ── active ──────────────────────────────────────────────────────────────────
check('30 days out is active', linkState(days(30), NOW).kind === 'active');
check('…with ~30 days left', linkState(days(30), NOW).daysLeft === 30);
check('just past the warning window is active', linkState(days(EXPIRING_SOON_DAYS + 1), NOW).kind === 'active');

// ── expiring soon: warn while it still works ────────────────────────────────
check('exactly at the threshold warns', linkState(days(EXPIRING_SOON_DAYS), NOW).kind === 'expiring_soon');
check('2 days out warns', linkState(days(2), NOW).kind === 'expiring_soon');
check('expiring tomorrow says tomorrow', /tomorrow/i.test(linkState(days(1), NOW).label));
check('expiring today says today', /today/i.test(linkState(days(0.5), NOW).label));

// ── expired ─────────────────────────────────────────────────────────────────
check('yesterday is expired', linkState(days(-1), NOW).kind === 'expired');
check('a week ago is expired', linkState(days(-7), NOW).kind === 'expired');
check('expired reports days ELAPSED (negative)', linkState(days(-7), NOW).daysLeft === -7);
check('expired today reads "today"', /today/i.test(linkState(days(-0.2), NOW).label));
check('no -0 leaks into daysLeft', Object.is(linkState(days(-0.2), NOW).daysLeft, 0));

// ── junk never throws, never silently "active" ──────────────────────────────
check('unparseable string is treated as never, not active',
  linkState('not-a-date', NOW).kind === 'never');
check('NaN clock falls back to the real one (does not report active)',
  linkState(days(-5), Number.NaN).kind === 'expired');
check('epoch-ms input works', linkState(NOW + 5 * 86_400_000, NOW).kind === 'active');
check('Date input works', linkState(new Date(NOW + 5 * 86_400_000), NOW).kind === 'active');

// ── duration → expiry ───────────────────────────────────────────────────────
check('null duration (until handover) mints no date up front', expiresAtFromDuration(null, NOW) === null);
check('30 days produces a future timestamp',
  Date.parse(expiresAtFromDuration(30, NOW) as string) > NOW);
check('…that lands ~30 days out',
  Math.round((Date.parse(expiresAtFromDuration(30, NOW) as string) - NOW) / 86_400_000) === 30);
check('a 0-day duration does NOT mint a born-expired link', expiresAtFromDuration(0, NOW) === null);
check('a negative duration does NOT mint a born-expired link', expiresAtFromDuration(-5, NOW) === null);
check('a NaN duration is refused', expiresAtFromDuration(Number.NaN, NOW) === null);

// round-trip: a link minted for 30 days is active, and one minted for 2 warns
check('round-trip 30d → active', linkState(expiresAtFromDuration(30, NOW), NOW).kind === 'active');
check('round-trip 2d → expiring_soon', linkState(expiresAtFromDuration(2, NOW), NOW).kind === 'expiring_soon');

// ── options + labels ────────────────────────────────────────────────────────
check('until-handover is the null policy', PORTAL_LINK_UNTIL_HANDOVER === null);
check('until-handover is offered', PORTAL_LINK_DURATION_OPTIONS.includes(null));
check('until-handover is offered FIRST', PORTAL_LINK_DURATION_OPTIONS[0] === null);
check('fixed 7 / 30 / 90 stay', [7, 30, 90].every(d => PORTAL_LINK_DURATION_OPTIONS.includes(d)));
check('exactly four options (no separate "never")', PORTAL_LINK_DURATION_OPTIONS.length === 4);
check('default is until handover (not 30 days)', DEFAULT_PORTAL_LINK_DURATION_DAYS === null);
check('default is one of the options', PORTAL_LINK_DURATION_OPTIONS.includes(DEFAULT_PORTAL_LINK_DURATION_DAYS));
check('null duration labels as until handover', /until handover/i.test(durationLabel(null)));
check('no chip says "No expiry" any more', PORTAL_LINK_DURATION_OPTIONS.every(o => !/no expiry|never/i.test(durationLabel(o))));
check('30 labels with the number', durationLabel(30).includes('30'));
check('grace period is 30 days', HANDOVER_GRACE_DAYS === 30);

// ── until handover: the resolver (EXECUTED) ─────────────────────────────────
const CLOSED_AT = '2026-09-01T15:00:00.000Z';
const closedPlus30 = new Date(Date.parse(CLOSED_AT) + 30 * 86_400_000).toISOString();
const policy = (over: Partial<Parameters<typeof expiresAtForPolicy>[0]>) => expiresAtForPolicy({
  linkDurationDays: null, linkExpiresAt: null, projectStatus: 'in_progress', closedAt: null, nowMs: NOW, ...over,
});

for (const status of ['draft', 'estimated', 'in_progress']) {
  check(`open job (${status}) → no expiry`, policy({ projectStatus: status }) === null);
}
check('undefined duration is until handover too', policy({ linkDurationDays: undefined, projectStatus: 'in_progress' }) === null);
check("'completed' is NOT handover — link stays open", policy({ projectStatus: 'completed', closedAt: CLOSED_AT }) === null);
check("isHandedOver('completed') is false", isHandedOver('completed') === false);
check("isHandedOver('closed') is true", isHandedOver('closed') === true);
check('closed job → closedAt + 30 days', policy({ projectStatus: 'closed', closedAt: CLOSED_AT }) === closedPlus30);
check('closed job with no closedAt → now + 30 days',
  policy({ projectStatus: 'closed', closedAt: null }) === new Date(NOW + 30 * 86_400_000).toISOString());
check('closed job with junk closedAt → now + 30 days (never throws)',
  policy({ projectStatus: 'closed', closedAt: 'garbage' }) === new Date(NOW + 30 * 86_400_000).toISOString());
check('closed, no closedAt, already stamped → keeps the stamp (no sliding deadline)',
  policy({ projectStatus: 'closed', closedAt: null, linkExpiresAt: days(12), nowMs: NOW + 5 * 86_400_000 }) === days(12));
check('closedAt beats a stale stamp', policy({ projectStatus: 'closed', closedAt: CLOSED_AT, linkExpiresAt: days(99) }) === closedPlus30);
check('reopened job (was closed, stamp still on the link) → null',
  policy({ projectStatus: 'in_progress', closedAt: CLOSED_AT, linkExpiresAt: closedPlus30 }) === null);
check('fixed 7-day link keeps its own date on an open job',
  policy({ linkDurationDays: 7, linkExpiresAt: days(7), projectStatus: 'in_progress' }) === days(7));
check('fixed 7-day link keeps its own date on a CLOSED job',
  policy({ linkDurationDays: 7, linkExpiresAt: days(7), projectStatus: 'closed', closedAt: CLOSED_AT }) === days(7));
check('fixed 7-day link keeps its own date on a reopened job',
  policy({ linkDurationDays: 7, linkExpiresAt: days(-2), projectStatus: 'in_progress', closedAt: CLOSED_AT }) === days(-2));
check('fixed duration with no stored date stays null (unchanged behaviour)',
  policy({ linkDurationDays: 30, linkExpiresAt: null, projectStatus: 'closed', closedAt: CLOSED_AT }) === null);

// ── until handover: labels ──────────────────────────────────────────────────
const handoverActive = linkState(closedPlus30, Date.parse(CLOSED_AT), { untilHandover: true });
check('closed handover link is active for the grace period', handoverActive.kind === 'active');
check('…labelled with a closing date, not a picked countdown', /^Closes /.test(handoverActive.label) && /handover/i.test(handoverActive.label));
check('…naming the actual month', /Sep|Oct/.test(handoverActive.label));
const handoverSoon = linkState(days(2), NOW, { untilHandover: true });
check('handover link near its end still warns', handoverSoon.kind === 'expiring_soon' && /^Closes /.test(handoverSoon.label));
const handoverGone = linkState(days(-4), NOW, { untilHandover: true });
check('handover link past its date is expired, and says so', handoverGone.kind === 'expired' && /closed/i.test(handoverGone.label) && handoverGone.daysLeft === -4);
check('without the option, labels are unchanged', /^Link active/.test(linkState(days(30), NOW).label));

// ── the database rule (source pins on the migration) ────────────────────────
const MIGRATION = 'supabase/migrations/20260916140000_portal_link_until_handover.sql';
let sql = '';
try { sql = readFileSync(join(__dirname, '..', MIGRATION), 'utf8'); } catch { /* reported below */ }
// Strip `--` comments so prose cannot satisfy a code pin.
const code = sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n').replace(/\s+/g, ' ').toLowerCase();
check('migration file exists', code.length > 0);
check('trigger fires AFTER UPDATE on projects',
  /create trigger projects_portal_link_handover after update of status, closed_at on public\.projects/.test(code));
check('…only when status or closed_at actually changed',
  /when \( ?old\.status is distinct from new\.status or old\.closed_at is distinct from new\.closed_at ?\)/.test(code));
check('closing sets coalesce(closed_at, now()) + 30 days',
  /if new\.status = 'closed' then update public\.portal_snapshots set expires_at = coalesce\(new\.closed_at, now\(\)\) \+ interval '30 days' where project_id = new\.id and link_duration_days is null;/.test(code));
check('reopening clears expires_at, same filter',
  /elsif old\.status = 'closed' then update public\.portal_snapshots set expires_at = null where project_id = new\.id and link_duration_days is null;/.test(code));
check('every UPDATE of portal_snapshots in the migration is filtered to link_duration_days IS NULL',
  (code.match(/update public\.portal_snapshots/g) ?? []).length === 3
  && (code.match(/update public\.portal_snapshots[^;]*link_duration_days is null/g) ?? []).length === 3);
check('snapshot-write trigger leaves fixed-duration rows alone',
  /if new\.link_duration_days is not null then return new;/.test(code));
check('shared rule: only status closed, closed_at + 30 days',
  /when p_status is distinct from 'closed' then null when p_closed_at is not null then p_closed_at \+ interval '30 days'/.test(code));
check("SQL never treats 'completed' as handover", !/'completed'/.test(code));
check('SQL grace matches HANDOVER_GRACE_DAYS', (code.match(/interval '(\d+) days'/g) ?? []).every(m => m === `interval '${HANDOVER_GRACE_DAYS} days'`));
check('functions are SECURITY DEFINER with a pinned search_path',
  (code.match(/security definer set search_path = pg_catalog, public/g) ?? []).length === 2);
check('idempotent: drop trigger if exists before each create',
  /drop trigger if exists projects_portal_link_handover on public\.projects;/.test(code)
  && /drop trigger if exists portal_snapshots_link_expiry_policy on public\.portal_snapshots;/.test(code)
  && !/create function/.test(code));
check('execute revoked from the API roles', (code.match(/revoke execute on function [^;]* from public, anon, authenticated;/g) ?? []).length === 3);
check('includes a backfill for already-closed projects',
  /update public\.portal_snapshots ps set expires_at = ps\.expires_at from public\.projects p where p\.id = ps\.project_id and ps\.link_duration_days is null/.test(code));

// ── the only app path that closes a job ─────────────────────────────────────
// Until-handover links close 30 days after status becomes 'closed', and the one
// place the app sets that is the closeout binder's first delivery. It used to
// skip the question for a 'completed' job, so finished jobs never closed and
// their portal links stayed open forever.
{
  const binder = readFileSync(join(__dirname, '..', 'app/closeout-binder.tsx'), 'utf8')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  const gate = binder.match(/if \(wasFirstDeliver && ([^)]*)\) \{\s*showAlert\(\s*'Mark project as closed\?'/);
  check('closeout binder asks to close on first delivery', !!gate);
  check("…for every job not already closed, 'completed' included",
    !!gate && gate[1].replace(/\s+/g, ' ').trim() === "project.status !== 'closed'");
  check('…and closing stamps closedAt, which the handover date is counted from',
    /ctxUpdateProject\(project\.id, \{ status: 'closed', closedAt: new Date\(\)\.toISOString\(\) \}\)/.test(binder));
}

// ── the GC's reminder email ──────────────────────────────────────────────────
// portal-link-expiry-notice told a GC to "set this portal to never expire" —
// an option retired with this change. A handover link that is closing can only
// be kept open with a fixed duration, so it gets that advice.
{
  const notice = readFileSync(join(__dirname, '..', 'supabase/functions/portal-link-expiry-notice/index.ts'), 'utf8')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  check('expiry notice never offers "never expire"', !/never expire/i.test(notice));
  check('expiry notice reads link_duration_days', /select=portal_id,project_id,expires_at,link_duration_days/.test(notice));
  check('…and gives a closed-out handover link its own advice',
    /untilHandover\s*=\s*p\.link_duration_days == null/.test(notice) && /closed out/.test(notice) && /7, 30 or 90 days/.test(notice));
}

if (failures > 0) {
  console.error(`\n✗ validate-portal-link-expiry: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('✓ validate-portal-link-expiry: all checks passed');
