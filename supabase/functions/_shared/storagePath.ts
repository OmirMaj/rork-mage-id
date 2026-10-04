// storagePath — the ONE rule for a storage path that is about to be handed to
// a service-role storage call.
//
// WHY THIS EXISTS (security review 2026-10-04). Four functions took a path that
// did not start life on this server — a request body, or a free-text column the
// app writes — checked the FIRST part of it (`startsWith('<uid>/')`, or "the
// first segment is my project and no segment is exactly '..'"), and then gave
// the RAW string to `storage.from(bucket).download(path)` /
// `.createSignedUrl(path)` with the service role.
//
// The storage client does not encode the path. It builds
// `${url}/object/${bucket}/${path}` and hands that to fetch(), which parses it
// as a WHATWG URL — and that parser treats `%2e%2e`, `.%2E`, `%2E%2E`, a
// backslash, and a dot segment with a tab / CR / LF inside it as REAL `..`
// segments. So `<my-project>/%2e%2e/<your-project>/<file>.png` passed every
// first-segment check and read another tenant's object; two of them reached
// another bucket.
//
// THE RULE. A path is accepted only when it is EXACTLY the shape a writer of
// that bucket produces:
//   • a string, 1..STORAGE_PATH_MAX_LENGTH characters, never trimmed or repaired;
//   • no '%', no backslash, no '?', no '#', no whitespace, no control character,
//     nothing outside ASCII (every encoded or look-alike dot form carries one);
//   • no leading or trailing slash, no empty / '.' / '..' segment;
//   • exactly as many segments as the shape names, EACH matched against its own
//     pattern — an id as Postgres / crypto.randomUUID() / GoTrue print one
//     (lowercase canonical uuid), or a file name `[A-Za-z0-9][A-Za-z0-9._-]*`
//     ending in an extension the bucket's writers use;
//   • any segment the caller pins (the user id, the project id) equals it;
//   • and `new URL('https://h/' + path).pathname === '/' + path` — the parser
//     that will see the path must not change one byte of it.
// The answer is the SAME string or null. Refuse, never repair: a "cleaned"
// path is a second string nobody checked.
//
// Access checks then read the id segment of that validated string, and the
// storage call is given that same string.
//
// PURE: no Deno.*, no URL imports — Deno functions and bun scripts import the
// same file (scripts/validate-storage-paths.ts runs this exact code against an
// attack corpus and sweeps every storage call in supabase/functions/**).

/** Longest path any writer produces is ~140 characters (pdf-uploads). */
export const STORAGE_PATH_MAX_LENGTH = 256;
/** Longest file name any writer produces is ~101 characters (pdf-uploads). */
export const STORAGE_FILE_NAME_MAX_LENGTH = 128;

/** A lowercase canonical uuid — how gen_random_uuid(), crypto.randomUUID() and
 *  GoTrue's `sub` print one. Uppercase / braced / hyphenless spellings parse as
 *  the same uuid in Postgres but are a DIFFERENT storage folder, so they are not ids here. */
