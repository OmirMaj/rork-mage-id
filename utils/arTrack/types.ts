// utils/arTrack/types.ts — the shapes the AR measurement spike passes around.
//
// Nothing here imports react-native, expo, or the native module, so
// scripts/validate-ar-spike.ts can execute every consumer of these types under
// bun without a bundler.
//
// NAMING RULE THAT MATTERS. Anything the app COMPUTED is prefixed or nested
// under `_derived`; anything a sensor or a finger produced is not. The export
// keeps the two apart so nobody reading the file six weeks from now mistakes an
// app-side arithmetic result for a measurement. The analysis recomputes every
// derived value from the raw fields.

import type { PassFailBar } from './bar';

/** ARKit's own three states, in Apple's own words, mapped to ours. */
export type ArTrust = 'tracked' | 'limited' | 'lost';

export type ArLimitedReason =
  | 'initializing'
  | 'excessiveMotion'
  | 'insufficientFeatures'
  | 'relocalizing'
  | 'unknown';

/** Why there is nothing to measure. Each one is a DIFFERENT sentence on screen. */
export type ArUnavailableReason =
  /** The installed binary has no AR module. Only a new build can add one. */
  | 'notInThisBuild'
  | 'simulator'
  | 'unsupportedDevice'
  | 'cameraDenied'
  | 'cameraUndetermined';

