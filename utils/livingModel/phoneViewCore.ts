// utils/livingModel/phoneViewCore.ts — the arithmetic of the phone's 3D view.
//
// The Living Model, the phone's 3D view (lane PHONE3D). PURE: no React, no
// React Native, no 3D library. components/livingModel/phone3d/ turns touches
// into these numbers and hands the answers to the SAME scene the web draws
// (components/livingModel/threeScene.ts). scripts/validate-phone-3d.ts runs
// every function here against hand-worked answers.
//
// THREE THINGS LIVE HERE.
//   1. Fingers. One finger turns the model, two fingers move it, a pinch
//      zooms, and a short still touch is a tap that picks a room.
//   2. Sizes. The scene works in its own units; the screen works in points.
//      viewSize says how many scene units the drawing buffer is, and the
//      factor between the two.
//   3. Labels. A room's second line is shown only when the room is wide
//      enough on the screen to carry it.

/** One finger on the glass, in points from the top left of the screen. */
export interface FingerPoint { id: string; x: number; y: number }

export type GestureAct =
  | { kind: 'orbit'; dx: number; dy: number }
  | { kind: 'pan'; dx: number; dy: number }
  | { kind: 'zoom'; factor: number }
  | { kind: 'tap' };

export interface GestureState {
  /** Where each finger was at the last step. */
  fingers: readonly FingerPoint[];
  /** When the first finger landed, in milliseconds. */
  startedAt: number;
  /** How far the first finger has travelled from where it landed, at most. */
  travel: number;
  startX: number;
  startY: number;
  /** A second finger landed at some point, so this touch can never be a tap. */
  multi: boolean;
  /** The finger left its landing spot, so this touch can never be a tap. */
  moved: boolean;
}

/** A finger that stays inside this many points of where it landed is still. */
export const TAP_SLOP_PT = 8;
/** A still touch longer than this is a hold, not a tap. */
export const TAP_MAX_MS = 450;
/** One step may not zoom by more than this, in or out: a finger that jumps cannot throw the model away. */
export const MAX_ZOOM_STEP = 1.6;

const finite = (n: number): boolean => typeof n === 'number' && Number.isFinite(n);
const clean = (fingers: readonly FingerPoint[]): FingerPoint[] => fingers.filter((f) => finite(f.x) && finite(f.y)).slice(0, 2).map((f) => ({ id: String(f.id), x: f.x, y: f.y }));

export function gestureBegin(fingers: readonly FingerPoint[], now: number): GestureState {
  const f = clean(fingers);
  return { fingers: f, startedAt: now, travel: 0, startX: f[0]?.x ?? 0, startY: f[0]?.y ?? 0, multi: f.length > 1, moved: false };
}

/**
 * The fingers moved, or one landed or lifted. Returns the next state and what
 * the model should do. When the NUMBER of fingers changes nothing moves: the
 * new fingers are only written down, so lifting one of two fingers never
 * makes the model jump.
 */
export function gestureMove(prev: GestureState, fingers: readonly FingerPoint[]): { state: GestureState; acts: GestureAct[] } {
  const now = clean(fingers);
  const acts: GestureAct[] = [];
  let { travel, moved } = prev;
  const multi = prev.multi || now.length > 1;
  const same = now.length === prev.fingers.length && now.every((f, i) => f.id === prev.fingers[i].id);
  if (same && now.length === 1) {
    const a = prev.fingers[0];
    const b = now[0];
    travel = Math.max(travel, Math.hypot(b.x - prev.startX, b.y - prev.startY));
    const wasMoved = moved;
    if (travel > TAP_SLOP_PT) moved = true;
    // Nothing turns until the finger has left its landing spot, so a tap never nudges the view.
    if (moved && !multi) {
      const dx = wasMoved ? b.x - a.x : b.x - prev.startX;
      const dy = wasMoved ? b.y - a.y : b.y - prev.startY;
      if (dx !== 0 || dy !== 0) acts.push({ kind: 'orbit', dx, dy });
    }
  } else if (same && now.length === 2) {
    const [a0, a1] = prev.fingers;
    const [b0, b1] = now;
    const d0 = Math.hypot(a0.x - a1.x, a0.y - a1.y);
    const d1 = Math.hypot(b0.x - b1.x, b0.y - b1.y);
    if (d0 > 1 && d1 > 1) {
      const factor = Math.max(1 / MAX_ZOOM_STEP, Math.min(MAX_ZOOM_STEP, d1 / d0));
      if (factor !== 1) acts.push({ kind: 'zoom', factor });
    }
    const dx = (b0.x + b1.x) / 2 - (a0.x + a1.x) / 2;
    const dy = (b0.y + b1.y) / 2 - (a0.y + a1.y) / 2;
    if (dx !== 0 || dy !== 0) acts.push({ kind: 'pan', dx, dy });
    moved = true;
  }
  return { state: { ...prev, fingers: now, travel, moved, multi }, acts };
}

