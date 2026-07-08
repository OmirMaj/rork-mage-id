// certStatus.ts — Wave B certification status.
// REUSES the pure cert-expiry classifier built for the Worker Profile feature
// (utils/crew/certExpiry.ts) instead of re-implementing the day math. That
// classifier returns 'none' for a cert with no expiry; Wave B's
// CertificationStatus has no 'none' state, so a non-expiring cert collapses to
// 'valid'. Every other result ('valid' | 'expiring' | 'expired') — including the
// 30-day inclusive "expiring" window — passes through unchanged.
// No React Native imports: bun runs this (and its dependency) directly under
// the validator; certExpiry.ts is likewise RN-free.

import type { CertificationStatus } from '@/types';
import { certExpiryStatus } from '@/utils/crew/certExpiry';

/**
 * Compute a certification's status relative to a fixed reference date, reusing
 * the Worker-Profile cert-expiry classifier.
 * @param expiresDate 'YYYY-MM-DD' | ISO | undefined | null | '' (falsy → non-expiring → 'valid')
 * @param referenceDate 'YYYY-MM-DD' | ISO — "today" for the computation
 */
export function certStatus(
  expiresDate: string | undefined | null,
  referenceDate: string,
): CertificationStatus {
  const status = certExpiryStatus(expiresDate ?? undefined, referenceDate);
  return status === 'none' ? 'valid' : status;
}
