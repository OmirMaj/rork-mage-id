// utils/copilot/dateMath.ts — small calendar helpers shared by capabilities
// that compute a future date from a term (warranty expiry, permit expiry).
// Pure; validator-testable.

/** Add whole months to an ISO date (YYYY-MM-DD), clamping the day to the last
 *  day of the target month so a Jan-31 + 1 month lands on Feb 28/29 — NOT
 *  March 3 (which `setUTCMonth` alone produces by overflowing). */
export function addMonths(iso: string, months: number): string {
  const src = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  const day = src.getUTCDate();
  const year = src.getUTCFullYear();
  const month = src.getUTCMonth() + months;
  // Last day of the target month: day 0 of the following month.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const out = new Date(Date.UTC(year, month, Math.min(day, lastDay)));
  return out.toISOString().slice(0, 10);
}
