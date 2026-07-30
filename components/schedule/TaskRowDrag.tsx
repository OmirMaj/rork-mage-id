// components/schedule/TaskRowDrag.tsx — drag-to-reorder for the schedule
// wizard's task list.
//
// Why it's hand-rolled:
//   • the only gesture dep installed is react-native-gesture-handler. There is
//     no reanimated and no draggable-flatlist, and we may not add either — so
//     this is RN's built-in PanResponder + Animated;
//   • it MUST work on React Native Web. PanResponder rides RNW's responder
//     system, which is implemented on top of pointer/mouse events, so one
//     implementation drives a mouse drag on desktop and a finger drag on iOS.
//     (The same reason `GridPane`'s column-resize handle uses PanResponder.)
//
// Ownership split — this is the important bit:
//   This component knows about PIXELS. It never touches the task list. It
//   reports a target INDEX, and the wizard applies it with `moveTask`, which
//   ends in `repairChain`. A drag therefore cannot corrupt dependencies any
//   more than the up/down arrows can — which is the whole point, because a
//   mid-list move used to orphan every successor of the row that moved.
//
// The up/down arrows stay. Drag is ADDITIVE: keyboard and screen-reader users
// keep a first-class path to the same operation.

import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  StyleSheet,
  type GestureResponderHandlers,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Tokens } from '@/constants/designTokens';
import { reorderShiftDirection } from '@/constants/scheduleTemplates';

/** What the consumer spreads onto whatever it wants to be the grab area. */
export interface TaskDragHandle {
  /** Spread onto the handle View: `{...handle.panHandlers}`. */
  panHandlers: GestureResponderHandlers;
  /** True while THIS row is the one being dragged. */
  dragging: boolean;
  /** Web-only cursor + text-selection styling. `null` on native. */
  webStyle: StyleProp<ViewStyle>;
}

export interface TaskRowDragProps {
  index: number;
  /** Row currently under the finger, or null when nothing is being dragged. */
  activeIndex: number | null;
  /** Where the dragged row would land if released right now. */
  targetIndex: number | null;
  /** Laid-out height of the dragged row — how far displaced rows slide. */
  activeHeight: number;
  /** Vertical gap between rows in the list container. */
  gap: number;
  /** Report this row's laid-out height so the drop math uses real geometry. */
  onMeasure: (index: number, height: number) => void;
  /** Finger down on the handle. */
  onGrab: (index: number) => void;
  /** Finger moved `dy` px from where it grabbed. */
  onDrag: (dy: number) => void;
  /** Finger lifted (or the gesture was terminated — treat both as a drop). */
  onDrop: () => void;
  children: (handle: TaskDragHandle) => React.ReactNode;
}

// Mouse cursor + selection suppression. Without `userSelect: none` a web drag
// selects the task names it passes over and leaves the page highlighted.
const WEB_GRAB = Platform.OS === 'web'
  ? ({ cursor: 'grab', userSelect: 'none' } as unknown as ViewStyle)
  : null;
const WEB_GRABBING = Platform.OS === 'web'
  ? ({ cursor: 'grabbing', userSelect: 'none' } as unknown as ViewStyle)
  : null;

export default function TaskRowDrag(props: TaskRowDragProps) {
  const {
    index, activeIndex, targetIndex, activeHeight, gap,
    onMeasure, onGrab, onDrag, onDrop, children,
  } = props;

  const dragging = activeIndex === index;
  const translate = useRef(new Animated.Value(0)).current;

  // Latest callbacks + index behind a ref. PanResponder.create is memoised
  // once, but this row re-renders on every keystroke in the task-name field —
  // a captured closure would report a stale index halfway through a drag.
  const latest = useRef({ index, onGrab, onDrag, onDrop });
  latest.current = { index, onGrab, onDrag, onDrop };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    // The task list lives inside a vertical ScrollView. Without refusing the
    // termination request the ScrollView reclaims the gesture on the first
    // move and the row stops following the finger mid-drag.
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: () => {
      translate.setValue(0);
      latest.current.onGrab(latest.current.index);
      if (Platform.OS !== 'web') {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    },
    onPanResponderMove: (_evt, gesture) => {
      translate.setValue(gesture.dy);
      latest.current.onDrag(gesture.dy);
    },
    onPanResponderRelease: () => {
      translate.setValue(0);
      latest.current.onDrop();
    },
    // A terminated gesture (app backgrounded, parent stole it) must still
    // settle the list rather than leaving a row visually floating.
    onPanResponderTerminate: () => {
      translate.setValue(0);
      latest.current.onDrop();
    },
  }), [translate]);

  // Preview: rows between the grabbed row and its target slide out of the way
  // by exactly one dragged-row height.
  const shift = (activeIndex === null || targetIndex === null || dragging)
    ? 0
    : reorderShiftDirection(index, activeIndex, targetIndex) * (activeHeight + gap);

  useEffect(() => {
    if (dragging) return; // the dragged row is driven by the finger
    if (activeIndex === null) {
      // Drop just committed: the list has already re-ordered, so animating a
      // leftover offset back to zero would slide every row in from the wrong
      // place. Snap instead.
      translate.setValue(0);
      return;
    }
    Animated.timing(translate, {
      toValue: shift,
      duration: Tokens.motion.duration.micro,
      easing: Easing.out(Easing.quad),
      // JS driver on purpose: identical timing on web and native, and this
      // value is also written imperatively by the gesture above.
      useNativeDriver: false,
    }).start();
  }, [shift, dragging, activeIndex, translate]);

  const handleLayout = (e: LayoutChangeEvent) => {
    onMeasure(index, e.nativeEvent.layout.height);
  };

  return (
    <Animated.View
      onLayout={handleLayout}
      style={[
        { transform: [{ translateY: translate }] },
        dragging && styles.lifted,
      ]}
    >
      {children({
        panHandlers: responder.panHandlers,
        dragging,
        webStyle: dragging ? WEB_GRABBING : WEB_GRAB,
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  lifted: {
    // zIndex is honoured between siblings, so the lifted row paints over its
    // neighbours instead of sliding under them.
    zIndex: 20,
    ...Tokens.shadow.heavy,
  },
});
