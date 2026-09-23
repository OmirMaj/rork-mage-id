// signed-media-urls/core.ts — the pure half of the function (no Deno, no I/O),
// so scripts/validate-w4-portal-server-media.ts can run every rule under bun.
//
// Two private buckets have public readers who hold no Supabase session:
//   • project-photos — the homeowner portal (#14). Photos were published as
//     the GC's file:// camera URI or a 24-hour signed link baked into the
//     snapshot, so the page showed broken images. The snapshot now carries
//     photo ids; this function signs them per read, for an hour.
//   • plan-sheets — the architect's RFI page (the plans lane's carry): the
//     sheet a pin sits on, signed per read instead of a URL that dies.
// A minted URL is an unrevocable bearer token, so every rule below decides
// what may be signed from the LIVE rows, never from what the caller sends.

export const SIGNED_URL_TTL_SECONDS = 3600;
export const PHOTO_BUCKET = 'project-photos';
export const PLAN_SHEET_BUCKET = 'plan-sheets';
/** One page load asks for at most this many; more is refused, not truncated. */
export const MAX_ITEMS = 100;

export type MediaRequest =
  | { kind: 'portal_photos'; portalId: string; token: string; photoIds: string[] }
  | { kind: 'rfi_sheets'; shareToken: string; paths: string[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v.trim() : null;

/** The request body, or null when it is not one of the two shapes (400). */
export function parseMediaRequest(body: unknown): MediaRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.kind === 'portal_photos') {
    const portalId = str(b.portalId, 200);
    const token = str(b.token, 400);
    if (!portalId || !token || !Array.isArray(b.photoIds)) return null;
    if (b.photoIds.length > MAX_ITEMS) return null;
    // Ids are uuids (photos.id); anything else can never match a row.
    const photoIds = [...new Set(b.photoIds.filter(isUuid).map((s) => s.toLowerCase()))];
    // A `passcode` field is deliberately never read. The snapshot itself is
    // served on the access token alone (portal_get_snapshot_v2 — the passcode
    // is a secondary, page-side control), so the token is this function's
    // gate too. Checking a supplied passcode here would answer 401 for a wrong
    // one and 200 for the right one: a passcode oracle outside
    // validate-portal-passcode's 10/h-per-portal and 30/h-per-IP ceilings.
    return { kind: 'portal_photos', portalId, token, photoIds };
  }
  if (b.kind === 'rfi_sheets') {
    if (!isUuid(b.shareToken) || !Array.isArray(b.paths)) return null;
    if (b.paths.length > MAX_ITEMS) return null;
    const paths = [...new Set(b.paths.filter((p): p is string => typeof p === 'string' && p.length > 0 && p.length <= 2000))];
    return { kind: 'rfi_sheets', shareToken: b.shareToken.toLowerCase(), paths };
  }
  return null;
}

/** The app's isShared() / SQL portal_state_is_shared: no state, or 'sent'. */
export function portalStateIsShared(ps: unknown): boolean {
  if (ps == null) return true;
  if (typeof ps !== 'object') return false;
  return (ps as { status?: unknown }).status === 'sent';
}

/**
 * The photo ids the GC PUBLISHED in this portal's stored snapshot: the photos
 * section and the hero. A token holder can only have photos signed that the
 * owner's device put on the page — a photo shot on the job but never shared
 * (or a portal with photos switched off) is never reachable by guessing ids.
 */
export function publishedPhotoIds(snapshot: unknown): Set<string> {
  const out = new Set<string>();
  if (!snapshot || typeof snapshot !== 'object') return out;
  const s = snapshot as { sections?: { photos?: unknown }; project?: { heroPhotoId?: unknown } };
  const photos = s.sections && typeof s.sections === 'object' ? s.sections.photos : undefined;
  if (Array.isArray(photos)) {
    for (const p of photos) {
      const id = p && typeof p === 'object' ? (p as { id?: unknown }).id : undefined;
      if (isUuid(id)) out.add(id.toLowerCase());
    }
  }
  const hero = s.project && typeof s.project === 'object' ? s.project.heroPhotoId : undefined;
  if (isUuid(hero)) out.add(hero.toLowerCase());
  return out;
}

const DEVICE_LOCAL = /^(file|blob|data|content|ph|assets-library):/i;
const hasTraversal = (key: string): boolean => key.split('/').some((seg) => seg === '..' || seg === '.' || seg === '');

