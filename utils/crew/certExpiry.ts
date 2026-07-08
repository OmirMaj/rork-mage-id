// Cert-expiry status — shared with Safety Wave B (Wave B's cert screen should
// import certExpiryStatus from here rather than re-implementing certStatus).
// 'expiring' = within 30 days (inclusive). Dates are ISO YYYY-MM-DD.
export type CertExpiryStatus = 'none' | 'valid' | 'expiring' | 'expired';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function certExpiryStatus(expiresDate: string | undefined, today: string): CertExpiryStatus {
  if (!expiresDate) return 'none';
  const exp = Date.parse(expiresDate);
  const now = Date.parse(today);
  if (Number.isNaN(exp) || Number.isNaN(now)) return 'none';
  const days = Math.floor((exp - now) / MS_PER_DAY);
  if (days < 0) return 'expired';
  if (days <= 30) return 'expiring';
  return 'valid';
}
