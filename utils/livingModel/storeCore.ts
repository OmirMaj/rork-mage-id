// utils/livingModel/storeCore.ts — where a job model is kept on the device (pure).
//
// STORAGE (utils/livingModel/store.ts does the reads and writes):
//   mageid_living_model::<userId>::<projectId>          one job model, as JSON
//   mageid_living_model_backup::<userId>::<projectId>   text that could not be
//       read as a model, kept as it was (see below)
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

// A SAVED MODEL THAT CANNOT BE READ IS NEVER THROWN AWAY. When text is stored
// under the model key and it is not a sound model of this job (damaged, made by
// a newer build, another job's), the screen says so in a plain sentence, the
// text is copied untouched under the backup key, and NOTHING is written over
// the model key until the person chooses Start a New Model
// (`mayWriteModel`). scripts/validate-living-model.ts plants a store that
// saves over it and must go red.

export const LIVING_MODEL_KEY_PREFIX = 'mageid_living_model::';

/** null when either id is missing: with no key nothing is read and nothing is written. */
export function livingModelKey(userId: string | null | undefined, projectId: string | null | undefined): string | null {
  if (!userId || !projectId) return null;
  return `${LIVING_MODEL_KEY_PREFIX}${userId}::${projectId}`;
}

/** A model larger than this is not written: one job cannot fill the device's storage. */
export const MAX_MODEL_CHARS = 1_500_000;

export const LIVING_MODEL_BACKUP_PREFIX = 'mageid_living_model_backup::';

/** Where text that could not be read as a model is kept. null when either id is missing. */
export function livingModelBackupKey(userId: string | null | undefined, projectId: string | null | undefined): string | null {
  if (!userId || !projectId) return null;
  return `${LIVING_MODEL_BACKUP_PREFIX}${userId}::${projectId}`;
}

/** What the screen holds after reading the device. */
export type LoadState =
  /** Nothing was saved, or a sound model was read. Edits save. */
  | 'ready'
  /** Text is stored and cannot be read as a model. Nothing may be written over it. */
  | 'unreadable'
  /** The person chose Start a New Model. The unread text is in the backup key; edits save. */
  | 'started_new';

/** True when a change may be written to the model key. Never while unread text sits under it. */
export function mayWriteModel(state: LoadState): boolean {
  return state !== 'unreadable';
}
