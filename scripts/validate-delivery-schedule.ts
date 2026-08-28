// validate-delivery-schedule.ts — pins the delivery look-ahead.
//
// WHY THIS EXISTS. A delivery that does not land is a crew standing around, and
// the cost lands as labour rather than as a late PO — which is why nobody
// notices until payroll. Two failure modes matter:
//   • a late delivery that drops out of the view → it stays forgotten, which is
//     the exact failure this feature exists to prevent
//   • an unconfirmed date shown as if it were real → a PM staffs a day that was
//     never going to happen
//
// Pins INTENDED semantics:
//   • dates parse at LOCAL midnight (the UTC trap would make deliveries read
//     late a day early in every western timezone)
//   • 'late' outranks 'unconfirmed' — a missed date is a today problem
//   • late items are NOT bounded by the look-ahead horizon
//   • delivered/cancelled are never flagged as work
//   • an unconfirmed date inside the confirm window is surfaced for chasing;
//     a confirmed one is not
//   • day counting is CALENDAR days, not 24-hour blocks
//
// Run via: bun run test:delivery-schedule

import {
  classifyDelivery,
  buildLookahead,
  summarizeLookahead,
  daysUntil,
  parseLocalDate,
  CONFIRM_WINDOW_DAYS,
  type Delivery,
} from '../utils/deliverySchedule';

let failures = 0;
function check(label: string, cond: boolean) {
  if (!cond) { console.error(`  FAIL: ${label}`); failures++; }
}

