// utils/proofPack/allowed.ts — who may reach the Pay Period Record at all.
//
// PROOF_PACK_ENABLED stays false for everyone. Until it is flipped the feature
// is an OWNER PREVIEW: the founder's master account (utils/owner.ts
// OWNER_EMAILS) gets the row on the pay application and invoice screens and
// the route. Nobody else sees a row or reaches the route.
//
// This is the ONE place the flag is read for this feature (the same shape as
// utils/roomScan/allowed.ts). scripts/validate-proof-pack.ts fails if any
// other file reads the flag itself.
//
// A second rule sits on top of the gate: a package is made only by the
// project's OWNER seat (utils/projectRole 'owner'). An editor, a viewer and a
// field seat never get the row, flag on or off: the package carries the
// client's name, the address, the amounts and photos of the property.
//
// Pure: no React, no storage. `isOwner` lower-cases and trims.
import { PROOF_PACK_ENABLED } from '@/constants/featureFlags';
import { isOwner } from '@/utils/owner';

/** The rule itself, with the flag handed in so a test can ask both ways. */
export function proofPackAllowedWith(flagOn: boolean, userEmail: string | null | undefined): boolean {
  return flagOn === true || isOwner(userEmail);
}

/** True when the flag is on, or the signed-in person is the app's owner account. */
export function proofPackAllowed(userEmail: string | null | undefined): boolean {
  return proofPackAllowedWith(PROOF_PACK_ENABLED, userEmail);
}

/** The seat rule: only the project's owner seat makes a package. */
export function proofPackSeatAllowed(role: string | null | undefined): boolean {
  return role === 'owner';
}

/** Both rules at once: what the entry row and the route ask. */
export function proofPackEntryAllowed(userEmail: string | null | undefined, role: string | null | undefined): boolean {
  return proofPackAllowed(userEmail) && proofPackSeatAllowed(role);
}

/** True while the flag is off: the row then says "Owner Preview" under its name. */
export function proofPackIsOwnerPreview(): boolean {
  const flagOn: boolean = PROOF_PACK_ENABLED;
  return !flagOn;
}