export interface ArCapabilities {
  available: boolean;
  reason: 'ok' | Exclude<ArUnavailableReason, 'notInThisBuild'>;
  hasLidar: boolean;
  supportsHighResCapture: boolean;
  deviceModel: string;
  osVersion: string;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ArPose {
  available: true;
  /** Seconds since `start`, from the device's monotonic clock. */
  t: number;
  /** The ARFrame's own timestamp — the sensor's clock, not ours. */
  frameT: number;
  trust: ArTrust;
  reason: ArLimitedReason | null;
  epoch: number;
  featurePoints: number;
  worldMapping: 'notAvailable' | 'limited' | 'extending' | 'mapped' | 'unknown';
  ambientLumens: number | null;
  /** RAW ARKit-world translation, metres, unrotated. Survives into the export. */
  world: Vec3;
  yawDeg: number;
  /**
   * Origin-relative: x = right of the way he faced, y = up, z = FORWARD.
   * LEFT-HANDED (a reflection of ARKit world) — a reading aid only. Never an
   * input to the plan fit; driftMath fits on `world`.
   */
  local: Vec3 | null;
  originEpoch: number | null;
  sameEpochAsOrigin: boolean;
  /** How old the cached frame is. Returned, never hidden. */
  ageMs: number;
  pathLengthM?: number;
  label?: string | null;
}

export interface ArPoseUnavailable {
  available: false;
  reason: 'notRunning' | 'noFrameYet' | 'simulator' | 'notInThisBuild';
}

export type ArPoseResult = ArPose | ArPoseUnavailable;

export interface ArRaycastHit {
  hit: true;
  /** WHICH kind of surface answered — a measured plane or ARKit's guess at one. */
  target: 'existingPlaneGeometry' | 'estimatedPlane';
  alignment: 'horizontal' | 'vertical' | 'any' | 'unknown';
  point: Vec3;
  local: Vec3 | null;
  distanceM: number;
}

export interface ArRaycastMiss {
  hit: false;
  target: null;
  alignment: null;
}

export type ArRaycastResult = ArRaycastHit | ArRaycastMiss;

export interface ArEpochRecord {
  epoch: number;
  startedAtS: number;
  cause: 'start' | 'interrupted' | 'trackingLost';
  /** ARKit came back into the SAME world. Only then are the two sides comparable. */
  relocalized: boolean;
}

export interface ArTrackSummary {
  elapsedS: number;
  pathLengthM: number;
  sampleCount: number;
  normalS: number;
  limitedS: number;
  lostS: number;
  pathDownsampled: boolean;
  epochs: ArEpochRecord[];
}

export interface ArStatusEvent {
  available: boolean;
  trackingState: ArTrust | 'notAvailable';
  reason: ArLimitedReason | null;
  interrupted: boolean;
  epoch: number;
  hasLidar: boolean;
}

// ── The measurement protocol ────────────────────────────────────────────────

/**
 * Station types, each one isolating a DIFFERENT error source. A station that is
 * not typed is a number nobody can attribute afterwards.
 */
export type SpikeStationType =
  /** One end of the alignment baseline. */
  | 'anchor'
  /** An ordinary station on a physical feature — the main sample. */
  | 'control'
  /** Mid-room, no feature to touch. Carries stance error; reported separately. */
  | 'free'
  /** Same feature, three taps, three zooms, without moving. Measures HIS RULER. */
  | 'tap-repeat'
  /** Mark, stand 60 s, mark again. Separates per-second drift from per-metre. */
  | 'stand-still'
  /** Aim at a defect across the room. Camera pose vs raycast hit vs his tap. */
  | 'defect'
  /** Back at the first anchor. The flattering number, labelled as such. */
  | 'return'
  /** Could not be reached. Recorded WITH a reason, never silently dropped. */
  | 'skipped';

/** A tap on the plan, normalised 0..1 against the rendered IMAGE rect. */
export interface SpikePlanTap {
  sheetId: string;
  x: number;
  y: number;
  /** Zoom at placement. His thumb is the ruler; the ruler's precision is the zoom. */
  zoomScale: number;
  msFromPromptToTap: number;
  retapCount: number;
}

export interface SpikeSample {
  id: string;
  stationId: string;
  stationType: SpikeStationType;
  label: string;
  /** Wall clock, full ISO instant — used only to correlate with photos. */
  atIso: string;
  /** Monotonic ms since session start — the clock every RATE is computed against. */
  atMonotonicMs: number;
  timeSinceOriginSec: number;
  timeSinceLastConfirmSec: number;
  pose: ArPose | null;
  /** Why there is no pose, when there is none. */
  poseUnavailableReason: string | null;
  pathLengthM: number;
  straightLineFromOriginM: number;
  tap: SpikePlanTap | null;
  raycast: ArRaycastResult | null;
  thermalState: string | null;
  batteryLevel: number | null;
  /** "dark" | "bare" | "stair" | "elevator" | "from pocket" … */
  noteChips: string[];
  /** Set when the station could not be reached. */
  skipReason: string | null;
}

export interface SpikePlanCalibrationRecord {
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  realDistanceFt: number;
}

export interface SpikeSessionHeader {
  sessionId: string;
  schemaVersion: number;
  startedAtIso: string;
  appVersion: string;
  runtimeVersion: string;
  deviceModel: string;
  osVersion: string;
  hasLidar: boolean;
  arConfig: {
    worldAlignment: 'gravity';
    planeDetection: string[];
    sceneDepth: boolean;
    highResCapture: boolean;
  };
  projectId: string | null;
  sheetId: string | null;
  sheetPixelWidth: number | null;
  sheetPixelHeight: number | null;
  calibration: SpikePlanCalibrationRecord | null;
  /**
   * 'pdf' quotes metres. 'photo' does not: a photographed sheet is
   * perspective-skewed and the residual cannot be attributed to ARKit.
   */
  planSource: 'pdf' | 'photo' | 'unknown';
  floorLabel: string | null;
  protocol: 'full' | 'short';
  /** What the floor looks like: bare drywall / glazed / dark / occupied. */
  floorNote: string;
}

export interface SpikeExportPayload {
  header: SpikeSessionHeader;
  samples: SpikeSample[];
  track: ArTrackSummary | null;
  /** Path NDJSON written by the native module, if it was exported. */
  rawTrackUri: string | null;
  /**
   * EVERYTHING the app computed, fenced off. The analysis recomputes all of it
   * from `samples` — these are a convenience, not evidence.
   */
  _derived: {
    generatedAtIso: string;
    note: string;
    feetPerPixel: number | null;
    stopTrusting: SessionTrustVerdict;
    /** The pre-registered bar (utils/arTrack/bar.ts) this session is judged against. */
    passFailBar: PassFailBar;
  };
}

export interface SessionTrustVerdict {
  trusted: boolean;
  /** Plain-English, shown verbatim on screen. Empty only when trusted. */
  reason: string;
  /** Stable code so a guard can assert the rule rather than the wording. */
  code:
    | 'ok'
    | 'lostTooLong'
    | 'interruptedWithoutRelocalization'
    /** A break is in progress and ARKit is still trying to find the room. */
    | 'relocalizing'
    | 'tooLongElapsed'
    | 'tooFarWalked'
    | 'thermal'
    | 'battery'
    | 'notStarted';
}
