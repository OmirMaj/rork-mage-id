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

import React, { memo, useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, Modal } from 'react-native';
import * as Haptics from 'expo-haptics';
import { CloudRain, X, RefreshCw, ChevronRight, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { ScheduleTask, DailyFieldReport } from '@/types';
import { getConditionIcon, type DayForecast } from '@/utils/weatherService';
import type { ScheduleCalendar } from '@/utils/scheduleCalendarDate';
import { findWeatherPushConflicts, type WeatherPushConflict } from '@/utils/weatherReschedule';
import { computeWeatherHistory, weatherHistoryFactLine } from '@/utils/weatherHistory';
import { hasSimulatedDays, SIMULATED_WEATHER_HEADLINE } from '@/utils/weatherProvenance';
import { Type } from '@/constants/typography';
import { Layout, Tokens } from '@/constants/designTokens';
import { useSheetFrame, useSheetPrimaryHotkey } from '@/components/ui/Sheet';

export interface WeatherReschedulePromptProps {
  tasks: ScheduleTask[];
  forecasts: DayForecast[];
  projectStartDate: Date;
  onPushTasks: (patches: { taskId: string; deltaDays: number }[]) => void;
  /** Project's daily field reports — used to surface historical lost-day grounding. */
  dailyReports?: DailyFieldReport[];
  /** 'card' (default): today's banner. 'chip' (Schedule Pro's desktop
   *  signals row, wave 6c): a 32 px chip that opens the same review sheet. */
  variant?: 'card' | 'chip';
  /** Told whether there is a conflict to show (the signals row collapses to
   *  0 px when no chip has anything to say). */
  onPresenceChange?: (present: boolean) => void;
  /** The schedule's calendar (`scheduleCalendarOf(project.schedule)`). With a
   *  start date, each task's days are its WORKING days (startDay is a working
   *  ordinal) and the suggested push is in working days — the unit
   *  `onPushTasks` adds to startDay. Omitted ⇒ raw calendar offsets from
   *  projectStartDate (the engine's reading of an undated schedule). */
  scheduleCalendar?: ScheduleCalendar;
}

function WeatherReschedulePromptImpl({
  tasks, forecasts, projectStartDate, onPushTasks, dailyReports, variant = 'card', onPresenceChange,
  scheduleCalendar,
}: WeatherReschedulePromptProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [dismissed, setDismissed] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const fWx = useSheetFrame('form', { visible: showDetail, animationType: 'slide' });

  // Historical grounding: "Your history here: ~N lost days/mo" when data exists.
  const historyLine = useMemo(() => {
    if (!dailyReports || dailyReports.length === 0) return null;
    return weatherHistoryFactLine(computeWeatherHistory(dailyReports));
  }, [dailyReports]);

  // Which weather-sensitive tasks hit bad weather and how far to push each —
  // pure, in utils/weatherReschedule.ts, so the day-scale rule is executed by
  // scripts/validate-health-scheddays.ts rather than trusted.
  const conflicts = useMemo<WeatherPushConflict[]>(
    () => findWeatherPushConflicts(tasks, forecasts, projectStartDate, scheduleCalendar),
    [tasks, forecasts, projectStartDate, scheduleCalendar],
  );

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

  // "3 tasks hit bad weather" is a claim about reality. If any day behind it
  // was invented, say so on the banner itself — the GC decides whether to act
  // right here, and must not act on fiction believing it's a forecast.
  const conflictDaysAreSimulated = hasSimulatedDays(conflicts.map(c => c.hitDay));

  const present = !dismissed && conflicts.length > 0;
  useEffect(() => { onPresenceChange?.(present); }, [present, onPresenceChange]);
  // Cmd/Ctrl+Enter (and Cmd+S) in the review sheet = its primary, Push all.
  const pushAllFromSheet = useCallback(() => { handlePushAll(); setShowDetail(false); }, [handlePushAll]);
  useSheetPrimaryHotkey(showDetail && present, pushAllFromSheet);

  if (!present) return null;

  return (
    <>
      {variant === 'chip' ? (
        <TouchableOpacity
          style={styles.chip}
          onPress={() => setShowDetail(true)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`Review ${conflicts.length} weather-sensitive task${conflicts.length === 1 ? '' : 's'} hit by bad weather`}
          testID="weather-chip"
        >
          <CloudRain size={12} color={themeColors.warningLabel} strokeWidth={1.75} />
          <Text style={styles.chipText} numberOfLines={1}>
            {conflictDaysAreSimulated ? 'Simulated · ' : ''}{conflicts.length} task{conflicts.length === 1 ? '' : 's'} hit bad weather · Review
          </Text>
        </TouchableOpacity>
      ) : (
      <View style={styles.banner}>
        <View style={styles.bannerIcon}>
          <CloudRain size={16} color={Colors.warningLabel} strokeWidth={1.75} />
        </View>
        <View style={styles.bannerBody}>
          {conflictDaysAreSimulated && (
            <Text style={styles.bannerProvenance}>{SIMULATED_WEATHER_HEADLINE}</Text>
          )}
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
      )}

      <Modal visible={showDetail} transparent animationType={fWx.animationType} onRequestClose={() => setShowDetail(false)}>
        <View style={[styles.modalBackdrop, fWx.overlay]}>
          <View style={[styles.modalCard, fWx.card]}>
            {fWx.showHandle && <View style={styles.modalHandle} />}
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
                    <AlertTriangle size={14} color={Colors.warningLabel} strokeWidth={1.75} />
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

            <View style={[styles.modalFooter, fWx.footer]}>
              <TouchableOpacity
                style={[styles.modalSecondaryBtn, fWx.footerButton]}
                onPress={() => setShowDetail(false)}
              >
                <Text style={styles.modalSecondaryText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalPrimaryBtn, fWx.footerButton]}
                onPress={pushAllFromSheet}
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
  bannerProvenance: {
    fontSize: Type.caption2.fontSize, fontWeight: '800',
    color: Colors.warningDark, letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
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
  // The desktop signals-row chip: one line, 32 high, never wider than 240.
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: Layout.chip.height, maxWidth: Layout.chip.maxWidth, flexShrink: 0,
    paddingHorizontal: 12, borderRadius: Tokens.radius.full,
    backgroundColor: t.warningSoft, borderWidth: 1, borderColor: t.line,
  },
  chipText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.warningLabel },

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
