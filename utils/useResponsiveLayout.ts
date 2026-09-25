import { useState, useEffect, useMemo, useSyncExternalStore } from 'react';
import { Dimensions, Platform, type ScaledSize } from 'react-native';
import { Layout } from '@/constants/designTokens';
import { sidebarWidthForRoute } from '@/utils/sidebarRail';
import { getSidebarRail, subscribeSidebarRail } from '@/utils/sidebarRailStore';

export type ScreenSize = 'phone' | 'tablet' | 'desktop';

export interface ResponsiveLayout {
  screenSize: ScreenSize;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  width: number;
  height: number;
  /** Desktop: Layout.page.dashboard — the same token the page frame uses, so
   *  a screen that caps itself with this agrees with every framed route. */
  contentMaxWidth: number;
  sidebarWidth: number;
  showSidebar: boolean;
  ganttRowHeight: number;
  // Wave 6b removed `cardColumns`, `fontSize` and `spacing`: grep found zero
  // readers in app/, components/, hooks/, utils/ or __tests__, and they
  // advertised a desktop type/spacing scale that nothing applied. Desktop
  // widths and gaps live in constants/designTokens.ts Layout.
}

/**
 * The one breakpoint reader.
 *
 * `isDesktop` is web >= 900 CSS px OR any platform >= 1024. So a NATIVE window
 * >= 1024 (an Android tablet, ChromeOS) counts as desktop for LAYOUT — desktop
 * widths and styles — by design (wave 6b minor, a written rule since 6c). The
 * portrait-locked iPhone can never reach it. Browser-only behaviour (hotkeys,
 * URL writes, the shell dock) must use useIsDesktopWeb() instead.
 *
 * `sidebarWidth` is the desktop sidebar's CURRENT width: 240, or the 64 px
 * rail when it is collapsed for this route (utils/sidebarRail, read from the
 * store the shell keeps — wave 6c). 0 below desktop.
 */
export function useResponsiveLayout(): ResponsiveLayout {
  const [dimensions, setDimensions] = useState(Dimensions.get('window'));
  const rail = useSyncExternalStore(subscribeSidebarRail, getSidebarRail, getSidebarRail);

  useEffect(() => {
    const handler = ({ window }: { window: ScaledSize; screen: ScaledSize }) => {
      setDimensions(window);
    };
    const subscription = Dimensions.addEventListener('change', handler);
    return () => subscription.remove();
  }, []);

  const { width, height } = dimensions;
  const isWeb = Platform.OS === 'web';

  return useMemo(() => {
    let screenSize: ScreenSize = 'phone';
    if (width >= 1024 || (isWeb && width >= 900)) {
      screenSize = 'desktop';
    } else if (width >= 768) {
      screenSize = 'tablet';
    }

    const isPhone = screenSize === 'phone';
    const isTablet = screenSize === 'tablet';
    const isDesktop = screenSize === 'desktop';

    return {
      screenSize,
      isPhone,
      isTablet,
      isDesktop,
      width,
      height,
      contentMaxWidth: isDesktop ? Layout.page.dashboard : isTablet ? 900 : width,
      sidebarWidth: isDesktop ? sidebarWidthForRoute(rail.topSegment, rail.pref) : 0,
      showSidebar: isDesktop,
      ganttRowHeight: isDesktop ? 40 : isTablet ? 36 : 32,
    };
  }, [width, height, isWeb, rail]);
}
