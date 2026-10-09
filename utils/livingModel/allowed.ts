// utils/livingModel/allowed.ts — who may reach the Living Model at all.
//
// LIVING_MODEL_ENABLED stays false for everyone. Until it is flipped the
// feature is an OWNER PREVIEW: the founder's master account (utils/owner.ts
// OWNER_EMAILS) gets one row on the project page and the route. Nobody else
// sees a row or reaches the route.
//
// This is the ONE place the flag is read for this feature (the same shape as
// utils/roomScan/allowed.ts and utils/proofPack/allowed.ts).
// scripts/validate-living-model.ts fails if any other file reads the flag.
//
// A second rule sits on top of the gate: the model is made from, and ticked
// against, the project's schedule, so only a seat that may edit that schedule
// (the owner or an editor, utils/syncSeat 'editor' tier) opens it. A viewer or
// a field seat is told why, flag on or off.
//
// Pure: no React, no storage. `isOwner` lower-cases and trims.
import { LIVING_MODEL_ENABLED } from '@/constants/featureFlags';
import { isOwner } from '@/utils/owner';
import { seatCanWrite, type SyncSeatRole } from '@/utils/syncSeat';

/** The rule itself, with the flag handed in so a test can ask both ways. */
export function livingModelAllowedWith(flagOn: boolean, userEmail: string | null | undefined): boolean {
  return flagOn === true || isOwner(userEmail);
}

/** True when the flag is on, or the signed-in person is the app's owner account. A signed-out person is never allowed while the flag is off. */
export function livingModelAllowed(userEmail: string | null | undefined): boolean {
  return livingModelAllowedWith(LIVING_MODEL_ENABLED, userEmail);
}

/** True while the flag is off: the row then says "Owner Preview". */
export function livingModelIsOwnerPreview(): boolean {
  const flagOn: boolean = LIVING_MODEL_ENABLED;
  return !flagOn;
}

export type LivingModelSeat = 'open' | 'checking' | 'refused' | 'unknown';

/** His seat on THIS project: open only for a seat that may edit the schedule. */
export function livingModelSeat(a: { role: SyncSeatRole; isLoading: boolean; isError: boolean }): LivingModelSeat {
  const can = seatCanWrite(a.role, 'editor');
  if (can === true) return 'open';
  if (can === false) return 'refused';
  if (a.isLoading) return 'checking';
  if (a.isError) return 'unknown';
  return 'refused';
}
