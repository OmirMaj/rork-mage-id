// validate-building-access.ts — pins the building-access gate.
//
// WHY THIS EXISTS. In an occupied building the binding constraint is the
// building, not the crew. The two failure modes that cost real money:
//   • a delivery with no elevator booked shown as fine → the truck is turned
//     away and the material sits in the street
//   • a slot merely REQUESTED shown as booked → a PM staffs a day the building
//     never granted
//
// Pins INTENDED semantics:
//   • 'requested' is never treated as 'confirmed'
//   • blocking vs warning is a real distinction and must not collapse
//   • a stale denial that was re-requested is not a live conflict
//   • an unassigned slot covers a delivery that day; another delivery's slot does not
//   • settled/out-of-horizon deliveries generate no conflicts
//   • no rules configured → no conflicts (never invent a constraint)
//
// Run via: bun run test:building-access

import {
  findAccessConflicts,
  conflictsForDelivery,
  summarizeAccess,
  requiredKindsForDelivery,
  RESERVATION_CONFIRM_WINDOW_DAYS,
  DEFAULT_BADGE_LEAD_DAYS,
  type BuildingAccessRules,
  type AccessReservation,
} from '../utils/buildingAccess';
import type { Delivery } from '../utils/deliverySchedule';

let failures = 0;
function check(label: string, cond: boolean) {
  if (!cond) { console.error(`  FAIL: ${label}`); failures++; }
}

