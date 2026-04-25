// TapeRollNumber — animates a number counting up from 0 to its target value,
// styled like a tape-measure unrolling. Used for hero stats so big numbers
// feel earned rather than just slapped on the screen.
//
// Built on the RN Animated API (no Reanimated) so it runs identically on
// iOS / Android / web. The driver is JS (we read .__getValue inside a
// listener) — that's fine for a 1s, one-shot animation on a single Text
// node. If you ever batch-mount 50 of these, switch to native driver and
// derived values.
//
// Reset behavior: when the `value` prop changes, the count restarts from
// the previous displayed value (not from 0) so updates feel like a meter
// re-clicking rather than a fresh roll.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TextStyle, View, ViewStyle, Platform } from 'react-native';
import { Colors } from '@/constants/colors';

interface TapeRollNumberProps {
  /** The target value to count to. Can be int or float. */
  value: number;
  /** Animation duration in ms. Default 900ms — tuned to feel snappy without rushing. */
  duration?: number;
  /** Format the displayed value (e.g. money formatter). Defaults to integer with locale. */
  formatter?: (n: number) => string;
  /** Decimal places when no formatter is given. */
  decimals?: number;
  /** Optional prefix (e.g. '$') and suffix (e.g. '%'). Ignored when `formatter` is set. */
  prefix?: string;
  suffix?: string;
  /** Text style — color, size, weight, etc. */
  style?: TextStyle;
  /** Wrapper style for the container (rarely needed). */
  containerStyle?: ViewStyle;
  /** TestID for e2e. */
  testID?: string;
  /** Optional delay before starting the count (ms). Useful to stagger multiple stats. */
  delay?: number;
}

export default function TapeRollNumber({
  value,
  duration = 900,
  formatter,
  decimals = 0,
  prefix = '',
  suffix = '',
  style,
  containerStyle,
  testID,
  delay = 0,
}: TapeRollNumberProps) {
  const anim = useRef(new Animated.Value(0)).current;
  const lastValue = useRef<number>(0);
  const [displayed, setDisplayed] = useState<number>(0);

  useEffect(() => {
    const from = lastValue.current;
    anim.setValue(from);
    const listener = anim.addListener(({ value: v }) => setDisplayed(v));
    Animated.timing(anim, {
      toValue: value,
      duration,
      delay,
      // JS driver because we're reading the value out via listener.
      useNativeDriver: false,
    }).start();
    lastValue.current = value;
    return () => {
      anim.removeListener(listener);
    };
  }, [value, duration, delay, anim]);

  const formatted = formatter
    ? formatter(displayed)
    : `${prefix}${displayed.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;

  return (
    <View style={[styles.container, containerStyle]} testID={testID}>
      <Text style={[styles.text, style]}>{formatted}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  text: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
    // Tabular figures so digits don't jitter as widths change while counting.
    fontVariant: Platform.OS === 'web' ? undefined : (['tabular-nums'] as TextStyle['fontVariant']),
  },
});
