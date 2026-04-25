// CashFlowChart — animated bar+line chart for the cash flow forecast.
//
// Design goals:
//  • Bars GROW from the zero line on first render (550ms staggered) —
//    feels alive, premium. Construction-themed: bars rise like building
//    floors going up, not just a static utilitarian column.
//  • Balance line DRAWS IN segment-by-segment so the trend reads as a
//    story rather than instantly appearing. Trailing dot pulses softly.
//  • Bars use a subtle gradient (bright at top, dim at base) via two
//    stacked Views — gives depth without depending on linear-gradient
//    libs that ship native deps.
//  • Selected week gets a soft accent ring + frosted background so taps
//    feel deliberate.
//  • Y-axis labels are right-aligned in a fixed gutter so values don't
//    push the chart sideways.
//
// Re-runs the animation when the `weeks` array length changes (e.g. user
// switches forecast horizon from 4w to 12w). Stable when only data
// values change.
import React, { useMemo, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Easing,
} from 'react-native';
import { Colors } from '@/constants/colors';
import type { CashFlowWeek } from '@/utils/cashFlowEngine';
import { formatCurrencyShort } from '@/utils/cashFlowEngine';

interface CashFlowChartProps {
  weeks: CashFlowWeek[];
  onWeekPress?: (weekIndex: number) => void;
  selectedWeek?: number | null;
}

const BAR_WIDTH = 48;
const BAR_GAP = 10;
const CHART_HEIGHT = 220;
const LABEL_HEIGHT = 30;
const Y_GUTTER = 56;

