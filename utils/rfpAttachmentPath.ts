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

const isHttp = (v: string): boolean => /^https?:\/\//i.test(v);

/** What to show when a value could not be signed: a legacy URL as stored (it still opens while the bucket is public), else nothing. */
export function rfpAttachmentFallback(stored: string): string {
  return isHttp(stored) ? stored : '';
}
