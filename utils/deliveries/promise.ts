// utils/deliveries/promise.ts — the date a delivery's lateness is SCORED
// against (lane DELIVERIES-1).
//
// THE PROBLEM IT FIXES. utils/supplierScorecard.slipDays read the CURRENT
// expectedDate. A contractor whose windows were promised Nov 12, slipped to
// Dec 1 and arrived Dec 1 edits the date to Dec 1 along the way, and the
// scorecard then saw a load that arrived on its date: the slip was erased by
// the very edit that recorded it.
//
// THE RULE. Score against the ORIGINAL promised date (Delivery.promisedDate:
// the first supplier date recorded, or the supplier date standing when it was
// marked ordered). A delivery with no promisedDate (every delivery from before
// the lane, and every one made with the feature off) is scored against
// expectedDate, exactly as before. A delivery with no date at all has no
// promise and gives no score: "No date yet" is never counted as on time.
//
// No imports from utils/deliverySchedule beyond the type, so
// utils/supplierScorecard can import this without a cycle. Pure.
import type { Delivery } from '@/utils/deliverySchedule';
import { dayOrEmpty } from './calendar';

/** The day the supplier is held to: the original promise, else the current supplier date, else ''. */
export function scoredPromiseDate(d: Pick<Delivery, 'promisedDate' | 'expectedDate'>): string {
  return dayOrEmpty(d.promisedDate) || dayOrEmpty(d.expectedDate);
}
