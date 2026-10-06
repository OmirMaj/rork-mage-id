// utils/roomScan/gate.ts — who may use Scan The Room.
//
// Pro and up. The feature prices through the takeoff-to-estimate path, so it
// sits behind the SAME key as Visual Takeoff (app/area-takeoff.tsx:
// canAccess('job_costing'), requiredTier 'pro') instead of adding a new key to
// utils/featureTiers.ts, which would also have to be added to the server's
// per-tier tables for a feature that calls no edge function.
import { REQUIRED_TIER, type FeatureKey } from '@/utils/featureTiers';

export const SCAN_ROOM_FEATURE_KEY: FeatureKey = 'job_costing';
export const SCAN_ROOM_REQUIRED_TIER = REQUIRED_TIER[SCAN_ROOM_FEATURE_KEY] as 'pro' | 'business';
