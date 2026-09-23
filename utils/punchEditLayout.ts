// utils/punchEditLayout.ts — which shape the punch item add/edit sheet takes.
// PURE (no React, no react-native import) so scripts/validate-w4-punch-web-edit-layout.ts
// can execute it under bun.
//
// Founder, 2026-09-22: "When adding photos to punchlist on the web browser. Why
// not make it like 75% of the screen be the edit item then other 25% is the
// photo so you can visualize." On a laptop the phone's bottom sheet showed the
// photo as a 112 px thumbnail under the title, and the edit sheet had no photo
// at all — he was describing a defect he could not see.
//
// So on a wide WEB window the sheet becomes a large centred panel split 3 : 1 —
// the form on the left (every control, unchanged), the photo large on the
// right. The phone, a tablet-width browser and a narrow window keep the bottom
// sheet exactly as it was: a 25 % column under ~900 px is too thin to show a
// photo at a useful size, and iPhone is the primary target.

import { buildPhotoStoragePath, contentTypeForExt, isDeviceLocalUri, photoExtFromUri } from '@/utils/photoUploadCore';

/** The same line the app already draws for "desktop" on web — useResponsiveLayout
 *  calls a web window desktop from 900 px, and that is when DesktopSidebar
 *  appears. One breakpoint, so the split never shows beside a phone tab bar. */
export const PUNCH_EDIT_SPLIT_MIN_WIDTH = 900;

/** Form : photo = 75 % : 25 %, as flex weights. */
export const PUNCH_EDIT_FORM_FLEX = 3;
export const PUNCH_EDIT_PHOTO_FLEX = 1;

/** The panel never runs edge to edge on a big monitor (a 2400 px-wide form is
 *  a line length nobody reads), and always leaves a margin of the page showing
 *  so it reads as a panel over the list, not a new screen. */
export const PUNCH_EDIT_PANEL_MAX_WIDTH = 1280;
export const PUNCH_EDIT_PANEL_MARGIN = 32;
export const PUNCH_EDIT_PANEL_MAX_HEIGHT = 900;

export type PunchEditLayout = 'split' | 'sheet';

/**
 * 'split' only for a web window at least PUNCH_EDIT_SPLIT_MIN_WIDTH wide.
 * Anything else — iOS, Android, a narrow browser, a width that is not a real
 * number — is 'sheet', today's bottom sheet.
 */
export function punchEditLayout(width: number, platform: string): PunchEditLayout {
  if (platform !== 'web') return 'sheet';
  if (typeof width !== 'number' || !Number.isFinite(width)) return 'sheet';
  return width >= PUNCH_EDIT_SPLIT_MIN_WIDTH ? 'split' : 'sheet';
}

/** The centred panel's size for a window of width × height (split layout only). */
export function punchEditPanelSize(width: number, height: number): { width: number; height: number } {
  const w = Math.max(0, Math.min(PUNCH_EDIT_PANEL_MAX_WIDTH, width - 2 * PUNCH_EDIT_PANEL_MARGIN));
  const h = Math.max(0, Math.min(PUNCH_EDIT_PANEL_MAX_HEIGHT, height - 2 * PUNCH_EDIT_PANEL_MARGIN));
  return { width: Math.round(w), height: Math.round(h) };
}

/** What the photo pane's buttons may do for the photo in front of him.
 *
 *  An item raised from a gallery photo carries `sourcePhotoId`, and that id is
 *  how every other device finds the photo's markup (and, while the item has no
 *  uploaded copy of its own, the photo itself — utils/punchSourcePhoto). The
 *  update payload only ever SENDS that id, it never clears it, so swapping or
 *  removing such a photo here would leave the office drawing the old circle
 *  over the new picture, or bring the old picture straight back. Those two
 *  buttons say so instead of doing it. A new item has nothing on the server
 *  yet, so its prefilled photo can always be changed. */
export type PunchPhotoPaneAction = 'add' | 'replace' | 'remove';

export const PUNCH_PHOTO_LINKED_REASON =
  'This photo is linked to one in the job’s Photos (with its markup), so it can’t be swapped or removed here yet. Change it from Photos.';

export function punchPhotoActionBlocked(args: {
  action: PunchPhotoPaneAction;
  editing: boolean;
  /** The saved item's sourcePhotoId (editing only). */
  linkedSourcePhotoId: string | undefined | null;
  /** The photo in front of him is still the saved one (not already swapped in this sheet). */
  showingSavedPhoto: boolean;
}): string | null {
  if (args.action === 'add') return null;
  if (args.editing && args.showingSavedPhoto && args.linkedSourcePhotoId) return PUNCH_PHOTO_LINKED_REASON;
  return null;
}

/** The pending photo change on an EXISTING item, applied on Update.
 *  `mimeType` is the picked file's own type (the browser's File.type) — the
 *  web picker's URI is a `blob:` URL with no extension to read it from. */
export type PunchPhotoEdit =
  | { kind: 'keep' }
  | { kind: 'replace'; uri: string; mimeType?: string | null }
  | { kind: 'remove' };

/** Extensions Storage serves correctly (utils/photoUploadCore's own table);
 *  anything else falls back to the URI's suffix, then jpg. */
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
};

/** Where a REPLACED photo's bytes go. */
export interface PunchReplacementUpload {
  /** The upload task's photoId — also the object's file name. */
  photoId: string;
  storagePath: string;
  contentType: string;
}

