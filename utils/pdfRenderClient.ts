// pdfRenderClient
//
// Client-side helper that takes a local PDF (from expo-document-picker) and
// turns it into a list of plan-sheet-ready PNG pages by:
//
//   1. Uploading the PDF to the `pdf-uploads` Storage bucket.
//   2. Invoking the `convert-pdf-to-images` edge function.
//   3. Returning the page metadata (pageNumber, storagePath, viewUrl, w, h).
//
// AUDIT DB-F11 — WHAT CHANGED HERE AND WHY.
//
// This helper used to hand every caller `publicUrl`, the permanent unsigned
// getPublicUrl() link the edge function returned for an object in the PUBLIC
// `plan-sheets` bucket. Five screens then rendered it, four persisted or
// forwarded it, and app/plans.tsx wrote it into plan_sheets.image_uri — so a
// construction drawing was readable forever by anyone who had ever seen a URL.
//
// Now:
//   • `storagePath` is the durable value. It is what belongs in a DB row or in
//     AsyncStorage, and it is what the analyzer functions receive.
//   • `viewUrl` is a freshly-minted SIGNED url for rendering, good for
//     PLAN_SHEET_URL_TTL_SECONDS. It must NOT be persisted. While the bucket is
//     still public and has no SELECT policy, signing can be refused; in that
//     case viewUrl falls back to the server's legacy public URL so thumbnails
//     keep working through the release that lands before the migration.
//   • `projectId` must be a real project id. It used to accept anything, and
//     app/takeoff.tsx passed the literal `'tmp'` when no project was picked,
//     which parked live drawings under a SHARED bucket prefix that no
//     per-project membership policy can ever admit.
//
// The edge function deletes the source PDF after rendering, so storage cost
// long-term is just the PNGs (one per sheet, ~2 MB at 144 DPI).
//
// Why a single helper:
//   - Both `app/plans.tsx` and any future flow (closeout packet PDF intake,
//     spec PDF upload, etc.) share this path. Centralizing the upload key
//     convention + auth-guard logic in one place avoids drift.
//
// Failure modes the caller should handle:
//   - User has no auth session yet → throws 'not authenticated'.
//   - Network drop during upload → throws the underlying storage error.
//   - PDF is too big / corrupt → throws with the edge function's error msg.
//   - PDF has too many pages → edge function caps at maxPages (default 50).
//
// We intentionally do NOT enqueue this through the offline queue. The render
// step requires the server; pretending it works offline would silently lose
// uploads. Surface the failure to the user instead.

import { supabase } from '@/lib/supabase';
import { Platform } from 'react-native';
import { PDFDocument } from 'pdf-lib';
import { readFileBytes } from '@/utils/fileBytes';
import { isProjectScopedPlanSheetPath, resolvePlanSheetUrls } from '@/utils/planSheetUrls';

const PDF_BUCKET = 'pdf-uploads';
const FUNCTION_NAME = 'convert-pdf-to-images';

export interface RenderedPlanPage {
  pageNumber: number;
  /** DURABLE. `plan-sheets/<projectId>/<id>-page-N.png`, minus the bucket.
   *  This is the value to persist and the value the analyzers receive. */
  storagePath: string;
  /** RENDER-ONLY. A signed URL (or, for one release while the bucket is still
   *  public and unsigned, the server's legacy public URL). Expires — never
   *  persist it; re-resolve from `storagePath` instead. */
  viewUrl: string;
  width: number;
  height: number;
}

/** The raw shape convert-pdf-to-images returns. `publicUrl` is deprecated and
 *  is read here ONLY as the pre-migration fallback for `viewUrl`; nothing
 *  outside this module may touch it. */
interface RenderedPlanPageWire {
  pageNumber: number;
  storagePath: string;
  publicUrl?: string;
  width: number;
  height: number;
}

/**
 * Turn the wire pages into render-ready pages: durable path kept, view URL
 * signed in ONE batched request.
 *
 * Exported because a saved takeoff (utils/takeoffStorage.ts) reloads pages from
 * AsyncStorage whose `viewUrl` has long expired, and has to re-resolve them
 * through exactly this path.
 */
export async function resolveRenderedPages<T extends { storagePath: string; viewUrl?: string }>(
  pages: T[],
): Promise<(T & { viewUrl: string })[]> {
  const signed = await resolvePlanSheetUrls(pages.map(p => p.storagePath));
  return pages.map(p => ({
    ...p,
    // Order matters: a fresh signature wins, then whatever the caller already
    // had (a legacy public URL from the server, which still works while the
    // bucket is public), then — for ONE release — the `publicUrl` a takeoff
    // saved BEFORE DB-F11 carries instead of `viewUrl`, because in the window
    // where the bucket is still public there is no SELECT policy and nothing
    // signs, and without this the saved page thumbnails would go blank while a
    // working URL sat on the same object. Then '': renders nothing, but the
    // page keeps its storagePath and never throws.
    viewUrl: signed.get(p.storagePath)
      ?? p.viewUrl
      ?? (p as { publicUrl?: string }).publicUrl
      ?? '',
  }));
}