const STORAGE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STORAGE_FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** '%', backslash, '?', '#', any whitespace, any control character, anything outside ASCII. */
// deno-lint-ignore no-control-regex
const STORAGE_FORBIDDEN_CHAR_RE = /[%\\?#\s\u0000-\u001f\u007f-\uffff]/;

export function isStorageId(value: unknown): value is string {
  return typeof value === 'string' && STORAGE_ID_RE.test(value);
}

export type StorageSegmentRule =
  | { readonly kind: 'id' }
  | { readonly kind: 'file'; readonly extensions: readonly string[] }
  /** `<id>.<ext>`: a file whose whole name is an id, then one dot, then an extension the writers use. */
  | { readonly kind: 'idFile'; readonly extensions: readonly string[] }
  | { readonly kind: 'literal'; readonly value: string };

export interface StoragePathShape {
  /** The bucket whose writers produce this shape. */
  readonly bucket: string;
  /** One rule per segment. The count is fixed: more or fewer segments is a refusal. */
  readonly segments: readonly StorageSegmentRule[];
}

const ID: StorageSegmentRule = { kind: 'id' };
const file = (...extensions: string[]): StorageSegmentRule => ({ kind: 'file', extensions });
const idFile = (...extensions: string[]): StorageSegmentRule => ({ kind: 'idFile', extensions });

// ── The shapes, each read from its WRITERS ──────────────────────────────────

/**
 * plan-sheets: `<project id>/<file>.png|jpg`.
 *   server  convert-pdf-to-images     `<project>/<uuid>-page-<N>.png`   (planSheetPagePath below)
 *   app     utils/planSheetImageCore  `<project>/img-<id>.jpg|png`      (buildPlanSheetImagePath)
 * A first segment that is not a project id — the legacy shared `tmp/` — is
 * refused on purpose: no membership check can be made for it.
 */
export const PLAN_SHEET_PATH: StoragePathShape = { bucket: 'plan-sheets', segments: [ID, file('png', 'jpg')] };

/**
 * pdf-uploads: `<user id>/<uuid>-<safe name>.pdf`.
 *   app     utils/pdfRenderClient.ts  (the name is reduced to [a-zA-Z0-9._-], 60 chars, `.pdf` appended)
 */
export const PDF_UPLOAD_PATH: StoragePathShape = { bucket: 'pdf-uploads', segments: [ID, file('pdf')] };

/**
 * secure-contracts: `<user id>/<contract id>.pdf`.
 *   app     utils/contractSealing.ts  (rebuilt here by contractPdfPath)
 */
export const CONTRACT_PDF_PATH: StoragePathShape = { bucket: 'secure-contracts', segments: [ID, file('pdf')] };

/**
 * project-photos, a punch item's after photo: `<user id>/<project id>/<file>.<image ext>`.
 *   app     contexts/ProjectContext.tsx stagePunchAfterPhoto → utils/photoUploadCore buildPhotoStoragePath
 *           (`punch-<item id>-after.<ext>`, ext from photoExtFromUri)
 */
export const PUNCH_AFTER_PHOTO_PATH: StoragePathShape = {
  bucket: 'project-photos',
  segments: [ID, ID, file('jpg', 'jpeg', 'png', 'heic', 'heif', 'webp')],
};

/** punch-seals, a copied after photo: `<user id>/<seal id>/<item id>.jpg` (seal-punch writes it). */
export const PUNCH_SEAL_PHOTO_PATH: StoragePathShape = { bucket: 'punch-seals', segments: [ID, ID, file('jpg')] };

/** punch-seals, the sealed record: `<user id>/<seal id>/record.pdf` (utils/punchSealShare.ts uploads it). */
export const PUNCH_SEAL_RECORD_PATH: StoragePathShape = {
  bucket: 'punch-seals',
  segments: [ID, ID, { kind: 'literal', value: 'record.pdf' }],
};

/**
 * message-attachments: `<project id>/<message id>/<attachment id>.jpg|png|webp|pdf`.
 *   server  _shared/messageFiles.ts pathFor         (portal-message-files signs the upload for exactly this key)
 *   app     utils/messageAttachments.ts messageAttachmentPath
 *   db      trg_validate_portal_msg_attachments refuses a row whose path is anything else
 *           (supabase/migrations/20261001150000_portal_message_attachments.sql)
 * All three parts are ids, lower-cased by both writers; the extension comes
 * from the file's type and is one of the four the bucket allows.
 */
export const MESSAGE_ATTACHMENT_PATH: StoragePathShape = {
  bucket: 'message-attachments',
  segments: [ID, ID, idFile('jpg', 'png', 'webp', 'pdf')],
};

// ── The layers. Each is exported so the guard can test it ALONE: with two
//    layers refusing the same input, a behaviour test of the whole rule cannot
//    see one of them being removed. ─────────────────────────────────────────

/** True when the path carries a byte no writer produces and a URL parser may rewrite. */
export function storagePathHasForbiddenChar(path: string): boolean {
  return STORAGE_FORBIDDEN_CHAR_RE.test(path);
}

/** The segments, or null for a leading / trailing slash or an empty, '.' or '..' segment. */
export function storagePathSegments(path: string): string[] | null {
  if (path.length === 0) return null;
  const segments = path.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return null;
  }
  return segments;
}

