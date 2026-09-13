// planSheetUrls — read-time URL resolution for the `plan-sheets` bucket.
//
// WHY THIS FILE EXISTS (audit DB-F11). Construction drawings are the most
// sensitive document class in the product, and they were served from a PUBLIC
// bucket by PERMANENT, unsigned URLs:
//
//   • storage.buckets.plan-sheets had public = true
//   • NO storage.objects policy mentioned plan-sheets at all — the policies in
//     add_pdf_render_buckets.sql used `CREATE POLICY IF NOT EXISTS`, which is
//     not valid Postgres, so they never landed
//   • convert-pdf-to-images wrote plan-sheets/<projectId>/<id>-page-N.png with
//     the service role and handed back getPublicUrl(), and the client persisted
//     THAT URL into plan_sheets.image_uri
//
// So anyone who ever saw a sheet URL could read that sheet forever: no expiry,
// no revocation when the sheet was superseded, when the project was deleted, or
// when the sub who got the link left the job.
//
// THE FIX is the pattern this repo already uses twice — utils/storage.ts
// (`resolvePhotoUrls`, project-photos) and utils/projectFiles.ts
// (`resolveProjectFileUrls`, project-documents): persist the storage PATH, mint
// a short-lived SIGNED url at read time, never write a URL to a durable store.
// This module is the plan-sheets member of that family and deliberately copies
// their shape rather than inventing a third idiom.
//
// ORDERING (read this before touching a caller). The migration that flips the
// bucket private is PARKED in supabase/migrations/held/. That means this module
// has to work in BOTH worlds for one release:
//
//   bucket still public  → createSignedUrls may be refused (there is no SELECT
//                          policy yet), so an unresolvable input falls back to
//                          whatever the caller already had — a legacy public
//                          URL, which still renders.
//   bucket private       → createSignedUrls succeeds; the legacy public URLs in
//                          old rows stop rendering and degrade to a missing
//                          image, never to a crash.
//
// That is why every resolver here returns the input unchanged on failure
// instead of throwing or returning ''.

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { isDeviceLocalUri } from '@/utils/photoUploadCore';

export const PLAN_SHEET_BUCKET = 'plan-sheets';

/**
 * How long a minted plan-sheet URL stays valid: 24 hours, the PHOTO TTL
 * (utils/storage.ts PHOTO_URL_TTL_SECONDS), not the 7-day project-documents one.
 *
 * This was 7 days, justified by two things, and a review took both apart:
 *   • "the share token needs it" is FICTION. utils/planShareToken.ts embeds this
 *     url beside `photos[].u`, which have been 24h signed urls since the photo
 *     fix — so the shared link already dies in 24h and the extra six days buy
 *     the homeowner nothing.
 *   • "expo-image cache economics" is real but is the wrong thing to optimise
 *     here. A minted url is an UNREVOCABLE BEARER TOKEN: deleting the project,
 *     superseding the sheet or removing the collaborator does not invalidate it.
 *     Trading revocation latency against a cache miss, on the most sensitive
 *     document class in the product, is the wrong side of that trade.
 *
 * Every render path re-mints on app open / project switch (ProjectContext
 * hydration) or on load (resolveRenderedPages), so 24h costs a re-download, not
 * a broken screen. It must never be persisted — see utils/storage.ts:11-14 for
 * what happened the last time an expiring URL was written into a DB row.
 */
export const PLAN_SHEET_URL_TTL_SECONDS = 60 * 60 * 24;

// The three shapes a Supabase Storage object URL can take for this bucket.
// Only the first was ever minted, so recovering a path from already-persisted
// plan_sheets.image_uri rows means stripping
// `/storage/v1/object/public/plan-sheets/`; the other two are here so a signed
// URL that got persisted by mistake is equally recoverable.
const OBJECT_URL_MARKERS = [
  `/storage/v1/object/public/${PLAN_SHEET_BUCKET}/`,
  `/storage/v1/object/sign/${PLAN_SHEET_BUCKET}/`,
  `/storage/v1/object/${PLAN_SHEET_BUCKET}/`,
] as const;

// A URI that only means something on the device that produced it: a camera
// capture or a web blob. Never a storage path, never signable. Same set as
// utils/projectFiles.ts DEVICE_LOCAL_SCHEME / photoUploadCore.isDeviceLocalUri.
const DEVICE_LOCAL_SCHEME = /^(file|blob|data|content|ph|assets-library):/i;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Recover the bucket-relative storage path from whatever a caller has on hand:
 * a path (returned unchanged), a legacy permanent public URL from before this
 * fix, or a signed URL whose token has expired.
 *
 * Returns '' when the input is not a `plan-sheets` reference at all — a
 * device-local capture, an empty string, a seeded picsum.photos placeholder, or
 * a URL on some other bucket or host. Callers treat '' as "leave this URI
 * alone", which is what stops the resolvers below from mangling a local preview
 * or a project-documents link.
 */
