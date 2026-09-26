// TapeRollNumber — a number that COUNTS to its new value when it changes,
// styled like a tape-measure unrolling. Used for hero stats and money totals.
//
// Mount shows the real value at once. It used to count up from 0 over 900 ms
// on EVERY mount, which was dead time and flashed a fake $0 on the invoice, CO
// and job pages. Now only a change after mount counts, from the number on
// screen to the new one, over at most 480 ms (ease-out cubic, on
// requestAnimationFrame so the Text updates only when its string changes).
// Reduce Motion, a non-finite value, or no requestAnimationFrame (jest): the
// value jumps.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextStyle, View, ViewStyle, Platform } from 'react-native';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { reducedMotion } from '@/components/ui/motion';

// hoist into Motion.duration after round 2
export const COUNT_MS = 420;
// The hard cap on any count, whatever a caller asks for.
// hoist into Motion.duration after round 2
const COUNT_CAP_MS = 480;

type CountState = { text: string; counting: boolean };

/**
 * The shown string for `value`. First render: format(value), no count. A later
 * change counts from the number currently on screen to `value` over
 * min(maxMs, 480) ms. `counting` is true while a count is in flight. At rest
 * the string is format(value), computed fresh every render.
 */
export function useCountToState(
  value: number,
  format: (n: number) => string,
  maxMs: number = COUNT_MS,
): CountState {
  // Mid-count: the string on screen. At rest: null (show format(value)).
  const [countText, setCountText] = useState<string | null>(null);
  // The number currently on screen (mid-count, the interpolated one).
  const shownNum = useRef<number>(value);
  const lastText = useRef<string | null>(null);
  const committed = useRef<number>(value);
  const raf = useRef<number | null>(null);
  const formatRef = useRef(format);
  formatRef.current = format;

  const cancel = () => {
    if (raf.current != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf.current);
    raf.current = null;
  };

  const rest = (n: number) => {
    shownNum.current = n;
    lastText.current = null;
    setCountText(null);
  };

  // A layout effect, so the frame that carries the new value already shows
  // the count's first step (never a flash of the final number, then a roll).
  useLayoutEffect(() => {
    if (Object.is(committed.current, value)) return;
    committed.current = value;
    cancel();
    const from = shownNum.current;
    if (
      reducedMotion() ||
      !Number.isFinite(value) ||
      !Number.isFinite(from) ||
      typeof requestAnimationFrame !== 'function'
    ) {
      rest(value);
      return;
    }
    const ms = Math.max(0, Math.min(maxMs, COUNT_CAP_MS));
    const paint = (n: number) => {
      shownNum.current = n;
      const text = formatRef.current(n);
      // setState only when the string on screen actually changes.
      if (text !== lastText.current) {
        lastText.current = text;
        setCountText(text);
      }
    };
    paint(from);
    let start: number | null = null;
    const step = (now: number) => {
      if (start == null) start = now;
      const t = ms <= 0 ? 1 : Math.min(1, (now - start) / ms);
      if (t >= 1) {
        raf.current = null;
        // The last frame is exactly format(value).
        rest(value);
        return;
      }
      paint(from + (value - from) * (1 - Math.pow(1 - t, 3)));
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    // The format and cap only shape the next count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Unmount: stop the frame loop.
  useEffect(() => cancel, []);

  return countText == null ? { text: format(value), counting: false } : { text: countText, counting: true };
}

/** The shown string for `value` (see useCountToState). */
export function useCountTo(value: number, format: (n: number) => string, maxMs: number = COUNT_MS): string {
  return useCountToState(value, format, maxMs).text;
}

interface TapeRollNumberProps {
  /** The target value. Can be int or float. */
  value: number;
  /** Count duration in ms when the value changes. Default 420, capped at 480. */
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
  /**
   * Ignored. It staggered the old count-from-0 on mount; there is no mount
   * count any more (mount shows the real value), so there is nothing to delay.
   * Kept so existing callers still type-check.
   */
  delay?: number;
}

export default function TapeRollNumber({
  value,
  duration = COUNT_MS,
  formatter,
  decimals = 0,
  prefix = '',
  suffix = '',
  style,
  containerStyle,
  testID,
}: TapeRollNumberProps) {
  const styles = useThemedStyles(makeStyles);
  const fmt = (n: number) =>
    formatter
      ? formatter(n)
      : `${prefix}${n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;
  const { text, counting } = useCountToState(value, fmt, Math.min(duration, COUNT_CAP_MS));

  return (
    <View style={[styles.container, containerStyle]} testID={testID}>
      <Text
        style={counting && Platform.OS === 'web' ? [styles.text, style, webTabular] : [styles.text, style]}
        {...(counting ? { accessibilityLabel: fmt(value) } : {})}
      >
        {text}
      </Text>
    </View>
  );
}

// Web only, and only while counting: digits keep one width so the number does
// not jitter as it rolls. (Native already carries tabular-nums at rest.)
const webTabular: TextStyle = { fontVariant: ['tabular-nums'] as TextStyle['fontVariant'] };

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  text: {
    fontSize: 24,
    fontWeight: '800',
    color: t.text,
    // Tabular figures so digits don't jitter as widths change while counting.
    fontVariant: Platform.OS === 'web' ? undefined : (['tabular-nums'] as TextStyle['fontVariant']),
  },
});
