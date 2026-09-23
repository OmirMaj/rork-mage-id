// Verified-badge derivation. A raw scan is NOT verification — the GC must
// confirm the extracted fields in the review step. computeIdVerified is the
// gate the ID-scan save path calls; verifiedBadge renders a persisted record.
//
// Pure: imports only utils/calendarDate (no react-native / storage / network),
// so scripts/validate-crew.ts and validate-w5-crew-* exercise it directly.
import { parseCalendarDay, todayCalendarDay, formatCalendarDay } from '../calendarDate';
import type { CertExpiryStatus } from './certExpiry';

export function computeIdVerified(params: { scanCompleted: boolean; userConfirmed: boolean }): boolean {
  return params.scanCompleted && params.userConfirmed;
}

export type IdBadge = 'id_verified' | 'id_expired' | 'unverified';

/** Badge for a stored CrewMember. 'id_verified' only when the record both
 *  carries the verified flag AND has a masked-last4 (proof a scan happened).
 *
 *  'id_expired' (#165): the ID's own expiry is a calendar day BEFORE today.
 *  "ID Verified" used to outlive the card — the badge never looked at the
 *  expiry, so a license that lapsed last year still read green on the roster,
 *  the worker's own profile and the marketplace listing. `today` is a LOCAL
 *  calendar day (todayCalendarDay), never a UTC slice, so a card is not called
 *  expired during the evening of its last valid day.
 *
 *  idExpiry is free text typed on the review step. A value that doesn't parse
 *  as a calendar day stays 'id_verified' and the screen shows the raw text —
 *  we can't honestly call it expired, and hiding the scan would hide the data.
 */
export function verifiedBadge(
  cm: { idVerified: boolean; idMaskedLast4?: string; idExpiry?: string },
  today: string = todayCalendarDay(),
): IdBadge {
  if (!cm.idVerified || !cm.idMaskedLast4) return 'unverified';
  if (isIdExpired(cm.idExpiry, today)) return 'id_expired';
  return 'id_verified';
}

/** True when `idExpiry` names a real calendar day strictly before `today`.
 *  The last valid day itself is NOT expired. */
export function isIdExpired(idExpiry: string | null | undefined, today: string): boolean {
  const exp = parseCalendarDay(idExpiry?.trim());
  const now = parseCalendarDay(today);
  if (!exp || !now) return false;
  return exp.getTime() < now.getTime();
}

/** 'ID expired Sep 22, 2026' — the warning line shown instead of "ID Verified". */
export function idExpiredLabel(idExpiry: string | null | undefined): string {
  const raw = (idExpiry ?? '').trim();
  return raw ? `ID expired ${formatCalendarDay(raw)}` : 'ID expired';
}

/** What the crew detail prints for one certificate (#167).
 *
 *  certExpiryStatus returns 'none' both for a MISSING expiry (honest: "No
 *  expiry") and for a value it cannot parse. The second used to read grey
 *  "No expiry" while Safety › Certifications (certStatus) flagged the same
 *  record expired. A non-empty value we can't read is 'check_date' (danger),
 *  never "No expiry". A missing date keeps "No expiry" — certStatus would call
 *  it 'valid', which is not something we know. */
export type CrewCertRowStatus = CertExpiryStatus | 'check_date';

export function crewCertRowStatus(
  expiresDate: string | null | undefined,
  status: CertExpiryStatus,
): CrewCertRowStatus {
  if (status === 'none' && (expiresDate ?? '').trim() !== '') return 'check_date';
  return status;
}
