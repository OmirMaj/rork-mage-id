// TileGrid — equal-width tile and card grids that know how wide they are.
//
// WHY. The app draws its tile grids two ways, and both break on a desktop:
//   1. 26 percent-width literals (`width: '47%'`, `'100%'`) written for a
//      390 pt phone: on a 1,280 px column a "half" tile is 600 px of air.
//   2. 15 ad-hoc desktop tile styles that use flexGrow, so a last-row ORPHAN
//      stretches across the whole row — the Forecast tile on the WIP report
//      rendered three columns wide under a row of three.
// Column counts must come from the container's own measured width, never the
// window's: the same grid sits in a 1,280 dashboard and in a 440 side panel.
//
// Usage:
//     <TileGrid preset="action" phoneStyle={styles.quickActions}>
//       {actions.map(a => <Tile key={a.id} style={styles.quickActionBtn} … />)}
//     </TileGrid>
//
// PHONE: `<View style={phoneStyle}>{children}</View>` — today's tree; tiles keep
// their 47% / 100% styles.
// DESKTOP: measures its own width W (onLayout; the first paint uses the
// preset's minimum), computes cols/width with tileGridColumns() and appends
// `{width, flexGrow:0, flexShrink:0, flexBasis:'auto'}` to every child. Rows
// wrap with rowGap = gap; tiles in one row share a height (alignItems stretch
// per wrapped line). Nothing grows, so an orphan keeps the column width.

import React, { useCallback, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Layout } from '@/constants/designTokens';
import { flattenElements, tileGridColumns, useIsDesktop, type TilePreset } from './desktop';

export type { TilePreset } from './desktop';

export interface TileGridProps {
  preset: TilePreset;
  /** The grid's phone style — rendered unchanged on a phone. Its padding is
   *  honoured on desktop (the columns are computed inside it). */
  phoneStyle?: StyleProp<ViewStyle>;
  /** Extra desktop-only container style (margins, etc.). Ignored on a phone. */
  desktopStyle?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  testID?: string;
}

/** Horizontal padding + border of a flattened container style, so the columns
 *  are computed on the CONTENT box onLayout does not report. */
function horizontalInset(style: StyleProp<ViewStyle>): number {
  const f = (StyleSheet.flatten(style) ?? {}) as ViewStyle;
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);
  const left = num(f.paddingLeft ?? f.paddingStart ?? f.paddingHorizontal ?? f.padding)
    + num(f.borderLeftWidth ?? f.borderWidth);
  const right = num(f.paddingRight ?? f.paddingEnd ?? f.paddingHorizontal ?? f.padding)
    + num(f.borderRightWidth ?? f.borderWidth);
  return left + right;
}

export function TileGrid({ preset, phoneStyle, desktopStyle, children, testID }: TileGridProps) {
  const isDesktop = useIsDesktop();
  const [outer, setOuter] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    setOuter((prev) => (prev === w ? prev : w));
  }, []);

  if (!isDesktop) {
    return (
      <View style={phoneStyle} testID={testID}>
        {children}
      </View>
    );
  }

  const spec = Layout.tile[preset];
  const W = outer > 0 ? Math.max(0, outer - horizontalInset([phoneStyle, desktopStyle])) : 0;
  const { width } = tileGridColumns(W, spec);
  const tile: ViewStyle = {
    width,
    // A tile's own percent min/max width would fight the computed column.
    minWidth: 0,
    maxWidth: width,
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
  };
  const kids = flattenElements(children).map((child) => {
    if (!React.isValidElement(child)) return child;
    const props = child.props as { style?: StyleProp<ViewStyle> };
    return React.cloneElement(child as React.ReactElement<{ style?: StyleProp<ViewStyle> }>, {
      style: [props.style, tile],
    });
  });

  return (
    <View
      style={[
        phoneStyle,
        {
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
          columnGap: spec.gap,
          rowGap: spec.gap,
        },
        desktopStyle,
      ]}
      onLayout={onLayout}
      testID={testID}
    >
      {kids}
    </View>
  );
}

export default TileGrid;
