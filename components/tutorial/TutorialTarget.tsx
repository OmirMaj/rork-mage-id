// components/tutorial/TutorialTarget.tsx — marks a REAL control the coach can
// spotlight.
//
//   <TutorialTarget id="punch.save" style={styles.saveWrap}>
//     <TouchableOpacity testID="walk-save" …/>
//   </TutorialTarget>
//
// WHY A WRAPPER AND NOT REF-FORWARDING. The @/components/ui Button is a plain
// function component with no forwardRef, and half the targets are ad-hoc
// TouchableOpacity rows; a wrapper View measures any of them the same way.
// The cost: the wrapper is a real View in the layout, so the child's own
// LAYOUT styles (flex, width, the desktop sectionTileDesktop) belong on the
// wrapper's `style` — tsc cannot see that drift, the simulator can.
//
// WHAT IT DOES. A collapsable={false} View (so it is a real native node that
// measureInWindow can find) whose ref registers {id → node} in the store's
// module Map. Registering causes zero re-renders; it emits a TARGET event only
// while a run is live. The coach draws an EMPTY hole over it, so the real
// control gets the real touch — nothing is forwarded or faked.
//
// A touch inside it hides the hand for 4 s (he is already doing it).
//
// CHILDLESS = a BLOCKER SENTINEL (registry BLOCKER_TARGETS). A screen renders
// <TutorialTarget id="invoice.modalUp" /> while one of its layer-less modals
// is up; on iOS those draw above the root tutorial layer, so its mount tells
// the coach to draw nothing. It is zero-size, never hit-tested, hidden from
// accessibility, and never measured.

import React, { useCallback, useRef } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { TargetId } from '@/utils/tutorial/types';
import {
  noteTutorialTargetTouch,
  registerTutorialTarget,
  unregisterTutorialTarget,
  type MeasurableNode,
} from '@/utils/tutorial/store';
import { useTutorialScrollAnchor } from './TutorialScrollAnchor';

export interface TutorialTargetProps {
  id: TargetId;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  testID?: string;
  onLayout?: React.ComponentProps<typeof View>['onLayout'];
}

export function TutorialTarget({ id, style, children, testID, onLayout }: TutorialTargetProps) {
  const token = useRef<object>({}).current;
  const anchor = useTutorialScrollAnchor();
  const lastId = useRef<TargetId | null>(null);

  // A callback ref runs with the node on mount and null on unmount (and again
  // when id changes), which is exactly the register / unregister pair.
  const setRef = useCallback(
    (node: View | null) => {
      if (lastId.current && (node === null || lastId.current !== id)) {
        unregisterTutorialTarget(lastId.current, token);
        lastId.current = null;
      }
      if (node) {
        registerTutorialTarget(id, token, node as MeasurableNode, anchor);
        lastId.current = id;
      }
    },
    [id, token, anchor],
  );

  const onTouch = useCallback(() => noteTutorialTargetTouch(id), [id]);

  const hasChildren = React.Children.count(children) > 0;
  if (!hasChildren) {
    return (
      <View
        ref={setRef}
        collapsable={false}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.sentinel}
        testID={testID ?? `tutorial-target-${id}`}
      />
    );
  }

  return (
    <View
      ref={setRef}
      collapsable={false}
      style={style}
      testID={testID}
      onLayout={onLayout}
      onTouchStart={onTouch}
      // A mouse click on web never fires touchstart.
      onPointerDown={Platform.OS === 'web' ? onTouch : undefined}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  sentinel: { position: 'absolute', width: 0, height: 0, opacity: 0 },
});

export default TutorialTarget;
