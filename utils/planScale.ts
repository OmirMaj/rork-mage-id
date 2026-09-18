// utils/planScale.ts — ONE frame for a plan's saved scale, on every screen
// that reads it. Pure.
//
// WHY THIS EXISTS (audit round 2, #4). A PlanCalibration is two 0–1 points
// plus a real distance, shared by Plan Viewer and Visual Takeoff
// (app/area-takeoff.tsx). The two screens normalised those points against
// DIFFERENT rectangles:
//   • Visual Takeoff: its fixed 3:4 canvas, letterbox included;
//   • Plan Viewer (before the punch-pin fix): its flex:1 container, whose
//     shape depends on the device and window.
// The same normalised Δy then covered a different number of image pixels on
// each screen. One iPhone, one 3:2 sheet: scale set on a vertical dimension
// in Plan Viewer (Δy saved as a fraction of ~600 pt) and read by Visual
// Takeoff against its 481-pt canvas → a scale line 210 px long where the
// dimension is really 241 px → every traced area ~32% high, under a banner
// that said "scale saved · ready to trace", straight into linkedEstimate.
//
// THE FRAME IS THE IMAGE. Both screens now normalise taps and draw overlays
// against the rect the `contain`-fitted image actually occupies
// (utils/punchPlanPin.containImageRect), so a point means the same spot on the
// drawing on any screen, device or window. Area and length computed in that
// frame do not depend on how big the rect is drawn.
//
// NOTHING RECORDED WHICH FRAME AN OLD ROW WAS SET IN — so an old row cannot be
// converted, only re-checked. New rows carry `frame: 'image'` INSIDE p1/p2:
// those columns are jsonb and the sync path (contexts/ProjectContext
// upsertPlanCalibration / the plan_calibrations load) passes the point object
// through whole, so the marker survives local storage and every device with
// no schema change. A row without it reads 'recheck' and is not used to size
// anything until he sets the scale again.
import type { NormPoint } from '@/utils/takeoffGeometry';

export const PLAN_SCALE_FRAME = 'image' as const;

/** A calibration point as stored — `frame` present on rows set in the image frame. */
export type StoredScalePoint = NormPoint & { frame?: unknown };

export interface StoredCalibrationLike {
  p1: StoredScalePoint;
  p2: StoredScalePoint;
  realDistanceFt: number;
}

/** Mark a point as image-normalised before it is saved. Typed as a plain
 *  NormPoint so it fits PlanCalibration['p1'] (the extra key rides the jsonb). */
export function stampImageFrame(p: NormPoint): NormPoint {
  return { x: p.x, y: p.y, frame: PLAN_SCALE_FRAME } as NormPoint;
}

export type PlanScaleStatus = 'none' | 'ready' | 'recheck';

/** 'ready' only for a row both of whose points were saved in the image frame. */
export function planScaleStatus(cal: StoredCalibrationLike | null | undefined): PlanScaleStatus {
  if (!cal) return 'none';
  const ok = cal.p1?.frame === PLAN_SCALE_FRAME && cal.p2?.frame === PLAN_SCALE_FRAME
    && Number.isFinite(cal.realDistanceFt) && cal.realDistanceFt > 0;
  return ok ? 'ready' : 'recheck';
}

/** The calibration to measure with — null unless it is in the image frame. */
export function usableCalibration<T extends StoredCalibrationLike>(cal: T | null | undefined): T | null {
  return cal && planScaleStatus(cal) === 'ready' ? cal : null;
}

export interface ImageRect { w: number; h: number; left: number; top: number }

/** A touch in the surrounding box's coordinates → image-normalised, clamped.
 *  Null while the image rect is unknown (a tap has nothing honest to mean). */
export function boxToImageNorm(bx: number, by: number, rect: ImageRect | null | undefined): NormPoint | null {
  if (!rect || !(rect.w > 0) || !(rect.h > 0) || !Number.isFinite(bx) || !Number.isFinite(by)) return null;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  return { x: clamp((bx - rect.left) / rect.w), y: clamp((by - rect.top) / rect.h) };
}

/** Image-normalised point → the surrounding box's coordinates (for drawing). */
export function imageNormToBox(p: NormPoint, rect: ImageRect): { cx: number; cy: number } {
  return { cx: rect.left + p.x * rect.w, cy: rect.top + p.y * rect.h };
}

export const PLAN_SCALE_RECHECK_COPY =
  'This sheet’s saved scale was set before MAGE measured against the drawing itself, so it may be off on this screen. Tap the same two points again to re-check it.';
