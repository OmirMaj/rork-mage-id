// utils/punchPlanPin.ts — the pure half of the punch walk's pin step
// ("photo, then pin, then description" — founder, 2026-09-17).
//
// WHY A PURE FILE. Everything that decides WHERE a pin lands and WHICH plan he
// is shown is invisible when it is wrong: a pin normalised against the wrong
// box still renders as a perfectly reasonable red marker — on the step that
// placed it. It only shows up as wrong in app/plan-viewer.tsx, a week later,
// in front of the sub, a door-width from the defect. So the math and the
// choices live here, with no react-native import, and
// scripts/validate-punch-plan-pin.ts executes all of it.
//
// THE COORDINATE CONTRACT (shared with app/plan-viewer.tsx, DrawingPin.x/y and
// PunchItem.pinX/pinY): a pin is normalised 0..1 against the rendered IMAGE
// rect — the box the plan occupies after `contain` fitting, NOT the container
// around it. The two differ on every plan whose aspect ratio is not the
// screen's: a landscape sheet on a portrait phone letterboxes top and bottom,
// and a tap normalised against the container would be pulled toward the
// middle band by the height of the letterbox.
//
// plan-viewer draws a pin as a 28pt marker at
//   left = x * w - 14,  top = y * h - 28
// inside a box sized to that image rect, i.e. the marker's bottom-centre (its
// tip) sits exactly on the point. pinMarkerPosition reproduces that formula,
// and the validator round-trips a tap through both directions.
//
// ZOOM. The step pinch-zooms through a ScrollView (iOS maximumZoomScale, as
// plan-viewer does). The ScrollView scales the CONTENT view, and a touch's
// locationX/locationY inside that content are reported in the content's own
// unscaled coordinates — so normalising against the unscaled image rect is
// correct at every zoom level, with no division by the zoom scale. That is
// also why a caller must NOT feed pageX/pageY (screen space) in here: those
// DO move with zoom and scroll.

import type { PlanSheet, PunchItem } from '@/types';
import {
  planSheetImageState,
  shouldRepickAfterDeviceUploadFailure,
  type FloorPlanFailure,
  type PlanSheetImageState,
} from '@/utils/planSheetImageCore';
import { isDeviceLocalUri } from '@/utils/photoUploadCore';

/** plan-viewer's marker: 28pt square, tip at bottom-centre. */
export const PIN_MARKER_SIZE = 28;

/** How close (pt, unscaled content) a touch must start to the marker to drag it rather than re-drop it. */
export const PIN_GRAB_RADIUS = 30;

export interface BoxSize { w: number; h: number }

export interface NormalizedPoint { x: number; y: number }

export interface WalkPin { sheetId: string; x: number; y: number }

function finitePositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Width / height of a sheet's image from the dimensions stored on it. Known
 * before the image loads, which is the point: plan-viewer waits for onLoad and
 * races its own layout (see the handoff); the pin step does not have to.
 * Null when either side is missing, so the caller falls back to onLoad.
 */
export function sheetAspectRatio(sheet: { width?: number | null; height?: number | null } | null | undefined): number | null {
  if (!sheet || !finitePositive(sheet.width) || !finitePositive(sheet.height)) return null;
  return sheet.width / sheet.height;
}

/**
 * The rect a `contain`-fitted image actually occupies inside `container`,
 * with its offset. Null while either the container or the ratio is unknown —
 * a tap then has nothing honest to be normalised against and is not accepted.
 */
export function containImageRect(
  container: BoxSize | null | undefined,
  ratio: number | null | undefined,
): (BoxSize & { left: number; top: number }) | null {
  if (!container || !finitePositive(container.w) || !finitePositive(container.h) || !finitePositive(ratio)) return null;
  const containerRatio = container.w / container.h;
  let w: number;
  let h: number;
  if (containerRatio > ratio) {
    // Container is wider than the image: full height, bars left and right.
    h = container.h;
    w = container.h * ratio;
  } else {
    // Container is taller: full width, bars top and bottom.
    w = container.w;
    h = container.w / ratio;
  }
  return { w, h, left: (container.w - w) / 2, top: (container.h - h) / 2 };
}

