import React, { useMemo, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated,
} from 'react-native';
import { Colors } from '@/constants/colors';
import type { CashFlowWeek } from '@/utils/cashFlowEngine';
import { formatCurrencyShort } from '@/utils/cashFlowEngine';

interface CashFlowChartProps {
  weeks: CashFlowWeek[];
  onWeekPress?: (weekIndex: number) => void;
  selectedWeek?: number | null;
}

const BAR_WIDTH = 44;
const CHART_HEIGHT = 200;
const LABEL_HEIGHT = 28;

const CashFlowChart = React.memo(function CashFlowChart({
  weeks,
  onWeekPress,
  selectedWeek,
}: CashFlowChartProps) {
  const scrollRef = useRef<ScrollView>(null);

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
      const y = CHART_HEIGHT - (normalized * (CHART_HEIGHT - 20)) - 10;
      const x = i * (BAR_WIDTH + 8) + BAR_WIDTH / 2;
      return { x, y, balance: w.runningBalance };
    });

    return { maxAbsNet: maxNet, maxAbsBalance: maxBal, balancePoints: points };
  }, [weeks]);

  const handleWeekPress = useCallback((index: number) => {
    onWeekPress?.(index);
  }, [onWeekPress]);

  const totalWidth = weeks.length * (BAR_WIDTH + 8) + 16;
  const midY = CHART_HEIGHT / 2;

  return (
    <View style={styles.container}>
      <View style={styles.yAxisLabels}>
        <Text style={styles.yLabel}>{formatCurrencyShort(maxAbsNet)}</Text>
        <Text style={[styles.yLabel, { color: Colors.textMuted }]}>$0</Text>
        <Text style={[styles.yLabel, { color: Colors.error }]}>-{formatCurrencyShort(maxAbsNet)}</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ width: Math.max(totalWidth, 300), paddingRight: 16 }}
      >
        <View style={{ height: CHART_HEIGHT + LABEL_HEIGHT }}>
          <View style={[styles.zeroLine, { top: midY }]} />

          {balancePoints.length > 1 && (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              {balancePoints.map((pt, i) => {
                if (i === 0) return null;
                const prev = balancePoints[i - 1];
                const dx = pt.x - prev.x;
                const dy = pt.y - prev.y;
                const length = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx) * (180 / Math.PI);
                return (
                  <View
                    key={`line-${i}`}
                    style={{
                      position: 'absolute',
                      left: prev.x,
                      top: prev.y,
                      width: length,
                      height: 2,
                      backgroundColor: Colors.info,
                      transform: [{ rotate: `${angle}deg` }],
                      transformOrigin: 'left center',
                      opacity: 0.7,
                    }}
                  />
                );
              })}
              {balancePoints.map((pt, i) => (
                <View
                  key={`dot-${i}`}
                  style={{
                    position: 'absolute',
                    left: pt.x - 3,
                    top: pt.y - 3,
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: Colors.info,
                  }}
                />
              ))}
            </View>
          )}

          <View style={styles.barsContainer}>
            {weeks.map((week, i) => {
              const isPositive = week.netCashFlow >= 0;
              const barHeight = maxAbsNet > 0
                ? (Math.abs(week.netCashFlow) / maxAbsNet) * (CHART_HEIGHT / 2 - 10)
                : 0;
              const isSelected = selectedWeek === i;
              const isDanger = week.runningBalance < 0;

              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.barColumn, isSelected && styles.barColumnSelected]}
                  onPress={() => handleWeekPress(i)}
                  activeOpacity={0.7}
                >
                  <View style={{ height: CHART_HEIGHT, justifyContent: 'center' }}>
                    {isPositive ? (
                      <View style={{ alignItems: 'center', justifyContent: 'flex-end', height: CHART_HEIGHT / 2 - 5 }}>
                        <View
                          style={[
                            styles.bar,
                            {
                              height: Math.max(barHeight, 2),
                              backgroundColor: isDanger ? Colors.warning : Colors.success,
                            },
                          ]}
                        />
                      </View>
                    ) : (
                      <>
                        <View style={{ height: CHART_HEIGHT / 2 - 5 }} />
                        <View style={{ alignItems: 'center', height: CHART_HEIGHT / 2 - 5 }}>
                          <View
                            style={[
                              styles.bar,
                              {
                                height: Math.max(barHeight, 2),
                                backgroundColor: Colors.error,
                              },
                            ]}
                          />
                        </View>
                      </>
                    )}
                  </View>
                  <View style={styles.barLabel}>
                    <Text style={[styles.barLabelText, isDanger && { color: Colors.error }]}>
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
          <Text style={styles.legendText}>Positive Week</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: Colors.error }]} />
          <Text style={styles.legendText}>Negative Week</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: Colors.info }]} />
          <Text style={styles.legendText}>Balance</Text>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  yAxisLabels: {
    position: 'absolute',
    left: 4,
    top: 16,
    height: CHART_HEIGHT,
    justifyContent: 'space-between',
    zIndex: 2,
  },
  yLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.success,
  },
  zeroLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: Colors.border,
  },
  barsContainer: {
    flexDirection: 'row',
    paddingLeft: 8,
    gap: 8,
  },
  barColumn: {
    width: BAR_WIDTH,
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 2,
  },
  barColumnSelected: {
    backgroundColor: Colors.fillSecondary,
  },
  bar: {
    width: 28,
    borderRadius: 4,
    minHeight: 2,
  },
  barLabel: {
    height: LABEL_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  barLabelText: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textMuted,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLine: {
    width: 16,
    height: 2,
    borderRadius: 1,
  },
  legendText: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
});

export default CashFlowChart;
