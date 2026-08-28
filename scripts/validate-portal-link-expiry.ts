// validate-portal-link-expiry.ts — pins client portal link lifetime.
//
// WHY THIS EXISTS. A portal link is the GC's face to their customer. Two
// failure modes, both damaging in opposite directions:
//   • a link that dies early → the client hits a wall and chases the
//     contractor, who finds out their portal is broken from an annoyed customer
//   • a link that never warns → same thing, just later
//
// And one that must never happen: existing live portals must not be
// retro-expired by shipping this feature. NULL expires_at means FOREVER, which
// is the state every portal created before today is in.
//
// Pins INTENDED semantics:
//   • null/undefined expiry = 'never', not 'expired'
//   • the 'expiring_soon' warning fires at <= 3 days, so the GC is told while
//     the link still works
//   • an already-lapsed link reports 'expired' with days ELAPSED
//   • junk input (NaN, unparseable string, bad clock) never throws and never
//     silently reports 'active'
//   • a non-positive duration returns null rather than minting a link that is
//     born expired
//
// Run via: bun run test:portal-link-expiry

import {
  linkState,
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
check('never reads as never', /never/i.test(linkState(null, NOW).label));

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
check('null duration = no expiry', expiresAtFromDuration(null, NOW) === null);
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
check('"no expiry" is offered', PORTAL_LINK_DURATION_OPTIONS.includes(null));
check('default is 30 days', DEFAULT_PORTAL_LINK_DURATION_DAYS === 30);
check('default is one of the options', PORTAL_LINK_DURATION_OPTIONS.includes(DEFAULT_PORTAL_LINK_DURATION_DAYS));
check('null duration labels as never-ish', /never|no expiry/i.test(durationLabel(null)));
check('30 labels with the number', durationLabel(30).includes('30'));

if (failures > 0) {
  console.error(`\n✗ validate-portal-link-expiry: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('✓ validate-portal-link-expiry: all checks passed');
