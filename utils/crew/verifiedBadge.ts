// Verified-badge derivation. A raw scan is NOT verification — the GC must
// confirm the extracted fields in the review step. computeIdVerified is the
// gate the ID-scan save path calls; verifiedBadge renders a persisted record.
export function computeIdVerified(params: { scanCompleted: boolean; userConfirmed: boolean }): boolean {
  return params.scanCompleted && params.userConfirmed;
}

/** Badge for a stored CrewMember. 'id_verified' only when the record both
 *  carries the verified flag AND has a masked-last4 (proof a scan happened). */
export function verifiedBadge(cm: { idVerified: boolean; idMaskedLast4?: string }): 'id_verified' | 'unverified' {
  return cm.idVerified && !!cm.idMaskedLast4 ? 'id_verified' : 'unverified';
}