export interface RenderPdfOptions {
  /** Local file URI from expo-document-picker (file:// on native, blob: on web). */
  fileUri: string;
  /** Project the resulting plan sheets will be attached to. MUST be a real
   *  project id — it becomes the bucket folder that the membership policy is
   *  evaluated against. A placeholder like `'tmp'` is refused here (DB-F11). */
  projectId: string;
  /** Optional: filename for traceability in the storage console. Defaults to a uuid. */
  fileName?: string;
  /** Render DPI; capped at 300 server-side. Default 144 (2× retina). */
  dpi?: number;
  /** Hard cap on pages converted; protects from a 500-page set blowing storage. */
  maxPages?: number;
}

/**
 * Upload a PDF and convert each page to a PNG plan sheet.
 *
 * @returns array of { pageNumber, storagePath, viewUrl, width, height } in page order
 * @throws  Error with a user-readable message on any step failure
 */
export async function uploadAndRenderPdf({
  fileUri,
  projectId,
  fileName,
  dpi,
  maxPages,
}: RenderPdfOptions): Promise<RenderedPlanPage[]> {
  const session = await supabase.auth.getSession();
  const userId = session.data.session?.user?.id;
  if (!userId) {
    throw new Error('Sign in before uploading plans.');
  }

  // DB-F11. The bucket folder is the tenant boundary; a non-project prefix is
  // a shared folder no membership policy can admit, so refuse it at the only
  // place that can create one rather than discovering it at read time.
  //
  // convert-pdf-to-images already answers a bogus projectId with a 403
  // ("forbidden: project not owned by caller" — it looks the row up by
  // user_id), so this is not a new restriction: it is the same rule, stated in
  // a message the user can act on, before a multi-MB upload instead of after.
  if (!isProjectScopedPlanSheetPath(projectId)) {
    throw new Error('Pick a project before uploading plans — drawings are stored per project.');
  }

  // 1. Read the PDF bytes from the local URI.
  const fileBytes = await readFileBytes(fileUri);
  if (fileBytes.byteLength === 0) {
    throw new Error('That file is empty.');
  }

  // 2. Upload to pdf-uploads/<userId>/<uuid>.pdf
  const uuid = generateUuidLite();
  const safeName = (fileName ?? 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
  const storagePath = `${userId}/${uuid}-${safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`}`;

  const { error: upErr } = await supabase.storage
    .from(PDF_BUCKET)
    .upload(storagePath, fileBytes, { contentType: 'application/pdf', upsert: false });
  if (upErr) {
    throw new Error(`Upload failed: ${upErr.message}`);
  }

  // 3. Invoke the edge function. Use supabase.functions.invoke so auth
  //    headers / project URL come from the SDK (no hardcoded URLs to drift).
  const { data, error: fnErr } = await supabase.functions.invoke<{
    success: boolean;
    pages?: RenderedPlanPageWire[];
    error?: string;
  }>(FUNCTION_NAME, {
    body: {
      pdfStoragePath: storagePath,
      projectId,
      dpi,
      maxPages,
    },
  });

  if (fnErr) {
    // Best-effort cleanup of the orphaned PDF if the function never got to delete it.
    supabase.storage.from(PDF_BUCKET).remove([storagePath]).catch(() => {});
    throw new Error(`Render failed: ${fnErr.message}`);
  }
  if (!data?.success || !data.pages) {
    supabase.storage.from(PDF_BUCKET).remove([storagePath]).catch(() => {});
    throw new Error(data?.error ?? 'Render returned no pages.');
  }

  // Sign for display here, in one batched request, so that no caller ever holds
  // the deprecated `publicUrl` — the field is stripped on the way out.
  return resolveRenderedPages(data.pages.map(p => ({
    pageNumber: p.pageNumber,
    storagePath: p.storagePath,
    viewUrl: p.publicUrl ?? '',
    width: p.width,
    height: p.height,
  })));
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------



/**
 * Count pages in a local PDF without rendering or rasterizing. Used by
 * the upload UI to show "this PDF is N pages, you have M remaining"
 * BEFORE the user commits to the upload — pre-fix the only way to learn
 * was to upload, wait, and watch a 429 land back. pdf-lib parses the
 * PDF object tree only; no images are decoded so this stays fast on
 * 200-page hospital sets (~150ms typical).
 */
export async function countPdfPages(fileUri: string): Promise<number | null> {
  try {
    const bytes = await readFileBytes(fileUri);
    // ignoreEncryption=true so a password-protected PDF still gets a
    // page count (the actual render will fail later with a clearer
    // message; we don't want the count step to be the choke point).
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return doc.getPageCount();
  } catch (err) {
    console.log('[pdfRenderClient] countPdfPages failed:', err);
    return null;
  }
}

/** Lightweight uuid — we don't need crypto-strength, just collision-free. */
function generateUuidLite(): string {
  // Use crypto.randomUUID if present (modern RN), fall back to a 16-byte
  // template otherwise.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  // RFC 4122 v4 markers
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const b = Array.from(bytes, hex).join('');
  return `${b.slice(0, 8)}-${b.slice(8, 12)}-${b.slice(12, 16)}-${b.slice(16, 20)}-${b.slice(20)}`;
}
