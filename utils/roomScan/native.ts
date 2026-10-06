// utils/roomScan/native.ts — the ONLY place JS touches the room scan module.
//
// ── WHY `requireOptionalNativeModule`, AND WHY IT IS NOT NEGOTIABLE ─────────
// `app.json`'s runtimeVersion policy is `appVersion` and `expo.version` stays
// 1.0.0, so every over-the-air update lands on EVERY installed build, including
// the ones built before modules/mage-room-scan existed. A bundle that assumed
// the module is there would reach phones whose binary has no native half. That
// is how build 12 rolled back (see utils/arTrack/native.ts and
// scripts/validate-native-surface.ts).
//
// So: ONE nullable lookup, in ONE file, made the first time a scan screen asks
// and never at module scope. `null` is an ordinary answer ("not in this
// build") that every caller handles. `requireNativeModule`, which throws, must
// never appear. Nothing outside `modules/` and this file names the module.
// scripts/validate-scan-room.ts pins all of it by static read, and also pins
// that the lookup is refused while SCAN_ROOM_ENABLED is false.
//
// From 'expo', not 'expo-modules-core': `expo` is the declared dependency and
// re-exports the same function.
import { requireOptionalNativeModule } from 'expo';
import { SCAN_ROOM_ENABLED } from '@/constants/featureFlags';
import type { RoomScanCapabilities } from './availability';

export interface StartScanOptions {
  /** Caller-made id, used for the temp file name. */
  scanId: string;
  /** Also write the room as a USDZ file in the temp directory. */
  exportUsdz?: boolean;
}

export interface RawScanResult {
  status: 'done' | 'cancelled';
  /** JSONEncoder output of Apple's CapturedRoom, untouched. '' when cancelled. */
  capturedRoomJson: string;
  /** file:// in the temp directory, or null. */
  usdzUri: string | null;
  startedAt: string;
  endedAt: string;
  /** The iOS version the scan ran on. */
  roomPlanSdk: string;
  deviceModel: string;
  /** Session instructions seen: "lowTexture", "moveCloseToWall" ... */
  warnings: string[];
}

interface MageRoomScanNative {
  getCapabilities(): RoomScanCapabilities;
  startScan(options: StartScanOptions): Promise<RawScanResult>;
}

let looked = false;
let cached: MageRoomScanNative | null = null;

/** `null` on web, on Android, in any build that predates the module, and whenever the flag is off. */
function native(): MageRoomScanNative | null {
  if (!SCAN_ROOM_ENABLED) return null;
  if (!looked) {
    looked = true;
    try {
      cached = requireOptionalNativeModule<MageRoomScanNative>('MageRoomScan');
    } catch {
      // The optional lookup does not throw. If a future Expo makes it, "not in this build" is still the honest answer.
      cached = null;
    }
  }
  return cached;
}

/** Is the native half present in THIS binary? Not "can this phone scan": see availability.ts. */
export function isModuleLinked(): boolean {
  return native() !== null;
}

/** The phone's own answer, or `null` when the module is not in this build. Never a made-up answer. */
export function getCapabilities(): RoomScanCapabilities | null {
  const n = native();
  if (!n) return null;
  try { return n.getCapabilities(); } catch { return null; }
}

/** Thrown only when a caller reaches startScan in a build without the module. The screen blocks that long before. */
export class RoomScanUnavailableError extends Error {
  readonly code = 'E_ROOM_SCAN_NOT_IN_THIS_BUILD';
  constructor() {
    super('This build does not include room scanning.');
    this.name = 'RoomScanUnavailableError';
  }
}

export async function startScan(options: StartScanOptions): Promise<RawScanResult> {
  const n = native();
  if (!n) throw new RoomScanUnavailableError();
  return n.startScan(options);
}

/** The stable code on a native error, or null when it is not one of ours. */
export function roomScanErrorCode(e: unknown): string | null {
  if (e instanceof RoomScanUnavailableError) return e.code;
  if (e && typeof e === 'object' && 'code' in e) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === 'string' && c.startsWith('E_ROOM_SCAN_')) return c;
  }
  return null;
}
