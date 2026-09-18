// scripts/validate-ar-spike.ts — the AR measurement spike's guard.
//
// WHY THIS EXISTS. The spike has two classes of failure and neither one shows
// up as an error.
//
//   1. THE MATHS. A plan-to-world fit with the handedness dropped still draws a
//      tidy predicted point — on the wrong side of the corridor. A fit that
//      lets SCALE float still produces a small residual; it has simply absorbed
//      ARKit's drift into the scale term and made a bad session look good.
//      Neither is visible in a number; both would decide whether a feature
//      ships. So every pure function is EXECUTED here against cases with known
//      answers, including the two the research report quotes by name (a 5 m
//      baseline implying ~4.9° and ~3.4 m of miss at 40 m; a 30 m baseline
//      implying ~0.8° and ~0.57 m).
//
//   2. THE OTA BOUNDARY. `runtimeVersion` policy is `appVersion` and
//      `expo.version` is 1.0.0, so an AR build that keeps 1.0.0 SHARES a
//      runtime with every existing production install — and every later
//      `eas update --branch production` lands on both. A bundle that imported
//      the native module at the top level would reach installs whose binary has
//      no native half. This repo has already been burned by exactly that shape
//      (react-native-reanimated, build #12, silent rollback — see
//      metro.config.js and scripts/validate-native-surface.ts). The feature
//      detection is what makes the shared runtime safe, so it is pinned here by
//      STATIC READ: no bundling, no export, fast enough for the ship chain.
//
// Run via: bun run scripts/validate-ar-spike.ts

import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import {
  M_PER_FT,
  applyRigid2D,
  arPointToPlanar,
  baselineMissBudgetM,
  distanceRatios,
  fitRigid2D,
  impliedHeadingErrorRad,
  impliedLateralMissM,
  missBreakdown,
  nullModelPredictions,
  planTapToPlanar,
  planarToPlanTap,
  pointInPolygon,
  roomAt,
  roomHitRate,
  summarizeMisses,
  tapSpreadM,
  usableStations,
  type Planar,
} from '../utils/arTrack/driftMath';
import {
  FULL_PROTOCOL,
  SHORT_PROTOCOL,
  SPIKE_SCHEMA_VERSION,
  TRUST_LIMITS,
  buildExportCsv,
  buildExportPayload,
  exportFileBase,
  poseDistanceM,
  posesComparable,
  protocolFor,
  sessionTrustVerdict,
} from '../utils/arTrack/session';
import { arAvailability, captureBlockedReason, depthBlockedReason } from '../utils/arTrack/availability';
import { PASS_FAIL_BAR } from '../utils/arTrack/bar';
import type { ArEpochRecord, ArPose, ArStatusEvent, SpikeSample, SpikeSessionHeader } from '../utils/arTrack/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  ✓', label); pass++; }
  else { console.error('  ✗', label, detail ? `\n      ${detail}` : ''); fail++; }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const DEG = 180 / Math.PI;

