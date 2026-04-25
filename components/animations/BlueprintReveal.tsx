// BlueprintReveal — content "unrolls" into view like a blueprint paper
// being unrolled from the top edge. The reveal is a vertical scale-from-
// top-edge plus a fade, with a thin "tape edge" line that briefly shows
// at the top to suggest the paper being held in place.
//
// Mount this around any new screen body, modal content, or freshly-
// loaded list section to give arrivals a tactile feel without forcing
// users to wait for an explicit "loading → loaded" transition.
//
// One-shot animation: runs on first mount, then stays put. Re-mount to
// replay. Use a `key` change if you want to replay on data updates.
import React, { ReactNode, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors } from '@/constants/colors';

interface BlueprintRevealProps {
  children: ReactNode;
  /** Wrapper style. */
  style?: ViewStyle;
  /** Animation duration in ms. Default 420ms. */
  duration?: number;
  /** Optional delay before unrolling starts. */
  delay?: number;
  /** Hide the top "tape edge" highlight line. */
  hideTape?: boolean;
  /** Color of the tape highlight line. Defaults to Colors.warning. */
  tapeColor?: string;
  testID?: string;
}

export default function BlueprintReveal({
  children,
  style,
  duration = 420,
  delay = 0,
  hideTape = false,
  tapeColor = Colors.warning,
  testID,
}: BlueprintRevealProps) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, duration, delay]);

  const scaleY = progress.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] });
  const opacity = progress;
  const tapeWidth = progress.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0, 1, 0],
  });

  return (
    <View style={[style]} testID={testID}>
      {!hideTape && (
        <View pointerEvents="none" style={styles.tapeTrack}>
          <Animated.View
            style={[
              styles.tape,
              {
                backgroundColor: tapeColor,
                opacity: tapeWidth,
                transform: [{ scaleX: tapeWidth }],
              },
            ]}
          />
        </View>
      )}
      <Animated.View
        // scaleY pivots from center; we offset translateY to feel like it's
        // anchored at the top edge instead.
        style={{ transform: [{ scaleY }, { translateY }], opacity }}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  tapeTrack: {
    height: 2,
    width: '100%',
    overflow: 'hidden',
    alignItems: 'center',
    marginBottom: 2,
  },
  tape: {
    height: 2,
    width: '60%',
    borderRadius: 1,
  },
});
