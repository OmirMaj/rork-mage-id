// utils/arTrack/session.ts — when to stop trusting the session, and what comes
// off the phone at the end.
//
// PURE. No react-native, no expo, no native module. The screen calls these; the
// validator executes them.
//
// THE PRINCIPLE, WHICH IS THE SAME ONE THE PHASE 1 ROOM PIN USES: an UNPINNED
// item is honest, a confidently stale one is not. Drift is not an error that
// announces itself — the pose keeps arriving, at 60 Hz, looking exactly as
// valid at minute forty as at minute one. So the decision to stop trusting has
// to be made by a rule that runs on every frame, not by whoever is holding the
// phone.

import type {
  ArEpochRecord,
  ArPose,
  ArStatusEvent,
  ArTrackSummary,
  SessionTrustVerdict,
  SpikeExportPayload,
  SpikeSample,
  SpikeSessionHeader,
} from './types';
import { PASS_FAIL_BAR } from './bar';

/**
 * NO ASYNCSTORAGE. The spike writes its JSON, its CSV and the raw NDJSON path
 * into the app's document directory and hands them straight to the share sheet;
 * those files ARE the record.
 *
 * The first design had an index under `mageid_ar_spike_sessions`. It was
 * dropped rather than shipped unused, for two reasons. A key nothing reads is a
 * dead constant that the next person has to prove is dead. And every
 * AsyncStorage key is a tenant-wipe surface: `wipeLocalUserCache` sweeps by
 * prefix over `getAllKeys()`, so a key under a NEW prefix would be invisible to
 * the sweep and survive a tenant switch on a shared device — which is what
 * `bun run test:storage-hygiene` exists to catch. Storing nothing is the
 * cheapest way to be right about that.
 */
export const SPIKE_SCHEMA_VERSION = 1;

// ── the stop rule ───────────────────────────────────────────────────────────

export interface TrustInputs {
  running: boolean;
  elapsedS: number;
  /** Walked since `start` — the native counter does not reset at setOrigin. */
  pathLengthM: number;
  /** How long tracking has been `limited` or `lost` continuously, in seconds. */
  degradedForS: number;
  epochs: ArEpochRecord[];
  /**
   * The epoch the origin was set in, or null before it is set. Only breaks
   * AFTER it matter: a break before the origin separates nothing that was
   * measured.
   */
  originEpoch: number | null;
  /** The latest tracking state from the status event, or null before one arrives. */
  trackingNow: ArStatusEvent['trackingState'] | null;
  /** iOS `ProcessInfo.thermalState`, lower-cased. */
  thermalState: string | null;
  /** 0..1, or null when the device will not say. */
  batteryLevel: number | null;
}

export const TRUST_LIMITS = {
  degradedForS: 10,
  elapsedS: 45 * 60,
  pathLengthM: 300,
  batteryLevel: 0.2,
} as const;

/**
 * Whether the session's numbers still mean anything.
 *
 * Every threshold below is a DESIGN CHOICE, argued, not a published figure —
 * the published ARKit numbers are end-of-closed-loop errors over 84–145 m and
 * say nothing about a two-hour walk on a bare floor. They are here so the
 * session stops offering positions at a stated point instead of degrading
 * quietly past one nobody wrote down.
 *
 * Order matters: the most specific, most damaging condition is reported first,
 * because the screen shows ONE sentence and it should be the one that explains
 * what to do next.
 */
