// utils/arTrack/availability.ts — the five ways this can be "no", each with its
// own sentence.
//
// WHY FIVE AND NOT ONE. "AR is unavailable" is the kind of message that costs a
// support conversation every time it appears, because the five causes have five
// different next actions: install a new build, use a real phone, use a
// different phone, tap Allow, or open Settings. A shared string makes the
// screen look finished and leaves the reader with nothing to do.
//
// A disabled control says WHY. That is the house rule, and this file is how the
// AR screen keeps it.
//
// Pure: no react-native import. `Platform` is deliberately not consulted here —
// on web and Android the module is simply absent and `notInThisBuild` is the
// truthful answer, reached by the same code path as an old iPhone build.

import type { ArCapabilities, ArUnavailableReason } from './types';

export interface ArAvailability {
  available: boolean;
  reason: ArUnavailableReason | null;
  /** Shown verbatim. */
  message: string;
  /** What the button offers, when anything can be offered. */
  action: 'none' | 'requestCamera' | 'openSettings';
  hasLidar: boolean;
  supportsHighResCapture: boolean;
  deviceModel: string | null;
  osVersion: string | null;
}

const MESSAGES: Record<ArUnavailableReason, { message: string; action: ArAvailability['action'] }> = {
  notInThisBuild: {
    message: "This build doesn't include the AR module. It can only arrive in a new iPhone build — an over-the-air update can't add native code.",
    action: 'none',
  },
  simulator: {
    message: 'The simulator has no camera or motion sensors — ARKit only runs on a real iPhone.',
    action: 'none',
  },
  unsupportedDevice: {
    message: 'This iPhone does not support ARKit world tracking, so there is nothing to measure here.',
    action: 'none',
  },
  cameraUndetermined: {
    message: 'AR tracking needs the camera. Nothing is recorded or uploaded — the camera is only used to work out how the phone is moving.',
    action: 'requestCamera',
  },
  cameraDenied: {
    message: 'Camera access is off for MAGE ID, so AR tracking cannot start. Turn it back on in Settings → MAGE ID → Camera.',
    action: 'openSettings',
  },
};

/**
 * Turn the native answer (or its absence) into one availability verdict.
 *
 * `caps === null` means `requireOptionalNativeModule` returned null — the
 * module is not in this binary. That is a DIFFERENT fact from "the device says
 * no", and it is the one an OTA can never change, so it gets its own reason
 * rather than being folded into `unsupportedDevice`.
 */
export function arAvailability(caps: ArCapabilities | null): ArAvailability {
  if (caps === null) {
    return {
      available: false,
      reason: 'notInThisBuild',
      ...MESSAGES.notInThisBuild,
      hasLidar: false,
      supportsHighResCapture: false,
      deviceModel: null,
      osVersion: null,
    };
  }

  const base = {
    hasLidar: caps.hasLidar,
    supportsHighResCapture: caps.supportsHighResCapture,
    deviceModel: caps.deviceModel,
    osVersion: caps.osVersion,
  };

  if (caps.available && caps.reason === 'ok') {
    return { available: true, reason: null, message: '', action: 'none', ...base };
  }

  // `reason` is a device-supplied string. An unrecognised one must NOT fall
  // through to "available" — the safe default is refusing with the raw reason
  // visible, so a future native reason shows up as itself instead of as a
  // working screen that does nothing.
  const known = caps.reason !== 'ok' ? MESSAGES[caps.reason] : undefined;
  if (!known) {
    return {
      available: false,
      reason: 'unsupportedDevice',
      message: `AR tracking is not available on this device (${String(caps.reason)}).`,
      action: 'none',
      ...base,
    };
  }

  return {
    available: false,
    reason: caps.reason as ArUnavailableReason,
    ...known,
    ...base,
  };
}

/**
 * Why the LiDAR depth option is off, or null when it is on. LiDAR is Pro-only
 * from the iPhone 12 Pro; the raycast path works on every device, so this
 * disables one checkbox rather than the screen.
 */
export function depthBlockedReason(a: ArAvailability): string | null {
  if (!a.available) return a.message;
  if (!a.hasLidar) {
    return 'This iPhone has no LiDAR scanner (Pro models only, iPhone 12 Pro and later). The raycast path still works.';
  }
  return null;
}

/**
 * Why high-resolution capture is off, or null when it is on. iOS 16+ only; on
 * 15.x the native call throws rather than quietly returning a low-resolution
 * frame, so the control has to say so before it is pressed.
 */
export function captureBlockedReason(a: ArAvailability): string | null {
  if (!a.available) return a.message;
  if (!a.supportsHighResCapture) {
    return `High-resolution AR capture needs iOS 16 or later (this phone is on ${a.osVersion ?? 'an older version'}).`;
  }
  return null;
}
