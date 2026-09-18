// utils/arTrack/driftMath.ts — plan ↔ AR alignment, and the error it implies.
//
// WHY THIS IS A PURE FILE WITH NO REACT IMPORT. Every failure in here is
// invisible. A transform fitted with the handedness flipped still produces a
// tidy predicted point on the plan; it just puts it on the wrong side of the
// corridor. A similarity fit that lets SCALE float still produces a small
// residual; it has simply absorbed ARKit's drift into the scale term and made a
// bad session look good. Neither shows up as an error — both show up as a
// plausible number in a report that decides whether a feature ships. So the
// maths lives here, with no react-native import, and
// scripts/validate-ar-spike.ts executes all of it against cases with known
// answers.
//
// ── THE ONE RULE ────────────────────────────────────────────────────────────
//
// SCALE IS FIXED AT 1. ARKit is metric — its world units ARE metres. Fitting a
// scale factor would let the fit soak up exactly the drift the trial exists to
// measure. Scale is reported as a DIAGNOSTIC RATIO (`distanceRatios`) and never
// as a fitted parameter.
//
// ── THE TWO FRAMES, AND WHY HANDEDNESS IS WRITTEN DOWN ──────────────────────
//
// ARKit world: x right, y UP, z toward the viewer — right-handed. Seen from
// above (looking down -y), screen-right is +x and "away from you" is -z, so the
// horizontal plane read as an ordinary (right, up) 2D frame is (x, -z).
//
// Plan image: x right, y DOWN. As an ordinary (right, up) 2D frame that is
// (x, -y).
//
// Both are therefore mapped into a shared PLANAR frame — (right, up), metres —
// before anything is fitted, and the fit is a PROPER rotation (determinant +1).
// If either conversion is dropped the two frames differ by a reflection, no
// proper rotation can align them, and a three-point fit degrades into nonsense
// while a two-point fit silently mirrors the floor. That is the bug this
// comment exists to stop.
//
// ── AND WHY THE FIT NEVER SEES `pose.local` ─────────────────────────────────
//
// The native module also reports an origin-relative `local` point: x = right,
// y = up, z = FORWARD of the way he faced at setOrigin. That frame is
// LEFT-handed — a reflection of ARKit world — because "forward" is ARKit's -z.
// It is a reading aid for a person looking at the file. Fed through
// arPointToPlanar it mirrors the floor (the first version of usableStations
// did exactly that: 27 m of miss on a noise-free fixture). The fit uses
// `pose.world` and nothing else; the rigid fit absorbs origin and yaw anyway,
// and world is the raw measured value.

import type { ArEpochRecord, SpikeSample } from './types';
import { posesComparable } from './session';

export const M_PER_FT = 0.3048;

/** A point in the shared planar frame: metres, u = right, v = up. */
export interface Planar {
  u: number;
  v: number;
}

export interface NormPoint {
  x: number;
  y: number;
}

/** A rigid 2D transform, scale fixed at 1: p_plan = R(theta) · p_ar + t. */
export interface Rigid2D {
  rotationRad: number;
  tx: number;
  ty: number;
  /** How many station pairs were fitted. 2 = exact, 3+ = least squares. */
  n: number;
  /** Root-mean-square residual, metres. Zero by construction when n === 2. */
  rmseM: number;
}

// ── frame conversion ────────────────────────────────────────────────────────

/**
 * A tap on the plan (normalised 0..1 against the rendered IMAGE rect — the
 * contract in utils/punchPlanPin.ts) into planar metres.
 *
 * `ftPerPx` comes from utils/takeoffGeometry.feetPerPixel, which is defined
 * against the same normalised-times-pixel-dimension convention.
 */
export function planTapToPlanar(p: NormPoint, imgW: number, imgH: number, ftPerPx: number): Planar {
  return {
    u: p.x * imgW * ftPerPx * M_PER_FT,
    // NEGATED: image y grows downward, the planar frame's v grows up.
    v: -(p.y * imgH * ftPerPx * M_PER_FT),
  };
}

/** The inverse, so a predicted planar point can be drawn on the sheet. */
export function planarToPlanTap(p: Planar, imgW: number, imgH: number, ftPerPx: number): NormPoint {
  if (imgW <= 0 || imgH <= 0 || ftPerPx <= 0) return { x: 0, y: 0 };
  return {
    x: p.u / (M_PER_FT * ftPerPx * imgW),
    y: -p.v / (M_PER_FT * ftPerPx * imgH),
  };
}

/**
 * An ARKit WORLD position (`pose.world`, `raycast.point`) into planar metres.
 *
 * World ONLY. ARKit world is right-handed with y up; the origin-relative
 * `pose.local` is left-handed (z = forward) and must never come through here —
 * see the note at the top of this file.
 */
