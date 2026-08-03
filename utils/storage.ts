import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { readFileBytes } from '@/utils/fileBytes';
import { PHOTO_BUCKET } from '@/utils/photoUploadCore';

/**
 * How long a read-time photo URL stays valid.
 *
 * We store the storage PATH in `photos.uri` and mint one of these on READ, so
 * the expiry is never persisted anywhere durable — it lives in memory and in
 * the AsyncStorage read-cache, both of which are refreshed on the next online
 * load. That is the whole point: the old implementation baked a 7-day signed
 * URL into the DB row, which meant every photo silently 400'd a week later.
 *
 * 24h (not 60s like contractSealing's one-shot download) because a gallery is
 * scrolled, backgrounded and re-opened, and because the cached list has to stay
 * viewable through a day offline.
 */
const PHOTO_URL_TTL_SECONDS = 60 * 60 * 24;

/**
 * Push a photo's bytes into the private `project-photos` bucket at an
 * explicitly-supplied path.
 *
 * Two deliberate differences from every other upload helper in this file:
 *
 *  1. NO `Platform.OS === 'web'` bail-out. It used to return null on web, which
 *     is why web photos never reached Storage at all. `readFileBytes` already
 *     handles both worlds (fetch → arrayBuffer on web, expo-file-system base64
 *     → Uint8Array on native). Note it must NEVER become `fetch().blob()` on
 *     native — an RN Blob carries no data supabase-js can serialize, so the
 *     object lands at ZERO BYTES with no error (fixed in 537d74d).
 *
 *  2. It THROWS instead of returning null. The photo queue has to tell an
 *     offline device (re-queue, keep the retry budget) from an RLS denial
 *     (discard and warn the user) from a 409 "already exists" (that's a
 *     success). Swallowing the error into `null` erases exactly the
 *     information that decision needs.
 *
 * Returns the storage path — which is what gets persisted. Callers resolve it
 * to a viewable URL at read time via resolvePhotoUrls().
 */
export async function uploadProjectPhoto(
  fileUri: string,
  storagePath: string,
  contentType: string = 'image/jpeg',
): Promise<string> {
  const bytes = await readFileBytes(fileUri);
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(storagePath, bytes, { contentType, upsert: false });
  if (error) throw new Error(error.message);
  return storagePath;
}

/**
 * Resolve stored photo paths to viewable URLs, batched.
 *
 * `project-photos` is a PRIVATE bucket (supabase/schema.sql) whose RLS requires
 * `(storage.foldername(name))[1] = auth.uid()`, so getPublicUrl is not an
 * option — it has to be signed. Matches the read-time-resolution precedent set
 * by utils/contractSealing.ts (`signed_pdf_url` holds a PATH; a short-lived URL
 * is minted at download time) and utils/projectFiles.ts `listProjectFiles`
 * (URLs built per read, never persisted).
 *
 * Never throws — an unresolvable path just doesn't appear in the map, and the
 * caller falls back to whatever local copy it has.
 */
export async function resolvePhotoUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(paths.filter(p => p && p.length > 0))];
  if (!isSupabaseConfigured || unique.length === 0) return out;
  // createSignedUrls is batched but not unbounded — chunk so a project with
  // hundreds of photos doesn't send one enormous request.
  const CHUNK = 100;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    try {
      const { data, error } = await supabase.storage
        .from(PHOTO_BUCKET)
        .createSignedUrls(chunk, PHOTO_URL_TTL_SECONDS);
      if (error || !data) continue;
      for (const entry of data) {
        const path = (entry as { path?: string | null }).path;
        const signedUrl = (entry as { signedUrl?: string | null }).signedUrl;
        if (path && signedUrl) out.set(path, signedUrl);
      }
    } catch {/* offline — callers fall back to the local copy */}
  }
  return out;
}

/** Remove a photo object from the bucket. Best-effort; never throws. */
export async function deleteProjectPhotoObject(storagePath: string): Promise<void> {
  if (!isSupabaseConfigured || !storagePath) return;
  try {
    await supabase.storage.from(PHOTO_BUCKET).remove([storagePath]);
  } catch {/* orphaned object is harmless next to a failed delete */}
}