export function planSheetStoragePath(uriOrPath: string | null | undefined): string {
  if (!uriOrPath) return '';
  const raw = String(uriOrPath).trim();
  if (!raw) return '';
  if (!/^https?:\/\//i.test(raw)) {
    if (DEVICE_LOCAL_SCHEME.test(raw)) return '';
    // Bucket-relative already. Leading slashes are not part of a storage key.
    return raw.replace(/^\/+/, '');
  }
  for (const marker of OBJECT_URL_MARKERS) {
    const at = raw.indexOf(marker);
    if (at < 0) continue;
    const tail = raw.slice(at + marker.length);
    const q = tail.indexOf('?');
    const key = q >= 0 ? tail.slice(0, q) : tail;
    try {
      return decodeURIComponent(key);
    } catch {
      return key; // malformed %-escape: the raw key still beats nothing
    }
  }
  return '';
}

/**
 * True when a path's first folder segment is a real project id.
 *
 * This is the tenant boundary the held migration encodes:
 *   using (bucket_id = 'plan-sheets'
 *          and public.can_access_project((storage.foldername(name))[1]))
 *
 * `can_access_project` takes the TEXT overload, which casts to uuid and returns
 * FALSE on failure — so a shared literal prefix such as the `'tmp'` that
 * app/takeoff.tsx used to pass can never be admitted by any membership policy.
 * An object written there is unreadable by every client the moment the bucket
 * goes private, which is why the write path refuses to create one.
 */
export function isProjectScopedPlanSheetPath(path: string | null | undefined): boolean {
  const first = String(path ?? '').replace(/^\/+/, '').split('/')[0] ?? '';
  return UUID_RE.test(first);
}

/**
 * Mint fresh signed URLs for a batch of stored paths / legacy URLs.
 *
 * Keyed by the ORIGINAL input string so a caller holding a mix of paths and
 * legacy public URLs can look each one up by exactly what it has stored.
 *
 * Never throws — an entry that cannot be signed (offline, or no SELECT policy
 * yet because the held migration has not been applied) is simply absent from
 * the map, and the caller keeps whatever it had.
 */
export async function resolvePlanSheetUrls(uris: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!isSupabaseConfigured) return out;
  // input -> storage path, dropping anything that is not a bucket reference.
  const byPath = new Map<string, string[]>();
  for (const uri of uris) {
    const path = planSheetStoragePath(uri);
    if (!path) continue;
    const existing = byPath.get(path);
    if (existing) existing.push(uri);
    else byPath.set(path, [uri]);
  }
  const paths = [...byPath.keys()];
  if (paths.length === 0) return out;
  // createSignedUrls is batched but not unbounded — chunk it, same as
  // resolvePhotoUrls in utils/storage.ts. A 200-sheet hospital set is one
  // project's worth of plans and would otherwise be one enormous request.
  const CHUNK = 100;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const chunk = paths.slice(i, i + CHUNK);
    try {
      const { data, error } = await supabase.storage
        .from(PLAN_SHEET_BUCKET)
        .createSignedUrls(chunk, PLAN_SHEET_URL_TTL_SECONDS);
      if (error || !data) continue;
      for (const entry of data) {
        const path = (entry as { path?: string | null }).path;
        const signedUrl = (entry as { signedUrl?: string | null }).signedUrl;
        if (!path || !signedUrl) continue;
        for (const original of byPath.get(path) ?? []) out.set(original, signedUrl);
      }
    } catch {/* offline — caller keeps its existing URI */}
  }
  return out;
}

/**
 * Single-URI form of resolvePlanSheetUrls. Returns the input UNCHANGED when it
 * is not a plan-sheets reference or when signing fails, so it is safe to wrap
 * any `<Image source>` with it:
 *   • a legacy public URL keeps rendering while the bucket is still public;
 *   • after the flip it degrades to a missing image, not a crash.
 */
export async function resolvePlanSheetUrl(uriOrPath: string | null | undefined): Promise<string> {
  const raw = uriOrPath ? String(uriOrPath) : '';
  if (!raw) return '';
  const resolved = await resolvePlanSheetUrls([raw]);
  return resolved.get(raw) ?? raw;
}