// A fixed local "now": 2026-08-26, mid-morning.
const NOW = new Date(2026, 7, 26, 10, 0, 0).getTime();
const ymd = (offsetDays: number) => {
  const d = new Date(2026, 7, 26 + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const mk = (over: Partial<Delivery>): Delivery => ({
  id: 'd1', projectId: 'p1', description: '14 windows', supplier: 'Acme Glass',
  expectedDate: ymd(3), status: 'scheduled',
  createdAt: '2026-08-01', updatedAt: '2026-08-01', ...over,
});

// ── the timezone trap ───────────────────────────────────────────────────────
{
  // '2026-08-26' must be LOCAL midnight. Parsed as UTC it would be Aug 25
  // locally in the Americas, making a delivery due today read as 1 day late.
  const parsed = parseLocalDate('2026-08-26');
  const local = new Date(2026, 7, 26).getTime();
  check('YYYY-MM-DD parses at local midnight', parsed === local);
  check('a delivery due today is 0 days out, not -1', daysUntil(ymd(0), NOW) === 0);
}

// ── calendar days, not 24h blocks ───────────────────────────────────────────
{
  // NOW is 10:00. Tomorrow's date is 1 day out even though it is only 14 hours
  // away at midnight.
  check('tomorrow is 1 day out', daysUntil(ymd(1), NOW) === 1);
  check('yesterday is -1', daysUntil(ymd(-1), NOW) === -1);
  check('junk date returns null', daysUntil('not-a-date', NOW) === null);
}

// ── late outranks unconfirmed ───────────────────────────────────────────────
{
  const overdueUnconfirmed = mk({ expectedDate: ymd(-3), status: 'scheduled' });
  const v = classifyDelivery(overdueUnconfirmed, NOW);
  check('an overdue unconfirmed delivery flags LATE, not unconfirmed', v.flag === 'late');
  check('…and says how late', v.label.includes('3 days late'));
  check('1 day late is singular', classifyDelivery(mk({ expectedDate: ymd(-1) }), NOW).label.includes('1 day late'));
}

// ── unconfirmed inside the window is chased; confirmed is not ───────────────
{
  const soonUnconfirmed = mk({ expectedDate: ymd(2), status: 'scheduled' });
  check('unconfirmed inside the window is flagged', classifyDelivery(soonUnconfirmed, NOW).flag === 'unconfirmed');
  const soonConfirmed = mk({ expectedDate: ymd(2), status: 'confirmed' });
  check('confirmed inside the window is due_soon, not chased', classifyDelivery(soonConfirmed, NOW).flag === 'due_soon');
  check('confirmed tomorrow reads "tomorrow"', classifyDelivery(mk({ expectedDate: ymd(1), status: 'confirmed' }), NOW).label.includes('tomorrow'));
  const far = mk({ expectedDate: ymd(CONFIRM_WINDOW_DAYS + 5), status: 'scheduled' });
  check('unconfirmed beyond the window is not yet chased', classifyDelivery(far, NOW).flag === 'ok');
}

// ── settled states are never work ───────────────────────────────────────────
{
  check('delivered is never flagged, even if the date passed',
    classifyDelivery(mk({ expectedDate: ymd(-9), status: 'delivered' }), NOW).flag === 'ok');
  check('cancelled is never flagged',
    classifyDelivery(mk({ expectedDate: ymd(-9), status: 'cancelled' }), NOW).flag === 'ok');
  check('a delivery with no date does not crash or flag',
    classifyDelivery(mk({ expectedDate: '' }), NOW).flag === 'ok');
}

// ── the look-ahead ──────────────────────────────────────────────────────────
{
  const deliveries: Delivery[] = [
    mk({ id: 'late-old', expectedDate: ymd(-21), status: 'scheduled' }),
    mk({ id: 'late-new', expectedDate: ymd(-2), status: 'scheduled' }),
    mk({ id: 'soon', expectedDate: ymd(2), status: 'confirmed' }),
    mk({ id: 'unconf', expectedDate: ymd(4), status: 'scheduled' }),
    mk({ id: 'far', expectedDate: ymd(20), status: 'scheduled' }),
    mk({ id: 'done', expectedDate: ymd(-5), status: 'delivered' }),
  ];
  const wk = buildLookahead(deliveries, 7, NOW);

  check('7-day horizon holds the two inside it', wk.counts.upcoming === 2);
  check('…soonest first', wk.upcoming[0].delivery.id === 'soon');
  check('both late items are surfaced', wk.counts.late === 2);
  // The 21-day-late item is OUTSIDE a 7-day horizon; dropping it is how it
  // stays forgotten, which is the failure this feature exists to stop.
  check('a 21-day-late delivery is NOT dropped by a 7-day horizon',
    wk.late.some(v => v.delivery.id === 'late-old'));
  check('most overdue first', wk.late[0].delivery.id === 'late-old');
  check('delivered is excluded from upcoming', !wk.upcoming.some(v => v.delivery.id === 'done'));
  check('far-future is outside the 7-day horizon', !wk.upcoming.some(v => v.delivery.id === 'far'));
  check('unconfirmed bucket catches the un-confirmed one', wk.unconfirmed.some(v => v.delivery.id === 'unconf'));

  const month = buildLookahead(deliveries, 28, NOW);
  check('28-day horizon pulls the far one in', month.upcoming.some(v => v.delivery.id === 'far'));
}

// ── summary copy leads with the worst thing ─────────────────────────────────
{
  const late = buildLookahead([mk({ expectedDate: ymd(-1) })], 7, NOW);
  check('summary leads with late', /late/i.test(summarizeLookahead(late, 7)));
  const unconf = buildLookahead([mk({ expectedDate: ymd(2) })], 7, NOW);
  check('…then unconfirmed', /confirm/i.test(summarizeLookahead(unconf, 7)));
  const clear = buildLookahead([], 7, NOW);
  check('empty says nothing scheduled', /nothing scheduled/i.test(summarizeLookahead(clear, 7)));
  const ok = buildLookahead([mk({ expectedDate: ymd(3), status: 'confirmed' })], 7, NOW);
  check('otherwise counts the upcoming', /1 delivery in the next 7 days/.test(summarizeLookahead(ok, 7)));
}

// ── empty input is safe ─────────────────────────────────────────────────────
{
  const l = buildLookahead([], 7, NOW);
  check('empty: no upcoming', l.counts.upcoming === 0);
  check('empty: no late', l.counts.late === 0);
}

if (failures > 0) {
  console.error(`\n✗ validate-delivery-schedule: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('✓ validate-delivery-schedule: all checks passed');
