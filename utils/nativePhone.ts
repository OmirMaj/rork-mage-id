// utils/nativePhone.ts — "a native phone is always the phone layout".
//
// WHY THIS EXISTS. The iPhone build allows landscape at the native level from
// the next App Store build on (app.json ios.infoPlist
// UISupportedInterfaceOrientations), and screens are opened to it one at a time
// (utils/screenOrientation). A sideways iPhone is 667-956 pt WIDE, which
// crosses every width breakpoint the app picks a layout by: 768 ("tablet": the
// Schedule tab swapped the phone schedule for the classic one, Home went to
// dense rows), 900 (Schedule Pro's desktop grid, the scheduler's "desktop"
// split). Screens UNDER the rotated one stay mounted and re-lay out too, so a
// locked screen is not protected by its lock.
//
// THE RULE. Phone-ness on a native build comes from the device's SHORT side,
// never from its width: a native window whose short side is under 600 pt is a
// phone in both orientations. No iPhone has a short side over 440 pt, and
// ios.supportsTablet is false (validate-landscape-lock pins both facts), so a
// native iPhone can never be 'tablet' or 'desktop'. 600 is Android's own
// tablet line (sw600dp).
//
// What it deliberately does NOT change: a native window whose short side is
// 600 or more (an Android tablet, ChromeOS) keeps the by-width rules it has had
// since wave 6c, and the web is never touched (`platform === 'web'` → false).
//
// PURE: no react-native import, so bun runs it (scripts/validate-landscape-lock.ts).
// Callers pass Platform.OS.

/** A native window with a short side under this is a phone at every width. */
export const NATIVE_PHONE_SHORT_SIDE_MAX = 600;

/** True on a native (iOS / Android) phone, in portrait AND in landscape. Always false on web. */
export function isNativePhone(platform: string, width: number, height: number): boolean {
  if (platform !== 'ios' && platform !== 'android') return false;
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  // A window not measured yet on one axis is judged on the other.
  const short = w === 0 ? h : h === 0 ? w : Math.min(w, h);
  return short < NATIVE_PHONE_SHORT_SIDE_MAX;
}

/**
 * The width a LAYOUT BREAKPOINT must compare against. On a native phone it is
 * the short side (its portrait width) in both orientations, so `>= 768`,
 * `>= 900` and friends answer the same sideways as upright. Everywhere else it
 * is the width, unchanged. Use the real width for sizing; this is for deciding.
 */
export function breakpointWidth(platform: string, width: number, height: number): number {
  if (!isNativePhone(platform, width, height)) return width;
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  return w === 0 ? h : h === 0 ? w : Math.min(w, h);
}
