// When may a load keep this device's own copy of a photo instead of signing
// the object the server row names?
//
// The loaders (punch items, the gallery, DFR photos, field tickets) prefer the
// device's copy so a photo the user just took renders instantly and offline.
// That preference used to be unconditional, and two things broke it:
//
//   1. Another device changed the photo. A web Replace points photo_uri at a
//      NEW object; a web Remove sets it NULL. The phone that took the original
//      kept rendering (and inlining into every PDF it exported) the OLD file,
//      because nothing checked that its copy still belonged to the object the
//      server names.
//   2. A web copy is a blob: URL from the file chooser. It is only openable
//      for the life of the page that minted it — after a reload it is dead,
//      yet the loader kept serving it forever and the photo showed as broken
//      on the very browser that uploaded it.
//
// So a device copy is kept only when (a) it belongs to the object the server
// row still names, and (b) it can still be opened: a blob: URL only while it
// was handed to the upload queue in THIS page session.
//
// Plain TypeScript with no imports beyond photoUploadCore, so the validator
// can execute it under bun.

import { isDeviceLocalUri } from '@/utils/photoUploadCore';

/** blob: URLs this page session minted and handed to the upload queue. */
const sessionBlobUris = new Set<string>();

function isBlobUri(uri: string): boolean {
  return /^blob:/i.test(uri.trim());
}

/**
 * Record a device copy that is being staged for upload now. Only blob: URLs
 * need it — a file:// copy outlives the page, a blob: one does not.
 */
export function noteSessionLocalUri(uri: string | undefined | null): void {
  if (uri && isBlobUri(uri)) sessionBlobUris.add(uri.trim());
}

/** Test-only: forget every noted blob, as a page reload would. */
export function resetSessionLocalUrisForTest(): void {
  sessionBlobUris.clear();
}

/** True when this device can still open `uri` (a dead blob: URL cannot). */
export function localCopyOpenable(uri: string | undefined | null): boolean {
  if (!uri || !isDeviceLocalUri(uri)) return false;
  if (isBlobUri(uri)) return sessionBlobUris.has(uri.trim());
  return true;
}

export interface PriorDeviceCopy {
  /** The device's copy of the photo (localUri / photoLocalUri, or a device-local uri). */
  local?: string;
  /** The bucket path that copy was staged under, when it was staged. */
  path?: string;
}

/**
 * The device copy a freshly-read row may keep, or undefined when the row must
 * be rendered from what the server says.
 *
 * `serverValue` is the row's stored photo column (photo_uri / uri): a bucket
 * path, a legacy URL, or null/'' when the photo was removed.
 */
export function deviceCopyForServerRow(prior: PriorDeviceCopy | undefined, serverValue: string | null | undefined): string | undefined {
  if (!prior?.local) return undefined;
  if (!localCopyOpenable(prior.local)) return undefined;
  const server = (serverValue ?? '').trim();
  // Removed on the server: the photo is gone everywhere, including here.
  if (!server) return undefined;
  // Staged copy: it is the same picture only while the row still names the
  // object it was uploaded under. A Replace elsewhere names a new object.
  if (prior.path) return prior.path === server ? prior.local : undefined;
  // Never staged (legacy dev rows that stored the file:// itself): keep it
  // only when the server still holds exactly that value.
  return prior.local === server ? prior.local : undefined;
}
