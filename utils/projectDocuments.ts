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
import { printHtmlDocument } from '@/utils/platformFile';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { readFileBytes } from '@/utils/fileBytes';

const BUCKET = 'project-documents';

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
  // The comment here used to claim expo-print uses "the browser on web". It does
  // not: its entire web module is `async printToFileAsync() { window.print(); }`
  // — it ignores the html, prints whatever is on screen, and returns UNDEFINED.
  // So this destructure threw, AFTER showing the user a print dialog of the app
  // UI. Saving a daily report to project files was impossible on web and looked
  // like a crash.
  //
  // This path genuinely needs PDF BYTES to upload, and the browser cannot give
  // us any from expo-print. Rather than fail opaquely, hand the user the printed
  // document (which they can Save as PDF) and say plainly that the upload is
  // mobile-only. An honest limitation beats a stack trace.
  if (Platform.OS === 'web') {
    await printHtmlDocument(html);
    throw new Error(
      'Saving to Project Files needs the mobile app. Your report opened in a new tab — use your browser\'s "Save as PDF" to keep a copy.',
    );
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
  return {
    storagePath: objectName,
    publicUrl: pub.publicUrl,
    bytes: bytes.byteLength,
  };
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
