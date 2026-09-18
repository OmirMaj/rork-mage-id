// utils/arTrack/native.ts — the ONLY place JS touches the AR module.
//
// ── WHY `requireOptionalNativeModule`, AND WHY IT IS NOT NEGOTIABLE ─────────
//
// `app.json`'s runtimeVersion policy is `appVersion` and `expo.version` is
// 1.0.0. If the AR build keeps 1.0.0, the new binary and EVERY EXISTING
// production install share runtime 1.0.0 — so every later
// `eas update --branch production` lands on both. A bundle that imported this
// module at the top level, or assumed it exists, would reach installs whose
// binary has no native half. Expo's own warning for that shape is that older
// builds "incorrectly consider the update compatible" and expo-updates "may
// detect an error and attempt to roll back".
//
// This repo has already been burned by exactly that: build #12 rolled back
// silently over react-native-reanimated's JS half being bundled into an OTA
// while the installed binary had no native half. `metro.config.js` carries the
// stub, and `scripts/validate-native-surface.ts` exists because of it.
//
// So: ONE nullable lookup, in ONE file, and `null` is an ordinary answer that
// every caller handles. `requireNativeModule` (which throws) must never appear
// anywhere in this app. `scripts/validate-ar-spike.ts` pins that by static read.
//
// Nothing outside `modules/` and `utils/arTrack/` mentions "MageArTrack" — the
// module has no JS entry point at all, so Metro's graph never contains it.

// From 'expo', not 'expo-modules-core': `expo` is the declared dependency and
// re-exports the same function (node_modules/expo/build/Expo.d.ts).
// expo-modules-core only resolves here through hoisting, which a package
// manager is free to stop doing.
import { requireOptionalNativeModule } from 'expo';
import type {
  ArCapabilities,
  ArPoseResult,
  ArRaycastResult,
  ArStatusEvent,
  ArTrackSummary,
  ArPose,
} from './types';

export interface ArStartOptions {
  hz?: number;
  sceneDepth?: boolean;
  highResCapture?: boolean;
}

export interface ArRaycastOptions {
  x?: number;
  y?: number;
  allowing?: 'existingPlaneGeometry' | 'estimatedPlane';
  alignment?: 'any' | 'horizontal' | 'vertical';
}

export interface ArOriginResult {
  yawDeg: number;
  world: { x: number; y: number; z: number };
  epoch: number;
  atS: number;
  frameT: number;
}

export interface ArCaptureResult {
  uri: string;
  width: number;
  height: number;
  pose?: ArPose;
  trust: string;
}

/**
 * The one method a native listener handle has. Declared here rather than
 * imported, so this file names no package it does not depend on.
 */
export interface EventSubscription {
  remove(): void;
}

interface MageArTrackNative {
  getCapabilities(): ArCapabilities;
  refreshCapabilities(): ArCapabilities;
  getPose(): ArPoseResult;
  start(options: ArStartOptions): Promise<void>;
  stop(): Promise<void>;
  setOrigin(): Promise<ArOriginResult>;
  markPoint(label: string | null): Promise<ArPose>;
  raycast(options: ArRaycastOptions): Promise<ArRaycastResult>;
  captureFrame(): Promise<ArCaptureResult>;
  getTrack(): Promise<ArTrackSummary>;
  exportTrack(): Promise<{ uri: string; rows: number; pathDownsampled: boolean }>;
  addListener(event: 'onStatusChange', cb: (e: ArStatusEvent) => void): EventSubscription;
  addListener(event: 'onSample', cb: (e: ArPose) => void): EventSubscription;
  addListener(event: 'onError', cb: (e: { code: string; message: string }) => void): EventSubscription;
}

/** `null` on web, on Android, and in any build that predates the AR module. */
const Native = requireOptionalNativeModule<MageArTrackNative>('MageArTrack');

/** Is the native half present in THIS binary? Not "does AR work" — see availability.ts. */
export function isModuleLinked(): boolean {
  return Native !== null;
}

/**
 * The device's own answer, or `null` when the module is not in this build. The
 * caller turns `null` into the `notInThisBuild` sentence — this function never
 * fakes a capabilities object, because a fake one would report a `reason` the
 * device never gave.
 */
export function getCapabilities(): ArCapabilities | null {
  return Native ? Native.getCapabilities() : null;
}

/** Re-read after JS has raised the camera prompt; the cached answer is stale. */
export function refreshCapabilities(): ArCapabilities | null {
  return Native ? Native.refreshCapabilities() : null;
}

export function getPose(): ArPoseResult {
  return Native ? Native.getPose() : { available: false, reason: 'notInThisBuild' };
}

export async function start(options: ArStartOptions = {}): Promise<void> {
  if (!Native) throw new ArTrackUnavailableError();
  await Native.start(options);
}

export async function stop(): Promise<void> {
  if (!Native) return;
  await Native.stop();
}

export async function setOrigin(): Promise<ArOriginResult> {
  if (!Native) throw new ArTrackUnavailableError();
  return Native.setOrigin();
}

export async function markPoint(label: string | null = null): Promise<ArPose> {
  if (!Native) throw new ArTrackUnavailableError();
  return Native.markPoint(label);
}

export async function raycast(options: ArRaycastOptions = {}): Promise<ArRaycastResult> {
  if (!Native) throw new ArTrackUnavailableError();
  return Native.raycast(options);
}

export async function captureFrame(): Promise<ArCaptureResult> {
  if (!Native) throw new ArTrackUnavailableError();
  return Native.captureFrame();
}

export async function getTrack(): Promise<ArTrackSummary | null> {
  if (!Native) return null;
  return Native.getTrack();
}

export async function exportTrack(): Promise<{ uri: string; rows: number; pathDownsampled: boolean } | null> {
  if (!Native) return null;
  return Native.exportTrack();
}

/** Subscriptions are no-ops when the module is absent, so callers need no branch. */
export function onStatusChange(cb: (e: ArStatusEvent) => void): EventSubscription {
  return Native ? Native.addListener('onStatusChange', cb) : noopSubscription();
}

export function onSample(cb: (e: ArPose) => void): EventSubscription {
  return Native ? Native.addListener('onSample', cb) : noopSubscription();
}

export function onError(cb: (e: { code: string; message: string }) => void): EventSubscription {
  return Native ? Native.addListener('onError', cb) : noopSubscription();
}

function noopSubscription(): EventSubscription {
  return { remove: () => {} };
}

/**
 * Thrown only when a caller reaches a mutating entry point in a build without
 * the module. The screen is supposed to have blocked that long before — see
 * availability.ts — so this exists to be loud, not to be handled.
 */
export class ArTrackUnavailableError extends Error {
  readonly code = 'E_AR_NOT_IN_THIS_BUILD';
  constructor() {
    super("This build doesn't include the AR module. It can only arrive in a new iPhone build — an over-the-air update can't add native code.");
    this.name = 'ArTrackUnavailableError';
  }
}

/** The stable code on a native error, or null when it is not one of ours. */
export function arErrorCode(e: unknown): string | null {
  if (e instanceof ArTrackUnavailableError) return e.code;
  if (e && typeof e === 'object' && 'code' in e) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === 'string' && c.startsWith('E_AR_')) return c;
  }
  return null;
}
