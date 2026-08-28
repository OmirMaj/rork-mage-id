// deliverySchedule.ts — what is arriving, when, and what is already late.
//
// THE GAP. The app could record that a delivery HAPPENED (public.delivery_receipts
// — BOL photo, signature, damage notes) but never that one was DUE. Commitment
// carries amount / changeAmount / paidToDate / signedDate and no expected date,
// so nothing could answer the two questions a PM asks every Monday:
//
//   "What is arriving this week?"      — the look-ahead
//   "What was supposed to be here?"    — the chase
//
// A missed delivery is not a paperwork problem. Material that does not land is a
// crew standing around, and the cost shows up as labour, not as a late PO. That
// is why this sits next to the chase list rather than inside purchasing.
//
// ── WHY 'confirmed' IS A SEPARATE STATE FROM 'scheduled' ────────────────────
// A date a GC typed from a quote is a guess. A date the supplier confirmed is a
// commitment you can plan a crew around. Collapsing them would make the
// look-ahead lie in the most expensive direction — telling a PM to staff a day
// that was never real. Anything unconfirmed inside the confirm window is
// surfaced for chasing, which is the whole point.
//
// Pure — no storage, no network, no AI. Pinned by test:delivery-schedule.

/** Where a delivery is in its life. */
export type DeliveryStatus =
  /** A date exists but the supplier has not confirmed it. */
  | 'scheduled'
  /** Supplier confirmed. Plan crew around this one. */
  | 'confirmed'
  /** Materials received (a delivery_receipt exists). */
  | 'delivered'
  /** The GC cancelled or the order was voided. */
  | 'cancelled';

