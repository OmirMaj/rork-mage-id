// utils/subCompliance.ts — what the app is allowed to say about a sub's paperwork.
//
// Pure: types-only imports, no React, so bun can run it under a validator.
//
// NAV-05 (runtime audit 2026-09-06). This logic used to live module-private in
// app/(tabs)/subs/index.tsx, where nothing in the ship-check chain could reach
// it, and it shipped this:
//
//     const licExpiry = sub.licenseExpiry ? new Date(sub.licenseExpiry) : null;
//     const coiExpiry = sub.coiExpiry ? new Date(sub.coiExpiry) : null;
//     if ((licExpiry && licExpiry < now) || ...) return 'expired';
//     if (...within 30 days...) return 'expiring_soon';
//     return 'compliant';          // ← everything else, including "no dates"
//
// A sub with NO licence date and NO COI date fell straight through to the last
// line: a green "Compliant" chip and a +1 on the green Compliant tile, on the
// screen that advertises a COI vault. Production has a sub in exactly that
// state today — 'Trail', whose license_expiry and coi_expiry are EMPTY STRINGS
// (not NULL), which the old `sub.x ? ... : null` read as falsy and skipped.
//
// The app cannot certify insurance it has never seen. Absence of evidence is
// reported as absence of evidence, and it is a FOURTH state, not a shade of the
// green one.
//
// It lives here so scripts/validate-sub-network.ts can pin it. A future edit
// that restores "no dates → compliant" now fails the build instead of quietly
// telling a GC that an uninsured sub is cleared to work.

import type { ComplianceStatus, Subcontractor } from '@/types';

/**
 * The four things the app can say about a sub's paperwork.
 *
 * 'unknown' is deliberately NOT added to the shared `ComplianceStatus` union in
 * types/index.ts: that union describes the three states a DATED document can be
 * in, and other code (prequal, COI vault) reads it expecting exactly those.
 * This is the wider domain-level state.
 */
export type ComplianceState = ComplianceStatus | 'unknown';

/** Days before expiry at which a document starts reading "expiring soon". */
export const COMPLIANCE_WARN_DAYS = 30;

/**
 * Parse a stored expiry into epoch ms, or null when there is nothing usable.
 *
 * Both expiry fields are optional free-text inputs with no validation, so ''
 * (what the phone form writes when the GC skips the field), undefined, and
 * 'next year' all have to land in the same bucket as absent. Without this,
 * `new Date('')` yields an Invalid Date whose every comparison is false — which
 * is precisely how a sub with no paperwork passed both severity checks and came
 * out the far end labelled Compliant.
 */
export function parseExpiry(raw: string | undefined | null): number | null {
  if (!raw || !raw.trim()) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

/** Which of the two tracked documents this sub has no usable date for. */
export function missingComplianceDocs(sub: Subcontractor): { license: boolean; coi: boolean } {
  return {
    license: parseExpiry(sub.licenseExpiry) === null,
    coi: parseExpiry(sub.coiExpiry) === null,
  };
}

/**
 * The rule, in order:
 *   - any date in the past                          → 'expired'
 *   - any date inside COMPLIANCE_WARN_DAYS          → 'expiring_soon'
 *   - a missing/unparseable date on EITHER document → 'unknown'
 *   - both dates present and clear                  → 'compliant'
 *
 * Evidence of a problem outranks missing evidence: an expired COI plus no
 * licence date is 'expired', not 'unknown'. 'compliant' is reachable ONLY when
 * both documents have a real, future, parseable date.
 *
 * @param nowMs injectable so tests are not wall-clock dependent.
 */
export function getComplianceStatus(sub: Subcontractor, nowMs: number = Date.now()): ComplianceState {
  const warnWindow = COMPLIANCE_WARN_DAYS * 24 * 60 * 60 * 1000;
  const licExpiry = parseExpiry(sub.licenseExpiry);
  const coiExpiry = parseExpiry(sub.coiExpiry);

  if ((licExpiry !== null && licExpiry < nowMs) || (coiExpiry !== null && coiExpiry < nowMs)) return 'expired';
  if ((licExpiry !== null && licExpiry - nowMs < warnWindow) ||
      (coiExpiry !== null && coiExpiry - nowMs < warnWindow)) return 'expiring_soon';
  if (licExpiry === null || coiExpiry === null) return 'unknown';
  return 'compliant';
}

/**
 * Chip text. With a `sub` in hand it names the document that is missing, which
 * is the part a GC can act on; "Unknown" on its own is not an instruction.
 */
export function complianceLabel(status: ComplianceState, sub?: Subcontractor): string {
  if (status === 'compliant') return 'Compliant';
  if (status === 'expiring_soon') return 'Expiring Soon';
  if (status === 'unknown') {
    if (!sub) return 'No docs';
    const missing = missingComplianceDocs(sub);
    if (missing.coi && missing.license) return 'No docs';
    return missing.coi ? 'No COI' : 'No license';
  }
  return 'Expired';
}
