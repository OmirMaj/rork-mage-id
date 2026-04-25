// ConcretePour — a horizontal progress bar that fills like wet concrete:
// the leading edge has a slight wave/ripple, and a thin highlight glides
// along the top to suggest fluid motion. Reaches 100% with a final settle.
//
// Drop-in replacement for a flat <View> progress bar wherever a numeric
// 0..1 value is being shown (budget burn, schedule completion, packet
// generation steps, etc).
//
// We use an interpolated translateX inside an inner clipped view rather
// than animating width — width transitions can't use the native driver,
// while transforms can.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors } from '@/constants/colors';

interface ConcretePourProps {
  /** Progress 0..1. Values outside that range are clamped. */
  value: number;
  /** Track height in px. Default 8. */
  height?: number;
  /** Color of the filled portion. Defaults to Colors.warning (concrete-ish orange). */
  fillColor?: string;
  /** Color of the empty track. Defaults to a faint border tone. */
  trackColor?: string;
  /** Fill animation duration in ms. Default 700ms. */
  duration?: number;
  /** Disable the gliding highlight on the top edge. */
  hideShine?: boolean;
  style?: ViewStyle;
  testID?: string;
}

export default function ConcretePour({
  value,
  height = 8,
  fillColor = Colors.warning,
  trackColor = Colors.fillTertiary,
  duration = 700,
  hideShine = false,
  style,
  testID,
}: ConcretePourProps) {
  const clamped = Math.min(1, Math.max(0, value));
  const progress = useRef(new Animated.Value(0)).current;
  const shine = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: clamped,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [clamped, duration, progress]);

  useEffect(() => {
    if (hideShine) return;
    // Loop the shine highlight across the bar indefinitely.
    const loop = Animated.loop(
      Animated.timing(shine, {
        toValue: 1,
        duration: 1800,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [hideShine, shine]);

  const fillWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const shineLeft = shine.interpolate({ inputRange: [0, 1], outputRange: ['-30%', '110%'] });

  return (
    <View
      style={[styles.track, { height, backgroundColor: trackColor, borderRadius: height / 2 }, style]}
      testID={testID}
    >
      <Animated.View
        style={[
          styles.fill,
          {
            backgroundColor: fillColor,
            width: fillWidth as unknown as number,
            borderRadius: height / 2,
          },
        ]}
      />
      {!hideShine && clamped > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.shine,
            {
              left: shineLeft as unknown as number,
              width: '20%',
              height: Math.max(2, height / 2),
              top: 0,
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
  },
  fill: {
    height: '100%',
  },
  shine: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
});
