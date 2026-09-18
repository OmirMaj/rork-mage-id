// utils/addFloorPlan.ts — "add a floor plan to this project from a picked or
// photographed image", in one call, with a DURABLE image.
//
// Used by app/plans.tsx (Import image) and by the punch walk's pin step
// ("photo, then pin, then description" — founder, 2026-09-17). Both need the
// same guarantee, which the old Import image flow did not give: the sheet that
// gets created is viewable on every device, not just the phone that picked it.
//
// ORDER (see utils/planSheetImageCore.ts for why it matters):
//   1. precheck — JPG/PNG, under the bucket's 10 MB, a real project uuid. Nothing moves yet.
//   2. upload the bytes to plan-sheets/<projectId>/img-<uuid>.<ext>.
//   3. ONLY THEN create (or repair) the sheet with that storagePath, so
//      ProjectContext writes the path to plan_sheets.image_uri.
// If 2 fails, NO sheet is created. There is deliberately no "save it on this
// phone only" fallback: a device-only sheet writes '' to Postgres, and a punch
// item pinned to it points at a plan no one else can see — the IMG_1668 row
// all over again. The failure comes back with a sentence that says why, so the
// pin step can offer "Try again" or "Skip".
//
// ACTIONS ARE READ AFTER THE UPLOAD. ProjectContext.addPlanSheet /
// updatePlanSheet close over the planSheets array of the render they came
// from and persist `[fresh, ...thatArray]`. An upload takes seconds; if a
// hydration or another sheet landed meanwhile, calling the function captured
// BEFORE the await would write a stale list and drop those sheets. So callers
// pass a getter (typically `() => actionsRef.current`) and it is resolved at
// the moment of the write.

import type { PlanSheet } from '@/types';
import {
  classifyFloorPlanFailure,
  floorPlanFailureReason,
  floorPlanNameFromFile,
  floorPlanSheetInput,
  planSheetImageState,
  precheckFloorPlanImage,
  type FloorPlanFailure,
  type FloorPlanImage,
} from '@/utils/planSheetImageCore';
import { isDeviceLocalUri } from '@/utils/photoUploadCore';
import { PlanSheetUploadNotConfiguredError, uploadPlanSheetImage } from '@/utils/planSheetImageUpload';

export type { FloorPlanImage } from '@/utils/planSheetImageCore';

export interface FloorPlanActions {
  addPlanSheet: (sheet: Omit<PlanSheet, 'id' | 'createdAt' | 'updatedAt'>) => PlanSheet;
  updatePlanSheet: (id: string, updates: Partial<PlanSheet>) => void;
}

type ActionsSource = FloorPlanActions | (() => FloorPlanActions);

export type AddFloorPlanResult =
  | { ok: true; sheet: PlanSheet; storagePath: string }
  | { ok: false; kind: FloorPlanFailure; reason: string };

function resolveActions(src: ActionsSource): FloorPlanActions {
  return typeof src === 'function' ? src() : src;
}

function failure(kind: FloorPlanFailure, detail?: string): { ok: false; kind: FloorPlanFailure; reason: string } {
  return { ok: false, kind, reason: floorPlanFailureReason(kind, detail) };
}

/** Upload after the precheck. Returns the path or the classified failure. */
async function uploadChecked(
  projectId: string,
  image: FloorPlanImage | null | undefined,
): Promise<{ ok: true; storagePath: string } | { ok: false; kind: FloorPlanFailure; reason: string }> {
  const pre = precheckFloorPlanImage(projectId, image);
  if (!pre.ok) return failure(pre.kind, pre.detail);
  try {
    const storagePath = await uploadPlanSheetImage(projectId, image as FloorPlanImage, pre);
    return { ok: true, storagePath };
  } catch (err) {
    if (err instanceof PlanSheetUploadNotConfiguredError) return failure('not-configured');
    const outcome = classifyFloorPlanFailure(err);
    // A fresh object name cannot already exist, and the thrown error carries no
    // path to adopt, so "already exists" is not treated as success here.
    const kind: FloorPlanFailure = outcome === 'already-uploaded' || outcome === 'success' ? 'retryable' : outcome;
    const detail = err instanceof Error ? err.message : undefined;
    return failure(kind, kind === 'terminal' || kind === 'retryable' ? detail : undefined);
  }
}

/**
 * Create a new plan sheet for `projectId` from an image. Resolves with the
 * created sheet (image stored in plan-sheets, path persisted) or a failure
 * with a user-facing reason; never creates a sheet whose durable image is
 * empty or device-local.
 */
export async function addFloorPlan(
  input: {
    projectId: string;
    image: FloorPlanImage | null | undefined;
    /** Defaults to the file name without its extension, then "Floor plan". */
    name?: string;
    sheetNumber?: string;
  },
  actions: ActionsSource,
): Promise<AddFloorPlanResult> {
  const uploaded = await uploadChecked(input.projectId, input.image);
  if (!uploaded.ok) return uploaded;
  const image = input.image as FloorPlanImage;
  const name = input.name?.trim() || floorPlanNameFromFile(image.fileName, 'Floor plan');
  const sheet = resolveActions(actions).addPlanSheet(floorPlanSheetInput({
    projectId: input.projectId,
    image,
    storagePath: uploaded.storagePath,
    name,
    sheetNumber: input.sheetNumber,
  }));
  return { ok: true, sheet, storagePath: uploaded.storagePath };
}

/**
 * Give an EXISTING sheet a durable image — the repair for a row like IMG_1668
 * whose image_uri is ''. Keeps the sheet id, so any pins, punch items and
 * markups on it survive. Nothing is written unless the upload succeeded.
 */
export async function attachFloorPlanImage(
  sheet: Pick<PlanSheet, 'id' | 'projectId'>,
  image: FloorPlanImage | null | undefined,
  actions: ActionsSource,
): Promise<AddFloorPlanResult> {
  const uploaded = await uploadChecked(sheet.projectId, image);
  if (!uploaded.ok) return uploaded;
  const img = image as FloorPlanImage;
  const patch: Partial<PlanSheet> = {
    storagePath: uploaded.storagePath,
    imageUri: img.uri,
    ...(img.width ? { width: img.width } : {}),
    ...(img.height ? { height: img.height } : {}),
  };
  const act = resolveActions(actions);
  act.updatePlanSheet(sheet.id, patch);
  return { ok: true, sheet: { ...(sheet as PlanSheet), ...patch }, storagePath: uploaded.storagePath };
}

/**
 * Upload the device-local image a sheet already has on THIS phone (an older
 * Import-image sheet). Only possible where the picker file still exists; on
 * any other device the sheet is 'missing' and needs attachFloorPlanImage with
 * a freshly picked image.
 */
export async function uploadDeviceOnlyFloorPlan(
  sheet: PlanSheet,
  actions: ActionsSource,
): Promise<AddFloorPlanResult> {
  if (planSheetImageState(sheet) !== 'device-only' || !isDeviceLocalUri(sheet.imageUri)) {
    return failure('no-image');
  }
  return attachFloorPlanImage(
    sheet,
    { uri: sheet.imageUri, width: sheet.width, height: sheet.height },
    actions,
  );
}
