// projectDocuments — uploads to the `project-documents` Supabase
// Storage bucket so that exports from features like Daily Reports,
// AIA pay apps, COs, etc. land in the project's "shared drive" — the
// Procore-style Documents folder for the project.
//
// V1 scope: just the upload helper. The Documents browser (folder
// tree + filter chips + sharing toggles) ships in v1.1 — until then,
// a saved file is reachable via its publicUrl, surfaced wherever the
// caller chooses to remember it (e.g. on the DailyFieldReport record).
//
// Layout in the bucket:
//
//   project-documents/
//     <projectId>/
//       daily-reports/<reportId>.pdf
//       change-orders/<coId>.pdf
//       aia-pay-apps/<appId>.pdf
//       … (more document types as the Documents browser lands in v1.1)
//
// Auth: bucket is public-read (matches `plan-sheets`). Writes require
// authenticated session — RLS in `add_project_documents_bucket.sql`.

import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import { readAsBase64 } from '@/utils/platformFile';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { readFileBytes } from '@/utils/fileBytes';
import { resolvePhotoUrls } from '@/utils/storage';
import { isDeviceLocalUri, isHttpUrl, photoExtFromUri, contentTypeForExt } from '@/utils/photoUploadCore';
import { DFR_PDF_MAX_PHOTOS, DFR_PDF_EMBED_BUDGET_CHARS, type DfrDocumentPhoto } from '@/utils/pdfGenerator';
import type { DFRPhoto, PhotoMarkup } from '@/types';

const BUCKET = 'project-documents';

/** How long the link to a filed daily report works. The bucket is PRIVATE
 *  (20260612200000_storage_cross_tenant_lockdown), so the old getPublicUrl
 *  result was a dead link; a signed one is the only kind an email can carry. */
export const DFR_FILED_PDF_LINK_DAYS = 30;

/** Why the project-files copy is native-only — the same words the screen shows
 *  on the disabled switch (#27). */
export const PROJECT_FILES_NEEDS_APP =
  'Saving a PDF to project files needs the mobile app — use Print to keep a copy.';

export interface SaveDailyReportPdfArgs {
  projectId: string;
  reportId: string;
  /** Pre-rendered HTML that becomes the PDF body. */
  html: string;
  /** Pretty filename, e.g. "Daily Report — 2026-01-13.pdf". Slashes
   *  and other unsafe chars are stripped before upload. */
  fileName?: string;
}

export interface SavedDocument {
  storagePath: string;
  publicUrl: string;
  /** A signed link that works for DFR_FILED_PDF_LINK_DAYS, or null when the
   *  signing call failed (the file is still saved). */
  linkUrl: string | null;
  bytes: number;
}

/**
 * Render the supplied HTML to a PDF and upload it to
 * `project-documents/<projectId>/daily-reports/<reportId>.pdf`.
 *
 * Returns the public URL on success. Throws on failure (the caller
 * should surface the error so the user knows the save didn't land —
 * we deliberately don't swallow because a "send" path that silently
 * loses the project copy is a worse UX than a clear error toast).
 */
