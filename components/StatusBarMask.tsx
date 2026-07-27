// components/StatusBarMask.tsx — opaque strip under the iOS status bar /
// Dynamic Island for screens whose SCROLLING content starts at the very top
// (large-title headers inside the scroll surface, e.g. Home).
//
// Sim-audit fix #7: home content scrolled up collided with the clock — the
// scroll surface had safe-area padding in its CONTENT, so once you scrolled,
// text slid under the transparent status bar. Screens with a FIXED header
// (discover's headerArea, the tool screens' ToolHeader) don't need this;
// screens that scroll their own header do.
//
// Mount as a sibling AFTER the scroll surface inside the screen's root View.
// pointerEvents="none" so it never eats touches; sits below FABs (zIndex 10
// vs their 998+).

import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';

export default function StatusBarMask() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  if (insets.top <= 0) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: insets.top,
        backgroundColor: colors.bg,
        zIndex: 10,
      }}
    />
  );
}
