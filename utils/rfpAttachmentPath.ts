// utils/rfpAttachmentPath.ts — the pure half of utils/rfpAttachmentUrls.ts:
// which stored values point into the `rfp-attachments` bucket, and at what
// path. No react, no supabase, no storage: scripts/validate-rfp-attachments-
// private.ts runs every function here under bun and pins the path shape equal
// to supabase/functions/_shared/storagePath.ts RFP_ATTACHMENT_PATH.
// Read utils/rfpAttachmentUrls.ts for why this exists.

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

// ── what a new upload stores ────────────────────────────────────────────────

export type RfpAttachmentStoredForm = 'public_url' | 'path';

/**
 * THE ONE SWITCH for what utils/storage.ts uploadRfpAttachment writes into
 * public_bids.photo_urls / drawing_urls.
 *
 *   'public_url'  the legacy public URL. It is the only value a phone still on
 *                 an older build can render, and it is what award_rfp copies
 *                 into the winner's project and the award email. Keep this
 *                 while the bucket is public.
 *   'path'        the bare path <owner id>/<posting id>/<digits>_<name>.
 *
 * WHEN TO CHANGE IT: to 'path', in the first app update published AFTER
 * supabase/migrations/20261010140000_rfp_attachments_flip.sql has been applied
 * (once the bucket is private a public URL opens for nobody, so nothing is
 * lost by no longer storing one). Not before: between this release and the
 * flip, a bare path is a blank photo on every older build.
 *
 * Either way this build reads BOTH forms: rfpAttachmentPath() recovers the
 * path from a URL or a path, and the screens sign it. The validator proves it
 * for both values of this constant, with the bucket public and private.
 */
export const RFP_ATTACHMENT_STORED_FORM: RfpAttachmentStoredForm = 'public_url';

/**
 * The value to store for a file just uploaded at `path`. Null when `path` is
 * not a writer's key. With form 'public_url' and no project URL to build one
 * from, the bare path is stored (this build still signs it).
 * This is the ONLY place a /object/public/ URL for this bucket is built, and
 * it is built to be STORED, never rendered: every reader maps it back to a
 * path and signs it.
 */
export function rfpAttachmentStoredValue(
  path: string,
  supabaseUrl: string | null | undefined,
  form: RfpAttachmentStoredForm = RFP_ATTACHMENT_STORED_FORM,
): string | null {
  if (typeof path !== 'string' || path.length > PATH_MAX || !RFP_ATTACHMENT_PATH_RE.test(path)) return null;
  if (form === 'path') return path;
  const base = typeof supabaseUrl === 'string' ? supabaseUrl.trim().replace(/\/+$/, '') : '';
  if (!/^https:\/\/[^/\s]+$/i.test(base)) return path;
  return `${base}/storage/v1/object/public/${RFP_ATTACHMENT_BUCKET}/${path}`;
}

const isHttp = (v: string): boolean => /^https?:\/\//i.test(v);

/**
 * What to show when a value IN THIS BUCKET could not be signed: a legacy URL
 * as stored (it still opens while the bucket is public), else nothing. A value
 * that is not in this bucket is never shown or opened: it gets ''.
 */
export function rfpAttachmentFallback(stored: string): string {
  return isHttp(stored) && rfpAttachmentPath(stored) !== null ? stored : '';
}

/**
 * What one stored value resolves to, given what Storage answered for its path
 * (a signed link, or nothing). The whole read rule in one pure function:
 *   not in this bucket          '' (dropped: never rendered, never opened)
 *   in the bucket, signed       the signed link
 *   in the bucket, not signed   the stored public URL if that is what was
 *                               stored (works only while the bucket is public),
 *                               else ''
 */
export function rfpAttachmentResolved(stored: string | null | undefined, signedUrl: string | null | undefined): string {
  if (typeof stored !== 'string' || rfpAttachmentPath(stored) === null) return '';
  if (typeof signedUrl === 'string' && signedUrl.length > 0) return signedUrl;
  return rfpAttachmentFallback(stored);
}
