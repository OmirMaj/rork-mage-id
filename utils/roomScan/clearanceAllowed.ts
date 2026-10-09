// utils/roomScan/clearanceAllowed.ts — who may see Clearance Check.
//
// Clearance Check sets scanned distances beside a table of commonly used
// figures that NO architect or expediter has read. So it does not ride on the
// scanner's switch. Its own rule:
//   the owner account (utils/owner.ts OWNER_EMAILS)   always, as a preview;
//   anyone else                                        only when
//       CLEARANCE_CHECK_ENABLED is true, AND
//       the table's own review record says a NAMED professional has read it
//       (utils/roomScan/clearanceRefs.clearanceRefsProfessionallyRead).
// SCAN_ROOM_ENABLED is not read here at all: flipping the scanner on shows
// Clearance Check to nobody new. (Reaching the scan screen is still the
// scanner's own gate, utils/roomScan/allowed.)
//
// This is the ONE place CLEARANCE_CHECK_ENABLED and the review record are read
// for the gate. Pure: no React, no storage.
import { CLEARANCE_CHECK_ENABLED } from '@/constants/featureFlags';
import { isOwner } from '@/utils/owner';
import { CLEARANCE_REFS_REVIEW, clearanceRefsProfessionallyRead, type ClearanceRefsReview } from '@/utils/roomScan/clearanceRefs';

/** The rule itself, with the switch and the review record handed in so a test can ask every way. */
export function clearanceCheckAllowedWith(flagOn: boolean, review: ClearanceRefsReview, userEmail: string | null | undefined): boolean {
  if (isOwner(userEmail)) return true;
  return flagOn === true && clearanceRefsProfessionallyRead(review);
}

/** True for the owner, and for anyone else only once the switch is on and a named professional has read the table. */
export function clearanceCheckAllowed(userEmail: string | null | undefined): boolean {
  return clearanceCheckAllowedWith(CLEARANCE_CHECK_ENABLED, CLEARANCE_REFS_REVIEW, userEmail);
}