/** Comments lie about code; code does not. Every source pin reads stripped text. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'ios' || name === 'android') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAR spike — frames and handedness:');
// ═══════════════════════════════════════════════════════════════════════════
{
  // A plan whose calibration says 0.01 ft per pixel on a 1000x800 image.
  const imgW = 1000, imgH = 800, ftPerPx = 0.01;

  const topLeft = planTapToPlanar({ x: 0, y: 0 }, imgW, imgH, ftPerPx);
  ok('the top-left of a sheet is the planar origin', near(topLeft.u, 0) && near(topLeft.v, 0));

  const bottomRight = planTapToPlanar({ x: 1, y: 1 }, imgW, imgH, ftPerPx);
  ok('plan x grows right, in metres',
    near(bottomRight.u, 1000 * 0.01 * M_PER_FT, 1e-9),
    `got ${bottomRight.u}`);
  // THE HANDEDNESS PIN. Image y grows DOWN; the shared planar frame's v grows
  // UP. Drop this negation and a three-point fit needs a reflection no proper
  // rotation can supply, while a two-point fit silently mirrors the floor.
  ok('plan y is NEGATED into the planar frame (image y grows down, v grows up)',
    bottomRight.v < 0 && near(bottomRight.v, -(800 * 0.01 * M_PER_FT), 1e-9),
    `got ${bottomRight.v}`);

  const rt = planarToPlanTap(planTapToPlanar({ x: 0.37, y: 0.82 }, imgW, imgH, ftPerPx), imgW, imgH, ftPerPx);
  ok('a tap survives the round trip through planar metres', near(rt.x, 0.37, 1e-9) && near(rt.y, 0.82, 1e-9));

  const ar = arPointToPlanar({ x: 3, z: 5 });
  // ARKit is right-handed with y UP, so seen from above "away from you" is -z.
  ok('ARKit z is NEGATED into the planar frame', near(ar.u, 3) && near(ar.v, -5));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAR spike — the rigid fit (scale FIXED at 1):');
// ═══════════════════════════════════════════════════════════════════════════
{
  const theta = 0.5235987755982988; // 30°
  const tx = 5, ty = -3;
  const arPts: Planar[] = [
    { u: 0, v: 0 }, { u: 10, v: 0 }, { u: 10, v: 7 }, { u: -4, v: 2 },
  ];
  const planPts = arPts.map((p) => ({
    u: Math.cos(theta) * p.u - Math.sin(theta) * p.v + tx,
    v: Math.sin(theta) * p.u + Math.cos(theta) * p.v + ty,
  }));

  const fit = fitRigid2D(arPts.map((ar, i) => ({ ar, plan: planPts[i] })));
  ok('a known rotation + translation is recovered exactly',
    !!fit && near(fit.rotationRad, theta, 1e-9) && near(fit.tx, tx, 1e-9) && near(fit.ty, ty, 1e-9),
    fit ? `theta=${fit.rotationRad} tx=${fit.tx} ty=${fit.ty}` : 'null');
  ok('a perfect fit has zero residual', !!fit && near(fit.rmseM, 0, 1e-9));

  const two = fitRigid2D([
    { ar: arPts[0], plan: planPts[0] },
    { ar: arPts[1], plan: planPts[1] },
  ]);
  ok('two pairs are enough, and are exact', !!two && near(two.rotationRad, theta, 1e-9) && two.n === 2);

  ok('one pair cannot produce a heading and returns null',
    fitRigid2D([{ ar: arPts[0], plan: planPts[0] }]) === null);
  ok('a degenerate baseline (both ends on the same point) returns null',
    fitRigid2D([
      { ar: { u: 1, v: 1 }, plan: { u: 4, v: 4 } },
      { ar: { u: 1.0001, v: 1 }, plan: { u: 4.0001, v: 4 } },
    ]) === null);

  // SCALE MUST NOT BE FITTED AWAY. Feed a uniformly STRETCHED AR set: a
  // similarity fit would report a near-zero residual by absorbing the stretch
  // into a scale term, which is exactly the drift the trial is measuring.
  const stretched = arPts.map((p) => ({ u: p.u * 1.1, v: p.v * 1.1 }));
  const stretchFit = fitRigid2D(stretched.map((ar, i) => ({ ar, plan: planPts[i] })));
  ok('a 10% stretch shows up as RESIDUAL, not as a fitted scale',
    !!stretchFit && stretchFit.rmseM > 0.3,
    stretchFit ? `rmse=${stretchFit.rmseM}` : 'null');

  const applied = applyRigid2D(fit!, arPts[2]);
  ok('applyRigid2D is the inverse of the fit', near(applied.u, planPts[2].u, 1e-9) && near(applied.v, planPts[2].v, 1e-9));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAR spike — what the baseline buys (the dominant error term):');
// ═══════════════════════════════════════════════════════════════════════════
{
  const sigma = 0.3;
  const short = impliedHeadingErrorRad(sigma, 5);
  const long = impliedHeadingErrorRad(sigma, 30);
  ok('a 5 m baseline implies about 4.9° of heading error',
    short !== null && Math.abs(short * DEG - 4.86) < 0.05, `${short! * DEG}°`);
  ok('a 30 m baseline implies about 0.81°',
    long !== null && Math.abs(long * DEG - 0.81) < 0.02, `${long! * DEG}°`);
  ok('at 40 m out that 5 m baseline is about 3.4 m of miss — most of a room',
    Math.abs(impliedLateralMissM(short!, 40) - 3.40) < 0.05);
  ok('the 30 m baseline is about 0.57 m at the same distance',
    Math.abs(impliedLateralMissM(long!, 40) - 0.57) < 0.02);
  ok('the error scales as 1/baseline (6x the baseline, 1/6 the angle)',
    near(short! / long!, 6, 1e-9));
  ok('a zero-length baseline returns null, not a flattering zero',
    impliedHeadingErrorRad(sigma, 0) === null && baselineMissBudgetM(sigma, 0, 40) === null);
  ok('baselineMissBudgetM composes the two', near(baselineMissBudgetM(sigma, 5, 40)!, impliedLateralMissM(short!, 40), 1e-12));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAR spike — misses, ratios, rooms, the null model:');
// ═══════════════════════════════════════════════════════════════════════════
{
  const b = missBreakdown({ u: 3, v: 4 }, { u: 0, v: 0 }, { u: 1, v: 0 });
  ok('a miss splits into along and lateral against the baseline axis',
    near(b.missM, 5) && near(b.alongM, 3) && near(b.lateralM, -4),
    JSON.stringify(b));
  const d = missBreakdown({ u: 3, v: 4 }, { u: 0, v: 0 }, { u: 0, v: 0 });
  ok('a degenerate axis still reports the distance rather than pretending to split it',
    near(d.missM, 5) && d.alongM === 0 && d.lateralM === 0);

  const ratios = distanceRatios([
    { id: 'A', ar: { u: 0, v: 0 }, plan: { u: 0, v: 0 } },
    { id: 'B', ar: { u: 11, v: 0 }, plan: { u: 10, v: 0 } },
    { id: 'C', ar: { u: 0, v: 0.2 }, plan: { u: 0, v: 0.2 } },
  ]);
  ok('the AR/plan distance ratio needs no alignment at all', ratios.length === 2);
  const ab = ratios.find((r) => r.i === 'A' && r.j === 'B');
  ok('a stretched AR map reports a ratio above 1', !!ab && near(ab.ratio, 1.1, 1e-12));
  ok('pairs closer than half a metre are dropped (a wild ratio is arithmetic, not evidence)',
    !ratios.some((r) => r.j === 'C' && r.i === 'A'));

  const room = { id: 'r1', name: 'Storage 04098', points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }] };
  ok('a point inside a room polygon is inside it', pointInPolygon({ x: 0.25, y: 0.25 }, [...room.points]));
  ok('a point outside is outside', !pointInPolygon({ x: 0.75, y: 0.25 }, [...room.points]));
  ok('a polygon with fewer than three points contains nothing', !pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }]));
  ok('roomAt names the room', roomAt({ x: 0.1, y: 0.1 }, [room])?.name === 'Storage 04098');

  const other = { id: 'r2', name: 'Corridor', points: [{ x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 0.5 }] };
  const hit = roomHitRate([
    { predicted: { x: 0.1, y: 0.1 }, actual: { x: 0.2, y: 0.2 } },   // same room
    { predicted: { x: 0.7, y: 0.1 }, actual: { x: 0.2, y: 0.2 } },   // next door — the expensive one
    { predicted: { x: 0.1, y: 0.9 }, actual: { x: 0.2, y: 0.2 } },   // nowhere known
    { predicted: { x: 0.1, y: 0.1 }, actual: { x: 0.9, y: 0.9 } },   // his tap is in no room: not a sample
  ], [room, other]);
  ok('room-hit counts only samples whose GROUND TRUTH is in a known room', hit.n === 3);
  ok('room-hit rate is hits over those', hit.hits === 1 && near(hit.rate!, 1 / 3));
  ok('a prediction in no known room is unresolved, not a hit', hit.unresolved === 1);
  ok('room-hit reports null, not 0, when there is nothing to report',
    roomHitRate([], [room]).rate === null);

  // THE NULL MODEL. Phase 1's carried room pin ships over the air for free.
  const nm = nullModelPredictions([
    { id: 'A', plan: { u: 0, v: 0 }, confirmed: true },
    { id: 'B', plan: { u: 10, v: 0 }, confirmed: false },
    { id: 'C', plan: { u: 20, v: 0 }, confirmed: true },
    { id: 'D', plan: { u: 30, v: 0 }, confirmed: false },
  ]);
  ok('the null model predicts the FIRST station at nothing, not at itself', nm[0].predicted === null);
  ok('it carries the last CONFIRMED pin forward', near(nm[1].predicted!.u, 0) && near(nm[2].predicted!.u, 0));
  ok('an unconfirmed station does not become the new carry', near(nm[3].predicted!.u, 20));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAR spike — reporting (n, median, MAX — never a percentile):');
// ═══════════════════════════════════════════════════════════════════════════
{
  const odd = summarizeMisses([3, 1, 2]);
  ok('median of an odd sample', odd.n === 3 && near(odd.medianM!, 2) && near(odd.maxM!, 3));
  const even = summarizeMisses([4, 1, 2, 3]);
  ok('median of an even sample', near(even.medianM!, 2.5) && near(even.maxM!, 4));
  ok('NaN and Infinity are dropped rather than poisoning the median',
    summarizeMisses([1, NaN, 2, Infinity]).n === 2);
  ok('an empty sample reports nulls, not zeroes',
    summarizeMisses([]).medianM === null && summarizeMisses([]).maxM === null);

  ok('the tap-repeat floor is the worst spread from the centroid',
    near(tapSpreadM([{ u: 0, v: 0 }, { u: 2, v: 0 }]) ?? NaN, 1, 1e-12));
  ok('one tap is not a spread', tapSpreadM([{ u: 0, v: 0 }]) === null);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAR spike — only trustworthy samples reach the headline:');
// ═══════════════════════════════════════════════════════════════════════════
{
  const pose = (trust: ArPose['trust'], epoch = 0): ArPose => ({
    available: true, t: 10, frameT: 1, trust, reason: null, epoch,
    featurePoints: 200, worldMapping: 'mapped', ambientLumens: 500,
    world: { x: 1, y: 0, z: 2 }, yawDeg: 0,
    local: { x: 1, y: 0, z: 2 }, originEpoch: 0, sameEpochAsOrigin: true, ageMs: 5,
  });
  const base = (over: Partial<SpikeSample>): SpikeSample => ({
    id: 'id', stationId: 'C1', stationType: 'control', label: 'l',
    atIso: '2026-09-17T10:00:00.000Z', atMonotonicMs: 10_000,
    timeSinceOriginSec: 10, timeSinceLastConfirmSec: 10,
    pose: pose('tracked'), poseUnavailableReason: null,
    pathLengthM: 12, straightLineFromOriginM: 5,
    tap: { sheetId: 's', x: 0.5, y: 0.5, zoomScale: 4, msFromPromptToTap: 900, retapCount: 0 },
    raycast: null, thermalState: null, batteryLevel: null, noteChips: [], skipReason: null,
    ...over,
  });

  const startOnly: ArEpochRecord[] = [{ epoch: 0, startedAtS: 0, cause: 'start', relocalized: false }];
  const res = usableStations([
    base({ stationId: 'ok' }),
    base({ stationId: 'limited', pose: pose('limited') }),
    base({ stationId: 'lost', pose: pose('lost') }),
    base({ stationId: 'noPose', pose: null }),
    base({ stationId: 'noTap', tap: null }),
    base({ stationId: 'skipped', stationType: 'skipped' }),
  ], 1000, 800, 0.01, startOnly);
  const rows = res.stations;
  ok('a `limited` sample never enters the headline', !rows.some((r) => r.id === 'limited'));
  ok('a `lost` sample never enters the headline', !rows.some((r) => r.id === 'lost'));
  ok('a sample with no pose or no tap is not a station', !rows.some((r) => r.id === 'noPose' || r.id === 'noTap'));
  ok('a skipped station is not a station', !rows.some((r) => r.id === 'skipped'));
  ok('the tracked sample is', rows.length === 1 && rows[0].id === 'ok');
  ok('an excluded-for-trust station is REPORTED with its reason, not silently dropped',
    res.excluded.some((e) => e.id === 'limited' && /limited/.test(e.reason)));

  // EPOCHS. A station on the far side of an un-relocalized break is in a
  // different ARKit world; it must not enter the same fit as the anchors.
  const at = (epoch: number) => ({ ...pose('tracked'), epoch });
  const breaks = (relocalized: boolean, cause: ArEpochRecord['cause']): ArEpochRecord[] => [
    { epoch: 0, startedAtS: 0, cause: 'start', relocalized: false },
    { epoch: 1, startedAtS: 50, cause, relocalized },
  ];
  const walk3 = [
    base({ stationId: 'A1', stationType: 'anchor', pose: at(0) }),
    base({ stationId: 'A2', stationType: 'anchor', pose: at(0) }),
    base({ stationId: 'C1', pose: at(1) }),
  ];
  for (const cause of ['interrupted', 'trackingLost'] as const) {
    const broken = usableStations(walk3, 1000, 800, 0.01, breaks(false, cause));
    ok(`a station across an UNHEALED "${cause}" break is excluded from the fit`,
      !broken.stations.some((r) => r.id === 'C1') && broken.stations.length === 2,
      JSON.stringify(broken.stations.map((r) => r.id)));
    ok(`...and the exclusion says why (${cause})`,
      broken.excluded.some((e) => e.id === 'C1' && /never found the room/.test(e.reason)));
    ok(`a station across a RELOCALIZED "${cause}" break is kept`,
      usableStations(walk3, 1000, 800, 0.01, breaks(true, cause)).stations.length === 3);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAR spike — end to end: Swift local() frame vs the fit (handedness):');
// ═══════════════════════════════════════════════════════════════════════════
{
  // A TS MIRROR of ARTrackSession.swift's yaw() and local(). The Swift text is
  // pinned just below, so this mirror cannot drift from the real formula.
  const swiftYaw = (fwdX: number, fwdZ: number) => Math.atan2(fwdX, -fwdZ);
  const swiftLocal = (w: { x: number; y: number; z: number }, o: { x: number; y: number; z: number }, yaw0: number) => {
    const dx = w.x - o.x, dy = w.y - o.y, dz = w.z - o.z;
    const c = Math.cos(yaw0), s = Math.sin(yaw0);
    return { x: dx * c + dz * s, y: dy, z: dx * s - dz * c };
  };
  const sess = stripComments(readSrc('modules/mage-ar-track/ios/ARTrackSession.swift'));
  ok('the Swift local() formula is the one mirrored here (x)', /"x": dx \* c \+ dz \* s,/.test(sess));
  ok('the Swift local() formula is the one mirrored here (y)', /"y": dy,/.test(sess));
  ok('the Swift local() formula is the one mirrored here (z = FORWARD, left-handed)', /"z": dx \* s - dz \* c,/.test(sess));
  ok('the Swift yaw() is the one mirrored here', /return atan2\(forwardX, -forwardZ\)/.test(sess));
  ok('sanity: facing ARKit -z is yaw 0; turning right (+x) is positive', swiftYaw(0, -1) === 0 && swiftYaw(1, 0) > 0);

  // Noise-free floor: the plan is an exact rotation + translation of ARKit
  // world, the origin is set facing yaw0 = 0.3 rad. Every pose carries BOTH
  // world and the Swift-local point, exactly as the module reports them.
  const theta = 0.7, tx = 12, ty = -30;
  const imgW = 2000, imgH = 1500, ftPerPx = 0.05;
  const toPlanTap = (w: { x: number; z: number }) => {
    const p = arPointToPlanar(w);
    const q = { u: Math.cos(theta) * p.u - Math.sin(theta) * p.v + tx, v: Math.sin(theta) * p.u + Math.cos(theta) * p.v + ty };
    return planarToPlanTap(q, imgW, imgH, ftPerPx);
  };
  const origin = { x: 1.5, y: 0, z: -2 };
  const yaw0 = 0.3;
  const worlds = [
    { id: 'A1', type: 'anchor' as const, w: { x: 1.5, y: 0, z: -2 } },
    { id: 'A2', type: 'anchor' as const, w: { x: 20, y: 0.1, z: -18 } },
    { id: 'C1', type: 'control' as const, w: { x: -6, y: 0, z: -25 } },
    { id: 'C2', type: 'control' as const, w: { x: 9, y: -0.1, z: 4 } },
  ];
  const e0: ArEpochRecord[] = [{ epoch: 0, startedAtS: 0, cause: 'start', relocalized: false }];
  const samples: SpikeSample[] = worlds.map(({ id, type, w }) => {
    const tap = toPlanTap(w);
    return {
      id, stationId: id, stationType: type, label: id,
      atIso: '2026-09-17T10:00:00.000Z', atMonotonicMs: 1000,
      timeSinceOriginSec: 1, timeSinceLastConfirmSec: 1,
      pose: {
        available: true, t: 1, frameT: 1, trust: 'tracked', reason: null, epoch: 0,
        featurePoints: 1, worldMapping: 'mapped', ambientLumens: null,
        world: w, yawDeg: 0, local: swiftLocal(w, origin, yaw0),
        originEpoch: 0, sameEpochAsOrigin: true, ageMs: 1,
      },
      poseUnavailableReason: null, pathLengthM: 0, straightLineFromOriginM: 0,
      tap: { sheetId: 's', x: tap.x, y: tap.y, zoomScale: 8, msFromPromptToTap: 1, retapCount: 0 },
      raycast: null, thermalState: null, batteryLevel: null, noteChips: [], skipReason: null,
    };
  });
  const { stations } = usableStations(samples, imgW, imgH, ftPerPx, e0);
  const byId = (id: string) => stations.find((r) => r.id === id)!;
  const fit2 = fitRigid2D([byId('A1'), byId('A2')].map((r) => ({ ar: r.ar, plan: r.plan })));
  const predictMiss = (id: string) => {
    const q = applyRigid2D(fit2!, byId(id).ar);
    return Math.hypot(q.u - byId(id).plan.u, q.v - byId(id).plan.v);
  };
  ok('a 2-anchor fit predicts an off-baseline station exactly (noise-free, non-zero yaw0)',
    !!fit2 && predictMiss('C1') < 1e-9 && predictMiss('C2') < 1e-9,
    fit2 ? `C1 miss ${predictMiss('C1')} m, C2 miss ${predictMiss('C2')} m` : 'null fit');
  const fit4 = fitRigid2D(stations.map((r) => ({ ar: r.ar, plan: r.plan })));
  ok('a 4-point fit on the same floor has zero residual', !!fit4 && fit4.rmseM < 1e-9, `rmse ${fit4?.rmseM}`);

  // What the FIRST version did: feed the left-handed local frame to the fit.
  // Shown here so the failure it guards against is a number, not a sentence.
  const mirrored = fitRigid2D(stations.map((r) => {
    const l = samples.find((x) => x.stationId === r.id)!.pose!.local!;
    return { ar: arPointToPlanar(l), plan: r.plan };
  }));
  ok('(demonstration) the local frame WOULD mirror the floor — a 4-point fit on it is metres off',
    !!mirrored && mirrored.rmseM > 1, `rmse ${mirrored?.rmseM}`);
  ok('usableStations reads pose.world, never pose.local',
    !/pose\.local/.test(stripComments(readSrc('utils/arTrack/driftMath.ts'))));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAR spike — epochs: a distance across an unhealed break is refused:');
// ═══════════════════════════════════════════════════════════════════════════
{
  const p = (epoch: number, x: number): ArPose => ({
    available: true, t: 1, frameT: 1, trust: 'tracked', reason: null, epoch,
    featurePoints: 1, worldMapping: 'mapped', ambientLumens: null,
    world: { x, y: 0, z: 0 }, yawDeg: 0, local: null, originEpoch: 0,
    sameEpochAsOrigin: epoch === 0, ageMs: 1,
  });
  const healed: ArEpochRecord[] = [
    { epoch: 0, startedAtS: 0, cause: 'start', relocalized: false },
    { epoch: 1, startedAtS: 5, cause: 'interrupted', relocalized: true },
  ];
  const unhealed: ArEpochRecord[] = [
    { epoch: 0, startedAtS: 0, cause: 'start', relocalized: false },
    { epoch: 1, startedAtS: 5, cause: 'interrupted', relocalized: false },
  ];

  ok('same epoch is always comparable', posesComparable(p(0, 0), p(0, 3), unhealed).comparable);
  ok('a RELOCALIZED break is comparable — ARKit came back to the same world',
    posesComparable(p(0, 0), p(1, 3), healed).comparable);
  ok('an UNHEALED break is not', !posesComparable(p(0, 0), p(1, 3), unhealed).comparable);
  ok('the refusal says why, in words', posesComparable(p(0, 0), p(1, 3), unhealed).reason.length > 30);

  ok('a distance across an unhealed break is null, not a plausible number',
    poseDistanceM(p(0, 0), p(1, 3), unhealed).m === null);
  ok('a distance inside one epoch is the real distance',
    near(poseDistanceM(p(0, 0), p(0, 3), unhealed).m!, 3));
  ok('order does not matter', !posesComparable(p(1, 3), p(0, 0), unhealed).comparable);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAR spike — when to stop trusting the session:');
// ═══════════════════════════════════════════════════════════════════════════
{
  const good = {
    running: true, elapsedS: 60, pathLengthM: 40, degradedForS: 0,
    epochs: [{ epoch: 0, startedAtS: 0, cause: 'start' as const, relocalized: false }] as ArEpochRecord[],
    originEpoch: 0 as number | null, trackingNow: 'tracked' as const as ArStatusEvent['trackingState'] | null,
    thermalState: 'nominal', batteryLevel: 0.9,
  };
  ok('a healthy session is trusted', sessionTrustVerdict(good).trusted);
  ok('a session that is not running is not trusted',
    sessionTrustVerdict({ ...good, running: false }).code === 'notStarted');
  ok('an interruption that never relocalized kills it',
    sessionTrustVerdict({ ...good, epochs: [...good.epochs, { epoch: 1, startedAtS: 5, cause: 'interrupted', relocalized: false }] }).code
      === 'interruptedWithoutRelocalization');
  ok('a drop to notAvailable that never relocalized kills it too (same rule as posesComparable)',
    sessionTrustVerdict({ ...good, epochs: [...good.epochs, { epoch: 1, startedAtS: 5, cause: 'trackingLost', relocalized: false }] }).code
      === 'interruptedWithoutRelocalization');
  ok('a break BEFORE the origin was set separates nothing measured and is ignored',
    sessionTrustVerdict({ ...good, originEpoch: 1, epochs: [...good.epochs, { epoch: 1, startedAtS: 5, cause: 'trackingLost', relocalized: false }] }).trusted);
  ok('with no origin yet, a break is ignored',
    sessionTrustVerdict({ ...good, originEpoch: null, epochs: [...good.epochs, { epoch: 1, startedAtS: 5, cause: 'interrupted', relocalized: false }] }).trusted);
  // STILL TRYING. The break we are in, tracking not back, not long: ARKit may
  // yet relocalize, so the screen must not say "never found the room".
  const inProgress = sessionTrustVerdict({ ...good, trackingNow: 'limited', degradedForS: 3,
    epochs: [...good.epochs, { epoch: 1, startedAtS: 5, cause: 'interrupted', relocalized: false }] });
  ok('an interruption still relocalizing reads "finding the room", not "never found"',
    inProgress.code === 'relocalizing' && !inProgress.trusted && /Finding the room/.test(inProgress.reason) && !/never/.test(inProgress.reason),
    JSON.stringify(inProgress));
  ok('...but once tracking is back WITHOUT relocalizing, it is broken',
    sessionTrustVerdict({ ...good, trackingNow: 'tracked',
      epochs: [...good.epochs, { epoch: 1, startedAtS: 5, cause: 'trackingLost', relocalized: false }] }).code === 'interruptedWithoutRelocalization');
  ok('...and once it has been trying too long, it is broken',
    sessionTrustVerdict({ ...good, trackingNow: 'limited', degradedForS: TRUST_LIMITS.degradedForS + 1,
      epochs: [...good.epochs, { epoch: 1, startedAtS: 5, cause: 'interrupted', relocalized: false }] }).code === 'interruptedWithoutRelocalization');
  // The screen has no re-anchor flow, so no refusal may tell him to use one.
  const refusals = [
    sessionTrustVerdict({ ...good, epochs: [...good.epochs, { epoch: 1, startedAtS: 5, cause: 'interrupted', relocalized: false }] }),
    sessionTrustVerdict({ ...good, degradedForS: 99 }),
    sessionTrustVerdict({ ...good, pathLengthM: 9999 }),
  ];
  ok('no refusal tells him to "set the origin again" (the screen cannot, and it would not help)',
    refusals.every((r) => !/set the origin again/i.test(r.reason)), refusals.map((r) => r.reason).join(' | '));
  ok('a dead-end refusal names the true next step (finish and export)',
    refusals.every((r) => /finish and export/i.test(r.reason)));
  ok('a relocalized interruption does NOT kill it',
    sessionTrustVerdict({ ...good, epochs: [...good.epochs, { epoch: 1, startedAtS: 5, cause: 'interrupted', relocalized: true }] }).trusted);
  ok(`lost for more than ${TRUST_LIMITS.degradedForS}s kills it`,
    sessionTrustVerdict({ ...good, degradedForS: TRUST_LIMITS.degradedForS + 1 }).code === 'lostTooLong');
  ok('past 45 minutes it kills it',
    sessionTrustVerdict({ ...good, elapsedS: TRUST_LIMITS.elapsedS + 1 }).code === 'tooLongElapsed');
  ok('past 300 m walked it kills it',
    sessionTrustVerdict({ ...good, pathLengthM: TRUST_LIMITS.pathLengthM + 1 }).code === 'tooFarWalked');
  ok('a serious thermal state kills it',
    sessionTrustVerdict({ ...good, thermalState: 'serious' }).code === 'thermal');
  ok('battery under 20% kills it',
    sessionTrustVerdict({ ...good, batteryLevel: 0.19 }).code === 'battery');
  // This build cannot read battery or heat. A null must SKIP the rule, never
  // read as zero — "0% battery" would kill every session on the floor.
  ok('an unreadable battery skips the rule rather than reading as empty',
    sessionTrustVerdict({ ...good, batteryLevel: null, thermalState: null }).trusted);
  ok('every refusal carries a sentence the screen can show',
    ([1, 2] as const).every(() => true)
      && sessionTrustVerdict({ ...good, degradedForS: 99 }).reason.length > 20
      && sessionTrustVerdict({ ...good, pathLengthM: 9999 }).reason.length > 20);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAR spike — the export shape:');
// ═══════════════════════════════════════════════════════════════════════════
{
  const header = { sessionId: 'sess-1', schemaVersion: SPIKE_SCHEMA_VERSION, planSource: 'pdf' } as unknown as SpikeSessionHeader;
  const samples: SpikeSample[] = [{
    id: 's1', stationId: 'A1', stationType: 'anchor', label: 'Corridor end, "north"',
    atIso: '2026-09-17T10:00:00.000Z', atMonotonicMs: 0,
    timeSinceOriginSec: 0, timeSinceLastConfirmSec: 0,
    pose: null, poseUnavailableReason: 'skipped',
    pathLengthM: 0, straightLineFromOriginM: 0, tap: null, raycast: null,
    thermalState: null, batteryLevel: null, noteChips: ['dark', 'bare'], skipReason: null,
  }];
  const payload = buildExportPayload({
    header, samples, track: null, rawTrackUri: null, feetPerPixel: 0.01,
    trust: { trusted: true, code: 'ok', reason: '' },
    generatedAtIso: '2026-09-17T10:20:00.000Z',
  });
  ok('the raw samples are the top-level record', payload.samples.length === 1);
  ok('everything the app computed is fenced under _derived', '_derived' in payload && 'stopTrusting' in payload._derived);
  ok('_derived says out loud that it is not evidence', /recompute/i.test(payload._derived.note));
  ok('_derived warns that a photographed sheet is not quotable in metres', /photographed|perspective/i.test(payload._derived.note));
  ok('nothing derived leaks into a sample', !('_derived' in (payload.samples[0] as object)));
  ok('the export carries the pre-registered bar it will be judged against',
    payload._derived.passFailBar === PASS_FAIL_BAR && payload._derived.passFailBar.placedPin.roomHitMin === 0.9);
  ok('the file name carries the session id', exportFileBase('sess-1') === 'mage-ar-spike-sess-1');

  const csv = buildExportCsv(samples);
  const lines = csv.split('\n');
  ok('the CSV says the json is the source of truth on line one', /source of truth/i.test(lines[0]));
  ok('the CSV header and its rows have the same column count',
    lines[1].split(',').length === splitCsv(lines[2]).length,
    `${lines[1].split(',').length} vs ${splitCsv(lines[2]).length}`);
  ok('a comma inside a label is quoted, not left to split the row',
    lines[2].includes('"Corridor end, ""north"""'), lines[2]);
  ok('a null field is empty, never the string "null"', !/(^|,)null(,|$)/.test(lines[2]));
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAR spike — the protocol is fixed in advance:');
// ═══════════════════════════════════════════════════════════════════════════
{
  const ids = FULL_PROTOCOL.map((s) => s.id);
  ok('station ids are unique', new Set(ids).size === ids.length);
  ok('it opens on an anchor and closes on the return', FULL_PROTOCOL[0].type === 'anchor'
    && FULL_PROTOCOL[FULL_PROTOCOL.length - 1].type === 'return');
  ok('there are two anchors — a baseline needs two ends',
    FULL_PROTOCOL.filter((s) => s.type === 'anchor').length === 2);
  for (const t of ['tap-repeat', 'stand-still', 'defect'] as const) {
    ok(`the ${t} stations are compulsory, not optional`, FULL_PROTOCOL.some((s) => s.type === t));
  }
  ok('every station says WHY he is standing there', FULL_PROTOCOL.every((s) => s.why.length > 20));
  ok('the short protocol is a strict subset, so the two are comparable',
    SHORT_PROTOCOL.every((s) => ids.includes(s.id)) && SHORT_PROTOCOL.length < FULL_PROTOCOL.length);
  ok('the short protocol still has both anchors and the return',
    SHORT_PROTOCOL.filter((s) => s.type === 'anchor').length === 2
      && SHORT_PROTOCOL.some((s) => s.type === 'return'));
  ok('protocolFor picks the named one', protocolFor('short').length === SHORT_PROTOCOL.length
    && protocolFor('full').length === FULL_PROTOCOL.length);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAR spike — five "no" states, five sentences:');
// ═══════════════════════════════════════════════════════════════════════════
{
  const caps = (over: Record<string, unknown>) => ({
    available: false, reason: 'unsupportedDevice', hasLidar: false,
    supportsHighResCapture: false, deviceModel: 'iPhone17,2', osVersion: '18.0',
    ...over,
  }) as Parameters<typeof arAvailability>[0];

  const notInBuild = arAvailability(null);
  ok('a null module is `notInThisBuild`, NOT `unsupportedDevice`', notInBuild.reason === 'notInThisBuild');
  ok('and it says an OTA cannot fix it', /over-the-air|native code/i.test(notInBuild.message));

  const reasons = ['simulator', 'unsupportedDevice', 'cameraDenied', 'cameraUndetermined'] as const;
  const seen = new Set<string>([notInBuild.message]);
  for (const r of reasons) {
    const a = arAvailability(caps({ reason: r }));
    ok(`"${r}" has its own sentence`, a.reason === r && a.message.length > 30 && !seen.has(a.message));
    seen.add(a.message);
  }
  ok('all five sentences are different', seen.size === 5);
  ok('an undetermined camera OFFERS the prompt', arAvailability(caps({ reason: 'cameraUndetermined' })).action === 'requestCamera');
  ok('a denied camera points at Settings', arAvailability(caps({ reason: 'cameraDenied' })).action === 'openSettings');
  ok('"ok" plus available is the only way through',
    arAvailability(caps({ reason: 'ok', available: true })).available
      && !arAvailability(caps({ reason: 'ok', available: false })).available);
  // A native reason nobody has seen yet must REFUSE, not fall through.
  const unknown = arAvailability(caps({ reason: 'somethingNew' }));
  ok('an unrecognised device reason refuses with the raw reason visible',
    !unknown.available && unknown.message.includes('somethingNew'));

  const okCaps = caps({ reason: 'ok', available: true });
  ok('LiDAR being absent disables ONE option and says why, with the fallback named',
    depthBlockedReason(arAvailability(okCaps))!.includes('raycast'));
  ok('LiDAR present means no blocked reason',
    depthBlockedReason(arAvailability(caps({ reason: 'ok', available: true, hasLidar: true }))) === null);
  ok('high-res capture on iOS 15 says which iOS it needs',
    /iOS 16/.test(captureBlockedReason(arAvailability(okCaps))!));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAR spike — the OTA boundary (static source pins):');
// ═══════════════════════════════════════════════════════════════════════════
{
  const nativeTs = stripComments(readSrc('utils/arTrack/native.ts'));
  ok('JS reaches the module through requireOptionalNativeModule', /requireOptionalNativeModule</.test(nativeTs));
  ok('the null case is an ordinary branch, not a throw at module scope',
    /const Native = requireOptionalNativeModule/.test(nativeTs) && !/^\s*if \(!Native\) throw/m.test(nativeTs.split('export function')[0]));

  // requireNativeModule THROWS. One of those anywhere and an OTA to a build
  // without the module white-screens on import.
  const offenders: string[] = [];
  for (const f of [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'utils')), ...walk(join(ROOT, 'components')), ...walk(join(ROOT, 'contexts')), ...walk(join(ROOT, 'hooks'))]) {
    const src = stripComments(readFileSync(f, 'utf8'));
    if (/\brequireNativeModule\s*[<(]/.test(src)) offenders.push(relative(ROOT, f));
  }
  ok('requireNativeModule (the throwing one) appears nowhere in the app source',
    offenders.length === 0, offenders.join(', '));

  // The module name must stay quarantined: if any other file mentions it, the
  // quarantine has already been broken somewhere Metro can see.
  const mentions: string[] = [];
  for (const f of [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'utils')), ...walk(join(ROOT, 'components')), ...walk(join(ROOT, 'contexts')), ...walk(join(ROOT, 'hooks')), ...walk(join(ROOT, 'scripts'))]) {
    const rel = relative(ROOT, f);
    if (rel.startsWith('utils/arTrack') || rel === 'scripts/validate-ar-spike.ts') continue;
    if (/MageArTrack/.test(readFileSync(f, 'utf8'))) mentions.push(rel);
  }
  ok('only utils/arTrack mentions "MageArTrack"', mentions.length === 0, mentions.join(', '));

  // Metro must never resolve modules/ — that folder is native + config only.
  const modDir = join(ROOT, 'modules', 'mage-ar-track');
  ok('the module directory exists', existsSync(modDir));
  const modPkg = JSON.parse(readFileSync(join(modDir, 'package.json'), 'utf8')) as Record<string, unknown>;
  ok('the module package.json declares no JS entry point (no main/module/exports)',
    !('main' in modPkg) && !('module' in modPkg) && !('exports' in modPkg));
  ok('there is no JS or TS file under modules/mage-ar-track',
    walk(modDir).length === 0, walk(modDir).map((f) => relative(ROOT, f)).join(', '));

  const cfg = JSON.parse(readFileSync(join(modDir, 'expo-module.config.json'), 'utf8')) as { platforms?: string[]; apple?: { modules?: string[] } };
  ok('the module is apple-only, so Android autolinking never sees it',
    Array.isArray(cfg.platforms) && cfg.platforms.length === 1 && cfg.platforms[0] === 'apple');
  ok('it autolinks MageArTrackModule', cfg.apple?.modules?.includes('MageArTrackModule') === true);
  ok('the repo package.json needs no dependency on it (autolinking finds ./modules)',
    !('mage-ar-track' in ((JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }).dependencies ?? {})));

  // THE NATIVE HALF MUST BE COMMITTABLE. .gitignore's `ios/` (for prebuild
  // output) matches at ANY depth, so without a negation the Swift sources and
  // the podspec sit on this disk, pass every check above, and never reach a
  // commit — CI then ENOENTs, and EAS autolinking silently drops a module with
  // no podspec (expo-modules-autolinking apple.js returns null, no error).
  // Ask git itself with --no-index (pattern match only, tracked or not); fall
  // back to the CommandLineTools git when `git` is blocked (Xcode licence).
  const nativeFiles = readdirSync(join(modDir, 'ios')).map((n) => relative(ROOT, join(modDir, 'ios', n)));
  ok('the module has its native sources (Swift + podspec)',
    nativeFiles.some((f) => f.endsWith('.podspec')) && nativeFiles.some((f) => f.endsWith('.swift')));
  let ignored: string[] | null = null;
  for (const gitBin of ['git', '/Library/Developer/CommandLineTools/usr/bin/git']) {
    const r = spawnSync(gitBin, ['check-ignore', '--no-index', ...nativeFiles], { cwd: ROOT, encoding: 'utf8' });
    // check-ignore: 0 = some ignored, 1 = none ignored, anything else = git did not run.
    if (r.status === 0 || r.status === 1) { ignored = r.stdout.split('\n').filter(Boolean); break; }
  }
  if (ignored === null) {
    // No runnable git: read the file. The negation must exist for ios/.
    const gi = readFileSync(join(ROOT, '.gitignore'), 'utf8');
    ignored = /^!\/?modules\/\*\/ios\/?\s*$/m.test(gi) ? [] : ['(no !/modules/*/ios/ negation in .gitignore)'];
  }
  ok('no native source under modules/mage-ar-track/ios is gitignored', ignored.length === 0, ignored.join(', '));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAR spike — app.json (version, capabilities, permission text):');
