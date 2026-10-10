// utils/payApp/allowed.ts — who may reach Easier Pay Applications, Phase 1.
//
// PAY_APP_EASY_ENABLED stays false for everyone. Until it is flipped the
// feature is an OWNER PREVIEW: the founder's master account (utils/owner.ts
// OWNER_EMAILS) gets Bill This Month, the Rejection Check, the spreadsheet
// import and export, and the lock at send. Everyone else keeps today's pay
// application screen, unchanged.
//
// This is the ONE place the flag is read for this feature (the same shape as
// utils/proofPack/allowed.ts). scripts/validate-pay-app-easy.ts fails if any
// other file reads the flag itself.
//
// Pure: no React, no storage. `isOwner` lower-cases and trims.
import { PAY_APP_EASY_ENABLED } from '@/constants/featureFlags';
import { isOwner } from '@/utils/owner';

/** The rule itself, with the flag handed in so a test can ask both ways. */
export function payAppEasyAllowedWith(flagOn: boolean, userEmail: string | null | undefined): boolean {
  return flagOn === true || isOwner(userEmail);
}

/** True when the flag is on, or the signed-in person is the app's owner account. */
export function payAppEasyAllowed(userEmail: string | null | undefined): boolean {
  return payAppEasyAllowedWith(PAY_APP_EASY_ENABLED, userEmail);
}

/** True while the flag is off: the entry then says "Owner Preview" under its name. */
export function payAppEasyIsOwnerPreview(): boolean {
  const flagOn: boolean = PAY_APP_EASY_ENABLED;
  return !flagOn;
}