/** The pin close-up's side, as a fraction of the sheet's LONG edge. A room
 *  or two on a house plan; enough of the neighbourhood (walls, door swings,
 *  the room name) that the sub can find the spot without the full sheet. */
export const PIN_CROP_FRACTION = 0.2;

export interface PinCropWindow {
  /** The crop, as fractions of the image (0..1). */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The pin, as fractions of the CROP (0..1) — not always 0.5: a pin near
   *  the sheet edge keeps the crop inside the sheet and slides off-centre. */
  pinX: number;
  pinY: number;
}

/**
 * The square close-up around a pin, for the export's per-item plan crop and
 * the web edit panel's plan thumbnail. `aspect` is the image's width / height
 * (the REAL image's, oriented — never guessed). The window is a square in
 * image PIXELS whose side is `fraction` of the long edge, clamped to the sheet
 * so it never shows paper that is not there. Null for a pin or aspect that is
 * not a real number — the caller then shows no close-up rather than a wrong one.
 */
export function pinCropWindow(
  x: number,
  y: number,
  aspect: number | null | undefined,
  fraction: number = PIN_CROP_FRACTION,
): PinCropWindow | null {
  if (!finitePositive(aspect) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!finitePositive(fraction)) return null;
  const px = clamp01(x);
  const py = clamp01(y);
  // Work in units where the image is `aspect` wide and 1 tall. The side is
  // `fraction` of the long edge, but never more than the short edge — so the
  // window is always a true square in pixels (the close-up box is square, and
  // a non-square window drawn into it would stretch the plan under the pin).
  const f = Math.min(1, fraction);
  const side = Math.min(f * Math.max(aspect, 1), Math.min(aspect, 1));
  const cw = side / aspect;   // fraction of the width
  const ch = side;            // fraction of the height
  const left = Math.max(0, Math.min(1 - cw, px - cw / 2));
  const top = Math.max(0, Math.min(1 - ch, py - ch / 2));
  return {
    left, top, width: cw, height: ch,
    pinX: clamp01((px - left) / cw),
    pinY: clamp01((py - top) / ch),
  };
}

/**
 * A touch inside the image box (unscaled content coordinates) → a normalised
 * pin. Clamped to the sheet so a thumb that lands on the edge still pins the
 * edge. Null for an unmeasured box or a non-numeric touch, never a NaN pin.
 */
export function normalizeTapToImage(locationX: number, locationY: number, box: BoxSize | null | undefined): NormalizedPoint | null {
  if (!box || !finitePositive(box.w) || !finitePositive(box.h)) return null;
  if (!Number.isFinite(locationX) || !Number.isFinite(locationY)) return null;
  return { x: clamp01(locationX / box.w), y: clamp01(locationY / box.h) };
}

/**
 * Where plan-viewer draws the marker for a pin, inside a box of `box` size.
 * Same formula as app/plan-viewer.tsx's pin and punchOverlay styles — change
 * one and the validator fails until the other matches.
 */
export function pinMarkerPosition(pin: NormalizedPoint, box: BoxSize): { left: number; top: number } {
  return {
    left: pin.x * box.w - PIN_MARKER_SIZE / 2,
    top: pin.y * box.h - PIN_MARKER_SIZE,
  };
}

/** The point a marker drawn at (left, top) is pointing at, normalised. The inverse of pinMarkerPosition. */
export function pinTipFromMarker(left: number, top: number, box: BoxSize): NormalizedPoint | null {
  return normalizeTapToImage(left + PIN_MARKER_SIZE / 2, top + PIN_MARKER_SIZE, box);
}

