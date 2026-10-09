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
// WHAT IS STORED. One constant decides: utils/rfpAttachmentPath.ts
// RFP_ATTACHMENT_STORED_FORM. Today it is 'public_url' (the legacy public URL,
// the one value a phone on an older build can render); after the bucket is
// flipped it becomes 'path'. rfpAttachmentPath() recovers the path from
// either, so every row keeps working for the people the bucket's read rule
// admits (the owner; any signed-in account while the posting is open; the
// awarded bidder after it closes).
//
// ORDERING. Two migrations: the read rule and its policy
// (20261010120000_rfp_attachments_private.sql, no gate) and, later, the flip
// (20261010140000_rfp_attachments_flip.sql, founder opt-in). This module works
// at every step:
//   no read policy yet   the signing call is refused; an in-bucket public URL
//                        is handed back as stored and still opens.
//   read policy, public  signing succeeds for the people allowed.
//   bucket private       signing succeeds for the people allowed; for anyone
//                        else the image is missing and a tap says "Could Not
//                        Open". Never a crash.
// A stored value that is NOT in this bucket (some other URL, a local file
// path, junk) is never rendered and never opened: it resolves to ''.
//
// No function here builds a /object/public/rfp-attachments/ URL. The one place
// that does is rfpAttachmentStoredValue (the value to STORE), and
// scripts/validate-rfp-attachments-private.ts fails the build if another
// appears or if a screen renders a stored value without going through here.

import { useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

import {
  RFP_ATTACHMENT_BUCKET,
  RFP_ATTACHMENT_URL_TTL_SECONDS,
  rfpAttachmentPath,
  rfpAttachmentResolved,
} from '@/utils/rfpAttachmentPath';

export {
  RFP_ATTACHMENT_BUCKET,
  RFP_ATTACHMENT_PATH_RE,
  RFP_ATTACHMENT_URL_TTL_SECONDS,
  isRfpAttachmentRef,
  rfpAttachmentDisplayName,
  rfpAttachmentFallback,
  rfpAttachmentPath,
  rfpAttachmentResolved,
  rfpAttachmentStoredValue,
  RFP_ATTACHMENT_STORED_FORM,
} from '@/utils/rfpAttachmentPath';

/**
 * Stored values to viewable links, batched. Every input gets an entry:
 * rfpAttachmentResolved(stored, the signed link Storage granted or nothing).
 * A value that is not in this bucket maps to '' (dropped). Never throws.
 */
export async function resolveRfpAttachmentUrls(values: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byPath = new Map<string, string[]>();
  for (const v of values) {
    if (typeof v !== 'string' || v.length === 0 || out.has(v)) continue;
    const path = rfpAttachmentPath(v);
    if (!path) { out.set(v, ''); continue; }
    out.set(v, rfpAttachmentResolved(v, null));
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
        for (const stored of byPath.get(path) ?? []) out.set(stored, rfpAttachmentResolved(stored, signedUrl));
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
    // Not resolved yet, or not in this bucket: nothing. A stored value is never
    // handed to an <Image> as it is.
    return resolved.get(stored) ?? '';
  }, [resolved]);
}
