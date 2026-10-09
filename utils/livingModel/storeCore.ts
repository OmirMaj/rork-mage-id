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
// SAVED ON THE DEVICE FIRST, always. Every change is written here at once.
// After that the model is sent to the person's account (public.living_models,
// supabase/migrations/20261011090000_living_models.sql) when it can be: see
// syncCore.ts for the rules and the header below for the two keys that adds.
// Until that table exists, or with nobody signed in, the model is saved on
// this device only and the screen says so.

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

// SAVING TO THE ACCOUNT (lane LIVINGSYNC; the rules are in syncCore.ts). Two
// more keys, both under the same app-owned prefix and both carrying the person
// and the project, so the tenant sweep removes them with the model:
//   mageid_living_model_sync::<userId>::<projectId>   what this device remembers
//       about the account copy (the revision it last matched, a save that is
//       still on its way, and the person's answer to the scan question)
//   mageid_living_model_kept::<userId>::<projectId>   the model the person did
//       NOT keep when the device and the account had both changed. It stays
//       here until he says to remove it.
//   mageid_living_model_swap::<userId>::<projectId>   for the length of one
//       "Use the Kept Model Instead": the kept model, copied here BEFORE the
//       two trade places, so a kill between the two writes cannot leave it
//       nowhere (syncStore.swapKeptModel / recoverKeptSwap). Removed when the
//       trade is done; found at the next open if it was not.
export const LIVING_MODEL_SYNC_PREFIX = 'mageid_living_model_sync::';
export const LIVING_MODEL_SWAP_PREFIX = 'mageid_living_model_swap::';
export const LIVING_MODEL_KEPT_PREFIX = 'mageid_living_model_kept::';

/** Where the sync notes for one model are kept. null when either id is missing. */
export function livingModelSyncKey(userId: string | null | undefined, projectId: string | null | undefined): string | null {
  if (!userId || !projectId) return null;
  return `${LIVING_MODEL_SYNC_PREFIX}${userId}::${projectId}`;
}

/** Where the model that lost a both-changed choice is kept. null when either id is missing. */
export function livingModelKeptKey(userId: string | null | undefined, projectId: string | null | undefined): string | null {
  if (!userId || !projectId) return null;
  return `${LIVING_MODEL_KEPT_PREFIX}${userId}::${projectId}`;
}

/** Where the kept model waits while it trades places with the one on screen. null when either id is missing. */
export function livingModelSwapKey(userId: string | null | undefined, projectId: string | null | undefined): string | null {
  if (!userId || !projectId) return null;
  return `${LIVING_MODEL_SWAP_PREFIX}${userId}::${projectId}`;
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