/**
 * Did a touch start on the placed pin (so a drag moves it) rather than
 * somewhere else on the plan (so the release re-drops it)? Measured from the
 * marker's visual centre — half a marker ABOVE the tip — because that is what
 * the thumb aims at.
 */
export function isTouchOnPin(
  locationX: number,
  locationY: number,
  pin: NormalizedPoint | null | undefined,
  box: BoxSize | null | undefined,
  radius: number = PIN_GRAB_RADIUS,
): boolean {
  if (!pin || !box || !finitePositive(box.w) || !finitePositive(box.h)) return false;
  const cx = pin.x * box.w;
  const cy = pin.y * box.h - PIN_MARKER_SIZE / 2;
  const dx = locationX - cx;
  const dy = locationY - cy;
  return dx * dx + dy * dy <= radius * radius;
}

type SheetLike = Pick<PlanSheet, 'id' | 'projectId' | 'name'> & Partial<Pick<PlanSheet, 'sheetNumber' | 'superseded' | 'updatedAt' | 'imageUri' | 'storagePath'>>;

/**
 * The sheets the step offers for a project: superseded revisions are left out
 * (pinning a defect to Rev 1 of a sheet that has a Rev 2 files it against a
 * drawing nobody is looking at), EXCEPT `keepId` — the sheet an existing pin
 * already sits on, which must stay reachable so re-opening the step shows the
 * pin he placed instead of silently moving him to another sheet.
 * Input order is kept (ProjectContext returns newest-updated first).
 */
export function offerablePinSheets<T extends SheetLike>(sheets: readonly T[], projectId: string, keepId?: string | null): T[] {
  return sheets.filter(s => s.projectId === projectId && (!s.superseded || s.id === keepId));
}

/**
 * Which sheet the step opens on.
 *   1. the sheet he pinned on last in THIS walk — he walks one floor at a time;
 *   2. the sheet most recently pinned on for this project (any earlier walk);
 *   3. the first offerable sheet.
 * Only ever an offerable sheet: a superseded or foreign sheet id falls through.
 * Null when the project has none — the "no plan on this job" state.
 */
export function choosePinSheet(args: {
  sheets: readonly SheetLike[];
  projectId: string;
  sessionSheetId?: string | null;
  punchItems?: readonly Pick<PunchItem, 'projectId' | 'planSheetId' | 'pinX' | 'pinY' | 'createdAt' | 'updatedAt'>[];
}): string | null {
  const offer = offerablePinSheets(args.sheets, args.projectId);
  if (offer.length === 0) return null;
  // A DURABLE sheet beats a device-only one at every step: a pin on a plan
  // that lives only on this phone is a pin nobody else can see (the founder's
  // IMG_1668). When no durable sheet exists, a device-only one is still
  // offered — the step then asks him to save it before pinning.
  const hasDurable = offer.some(isDurablePinSheet);
  const offered = new Set(offer.filter(s => !hasDurable || isDurablePinSheet(s)).map(s => s.id));
  if (args.sessionSheetId && offered.has(args.sessionSheetId)) return args.sessionSheetId;

  let best: { id: string; at: number } | null = null;
  for (const item of args.punchItems ?? []) {
    if (item.projectId !== args.projectId || !item.planSheetId || !offered.has(item.planSheetId)) continue;
    if (typeof item.pinX !== 'number' || typeof item.pinY !== 'number') continue;
    const at = Date.parse(item.updatedAt || item.createdAt || '');
    const t = Number.isFinite(at) ? at : 0;
    if (!best || t > best.at) best = { id: item.planSheetId, at: t };
  }
  if (best) return best.id;
  // Nothing pinned yet: open on a sheet he can actually pin on, when there is
  // one, rather than on an imageless row that happens to sort first.
  return (offer.find(isDurablePinSheet) ?? offer.find(isPinnableSheet) ?? offer[0]).id;
}

