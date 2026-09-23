// ChipRail — a horizontal rail of chips that a mouse can actually reach.
//
// WHY. A mouse wheel does not move a horizontal ScrollView, and 115 rails in
// the app hide their scrollbar (`showsHorizontalScrollIndicator={false}`). On
// a desktop the chips past the right edge are unreachable and nothing shows
// they exist — the /rfi "horizontal overflow" the layout probe reported is
// exactly this (the sub-picker rail at rfi.tsx:1279).
//
// Usage — drop-in for the hand-rolled rail; the phone keeps its ScrollView:
//
//     <ChipRail contentContainerStyle={styles.chipRow}>
//       {chips.map(c => <Chip key={c.id} style={[styles.chip, isDesktop && chipDesktop]} … />)}
//     </ChipRail>
//
// PHONE: `<ScrollView horizontal showsHorizontalScrollIndicator={false}
//         style={style} contentContainerStyle={contentContainerStyle}>` —
//         the rail as every screen hand-rolls it today.
// DESKTOP, mode 'wrap' (default): a wrapping row — the caller's padding kept,
//         gap 8 both ways — so every chip is visible and clickable.
// DESKTOP, mode 'scroll': for REAL horizontal canvases (the leads pipeline
//         columns, a Gantt) that must stay one line: the ScrollView stays, but
//         the scrollbar shows on web so the overflow is discoverable.
//
// A rail that can grow without bound (project switchers, 12+ phases) should be
// a switcher button + menu, not a wrap that eats the page — see
// FilterChipRow's desktopMaxChips fold for the pattern.

import React from 'react';
import { Platform, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { Layout } from '@/constants/designTokens';
import { useIsDesktop } from './desktop';

/** A chip on desktop: content-sized, one line, never wider than 240. Zero
 *  vertical padding because the fixed height already centres the label. */
export const chipDesktop: ViewStyle = {
  height: Layout.chip.height,
  maxWidth: Layout.chip.maxWidth,
  paddingVertical: 0,
  flexShrink: 0,
};

/** The wrap keys a desktop rail adds on top of the caller's row style. */
export const chipRailDesktop: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  rowGap: 8,
};

export interface ChipRailProps {
  children?: React.ReactNode;
  /** The ScrollView's own style (phone). Kept on the desktop row too. */
  style?: StyleProp<ViewStyle>;
  /** The row style (padding, gap). Phone: contentContainerStyle. Desktop: the wrap row. */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Desktop behaviour: 'wrap' (default) or 'scroll' for a true canvas. */
  mode?: 'wrap' | 'scroll';
  testID?: string;
}

export function ChipRail({ children, style, contentContainerStyle, mode = 'wrap', testID }: ChipRailProps) {
  const isDesktop = useIsDesktop();

  if (isDesktop && mode === 'wrap') {
    return (
      <View style={[style, contentContainerStyle, chipRailDesktop]} testID={testID}>
        {children}
      </View>
    );
  }

  // Only the props the caller gave, so the phone element is exactly the
  // hand-rolled `<ScrollView horizontal showsHorizontalScrollIndicator={false}
  // contentContainerStyle={…}>` it replaces — no extra undefined props.
  const passthrough: { style?: StyleProp<ViewStyle>; contentContainerStyle?: StyleProp<ViewStyle>; testID?: string } = {};
  if (style !== undefined) passthrough.style = style;
  if (contentContainerStyle !== undefined) passthrough.contentContainerStyle = contentContainerStyle;
  if (testID !== undefined) passthrough.testID = testID;
  return (
    <ScrollView
      horizontal
      // A true canvas on desktop web shows its scrollbar: a hidden one is the
      // bug. The phone keeps today's hidden indicator.
      showsHorizontalScrollIndicator={isDesktop && Platform.OS === 'web'}
      {...passthrough}
    >
      {children}
    </ScrollView>
  );
}

export default ChipRail;