export function arPointToPlanar(p: { x: number; z: number }): Planar {
  // NEGATED: see the handedness note at the top of this file.
  return { u: p.x, v: -p.z };
}

// ── the fit ─────────────────────────────────────────────────────────────────

export interface FitPair {
  ar: Planar;
  plan: Planar;
}

/**
 * Least-squares rigid 2D fit with scale fixed at 1 (the 2D Kabsch/Procrustes
 * closed form).
 *
 * Two pairs is the ordinary case — one baseline, two taps — and the closed form
 * handles it without a special case: the rotation aligns the baseline exactly
 * and the fixed scale splits the length residual evenly between the two ends,
 * which is the honest answer when a 30 m baseline measures 30.4 m in AR.
 *
 * Returns null for fewer than two pairs, or for a degenerate baseline (both
 * points within a millimetre of each other), because a rotation cannot be
 * recovered from a point.
 */
export function fitRigid2D(pairs: FitPair[]): Rigid2D | null {
  if (pairs.length < 2) return null;

  const n = pairs.length;
  const ac: Planar = { u: 0, v: 0 };
  const bc: Planar = { u: 0, v: 0 };
  for (const p of pairs) {
    ac.u += p.ar.u; ac.v += p.ar.v;
    bc.u += p.plan.u; bc.v += p.plan.v;
  }
  ac.u /= n; ac.v /= n; bc.u /= n; bc.v /= n;

  let num = 0;
  let den = 0;
  let spread = 0;
  for (const p of pairs) {
    const au = p.ar.u - ac.u;
    const av = p.ar.v - ac.v;
    const bu = p.plan.u - bc.u;
    const bv = p.plan.v - bc.v;
    num += au * bv - av * bu;
    den += au * bu + av * bv;
    spread += Math.hypot(au, av);
  }
  // A baseline shorter than a millimetre carries no heading information at all.
  if (spread < 0.001) return null;

  const theta = Math.atan2(num, den);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const tx = bc.u - (c * ac.u - s * ac.v);
  const ty = bc.v - (s * ac.u + c * ac.v);

  let sq = 0;
  for (const p of pairs) {
    const q = applyRigid2D({ rotationRad: theta, tx, ty, n, rmseM: 0 }, p.ar);
    sq += (q.u - p.plan.u) ** 2 + (q.v - p.plan.v) ** 2;
  }

  return { rotationRad: theta, tx, ty, n, rmseM: Math.sqrt(sq / n) };
}

export function applyRigid2D(fit: Rigid2D, p: Planar): Planar {
  const c = Math.cos(fit.rotationRad);
  const s = Math.sin(fit.rotationRad);
  return { u: c * p.u - s * p.v + fit.tx, v: s * p.u + c * p.v + fit.ty };
}

// ── what the baseline BUYS you ──────────────────────────────────────────────

/**
 * The heading error a baseline of length `baselineM` implies, in radians, when
 * each end is placed with a position error of `sigmaM` (his tap plus his
 * stance).
 *
 *   headingError ≈ sqrt(2) · sigma / L
 *
 * The sqrt(2) is the two independent end errors combining. This is the term the
 * first version of the research report left out, and it is the DOMINANT one:
 * with sigma = 0.3 m, a 5 m baseline implies ~4.9° and a 30 m baseline ~0.8°.
 *
 * Returns null for a non-positive baseline — a heading cannot be recovered from
 * a point, and returning 0 there would read as "perfect".
 */
export function impliedHeadingErrorRad(sigmaM: number, baselineM: number): number | null {
  if (!(baselineM > 0) || !(sigmaM >= 0)) return null;
  return (Math.SQRT2 * sigmaM) / baselineM;
}

/**
 * The lateral miss that heading error produces `distanceM` away from the
 * anchor. This is why the alignment baseline must be the longest practical one:
 * at 40 m out, 4.9° is ~3.4 m — most of a room — and 0.8° is ~0.57 m.
 */
export function impliedLateralMissM(headingErrorRad: number, distanceM: number): number {
  return Math.abs(Math.tan(headingErrorRad) * distanceM);
}

/** Convenience: the implied miss at `distanceM`, straight from the baseline. */
export function baselineMissBudgetM(
  sigmaM: number,
  baselineM: number,
  distanceM: number,
): number | null {
  const h = impliedHeadingErrorRad(sigmaM, baselineM);
  if (h === null) return null;
  return impliedLateralMissM(h, distanceM);
}

// ── misses ──────────────────────────────────────────────────────────────────

export interface MissBreakdown {
  missM: number;
  /** Along the anchor baseline — mostly scale error. */
  alongM: number;
  /** Across it — mostly heading error. The one that sends a sub next door. */
  lateralM: number;
}

