// utils/coiFiles.ts — where a certificate of insurance file lives, and how to
// show it on any device.
//
// WHY THIS EXISTS (audit #26 / #66). COI Vault stored the ImagePicker result
// itself — `file:///…/ImagePicker/xyz.jpg` on the iPhone, a `blob:` URL on the
// web — as CertificateOfInsurance.fileUri, and rendered it raw. On the web, on
// a second phone, or after iOS purged its caches, the card was blank: the
// owner or lender asks for the sub's COI and there is no file. Scan Anything
// wrote a 7-day signed URL instead, which breaks a week later on every device.
//
// CONTRACT 7 (wave 5). fileUri holds one of:
//   a) 'sub-documents:<subId>/coi-<coiId>.<ext>' — uploaded from the COI vault
//      into the PRIVATE sub-documents bucket (its INSERT policy requires the
//      first folder to be one of the caller's subcontractors; SELECT is
//      owner = auth.uid());
//   b) a bare project-documents path '<projectId>/<folder>/<file>' — what Scan
//      Anything files (ProjectFile.path);
// never a signed / public URL or a device-local URI on a NEW row. Older rows
// may still hold a signed or public project-documents URL (re-signed from the
// path it carries), an unrelated https URL (shown as is), or a device-local
// URI (unrecoverable anywhere but the phone that picked it — the card says so).
//
// A file picked while offline is NOT written into fileUri: the vault keeps the
// local URI in a device-only pending map (mageid_coi_pending_uploads) and shows
// it as a preview labelled "Not uploaded yet — only on this phone" until the
// upload lands, so a device path never reaches the server row.

import { supabase } from '@/lib/supabase';
import { resolveProjectFileUrl } from '@/utils/projectFiles';
import type { COICoverage, Subcontractor } from '@/types';

export const SUB_DOCUMENTS_BUCKET = 'sub-documents';
/** fileUri scheme for an object in the sub-documents bucket (CONTRACT 7a).
 *  Not a storage key — named _SCHEME so scripts/validate-storage-hygiene's
 *  *_KEY / *_PREFIX const scan does not read it as one. */
export const SUB_DOCUMENTS_SCHEME = 'sub-documents:';
/** A COI file URL is minted per view and lives one hour; it is never stored. */
export const COI_FILE_URL_TTL_SECONDS = 3600;
/** A W-9 is opened on demand; the link lives five minutes and is never stored. */
export const W9_URL_TTL_SECONDS = 300;

/** Device-only map of COI files waiting to upload (see header). */
export const COI_PENDING_UPLOADS_KEY = 'mageid_coi_pending_uploads';

const DEVICE_LOCAL_SCHEME = /^(file|blob|data|content|ph|assets-library):/i;

/**
 * CONTRACT 27 local type extensions — w5-join-core folds these into
 * types/index.ts and deletes the aliases.
 *
 * COICoverageW5: `source` says who wrote the row. 'ai' rows are what the model
 * read off the certificate and show as UNCONFIRMED until the GC confirms them
 * (confirming rewrites the row as 'manual' with `confirmedAt`). A row with no
 * `source` predates this and is shown as it always was.
 *
 * The DATES the model read never go into effectiveDate / expiresAt. Those two
 * fields are what ProjectContext.syncSubCoiExpiry (subCoiExpiryAcross) writes
 * to subcontractors.coi_expiry — which drives the 30 / 14 / 7-day reminders,
 * the vault badge and the award gate, and stamps coiVerifiedAt. A misread EXP
 * date would otherwise clear a lapsed sub for award (review round 1). The
 * model's days sit in aiEffectiveDate / aiExpiresAt as SUGGESTIONS the card
 * shows as "AI read: … — unconfirmed"; Confirm (or picking the date) moves a
 * suggestion into the real field — see confirmAiCoverage / pickCoverageDate.
 */
export type COICoverageW5 = COICoverage & {
  source?: 'ai' | 'manual';
  confirmedAt?: string;
  /** Model-read effective day (YYYY-MM-DD), unconfirmed. Never counted. */
  aiEffectiveDate?: string;
  /** Model-read expiry day (YYYY-MM-DD), unconfirmed. Never counted. */
  aiExpiresAt?: string;
};

/** True while any part of the row is still only what the model read. */
export function hasUnconfirmedAi(c: COICoverageW5): boolean {
  return c.source === 'ai' || !!c.aiExpiresAt || !!c.aiEffectiveDate;
}

/**
 * The GC checked the row against the certificate: every AI-read day he hasn't
 * already typed moves into the real field, and the row becomes his.
 */
export function confirmAiCoverage(c: COICoverageW5, now: Date = new Date()): COICoverageW5 {
  const { aiEffectiveDate, aiExpiresAt, ...rest } = c;
  return {
    ...rest,
    effectiveDate: c.effectiveDate || aiEffectiveDate || undefined,
    expiresAt: c.expiresAt || aiExpiresAt || undefined,
    source: 'manual',
    confirmedAt: now.toISOString(),
  };
}

/**
 * The GC picked a date himself: it goes into the real field and the matching
 * AI suggestion is dropped. The row becomes 'manual' once no AI-read day is
 * left waiting; an AI-read day on the OTHER field stays a suggestion — picking
 * the expiry is not a confirmation of the effective date.
 */
export function pickCoverageDate(
  c: COICoverageW5,
  field: 'effectiveDate' | 'expiresAt',
  day: string,
  now: Date = new Date(),
): COICoverageW5 {
  const next: COICoverageW5 = { ...c, [field]: day };
  if (field === 'expiresAt') delete next.aiExpiresAt;
  else delete next.aiEffectiveDate;
  if (!next.aiExpiresAt && !next.aiEffectiveDate && next.source === 'ai') {
    next.source = 'manual';
    next.confirmedAt = now.toISOString();
  }
  return next;
}