/**
 * What belongs in `plan_sheets.image_uri`, and in the local cache — the DURABLE
 * value for a sheet. The mirror image of the resolvers above.
 *
 * Prefers the storage path. Falls back to recovering one from the current URI,
 * which is what converts a legacy row (or a signed URL that reached a writer by
 * accident) back into something durable. Then falls back to a non-local URL
 * as-is — someone may have pasted an https image that is not ours. Drops a
 * device-local `file://` / `blob:` entirely: it means nothing on any other
 * device, and writing one to Postgres is the photo bug all over again.
 *
 * Never returns a signed URL, which is the property the whole fix rests on.
 */
export function durablePlanSheetValue(
  storagePath: string | undefined,
  currentUri: string | undefined,
): string {
  if (storagePath) return storagePath;
  const recovered = planSheetStoragePath(currentUri);
  if (recovered) return recovered;
  if (currentUri && !isDeviceLocalUri(currentUri)) return currentUri;
  return '';
}

/**
 * True when a URI is a plan-sheet SIGNED url — the one shape that must never
 * reach a durable store, because it stops working when its TTL runs out.
 */
function isSignedPlanSheetUrl(uri: string): boolean {
  return uri.includes(`/storage/v1/object/sign/${PLAN_SHEET_BUCKET}/`) || /[?&]token=/.test(uri);
}

/**
 * What belongs in the LOCAL cache (AsyncStorage `mageid_plan_sheets`).
 *
 * Same rule as `durablePlanSheetValue` with ONE deliberate difference: a
 * device-local `file://` / `ph:` / `blob:` URI is KEPT.
 *
 * WHY THE DIFFERENCE. app/plans.tsx `confirmImport` creates a sheet straight
 * out of ImagePicker — a photo of a plan, no upload anywhere — so its only
 * value is a device-local URI. Postgres must not hold one (it means nothing on
 * another device, and writing one there is the photo bug all over again), but
 * the CACHE is that device, and blanking it there deletes an image that used to
 * survive a restart. Dropping it in both places is how the first cut of DB-F11
 * silently destroyed every image-imported plan sheet.
 *
 * A signed URL is still refused here — that is the whole point of the split.
 */
export function localPlanSheetValue(
  storagePath: string | undefined,
  currentUri: string | undefined,
): string {
  const durable = durablePlanSheetValue(storagePath, currentUri);
  if (durable) return durable;
  // durable is '' only for: nothing at all, or a device-local capture.
  if (currentUri && !isSignedPlanSheetUrl(currentUri)) return currentUri;
  return '';
}

/**
 * The read-side mapper for one `plan_sheets` row: what the app renders, and
 * what it may hand to a server that reads bytes by path.
 *
 * Extracted out of contexts/ProjectContext.tsx so a guard can EXECUTE it. The
 * provider is 5,000 lines of .tsx that no test loads, and the first cut of this
 * fix was proven green with both of its mappers gutted.
 *
 * `storagePath` is populated ONLY for a project-scoped key. A legacy row under
 * the shared `tmp/` prefix does recover a path, but no membership policy can
 * admit it and `_shared/planSheetBytes.ts` refuses it outright — publishing it
 * would turn a compare-drawings call that works today off the public URL into a
 * generic 403. Left undefined, the URL fallback on that request stays reachable.
 */
export function planSheetRowUris(
  storedImageUri: string | null | undefined,
  signed: Map<string, string>,
): { imageUri: string; storagePath: string | undefined } {
  const raw = storedImageUri ? String(storedImageUri) : '';
  const path = planSheetStoragePath(raw);
  return {
    imageUri: signed.get(raw) ?? raw,
    storagePath: path && isProjectScopedPlanSheetPath(path) ? path : undefined,
  };
}

/**
 * Carry a device-local plan-sheet image across the server hydration.
 *
 * A sheet created by app/plans.tsx `confirmImport` is a PHOTO of a plan out of
 * the library. Nothing uploads it, so it has no storage object and its
 * `plan_sheets.image_uri` is correctly '' — a `file://` on another device is
 * noise at best. But on the device that took it, the cache DOES have the URI,
 * and letting the server row's '' overwrite it blanks an image the user could
 * see a moment ago. Same contract as DFRPhoto.localUri in the photo path.
 *
 * Only fills a HOLE: a server row that has an image always wins.
 */
export function carryDeviceLocalPlanSheetUris<T extends { id: string; imageUri: string }>(
  serverSheets: T[],
  cached: { id: string; imageUri: string }[],
): T[] {
  const localOnly = new Map<string, string>();
  for (const c of cached) {
    if (c.imageUri && isDeviceLocalUri(c.imageUri)) localOnly.set(c.id, c.imageUri);
  }
  if (localOnly.size === 0) return serverSheets;
  return serverSheets.map(s => (
    !s.imageUri && localOnly.has(s.id) ? { ...s, imageUri: localOnly.get(s.id) as string } : s
  ));
}