export function sessionTrustVerdict(i: TrustInputs): SessionTrustVerdict {
  if (!i.running) {
    return { trusted: false, code: 'notStarted', reason: 'Tracking is not running.' };
  }

  // A break ARKit never relocalized out of means the world coordinates
  // restarted. Positions on the two sides are not the same measurement at all,
  // and averaging across the break measures nothing. BOTH causes count — an
  // interruption and a drop to `.notAvailable` — which is the same rule
  // `posesComparable` applies to a single distance. Breaks before the origin
  // separate nothing that was measured, so they are ignored.
  const unhealed = i.originEpoch === null
    ? []
    : i.epochs.filter((e) => e.cause !== 'start' && e.epoch > (i.originEpoch as number) && !e.relocalized);
  if (unhealed.length > 0) {
    const latestEpoch = i.epochs.reduce((m, e) => Math.max(m, e.epoch), 0);
    const onlyTheCurrentOne = unhealed.length === 1 && unhealed[0].epoch === latestEpoch;
    // STILL TRYING: the only unhealed break is the one we are in, tracking has
    // not come back, and it has not been long. ARKit may yet relocalize — so
    // this says "finding the room", not "never found it". Marking stays off
    // either way: a position taken now is not in the origin's world yet.
    if (onlyTheCurrentOne && i.trackingNow !== 'tracked' && i.degradedForS <= TRUST_LIMITS.degradedForS) {
      return {
        trusted: false,
        code: 'relocalizing',
        reason: 'Finding the room again after the break in tracking. Hold the phone up and point it at somewhere you have already walked; marking comes back if it recognises the room.',
      };
    }
    return {
      trusted: false,
      code: 'interruptedWithoutRelocalization',
      // The TRUE next step. Re-setting the origin mid-walk would not rescue the
      // stations already marked in the old world, and this screen has no
      // re-anchor flow — so it does not pretend to.
      reason: 'Tracking restarted and never found the room again, so positions from here are not in the same frame as your origin. Finish and export what you have, then start a new session at A1.',
    };
  }

  if (i.degradedForS > TRUST_LIMITS.degradedForS) {
    return {
      trusted: false,
      code: 'lostTooLong',
      reason: `Tracking has been poor for more than ${TRUST_LIMITS.degradedForS} seconds. Point the phone at something with detail — a corner, a door. If it does not come back, finish and export, then start a new session.`,
    };
  }

  if (i.elapsedS > TRUST_LIMITS.elapsedS) {
    return {
      trusted: false,
      code: 'tooLongElapsed',
      reason: 'This session has been tracking for over 45 minutes. Drift grows with time as well as distance — start a fresh session.',
    };
  }

  if (i.pathLengthM > TRUST_LIMITS.pathLengthM) {
    return {
      trusted: false,
      code: 'tooFarWalked',
      reason: 'Over 300 m walked this session. Drift is roughly a few per cent of distance walked, so positions this far out are not worth recording. Finish and export, then start a new session.',
    };
  }

  if (i.thermalState === 'serious' || i.thermalState === 'critical') {
    return {
      trusted: false,
      code: 'thermal',
      reason: 'The phone is too hot — iOS throttles the camera and the tracking degrades. Let it cool before measuring more.',
    };
  }

  if (i.batteryLevel !== null && i.batteryLevel < TRUST_LIMITS.batteryLevel) {
    return {
      trusted: false,
      code: 'battery',
      reason: 'Battery is under 20%. AR tracking drains it fast enough to end the walk mid-floor.',
    };
  }

  return { trusted: true, code: 'ok', reason: '' };
}

// ── epoch comparability ─────────────────────────────────────────────────────

export interface ComparabilityResult {
  comparable: boolean;
  /** Empty when comparable. Shown verbatim — never a computed number instead. */
  reason: string;
}

/**
 * Whether a distance between two readings may be computed at all.
 *
 * Two readings from different epochs are NOT comparable unless every epoch
 * boundary between them was relocalized — ARKit coming back into the same world
 * coordinates is the only thing that makes the two sides one measurement. A
 * distance that spans an un-relocalized break is refused, with the reason
 * surfaced, rather than computed and quietly shown.
 */
export function posesComparable(a: ArPose, b: ArPose, epochs: ArEpochRecord[]): ComparabilityResult {
  if (a.epoch === b.epoch) return { comparable: true, reason: '' };
  const lo = Math.min(a.epoch, b.epoch);
  const hi = Math.max(a.epoch, b.epoch);
  // Epoch N's record describes the break that STARTED epoch N, so the boundaries
  // crossed between lo and hi are the records for lo+1 … hi.
  const crossed = epochs.filter((e) => e.epoch > lo && e.epoch <= hi);
  const unhealed = crossed.filter((e) => !e.relocalized);
  if (unhealed.length === 0) return { comparable: true, reason: '' };
  return {
    comparable: false,
    reason: `Tracking restarted between these two readings and never found the room again (${unhealed.length} break${unhealed.length === 1 ? '' : 's'}), so the distance between them is not a measurement.`,
  };
}

/**
 * Straight-line distance between two poses in ARKit metres, or null with a
 * reason. Returning null rather than a number is the whole point: a distance
 * across an un-relocalized break looks exactly like a real one.
 */
