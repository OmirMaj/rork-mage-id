// utils/livingModel/storeCore.ts — where a job model is kept on the device (pure).
//
// STORAGE (utils/livingModel/store.ts does the reads and writes):
//   mageid_living_model::<userId>::<projectId>   one job model, as JSON
// Under the app-owned `mageid_` prefix, so the tenant-switch sweep
// (utils/localCacheKeys) removes it and one account's rooms are never shown to
// the next person on a shared device. `bun run test:storage-hygiene` and
// scripts/validate-living-model.ts both check the prefix. The user id is in the
// key as well, so two accounts on one device never read each other's model
// even between sweeps.
//
// SAVED ON THIS DEVICE ONLY FOR NOW, and the screen says so. A model made on
// the phone does not reach the web and a model made on the web does not reach
// the phone. No synced field on the project fits without bending it: the only
// synced JSON on a project is `schedule`, which a dozen writers rebuild, and a
// floor of rooms is not a schedule. Cloud storage needs one new table (see the
// lane report); Phase 1 writes no migration.

export const LIVING_MODEL_KEY_PREFIX = 'mageid_living_model::';

/** null when either id is missing: with no key nothing is read and nothing is written. */
export function livingModelKey(userId: string | null | undefined, projectId: string | null | undefined): string | null {
  if (!userId || !projectId) return null;
  return `${LIVING_MODEL_KEY_PREFIX}${userId}::${projectId}`;
}

/** A model larger than this is not written: one job cannot fill the device's storage. */
export const MAX_MODEL_CHARS = 1_500_000;
