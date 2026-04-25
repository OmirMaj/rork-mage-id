// SawCutReveal — collapsible content with a construction-themed reveal.
//
// When the section opens, a thin "saw blade" line scoots across the top
// edge from left to right (with three little sawdust particles trailing
// behind), and at the same time the content slides down with a fade-in.
// On collapse, the content slides up and out, and the blade retreats
// the other way.
//
// The blade is a simple animated line + 3 dot particles — no SVG, no
// dependencies beyond RN Animated. Visual signature is what matters; we
// keep the chrome small so it doesn't compete with the content itself.
//
// Use this anywhere you'd reach for a plain `if (expanded) <View/>`. The
// max-height-on-mount approach means we don't need to measure children;
// content can reflow naturally and the container animates with it.
import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors } from '@/constants/colors';

interface SawCutRevealProps {
  /** When true, content is expanded. */
  open: boolean;
  /** Content to reveal. */
  children: ReactNode;
  /** Wrapper style. */
  style?: ViewStyle;
  /** Animation duration in ms. Default 280ms. */
  duration?: number;
  /** Hide the saw blade animation, only animate the content. Default false. */
  hideBlade?: boolean;
  /** Color of the saw blade line. Defaults to Colors.warning (orange). */
  bladeColor?: string;
  testID?: string;
}

export default function SawCutReveal({
  open,
  children,
  style,
  duration = 280,
  hideBlade = false,
  bladeColor = Colors.warning,
  testID,
}: SawCutRevealProps) {
  // Single 0→1 progress value drives everything. open=1, closed=0.
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  // mounted state — drives unmount AFTER collapse anim finishes. The
  // previous version checked progress.__getValue() at render time, which
  // never re-fired once React stopped re-rendering, so the view stayed
  // mounted at opacity 0 forever — leaving phantom layout space.
  const [mounted, setMounted] = useState<boolean>(open);

  useEffect(() => {
    if (open) {
      // Mount immediately on open; opening animation handles the visual.
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    } else {
      // Run collapse first, THEN unmount via setMounted(false). Without
      // this, the body would unmount instantly and we'd lose the animation.
      Animated.timing(progress, {
        toValue: 0,
        duration,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }).start(({ finished }) => {
        // Only unmount if the animation actually finished — guards against
        // race where open flipped back to true mid-collapse.
        if (finished) setMounted(false);
      });
    }
  }, [open, duration, progress]);

  const opacity = progress;
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] });
  // The saw blade slides in from -100% to +110% horizontally.
  const bladeX = progress.interpolate({ inputRange: [0, 1], outputRange: ['-100%', '110%'] });
  // Sawdust particles fade in around the middle of the open animation.
  const dustOpacity = progress.interpolate({
    inputRange: [0, 0.4, 0.7, 1],
    outputRange: [0, 0.7, 0.7, 0],
  });

  // Once collapse animation completes, mounted goes false and we render
  // null — no phantom height, no orphan animated view.
  if (!mounted) return null;

  return (
    <View style={[styles.wrap, style]} testID={testID}>
      {!hideBlade && (
        <View pointerEvents="none" style={styles.bladeTrack}>
          <Animated.View
            style={[
              styles.blade,
              { backgroundColor: bladeColor, opacity, left: bladeX as unknown as number },
            ]}
          />
          {/* Three sawdust particles staggered behind the blade. */}
          {[0, 1, 2].map(i => (
            <Animated.View
              key={i}
              style={[
                styles.dust,
                {
                  backgroundColor: bladeColor,
                  opacity: dustOpacity,
                  left: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [`${-10 + i * 4}%`, `${100 + i * 4}%`],
                  }) as unknown as number,
                  top: 4 + i * 2,
                },
              ]}
            />
          ))}
        </View>
      )}
      <Animated.View style={{ opacity, transform: [{ translateY }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
  },
  bladeTrack: {
    height: 2,
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 4,
  },
  blade: {
    position: 'absolute',
    top: 0,
    width: '40%',
    height: 2,
    borderRadius: 1,
  },
  dust: {
    position: 'absolute',
    width: 3,
    height: 3,
    borderRadius: 1.5,
  },
});
