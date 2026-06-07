// takeoffGeometry.ts — turn a region drawn on a scaled plan into real quantities.
//
// The existing plan-viewer already calibrates a sheet (tap two points, enter the
// real distance → feet per displayed pixel) and stores it as a PlanCalibration in
// normalized 0–1 coordinates so it survives zoom/rotate/device differences. This
// module is the missing math for AREA takeoff: given a polygon a user traced on
// that same sheet, compute its real square footage (shoelace), plus polyline
// length for linear takeoff and a perimeter helper.
//
// All inputs are normalized (0–1) points + the displayed image pixel size + the
// calibration's feet-per-pixel scalar, exactly matching plan-viewer's model. Pure
// functions — no React, no storage — so the geometry is unit-testable on its own.

export interface NormPoint {
  /** 0–1 across the image width. */
  x: number;
  /** 0–1 down the image height. */
  y: number;
}

export interface PlanCalibrationLike {
  p1: NormPoint;
  p2: NormPoint;
  realDistanceFt: number;
}

/**
 * Feet per displayed pixel, from two calibration points a known real distance
 * apart. Same formula plan-viewer uses. Returns null when the two points are
 * effectively coincident (can't derive a scale).
 */
export function feetPerPixel(
  cal: PlanCalibrationLike,
  imgW: number,
  imgH: number,
): number | null {
  const dx = (cal.p2.x - cal.p1.x) * imgW;
  const dy = (cal.p2.y - cal.p1.y) * imgH;
  const distPx = Math.sqrt(dx * dx + dy * dy);
  if (distPx < 1) return null;
  return cal.realDistanceFt / distPx;
}

/** Convert normalized points to displayed-pixel points. */
function toPixels(points: NormPoint[], imgW: number, imgH: number): NormPoint[] {
  return points.map(p => ({ x: p.x * imgW, y: p.y * imgH }));
}

/**
 * Polygon area in REAL square feet via the shoelace formula. `points` are the
 * normalized polygon vertices (>= 3); the polygon is treated as closed (last
 * vertex connects back to the first). Returns 0 for degenerate input.
 */
export function polygonAreaSqFt(
  points: NormPoint[],
  imgW: number,
  imgH: number,
  ftPerPx: number,
): number {
  if (points.length < 3 || ftPerPx <= 0 || imgW <= 0 || imgH <= 0) return 0;
  const px = toPixels(points, imgW, imgH);
  let area2 = 0;
  for (let i = 0; i < px.length; i++) {
    const a = px[i];
    const b = px[(i + 1) % px.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  return (Math.abs(area2) / 2) * ftPerPx * ftPerPx;
}

/**
 * Open polyline length in REAL feet (sum of segment lengths, not closed).
 * For a single segment pass two points.
 */
export function polylineLengthFt(
  points: NormPoint[],
  imgW: number,
  imgH: number,
  ftPerPx: number,
): number {
  if (points.length < 2 || ftPerPx <= 0) return 0;
  const px = toPixels(points, imgW, imgH);
  let d = 0;
  for (let i = 1; i < px.length; i++) {
    const dx = px[i].x - px[i - 1].x;
    const dy = px[i].y - px[i - 1].y;
    d += Math.sqrt(dx * dx + dy * dy);
  }
  return d * ftPerPx;
}

/** Closed-polygon perimeter in REAL feet (length + the closing segment). */
export function polygonPerimeterFt(
  points: NormPoint[],
  imgW: number,
  imgH: number,
  ftPerPx: number,
): number {
  if (points.length < 3) return polylineLengthFt(points, imgW, imgH, ftPerPx);
  const closed = [...points, points[0]];
  return polylineLengthFt(closed, imgW, imgH, ftPerPx);
}

/** Centroid of a set of normalized points (for label placement). */
export function centroid(points: NormPoint[]): NormPoint {
  if (points.length === 0) return { x: 0.5, y: 0.5 };
  const s = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / points.length, y: s.y / points.length };
}

/** Format a square-foot quantity compactly (e.g. "1,240 SF"). */
export function formatSqFt(sqft: number): string {
  return `${Math.round(sqft).toLocaleString('en-US')} SF`;
}

/** Format a linear-foot quantity (e.g. "84 LF"). */
export function formatLinearFt(ft: number): string {
  return `${Math.round(ft).toLocaleString('en-US')} LF`;
}
