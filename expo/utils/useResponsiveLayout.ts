import { useState, useEffect, useMemo } from 'react';
import { Dimensions, Platform } from 'react-native';

export type ScreenSize = 'phone' | 'tablet' | 'desktop';

export interface ResponsiveLayout {
  screenSize: ScreenSize;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  width: number;
  height: number;
  contentMaxWidth: number;
  sidebarWidth: number;
  showSidebar: boolean;
  ganttRowHeight: number;
  cardColumns: number;
  fontSize: {
    title: number;
    heading: number;
    body: number;
    caption: number;
  };
  spacing: {
    page: number;
    section: number;
    card: number;
  };
}

export function useResponsiveLayout(): ResponsiveLayout {
  const [dimensions, setDimensions] = useState(Dimensions.get('window'));

  useEffect(() => {
    const handler = ({ window }: { window: { width: number; height: number; scale?: number; fontScale?: number } }) => {
      setDimensions({ width: window.width, height: window.height, scale: (window as any).scale ?? 1, fontScale: (window as any).fontScale ?? 1 });
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
      contentMaxWidth: isDesktop ? 1400 : isTablet ? 900 : width,
      sidebarWidth: isDesktop ? 240 : 0,
      showSidebar: isDesktop,
      ganttRowHeight: isDesktop ? 40 : isTablet ? 36 : 32,
      cardColumns: isDesktop ? 3 : isTablet ? 2 : 1,
      fontSize: {
        title: isDesktop ? 32 : isTablet ? 28 : 24,
        heading: isDesktop ? 20 : isTablet ? 18 : 16,
        body: isDesktop ? 15 : 14,
        caption: isDesktop ? 13 : 12,
      },
      spacing: {
        page: isDesktop ? 32 : isTablet ? 24 : 16,
        section: isDesktop ? 24 : isTablet ? 20 : 16,
        card: isDesktop ? 16 : 12,
      },
    };
  }, [width, height, isWeb]);
}
