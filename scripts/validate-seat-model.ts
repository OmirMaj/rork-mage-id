// validate-seat-model.ts — pins per-seat billing.
//
// WHY THIS EXISTS. This decides what a customer is charged. Two failure modes
// matter in opposite directions:
//   • over-count → a GC is billed for seats they don't have. Trust gone.
//   • under-count → the revenue mechanic silently leaks, and per-seat pricing
//     becomes a line on a pricing page that never bills anything.
//
// Pins INTENDED semantics:
//   • FIELD SEATS ARE FREE AND UNLIMITED. This is load-bearing, not a discount:
//     field collaborators produce the labour/daily-report data the cost book
//     learns from. Charging for them taxes the moat. If this test ever fails,
//     someone has made field seats billable — stop and re-read seatModel's
//     header before "fixing" the test.
//   • the account owner never occupies a seat
//   • seats are PER ACCOUNT — one person on six projects is one seat
//   • pending invites hold a seat (otherwise the limit is gamed by not
//     accepting); revoked rows do not
//   • editor-on-one-project + field-on-another = ONE ADMIN seat (higher
//     privilege wins, so a field invite cannot launder a paid seat)
//   • re-inviting an existing seat-holder is free
//   • free tier cannot invite at all
//
// Run via: bun run test:seat-model

import {
  countSeats, seatStatus, previewSeat, isBillableSeat,
  INCLUDED_ADMIN_SEATS, SEAT_PRICE_USD, SEAT_OVERAGE_BILLING_ENABLED, type SeatOccupant,
} from '../utils/seatModel';

let failures = 0;
function check(label: string, cond: boolean) {
  if (!cond) { console.error(`  FAIL: ${label}`); failures++; }
}

const row = (email: string, role: string, status = 'accepted'): SeatOccupant => ({ email, role, status });

// ── the load-bearing rule ───────────────────────────────────────────────────
check('field is NOT billable', !isBillableSeat('field'));
check('editor is billable', isBillableSeat('editor'));
check('viewer is billable', isBillableSeat('viewer'));
check('owner is not billable', !isBillableSeat('owner'));

{
  const c = countSeats([
    row('a@x.com', 'field'), row('b@x.com', 'field'), row('c@x.com', 'field'),
    row('d@x.com', 'field'), row('e@x.com', 'field'),
  ]);
  check('five field collaborators cost 0 admin seats', c.admin === 0);
  check('…and are reported as field seats', c.field === 5);
  const s = seatStatus('pro', c);
  check('five field seats produce no overage', s.overage === 0 && s.overageMonthlyUsd === 0);
}

// ── owner never counts ──────────────────────────────────────────────────────
{
  const c = countSeats([row('gc@x.com', 'owner'), row('pm@x.com', 'editor')]);
  check('owner excluded', c.admin === 1 && c.adminEmails[0] === 'pm@x.com');
}

// ── per-account de-dup ──────────────────────────────────────────────────────
{
  const c = countSeats([
    row('pm@x.com', 'editor'), row('pm@x.com', 'editor'), row('pm@x.com', 'viewer'),
  ]);
  check('same person on 3 projects = 1 seat', c.admin === 1);
}
{
  const c = countSeats([row('PM@X.com', 'editor'), row('pm@x.com', 'editor')]);
  check('email match is case-insensitive', c.admin === 1);
}

// ── privilege wins: a field invite cannot launder a paid seat ───────────────
{
  const c = countSeats([row('pm@x.com', 'field'), row('pm@x.com', 'editor')]);
  check('editor+field same person = 1 ADMIN seat', c.admin === 1 && c.field === 0);
  const c2 = countSeats([row('pm@x.com', 'editor'), row('pm@x.com', 'field')]);
  check('…regardless of row order', c2.admin === 1 && c2.field === 0);
}

// ── pending holds a seat, revoked does not ──────────────────────────────────
{
  const c = countSeats([row('p@x.com', 'editor', 'pending')]);
  check('pending invite holds a seat', c.admin === 1);
  const c2 = countSeats([row('r@x.com', 'editor', 'revoked')]);
  check('revoked does not', c2.admin === 0);
}