export function poseDistanceM(
  a: ArPose,
  b: ArPose,
  epochs: ArEpochRecord[],
): { m: number | null; reason: string } {
  const c = posesComparable(a, b, epochs);
  if (!c.comparable) return { m: null, reason: c.reason };
  const dx = a.world.x - b.world.x;
  const dy = a.world.y - b.world.y;
  const dz = a.world.z - b.world.z;
  return { m: Math.sqrt(dx * dx + dy * dy + dz * dz), reason: '' };
}

// ── export ──────────────────────────────────────────────────────────────────

export interface BuildExportArgs {
  header: SpikeSessionHeader;
  samples: SpikeSample[];
  track: ArTrackSummary | null;
  rawTrackUri: string | null;
  feetPerPixel: number | null;
  trust: SessionTrustVerdict;
  generatedAtIso: string;
}

/**
 * The JSON that leaves the phone. `_derived` fences off everything the app
 * computed so a reader six weeks from now cannot mistake an app-side result for
 * a measurement; the analysis recomputes all of it from `samples`.
 */
export function buildExportPayload(a: BuildExportArgs): SpikeExportPayload {
  return {
    header: a.header,
    samples: a.samples,
    track: a.track,
    rawTrackUri: a.rawTrackUri,
    _derived: {
      generatedAtIso: a.generatedAtIso,
      note: 'Everything in _derived was computed by the app and is a convenience only. Recompute it from `samples` before quoting any number. Metres are only meaningful when header.planSource is "pdf" — a photographed sheet is perspective-skewed and its residual cannot be attributed to ARKit.',
      feetPerPixel: a.feetPerPixel,
      stopTrusting: a.trust,
      // The bar travels WITH the data, so the file carries what it was judged
      // against and a later edit to bar.ts cannot silently re-judge it.
      passFailBar: PASS_FAIL_BAR,
    },
  };
}

const CSV_COLUMNS = [
  'sampleId', 'stationId', 'stationType', 'label', 'atIso', 'atMonotonicMs',
  'timeSinceOriginSec', 'timeSinceLastConfirmSec', 'trust', 'trustReason', 'epoch',
  'sameEpochAsOrigin', 'arWorldX', 'arWorldY', 'arWorldZ', 'arLocalX', 'arLocalY', 'arLocalZ',
  'yawDeg', 'featurePoints', 'worldMapping', 'ambientLumens', 'pathLengthM',
  'straightLineFromOriginM', 'tapSheetId', 'tapX', 'tapY', 'tapZoom', 'tapMs', 'tapRetaps',
  'raycastHit', 'raycastTarget', 'raycastDistanceM', 'thermalState', 'batteryLevel',
  'noteChips', 'skipReason',
] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The flat convenience file. It is a CONVENIENCE — the JSON is the source of
 * truth, and the header row says so, because a CSV opened in Numbers is what
 * people actually quote from.
 */
export function buildExportCsv(samples: SpikeSample[]): string {
  const lines: string[] = [];
  lines.push('# MAGE ID AR spike — convenience export. The .json beside this file is the source of truth.');
  lines.push(CSV_COLUMNS.join(','));
  for (const s of samples) {
    const p = s.pose;
    const rc = s.raycast;
    lines.push([
      s.id, s.stationId, s.stationType, s.label, s.atIso, s.atMonotonicMs,
      s.timeSinceOriginSec, s.timeSinceLastConfirmSec,
      p ? p.trust : (s.poseUnavailableReason ?? 'none'), p ? p.reason : null, p ? p.epoch : null,
      p ? p.sameEpochAsOrigin : null,
      p?.world.x, p?.world.y, p?.world.z,
      p?.local?.x, p?.local?.y, p?.local?.z,
      p?.yawDeg, p?.featurePoints, p?.worldMapping, p?.ambientLumens,
      s.pathLengthM, s.straightLineFromOriginM,
      s.tap?.sheetId, s.tap?.x, s.tap?.y, s.tap?.zoomScale, s.tap?.msFromPromptToTap, s.tap?.retapCount,
      rc ? rc.hit : null, rc && rc.hit ? rc.target : null, rc && rc.hit ? rc.distanceM : null,
      s.thermalState, s.batteryLevel,
      s.noteChips.join(' '), s.skipReason,
    ].map(csvCell).join(','));
  }
  return lines.join('\n');
}