/** The last finger lifted. A tap is one finger that stayed still and did not stay long. */
export function gestureEnd(prev: GestureState, now: number): GestureAct[] {
  if (prev.multi || prev.moved) return [];
  if (now - prev.startedAt > TAP_MAX_MS) return [];
  return [{ kind: 'tap' }];
}

export interface PhoneViewSize {
  /** The width and height handed to the scene, in scene units. */
  width: number;
  height: number;
  /** The pixel ratio handed to the scene: the scene accepts 1 to 2. */
  pixelRatio: number;
  /** Scene units per point of the screen. 1 on a 2x phone, 1.5 on a 3x phone. */
  unitsPerPoint: number;
}

/**
 * The scene (threeScene.resize) caps its pixel ratio at 2 and sets its
 * viewport to width x height x ratio. The phone's drawing buffer is the view's
 * size times the screen's scale, which is 3 on a Pro Max. Handing the scene
 * the size in POINTS would fill two thirds of the buffer. So the scene is
 * handed buffer / ratio, which fills the buffer on every screen, and every
 * point that goes in (a tap, a two-finger move) or comes out (a label) is
 * multiplied or divided by unitsPerPoint.
 */
export function viewSize(layoutWidthPt: number, layoutHeightPt: number, bufferWidthPx: number, bufferHeightPx: number): PhoneViewSize | null {
  if (![layoutWidthPt, layoutHeightPt, bufferWidthPx, bufferHeightPx].every((n) => finite(n) && n >= 1)) return null;
  const scale = bufferWidthPx / layoutWidthPt;
  const pixelRatio = Math.max(1, Math.min(2, scale));
  const width = bufferWidthPx / pixelRatio;
  return { width, height: bufferHeightPx / pixelRatio, pixelRatio, unitsPerPoint: width / layoutWidthPt };
}

/** The scene's own zoom limits (threeScene.zoomBy), mirrored so the label rule knows the zoom. */
export const SCENE_ZOOM_MIN = 0.5;
export const SCENE_ZOOM_MAX = 6;
export const nextZoom = (zoom: number, factor: number): number => Math.max(SCENE_ZOOM_MIN, Math.min(SCENE_ZOOM_MAX, zoom * (finite(factor) && factor > 0 ? factor : 1)));

/**
 * Points of screen per metre of floor, for the scene's camera
 * (threeScene.updateCamera: min(w, h x 1.4) / (span x 1.3) x zoom, in scene units).
 */
export function pointsPerMetre(size: PhoneViewSize, spanM: number, zoom: number): number {
  if (!(spanM > 0) || !(zoom > 0)) return 0;
  return ((Math.min(size.width, size.height * 1.4) / (spanM * 1.3)) * zoom) / size.unitsPerPoint;
}

/** A room whose shorter side is under this many points on the screen shows its name alone. */
export const SECOND_LINE_MIN_PT = 84;
/** A room needs a longer side of at least this many points to carry its name... */
export const LABEL_MIN_LONG_PT = 56;
/** ...and a shorter side of at least this many. Smaller, it shows no label: the room list below still names it. */
export const LABEL_MIN_SHORT_PT = 22;

export type LabelDetail = 'none' | 'name' | 'full';

/** How much of a room's label fits, from the room's two sides in metres. */
export function labelDetail(shortSideM: number, longSideM: number, ptPerMetre: number): LabelDetail {
  const short = Math.min(shortSideM, longSideM) * ptPerMetre;
  const long = Math.max(shortSideM, longSideM) * ptPerMetre;
  if (!(short >= LABEL_MIN_SHORT_PT) || !(long >= LABEL_MIN_LONG_PT)) return 'none';
  return short >= SECOND_LINE_MIN_PT ? 'full' : 'name';
}

/** The slowest the labels are moved while the model turns: about thirty times a second. */
export const LABEL_THROTTLE_MS = 33;

/**
 * A running count of how long frames take, for the spike route and the build
 * notes. Keeps the last `keep` frames; reports the middle, the slow end and
 * the worst.
 */
export function frameStats(samplesMs: readonly number[]): { frames: number; medianMs: number; p95Ms: number; worstMs: number } {
  const s = samplesMs.filter((n) => finite(n) && n >= 0).slice().sort((a, b) => a - b);
  if (!s.length) return { frames: 0, medianMs: 0, p95Ms: 0, worstMs: 0 };
  const at = (q: number): number => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { frames: s.length, medianMs: at(0.5), p95Ms: at(0.95), worstMs: s[s.length - 1] };
}
