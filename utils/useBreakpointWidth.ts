// utils/useBreakpointWidth.ts — the window width a layout breakpoint compares.
//
// useWindowDimensions().width, except on a native phone, where it is the short
// side in both orientations (utils/nativePhone.breakpointWidth): a sideways
// iPhone must answer `>= 768` / `>= 900` exactly as it does upright. A screen
// that DECIDES a layout by window width reads this; a screen that SIZES
// something keeps the real width.

import { Platform, useWindowDimensions } from 'react-native';
import { breakpointWidth } from '@/utils/nativePhone';

export function useBreakpointWidth(): number {
  const { width, height } = useWindowDimensions();
  return breakpointWidth(Platform.OS, width, height);
}
