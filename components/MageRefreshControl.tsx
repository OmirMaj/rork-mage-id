// MageRefreshControl — RefreshControl preconfigured with the MAGE brand.
//
// Why this exists: the default RefreshControl on iOS is a thin gray
// spinner; on Android it's a tiny circle. Both feel generic. By
// pre-tinting it with our primary color and matching the spinner
// to the construction-loader vibe, every list across the app feels
// branded.
//
// Drop-in replacement: same props as RefreshControl. Just swap the
// import. The wrapper is intentionally thin — RN's native pull-to-
// refresh is already buttery smooth, no need to rebuild it from
// scratch with a custom Animated header.
import React from 'react';
import { Platform, RefreshControl, RefreshControlProps } from 'react-native';
import { Colors } from '@/constants/colors';

export interface MageRefreshControlProps extends Omit<RefreshControlProps, 'tintColor' | 'colors' | 'progressBackgroundColor'> {
  /** Optional override — defaults to the brand primary. */
  tint?: string;
}

export default function MageRefreshControl(props: MageRefreshControlProps) {
  const tint = props.tint ?? Colors.primary;
  return (
    <RefreshControl
      {...props}
      // iOS uses a single tintColor for the spinner.
      tintColor={tint}
      // Android wants an array of accent colors that the spinner cycles
      // through. We give it our primary + a softer warm tone so the
      // gesture feels alive without being noisy.
      colors={Platform.OS === 'android' ? [tint, Colors.warning] : undefined}
      progressBackgroundColor={Platform.OS === 'android' ? Colors.surface : undefined}
      title={props.title ?? (Platform.OS === 'ios' ? 'Pulling latest…' : undefined)}
      titleColor={Colors.textMuted}
    />
  );
}
