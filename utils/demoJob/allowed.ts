// utils/demoJob/allowed.ts — who may reach the Demo Job builder (pure).
//
// The owner account only (utils/owner.ts OWNER_EMAILS), and only while the
// kill switch DEMO_JOB_BUILDER_ENABLED is on. Both, always: unlike the owner
// previews, turning the flag ON never opens this to anyone else, because it
// writes a few hundred made-up records into the account that taps it.
//
// This is the ONE place the flag is read (scripts/validate-demo-job.ts fails
// on a second reader). `isOwner` lower-cases and trims.
import { DEMO_JOB_BUILDER_ENABLED } from '@/constants/featureFlags';
import { isOwner } from '@/utils/owner';

/** The rule itself, with the flag handed in so a test can ask both ways. */
export function demoJobAllowedWith(flagOn: boolean, userEmail: string | null | undefined): boolean {
  return flagOn === true && isOwner(userEmail);
}

export function demoJobAllowed(userEmail: string | null | undefined): boolean {
  return demoJobAllowedWith(DEMO_JOB_BUILDER_ENABLED, userEmail);
}