// ═══════════════════════════════════════════════════════════════════════════
{
  const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as {
    expo: { version: string; runtimeVersion: { policy?: string }; ios: { infoPlist: Record<string, unknown> } };
  };

  // A DELIBERATE TRIPWIRE. If the AR build keeps 1.0.0 it shares a runtime with
  // every existing production install, which is safe ONLY because of the
  // feature detection pinned above. Bumping it gives the AR build its own
  // runtime and is cleaner — at the cost of publishing every future OTA to two
  // runtimes, forever. That is the founder's call. If he makes it, change the
  // constant here in the same commit so the decision is recorded rather than
  // discovered.
  ok('expo.version is still 1.0.0 (the AR build shares the production runtime)',
    app.expo.version === '1.0.0', `found ${app.expo.version}`);
  ok('runtimeVersion is still the appVersion policy', app.expo.runtimeVersion?.policy === 'appVersion');

  // Capability requirements can only be MAINTAINED OR RELAXED across updates.
  // Adding `arkit` would permanently narrow the installed base of a shipping
  // app for a spike, and could never be taken back.
  const caps = app.expo.ios.infoPlist.UIRequiredDeviceCapabilities;
  ok('no UIRequiredDeviceCapabilities entry was added', caps === undefined,
    JSON.stringify(caps));

  const camera = String(app.expo.ios.infoPlist.NSCameraUsageDescription ?? '');
  // App Review 5.1.1: the purpose string has to be true of every observed
  // trigger. The code uses the camera for motion tracking, so the string says
  // so — and this check stops the clause being quietly reverted while the code
  // keeps doing it.
  ok('the camera purpose string covers the AR tracking', /track how the phone moves/i.test(camera));
  ok('and says no video is kept or uploaded', /no video is recorded, kept or uploaded/i.test(camera));
  ok('and says the tracking stops when he leaves the screen', /stops when you leave/i.test(camera));
  ok('the original photo clause is still there', /jobsite photos for daily reports/i.test(camera));

  ok('no location permission was widened for this (the spike never calls expo-location)',
    !/arkit|ar tracking|measuring screen/i.test(String(app.expo.ios.infoPlist.NSLocationWhenInUseUsageDescription ?? '')));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAR spike — the dev screen:');
// ═══════════════════════════════════════════════════════════════════════════
{
  const screen = readSrc('app/dev-ar-measure.tsx');
  const code = stripComments(screen);

  ok('the screen is owner-gated and bounces everyone else',
    /isOwner\(user\?\.email\)/.test(code) && /<Redirect href="\/" \/>/.test(code));
  ok('it is not in the tab bar or the desktop sidebar',
    !/dev-ar-measure/.test(readSrc('app/(tabs)/_layout.tsx'))
      && !/dev-ar-measure/.test(readSrc('components/DesktopSidebar.tsx')));
  ok('it is declared in the root stack, so the route resolves',
    /name="dev-ar-measure"/.test(readSrc('app/_layout.tsx')));

  // THE CONTAMINATION RULE. A predicted pin on screen turns the ground truth
  // into a measurement of his agreeableness.
  ok('the screen never imports the alignment math — it cannot predict anything',
    !/arTrack\/driftMath/.test(code));
  for (const banned of ['fitRigid2D', 'applyRigid2D', 'nullModelPredictions', 'roomHitRate', 'missBreakdown']) {
    ok(`it never calls ${banned}`, !new RegExp(`\\b${banned}\\s*\\(`).test(code));
  }
  ok('no AR view, no camera preview, no anchors are rendered',
    !/ARSCNView|ARView|CameraView|expo-camera/.test(code));

  ok('the pose is captured BEFORE the plan opens, not after he finishes tapping',
    /const pose = await ArNative\.markPoint/.test(code)
      && code.indexOf('ArNative.markPoint') < code.indexOf('setPending('));
  ok('the plan tap zooms to 8x, not the pin step’s 4x',
    /const MAX_PLAN_ZOOM = 8/.test(code) && /maximumZoomScale=\{MAX_PLAN_ZOOM\}/.test(code));
  ok('the zoom at placement is recorded on the sample', /zoomScale,/.test(code));
  ok('a re-tap is counted, so his own indecision is in the file', /onRetap/.test(code));

  ok('a skipped station records a reason', /skipReason: reason/.test(code) && /promptSkip/.test(code));
  ok('the availability message is rendered verbatim', /\{avail\.message\}/.test(code));
  ok('a blocked mark button says why', /\{trust\.reason\}/.test(code));
  ok('the setup gate explains itself', /\{p\.blocked\}/.test(code) || /\{blocked\}/.test(code));

  ok('battery and heat are exported as null, never guessed',
    /thermalState: null/.test(code) && /batteryLevel: null/.test(code));
  ok('leaving the screen stops the AR session (a running one is a battery bug)',
    /useEffect\(\(\) => \(\) => \{ void ArNative\.stop\(\); \}, \[\]\);/.test(code));

  ok('it goes through utils/arTrack/native, never through expo-modules-core directly',
    /from '@\/utils\/arTrack\/native'/.test(code) && !/from 'expo-modules-core'/.test(code));
  ok('no reanimated / gesture-handler (this has to survive an OTA)',
    !/react-native-reanimated|react-native-gesture-handler/.test(code));

  // The spike stores NOTHING locally: the exported files are the record. Every
  // AsyncStorage key is a tenant-wipe surface (a key under a new prefix is
  // invisible to wipeLocalUserCache's prefix sweep and survives a tenant switch
  // on a shared device), and storing nothing is the cheapest way to be right
  // about that. If a future version needs a key, it must start with `mageid_`
  // and this check has to be replaced by a prefix check, not deleted.
  ok('the spike writes no AsyncStorage key at all',
    !/AsyncStorage/.test(code) && !/AsyncStorage/.test(stripComments(readSrc('utils/arTrack/session.ts'))));
  ok('nothing in utils/arTrack names a storage key',
    !/['"`]mageid_/.test(stripComments(readSrc('utils/arTrack/session.ts')))
      && !/['"`]mageid_/.test(stripComments(readSrc('utils/arTrack/types.ts'))));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAR spike — the Swift refuses rather than inventing:');
// ═══════════════════════════════════════════════════════════════════════════
{
  // Stripped, like every other source pin here: a check that a comment can
  // satisfy is a check that passes on a file whose CODE says the opposite.
  const sess = stripComments(readSrc('modules/mage-ar-track/ios/ARTrackSession.swift'));
  const mod = stripComments(readSrc('modules/mage-ar-track/ios/MageArTrackModule.swift'));
  const types = stripComments(readSrc('modules/mage-ar-track/ios/ARTrackTypes.swift'));

  ok('the simulator slice compiles ARKit out entirely',
    /#if !targetEnvironment\(simulator\)/.test(sess) && /"reason": "simulator"/.test(sess));
  ok('world alignment is .gravity, never .gravityAndHeading (the compass is the rejected sensor)',
    /worldAlignment = \.gravity\b/.test(sess) && !/gravityAndHeading/.test(sess));
  // The guard and the set have to be on the SAME line. An index comparison is
  // not enough: `supportsFrameSemantics(.sceneDepth)` also appears earlier, in
  // capabilities(), so an unguarded `if options.sceneDepth {` would still sort
  // after it and pass. Setting an unsupported frame semantic TRAPS.
  ok('sceneDepth is only ever set behind supportsFrameSemantics, on the same line',
    /if options\.sceneDepth, ARWorldTrackingConfiguration\.supportsFrameSemantics\(\.sceneDepth\) \{/.test(sess)
      && /frameSemantics\.insert\(\.sceneDepth\)/.test(sess));
  ok('relocalization is attempted, so the origin survives a pocket',
    /func sessionShouldAttemptRelocalization\(_ session: ARSession\) -> Bool \{ true \}/.test(sess));
  ok('a raycast miss returns hit:false and no point',
    /return \["hit": false, "target": NSNull\(\), "alignment": NSNull\(\)\]/.test(sess));
  ok('the session does not mutate the world origin (setWorldOrigin is never called)',
    !/session\.setWorldOrigin/.test(sess));
  ok('the module does not raise the camera prompt itself',
    !/requestAccess\(for:/.test(sess) && !/requestAccess\(for:/.test(mod));
  ok('every pose carries its epoch and its trust', /"epoch": p\.epoch/.test(sess) && /"trust": p\.trust/.test(sess));
  ok('the RAW ARKit-world translation rides along on every sample', /"world": \["x": Double\(world\.x\)/.test(sess));
  ok('a stale pose reports its age rather than hiding it', /"ageMs"/.test(sess));
  ok('path length ignores implausible jumps', /maxPlausibleStepM/.test(sess));

  for (const code of ['E_AR_UNAVAILABLE', 'E_AR_SIMULATOR', 'E_AR_CAMERA_DENIED', 'E_AR_CAMERA_UNDETERMINED',
                      'E_AR_NOT_RUNNING', 'E_AR_NO_ORIGIN', 'E_AR_NOT_TRACKING', 'E_AR_HIGHRES_UNSUPPORTED']) {
    ok(`${code} is a typed error, not a string to regex`, types.includes(`"${code}"`));
  }
  ok('high-res capture is @available-guarded', /@available\(iOS 16\.0, \*\)|#available\(iOS 16\.0, \*\)/.test(sess));
  ok('the JS module name is MageArTrack', /Name\("MageArTrack"\)/.test(mod));
  ok('session mutation runs on the main queue', /\.runOnQueue\(\.main\)/.test(mod));

  const podspec = readSrc('modules/mage-ar-track/ios/MageArTrack.podspec').replace(/^\s*#.*$/gm, '');
  ok('the podspec does not force-link ARKit (the simulator slice never imports it)',
    !/s\.frameworks/.test(podspec));
  ok('the podspec floor matches the Podfile default of 15.1', /:ios => '15\.1'/.test(podspec));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAR spike — the pass/fail bar is fixed BEFORE the walk:');
// ═══════════════════════════════════════════════════════════════════════════
{
  // Every number pinned. Changing one must be a deliberate edit HERE too, in
  // the same commit — a visible diff, dated, not a reinterpretation after the
  // data came in.
  const b = PASS_FAIL_BAR;
  ok('bar version 1, fixed 2026-09-17', b.version === 1 && b.fixedOn === '2026-09-17');
  ok('eligibility: >= 8 min AND >= 40 m since the last confirm, tracked, same world',
    b.eligibility.minSinceLastConfirmS === 480 && b.eligibility.minWalkedSinceLastConfirmM === 40
      && b.eligibility.trustRequired === 'tracked' && b.eligibility.sameWorldAsAnchorsRequired === true);
  ok('placed pin: room-hit >= 90%, median <= 0.5R, worst <= 1.2R, zero cross-floor',
    b.placedPin.roomHitMin === 0.9 && b.placedPin.medianMaxR === 0.5 && b.placedPin.worstMaxR === 1.2 && b.placedPin.crossFloorMax === 0);
  ok('placed pin: tracking normal >= 95%, holds >= 30 min / 150 m',
    b.placedPin.normalTrackingMin === 0.95 && b.placedPin.minSessionS === 1800 && b.placedPin.minSessionM === 150);
  ok('suggestion: room-hit >= 70%, median <= 1.0R, worst <= 3R',
    b.suggestion.roomHitMin === 0.7 && b.suggestion.medianMaxR === 1.0 && b.suggestion.worstMaxR === 3.0);
  ok('kill: < 70% room-hit, median > 1.0R, any cross-floor, loss > 1 per 10 min, battery > 40%/h, thermal < 30 min, re-anchor < 10 min',
    b.kill.roomHitBelow === 0.7 && b.kill.medianAboveR === 1.0 && b.kill.crossFloorErrorsAbove === 0
      && b.kill.trackingLossEveryMinBelow === 10 && b.kill.batteryPerHourAbove === 0.4
      && b.kill.thermalThrottleWithinMin === 30 && b.kill.reanchorEveryMinBelow === 10);
  ok('null model: >= 30% median reduction AND a higher room-hit rate, both required',
    b.nullModel.medianReductionMin === 0.3 && b.nullModel.roomHitMustExceed === true);
  ok('loop closure is never the bar', b.loopClosureIsTheBar === false);
  ok('the placed-pin bar is stricter than the suggestion bar on every axis',
    b.placedPin.roomHitMin > b.suggestion.roomHitMin && b.placedPin.medianMaxR < b.suggestion.medianMaxR
      && b.placedPin.worstMaxR < b.suggestion.worstMaxR);
  const readme = readSrc('modules/mage-ar-track/README.md');
  ok('the README restates the bar (placed pin, suggestion, kill, null model)',
    /≥ 90%/.test(readme) && /≤ 0\.5R/.test(readme) && /≤ 1\.2R/.test(readme) && /≥ 70%/.test(readme)
      && /≤ 3R/.test(readme) && /≥ 30%/.test(readme) && /8 minutes AND 40 m/.test(readme));
  ok('the dev screen never imports the bar (a live verdict mid-walk would contaminate the next tap)',
    !/arTrack\/bar/.test(stripComments(readSrc('app/dev-ar-measure.tsx'))));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAR spike — Swift correctness pins (the fixes a review found):');
// ═══════════════════════════════════════════════════════════════════════════
{
  const sess = stripComments(readSrc('modules/mage-ar-track/ios/ARTrackSession.swift'));
  // A func whose signature names a private type must itself be private, or
  // Swift refuses to compile — and modules/ autolinks into EVERY iOS build.
  const leaky = sess.split('\n').filter((l) =>
    /\bfunc\b/.test(l) && /\b(OriginSnapshot|PoseSnapshot|EpochRecord)\b/.test(l) && !/\b(private|fileprivate)\b/.test(l));
  ok('no non-private func names a private type (OriginSnapshot / PoseSnapshot / EpochRecord)',
    leaky.length === 0, leaky.join(' | '));

  const intr = sess.slice(sess.indexOf('func sessionWasInterrupted'), sess.indexOf('func sessionInterruptionEnded'));
  ok('an interruption closes out the current label BEFORE switching (accrueStateTime)',
    /accrueStateTime\(now: now\)/.test(intr) && intr.indexOf('accrueStateTime') < intr.indexOf('lastTrackingLabel = "lost"'));
  ok('an interruption charges its time to LOST, not to whatever was tracking before',
    /lastTrackingLabel = "lost"/.test(intr));
  ok('an interruption clears the cached pose, so a mark cannot record a memory as "tracked"',
    /latest = nil/.test(intr));
  ok('the track summary accrues up to now, so normal + limited + lost = elapsed',
    /accrueStateTime\(now: now\)/.test(sess.slice(sess.indexOf('func trackSummary'), sess.indexOf('func exportTrack'))));
  ok('the tracking label starts as "lost", so the first .notAvailable frame is not a spurious break',
    /private var lastTrackingLabel = "lost"/.test(sess) && !/lastTrackingLabel = "notAvailable"/.test(sess));
  ok('thinning the raw track keeps every "mark" row (only "path" rows are halved)',
    /\(row\["kind"\] as\? String\) == "path" else \{ return true \}/.test(sess)
      && !/enumerated\(\)\.compactMap \{ \$0\.offset % 2 == 0/.test(sess));

  const nativeTs = stripComments(readSrc('utils/arTrack/native.ts'));
  ok("native.ts imports from 'expo' (a declared dependency), not 'expo-modules-core' (hoisted only)",
    /from 'expo';/.test(nativeTs) && !/from 'expo-modules-core'/.test(nativeTs));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nAR spike — the Swift typechecks (device AND simulator slice):');
// ═══════════════════════════════════════════════════════════════════════════
{
  // Nothing else in this repo compiles Swift before EAS does, and a compile
  // error in modules/ breaks EVERY iOS build. Plain `swiftc`/`xcrun` fail on
  // this machine (Xcode licence), so the Command Line Tools binary is used
  // directly; a Mac without it, or CI on Linux, SKIPS loudly. Set
  // AR_SPIKE_REQUIRE_SWIFT=1 to turn a skip into a failure.
  const swiftc = ['/Library/Developer/CommandLineTools/usr/bin/swiftc'].find((p) => existsSync(p));
  const sdkRoot = '/Library/Developer/CommandLineTools/SDKs';
  const sdk = existsSync(join(sdkRoot, 'MacOSX.sdk')) ? join(sdkRoot, 'MacOSX.sdk') : null;
  if (!swiftc || !sdk) {
    const msg = 'Swift typecheck SKIPPED — no Command Line Tools swiftc / macOS SDK on this machine';
    if (process.env.AR_SPIKE_REQUIRE_SWIFT === '1') ok(msg, false);
    else console.log(`  - ${msg}`);
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'ar-spike-swift-'));
    try {
      const strip = (src: string) => src.replace(/^import (ExpoModulesCore|ARKit|UIKit)$/gm, '');
      const types = strip(readSrc('modules/mage-ar-track/ios/ARTrackTypes.swift'));
      const sessSrc = strip(readSrc('modules/mage-ar-track/ios/ARTrackSession.swift'));
      writeFileSync(join(dir, 'ARTrackTypes.swift'), types);
      writeFileSync(join(dir, 'Device.swift'), sessSrc);
      const sim = sessSrc.replace(/^#if !targetEnvironment\(simulator\)$/m, '#if false');
      writeFileSync(join(dir, 'Simulator.swift'), sim);
      const stubs = join(ROOT, 'modules/mage-ar-track/typecheck/Stubs.swift');
      const run = (file: string) => spawnSync(swiftc, [
        '-typecheck', '-sdk', sdk, '-target', 'arm64-apple-macos14',
        stubs, join(dir, 'ARTrackTypes.swift'), join(dir, file),
      ], { encoding: 'utf8', timeout: 120_000 });
      const dev = run('Device.swift');
      ok('the DEVICE slice typechecks', dev.status === 0, (dev.stderr || dev.error?.message || '').split('\n').filter((l) => /error/.test(l)).slice(0, 5).join('\n      '));
      ok('the simulator guard was found and flipped for the second pass', sim !== sessSrc);
      const simRun = run('Simulator.swift');
      ok('the SIMULATOR slice typechecks', simRun.status === 0, (simRun.stderr || simRun.error?.message || '').split('\n').filter((l) => /error/.test(l)).slice(0, 5).join('\n      '));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

console.log('');
if (fail > 0) {
  console.error(`✗ validate-ar-spike: ${fail} failure(s), ${pass} passed.\n`);
  process.exit(1);
}
console.log(`✓ validate-ar-spike: ${pass} checks — the maths is right, the screen cannot predict, and an OTA to a build without the module still runs.\n`);
