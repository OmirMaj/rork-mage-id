// Spinner — the ActivityIndicator replacement: MAGE ID's one loading mark (the
// Level, components/loaders/LevelMark) at a spinner's size, with the
// accessibility a spinner owes.
//
//   <Spinner />                       a 20 pt level in the accent (a row / an inline wait)
//   <Spinner size="panel" />          a 36 pt level (an AI panel that waits 3 s or more)
//   <Spinner tone="onAccent" color={labelColor} />   inside a filled control
//   <Spinner tone="muted" />          a quiet wait
//
// The level waits its inline reveal (GATE.inline, 150 ms) before it fades in,
// so a fast answer never flashes a mark. The wrapper is the accessible element
// (role progressbar + a label); the mark itself is decorative. Colours come
// from the theme through LevelMark: no colour literal here.

import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import LevelMark from '@/components/loaders/LevelMark';
import { LOADER } from '@/utils/levelTimeline';

export type SpinnerSize = 'row' | 'panel';
export type SpinnerTone = 'accent' | 'onAccent' | 'muted';

export interface SpinnerProps {
  size?: SpinnerSize;
  tone?: SpinnerTone;
  /** onAccent: the colour of the control's label (bubble, caps and track). */
  color?: string;
  /** What VoiceOver reads. */
  label?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const MARK_W: Record<SpinnerSize, number> = { row: 20, panel: 36 };

export function Spinner({ size = 'row', tone = 'accent', color, label = 'Loading', style, testID = 'spinner' }: SpinnerProps) {
  return (
    <View testID={testID} style={style} accessible accessibilityRole="progressbar" accessibilityLabel={label}>
      <LevelMark
        size={MARK_W[size]}
        tone={tone}
        color={color}
        revealDelayMs={LOADER.gate.inline.delayMs}
        testID={`${testID}-level`}
      />
    </View>
  );
}

export default Spinner;
