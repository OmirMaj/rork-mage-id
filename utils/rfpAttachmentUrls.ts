// utils/rfpAttachmentUrls.ts — read-time links for the `rfp-attachments` bucket
// (a homeowner's photos and drawings on a project posting). Audit DB-F11b,
// lane PROTECT-SERVER.
//
// WHY. The bucket was PUBLIC and the app stored each file's permanent public URL
// in public_bids.photo_urls / drawing_urls, a table any signed-in account can
// list. So anyone who ever held a URL could open a homeowner's house photos and
// plans forever, with no sign-in. The fix is the pattern this repo already uses
// for project-photos (utils/storage resolvePhotoUrls), project-documents and
// plan-sheets (utils/planSheetUrls): store the PATH, and ask Storage for a
// short-lived signed link when a person who is allowed to see it opens it.
//
// WHAT IS STORED NOW. utils/storage.ts uploadRfpAttachment returns the bare
// path `<owner id>/<posting id>/<digits>_<name>`. Rows written before this
// release hold the old public URL; rfpAttachmentPath() recovers the path from
// either, so old rows keep working for the people the bucket's read policy
// admits (the owner; a contractor while the posting is open; a bidder).
//
// ORDERING. The migration that flips the bucket private
// (supabase/migrations/20261009120000_rfp_attachments_private.sql) is applied
// AFTER this release has reached phones. So this module works in both worlds:
//   bucket still public  → the signing call is refused (a public bucket has no
//                          read policy), and a stored legacy URL is handed back
//                          unchanged: it still opens. A stored bare path has no
//                          public URL built for it here, ever; it shows blank
//                          until the migration lands. (That is a photo posted
//                          in the window between this release and the
//                          migration, viewed in that same window.)
//   bucket private       → signing succeeds for the people allowed; a legacy
//                          URL nobody may sign degrades to a missing image,
//                          never to a crash.
//
// No function in this file, or anywhere in the app, builds a
// /object/public/rfp-attachments/ URL: scripts/validate-rfp-attachments-private.ts
// fails the build if one appears.

import { useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export const RFP_ATTACHMENT_BUCKET = 'rfp-attachments';

/**
 * How long a minted link stays valid: one hour. A minted link is a bearer
 * token that closing the posting does not revoke, and these are the inside of
 * someone's home; the screens re-mint on every open.
 */
export const RFP_ATTACHMENT_URL_TTL_SECONDS = 60 * 60;

// The shape supabase/functions/_shared/storagePath.ts RFP_ATTACHMENT_PATH
// accepts: <uuid>/<uuid>/<digits>_<name>. Pinned equal by the validator.
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const RFP_ATTACHMENT_PATH_RE = new RegExp(`^${ID}/${ID}/[0-9]{1,16}_[A-Za-z0-9._-]*$`);
const PATH_MAX = 256;

/**
 * The bucket-relative path a stored value names, or null when it names nothing
 * in this bucket. Accepts a bare path and the legacy URL shapes
 * (.../object/public|sign|authenticated/rfp-attachments/<path>, with or without
 * a query string). Anything that does not come out as a writer's key is null.
 */
export function rfpAttachmentPath(stored: string | null | undefined): string | null {
  if (typeof stored !== 'string') return null;
  const raw = stored.trim();
  if (raw.length === 0 || raw.length > 2048) return null;
  let candidate = raw;
  const marker = '/storage/v1/object/';
  const at = raw.indexOf(marker);
  if (at !== -1) {
    const rest = raw.slice(at + marker.length).split('?')[0].split('#')[0].replace(/^(public|sign|authenticated)\//, '');
    const prefix = `${RFP_ATTACHMENT_BUCKET}/`;
    if (!rest.startsWith(prefix)) return null;
    candidate = rest.slice(prefix.length);
    try { candidate = decodeURIComponent(candidate); } catch { return null; }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return null; // some other URL
  }
  if (candidate.length > PATH_MAX) return null;
  return RFP_ATTACHMENT_PATH_RE.test(candidate) ? candidate : null;
}

/** True when a stored value points into this bucket (a path or a legacy URL). */
export function isRfpAttachmentRef(stored: string | null | undefined): boolean {
  return rfpAttachmentPath(stored) !== null;
}

/** The file name a person sees for a stored value ("1759900000000_plans.pdf" → "plans.pdf"). */
export function rfpAttachmentDisplayName(stored: string): string {
  const path = rfpAttachmentPath(stored) ?? stored.split('?')[0];
  const last = path.split('/').pop() ?? '';
  const name = last.replace(/^\d+_/, '');
  return name.length > 0 ? name : 'attachment';
}

const isHttp = (v: string): boolean => /^https?:\/\//i.test(v);

/** What to show when a value could not be signed: a legacy URL as stored (it still opens while the bucket is public), else nothing. */
export function rfpAttachmentFallback(stored: string): string {
  return isHttp(stored) ? stored : '';
}

/**
 * Stored values → viewable links, batched. Every input gets an entry:
 * a signed link when Storage grants one, else rfpAttachmentFallback(stored).
 * A value that is not in this bucket at all maps to itself. Never throws.
 */
export async function resolveRfpAttachmentUrls(values: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byPath = new Map<string, string[]>();
  for (const v of values) {
    if (typeof v !== 'string' || v.length === 0 || out.has(v)) continue;
    const path = rfpAttachmentPath(v);
    if (!path) { out.set(v, v); continue; }
    out.set(v, rfpAttachmentFallback(v));
    const list = byPath.get(path);
    if (list) list.push(v); else byPath.set(path, [v]);
  }
  const paths = [...byPath.keys()];
  if (!isSupabaseConfigured || paths.length === 0) return out;
  const CHUNK = 100;
  for (let i = 0; i < paths.length; i += CHUNK) {
    try {
      const { data, error } = await supabase.storage
        .from(RFP_ATTACHMENT_BUCKET)
        .createSignedUrls(paths.slice(i, i + CHUNK), RFP_ATTACHMENT_URL_TTL_SECONDS);
      if (error || !data) continue;
      for (const entry of data) {
        const path = (entry as { path?: string | null }).path;
        const signedUrl = (entry as { signedUrl?: string | null }).signedUrl;
        if (!path || !signedUrl) continue;
        for (const stored of byPath.get(path) ?? []) out.set(stored, signedUrl);
      }
    } catch { /* offline: the fallbacks stand */ }
  }
  return out;
}

/** One fresh link, minted at the tap (a link from page load may have expired). '' when nothing can be opened. */
export async function signRfpAttachment(stored: string): Promise<string> {
  const map = await resolveRfpAttachmentUrls([stored]);
  return map.get(stored) ?? '';
}

/**
 * For a screen: hand in the stored values, get back a function from a stored
 * value to what an <Image> may load ('' until resolved, or when it cannot be).
 * Re-resolves when the list changes.
 */
export function useRfpAttachmentUrls(values: readonly (string | null | undefined)[]): (stored: string | null | undefined) => string {
  const key = useMemo(() => values.filter((v): v is string => typeof v === 'string' && v.length > 0).join('\n'), [values]);
  const [resolved, setResolved] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    let cancelled = false;
    const list = key.length > 0 ? key.split('\n') : [];
    if (list.length === 0) { setResolved(new Map()); return; }
    void resolveRfpAttachmentUrls(list).then((map) => { if (!cancelled) setResolved(map); });
    return () => { cancelled = true; };
  }, [key]);
  return useMemo(() => (stored) => {
    if (typeof stored !== 'string' || stored.length === 0) return '';
    const hit = resolved.get(stored);
    if (hit !== undefined) return hit;
    // Not resolved yet: a value outside this bucket is shown as it is; one
    // inside it waits for its link.
    return isRfpAttachmentRef(stored) ? '' : stored;
  }, [resolved]);
}
