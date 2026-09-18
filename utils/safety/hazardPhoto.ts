// hazardPhoto.ts — what photo value a hazard record is saved with.
//
// WHY THIS EXISTS (audit round 2, safety-compliance #3). app/safety-hazards.tsx
// let the super photograph a hazard, scan it with AI, tap a suggestion and save
// — and hard-coded `photoUrl: undefined` on every new hazard. A pasted https URL
// (already durable, no upload needed) was thrown away too. The Hazard type, the
// `hazards.photo_url` column and SafetyContext's sync were all ready; the one
// screen that captured a photo discarded it. A hazard log without the photo is
// just his word when the open-hole item is disputed.
//
// Pure (no RN / expo imports) so scripts/validate-safety-field-joins.ts runs the
// real decision under bun.

import { isHttpUrl } from '@/utils/photoUploadCore';

export interface HazardPhotoInput {
  /** The user has the scanned photo attached to THIS form (default on when the
   *  form was opened from an AI suggestion). */
  attach: boolean;
  /** Durable value for the captured photo: the `project-photos` storage path
   *  once staged, or a device URI when there is no cloud to stage into. */
  stagedPhoto?: string | null;
  /** A photo URL typed into the scan box. */
  pastedUrl?: string | null;
  /** Editing an existing hazard: its current photo. */
  existing?: string | null;
  isEdit: boolean;
}

export function hazardPhotoForSave(i: HazardPhotoInput): string | undefined {
  if (i.attach) {
    // A captured photo wins over a URL — handlePickPhoto clears the URL on
    // capture, so both being set means the capture is the newer intent.
    const staged = (i.stagedPhoto ?? '').trim();
    if (staged) return staged;
    const url = (i.pastedUrl ?? '').trim();
    // Only a real remote URL is stored as-is. Anything else typed in the box
    // was not a photo reference, and storing it would render a broken tile.
    if (url && isHttpUrl(url)) return url;
  }
  // Editing and not replacing: leave the photo the record already has alone.
  // A hazard form opened for a typo fix must not strip its evidence.
  if (i.isEdit) return (i.existing ?? '').trim() || undefined;
  return undefined;
}

/**
 * One captured photo → one upload, however many hazards are saved from it.
 *
 * The scan returns a LIST of suggestions, and resetForm keeps the photo and the
 * list, so the super applies suggestion 1, saves, applies suggestion 2, saves.
 * Both hazards must carry the same storage path — a second upload per hazard
 * would put duplicate objects in his folder of `project-photos` and two
 * different paths on two records of the same picture.
 */
export function stagedPathFor(
  cache: Map<string, string>,
  localUri: string,
  stage: (localUri: string) => string,
): string {
  const hit = cache.get(localUri);
  if (hit) return hit;
  const durable = stage(localUri);
  cache.set(localUri, durable);
  return durable;
}