/**
 * Split a miss into along-baseline and across-baseline components. `axis` is any
 * vector along the alignment baseline; it is normalised here.
 *
 * Returns the plain distance with both components null-ish (0) when the axis is
 * degenerate, rather than pretending to a decomposition it cannot make.
 */
export function missBreakdown(predicted: Planar, actual: Planar, axis: Planar): MissBreakdown {
  const du = predicted.u - actual.u;
  const dv = predicted.v - actual.v;
  const missM = Math.hypot(du, dv);
  const len = Math.hypot(axis.u, axis.v);
  if (len < 1e-9) return { missM, alongM: 0, lateralM: 0 };
  const ax = axis.u / len;
  const ay = axis.v / len;
  return {
    missM,
    alongM: du * ax + dv * ay,
    // 2D cross product: signed distance across the axis.
    lateralM: du * ay - dv * ax,
  };
}

// ── alignment-free diagnostics ──────────────────────────────────────────────

export interface DistanceRatio {
  i: string;
  j: string;
  arM: number;
  planM: number;
  /** > 1 means ARKit's map is STRETCHED relative to the plan. */
  ratio: number;
}

/**
 * Inter-station distances in AR metres against the same distance off the plan.
 *
 * Distances are invariant to rotation and translation, so this separates "ARKit's
 * map is stretched" from "we aligned it wrong" with NO FITTING AT ALL. It is the
 * only diagnostic in this file that cannot be fooled by a bad alignment, which
 * is why it is reported even when a fit succeeds.
 */
export function distanceRatios(
  stations: { id: string; ar: Planar; plan: Planar }[],
): DistanceRatio[] {
  const out: DistanceRatio[] = [];
  for (let i = 0; i < stations.length; i++) {
    for (let j = i + 1; j < stations.length; j++) {
      const a = stations[i];
      const b = stations[j];
      const arM = Math.hypot(a.ar.u - b.ar.u, a.ar.v - b.ar.v);
      const planM = Math.hypot(a.plan.u - b.plan.u, a.plan.v - b.plan.v);
      // A pair a handspan apart divides by almost nothing and produces a wild
      // ratio that is arithmetic, not evidence. Below 0.5 m it is dropped.
      if (planM < 0.5) continue;
      out.push({ i: a.id, j: b.id, arM, planM, ratio: arM / planM });
    }
  }
  return out;
}

// ── rooms — the HEADLINE metric ─────────────────────────────────────────────

export interface RoomPolygon {
  id: string;
  name: string;
  /** Normalised 0..1 plan points, same contract as a pin. */
  points: NormPoint[];
}

/** Ray-casting point-in-polygon. Points on an edge count as inside. */
export function pointInPolygon(p: NormPoint, poly: NormPoint[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const straddles = a.y > p.y !== b.y > p.y;
    if (!straddles) continue;
    const xAt = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (p.x < xAt) inside = !inside;
  }
  return inside;
}

export function roomAt(p: NormPoint, rooms: RoomPolygon[]): RoomPolygon | null {
  for (const r of rooms) if (pointInPolygon(p, r.points)) return r;
  return null;
}

export interface RoomHitResult {
  /** Samples where BOTH the prediction and his tap landed in a known room. */
  n: number;
  hits: number;
  /** null when n === 0 — never 0, which would read as "always wrong". */
  rate: number | null;
  /** Predictions that fell in no known room at all. */
  unresolved: number;
}

/**
 * The headline. Centimetres are the wrong bar: the cost of a wrong pin is a sub
 * walking to the wrong room, which is a wasted trip plus a re-opened item,
 * usually discovered in front of the client. The tolerated failure is "no pin";
 * a confident wrong pin is the one that must not happen.
 */
export function roomHitRate(
  pairs: { predicted: NormPoint; actual: NormPoint }[],
  rooms: RoomPolygon[],
): RoomHitResult {
  let n = 0;
  let hits = 0;
  let unresolved = 0;
  for (const { predicted, actual } of pairs) {
    const pr = roomAt(predicted, rooms);
    const ar = roomAt(actual, rooms);
    if (!ar) continue;
    if (!pr) { unresolved++; n++; continue; }
    n++;
    if (pr.id === ar.id) hits++;
  }
  return { n, hits, rate: n === 0 ? null : hits / n, unresolved };
}

// ── the null model ──────────────────────────────────────────────────────────

/**
 * Phase 1 already ships "carry the last confirmed room pin" for free, over the
 * air, with no native code and no App Review. So the AR track's real competitor
 * is not perfection — it is THAT. This predicts every station at the previous
 * confirmed station's plan position.
 *
 * If ARKit does not clearly beat this, the AR track is dead whatever the metres
 * say. It costs nothing to compute and it is the most important number in the
 * trial.
 */
