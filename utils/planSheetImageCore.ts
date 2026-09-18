// utils/planSheetImageCore.ts — pure decisions for storing a plan sheet that
// started life as a PICTURE (a photo of a paper plan, a screenshot, a JPG).
//
// THE BUG THIS EXISTS FOR. app/plans.tsx "Import image" created a sheet straight
// out of ImagePicker with a device-local `file://` uri and uploaded nothing.
// ProjectContext rightly refuses to write a device-local uri to Postgres
// (utils/planSheetUrls.durablePlanSheetValue, audit DB-F11), so
// `plan_sheets.image_uri` became ''. Every other device, web after a reload,
// and the original phone once iOS purged the picker cache got a black canvas.
// Production 2026-09-17: the founder's only sheet ("IMG_1668", Watermark 9F)
// is exactly that row, which is why the punch walk could not show a plan.
//
// THE RULE this file encodes: upload the bytes first, THEN create the sheet
// with the storage path. Never set `storagePath` before the object exists —
// hydration cannot sign a missing object, planSheetRowUris would hand the bare
// path to <Image>, and carryDeviceLocalPlanSheetUris only fills EMPTY uris, so
// the one phone that could show the capture would lose it too.
//
// No react-native / supabase imports here (bun cannot parse react-native), so
// scripts/validate-plan-image-durability.ts executes all of it. The RN shells
// are utils/planSheetImageUpload.ts and utils/addFloorPlan.ts.

import {
  classifyPhotoUploadError,
  isDeviceLocalUri,
  photoExtFromUri,
  type PhotoUploadOutcome,
} from '@/utils/photoUploadCore';

/**
 * The formats a plan image may be stored as. Refused HERE, not by Storage:
 * add_pdf_render_buckets.sql asks for allowed_mime_types png/jpeg, but its
 * INSERT is ON CONFLICT DO NOTHING and the production bucket predates it —
 * a read-only query on 2026-09-17 shows allowed_mime_types = null, so Storage
 * would happily keep a HEIC that web browsers and the plan analyzers cannot
 * decode. This client check is the only thing standing between a HEIC and
 * a sheet that is blank on web.
 */
const PLAN_IMAGE_CONTENT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/**
 * The LIVE plan-sheets bucket's file_size_limit: 10485760 bytes (read-only
 * query 2026-09-17). The migration's 52428800 never applied (ON CONFLICT DO
 * NOTHING on a bucket that already existed). A 10–50 MB image used to pass
 * this precheck, get refused by Storage with "The object exceeded the maximum
 * allowed size", and be told "Try again" — which could never succeed.
 */
export const PLAN_SHEET_MAX_BYTES = 10 * 1024 * 1024;
const PLAN_SHEET_MAX_MB = PLAN_SHEET_MAX_BYTES / (1024 * 1024);

/**
 * Storage's own size refusal. Supabase Storage says "The object exceeded the
 * maximum allowed size" (HTTP 413); older gateways say "payload too large".
 * photoUploadCore classifies the first as 'retryable', which for a plan means
 * an endless "Try again" — so the plan path checks it first and reports
 * 'too-large'.
 */
export function isPlanSheetTooLargeError(err: unknown): boolean {
  const msg = err instanceof Error
    ? err.message
    : typeof err === 'string'
      ? err
      : err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message ?? '')
        : '';
  const m = msg.toLowerCase();
  if (m.includes('exceeded the maximum allowed size') || m.includes('payload too large') || m.includes('entity too large')) return true;
  const o = (err && typeof err === 'object' ? err : {}) as { status?: unknown; statusCode?: unknown };
  return [o.status, o.statusCode].some(v => Number(v) === 413);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A picked or photographed image, as expo-image-picker describes it. */
export interface FloorPlanImage {
  uri: string;
  width?: number;
  height?: number;
  /** ImagePicker asset.mimeType — the only reliable type on web, where the uri is `blob:`. */
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
}

/**
 * Extension + content type for an upload, or null when the bucket would refuse
 * it. The declared mime type wins: a web `blob:` uri has no suffix, and
 * photoExtFromUri would call a PNG a jpg.
 */
