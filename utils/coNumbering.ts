// utils/coNumbering.ts — the ONE place a device proposes a change-order number.
//
// Wave 4 (#77 / #141): the number a device computes is PROVISIONAL. It is the
// highest number in THIS device's list + 1, and the list can be stale (the
// phone offline on site while the web app writes a CO on the same job). The
// server now owns the number — 20260920050000_change_order_numbers.sql keeps
// the proposed number when no other CO of the project holds it and moves a
// collider to max + 1 — and the CO screen shows "(pending #)" until it has read
// the server's number back (hooks/useServerChangeOrderNumber.ts).
//
// Every writer of a new CO goes through here: app/change-order.tsx,
// utils/fieldTicketCore.ts (a signed field ticket → CO) and
// utils/brain/leakCoDraft.ts (the leak sweep). components/UniversalMicButton
// computes the same rule inline (another lane's file); the server trigger
// covers it either way.
//
// Pure — no React, no storage.

/**
 * max(existing) + 1, NOT length + 1: deleting a CO out of the middle would
 * otherwise reissue an already-used number. A CO with no number (legacy row)
 * counts as 0, never NaN.
 */
export function nextChangeOrderNumber(existing: readonly { number?: number | null }[]): number {
  return existing.reduce((max, c) => {
    const n = typeof c.number === 'number' && Number.isFinite(c.number) ? c.number : 0;
    return Math.max(max, n);
  }, 0) + 1;
}