const NOW = new Date(2026, 7, 26, 10, 0, 0).getTime();
const ymd = (offsetDays: number) => {
  const d = new Date(2026, 7, 26 + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const rules = (over: Partial<BuildingAccessRules> = {}): BuildingAccessRules => ({
  projectId: 'p1',
  requiresFreightElevator: true,
  requiresDockReservation: false,
  requiresCoiOnFile: false,
  requiresBadging: false,
  afterHoursRequiresApproval: false,
  updatedAt: '2026-08-01',
  ...over,
});

const del = (over: Partial<Delivery> = {}): Delivery => ({
  id: 'd1', projectId: 'p1', description: '14 windows', supplier: 'Acme Glass',
  expectedDate: ymd(10), status: 'scheduled',
  createdAt: '2026-08-01', updatedAt: '2026-08-01', ...over,
});

const res = (over: Partial<AccessReservation> = {}): AccessReservation => ({
  id: 'r1', projectId: 'p1', kind: 'freight_elevator', date: ymd(10),
  status: 'confirmed', createdAt: '2026-08-01', updatedAt: '2026-08-01', ...over,
});

// ── no rules means no constraints ───────────────────────────────────────────
{
  // A building with no recorded rules must never manufacture a conflict —
  // most jobs are not in occupied towers.
  check('no rules → no conflicts',
    findAccessConflicts({ rules: null, deliveries: [del()], reservations: [], nowMs: NOW }).length === 0);
  const none = rules({ requiresFreightElevator: false });
  check('a building requiring nothing → no conflicts',
    findAccessConflicts({ rules: none, deliveries: [del()], reservations: [], nowMs: NOW }).length === 0);
  check('requiredKinds is empty when nothing is required', requiredKindsForDelivery(none).length === 0);
}

// ── the core gate: no reservation blocks ────────────────────────────────────
{
  const c = findAccessConflicts({ rules: rules(), deliveries: [del()], reservations: [], nowMs: NOW });
  check('unbooked elevator produces a conflict', c.length === 1);
  check('…and it BLOCKS', c[0].severity === 'blocking');
  check('…of kind no_reservation', c[0].kind === 'no_reservation');
  check('…naming the delivery', c[0].message.includes('14 windows'));
  check('…and tied to the delivery id', c[0].deliveryId === 'd1');
  check('…with an action that says what to do', /book/i.test(c[0].action));
}

// ── requested ≠ confirmed ───────────────────────────────────────────────────
{
  const confirmed = findAccessConflicts({
    rules: rules(), deliveries: [del()], reservations: [res({ status: 'confirmed' })], nowMs: NOW });
  check('a CONFIRMED slot clears the conflict', confirmed.length === 0);

  // Requested, far out: real but not yet worth interrupting anyone.
  const farRequested = findAccessConflicts({
    rules: rules(), deliveries: [del()], reservations: [res({ status: 'requested' })], nowMs: NOW });
  check('a requested slot far out is not yet chased', farRequested.length === 0);

  // Requested, close: chase it.
  const soon = ymd(RESERVATION_CONFIRM_WINDOW_DAYS - 1);
  const nearRequested = findAccessConflicts({
    rules: rules({ buildingContact: 'Dana at Hines' }),
    deliveries: [del({ expectedDate: soon })],
    reservations: [res({ date: soon, status: 'requested' })], nowMs: NOW });
  check('a requested slot inside the window is surfaced', nearRequested.length === 1);
  check('…as a WARNING, not blocking', nearRequested[0].severity === 'warning');
  check('…of kind unconfirmed_reservation', nearRequested[0].kind === 'unconfirmed_reservation');
  check('…naming who to chase', nearRequested[0].action.includes('Dana at Hines'));
}

// ── denial, and stale denial ────────────────────────────────────────────────
{
  const denied = findAccessConflicts({
    rules: rules(), deliveries: [del()], reservations: [res({ status: 'denied' })], nowMs: NOW });
  check('a denied slot blocks', denied.length === 1 && denied[0].kind === 'reservation_denied');
  check('…and says the truck gets turned away', /turned away/i.test(denied[0].action));

  // The PM was denied, then rebooked. The denial is history.
  const rebooked = findAccessConflicts({
    rules: rules(),
    deliveries: [del()],
    reservations: [res({ id: 'r-old', status: 'denied' }), res({ id: 'r-new', status: 'requested' })],
    nowMs: NOW });
  check('a denial that was re-requested is NOT reported as denied',
    !rebooked.some(c => c.kind === 'reservation_denied'));

  const rebookedConfirmed = findAccessConflicts({
    rules: rules(),
    deliveries: [del()],
    reservations: [res({ id: 'r-old', status: 'denied' }), res({ id: 'r-new', status: 'confirmed' })],
    nowMs: NOW });
  check('a denial that was re-confirmed clears entirely', rebookedConfirmed.length === 0);
}

// ── which slots cover which deliveries ──────────────────────────────────────
{
  // A slot booked for the morning generally (no deliveryId) covers the load.
  const unassigned = findAccessConflicts({
    rules: rules(), deliveries: [del()], reservations: [res({ deliveryId: undefined })], nowMs: NOW });
  check('an unassigned slot that day covers the delivery', unassigned.length === 0);

  // A slot booked for a DIFFERENT delivery does not — that elevator is spoken for.
  const otherDelivery = findAccessConflicts({
    rules: rules(), deliveries: [del()], reservations: [res({ deliveryId: 'd-other' })], nowMs: NOW });
  check("another delivery's slot does NOT cover this one", otherDelivery.length === 1);

  // Wrong day.
  const wrongDay = findAccessConflicts({
    rules: rules(), deliveries: [del()], reservations: [res({ date: ymd(11) })], nowMs: NOW });
  check('a slot on the wrong day does not cover', wrongDay.length === 1);

  // Wrong kind: a dock booking is not an elevator booking.
  const wrongKind = findAccessConflicts({
    rules: rules(), deliveries: [del()], reservations: [res({ kind: 'dock' })], nowMs: NOW });
  check('a dock booking does not satisfy an elevator requirement', wrongKind.length === 1);
}

// ── both requirements are checked independently ─────────────────────────────
{
  const both = rules({ requiresFreightElevator: true, requiresDockReservation: true });
  check('two requirements → two kinds', requiredKindsForDelivery(both).length === 2);
  const half = findAccessConflicts({
    rules: both, deliveries: [del()], reservations: [res({ kind: 'freight_elevator' })], nowMs: NOW });
  check('booking only the elevator still flags the dock', half.length === 1);
  check('…and names the dock', /dock/i.test(half[0].message));
}

// ── settled and out-of-horizon deliveries are not access problems ───────────
{
  check('a delivered load generates no conflict',
    findAccessConflicts({ rules: rules(), deliveries: [del({ status: 'delivered' })], reservations: [], nowMs: NOW }).length === 0);
  check('a cancelled load generates no conflict',
    findAccessConflicts({ rules: rules(), deliveries: [del({ status: 'cancelled' })], reservations: [], nowMs: NOW }).length === 0);
  // A load already late belongs to the delivery chase, not access planning —
  // otherwise the same problem is reported twice in two places.
  check('a past-due load is left to the delivery chase',
    findAccessConflicts({ rules: rules(), deliveries: [del({ expectedDate: ymd(-2) })], reservations: [], nowMs: NOW }).length === 0);
  check('beyond the horizon is not yet actionable',
    findAccessConflicts({ rules: rules(), deliveries: [del({ expectedDate: ymd(60) })], reservations: [], horizonDays: 28, nowMs: NOW }).length === 0);
  check('a load with no date does not crash',
    findAccessConflicts({ rules: rules(), deliveries: [del({ expectedDate: '' })], reservations: [], nowMs: NOW }).length === 0);
}

// ── the building's COI ──────────────────────────────────────────────────────
{
  const noCoi = findAccessConflicts({
    rules: rules({ requiresFreightElevator: false, requiresCoiOnFile: true, buildingContact: 'Dana' }),
    deliveries: [del(), del({ id: 'd2' })], reservations: [], nowMs: NOW });
  check('a missing building COI blocks', noCoi.length === 1 && noCoi[0].severity === 'blocking');
  // Reported ONCE, not per delivery — it is a project-level stoppage.
  check('…exactly once, not per delivery', noCoi.filter(c => c.kind === 'coi_not_on_file').length === 1);
  check('…with no deliveryId, since it stops everything', noCoi[0].deliveryId === undefined);
  check('…naming who to send it to', noCoi[0].action.includes('Dana'));

  const hasCoi = findAccessConflicts({
    rules: rules({ requiresFreightElevator: false, requiresCoiOnFile: true, coiOnFileAt: '2026-08-01' }),
    deliveries: [del()], reservations: [], nowMs: NOW });
  check('a COI on file clears it', hasCoi.length === 0);
}

// ── badging lead time ───────────────────────────────────────────────────────
{
  const inside = findAccessConflicts({
    rules: rules({ requiresFreightElevator: false, requiresBadging: true, badgeLeadTimeDays: 7 }),
    deliveries: [del({ expectedDate: ymd(3) })], reservations: [], nowMs: NOW });
  check('work inside the badge lead time warns', inside.length === 1 && inside[0].kind === 'badge_lead_time');
  check('…as a warning (it can still be rushed)', inside[0].severity === 'warning');

  const outside = findAccessConflicts({
    rules: rules({ requiresFreightElevator: false, requiresBadging: true, badgeLeadTimeDays: 7 }),
    deliveries: [del({ expectedDate: ymd(20) })], reservations: [], nowMs: NOW });
  check('outside the lead time does not warn', outside.length === 0);

  const badged = findAccessConflicts({
    rules: rules({ requiresFreightElevator: false, requiresBadging: true, badgeLeadTimeDays: 7 }),
    deliveries: [del({ expectedDate: ymd(3) })],
    reservations: [res({ kind: 'badging', status: 'confirmed' })], nowMs: NOW });
  check('confirmed badging clears the warning', badged.length === 0);

  const dflt = findAccessConflicts({
    rules: rules({ requiresFreightElevator: false, requiresBadging: true }),
    deliveries: [del({ expectedDate: ymd(DEFAULT_BADGE_LEAD_DAYS - 1) })], reservations: [], nowMs: NOW });
  check('a missing lead time falls back to the default', dflt.length === 1);
}

// ── per-row filtering and the summary line ──────────────────────────────────
{
  const all = findAccessConflicts({
    rules: rules({ requiresCoiOnFile: true }),
    deliveries: [del(), del({ id: 'd2', description: 'doors' })],
    reservations: [], nowMs: NOW });
  check('per-delivery filter returns only that row', conflictsForDelivery(all, 'd2').length === 1);
  check('…and excludes the project-level COI', !conflictsForDelivery(all, 'd2').some(c => c.kind === 'coi_not_on_file'));

  check('summary leads with blocking', /will stop work/.test(summarizeAccess(all) ?? ''));
  const warnOnly = findAccessConflicts({
    rules: rules({ requiresFreightElevator: false, requiresBadging: true, badgeLeadTimeDays: 7 }),
    deliveries: [del({ expectedDate: ymd(2) })], reservations: [], nowMs: NOW });
  check('…warnings say chasing, not stopping', /chasing/.test(summarizeAccess(warnOnly) ?? ''));
  check('nothing wrong → no summary line', summarizeAccess([]) === null);
  check('singular reads correctly', /1 building issue/.test(
    summarizeAccess(findAccessConflicts({ rules: rules(), deliveries: [del()], reservations: [], nowMs: NOW })) ?? ''));
}

// ── empty input is safe ─────────────────────────────────────────────────────
{
  check('no deliveries → no conflicts',
    findAccessConflicts({ rules: rules(), deliveries: [], reservations: [], nowMs: NOW }).length === 0);
}

if (failures > 0) {
  console.error(`\n✗ validate-building-access: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('✓ validate-building-access: all checks passed');