export function exportFileBase(sessionId: string): string {
  return `mage-ar-spike-${sessionId}`;
}

// ── the protocol, as data ───────────────────────────────────────────────────

export interface StationPlan {
  id: string;
  label: string;
  type: SpikeSample['stationType'];
  /** What this station isolates. Shown on screen so he knows why he is there. */
  why: string;
}

/**
 * The station list is FIXED IN ADVANCE and queued on the phone so he never
 * chooses where to stand. If he picks his own spots he will mark where tracking
 * looks good, and the numbers will flatter the feature.
 *
 * A station he cannot reach is SKIPPED WITH A REASON — recorded, never silently
 * dropped, because a selection effect is indistinguishable from a good result.
 */
export const FULL_PROTOCOL: StationPlan[] = [
  { id: 'A1', label: 'Corridor end — set origin here', type: 'anchor', why: 'One end of the long alignment baseline. Stand with the phone touching a door jamb corner.' },
  { id: 'A2', label: 'Far corridor end (25 m or more)', type: 'anchor', why: 'The other end. A long baseline is the single biggest lever on heading error.' },
  { id: 'A2-tap1', label: 'Same feature, fit-to-screen zoom', type: 'tap-repeat', why: 'Measures YOUR ruler, not ARKit. Do not move.' },
  { id: 'A2-tap2', label: 'Same feature, 2x zoom', type: 'tap-repeat', why: 'Same feature again. Still do not move.' },
  { id: 'A2-tap3', label: 'Same feature, 8x zoom', type: 'tap-repeat', why: 'Last one. The spread of these three is the floor under every other number.' },
  { id: 'C1', label: 'Station 1 — a feature you can touch', type: 'control', why: 'Ordinary control station. A corner, a column face, a wall intersection.' },
  { id: 'C2', label: 'Station 2 — a feature you can touch', type: 'control', why: 'Ordinary control station.' },
  { id: 'D1', label: 'Aim at a real defect across the room', type: 'defect', why: 'The camera is not the defect. This is the only station that measures the gap.' },
  { id: 'C3', label: 'Station 3 — dark or bare area', type: 'control', why: 'Bare drywall and darkness are the known failure causes. Compulsory, not optional.' },
  { id: 'C4', label: 'Station 4 — 30 m or more from both anchors', type: 'control', why: 'Heading error shows up as distance from the anchor. This is where it shows.' },
  { id: 'D2', label: 'Aim at a second real defect', type: 'defect', why: 'Two defect samples so the first is not the whole channel.' },
  { id: 'SS1', label: 'Stand still — mark now', type: 'stand-still', why: 'Do not move for 60 seconds. This separates per-second drift from per-metre.' },
  { id: 'SS2', label: 'Stand still — mark again after 60 s', type: 'stand-still', why: 'Same spot. Any difference is time, not distance.' },
  { id: 'S1', label: 'Short baseline — point 1', type: 'control', why: 'A 5 m baseline, to compare against the long one offline.' },
  { id: 'S2', label: 'Short baseline — point 2 (about 5 m)', type: 'control', why: 'Same room. Both baselines get solved from the same walk.' },
  { id: 'P1', label: 'Pocket test — phone away, walk 20 m, mark', type: 'control', why: 'Whether it relocalizes after a pocket, and how far it jumps. Nothing else measures this.' },
  { id: 'C5', label: 'Station 5 — at least 8 minutes in', type: 'control', why: 'Late samples are the hard part. Early corridor samples are not the question.' },
  { id: 'D3', label: 'Aim at a third real defect', type: 'defect', why: 'Third and last defect sample.' },
  { id: 'R1', label: 'Back at A1 — same jamb corner', type: 'return', why: 'Loop closure. The FLATTERING number — a constant bias cancels here. Reported, never used as the bar.' },
];

/** The five-minute variant. Tags itself so nobody compares it like for like. */
export const SHORT_PROTOCOL: StationPlan[] = FULL_PROTOCOL.filter((s) =>
  ['A1', 'A2', 'C1', 'C2', 'C4', 'R1'].includes(s.id),
);

export function protocolFor(variant: 'full' | 'short'): StationPlan[] {
  return variant === 'short' ? SHORT_PROTOCOL : FULL_PROTOCOL;
}
