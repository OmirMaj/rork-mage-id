// utils/planSheetImageUpload.ts — put a picked/photographed plan image into the
// `plan-sheets` bucket and hand back its storage PATH.
//
// The RN-bound half of utils/planSheetImageCore.ts. Same contract as
// utils/storage.uploadProjectPhoto, deliberately:
//   • bytes via readFileBytes — never fetch().blob(), which uploads ZERO bytes
//     on React Native with no error (537d74d);
//   • THROWS on failure instead of returning null, so the caller can tell "no
//     signal" from "RLS refused" (classifyFloorPlanUploadError);
//   • upsert: false to a fresh object name per attempt, so a retry never
//     overwrites a drawing someone already pinned against.
//
// Needs storage policy plan_sheets_member_insert
// (supabase/migrations/20260917163000_plan_sheets_member_insert.sql). Before it
// is applied every call throws "new row violates row-level security policy",
// which the caller reports instead of creating an empty sheet.

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { readFileBytes } from '@/utils/fileBytes';
import { generateUUID } from '@/utils/generateId';
import { PLAN_SHEET_BUCKET } from '@/utils/planSheetUrls';
import { buildPlanSheetImagePath, type FloorPlanImage } from '@/utils/planSheetImageCore';

export class PlanSheetUploadNotConfiguredError extends Error {
  constructor() {
    super('plan-sheet storage is not configured in this build');
    this.name = 'PlanSheetUploadNotConfiguredError';
  }
}

/**
 * Upload the image and return `<projectId>/img-<uuid>.<ext>`.
 * The caller has already run precheckFloorPlanImage; the path is rebuilt here
 * so nothing can upload outside a project-scoped folder.
 */
export async function uploadPlanSheetImage(
  projectId: string,
  image: FloorPlanImage,
  format: { ext: 'jpg' | 'png'; contentType: string },
): Promise<string> {
  if (!isSupabaseConfigured) throw new PlanSheetUploadNotConfiguredError();
  const path = buildPlanSheetImagePath(projectId, generateUUID(), format.ext);
  if (!path) throw new Error('refusing to upload a plan outside a project folder');
  const bytes = await readFileBytes(image.uri);
  // A zero-byte object "uploads" fine and renders nothing forever — the exact
  // silent failure this file exists to end. Classified terminal ("empty file").
  if (!bytes || bytes.byteLength === 0) throw new Error('empty file: the plan image has no bytes');
  const { error } = await supabase.storage
    .from(PLAN_SHEET_BUCKET)
    .upload(path, bytes, { contentType: format.contentType, upsert: false });
  if (error) {
    // Keep the status on the thrown error so classifyPhotoUploadError can see
    // a 403 even when the message is terse.
    const e = new Error(error.message) as Error & { status?: unknown };
    const status = (error as { status?: unknown; statusCode?: unknown }).status
      ?? (error as { statusCode?: unknown }).statusCode;
    if (status !== undefined) e.status = status;
    throw e;
  }
  return path;
}
