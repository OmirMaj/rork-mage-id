// utils/roomScan/allowed.ts — who may reach Scan The Room at all.
//
// SCAN_ROOM_ENABLED stays false for everyone. The first native build that
// carries the scanner is an OWNER PREVIEW: the founder's master account
// (utils/owner.ts OWNER_EMAILS) gets one row on the project page, the route and
// the native lookup, so he can scan a first real room and send the raw data
// back. Nobody else sees a row, reaches the route or touches the module.
//
// This is the ONE place the flag is read for this feature. The route
// (app/scan-room.tsx), the native lookup (utils/roomScan/native.ts) and the
// entry row (components/roomScan/ScanRoomOwnerRow.tsx) all ask here, with the
// signed-in person's email. scripts/validate-scan-room.ts fails if any other
// scan file reads the flag itself.
//
// Pure: no React, no storage. `isOwner` lower-cases and trims.
import { SCAN_ROOM_ENABLED } from '@/constants/featureFlags';
import { isOwner } from '@/utils/owner';

/** The rule itself, with the flag handed in so a test can ask both ways. */
export function scanRoomAllowedWith(flagOn: boolean, userEmail: string | null | undefined): boolean {
  return flagOn === true || isOwner(userEmail);
}

/** True when the flag is on, or the signed-in person is the owner. A signed-out person (no email) is never allowed while the flag is off. */
export function scanRoomAllowed(userEmail: string | null | undefined): boolean {
  return scanRoomAllowedWith(SCAN_ROOM_ENABLED, userEmail);
}

/** The owner's extras (Scan Facts, Share Raw Scan Data, the real error text). Never switched on by the flag. */
export function scanRoomOwnerTools(userEmail: string | null | undefined): boolean {
  return isOwner(userEmail);
}