/** A Supabase Storage object URL for `bucket` reduced to its key, else ''. */
function keyFromStorageUrl(url: string, bucket: string): string {
  for (const marker of [`/storage/v1/object/public/${bucket}/`, `/storage/v1/object/sign/${bucket}/`, `/storage/v1/object/${bucket}/`]) {
    const at = url.indexOf(marker);
    if (at < 0) continue;
    const tail = url.slice(at + marker.length);
    const q = tail.indexOf('?');
    const raw = q >= 0 ? tail.slice(0, q) : tail;
    try { return decodeURIComponent(raw); } catch { return raw; }
  }
  return '';
}

export type PhotoSource = { sign: string } | { pass: string } | null;

/**
 * What a live photos row can be served as. `photos.uri` holds the bucket key
 * `<userId>/<projectId>/<photoId>.<ext>` (utils/photoUploadCore
 * buildPhotoStoragePath). The key's PROJECT folder must be the row's own
 * project: an editor on this job could otherwise write another tenant's key
 * into a row here and have the service role sign it. A Supabase URL for the
 * bucket (a legacy signed link that has since expired) is re-signed by its
 * key under the same rule; any other http(s) link passes through as it is
 * (the old public rows); a file:// / blob: / data: URI never left the device
 * that took it — there is nothing to sign.
 */
export function photoSource(uri: unknown, projectId: string): PhotoSource {
  if (typeof uri !== 'string') return null;
  const v = uri.trim();
  if (!v || DEVICE_LOCAL.test(v)) return null;
  let key = v;
  if (/^https?:\/\//i.test(v)) {
    key = keyFromStorageUrl(v, PHOTO_BUCKET);
    if (!key) return /\/storage\/v1\/object\//.test(v) ? null : { pass: v };
  } else if (v.includes('://') || v.startsWith('/')) {
    return null;
  }
  if (hasTraversal(key)) return null;
  const segs = key.split('/');
  if (segs.length < 3 || segs[1].toLowerCase() !== projectId.toLowerCase()) return null;
  return { sign: key };
}

/**
 * A plan-sheets key the architect's share token may have signed: reduced from
 * whatever the page holds (a key, or a public / signed URL — the three shapes
 * utils/planSheetUrls.planSheetStoragePath recovers) and inside the RFI's own
 * project folder (`<projectId>/…`, the bucket's tenant boundary). '' = refuse.
 */
export function rfiSheetKey(uriOrPath: string, projectId: string): string {
  const raw = String(uriOrPath ?? '').trim();
  if (!raw || DEVICE_LOCAL.test(raw)) return '';
  let key: string;
  if (/^https?:\/\//i.test(raw)) {
    key = keyFromStorageUrl(raw, PLAN_SHEET_BUCKET);
  } else {
    if (raw.includes('://')) return '';
    key = raw.replace(/^\/+/, '');
  }
  if (!key || hasTraversal(key)) return '';
  const segs = key.split('/');
  if (segs.length < 2 || segs[0].toLowerCase() !== projectId.toLowerCase()) return '';
  return key;
}

/**
 * The plan-sheets keys an RFI actually references: its `attachments` (the
 * app stores each drawing as its key, #93) and the sheets of the drawing pins
 * linked to it — the same rows get_rfi_by_token hands the architect's page.
 * rfi_sheets signs only the intersection of what the caller asks for with
 * this set, so one RFI's reply link cannot mint links for every other sheet
 * in the project folder whose key its holder happens to know. Every entry
 * goes through rfiSheetKey, so the project-folder rule still applies.
 */
export function rfiReferencedSheetKeys(attachments: unknown, pinSheetPaths: unknown[], projectId: string): Set<string> {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v !== 'string') return;
    const key = rfiSheetKey(v, projectId);
    if (key) out.add(key);
  };
  if (Array.isArray(attachments)) attachments.forEach(add);
  (Array.isArray(pinSheetPaths) ? pinSheetPaths : []).forEach(add);
  return out;
}

/**
 * rfi_sheets' signing plan: each key the caller may have signed → the paths
 * it asked under (the answer is keyed by the caller's own spelling). A path
 * is dropped when it does not reduce to a key in the RFI's project folder, or
 * when that key is not one the RFI references (rfiReferencedSheetKeys).
 */
export function rfiSheetKeysToSign(paths: string[], projectId: string, referenced: Set<string>): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const p of paths) {
    const key = rfiSheetKey(p, projectId);
    if (!key || !referenced.has(key)) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), p]);
  }
  return byKey;
}
