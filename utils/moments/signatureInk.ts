// signatureInk.ts — the ONE place a signature stroke string is built, and the
// one statement of how a stored signature is drawn.
//
// THE EQUIVALENCE (legal; pinned by scripts/moments-checks/signline.ts S1 + S3)
// ---------------------------------------------------------------------------
// STORED: a stroke is the raw pad points, in pad coordinate space, as
//   `M${x.toFixed(1)},${y.toFixed(1)}` followed by ` L${x.toFixed(1)},${y.toFixed(1)}`
//   for every later point. No smoothing, no taper, no clamping, no resampling.
//   The bytes hashed are the bytes stored are the bytes drawn.
// DISPLAYED: the stored `d` strings drawn VERBATIM, at a constant width of 1.6
//   pad units, with round caps and round joins — exactly as
//   utils/pdfGenerator.ts buildSignatureBlock, the field-ticket authorization
//   block in the same file, and utils/lienWaiverDocument.ts draw them.
//   Nothing smooths either side. If smoothing is ever added it ships in the
//   PDF builders and the on-screen renderer in the same release, or not at all:
//   the signature on screen must be the signature in the PDF.
//
// Pure TypeScript: no react-native import, so bun validators can load it.

export interface InkPoint {
  x: number;
  y: number;
}

/** PDF stroke width, in pad (viewBox) units. utils/pdfGenerator.ts draws `stroke-width="1.6"`. */
export const PDF_SIGNATURE_STROKE_WIDTH = 1.6;
export const PDF_SIGNATURE_LINECAP = 'round' as const;
export const PDF_SIGNATURE_LINEJOIN = 'round' as const;

/** The pad's stored coordinate space (every stored signature is in this box). */
export const PAD_COORDINATE_WIDTH = 300;
export const PAD_COORDINATE_HEIGHT = 150;

/**
 * One point of a stroke, byte-identical to the legacy SignaturePad expression:
 * first point `M12.3,45.6`, later points ` L12.3,45.6` (leading space).
 */
export function formatPoint(x: number, y: number, first: boolean): string {
  return first ? `M${x.toFixed(1)},${y.toFixed(1)}` : ` L${x.toFixed(1)},${y.toFixed(1)}`;
}

/** A whole stroke. A single point is just `Mx,y`. An empty list is ''. */
export function buildStroke(points: readonly InkPoint[]): string {
  let d = '';
  for (let i = 0; i < points.length; i++) d += formatPoint(points[i].x, points[i].y, i === 0);
  return d;
}

/**
 * Display location -> stored coordinate. No clamping and no rounding here (the
 * only rounding is formatPoint's toFixed(1)). sx = coordinateWidth / width,
 * sy = coordinateHeight / height; both are 1 when the pad draws in its own
 * pixel space (every legacy caller).
 */
export function toCoordinate(locX: number, locY: number, sx: number, sy: number): InkPoint {
  return { x: locX * sx, y: locY * sy };
}

/** Count of M/L commands across the stored strokes. */
export function countPoints(paths: readonly string[]): number {
  let n = 0;
  for (const d of paths) {
    const m = d.match(/[ML]/g);
    if (m) n += m.length;
  }
  return n;
}

/**
 * Is there enough ink to count as a mark? At least one stroke and at least two
 * points in total (one tap is not a signature). The first disabled reason on
 * every drawn signing line.
 */
export function signatureReadiness(paths: readonly string[]): { strokes: number; points: number; ok: boolean } {
  const strokes = paths.filter((d) => d.length > 0).length;
  const points = countPoints(paths);
  return { strokes, points, ok: strokes >= 1 && points >= 2 };
}

/** A rect in display coordinates where a stroke may not START. */
export interface NoStartRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Is (x, y) inside any of the rects (edges inclusive)? */
export function inNoStartRect(x: number, y: number, rects: readonly NoStartRect[] | undefined): boolean {
  if (!rects) return false;
  for (const r of rects) {
    if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Readiness of the signing line (what is still missing, named under the line).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A consent checkbox may render ONLY when its answer is stored with a version.
 * Empty or whitespace = no box (never an unstored box).
 */
export function consentRenderable(version: string | null | undefined): boolean {
  return typeof version === 'string' && version.trim().length > 0;
}

export const LINE_REASONS = {
  sign: 'Sign above the line',
  name: 'Type your full legal name',
  consent: 'Check the consent box',
} as const;

/**
 * The first missing step, in this order: offline, the mark, the name, the
 * consent box. null = ready (the X becomes the capsule head).
 * `offlineReason` is CAPSULE's offlineLegalReason() (passed in so this file
 * stays dependency-free).
 */
export function lineReadiness(o: {
  offline: boolean;
  offlineReason: string;
  mode: 'drawn' | 'typed';
  paths: readonly string[];
  name: string;
  minName: number;
  consent?: { version: string; checked: boolean } | null;
}): string | null {
  if (o.offline) return o.offlineReason;
  if (o.mode === 'drawn' && !signatureReadiness(o.paths).ok) return LINE_REASONS.sign;
  if (o.name.trim().length < o.minName) return LINE_REASONS.name;
  if (o.consent && consentRenderable(o.consent.version) && !o.consent.checked) return LINE_REASONS.consent;
  return null;
}