/**
 * A replaced photo gets a NEW object key — never the item's `punch-<id>` key.
 *
 * WHY. ProjectContext.stagePunchPhoto names a punch photo's object
 * `<user>/<project>/punch-<itemId>.<ext>`, deterministically, so retries of
 * the same photo land on the same object. A replacement is a DIFFERENT photo:
 * under that same key the upload (upsert: false) answers 409 "already exists",
 * the queue classifies that as already-uploaded and drops the task, and the
 * row keeps pointing at the OLD bytes — the new picture lived only in this
 * browser tab and came back as the old one after a reload. On web the collision
 * is certain: the file chooser hands back a `blob:` URL with no extension, so
 * the replacement resolves to `.jpg`, the same key an iPhone photo was stored
 * under. A time-stamped name is unique per replacement and fixed for that
 * replacement's own retries (the queue task carries it), which is the property
 * the deterministic key exists for. The old object is left in Storage (the
 * owner's bucket policy decides its fate; nothing references it any more).
 *
 * Null when there is nothing to stage (no signed-in user, no file, or a remote
 * URL, which has no bytes to upload) — the caller then falls back to the plain
 * reset, exactly what stagePunchPhoto would have done.
 */
export function punchReplacementUpload(args: {
  userId: string | null | undefined;
  projectId: string | null | undefined;
  itemId: string;
  uri: string;
  mimeType?: string | null;
  nowMs: number;
}): PunchReplacementUpload | null {
  const { userId, projectId, itemId, uri, mimeType, nowMs } = args;
  if (!userId || !projectId || !itemId || !uri || !isDeviceLocalUri(uri)) return null;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return null;
  const ext = (mimeType && EXT_BY_MIME[mimeType.toLowerCase()]) || photoExtFromUri(uri);
  const photoId = `punch-${itemId}-r${Math.floor(nowMs).toString(36)}`;
  return { photoId, storagePath: buildPhotoStoragePath(userId, projectId, photoId, ext), contentType: contentTypeForExt(ext) };
}

/**
 * The PunchItem patch for a photo change on Update. `keep` adds nothing, so an
 * edit that never touched the photo writes exactly what it wrote before.
 *
 * `replace` WITH its upload (punchReplacementUpload, already queued by the
 * caller) names the new object as the durable path and the picked file as the
 * local copy — stagePunchPhoto's "already staged this exact file" check then
 * leaves it alone, and the scoped update writes photo_uri = the NEW path.
 * `replace` without one (nothing could be staged) drops the old path and local
 * copy, as before. `remove` clears all three, and the update row then sends
 * photo_uri NULL.
 */
export function punchPhotoPatch(edit: PunchPhotoEdit, upload?: PunchReplacementUpload | null): {
  photoUri?: string;
  photoStoragePath?: string;
  photoLocalUri?: string;
} {
  if (edit.kind === 'replace') {
    if (upload) return { photoUri: edit.uri, photoStoragePath: upload.storagePath, photoLocalUri: edit.uri };
    return { photoUri: edit.uri, photoStoragePath: undefined, photoLocalUri: undefined };
  }
  if (edit.kind === 'remove') return { photoUri: undefined, photoStoragePath: undefined, photoLocalUri: undefined };
  return {};
}

/**
 * The loaded image's own width / height from an Image onLoad event, or null.
 *
 * Native passes `nativeEvent.source {width, height}`. react-native-web 0.21
 * passes the DOM load Event instead (ImageLoader: `onLoad({ nativeEvent: e })`),
 * which has no `source` — so on web the shape has to come from the <img>
 * itself (`target.naturalWidth / naturalHeight`). Reading only `source` left
 * the web close-up with no aspect whenever the sheet had no stored size, and
 * the pane drew an empty white square.
 */
export function loadedImageAspect(nativeEvent: unknown): number | null {
  const ev = (nativeEvent ?? {}) as {
    source?: { width?: unknown; height?: unknown };
    target?: { naturalWidth?: unknown; naturalHeight?: unknown };
  };
  const pairs: [unknown, unknown][] = [
    [ev.source?.width, ev.source?.height],
    [ev.target?.naturalWidth, ev.target?.naturalHeight],
  ];
  for (const [w, h] of pairs) {
    if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0 && Number.isFinite(w / h)) return w / h;
  }
  return null;
}

/** Where the close-up's pin marker is drawn inside its square window.
 *
 * Integration round 2 (field): the marker always hung ABOVE the pin
 * (`top = pinY*side - size`) inside a box that clips (overflow hidden), so a
 * pin within about 5 % of the sheet's top edge had its number cut in half and
 * one at y≈0 showed only the tail; near a side edge half the head was cut.
 * The PDF close-up already avoided this (utils/punchExportHtml cropPinClass);
 * this is the same rule for the pane:
 *   • too close to the top for the head to fit above → hang BELOW the pin,
 *     tail pointing up (`below`);
 *   • too close to the left/right edge for a centred head → the head runs
 *     inward from the pin (`align` 'start' / 'end'), the tail still on the pin.
 * `size` is the marker box (PIN_MARKER_SIZE); `inset` is half the tail's
 * width, so the tail's centre sits on the pin in the edge cases. */
export interface CloseUpMarkerPlacement {
  left: number;
  top: number;
  below: boolean;
  align: 'center' | 'start' | 'end';
}
export function closeUpMarkerPlacement(pinX: number, pinY: number, side: number, size: number, inset = 4): CloseUpMarkerPlacement {
  const x = pinX * side;
  const y = pinY * side;
  const below = y < size;
  const align: CloseUpMarkerPlacement['align'] = x < size / 2 ? 'start' : x > side - size / 2 ? 'end' : 'center';
  const left = align === 'start' ? x - inset : align === 'end' ? x - size + inset : x - size / 2;
  return { left, top: below ? y : y - size, below, align };
}
