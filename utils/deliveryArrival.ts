// ============================================================================
// utils/deliveryArrival.ts — "It's here now": a delivery nobody logged, in
// one sheet (UX wave, Lane B6).
//
// "A truck shows up that nobody logged and it's two forms and seven fields.
// 'Received by' is blank. I can't photo the ticket." One sheet now: What,
// Supplier (recent chips), a ticket photo, Received by (his name, editable),
// and the day (a picker). Saving writes the delivery AND its receipt together
// — the delivery born 'delivered' and linked to the receipt, the receipt
// linked back — so the look-ahead, the receiving log and the daily report's
// Materials line (receiptLinesForDay reads the delivery's description through
// deliveryId) tell one story.
//
// Nothing is guessed: the day is the one on the picker, the supplier is what
// he typed or tapped, "received by" is the signed-in user's own name unless he
// changes it. A scanned ticket pre-fills the sheet (scanRouting.
// deliveryArrivalFromScan) and the sheet says so ("from scan, check it").
//
// A load that WAS expected is not a new delivery: when an open delivery from
// the same supplier is due or late, the sheet offers "Mark this one received"
// (lateMatchForSupplier) instead of creating a duplicate.
//
// Pure. scripts/validate-ux-lane-b.ts runs it under bun.
// ============================================================================

import type { Delivery, DeliveryReceipt } from '@/utils/deliverySchedule';
import { parseCalendarDay } from '@/utils/calendarDate';

// ── The supplier scorecard (fix round 1) ────────────────────────────────────
// utils/supplierScorecard reads a delivery's expectedDate as the supplier's
// PROMISE and deliveredAt as the day it actually came. A load nobody logged
// was never promised a day, so it must not score as "on time" — and a
// back-dated arrival must not score as late by the days he back-dated.
//
// What this module can do on its own (the scorecard is not a Lane B file):
//  - deliveredAt is the PICKED day (its first 10 characters are that day,
//    which is how the scorecard's parseLocalDate reads it), never the save time.
//  - expectedDate stays that same day: public.deliveries.expected_date is
//    `date not null`, so an empty promise would make the queued insert fail
//    forever. The promise it carries is therefore marked as not-a-promise by
//    isUnplannedArrival below: the row was created at or after the moment it
//    was delivered, so nobody promised anything in advance. The scorecard
//    honouring that one predicate is an orchestrator item.

export interface ArrivalDraft {
  what: string;
  supplier: string;
  receivedBy: string;
  /** YYYY-MM-DD, local. */
  date: string;
  /** The ticket photo: a durable storage path when one could be computed, else the device URI. */
  ticketUri?: string | null;
  poNumber?: string | null;
  notes?: string | null;
}

const fold = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** YYYY-MM-DD of an instant, in LOCAL time. */
export function localDayOf(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

export const ARRIVAL_DAY_FUTURE = "That day hasn't come yet. Pick today or an earlier day.";

/** Why this can't be the day it arrived, or null. `today` is the local
 *  YYYY-MM-DD; a scanned ticket dated tomorrow is refused, not saved. */
export function arrivalDayProblem(date: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !parseCalendarDay(date)) return 'Pick the day it arrived.';
  if (/^\d{4}-\d{2}-\d{2}$/.test(today) && date > today) return ARRIVAL_DAY_FUTURE;
  return null;
}

/** Why the sheet can't save yet, or null. */
export function arrivalProblem(d: Pick<ArrivalDraft, 'what' | 'supplier' | 'date'>, today: string): string | null {
  if (!d.what.trim()) return 'Say what arrived.';
  if (!d.supplier.trim()) return 'Name the supplier.';
  return arrivalDayProblem(d.date, today);
}

/**
 * The deliveredAt for a load that landed on `day` (YYYY-MM-DD, local), saved
 * at `now`. Its first 10 characters are always `day` — the scorecard's
 * parseLocalDate reads exactly those. The real instant when that holds (a load
 * logged the day it came, before the UTC date rolls over), otherwise midday
 * UTC of that day, which is the same calendar day from UTC-11 to UTC+11.
 */