export function nullModelPredictions(
  ordered: { id: string; plan: Planar; confirmed: boolean }[],
): { id: string; predicted: Planar | null }[] {
  const out: { id: string; predicted: Planar | null }[] = [];
  let last: Planar | null = null;
  for (const s of ordered) {
    out.push({ id: s.id, predicted: last });
    if (s.confirmed) last = s.plan;
  }
  return out;
}

// ── reporting ───────────────────────────────────────────────────────────────

export interface MissSummary {
  n: number;
  medianM: number | null;
  maxM: number | null;
}

/**
 * n, median and MAXIMUM only.
 *
 * With 20–30 samples a 90th percentile is an interpolation between two
 * observations wearing a statistic's clothes. The maximum is a real
 * observation, and it is also the number that decides the feature: one
 * confidently wrong pin costs more than several near misses.
 */
export function summarizeMisses(values: number[]): MissSummary {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return { n: 0, medianM: null, maxM: null };
  const mid = Math.floor(clean.length / 2);
  const median = clean.length % 2 === 1 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
  return { n: clean.length, medianM: median, maxM: clean[clean.length - 1] };
}

/**
 * The tap-repeat floor: the spread, in metres, of several taps at the same
 * physical feature without moving. If this is as large as the AR miss, the walk
 * measured his thumb and not ARKit — and the report has to say so instead of
 * quoting a miss.
 */
export function tapSpreadM(taps: Planar[]): number | null {
  if (taps.length < 2) return null;
  const cu = taps.reduce((a, t) => a + t.u, 0) / taps.length;
  const cv = taps.reduce((a, t) => a + t.v, 0) / taps.length;
  return Math.max(...taps.map((t) => Math.hypot(t.u - cu, t.v - cv)));
}

// ── sample → planar, with the honesty gate ──────────────────────────────────

export interface UsableStation {
  id: string;
  ar: Planar;
  plan: Planar;
  epoch: number;
  elapsedS: number;
  pathLengthM: number;
}

export interface UsableStationsResult {
  stations: UsableStation[];
  /**
   * Stations that had a pose and a tap but were kept OUT of the fit, each with
   * the reason. Reported, never silently dropped — an exclusion nobody can see
   * is a selection effect.
   */
  excluded: { id: string; reason: string }[];
}

/**
 * The samples an analysis may use, and only those. A sample is dropped when it
 * has no pose, no tap, or a pose taken while tracking was not `tracked` —
 * `limited` samples STAY IN THE FILE and are reported separately, but they never
 * enter the headline.
 *
 * It is ALSO excluded when it is not in the same ARKit world as the first
 * anchor: a station on the far side of an un-relocalized epoch break (an
 * interruption ARKit never recovered from, or a drop to `.notAvailable`) sits
 * in a different coordinate system, and fitting it together with the anchors
 * measures nothing. `posesComparable` is the one rule for that, shared with the
 * on-screen distance refusal.
 *
 * The AR point is `pose.world`, never `pose.local` (left-handed — see the top
 * of this file).
 */
export function usableStations(
  samples: SpikeSample[],
  imgW: number,
  imgH: number,
  ftPerPx: number,
  epochs: ArEpochRecord[],
): UsableStationsResult {
  const stations: UsableStation[] = [];
  const excluded: { id: string; reason: string }[] = [];
  // The reference world is the first anchor's; failing that, the first usable
  // sample's. Every other station must be comparable with it.
  const candidates = samples.filter(
    (s) => s.pose && s.tap && s.pose.trust === 'tracked' && s.stationType !== 'skipped',
  );
  const ref = (candidates.find((s) => s.stationType === 'anchor') ?? candidates[0])?.pose ?? null;
  for (const s of samples) {
    if (!s.pose || !s.tap) continue;
    if (s.stationType === 'skipped') continue;
    if (s.pose.trust !== 'tracked') {
      excluded.push({ id: s.stationId, reason: `tracking was ${s.pose.trust}, not tracked` });
      continue;
    }
    if (ref) {
      const c = posesComparable(ref, s.pose, epochs);
      if (!c.comparable) {
        excluded.push({ id: s.stationId, reason: c.reason });
        continue;
      }
    }
    stations.push({
      id: s.stationId,
      ar: arPointToPlanar(s.pose.world),
      plan: planTapToPlanar({ x: s.tap.x, y: s.tap.y }, imgW, imgH, ftPerPx),
      epoch: s.pose.epoch,
      elapsedS: s.atMonotonicMs / 1000,
      pathLengthM: s.pathLengthM,
    });
  }
  return { stations, excluded };
}