/** "A-101 · Level 2 plan", or just the name when there is no sheet number. */
export function pinSheetLabel(sheet: { name?: string | null; sheetNumber?: string | null } | null | undefined): string {
  if (!sheet) return 'Plan';
  const num = String(sheet.sheetNumber ?? '').trim();
  const name = String(sheet.name ?? '').trim();
  if (num && name && num !== name) return `${num} · ${name}`;
  return num || name || 'Plan';
}

export interface ExistingSheetPin {
  id: string;
  x: number;
  y: number;
  description: string;
  /** Saved during THIS walk — drawn a little stronger than older items. */
  fromThisWalk: boolean;
}

/**
 * The punch items already pinned on `sheetId`, so he can see what is logged
 * there before dropping a duplicate. Items without a numeric in-range pin are
 * left out rather than drawn at the corner.
 */
export function pinsOnSheet(
  items: readonly Pick<PunchItem, 'id' | 'projectId' | 'planSheetId' | 'pinX' | 'pinY' | 'description'>[],
  projectId: string,
  sheetId: string | null | undefined,
  sessionIds: ReadonlySet<string> | readonly string[] = [],
  /** Items NOT drawn as faint existing pins — the item being moved, whose old
   *  spot would otherwise sit under the new one as a duplicate. */
  hideIds: ReadonlySet<string> | readonly string[] = [],
): ExistingSheetPin[] {
  if (!sheetId) return [];
  const session = sessionIds instanceof Set ? sessionIds : new Set(sessionIds as readonly string[]);
  const hidden = hideIds instanceof Set ? hideIds : new Set(hideIds as readonly string[]);
  const out: ExistingSheetPin[] = [];
  for (const i of items) {
    if (i.projectId !== projectId || i.planSheetId !== sheetId) continue;
    if (hidden.has(i.id)) continue;
    const { pinX: x, pinY: y } = i;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < 0 || x > 1 || y < 0 || y > 1) continue;
    out.push({ id: i.id, x, y, description: i.description, fromThisWalk: session.has(i.id) });
  }
  return out;
}

/**
 * The fields handleSave spreads onto the PunchItem. No pin (he tapped Skip,
 * or never opened the step) → an empty object, so the item saves exactly as it
 * did before the step existed: no planSheetId key at all, not a null one.
 */
export function punchPinFields(pin: WalkPin | null | undefined): Pick<PunchItem, 'planSheetId' | 'pinX' | 'pinY'> {
  if (!pin || !pin.sheetId || !Number.isFinite(pin.x) || !Number.isFinite(pin.y)) return {};
  return { planSheetId: pin.sheetId, pinX: clamp01(pin.x), pinY: clamp01(pin.y) };
}

/**
 * Should taking a photo open the pin step on its own?
 *
 * Always — EXCEPT on a job with no plan at all where he has already been told
 * so once this walk and chose Skip. The "no plan on this job" screen says the
 * same thing every time; putting it in front of a thirty-photo walk thirty
 * times is how a speed tool becomes the thing he stops using. The "Pin on
 * plan" link under the photo still opens it on demand.
 */
export function shouldAutoOpenPinStep(args: { pinnableSheetCount: number; dismissedNoPlanThisWalk: boolean; pinDecided?: boolean }): boolean {
  // He already answered "where is this item" for THIS draft (Next, Skip or
  // Remove). A photo taken after that — pin first, or a retake — must not
  // bring the plan back to ask again.
  if (args.pinDecided) return false;
  if (args.pinnableSheetCount > 0) return true;
  return !args.dismissedNoPlanThisWalk;
}

/**
 * Can a pin be placed on this sheet at all? A sheet whose image is MISSING
 * (the founder's IMG_1668: a row with image_uri '') cannot — the step can only
 * offer to add its picture. For auto-open and for Skip, such a sheet counts as
 * "no plan": counting it as a plan re-opened a screen with nothing to pin on
 * after every photo, and Skip could never mute it (review, 2026-09-17).
 * A device-only sheet IS pinnable: it renders on this phone.
 */
