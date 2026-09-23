// ActionBar — the sticky Save / Send / Next bar, sized for a desktop.
//
// WHY. Every screen hand-rolls its bottom bar as a row of `flex: 1` buttons.
// On a phone that is right: two thumb-sized halves. On a 1512 px MacBook the
// same row made schedule-wizard's "Next" about 2,024 px wide and put
// schedule-review's CTA under a 760 px column at 1,780 px — the buttons lined
// up with the window edge, not with the form they submit.
//
// Usage — the screen keeps its own bar chrome (surface fill, hairline,
// absolute/in-flow position, safe-area padding) on `style`:
//
//     <ActionBar style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]} width="form">
//       <ActionBarReadout><Text>Total $12,400</Text></ActionBarReadout>
//       <Button label="Save draft" variant="secondary" … />
//       <Button label="Send" … />            ← primary goes LAST (rightmost)
//     </ActionBar>
//
// PHONE: renders `<View style={style}>{children}</View>` — the same element
// tree and the same styles the screen renders today; children keep flex:1.
//
// DESKTOP: the children move into an inner row capped at Layout.page[width]
// and centred, so the buttons end where the form above them ends, and each
// child gets a hugging button box appended (cloneElement). Children are NOT
// reordered: the caller decides which is primary and puts it last, because
// reordering would also reorder keyboard focus.

import React, { createContext, useContext } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Layout } from '@/constants/designTokens';
import { flattenElements, useIsDesktop } from './desktop';

/** True inside a desktop ActionBar. Button reads it: fullWidth is ignored and
 *  the button takes the bar's size. Always false on a phone. */
export const ActionBarContext = createContext<boolean>(false);
export function useInActionBar(): boolean {
  return useContext(ActionBarContext);
}

/** The box every non-readout child gets on desktop. flexGrow/Shrink/Basis are
 *  longhands on purpose: they override a child's own `flex: 1` shorthand. */
export const actionBarChildDesktop: ViewStyle = {
  flexGrow: 0,
  flexShrink: 0,
  flexBasis: 'auto',
  minWidth: Layout.button.minWidth.lg,
  maxWidth: Layout.button.maxWidth,
  height: Layout.control.md,
  paddingHorizontal: 20,
};

const innerRowDesktop: ViewStyle = {
  width: '100%',
  alignSelf: 'center',
  flexDirection: 'row',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: 12,
};

const readoutDesktop: ViewStyle = { flex: 1, minWidth: 0 };

export type ActionBarWidth = keyof typeof Layout.page;

export interface ActionBarProps {
  /** The screen's own bar chrome. Unchanged on every platform. */
  style?: StyleProp<ViewStyle>;
  /** Which page column the buttons line up with on desktop. Default 'form'. */
  width?: ActionBarWidth;
  children?: React.ReactNode;
  testID?: string;
  onLayout?: React.ComponentProps<typeof View>['onLayout'];
}

/** Marks a total / status readout. On desktop it sits on the left and takes
 *  the free space; on a phone it adds nothing to the tree unless given a style. */
export function ActionBarReadout({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const isDesktop = useIsDesktop();
  if (isDesktop) return <View style={[style, readoutDesktop]}>{children}</View>;
  if (style) return <View style={style}>{children}</View>;
  return <>{children}</>;
}

export function ActionBar({ style, width = 'form', children, testID, onLayout }: ActionBarProps) {
  const isDesktop = useIsDesktop();

  if (!isDesktop) {
    return (
      <View style={style} testID={testID} onLayout={onLayout}>
        {children}
      </View>
    );
  }

  const kids = flattenElements(children).map((child) => {
    if (!React.isValidElement(child)) return child;
    if (child.type === ActionBarReadout) return child;
    const props = child.props as { style?: StyleProp<ViewStyle> };
    return React.cloneElement(child as React.ReactElement<{ style?: StyleProp<ViewStyle> }>, {
      style: [props.style, actionBarChildDesktop],
    });
  });

  return (
    <View style={style} testID={testID} onLayout={onLayout}>
      <View style={[innerRowDesktop, { maxWidth: Layout.page[width] }]}>
        <ActionBarContext.Provider value>{kids}</ActionBarContext.Provider>
      </View>
    </View>
  );
}

export default ActionBar;
