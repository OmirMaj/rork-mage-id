// pdfRenderClient
//
// Client-side helper that takes a local PDF (from expo-document-picker) and
// turns it into a list of plan-sheet-ready PNG URLs by:
//
//   1. Uploading the PDF to the `pdf-uploads` Storage bucket.
//   2. Invoking the `convert-pdf-to-images` edge function.
//   3. Returning the page metadata (pageNumber, publicUrl, width, height).
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

const PDF_BUCKET = 'pdf-uploads';
const FUNCTION_NAME = 'convert-pdf-to-images';

export interface RenderedPlanPage {
  pageNumber: number;
  storagePath: string;
  publicUrl: string;
  width: number;
  height: number;
}

export interface RenderPdfOptions {
  /** Local file URI from expo-document-picker (file:// on native, blob: on web). */
  fileUri: string;
  /** Project the resulting plan sheets will be attached to. */
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
 * @returns array of { pageNumber, publicUrl, width, height } in page order
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

  // 1. Read the PDF bytes from the local URI.
  const fileBlob = await readFileAsBlob(fileUri);
  if (fileBlob.size === 0) {
    throw new Error('That file is empty.');
  }

  // 2. Upload to pdf-uploads/<userId>/<uuid>.pdf
  const uuid = generateUuidLite();
  const safeName = (fileName ?? 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
  const storagePath = `${userId}/${uuid}-${safeName.endsWith('.pdf') ? safeName : `${safeName}.pdf`}`;

  const { error: upErr } = await supabase.storage
    .from(PDF_BUCKET)
    .upload(storagePath, fileBlob, { contentType: 'application/pdf', upsert: false });
  if (upErr) {
    throw new Error(`Upload failed: ${upErr.message}`);
  }

  // 3. Invoke the edge function. Use supabase.functions.invoke so auth
  //    headers / project URL come from the SDK (no hardcoded URLs to drift).
  const { data, error: fnErr } = await supabase.functions.invoke<{
    success: boolean;
    pages?: RenderedPlanPage[];
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

  return data.pages;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function readFileAsBlob(fileUri: string): Promise<Blob> {
  // On web, expo-document-picker returns a blob: URL we can fetch directly.
  // On native, file:// URIs work the same way through the RN fetch polyfill.
  if (Platform.OS === 'web') {
    const r = await fetch(fileUri);
    return await r.blob();
  }
  const r = await fetch(fileUri);
  return await r.blob();
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