const CashFlowChart = React.memo(function CashFlowChart({
  weeks,
  onWeekPress,
  selectedWeek,
}: CashFlowChartProps) {
  const scrollRef = useRef<ScrollView>(null);

  // One Animated.Value per bar — grows from 0 to 1 on mount/data-change.
  // We key it on the week count so switching horizons re-triggers the
  // animation cleanly without leaking refs.
  const animKey = `${weeks.length}`;
  const barAnims = useRef<{ key: string; values: Animated.Value[] }>({ key: '', values: [] });
  if (barAnims.current.key !== animKey) {
    barAnims.current = {
      key: animKey,
      values: weeks.map(() => new Animated.Value(0)),
    };
  }

  // Line-drawing animation — single value 0..1 that interpolates how far
  // the balance polyline has been "drawn". Each segment uses its index
  // ratio to decide if it's visible yet.
  const lineProgress = useRef(new Animated.Value(0));
  // Pulsing dot at the trailing edge of the line.
  const pulseAnim = useRef(new Animated.Value(0));

  useEffect(() => {
    // Stagger bars from left to right, then draw the line on top.
    const barSequence = Animated.stagger(
      40,
      barAnims.current.values.map(v =>
        Animated.timing(v, {
          toValue: 1,
          duration: 480,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
      ),
    );
    const linePath = Animated.timing(lineProgress.current, {
      toValue: 1,
      duration: 800,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    });
    Animated.sequence([barSequence, linePath]).start();

    // Continuous soft pulse on the trailing-edge dot.
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim.current, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(pulseAnim.current, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    ).start();
  }, [animKey]);

  const { maxAbsNet, maxAbsBalance, balancePoints } = useMemo(() => {
    let maxNet = 0;
    let maxBal = 0;
    weeks.forEach(w => {
      maxNet = Math.max(maxNet, Math.abs(w.netCashFlow));
      maxBal = Math.max(maxBal, Math.abs(w.runningBalance));
    });
    if (maxNet === 0) maxNet = 1;
    if (maxBal === 0) maxBal = 1;

    const points = weeks.map((w, i) => {
      const normalized = (w.runningBalance + maxBal) / (2 * maxBal);
      const y = CHART_HEIGHT - (normalized * (CHART_HEIGHT - 24)) - 12;
      const x = i * (BAR_WIDTH + BAR_GAP) + BAR_WIDTH / 2;
      return { x, y, balance: w.runningBalance };
    });

    return { maxAbsNet: maxNet, maxAbsBalance: maxBal, balancePoints: points };
  }, [weeks]);

  const handleWeekPress = useCallback((index: number) => {
    onWeekPress?.(index);
  }, [onWeekPress]);

  const totalWidth = weeks.length * (BAR_WIDTH + BAR_GAP) + 16;
  const midY = CHART_HEIGHT / 2;

  return (
    <View style={styles.container}>
      <View style={styles.yAxisLabels} pointerEvents="none">
        <Text style={styles.yLabelTop}>+{formatCurrencyShort(maxAbsNet)}</Text>
        <Text style={styles.yLabelMid}>$0</Text>
        <Text style={styles.yLabelBot}>-{formatCurrencyShort(maxAbsNet)}</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ width: Math.max(totalWidth, 300), paddingLeft: Y_GUTTER, paddingRight: 16 }}
      >
        <View style={{ height: CHART_HEIGHT + LABEL_HEIGHT }}>
          {/* Subtle grid + zero line */}
          <View style={[styles.gridLine, { top: midY * 0.33 }]} />
          <View style={[styles.gridLine, { top: midY * 0.66 }]} />
          <View style={[styles.zeroLine, { top: midY }]} />
          <View style={[styles.gridLine, { top: midY * 1.33 }]} />
          <View style={[styles.gridLine, { top: midY * 1.66 }]} />

          {/* Animated balance polyline — each segment fades in as the
              line-drawing progress passes its ratio. */}
          {balancePoints.length > 1 && (
            <Animated.View style={StyleSheet.absoluteFill} pointerEvents="none">
              {balancePoints.map((pt, i) => {
                if (i === 0) return null;
                const prev = balancePoints[i - 1];
                const dx = pt.x - prev.x;
                const dy = pt.y - prev.y;
                const length = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                const ratio = i / (balancePoints.length - 1);
                const segOpacity = lineProgress.current.interpolate({
                  inputRange: [Math.max(0, ratio - 0.05), ratio],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                });
                return (
                  <Animated.View
                    key={`line-${i}`}
                    style={{
                      position: 'absolute',
                      left: prev.x,
                      top: prev.y,
                      width: length,
                      height: 2.5,
                      backgroundColor: pt.balance < 0 || prev.balance < 0 ? Colors.error : Colors.info,
                      transform: [{ rotate: `${angle}deg` }],
                      transformOrigin: 'left center',
                      opacity: segOpacity,
                      borderRadius: 1.25,
                    }}
                  />
                );
              })}
              {balancePoints.map((pt, i) => {
                const ratio = balancePoints.length > 1 ? i / (balancePoints.length - 1) : 0;
                const dotOpacity = lineProgress.current.interpolate({
                  inputRange: [Math.max(0, ratio - 0.02), ratio],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                });
                const isLast = i === balancePoints.length - 1;
                const pulseScale = isLast ? pulseAnim.current.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.6],
                }) : 1;
                const pulseOpacity = isLast ? pulseAnim.current.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.55, 0],
                }) : 0;
                return (
                  <React.Fragment key={`dot-${i}`}>
                    {isLast && (
                      <Animated.View
                        style={{
                          position: 'absolute',
                          left: pt.x - 8,
                          top: pt.y - 8,
                          width: 16,
                          height: 16,
                          borderRadius: 8,
                          backgroundColor: pt.balance < 0 ? Colors.error : Colors.info,
                          opacity: pulseOpacity,
                          transform: [{ scale: pulseScale }],
                        }}
                      />
                    )}
                    <Animated.View
                      style={{
                        position: 'absolute',
                        left: pt.x - 4,
                        top: pt.y - 4,
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: pt.balance < 0 ? Colors.error : Colors.info,
                        borderWidth: 2,
                        borderColor: Colors.surface,
                        opacity: dotOpacity,
                      }}
                    />
                  </React.Fragment>
                );
              })}
            </Animated.View>
          )}

          {/* Bars */}
          <View style={styles.barsContainer}>
            {weeks.map((week, i) => {
              const isPositive = week.netCashFlow >= 0;
              const barHeight = maxAbsNet > 0
                ? (Math.abs(week.netCashFlow) / maxAbsNet) * (CHART_HEIGHT / 2 - 12)
                : 0;
              const isSelected = selectedWeek === i;
              const isDanger = week.runningBalance < 0;
              const anim = barAnims.current.values[i] ?? new Animated.Value(1);
              const animatedHeight = anim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, Math.max(barHeight, 2)],
              });
              const barColor = isDanger
                ? (isPositive ? Colors.warning : Colors.error)
                : (isPositive ? Colors.success : Colors.error);
              const barColorTop = isDanger
                ? (isPositive ? '#FFB74D' : '#FF6B6B')
                : (isPositive ? '#34D77A' : '#FF6B6B');

              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.barColumn, isSelected && styles.barColumnSelected]}
                  onPress={() => handleWeekPress(i)}
                  activeOpacity={0.75}
                >
                  <View style={{ height: CHART_HEIGHT, justifyContent: 'center' }}>
                    {isPositive ? (
                      <View style={{ alignItems: 'center', justifyContent: 'flex-end', height: CHART_HEIGHT / 2 - 6 }}>
                        <Animated.View
                          style={[
                            styles.bar,
                            {
                              height: animatedHeight,
                              backgroundColor: barColor,
                            },
                          ]}
                        >
                          {/* Top gradient highlight — bright cap */}
                          <View style={[styles.barHighlight, { backgroundColor: barColorTop }]} />
                        </Animated.View>
                      </View>
                    ) : (
                      <>
                        <View style={{ height: CHART_HEIGHT / 2 - 6 }} />
                        <View style={{ alignItems: 'center', height: CHART_HEIGHT / 2 - 6 }}>
                          <Animated.View
                            style={[
                              styles.barNeg,
                              {
                                height: animatedHeight,
                                backgroundColor: barColor,
                              },
                            ]}
                          >
                            {/* Bottom gradient highlight on negative bars */}
                            <View style={[styles.barHighlightNeg, { backgroundColor: barColorTop }]} />
                          </Animated.View>
                        </View>
                      </>
                    )}
                  </View>
                  <View style={styles.barLabel}>
                    <Text style={[styles.barLabelText, isDanger && { color: Colors.error, fontWeight: '700' }]}>
                      W{i + 1}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: Colors.success }]} />
          <Text style={styles.legendText}>Positive</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: Colors.error }]} />
          <Text style={styles.legendText}>Negative</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: Colors.info }]} />
          <Text style={styles.legendText}>Running Balance</Text>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 16,
    paddingLeft: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden' as const,
  },
  yAxisLabels: {
    position: 'absolute' as const,
    left: 12,
    top: 16,
    height: CHART_HEIGHT,
    width: Y_GUTTER - 8,
    zIndex: 2,
  },
  yLabelTop: {
    position: 'absolute' as const,
    top: -2,
    right: 4,
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.success,
  },
  yLabelMid: {
    position: 'absolute' as const,
    top: CHART_HEIGHT / 2 - 6,
    right: 4,
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textMuted,
  },
  yLabelBot: {
    position: 'absolute' as const,
    bottom: -2,
    right: 4,
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.error,
  },
  zeroLine: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: Colors.border,
  },
  gridLine: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: Colors.borderLight,
    opacity: 0.5,
  },
  barsContainer: {
    flexDirection: 'row' as const,
    paddingLeft: 0,
    gap: BAR_GAP,
  },
  barColumn: {
    width: BAR_WIDTH,
    alignItems: 'center' as const,
    borderRadius: 10,
    paddingHorizontal: 2,
  },
  barColumnSelected: {
    backgroundColor: Colors.fillSecondary,
    borderWidth: 1,
    borderColor: Colors.primary + '55',
  },
  bar: {
    width: 30,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    minHeight: 2,
    overflow: 'hidden' as const,
  },
  barNeg: {
    width: 30,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
    minHeight: 2,
    overflow: 'hidden' as const,
  },
  barHighlight: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    height: 8,
    opacity: 0.85,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  barHighlightNeg: {
    position: 'absolute' as const,
    bottom: 0,
    left: 0,
    right: 0,
    height: 8,
    opacity: 0.85,
    borderBottomLeftRadius: 6,
    borderBottomRightRadius: 6,
  },
  barLabel: {
    height: LABEL_HEIGHT,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  barLabelText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textMuted,
  },
  legend: {
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    gap: 18,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  legendItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLine: {
    width: 18,
    height: 2.5,
    borderRadius: 1.25,
  },
  legendText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600' as const,
  },
});

export default CashFlowChart;