export interface Delivery {
  id: string;
  projectId: string;
  /** What is coming, in the GC's words ("14 windows", "roof trusses"). */
  description: string;
  supplier: string;
  /** Links the delivery to the PO/subcontract that bought it. Optional — plenty
   *  of deliveries are ordered before anyone writes a commitment. */
  commitmentId?: string;
  poNumber?: string;
  /** Date it is expected on site (YYYY-MM-DD). */
  expectedDate: string;
  /** Arrival window, when the supplier or building gives one ("07:00-11:00").
   *  Matters in occupied buildings where a dock slot is the constraint. */
  window?: string;
  status: DeliveryStatus;
  /** Set when the supplier confirms — the moment 'scheduled' becomes real. */
  confirmedAt?: string;
  /** Set when it lands; pairs with a delivery_receipt. */
  deliveredAt?: string;
  /** Where it goes / who receives it. */
  location?: string;
  receivedBy?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** Inside this many days, an unconfirmed delivery needs chasing. */
export const CONFIRM_WINDOW_DAYS = 5;

/** Look-ahead horizons the UI offers. Mirrors the schedule look-aheads. */
export const LOOKAHEAD_DAYS = [7, 14, 28] as const;
export type LookaheadDays = (typeof LOOKAHEAD_DAYS)[number];

/** Parse a YYYY-MM-DD (or ISO) date to LOCAL midnight.
 *  new Date('2026-08-26') parses as UTC midnight, which is the previous day in
 *  every western timezone — a delivery would read as late a day early. */
export function parseLocalDate(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const s = iso.trim();
  if (!s) return null;
  const ymd = s.slice(0, 10);
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isFinite(d.getTime()) ? d.getTime() : null;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

const DAY_MS = 86_400_000;

/** Local midnight for a timestamp — so "days until" counts calendar days, not
 *  24-hour blocks. A delivery due tomorrow at 08:00 is 1 day out, not 0. */
function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Calendar days until the expected date. Negative = that many days late. */
export function daysUntil(expectedDate: string, nowMs: number = Date.now()): number | null {
  const exp = parseLocalDate(expectedDate);
  if (exp === null) return null;
  return Math.round((startOfLocalDay(exp) - startOfLocalDay(nowMs)) / DAY_MS);
}

export type DeliveryFlag =
  /** Past its date and never received. The crew is waiting. */
  | 'late'
  /** Due inside the confirm window and the supplier has not confirmed. */
  | 'unconfirmed'
  /** Confirmed and imminent — show it, do not chase it. */
  | 'due_soon'
  /** Nothing to do yet. */
  | 'ok';

export interface DeliveryView {
  delivery: Delivery;
  daysOut: number | null;
  flag: DeliveryFlag;
  /** One line for a list row. */
  label: string;
}

/**
 * Classify one delivery. Order matters: LATE outranks unconfirmed, because a
 * delivery that has already missed its date is a today problem regardless of
 * whether anyone confirmed it.
 */
export function classifyDelivery(d: Delivery, nowMs: number = Date.now()): DeliveryView {
  const daysOut = daysUntil(d.expectedDate, nowMs);

  // Settled states are never flagged — a delivered or cancelled order is not work.
  if (d.status === 'delivered' || d.status === 'cancelled') {
    return { delivery: d, daysOut, flag: 'ok', label: d.status === 'delivered' ? 'Delivered' : 'Cancelled' };
  }

  if (daysOut === null) {
    return { delivery: d, daysOut: null, flag: 'ok', label: 'No date set' };
  }

  if (daysOut < 0) {
    const late = -daysOut;
    return {
      delivery: d,
      daysOut,
      flag: 'late',
      label: `${late} ${late === 1 ? 'day' : 'days'} late`,
    };
  }

  if (d.status !== 'confirmed' && daysOut <= CONFIRM_WINDOW_DAYS) {
    return {
      delivery: d,
      daysOut,
      flag: 'unconfirmed',
      label: daysOut === 0
        ? 'Due today — not confirmed'
        : `Due in ${daysOut}d — not confirmed`,
    };
  }

  if (daysOut <= CONFIRM_WINDOW_DAYS) {
    return {
      delivery: d,
      daysOut,
      flag: 'due_soon',
      label: daysOut === 0 ? 'Arriving today' : daysOut === 1 ? 'Arriving tomorrow' : `Arriving in ${daysOut}d`,
    };
  }

  return { delivery: d, daysOut, flag: 'ok', label: `Expected in ${daysOut}d` };
}

export interface DeliveryLookahead {
  /** Everything inside the horizon, soonest first. */
  upcoming: DeliveryView[];
  /** Past due and not received — the chase list. Most overdue first. */
  late: DeliveryView[];
  /** Inside the confirm window with no supplier confirmation. */
  unconfirmed: DeliveryView[];
  counts: { upcoming: number; late: number; unconfirmed: number };
}

/**
 * The Monday-morning view: what is coming in the next `days`, what is already
 * late, and what nobody has confirmed.
 *
 * `late` is NOT bounded by the horizon — a delivery three weeks overdue is more
 * urgent than one due Friday, and dropping it because it fell out of a 7-day
 * window is exactly how it stays forgotten.
 */
export function buildLookahead(
  deliveries: Delivery[],
  days: number = 7,
  nowMs: number = Date.now(),
): DeliveryLookahead {
  const views = deliveries.map(d => classifyDelivery(d, nowMs));

  const late = views
    .filter(v => v.flag === 'late')
    .sort((a, b) => (a.daysOut ?? 0) - (b.daysOut ?? 0));

  const inHorizon = views.filter(
    v => v.flag !== 'late'
      && v.delivery.status !== 'delivered'
      && v.delivery.status !== 'cancelled'
      && v.daysOut !== null
      && v.daysOut >= 0
      && v.daysOut <= days,
  ).sort((a, b) => (a.daysOut ?? 0) - (b.daysOut ?? 0));

  const unconfirmed = views
    .filter(v => v.flag === 'unconfirmed')
    .sort((a, b) => (a.daysOut ?? 0) - (b.daysOut ?? 0));

  return {
    upcoming: inHorizon,
    late,
    unconfirmed,
    counts: { upcoming: inHorizon.length, late: late.length, unconfirmed: unconfirmed.length },
  };
}

/** Plain-English summary for a dashboard tile or an AI answer. */
export function summarizeLookahead(l: DeliveryLookahead, days: number): string {
  if (l.counts.late > 0) {
    const n = l.counts.late;
    return `${n} ${n === 1 ? 'delivery is' : 'deliveries are'} late`;
  }
  if (l.counts.unconfirmed > 0) {
    const n = l.counts.unconfirmed;
    return `${n} ${n === 1 ? 'delivery needs' : 'deliveries need'} confirming`;
  }
  if (l.counts.upcoming === 0) return `Nothing scheduled in the next ${days} days`;
  const n = l.counts.upcoming;
  return `${n} ${n === 1 ? 'delivery' : 'deliveries'} in the next ${days} days`;
}
