// utils/deliveries/allowed.ts — who may reach Deliveries That Follow The
// Schedule at all (lane DELIVERIES-1).
//
// DELIVERIES_FOLLOW_SCHEDULE_ENABLED stays false for everyone. Until it is
// flipped the feature is an OWNER PREVIEW: the founder's master account
// (utils/owner.ts OWNER_EMAILS) sees the task link, the dates and the flags.
// For everybody else the Deliveries screen, the task sheet and the schedule
// are exactly what they were before the lane.
//
// This is the ONE place the flag is read (the same shape as
// utils/livingModel/allowed.ts). scripts/validate-deliveries-schedule.ts fails
// if any other file reads it.
//
// TIER. The link and Needed On Site By are for everyone with a schedule. The
// job-effect preview (what a late supplier date does to the finish date) is on
// Pro and up; hooks/useDeliveriesFollowSchedule asks hooks/useTierAccess.
//
// Pure: no React, no storage. `isOwner` lower-cases and trims.
import { DELIVERIES_FOLLOW_SCHEDULE_ENABLED } from '@/constants/featureFlags';
import { isOwner } from '@/utils/owner';

/** The rule itself, with the flag handed in so a test can ask both ways. */
export function deliveriesFollowScheduleAllowedWith(flagOn: boolean, userEmail: string | null | undefined): boolean {
  return flagOn === true || isOwner(userEmail);
}

/** True when the flag is on, or the signed-in person is the app's owner account. A signed-out person is never allowed while the flag is off. */
export function deliveriesFollowScheduleAllowed(userEmail: string | null | undefined): boolean {
  return deliveriesFollowScheduleAllowedWith(DELIVERIES_FOLLOW_SCHEDULE_ENABLED, userEmail);
}

/** True while the flag is off: the screens then say "Owner Preview". */
export function deliveriesFollowScheduleIsOwnerPreview(): boolean {
  const flagOn: boolean = DELIVERIES_FOLLOW_SCHEDULE_ENABLED;
  return !flagOn;
}
