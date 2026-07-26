// WeatherReschedulePrompt — banner that surfaces when weather-sensitive
// tasks are about to land on un-workable days. The user taps "Push them"
// and we bulk-shift each affected task by the right number of days so
// the work moves out of the rain. Successors ripple via CPM.
//
// Shows nothing when there's no conflict — silent by default. Dismissable
// for the current session via local state (we don't persist the dismissal
// because tomorrow's forecast might surface a new conflict).
//
// This is the "weather-aware reschedule" feature that's only currently
// shipped by US Tech Automations as a paid layer on Procore/P6. Free
// in MAGE.

import React, { memo, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, Modal } from 'react-native';
import * as Haptics from 'expo-haptics';
import { CloudRain, X, RefreshCw, ChevronRight, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { ScheduleTask, DailyFieldReport } from '@/types';
import { findWeatherRisk, getConditionIcon, type DayForecast } from '@/utils/weatherService';
import { computeWeatherHistory, weatherHistoryFactLine } from '@/utils/weatherHistory';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export interface WeatherReschedulePromptProps {
  tasks: ScheduleTask[];
  forecasts: DayForecast[];
  projectStartDate: Date;
  onPushTasks: (patches: { taskId: string; deltaDays: number }[]) => void;
  /** Project's daily field reports — used to surface historical lost-day grounding. */
  dailyReports?: DailyFieldReport[];
}

interface WeatherConflict {
  task: ScheduleTask;
  hitDay: DayForecast;
  /** How many days to push so the task starts on a workable day. */
  suggestedPushDays: number;
}

function findFirstWorkableOffset(
  startISO: string,
  durationDays: number,
  forecasts: DayForecast[],
): number {
  // Try shifting by 1, 2, 3 days until the entire task window has no
  // un-workable forecast day. Bound at 14 days so we don't loop forever
  // when the forecast is all bad.
  const startDate = new Date(startISO);
  for (let push = 1; push <= 14; push++) {
    let allWorkable = true;
    for (let offset = 0; offset < durationDays; offset++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + push + offset);
      const iso = d.toISOString().split('T')[0];
      const day = forecasts.find(f => f.date === iso);
      if (day && !day.isWorkable) {
        allWorkable = false;
        break;
      }
    }
    if (allWorkable) return push;
  }
  return 1;
}