export function isPinnableSheet(sheet: { imageUri?: string | null; storagePath?: string | null }): boolean {
  return planSheetImageState(sheet) !== 'missing';
}

/** The number the walk hands shouldAutoOpenPinStep: offerable AND pinnable. */
export function pinnableSheetCount<T extends SheetLike>(sheets: readonly T[], projectId: string): number {
  return offerablePinSheets(sheets, projectId).filter(isPinnableSheet).length;
}

/** Public object URL shape for a storage path (only used as a cache-lookup handle; see pinStepImageSource). */
export function planSheetPublicObjectUrl(baseUrl: string, storagePath: string): string {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const key = String(storagePath).replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  return `${base}/storage/v1/object/public/plan-sheets/${key}`;
}

/**
 * What the step hands expo-image for a sheet.
 *
 * WHY. From disk (offline cold start — the basement case) ProjectContext keeps
 * `imageUri` as the bare STORAGE PATH, because signing failed. `{ uri: path }`
 * is not a URL, carries no cacheKey, and expo-image never consults its disk
 * cache — so a plan that opened on this phone yesterday would not open today.
 * Rules, whenever the sheet has a storagePath:
 *   • cacheKey is ALWAYS `plan-sheets/<storagePath>`: the signed URL changes
 *     every 24 h, the path does not, so the disk entry survives re-signing;
 *   • the uri is, in order: a freshly re-signed URL (retry / cold start),
 *     a device-local capture (the plan he just photographed — renders with no
 *     network AND seeds the path-keyed cache), an https imageUri, and finally a
 *     stable URL built from the path. That last one may never fetch (the
 *     bucket is going private), but it is a valid URL, so the cache is checked
 *     by key before anything touches the network.
 * No storagePath: the imageUri as-is (a device-only sheet or a foreign https
 * image), or null when there is nothing.
 */
export function pinStepImageSource(
  sheet: { imageUri?: string | null; storagePath?: string | null } | null | undefined,
  opts: { publicBaseUrl: string; resignedUri?: string | null },
): { uri: string; cacheKey?: string } | null {
  if (!sheet) return null;
  const imageUri = String(sheet.imageUri ?? '').trim();
  const path = String(sheet.storagePath ?? '').trim().replace(/^\/+/, '');
  const isHttp = (u: string | null | undefined) => !!u && /^https?:\/\//i.test(u);
  if (!path) return imageUri ? { uri: imageUri } : null;
  const cacheKey = `plan-sheets/${path}`;
  if (isHttp(opts.resignedUri)) return { uri: opts.resignedUri as string, cacheKey };
  if (imageUri && isDeviceLocalUri(imageUri)) return { uri: imageUri, cacheKey };
  if (isHttp(imageUri)) return { uri: imageUri, cacheKey };
  return { uri: planSheetPublicObjectUrl(opts.publicBaseUrl, path), cacheKey };
}

/**
 * Why the "add a plan" buttons are blocked, or null when they are not.
 * The plan-sheets storage INSERT policy requires `can_access_project(…, 'editor')`,
 * so only an owner or editor can store a plan. Anyone else is told BEFORE he
 * picks and uploads a photo, not after the server refuses it. A null role means
 * the collaborator list has not resolved (roleForUser reports a solo owner as
 * 'owner', never null), so it blocks with the reason rather than guessing.
 */
export function planUploadBlockedReason(
  role: 'owner' | 'editor' | 'viewer' | 'field' | null,
  status: { isLoading: boolean; isError: boolean },
): string | null {
  if (role === 'owner' || role === 'editor') return null;
  if (role === 'viewer') {
    return 'You have view-only access to this job, so you can’t add a plan to it. Ask the project owner for editor access, or skip the pin.';
  }
  if (role === 'field') {
    return 'Field access can pin on a plan but can’t add one. Ask the project owner or an editor to add the plan, or skip the pin.';
  }
  if (status.isLoading) return 'Checking whether you can add plans to this job…';
  return 'Couldn’t check your access to this job — usually no signal. Try again with signal, or skip the pin.';
}