export function deliveredAtFor(day: string, now: Date): string {
  const iso = now.toISOString();
  return iso.slice(0, 10) === day ? iso : `${day}T12:00:00.000Z`;
}

/**
 * A delivery that was logged at or after the moment it was delivered — "It's
 * here now" — was never promised a day in advance. Its expectedDate is only
 * there because the column is not null; a scorecard must read no promise, no
 * slip and no confirmation from it. False for a load that was scheduled first
 * and received later.
 */
export function isUnplannedArrival(d: Pick<Delivery, 'status' | 'deliveredAt' | 'createdAt'>): boolean {
  if (d.status !== 'delivered' || !d.deliveredAt || !d.createdAt) return false;
  const created = Date.parse(d.createdAt);
  const delivered = Date.parse(d.deliveredAt);
  return Number.isFinite(created) && Number.isFinite(delivered) && created >= delivered;
}

/** The delivery and its receipt, linked both ways. Throws on an invalid draft
 *  (the sheet disables Save first — this is the belt). */
export function buildArrival(input: {
  projectId: string;
  draft: ArrivalDraft;
  now: Date;
  deliveryId: string;
  receiptId: string;
}): { delivery: Delivery; receipt: DeliveryReceipt } {
  const problem = arrivalProblem(input.draft, localDayOf(input.now));
  if (problem) throw new Error(problem);
  const iso = input.now.toISOString();
  const d = input.draft;
  const receivedBy = d.receivedBy.trim() || 'Site';
  const po = d.poNumber?.trim() || undefined;
  const receipt: DeliveryReceipt = {
    id: input.receiptId,
    projectId: input.projectId,
    deliveryId: input.deliveryId,
    date: d.date,
    supplier: d.supplier.trim(),
    poNumber: po,
    // What he said arrived, as one line — the receipt witnesses the load; it
    // does not pretend to an itemized count nobody took.
    items: [{ description: d.what.trim() }],
    bolPhotoUri: d.ticketUri?.trim() || undefined,
    hasDamage: false,
    receivedAt: iso,
    receivedBy,
    notes: d.notes?.trim() || undefined,
    createdAt: iso,
    updatedAt: iso,
  };
  const delivery: Delivery = {
    id: input.deliveryId,
    projectId: input.projectId,
    description: d.what.trim(),
    supplier: d.supplier.trim(),
    poNumber: po,
    // It was never promised a day. The column is `date not null`, so it holds
    // the day it landed; isUnplannedArrival (created at/after delivered) is
    // what tells the scorecard there was no promise.
    expectedDate: d.date,
    status: 'delivered',
    // The PICKED day, not the save time: a back-dated load is not "late".
    deliveredAt: deliveredAtFor(d.date, input.now),
    receiptId: input.receiptId,
    receivedBy,
    createdAt: iso,
    updatedAt: iso,
  };
  return { delivery, receipt };
}

/**
 * The open delivery from this supplier that is due today or late — the one
 * the truck probably is. Oldest first; null when there is none (or the
 * supplier is blank). Delivered and cancelled loads are never offered.
 */
export function lateMatchForSupplier(
  deliveries: readonly Delivery[],
  projectId: string | null | undefined,
  supplier: string | null | undefined,
  today: string,
): Delivery | null {
  const s = fold(supplier);
  if (!projectId || !s) return null;
  const hits = deliveries
    .filter(d => d.projectId === projectId && fold(d.supplier) === s)
    .filter(d => d.status !== 'delivered' && d.status !== 'cancelled')
    .filter(d => (d.expectedDate ?? '').slice(0, 10) !== '' && (d.expectedDate ?? '').slice(0, 10) <= today)
    .sort((a, b) => (a.expectedDate ?? '').localeCompare(b.expectedDate ?? ''));
  return hits[0] ?? null;
}

/** "from scan, check it" — the label on a field the scan filled. */
/** The gallery tag a delivery-ticket photo is filed under ("It's here now").
 *  A supplier's ticket can carry his pricing, so anything that sends photos
 *  OUT in one tap (the daily report's "Add today's N job photos") skips it;
 *  he can still attach it by hand. */
export const DELIVERY_TICKET_TAG = 'Delivery ticket';

export const FROM_SCAN_LABEL = 'from scan, check it';
