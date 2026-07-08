// certStatus.ts — Wave B certification status.
// REUSES the pure cert-expiry classifier built for the Worker Profile feature
// (utils/crew/certExpiry.ts) instead of re-implementing the day math. That
// classifier returns 'none' both for a cert with no expiry AND for one whose
// expiry string does not parse. Wave B's CertificationStatus has no 'none'
// state, so we must NOT fold both cases into 'valid': a genuinely absent expiry
// is non-expiring ('valid'), but a NON-EMPTY, unparseable date is a data-entry
// error and is flagged as 'expired' rather than shown as a false-safe green
// badge. Every parseable result ('valid' | 'expiring' | 'expired') — including
// the 30-day inclusive "expiring" window — passes through unchanged.
// No React Native imports: bun runs this (and its dependency) directly under
// the validator; certExpiry.ts is likewise RN-free.

import type { CertificationStatus } from '@/types';
import { certExpiryStatus } from '@/utils/crew/certExpiry';

/**
 * Compute a certification's status relative to a fixed reference date, reusing
 * the Worker-Profile cert-expiry classifier.
 * @param expiresDate 'YYYY-MM-DD' | ISO | undefined | null | '' (empty → non-expiring → 'valid'; non-empty but unparseable → 'expired')
 * @param referenceDate 'YYYY-MM-DD' | ISO — "today" for the computation
 */
export function certStatus(
  expiresDate: string | undefined | null,
  referenceDate: string,
): CertificationStatus {
  const trimmed = (expiresDate ?? '').trim();
  if (trimmed === '') return 'valid'; // genuinely no expiry → non-expiring
  const status = certExpiryStatus(trimmed, referenceDate);
  // A non-empty date that returns 'none' failed to parse — surface it as
  // 'expired' so a typo can't hide behind a green "Valid" badge on a
  // compliance surface.
  return status === 'none' ? 'expired' : status;
}