// ── Durable vs device-only (critic 2026-09-17, issue #3) ─────────────────────
//
// isPinnableSheet above answers "does it render on THIS phone" and stays as it
// is (other code imports it). The walk needs a stricter question: "would a pin
// on it be seen by anyone else?" Only a durable sheet — one with a storage
// path or an https image — says yes. A device-only sheet (the founder's only
// production sheet, IMG_1668: image_uri '' in Postgres, a file:// on the phone
// that imported it) is shown, but the step asks him to SAVE it first.

/** True when the sheet's image lives somewhere every device can load it. */
export function isDurablePinSheet(sheet: { imageUri?: string | null; storagePath?: string | null }): boolean {
  return planSheetImageState(sheet) === 'durable';
}

/**
 * The number the walk hands shouldAutoOpenPinStep: offerable AND durable. A
 * device-only sheet counts as "no plan yet", so the first photo still opens
 * the step (which offers to save it) and a Skip mutes it for the walk instead
 * of re-opening a save prompt after every photo.
 */
export function durablePinSheetCount<T extends SheetLike>(sheets: readonly T[], projectId: string): number {
  return offerablePinSheets(sheets, projectId).filter(isDurablePinSheet).length;
}

/**
 * What the pin step shows for the current sheet.
 *   pin       — durable and on screen: tap to pin.
 *   save      — device-only and it rendered: "only on this phone — save it"
 *               (uploads the file it already has; the sheet id is kept).
 *   repick    — device-only but the file is gone (load error) or is a file the
 *               plan store will never take (HEIC / oversize from an old
 *               full-quality import): photograph or pick it again, attached
 *               to the SAME sheet so its pins survive. "Try again" cannot help
 *               here — there is no storage path to re-sign.
 *   add-image — the sheet has no image at all.
 * Pinning is only ever offered in 'pin'.
 */
export type PinStepSheetMode = 'pin' | 'save' | 'repick' | 'add-image';

export function pinStepSheetMode(args: {
  imageState: PlanSheetImageState;
  loadState: 'loading' | 'loaded' | 'error';
  saveFailure?: FloorPlanFailure | null;
}): PinStepSheetMode {
  if (args.imageState === 'missing') return 'add-image';
  if (args.imageState === 'durable') return 'pin';
  if (args.loadState === 'error') return 'repick';
  if (args.saveFailure && shouldRepickAfterDeviceUploadFailure(args.saveFailure)) return 'repick';
  return 'save';
}

// ── Where the viewer's image ratio comes from (critic 2026-09-17, issue #2) ──

/**
 * Width / height from an image onLoad event, whatever shape the platform
 * hands over:
 *   • RN native Image (Fabric):   nativeEvent.source.{width,height}
 *   • expo-image (all platforms): event.source.{width,height}
 *   • react-native-web <Image>:   nativeEvent IS the DOM load Event
 *     (ImageLoader.load → onLoad({ nativeEvent: e })), which has NO `source`;
 *     the decoded size is on its target, an HTMLImageElement
 *     (naturalWidth/naturalHeight).
 * plan-viewer on web read only `source`, never got a ratio, and drew every pin
 * against the letterboxed container — 60 to 270 px off on a 1200x700 canvas.
 * Accepts either the event or its nativeEvent. Null when nothing is usable.
 */
export function imageLoadAspectRatio(event: unknown): number | null {
  if (!event || typeof event !== 'object') return null;
  const candidates: unknown[] = [event];
  const ne = (event as { nativeEvent?: unknown }).nativeEvent;
  if (ne && typeof ne === 'object') candidates.push(ne);
  for (const c of candidates) {
    const o = c as { source?: { width?: unknown; height?: unknown }; target?: unknown; currentTarget?: unknown };
    if (o.source && finitePositive(o.source.width) && finitePositive(o.source.height)) {
      return o.source.width / o.source.height;
    }
    for (const el of [o.target, o.currentTarget]) {
      if (!el || typeof el !== 'object') continue;
      const img = el as { naturalWidth?: unknown; naturalHeight?: unknown };
      if (finitePositive(img.naturalWidth) && finitePositive(img.naturalHeight)) {
        return img.naturalWidth / img.naturalHeight;
      }
    }
  }
  return null;
}