/** SubcontractorW5: the W-9's storage path in sub-documents (CONTRACT 17,
 *  subcontractors.w9_doc_path). */
export type SubcontractorW5 = Subcontractor & { w9DocPath?: string };

/** The storage path a vault upload goes to: '<subId>/coi-<coiId>.<ext>'. */
export function coiStoragePath(subId: string, coiId: string, ext: string): string {
  const clean = (ext || '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  return `${subId}/coi-${coiId}.${clean}`;
}

/** The fileUri to store for a vault upload (CONTRACT 7a). */
export function subDocumentsFileUri(path: string): string {
  return `${SUB_DOCUMENTS_SCHEME}${path.replace(/^\/+/, '')}`;
}

/** Extension + content type for a picked file, from its mime type first
 *  (DocumentPicker names can lie; web blob: URIs have no extension at all). */
export function coiFileType(opts: { name?: string | null; uri?: string | null; mimeType?: string | null }): { ext: string; contentType: string } {
  const mime = (opts.mimeType ?? '').toLowerCase();
  if (mime === 'application/pdf') return { ext: 'pdf', contentType: 'application/pdf' };
  if (mime === 'image/png') return { ext: 'png', contentType: 'image/png' };
  if (mime === 'image/heic' || mime === 'image/heif') return { ext: 'heic', contentType: mime };
  if (mime === 'image/webp') return { ext: 'webp', contentType: 'image/webp' };
  if (mime === 'image/jpeg' || mime === 'image/jpg') return { ext: 'jpg', contentType: 'image/jpeg' };
  const source = (opts.name || opts.uri || '').split('?')[0];
  const dot = source.lastIndexOf('.');
  const ext = dot >= 0 ? source.slice(dot + 1).toLowerCase() : '';
  if (ext === 'pdf') return { ext: 'pdf', contentType: 'application/pdf' };
  if (ext === 'png') return { ext: 'png', contentType: 'image/png' };
  if (ext === 'heic' || ext === 'heif') return { ext: 'heic', contentType: 'image/heic' };
  if (ext === 'webp') return { ext: 'webp', contentType: 'image/webp' };
  return { ext: 'jpg', contentType: 'image/jpeg' };
}

/** True for a PDF certificate — rendered as an "Open certificate" row, never
 *  through <Image>, which draws nothing for a PDF. */
export function isPdfCoiFile(fileUri: string | null | undefined): boolean {
  return /\.pdf(?:$|\?)/i.test(String(fileUri ?? '').trim());
}

/** What the card can say about where the file is before any network call. */
export type CoiFileLocation = 'none' | 'stored' | 'device' | 'external';

export function coiFileLocation(fileUri: string | null | undefined): CoiFileLocation {
  const raw = String(fileUri ?? '').trim();
  if (!raw) return 'none';
  if (DEVICE_LOCAL_SCHEME.test(raw)) return 'device';
  if (raw.startsWith(SUB_DOCUMENTS_SCHEME)) return 'stored';
  if (/^https?:\/\//i.test(raw)) return /\/storage\/v1\/object\//.test(raw) ? 'stored' : 'external';
  return 'stored';
}

/**
 * A URL that shows the certificate now, or '' when there is none this device
 * can reach: a device-local URI (the file only ever existed on the phone that
 * picked it), a storage object that won't sign (offline, deleted, or another
 * account's), or nothing stored. The caller renders '' as "Certificate file not
 * on this device — re-upload", never as a blank image.
 */
export async function resolveCoiFileUrl(fileUri: string | null | undefined): Promise<string> {
  const raw = String(fileUri ?? '').trim();
  if (!raw) return '';
  if (DEVICE_LOCAL_SCHEME.test(raw)) return '';
  if (raw.startsWith(SUB_DOCUMENTS_SCHEME)) {
    const path = raw.slice(SUB_DOCUMENTS_SCHEME.length).replace(/^\/+/, '');
    if (!path) return '';
    try {
      const { data, error } = await supabase.storage
        .from(SUB_DOCUMENTS_BUCKET)
        .createSignedUrl(path, COI_FILE_URL_TTL_SECONDS);
      if (error || !data?.signedUrl) return '';
      return data.signedUrl;
    } catch {
      return '';
    }
  }
  // A bare project-documents path (Scan Anything) or a legacy signed / public
  // project-documents URL: re-signed from the path. Any other https URL comes
  // back unchanged and is shown as is. A bare path that failed to sign comes
  // back unchanged too — not something an <Image> can load, so it is ''.
  const resolved = await resolveProjectFileUrl(raw);
  return /^https?:\/\//i.test(resolved) ? resolved : '';
}

/** On-demand W-9 link (five minutes, never stored). '' when it won't sign. */
export async function signW9Url(path: string | null | undefined): Promise<string> {
  const p = String(path ?? '').trim().replace(/^\/+/, '');
  if (!p) return '';
  try {
    const { data, error } = await supabase.storage.from(SUB_DOCUMENTS_BUCKET).createSignedUrl(p, W9_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return '';
    return data.signedUrl;
  } catch {
    return '';
  }
}

/** One entry in the device-only pending-upload map. */
export interface PendingCoiUpload {
  coiId: string;
  subId: string;
  localUri: string;
  ext: string;
  contentType: string;
  /** The account that picked it — another account's entry is never uploaded. */
  userId: string;
  pickedAt: string;
  /** The local file vanished before it uploaded (iOS purged the picker cache,
   *  or the browser released the blob:) — the card asks for a re-upload. */
  lost?: boolean;
}