export function planSheetImageFormat(
  uri: string,
  mimeType?: string | null,
): { ext: 'jpg' | 'png'; contentType: string } | null {
  const mime = (mimeType ?? '').toLowerCase().trim();
  if (mime) {
    if (mime === 'image/jpeg' || mime === 'image/jpg') return { ext: 'jpg', contentType: 'image/jpeg' };
    if (mime === 'image/png') return { ext: 'png', contentType: 'image/png' };
    return null;
  }
  // photoExtFromUri falls back to 'jpg' for a suffix-less uri, which matches
  // every camera path in the app.
  const ext = photoExtFromUri(uri);
  if (!PLAN_IMAGE_CONTENT_TYPE[ext]) return null;
  return ext === 'png'
    ? { ext: 'png', contentType: 'image/png' }
    : { ext: 'jpg', contentType: 'image/jpeg' };
}

/**
 * `<projectId>/<imageId>.<ext>` inside plan-sheets.
 *
 * folder[1] MUST be the project uuid: that is what plan_sheets_member_select
 * and plan_sheets_member_insert check, and what
 * planSheetUrls.isProjectScopedPlanSheetPath requires before a path is
 * published to the analyzers. NOT buildPhotoStoragePath — that is
 * `<userId>/<projectId>/…` for a different bucket, and the plan-sheet read path
 * would treat the user id as a project id.
 *
 * Returns null for a non-uuid project id (a shared `tmp/` prefix is exactly
 * what DB-F11 cleaned up) so the caller refuses before any bytes move.
 */
export function buildPlanSheetImagePath(projectId: string, imageId: string, ext: 'jpg' | 'png'): string | null {
  const pid = String(projectId ?? '').trim();
  if (!UUID_RE.test(pid)) return null;
  const safeId = String(imageId ?? '').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!safeId) return null;
  return `${pid}/img-${safeId}.${ext}`;
}

/** "IMG_1668.JPG" → "IMG_1668"; nothing usable → the fallback. */
export function floorPlanNameFromFile(fileName: string | null | undefined, fallback: string): string {
  const base = String(fileName ?? '').replace(/\.[^/.]+$/, '').trim();
  return base || fallback;
}

/**
 * Where a sheet's image actually lives.
 *   durable     — a storage path, or a legacy/foreign https url: every device can show it.
 *   device-only — only a `file://` / `blob:` on THIS device; Postgres holds ''.
 *   missing     — nothing renderable anywhere (the IMG_1668 row on any other device).
 */
export type PlanSheetImageState = 'durable' | 'device-only' | 'missing';

export function planSheetImageState(sheet: { imageUri?: string | null; storagePath?: string | null }): PlanSheetImageState {
  if (sheet.storagePath) return 'durable';
  const uri = String(sheet.imageUri ?? '').trim();
  if (!uri) return 'missing';
  if (isDeviceLocalUri(uri)) return 'device-only';
  return 'durable';
}

/** Why a floor plan could not be stored, in the words the pin step shows. */
export type FloorPlanFailure =
  | 'no-image'
  | 'unsupported-format'
  | 'too-large'
  | 'project-not-synced'
  | 'not-configured'
  | PhotoUploadOutcome;

export function floorPlanFailureReason(kind: FloorPlanFailure, detail?: string): string {
  switch (kind) {
    case 'no-image':
      return 'No image was picked, so there is nothing to save as a plan.';
    case 'unsupported-format':
      return `Plans have to be a JPG or PNG${detail ? ` (this one is ${detail})` : ''}. Take a photo of the plan instead, or export it as a JPG.`;
    case 'too-large':
      return `This image is ${detail ? `${detail} MB` : `over ${PLAN_SHEET_MAX_MB} MB`}. Plans must be under ${PLAN_SHEET_MAX_MB} MB. Take a photo of the plan instead — a phone photo is well under that.`;
    case 'project-not-synced':
      return 'This project has not been saved to the cloud yet, so the plan cannot be stored against it. Open the project once with signal, then try again.';
    case 'not-configured':
      return 'This build is not connected to MAGE cloud storage, so the plan cannot be saved for other devices.';
    case 'transient':
      return 'No signal. The plan has to upload once so every phone and the office can see it. Try again when you have signal.';
    case 'rls-pending':
      return 'The server would not store the plan. The project may still be syncing, or you do not have edit access to it. Try again in a minute; if it keeps happening, ask the project owner for editor access.';
    case 'terminal':
      return `The image could not be read or the upload was refused${detail ? ` (${detail})` : ''}. Pick the image again.`;
    case 'retryable':
      return `The upload failed on the server${detail ? ` (${detail})` : ''}. Try again.`;
    case 'success':
    case 'already-uploaded':
      return '';
  }
}