/**
 * The ratio plan-viewer sizes its image box with. The SAME precedence as the
 * pin step (loaded image first, stored width/height second), so the box a pin
 * was normalised against and the box it is drawn in are the same rect. The
 * stored dimensions matter most where onLoad never reports: a web build whose
 * event shape changes, or an offline cold start where the image cannot load
 * at all and the pins would otherwise be placed against the whole canvas.
 * Every addFloorPlan and PDF-rendered sheet stores width/height.
 */
export function planViewerImageRatio(
  loadedRatio: number | null | undefined,
  sheet: { width?: number | null; height?: number | null } | null | undefined,
): number | null {
  return finitePositive(loadedRatio) ? loadedRatio : sheetAspectRatio(sheet);
}

// ── Pin first / pin later (founder, 2026-09-18) ──────────────────────────────
// "i want to be able to pin the location of each item before and after taking
// photos". The helpers below are executed by scripts/validate-punch-pin-items.ts.

/**
 * Which sheet a pin step opens on when a caller knows more than the walk does:
 *   1. the sheet of the item's own pin (Move pin, Back in Pin items);
 *   2. `initialSheetId` — the sheet an item is filed to with no spot;
 *   3. choosePinSheet (this session's sheet → last pinned → first offerable).
 * 1 and 2 only when that sheet is listed for the project — a deleted sheet
 * falls through instead of opening on nothing.
 */
export function pickInitialPinSheet(args: {
  sheets: readonly SheetLike[];
  projectId: string;
  initialPin?: WalkPin | null;
  initialSheetId?: string | null;
  sessionSheetId?: string | null;
  punchItems?: readonly Pick<PunchItem, 'projectId' | 'planSheetId' | 'pinX' | 'pinY' | 'createdAt' | 'updatedAt'>[];
}): string | null {
  const listed = (id: string | null | undefined) => !!id && args.sheets.some(s => s.id === id && s.projectId === args.projectId);
  if (args.initialPin && listed(args.initialPin.sheetId)) return args.initialPin.sheetId;
  if (listed(args.initialSheetId)) return args.initialSheetId as string;
  return choosePinSheet({ sheets: args.sheets, projectId: args.projectId, sessionSheetId: args.sessionSheetId, punchItems: args.punchItems });
}

/** How Walk Mode starts: photo first (the default) or pin first. */
export type WalkStart = 'photo' | 'pin';

/** Only an explicit `start=pin` starts pin-first; anything else is the walk as it always was. */
export function walkStartFromParam(raw: string | string[] | undefined): WalkStart {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'pin' ? 'pin' : 'photo';
}

/**
 * After the pin step closes (Next or Skip pin), does the camera open? Only in
 * pin-first mode, and only while the draft has no photo yet: a photo-first
 * item that is being re-pinned already has its picture.
 */
export function shouldOpenCameraAfterPin(args: { pinFirst: boolean; draftHasPhoto: boolean }): boolean {
  return args.pinFirst && !args.draftHasPhoto;
}

/**
 * Why "Import a PDF plan set" is blocked, or null. The import runs on the
 * Plans screen, which is Plans & Drawings (plan_markup). The role gate (who
 * may store a plan at all) is planUploadBlockedReason, shown by the step.
 */
export function pdfImportBlockedReason(hasPlansFeature: boolean): string | null {
  return hasPlansFeature
    ? null
    : 'Importing a PDF plan set is part of Plans & Drawings, which your plan does not include. Photograph or choose the plan image instead.';
}