/** True when ONE segment is what its rule says it is. */
export function storageSegmentMatches(segment: string, rule: StorageSegmentRule): boolean {
  if (rule.kind === 'id') return STORAGE_ID_RE.test(segment);
  if (rule.kind === 'literal') return segment === rule.value;
  if (rule.kind === 'idFile') {
    // An id is 36 characters, so the one dot of `<id>.<ext>` sits at index 36.
    const stem = segment.slice(0, 36);
    return STORAGE_ID_RE.test(stem) && segment.charAt(36) === '.' && rule.extensions.includes(segment.slice(37));
  }
  if (segment.length > STORAGE_FILE_NAME_MAX_LENGTH) return false;
  if (!STORAGE_FILE_NAME_RE.test(segment)) return false;
  const dot = segment.lastIndexOf('.');
  if (dot <= 0) return false;
  return rule.extensions.includes(segment.slice(dot + 1));
}

/** True when the URL parser that will carry the path leaves every byte of it alone. */
export function storagePathSurvivesUrlParser(path: string): boolean {
  try {
    const url = new URL('https://h/' + path);
    return url.pathname === '/' + path && url.search === '' && url.hash === '' && url.host === 'h';
  } catch {
    return false;
  }
}

/**
 * THE RULE. `raw` is returned unchanged when it is exactly `shape`, and null
 * otherwise. `pinned` maps a segment index to the value it must equal (the
 * caller's user id, the project the caller was checked against).
 *
 * The string this returns is the string to check access on AND the string to
 * hand to storage. Never the input again.
 */
export function requestStoragePath(
  raw: unknown,
  shape: StoragePathShape,
  pinned: Readonly<Record<number, string>> = {},
): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > STORAGE_PATH_MAX_LENGTH) return null;
  if (storagePathHasForbiddenChar(raw)) return null;
  const segments = storagePathSegments(raw);
  if (!segments || segments.length !== shape.segments.length) return null;
  for (let i = 0; i < segments.length; i++) {
    if (!storageSegmentMatches(segments[i], shape.segments[i])) return null;
  }
  for (const index of Object.keys(pinned)) {
    if (segments[Number(index)] !== pinned[Number(index)]) return null;
  }
  if (!storagePathSurvivesUrlParser(raw)) return null;
  return raw;
}

/** Segment `index` of a path requestStoragePath already returned ('' when there is none). */
export function storagePathSegment(path: string, index: number): string {
  return path.split('/')[index] ?? '';
}

// ── Builders: a key the SERVER assembles. Every part is an id or a number, and
//    the result still goes through the rule — so a builder cannot emit a key a
//    reader would refuse, and a storage call never sees an inline template. ──

/** `<project id>/<base id>-page-<N>.png` in plan-sheets, or null. */
export function planSheetPagePath(projectId: unknown, baseId: unknown, pageNumber: unknown): string | null {
  if (!isStorageId(projectId) || !isStorageId(baseId)) return null;
  if (typeof pageNumber !== 'number' || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 100000) return null;
  return requestStoragePath(`${projectId}/${baseId}-page-${pageNumber}.png`, PLAN_SHEET_PATH, { 0: projectId });
}

/** `<user id>/<contract id>.pdf` in secure-contracts, or null. */
export function contractPdfPath(userId: unknown, contractId: unknown): string | null {
  if (!isStorageId(userId) || !isStorageId(contractId)) return null;
  return requestStoragePath(`${userId}/${contractId}.pdf`, CONTRACT_PDF_PATH, { 0: userId });
}

/** `<user id>/<seal id>/<item id>.jpg` in punch-seals, or null. */
export function punchSealPhotoPath(userId: unknown, sealId: unknown, itemId: unknown): string | null {
  if (!isStorageId(userId) || !isStorageId(sealId) || !isStorageId(itemId)) return null;
  return requestStoragePath(`${userId}/${sealId}/${itemId}.jpg`, PUNCH_SEAL_PHOTO_PATH, { 0: userId, 1: sealId });
}

/** `<user id>/<seal id>/record.pdf` in punch-seals, or null. */
export function punchSealRecordPath(userId: unknown, sealId: unknown): string | null {
  if (!isStorageId(userId) || !isStorageId(sealId)) return null;
  return requestStoragePath(`${userId}/${sealId}/record.pdf`, PUNCH_SEAL_RECORD_PATH, { 0: userId, 1: sealId });
}
