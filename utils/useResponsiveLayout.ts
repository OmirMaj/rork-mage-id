import { useState, useEffect, useMemo } from 'react';
import { Dimensions, Platform, type ScaledSize } from 'react-native';
import { Layout } from '@/constants/designTokens';

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

export function useResponsiveLayout(): ResponsiveLayout {
  const [dimensions, setDimensions] = useState(Dimensions.get('window'));

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
      sidebarWidth: isDesktop ? 240 : 0,
      showSidebar: isDesktop,
      ganttRowHeight: isDesktop ? 40 : isTablet ? 36 : 32,
    };
  }, [width, height, isWeb]);
}
