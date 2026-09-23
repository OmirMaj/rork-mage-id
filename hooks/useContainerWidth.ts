// hooks/useContainerWidth.ts — the width a screen ACTUALLY has to lay out in.
//
// WHY THIS EXISTS. Screens inside the desktop shell branched on the WINDOW
// (useWindowDimensions / useResponsiveLayout().width). On the founder's 1512 px
// MacBook the window is 1512 but the content column is ~1270 (the 240 px
// sidebar), and less again with the right-hand dock open. Schedule Pro's
// GRID_BREAKPOINT 900 / SPLIT_BREAKPOINT 1600, schedule-review's
// wideEnoughForPro and the Gantt's hard-coded 800 px "Fit" viewport were all
// answering a question about the window when they meant the column.
//
// Usage: spread `onLayout` onto the container View; branch on `width`.
//
//   const { width, onLayout } = useContainerWidth();
//   <View onLayout={onLayout}>{width >= 1100 ? <Two/> : <One/>}</View>
//
// Before the first layout pass `width` is an ESTIMATE — the window minus the
// desktop sidebar — so the first paint is already close; the measured value
// replaces it one frame later. The estimate knows nothing about a docked
// panel; pass `initial` when the caller knows better.

import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';

export interface ContainerWidth {
  width: number;
  onLayout: (e: LayoutChangeEvent) => void;
  /** False until the container has reported its real width. */
  measured: boolean;
}

export function useContainerWidth(initial?: number): ContainerWidth {
  const layout = useResponsiveLayout();
  const estimate = typeof initial === 'number' && Number.isFinite(initial)
    ? initial
    : Math.max(0, layout.width - (layout.showSidebar ? layout.sidebarWidth : 0));
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.round(e?.nativeEvent?.layout?.width ?? NaN);
    if (!Number.isFinite(w) || w < 0) return;
    // Same width → same state object → no re-render. Without this, a child
    // whose layout depends on `width` could loop on sub-pixel noise.
    setMeasuredWidth((prev) => (prev === w ? prev : w));
  }, []);

  return { width: measuredWidth ?? estimate, onLayout, measured: measuredWidth !== null };
}
