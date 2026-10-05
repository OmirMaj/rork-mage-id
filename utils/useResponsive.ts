// utils/useResponsive.ts — Phase 27.
//
// Small hook returning the current breakpoint based on useWindowDimensions.
// Lets components conditionally render compressed phone layouts (e.g. the
// Pro Scheduler tab shell, header, and Gantt body all branch on bp === 'phone'
// to swap in a single-pane / sticky-name / bottom-tabbar layout).
//
// Threshold conventions:
//   < 600px  → phone   (single-pane, sticky-left task col, bottom tab bar)
//   < 900px  → tablet  (compressed desktop, still 2-pane)
//   >= 900px → desktop (full split panes)
// A native phone is 'phone' in landscape too (utils/nativePhone).
//
// This is intentionally separate from utils/useResponsiveLayout which is the
// app-wide responsive primitive with 768/1024 cutoffs and richer return
// shape — keeping the Scheduler-specific knobs here avoids touching the
// app-wide tokens table.

import { Platform, useWindowDimensions } from 'react-native';
import { breakpointWidth } from '@/utils/nativePhone';

export type Breakpoint = 'phone' | 'tablet' | 'desktop';

export function useResponsive(): { bp: Breakpoint; width: number } {
  const { width, height } = useWindowDimensions();
  // A native phone turned sideways is still a phone (utils/nativePhone): the
  // breakpoint reads its short side, the returned width stays the real one.
  const bw = breakpointWidth(Platform.OS, width, height);
  const bp: Breakpoint = bw < 600 ? 'phone' : bw < 900 ? 'tablet' : 'desktop';
  return { bp, width };
}
