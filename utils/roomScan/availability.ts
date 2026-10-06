// utils/roomScan/availability.ts — the ways a room scan can be "no", each with its own reason.
//
// "Scanning is unavailable" leaves the reader with nothing to do, because the
// causes have different next steps: wait for a new app build, update iOS, use
// a different phone, tap Allow, or open Settings. So each cause is its own
// reason and the screen gives each its own sentence (hooks/useRoomScanCopy.ts).
//
// Pure: no react-native import. On web and Android the module is simply absent
// and `notInThisBuild` is the truthful answer, reached by the same path as an
// iPhone build that predates the module.

/** What modules/mage-room-scan's getCapabilities returns. */
export interface RoomScanCapabilities {
  linked: boolean;
  /** RoomCaptureSession.isSupported: LiDAR plus iOS 16. */
  supported: boolean;
  reason: 'ok' | 'simulator' | 'osTooOld' | 'noLidar' | 'cameraDenied' | 'cameraUndetermined';
  /** iOS 17 or later. */
  multiRoom: boolean;
  osVersion: string;
  deviceModel: string;
}

export type RoomScanUnavailableReason =
  /** The installed app has no scanner in it. Only a new app build adds one. */
  | 'notInThisBuild'
  /** iOS below 16. */
  | 'osTooOld'
  /** No LiDAR sensor on this phone. */
  | 'noLidar'
  | 'simulator'
  /** Never asked. The screen offers the prompt. */
  | 'cameraUndetermined'
  /** Refused. Only Settings changes it. */
  | 'cameraDenied';

export interface RoomScanAvailability {
  available: boolean;
  reason: RoomScanUnavailableReason | null;
  /** What the button offers, when anything can be offered. */
  action: 'none' | 'requestCamera' | 'openSettings';
  deviceModel: string | null;
  osVersion: string | null;
}

const ACTION: Record<RoomScanUnavailableReason, RoomScanAvailability['action']> = {
  notInThisBuild: 'none',
  osTooOld: 'none',
  noLidar: 'none',
  simulator: 'none',
  cameraUndetermined: 'requestCamera',
  cameraDenied: 'openSettings',
};

const KNOWN: readonly string[] = ['simulator', 'osTooOld', 'noLidar', 'cameraDenied', 'cameraUndetermined'];

/**
 * `caps === null` means the optional lookup returned null: the module is not
 * in this binary. That is a different fact from "this phone says no", and the
 * one an over-the-air update can never change.
 */
export function roomScanAvailability(caps: RoomScanCapabilities | null): RoomScanAvailability {
  if (caps === null || typeof caps !== 'object') {
    return { available: false, reason: 'notInThisBuild', action: 'none', deviceModel: null, osVersion: null };
  }
  const base = { deviceModel: caps.deviceModel ?? null, osVersion: caps.osVersion ?? null };
  if (caps.reason === 'ok' && caps.supported === true) {
    return { available: true, reason: null, action: 'none', ...base };
  }
  // An answer this file does not know (a newer native side) is treated as the
  // phone saying no, never as yes.
  const reason: RoomScanUnavailableReason = KNOWN.includes(caps.reason)
    ? (caps.reason as RoomScanUnavailableReason)
    : 'noLidar';
  return { available: false, reason, action: ACTION[reason], ...base };
}