export async function uploadDocument(
  userId: string,
  fileName: string,
  fileUri: string,
): Promise<string | null> {
  if (!isSupabaseConfigured || Platform.OS === 'web') return null;
  try {
    const path = `${userId}/${Date.now()}_${fileName}`;
    const blob = await readFileBytes(fileUri);
    const { error } = await supabase.storage
      .from('documents')
      .upload(path, blob, { contentType: 'application/pdf', upsert: false });
    if (error) {
      console.log('[Storage] Document upload error:', error.message);
      return null;
    }
    const { data: signedData } = await supabase.storage
      .from('documents')
      .createSignedUrl(path, 60 * 60 * 24 * 7);
    console.log('[Storage] Document uploaded:', path);
    return signedData?.signedUrl ?? null;
  } catch (err) {
    console.log('[Storage] Document upload failed:', err);
    return null;
  }
}

export async function uploadBrandingAsset(
  userId: string,
  type: 'logo' | 'signature',
  fileUri: string,
): Promise<string | null> {
  if (!isSupabaseConfigured || Platform.OS === 'web') return null;
  try {
    const ext = type === 'logo' ? 'png' : 'png';
    const path = `${userId}/${type}_${Date.now()}.${ext}`;
    const blob = await readFileBytes(fileUri);
    const { error } = await supabase.storage
      .from('branding')
      .upload(path, blob, { contentType: `image/${ext}`, upsert: true });
    if (error) {
      console.log('[Storage] Branding upload error:', error.message);
      return null;
    }
    const { data: signedData } = await supabase.storage
      .from('branding')
      .createSignedUrl(path, 60 * 60 * 24 * 7);
    console.log('[Storage] Branding asset uploaded:', path);
    return signedData?.signedUrl ?? null;
  } catch (err) {
    console.log('[Storage] Branding upload failed:', err);
    return null;
  }
}

export async function uploadProfileImage(
  userId: string,
  fileUri: string,
): Promise<string | null> {
  if (!isSupabaseConfigured || Platform.OS === 'web') return null;
  try {
    const path = `${userId}/avatar_${Date.now()}.jpg`;
    const blob = await readFileBytes(fileUri);
    const { error } = await supabase.storage
      .from('profiles')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) {
      console.log('[Storage] Profile image upload error:', error.message);
      return null;
    }
    const { data: urlData } = supabase.storage.from('profiles').getPublicUrl(path);
    console.log('[Storage] Profile image uploaded:', path);
    return urlData.publicUrl;
  } catch (err) {
    console.log('[Storage] Profile image upload failed:', err);
    return null;
  }
}

// Upload a homeowner-RFP attachment (photo or drawing PDF) to the
// public rfp-attachments bucket. Returns the public URL — the bucket is
// public-read so contractors browsing the listing can fetch directly.
// Path convention is <userId>/<rfpId>/<timestamp>_<filename> which the
// RLS policy on storage.objects expects (folder[1] must equal auth.uid()).
export async function uploadRfpAttachment(
  userId: string,
  rfpId: string,
  fileUri: string,
  fileName: string,
  contentType: string,
): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${userId}/${rfpId}/${Date.now()}_${safeName}`;
    const blob = await readFileBytes(fileUri);
    const { error } = await supabase.storage
      .from('rfp-attachments')
      .upload(path, blob, { contentType, upsert: false });
    if (error) {
      console.log('[Storage] RFP attachment upload error:', error.message);
      return null;
    }
    const { data } = supabase.storage.from('rfp-attachments').getPublicUrl(path);
    return data.publicUrl ?? null;
  } catch (err) {
    console.log('[Storage] RFP attachment upload failed:', err);
    return null;
  }
}

// Upload an opt-in retained raw ID image to the PRIVATE worker-ids bucket.
// Returns the storage PATH (never a durable URL) — mirrors the sub-documents
// precedent. The default ID-scan flow does NOT call this (extract-then-purge).
export async function uploadWorkerIdImage(
  userId: string,
  crewMemberId: string,
  fileUri: string,
): Promise<string | null> {
  if (!isSupabaseConfigured || Platform.OS === 'web') return null;
  try {
    const path = `${userId}/${crewMemberId}/${Date.now()}.jpg`;
    const blob = await readFileBytes(fileUri);
    const { error } = await supabase.storage
      .from('worker-ids')
      .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) {
      console.log('[Storage] Worker-ID upload error:', error.message);
      return null;
    }
    console.log('[Storage] Worker-ID stored (path only):', path);
    return path;
  } catch (err) {
    console.log('[Storage] Worker-ID upload failed:', err);
    return null;
  }
}

export async function deleteStorageFile(
  bucket: string,
  path: string,
): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error) {
      console.log('[Storage] Delete error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.log('[Storage] Delete failed:', err);
    return false;
  }
}
