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
//
// This is intentionally separate from utils/useResponsiveLayout which is the
// app-wide responsive primitive with 768/1024 cutoffs and richer return
// shape — keeping the Scheduler-specific knobs here avoids touching the
// app-wide tokens table.

import { useWindowDimensions } from 'react-native';

export type Breakpoint = 'phone' | 'tablet' | 'desktop';

export function useResponsive(): { bp: Breakpoint; width: number } {
  const { width } = useWindowDimensions();
  const bp: Breakpoint = width < 600 ? 'phone' : width < 900 ? 'tablet' : 'desktop';
  return { bp, width };
}
