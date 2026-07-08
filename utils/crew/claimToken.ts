// Claim tokens are single-use invite tokens minted by the GC. The pure parts
// are format + usability; the random UUID is injected so this stays testable
// and side-effect free. The caller passes generateUUID() from utils/generateId.
export function generateClaimToken(uuid: string): string {
  return `crew_${uuid}`;
}

/** crew_ prefix + a UUID-ish tail (hex + dashes, ≥ 20 chars). */
export function isValidClaimTokenFormat(token: string | undefined): boolean {
  return !!token && /^crew_[0-9a-f-]{20,}$/i.test(token);
}

/** Single-use: a member can be claimed only if it carries a well-formed token
 *  and has NOT already been claimed. */
export function canClaim(member: { claimToken?: string; claimedByUserId?: string }): boolean {
  return isValidClaimTokenFormat(member.claimToken) && !member.claimedByUserId;
}
