// utils/phone3dSpikeLaunch.ts — how the phone 3D check is opened in the iOS
// Simulator with no finger on the glass (lane PHONE3D, app/dev-phone-3d.tsx).
//
// A link (`mageid://dev-phone-3d`) makes iOS ask "Open in MAGE ID?", and
// nothing on a Mac's command line can press Open. So a Mac-made build can be
// started with a launch argument instead:
//
//   xcrun simctl launch booted com.mageid.app -phone3d "week=3"
//
// iOS puts launch arguments into the app's settings, and this reads the one
// named `phone3d`. app/_layout.tsx then opens the check, and the check reads
// the same words as its week, its angle and so on.
//
// OFF IN EVERY BUILD ANYONE INSTALLS: both functions answer null unless the
// bundle was made with EXPO_PUBLIC_PHONE3D_SPIKE=1, which is set only in the
// shell of the person making a simulator build (scripts/validate-phone-3d.ts,
// rules E1 and E2). Nobody can pass a launch argument to an App Store app.
import { Platform, Settings } from 'react-native';

/** The words after `-phone3d` on the command line that started the app, or null. */
export function phone3dSpikeLaunchArgs(): string | null {
  if (process.env.EXPO_PUBLIC_PHONE3D_SPIKE !== '1' || Platform.OS !== 'ios') return null;
  try {
    const v: unknown = Settings.get('phone3d');
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** The same words as a lookup: "week=3&dx=120" gives { week: '3', dx: '120' }. */
export function phone3dSpikeLaunchParams(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (phone3dSpikeLaunchArgs() ?? '').split('&')) {
    const [k, v] = part.split('=');
    if (k && v != null) out[k] = v;
  }
  return out;
}
