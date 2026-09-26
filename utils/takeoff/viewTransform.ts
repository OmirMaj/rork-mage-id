// utils/takeoff/viewTransform.ts — the desktop takeoff canvas's zoom/pan maths
// (wave 4). Pure; no React.
//
// THE MODEL. The canvas is a box `canvas` (w × h). Inside it the "paper" View
// is laid out at (paper.left, paper.top) with size paper.w × paper.h (from
// fitRect — the sheet image contain-fitted with a margin). A ViewT is the CSS
// transform on that paper View:
//   transform: translate(tx, ty) scale(scale);  transform-origin: 0 0
// so a paper-local point (px, py) lands on the canvas at
//   x = paper.left + tx + scale · px,   y = paper.top + ty + scale · py.
// Image-normalised points (0–1, utils/takeoffGeometry.NormPoint) are
// px = n.x · paper.w, py = n.y · paper.h. Every function below is that one
// equation or its inverse.

import type { NormPoint } from '@/utils/takeoffGeometry';

export interface ViewT { scale: number; tx: number; ty: number }

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

export const IDENTITY_VIEW: ViewT = Object.freeze({ scale: 1, tx: 0, ty: 0 }) as ViewT;

export type PaperRect = { w: number; h: number; left: number; top: number };

const clampScale = (s: number): number =>
  !Number.isFinite(s) ? 1 : Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

/** The sheet (width/height = aspect) contain-fitted inside the canvas with `pad` on every side, centred. */
export function fitRect(canvas: { w: number; h: number }, aspect: number, pad = 24): PaperRect {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const availW = Math.max(1, canvas.w - 2 * pad);
  const availH = Math.max(1, canvas.h - 2 * pad);
  let w: number;
  let h: number;
  if (availW / availH > a) { h = availH; w = h * a; } else { w = availW; h = w / a; }
  return { w, h, left: (canvas.w - w) / 2, top: (canvas.h - h) / 2 };
}

/**
 * Zoom by `factor` about the pointer, keeping the image point under it fixed;
 * the scale is clamped to [MIN_SCALE, MAX_SCALE] (the fixed point still holds
 * at the clamped scale).
 *
 * (cx, cy): pass CANVAS coordinates together with `paper` (recommended), or —
 * with `paper` omitted — coordinates relative to the paper's untransformed
 * top-left (canvas point − (paper.left, paper.top)).
 */
export function zoomAt(v: ViewT, factor: number, cx: number, cy: number, paper?: { left: number; top: number }): ViewT {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const scale = clampScale(v.scale * f);
  const ox = cx - (paper?.left ?? 0);
  const oy = cy - (paper?.top ?? 0);
  const k = scale / v.scale;
  return { scale, tx: ox - k * (ox - v.tx), ty: oy - k * (oy - v.ty) };
}

export function panBy(v: ViewT, dx: number, dy: number): ViewT {
  return { scale: v.scale, tx: v.tx + (Number.isFinite(dx) ? dx : 0), ty: v.ty + (Number.isFinite(dy) ? dy : 0) };
}

/** Canvas point → image-normalised point (the inverse transform); null outside the sheet. */
export function canvasToNorm(v: ViewT, paper: PaperRect, cx: number, cy: number): NormPoint | null {
  if (!(paper.w > 0) || !(paper.h > 0) || !(v.scale > 0)) return null;
  const px = (cx - paper.left - v.tx) / v.scale;
  const py = (cy - paper.top - v.ty) / v.scale;
  const x = px / paper.w;
  const y = py / paper.h;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

/** Image-normalised point → canvas point. */
export function normToCanvas(v: ViewT, paper: PaperRect, p: NormPoint): { x: number; y: number } {
  return {
    x: paper.left + v.tx + v.scale * p.x * paper.w,
    y: paper.top + v.ty + v.scale * p.y * paper.h,
  };
}

/** A view that frames these points (e.g. "zoom to this condition") with `pad` around them; the identity view for none. */
export function fitToPoints(canvas: { w: number; h: number }, paper: PaperRect, pts: NormPoint[], pad = 48): ViewT {
  if (!pts.length || !(paper.w > 0) || !(paper.h > 0)) return { scale: 1, tx: 0, ty: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    const x = p.x * paper.w;
    const y = p.y * paper.h;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  // A single point or a straight line has no extent on one axis: frame at
  // least 5% of the sheet so the scale stays finite and sane.
  const bw = Math.max(maxX - minX, paper.w * 0.05);
  const bh = Math.max(maxY - minY, paper.h * 0.05);
  const availW = Math.max(1, canvas.w - 2 * pad);
  const availH = Math.max(1, canvas.h - 2 * pad);
  const scale = clampScale(Math.min(availW / bw, availH / bh));
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  return { scale, tx: canvas.w / 2 - paper.left - scale * midX, ty: canvas.h / 2 - paper.top - scale * midY };
}

const R = Math.SQRT1_2;
/** The eight 45° directions, exact on the axes (cos 90° is not exactly 0 in floating point). */
const DIRS: [number, number][] = [[1, 0], [R, R], [0, 1], [-R, R], [-1, 0], [-R, -R], [0, -1], [R, -R]];

/**
 * Shift-constrain: snap `next` so the segment from `prev` runs at 0/45/90°
 * in REAL (aspect-corrected) space — the drawn vector is projected onto the
 * nearest 45° direction, then shortened (never re-angled) if it would leave
 * the sheet.
 */
export function snap45(prev: NormPoint, next: NormPoint, aspect: number): NormPoint {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const dx = (next.x - prev.x) * a;
  const dy = next.y - prev.y;
  if (dx === 0 && dy === 0) return { x: prev.x, y: prev.y };
  const k = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
  const [ux, uy] = DIRS[k];
  const d = Math.max(0, dx * ux + dy * uy);
  let nx = d * ux / a;
  let ny = d * uy;
  // Shorten along the same direction to stay inside [0,1]².
  let t = 1;
  if (nx > 0 && prev.x + nx > 1) t = Math.min(t, (1 - prev.x) / nx);
  if (nx < 0 && prev.x + nx < 0) t = Math.min(t, -prev.x / nx);
  if (ny > 0 && prev.y + ny > 1) t = Math.min(t, (1 - prev.y) / ny);
  if (ny < 0 && prev.y + ny < 0) t = Math.min(t, -prev.y / ny);
  t = Math.max(0, t);
  nx *= t;
  ny *= t;
  return { x: prev.x + nx, y: prev.y + ny };
}
