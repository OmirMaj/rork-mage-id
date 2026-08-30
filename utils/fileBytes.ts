// utils/fileBytes.ts — read a local file into bytes that actually upload.
//
// THE BUG THIS CENTRALIZES THE FIX FOR: every upload in this app used
// `const blob = await (await fetch(fileUri)).blob()` and handed that Blob to
// supabase-js. On React Native that Blob carries no data the SDK can
// serialize, so the object lands in Storage at ZERO BYTES — the upload
// "succeeds", no error is thrown, and the file is silently empty forever.
//
// This was not theoretical: production Storage contained 0-byte objects in
// project-documents, and pdf-uploads had never received a single file.
//
// Native reads base64 via expo-file-system (the pattern already proven in
// photoAnalyzer / coiValidator / askYourPlans) and returns a Uint8Array, which
// supabase-js uploads correctly. Web keeps fetch(), which is genuinely correct
// there because the URI is a blob:/data: URL the browser owns.

import { Platform } from 'react-native';
// expo-file-system/legacy, NOT the root entry. In SDK 54 the root's
// readAsStringAsync is a deprecation stub — src/index.ts re-exports
// ./legacyWarnings, where it is `throw errorOnLegacyMethodUse(...)`, and its own
// doc comment says "This method will throw in runtime". It throws on EVERY
// platform, iOS included, so this was not a web issue. 14 other files in this
// repo were already migrated; these five were missed.
import * as FileSystem from 'expo-file-system/legacy';
import { base64ToBytes } from '@/utils/base64Bytes';

/**
 * Read a local file URI (file:// on native, blob:/data: on web) into bytes.
 * Throws if the file can't be read — callers should surface that rather than
 * upload nothing.
 */
export async function readFileBytes(fileUri: string): Promise<Uint8Array> {
  if (Platform.OS === 'web') {
    // A blob:/data: URI is read out of BROWSER MEMORY — the request never
    // touches the network. But a failed fetch of one still throws
    // `TypeError: Failed to fetch`, which is indistinguishable from an offline
    // device unless we say so here.
    //
    // That mattered: utils/photoUploadCore.classifyPhotoUploadError treats
    // TypeError as 'transient', and the transient branch deliberately re-queues
    // WITHOUT bumping retryCount (the offline-first guarantee — a phone in a
    // basement for a week must keep its photos). A blob: URL is revoked the
    // moment the page reloads, so the task became IMMORTAL: retried on every
    // flush forever, never dropped, never surfaced to the user, and holding one
    // of the capped FIFO slots that real photos then get evicted from.
    //
    // A revoked object URL cannot be resurrected by any number of retries, so
    // it is thrown as a distinct terminal error. Only the READ is wrapped —
    // the Supabase upload that follows in utils/storage.uploadProjectPhoto is
    // outside this try, so a genuine network failure there still classifies as
    // transient and keeps its retry budget.
    const isObjectUrl = /^(blob:|data:)/i.test(fileUri.trim());
    try {
      const r = await fetch(fileUri);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) {
      if (isObjectUrl) {
        throw new Error(
          'photo source expired — the browser released this image when the page reloaded. Re-add the photo.',
        );
      }
      throw e;
    }
  }
  // String-literal 'base64' rather than the enum — expo-file-system moved
  // EncodingType into a legacy namespace; the string form is accepted by the
  // typed signature regardless (same note as utils/photoAnalyzer.ts).
  const base64 = await FileSystem.readAsStringAsync(fileUri, { encoding: 'base64' });
  return base64ToBytes(base64);
}