/**
 * After uploading a sheet's OWN device-local file failed: is picking a fresh
 * image the way forward? Yes when the file is gone ('terminal', 'no-image') or
 * is a file the plan store will never take ('unsupported-format' — the old
 * full-quality import copied the HEIC original; 'too-large'): a new pick
 * comes back as a JPEG under the limit. No for no signal, an RLS refusal, an
 * unsynced project or a server hiccup — a new image would fail the same way,
 * and asking him to find the plan again for nothing is its own dead end.
 */
export function shouldRepickAfterDeviceUploadFailure(kind: FloorPlanFailure): boolean {
  return kind === 'terminal' || kind === 'no-image' || kind === 'unsupported-format' || kind === 'too-large';
}

/**
 * Checks that must pass BEFORE any bytes move. Returns the failure, or the
 * upload format when the image may go up.
 */
export function precheckFloorPlanImage(
  projectId: string,
  image: FloorPlanImage | null | undefined,
): { ok: true; ext: 'jpg' | 'png'; contentType: string } | { ok: false; kind: FloorPlanFailure; detail?: string } {
  if (!image || !String(image.uri ?? '').trim()) return { ok: false, kind: 'no-image' };
  if (!UUID_RE.test(String(projectId ?? '').trim())) return { ok: false, kind: 'project-not-synced' };
  const format = planSheetImageFormat(image.uri, image.mimeType);
  if (!format) {
    const declared = image.mimeType || photoExtFromUri(image.uri).toUpperCase();
    return { ok: false, kind: 'unsupported-format', detail: declared };
  }
  if (typeof image.fileSize === 'number' && image.fileSize > PLAN_SHEET_MAX_BYTES) {
    return { ok: false, kind: 'too-large', detail: (image.fileSize / (1024 * 1024)).toFixed(1) };
  }
  return { ok: true, ...format };
}

/** Error → failure kind. `already-uploaded` cannot happen on a fresh object name, but if it does the bytes are there. */
export function classifyFloorPlanUploadError(err: unknown): PhotoUploadOutcome {
  return classifyPhotoUploadError(err);
}

/**
 * Error → the failure the PLAN flow reports. Size first: to photoUploadCore a
 * Storage size refusal is 'retryable' (or 'terminal' for "payload too large"),
 * and neither tells him the image is simply too big.
 */
export function classifyFloorPlanFailure(err: unknown): FloorPlanFailure {
  if (isPlanSheetTooLargeError(err)) return 'too-large';
  return classifyFloorPlanUploadError(err);
}

/**
 * The input handed to ProjectContext.addPlanSheet once the upload has
 * SUCCEEDED. `storagePath` is what durablePlanSheetValue writes to
 * plan_sheets.image_uri; `imageUri` is the local capture so the sheet renders
 * this instant without waiting for a signed url.
 *
 * Takes the path as a required argument on purpose: there is no way to build a
 * create input without an uploaded object, which is the ordering rule above.
 */
export function floorPlanSheetInput(args: {
  projectId: string;
  image: FloorPlanImage;
  storagePath: string;
  name: string;
  sheetNumber?: string;
}): {
  projectId: string;
  name: string;
  sheetNumber?: string;
  imageUri: string;
  storagePath: string;
  width?: number;
  height?: number;
  pageNumber: number;
} {
  return {
    projectId: args.projectId,
    name: args.name,
    sheetNumber: args.sheetNumber?.trim() || undefined,
    imageUri: args.image.uri,
    storagePath: args.storagePath,
    width: args.image.width,
    height: args.image.height,
    pageNumber: 1,
  };
}

/**
 * True when a value may be written as a sheet's DURABLE image: a non-empty
 * value that is not device-local. What the guard asserts about every sheet
 * addFloorPlan reports as saved.
 */
export function isDurablePlanImageValue(value: string | null | undefined): boolean {
  const v = String(value ?? '').trim();
  return v.length > 0 && !isDeviceLocalUri(v);
}