export async function saveDailyReportToProjectFiles({
  projectId,
  reportId,
  html,
  fileName,
}: SaveDailyReportPdfArgs): Promise<SavedDocument> {
  const session = await supabase.auth.getSession();
  if (!session.data.session) {
    throw new Error('Sign in to save reports to project files.');
  }

  // 1. Render HTML → PDF.
  //
  // expo-print's entire web module is `async printToFileAsync() { window.print(); }`
  // — it ignores the html, prints whatever is on screen and returns UNDEFINED,
  // so there are no PDF bytes to upload on web. The screen no longer offers
  // this there (#27); if anything still calls it, it fails plainly. It used to
  // open a print tab first — a hidden side effect of a save that then threw,
  // run after an awaited email send where the browser blocks pop-ups anyway.
  if (Platform.OS === 'web') {
    throw new Error(PROJECT_FILES_NEEDS_APP);
  }
  const { uri } = await Print.printToFileAsync({ html, base64: false });

  // 2. Read the file as a blob via fetch — same pattern as the PDF
  //    upload path in `pdfRenderClient.ts`. Web returns a blob: URL,
  //    native returns a file://.
  const bytes = await readFileBytes(uri);
  if (bytes.byteLength === 0) throw new Error('Generated an empty PDF.');

  // 3. Upload to the bucket. We stable-sort the path on `reportId` so
  //    re-saving the same DFR overwrites in place rather than littering
  //    the bucket with copies. `upsert: true` makes overwrite explicit.
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const objectName = `${safe(projectId)}/daily-reports/${safe(reportId)}.pdf`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(objectName, bytes, {
      contentType: 'application/pdf',
      upsert: true,
      // contentDisposition lets the browser show a sensible filename
      // when the user opens the URL directly.
      ...(fileName ? { metadata: { fileName: safe(fileName) } } : {}),
    });
  if (upErr) {
    throw new Error(`Could not save to project files: ${upErr.message}`);
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(objectName);
  let linkUrl: string | null = null;
  try {
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(objectName, DFR_FILED_PDF_LINK_DAYS * 24 * 60 * 60);
    linkUrl = signed?.signedUrl ?? null;
  } catch { /* the file is saved; the email just goes without the link */ }
  return {
    storagePath: objectName,
    publicUrl: pub.publicUrl,
    linkUrl,
    bytes: bytes.byteLength,
  };
}

/**
 * The report's photos as the filed PDF prints them (#25).
 *
 * Native: each photo is EMBEDDED as a data: URI — from the device file when
 * this phone has it, otherwise downloaded from its storage copy first. A
 * remote URL left in the HTML can expire, or simply not have loaded, by the
 * time printToFileAsync lays the page out, and the record would print blank.
 * Web: the browser loads http(s)/blob: URLs itself, so they pass through.
 *
 * Markup lives on the GALLERY copy of the photo (the report mirrors each photo
 * into the gallery under the same id, and the annotator draws there), so it is
 * read from `galleryPhotos` by id.
 *
 * Never throws: a photo that cannot be read prints as a stated gap
 * (DfrDocumentPhoto.src null), never as a blank image.
 */
export async function resolveDfrPhotosForDocument(
  photos: DFRPhoto[],
  galleryPhotos: { id: string; markup?: PhotoMarkup[]; storagePath?: string }[],
  opts: { budgetChars?: number } = {},
): Promise<DfrDocumentPhoto[]> {
  const budgetChars = opts.budgetChars ?? DFR_PDF_EMBED_BUDGET_CHARS;
  const gallery = new Map(galleryPhotos.map(g => [g.id, g]));
  const storageOf = (p: DFRPhoto) => p.storagePath ?? gallery.get(p.id)?.storagePath;
  // Incident evidence is never printed (buildDFRHtml drops it — the PDF is
  // linked from a client email), so it is not fetched either, and it does not
  // take one of the DFR_PDF_MAX_PHOTOS slots from a photo that will print.
  const isIncident = (p: DFRPhoto) => !!(p as DFRPhoto & { incidentPhoto?: boolean }).incidentPhoto;
  const embedIds = new Set(photos.filter(p => !isIncident(p)).slice(0, DFR_PDF_MAX_PHOTOS).map(p => p.id));
  // Signed FRESH from storagePath whenever there is one: an http(s) uri on the
  // photo may be a signed URL minted when the screen opened, long expired by
  // the time he taps Send. The uri is only the fallback when nothing is stored.
  const needSigned = photos
    .filter(p => embedIds.has(p.id) && storageOf(p))
    .map(p => storageOf(p) as string);
  const signed = needSigned.length > 0 ? await resolvePhotoUrls(needSigned) : new Map<string, string>();

  const toDataUri = async (local: string, nameHint: string): Promise<string | null> => {
    try {
      const b64 = await readAsBase64(local);
      return b64 ? `data:${contentTypeForExt(photoExtFromUri(nameHint))};base64,${b64}` : null;
    } catch { return null; }
  };

  const out: DfrDocumentPhoto[] = [];
  let embeddedChars = 0;
  for (const p of photos) {
    const g = gallery.get(p.id);
    const storagePath = storageOf(p);
    const base: DfrDocumentPhoto = {
      id: p.id, src: null, notUploaded: !storagePath,
      timestamp: p.timestamp, caption: p.locationLabel, markup: g?.markup,
      incident: isIncident(p) ? true : undefined,
    };
    if (!embedIds.has(p.id)) { out.push(base); continue; }
    const fresh = storagePath ? signed.get(storagePath) ?? null : null;
    const remote = fresh ?? (isHttpUrl(p.uri) ? p.uri : null);
    if (Platform.OS === 'web') {
      out.push({ ...base, src: remote ?? (/^(blob:|data:image\/)/i.test(p.uri) ? p.uri : null) });
      continue;
    }
    const local = p.localUri ?? (isDeviceLocalUri(p.uri) ? p.uri : undefined);
    let src = local ? await toDataUri(local, local) : null;
    if (!src && remote && FileSystem.cacheDirectory) {
      try {
        const dl = await FileSystem.downloadAsync(remote, `${FileSystem.cacheDirectory}dfr-photo-${p.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.${photoExtFromUri(remote.split('?')[0])}`);
        if (dl.status >= 200 && dl.status < 300) src = await toDataUri(dl.uri, remote.split('?')[0]);
      } catch { /* offline — the tile says it could not be loaded */ }
    }
    // The size budget: one more full-size photo would push the page past what
    // printToFileAsync can safely hold, so it is named, not embedded.
    if (src && embeddedChars + src.length > budgetChars) {
      out.push({ ...base, overBudget: true });
      continue;
    }
    if (src) embeddedChars += src.length;
    out.push({ ...base, src });
  }
  return out;
}

/**
 * Open a saved document in the platform's default viewer. On native
 * we hand the publicUrl to React Native's Linking; on web we open in
 * a new tab so the browser PDF preview takes over.
 */
export async function openSavedDocument(publicUrl: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      window.open(publicUrl, '_blank', 'noopener');
    }
    return;
  }
  const Linking = (await import('react-native')).Linking;
  await Linking.openURL(publicUrl);
}