function WeatherReschedulePromptImpl({
  tasks, forecasts, projectStartDate, onPushTasks, dailyReports,
}: WeatherReschedulePromptProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [dismissed, setDismissed] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  // Historical grounding: "Your history here: ~N lost days/mo" when data exists.
  const historyLine = useMemo(() => {
    if (!dailyReports || dailyReports.length === 0) return null;
    return weatherHistoryFactLine(computeWeatherHistory(dailyReports));
  }, [dailyReports]);

  const conflicts = useMemo<WeatherConflict[]>(() => {
    if (forecasts.length === 0) return [];
    const out: WeatherConflict[] = [];
    for (const task of tasks) {
      if (task.isSummary) continue;
      if (!task.isWeatherSensitive) continue;
      // Already started — pushing won't help.
      if ((task.progress ?? 0) > 0) continue;
      const risk = findWeatherRisk(projectStartDate, task.startDay, task.durationDays, forecasts);
      if (!risk) continue;
      const startDate = new Date(projectStartDate);
      startDate.setDate(startDate.getDate() + (task.startDay - 1));
      const startISO = startDate.toISOString().split('T')[0];
      const push = findFirstWorkableOffset(startISO, task.durationDays, forecasts);
      out.push({ task, hitDay: risk, suggestedPushDays: push });
    }
    return out;
  }, [tasks, forecasts, projectStartDate]);

  const handlePushAll = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPushTasks(conflicts.map(c => ({
      taskId: c.task.id,
      deltaDays: c.suggestedPushDays,
    })));
    setDismissed(true);
  }, [conflicts, onPushTasks]);

  const handleDismiss = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setDismissed(true);
  }, []);

  if (dismissed || conflicts.length === 0) return null;

  return (
    <>
      <View style={styles.banner}>
        <View style={styles.bannerIcon}>
          <CloudRain size={16} color={Colors.warning} strokeWidth={1.75} />
        </View>
        <View style={styles.bannerBody}>
          <Text style={styles.bannerTitle}>
            {conflicts.length} weather-sensitive task{conflicts.length === 1 ? '' : 's'} hit bad weather
          </Text>
          <Text style={styles.bannerSub}>
            {conflicts.slice(0, 3).map(c => c.task.title).join(', ')}
            {conflicts.length > 3 ? `, +${conflicts.length - 3} more` : ''}
            {' · '}{conflicts[0].hitDay.icon} {conflicts[0].hitDay.condition}
          </Text>
          {historyLine ? (
            <Text style={styles.bannerHistory}>Your history here: {historyLine}</Text>
          ) : null}
        </View>
        <View style={styles.bannerActions}>
          <TouchableOpacity
            onPress={() => setShowDetail(true)}
            style={styles.bannerSecondaryBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.bannerSecondaryText}>Review</Text>
            <ChevronRight size={12} color={themeColors.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handlePushAll}
            style={styles.bannerPrimaryBtn}
            activeOpacity={0.85}
          >
            <RefreshCw size={12} color="#FFF" strokeWidth={1.75} />
            <Text style={styles.bannerPrimaryText}>Push all</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDismiss} hitSlop={6} style={styles.bannerCloseBtn} accessibilityRole="button" accessibilityLabel="Close"><X size={14} color={themeColors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
        </View>
      </View>

      <Modal visible={showDetail} transparent animationType="slide" onRequestClose={() => setShowDetail(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Weather conflicts</Text>
                <Text style={styles.modalSub}>
                  Each task below will start on a non-workable day. Tap a row to push just that task, or use Push all to move every conflict at once.
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowDetail(false)} hitSlop={8} style={styles.modalCloseBtn} accessibilityRole="button" accessibilityLabel="Close">
                <X size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 360 }}>
              {conflicts.map(c => (
                <TouchableOpacity
                  key={c.task.id}
                  style={styles.row}
                  onPress={() => {
                    onPushTasks([{ taskId: c.task.id, deltaDays: c.suggestedPushDays }]);
                  }}
                  activeOpacity={0.85}
                >
                  <View style={styles.rowIcon}>
                    <AlertTriangle size={14} color={Colors.warning} strokeWidth={1.75} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{c.task.title}</Text>
                    <Text style={styles.rowMeta}>
                      {c.task.phase} · {c.task.durationDays}d · hits {c.hitDay.date}
                    </Text>
                    <Text style={styles.rowDetail}>
                      {getConditionIcon(c.hitDay.condition)} {c.hitDay.condition} · {c.hitDay.tempHigh}°F · {c.hitDay.precipChance}% precip · {c.hitDay.windSpeed}mph
                    </Text>
                  </View>
                  <View style={styles.rowAction}>
                    <Text style={styles.rowActionText}>+{c.suggestedPushDays}d</Text>
                    <ChevronRight size={12} color={themeColors.accent} strokeWidth={1.75} />
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalSecondaryBtn}
                onPress={() => setShowDetail(false)}
              >
                <Text style={styles.modalSecondaryText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalPrimaryBtn}
                onPress={() => {
                  handlePushAll();
                  setShowDetail(false);
                }}
                activeOpacity={0.85}
              >
                <RefreshCw size={14} color="#FFF" strokeWidth={1.75} />
                <Text style={styles.modalPrimaryText}>Push all {conflicts.length}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

export const WeatherReschedulePrompt = memo(WeatherReschedulePromptImpl);

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: Colors.warning + '14',
    borderWidth: 1, borderColor: Colors.warning + '40',
    borderRadius: Tokens.radius.card,
    marginHorizontal: 16, marginTop: 8,
  },
  bannerIcon: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: Colors.warning + '20',
    alignItems: 'center', justifyContent: 'center',
  },
  bannerBody: { flex: 1, gap: 2 },
  bannerTitle: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.1 },
  bannerSub: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 14 },
  bannerHistory: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 14, fontStyle: 'italic' },
  bannerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bannerSecondaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: 8, paddingVertical: 6, borderRadius: 7,
    backgroundColor: t.bg,
    borderWidth: 1, borderColor: t.line,
  },
  bannerSecondaryText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.text },
  bannerPrimaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7,
    backgroundColor: Colors.warning,
  },
  bannerPrimaryText: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: '#FFF' },
  bannerCloseBtn: { padding: 6 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    maxHeight: '85%' as const,
    backgroundColor: t.bg,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24, gap: 10,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: t.line,
    alignSelf: 'center', marginBottom: 4,
  },
  modalHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  modalSub: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 4, lineHeight: 17 },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
    marginBottom: 6,
  },
  rowIcon: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.warning + '14',
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  rowMeta: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2 },
  rowDetail: { fontSize: Type.caption2.fontSize, color: t.text, marginTop: 4, fontStyle: 'italic' },
  rowAction: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm,
    backgroundColor: t.accent + '14',
  },
  rowActionText: { fontSize: Type.caption2.fontSize, color: t.accent, fontWeight: '800' },

  modalFooter: { flexDirection: 'row', gap: 8, marginTop: 4 },
  modalSecondaryBtn: {
    flex: 1, paddingVertical: 12, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
    alignItems: 'center',
  },
  modalSecondaryText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  modalPrimaryBtn: {
    flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.warning,
  },
  modalPrimaryText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: '#FFF' },
});
