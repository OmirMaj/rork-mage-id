// validate-crew.ts — unit tests for the pure crew logic (utils/crew/*).
// Run via: bun run scripts/validate-crew.ts
//
// Bun runs TypeScript natively. utils/crew/* imports NOTHING from
// react-native / AsyncStorage / supabase, so we exercise the pure functions
// directly with no mocking (mirrors scripts/validate-schedule-colors.ts).

import { maskIdLast4 } from '../utils/crew/idMasking';
import { computeIdVerified, verifiedBadge } from '../utils/crew/verifiedBadge';
import { generateClaimToken, isValidClaimTokenFormat, canClaim } from '../utils/crew/claimToken';
import { certExpiryStatus } from '../utils/crew/certExpiry';
import { shouldSurfaceToMarketplace, crewMemberToWorkerProfile } from '../utils/crew/surfacing';
import type { CrewMember } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:  ', got, '\n      want: ', want); }
}

console.log('\ncrew logic validation:');

// ── ID masking: strip non-digits, keep last 4, short numbers handled ──
expect('maskIdLast4 DL', maskIdLast4('D1234567'), '4567');
expect('maskIdLast4 with dashes', maskIdLast4('A12-34'), '1234');
expect('maskIdLast4 short (2 digits)', maskIdLast4('99'), '99');
expect('maskIdLast4 empty', maskIdLast4(''), '');
expect('maskIdLast4 no digits', maskIdLast4('no-digits'), '');
expect('maskIdLast4 spaced', maskIdLast4('123 4567 890'), '7890');

// ── Verified-badge derivation: a scan alone is NOT verified ──
expect('computeIdVerified scan+confirm', computeIdVerified({ scanCompleted: true, userConfirmed: true }), true);
expect('computeIdVerified scan only', computeIdVerified({ scanCompleted: true, userConfirmed: false }), false);
expect('computeIdVerified confirm only', computeIdVerified({ scanCompleted: false, userConfirmed: true }), false);
expect('verifiedBadge verified', verifiedBadge({ idVerified: true, idMaskedLast4: '4567' }), 'id_verified');
expect('verifiedBadge flag-set-but-no-scan', verifiedBadge({ idVerified: true, idMaskedLast4: undefined }), 'unverified');
expect('verifiedBadge unverified', verifiedBadge({ idVerified: false, idMaskedLast4: undefined }), 'unverified');

// ── Claim-token format + single-use ──
const tok = generateClaimToken('11111111-2222-4333-8444-555555555555');
expect('generateClaimToken format', tok, 'crew_11111111-2222-4333-8444-555555555555');
expect('isValidClaimTokenFormat good', isValidClaimTokenFormat('crew_11111111-2222-4333-8444-555555555555'), true);
expect('isValidClaimTokenFormat bad prefix', isValidClaimTokenFormat('foo_11111111-2222-4333-8444-555555555555'), false);
expect('isValidClaimTokenFormat too short', isValidClaimTokenFormat('crew_abc'), false);
expect('isValidClaimTokenFormat empty', isValidClaimTokenFormat(''), false);
expect('canClaim unclaimed', canClaim({ claimToken: tok, claimedByUserId: undefined }), true);
expect('canClaim already-claimed (single-use)', canClaim({ claimToken: tok, claimedByUserId: 'u1' }), false);
expect('canClaim no token', canClaim({ claimToken: undefined, claimedByUserId: undefined }), false);

// ── Cert-expiry status (shared with Safety Wave B) ──
expect('certExpiry none', certExpiryStatus(undefined, '2026-07-08'), 'none');
expect('certExpiry empty', certExpiryStatus('', '2026-07-08'), 'none');
expect('certExpiry expired', certExpiryStatus('2026-06-01', '2026-07-08'), 'expired');
expect('certExpiry expiring (12d)', certExpiryStatus('2026-07-20', '2026-07-08'), 'expiring');
expect('certExpiry boundary 30d', certExpiryStatus('2026-08-07', '2026-07-08'), 'expiring');
expect('certExpiry boundary 31d', certExpiryStatus('2026-08-08', '2026-07-08'), 'valid');
expect('certExpiry valid', certExpiryStatus('2026-12-01', '2026-07-08'), 'valid');

// ── Marketplace surfacing guard (HIRE_ENABLED gated) ──
const claimedPublic = { isPublic: true, claimedByUserId: 'u1' };
expect('surface: flag OFF → false', shouldSurfaceToMarketplace(claimedPublic, false), false);
expect('surface: flag ON + claimed + public → true', shouldSurfaceToMarketplace(claimedPublic, true), true);
expect('surface: not public → false', shouldSurfaceToMarketplace({ isPublic: false, claimedByUserId: 'u1' }, true), false);
expect('surface: not claimed → false', shouldSurfaceToMarketplace({ isPublic: true, claimedByUserId: undefined }, true), false);

// ── Surfacing mapper: CrewMember → marketplace WorkerProfile ──
const sampleMember: CrewMember = {
  id: 'cm1', companyUserId: 'gc1', createdAt: '2026-07-08T00:00:00Z', updatedAt: '2026-07-08T00:00:00Z',
  fullName: 'Jane Framer', trades: ['Carpenter'], phone: '555-0100', email: 'jane@example.com',
  status: 'active', idVerified: true, idMaskedLast4: '4567', isPublic: true, projectIds: [],
  claimedByUserId: 'w1',
};
const wp = crewMemberToWorkerProfile(sampleMember);
expect('mapper name', wp.name, 'Jane Framer');
expect('mapper contactEmail', wp.contactEmail, 'jane@example.com');
expect('mapper phone', wp.phone, '555-0100');
expect('mapper tradeCategory', wp.tradeCategory, 'carpenter');
expect('mapper verified → licenses badge', wp.licenses, ['ID Verified']);
expect('mapper availability default', wp.availability, 'available');
expect('mapper createdAt passthrough', wp.createdAt, '2026-07-08T00:00:00Z');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