// ── allowances + overage maths ──────────────────────────────────────────────
check('free includes 0', INCLUDED_ADMIN_SEATS.free === 0);
check('pro includes 2', INCLUDED_ADMIN_SEATS.pro === 2);
check('business includes 5', INCLUDED_ADMIN_SEATS.business === 5);
check('enterprise includes 15', INCLUDED_ADMIN_SEATS.enterprise === 15);
check('seat price is 15', SEAT_PRICE_USD === 15);

{
  const four = countSeats([
    row('a@x.com', 'editor'), row('b@x.com', 'editor'),
    row('c@x.com', 'viewer'), row('d@x.com', 'viewer'),
  ]);
  const pro = seatStatus('pro', four);
  check('pro 4 used / 2 included → overage 2', pro.overage === 2);
  check('pro overage costs $30', pro.overageMonthlyUsd === 30);
  check('pro remaining is 0', pro.remaining === 0);
  const biz = seatStatus('business', four);
  check('business 4 used / 5 included → no overage', biz.overage === 0);
  check('business has 1 seat left', biz.remaining === 1);
  check('business next seat does not bill', !biz.nextSeatBills);
}

// ── preview: what the GC is told BEFORE inviting ────────────────────────────
{
  const none = countSeats([]);
  const p = previewSeat('pro', none, 'field');
  check('field preview: free + unlimited language', !p.bills && p.addedMonthlyUsd === 0 && /free/i.test(p.message));

  const inside = previewSeat('pro', none, 'editor');
  check('first pro editor does not bill', inside.allowed && !inside.bills);
  check('…and says how many are left', /2 included seats left|2 of 2/i.test(inside.message) || /left/.test(inside.message));

  const two = countSeats([row('a@x.com', 'editor'), row('b@x.com', 'editor')]);
  const third = previewSeat('pro', two, 'editor');
  // THE CLIENT AND SERVER MUST AGREE. project-invite returns 402 past the
  // allowance while metered billing is off, so the client must NOT offer to
  // sell a seat it cannot deliver — it asks for an upgrade instead.
  if (SEAT_OVERAGE_BILLING_ENABLED) {
    check('third pro editor bills', third.bills && third.addedMonthlyUsd === SEAT_PRICE_USD);
    check('…and names the price', third.message.includes('$15'));
  } else {
    check('over allowance is NOT allowed while billing is off', !third.allowed);
    check('…does not claim a charge', !third.bills && third.addedMonthlyUsd === 0);
    check('…points at upgrade', /upgrade/i.test(third.message));
    check('…and reminds them field is free', /field/i.test(third.message));
  }

  const readd = previewSeat('pro', two, 'editor', 'a@x.com');
  check('re-inviting an existing seat-holder is free', !readd.bills && readd.addedMonthlyUsd === 0);
  check('…and stays allowed even at the limit', readd.allowed);

  // Field never blocks, even when every admin seat is spent — the whole point.
  const fieldAtLimit = previewSeat('pro', two, 'field');
  check('field allowed at the admin limit', fieldAtLimit.allowed && !fieldAtLimit.bills);

  const freeTier = previewSeat('free', none, 'editor');
  check('free tier cannot invite admins', !freeTier.allowed);
  const freeField = previewSeat('free', none, 'field');
  check('…but field is still allowed on free', freeField.allowed);
}

// ── empty + junk input is safe ──────────────────────────────────────────────
{
  const c = countSeats([]);
  check('empty: zero admin', c.admin === 0);
  const j = countSeats([row('', 'editor'), row('   ', 'viewer')]);
  check('blank emails ignored', j.admin === 0);
  const s = seatStatus('pro', c);
  check('empty status: no overage, 2 remaining', s.overage === 0 && s.remaining === 2);
}

if (failures > 0) {
  console.error(`\n✗ validate-seat-model: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('✓ validate-seat-model: all checks passed');
