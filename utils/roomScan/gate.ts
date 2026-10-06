// utils/roomScan/gate.ts — who may use Scan The Room.
//
// Pro and up. The feature prices through the takeoff-to-estimate path, so it
// sits behind the SAME key as Visual Takeoff (app/area-takeoff.tsx:
// canAccess('job_costing'), requiredTier 'pro') instead of adding a new key to
// utils/featureTiers.ts, which would also have to be added to the server's
// per-tier tables for a feature that calls no edge function.
import { REQUIRED_TIER, type FeatureKey } from '@/utils/featureTiers';
import { seatCanWrite, type SyncSeatRole } from '@/utils/syncSeat';

export const SCAN_ROOM_FEATURE: FeatureKey = 'job_costing';
export const SCAN_ROOM_REQUIRED_TIER = REQUIRED_TIER[SCAN_ROOM_FEATURE] as 'pro' | 'business';

// ── WHOSE ESTIMATE IT IS ────────────────────────────────────────────────────
// The tier gate above says whether the person PAYS for the feature. This says
// whether his seat on THIS project may change its estimate. The scan ends in a
// write to project.linkedEstimate, which only the owner and an editor may make
// (app/project-detail.tsx editBlockedReason; utils/syncSeat 'editor' tier, the
// same tier the desktop takeoff's push writes at). A viewer or a field seat
// never reaches the price screen, and the pure core refuses the patch as well
// (utils/roomScan/pricingCore.buildEstimatePatch needs mayEdit: true).

/** 'open' = may price into the estimate. 'checking' = the seat is still being read. 'refused' = a seat that may not. 'unknown' = the read failed. */
export type ScanSeat = 'open' | 'checking' | 'refused' | 'unknown';

export function scanSeat(a: { role: SyncSeatRole; isLoading: boolean; isError: boolean }): ScanSeat {
  const can = seatCanWrite(a.role, 'editor');
  if (can === true) return 'open';
  if (can === false) return 'refused';
  // No role. Still reading it, the read failed, or (settled) he is not on this job.
  if (a.isLoading) return 'checking';
  if (a.isError) return 'unknown';
  return 'refused';
}
