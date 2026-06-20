// WeatherRescheduleModal — preview + apply a weather-driven reschedule.
//
// Shows what the forecast does to the live schedule: which weather-sensitive
// tasks get rained out, how far each slips, and the resulting project slip —
// then lets the GC apply it in one tap (commits the cascaded startDays + logs
// the delay). The differentiator no SMB residential competitor ships: Procore
// only *predicts* a delay; this reschedules the job around it.

import React from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform,
} from 'react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { CloudRain, X, ArrowRight, CheckCircle2 } from 'lucide-react-native';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { WeatherRescheduleResult } from '@/utils/weatherReschedule';
import { getConditionIcon, type DayForecast } from '@/utils/weatherService';

export interface WeatherRescheduleModalProps {
  visible: boolean;
  result: WeatherRescheduleResult | null;
  projectStartDate: Date;
  onClose: () => void;
  onApply: () => void;
}

const CONDITION_LABEL: Record<DayForecast['condition'], string> = {
  storm: 'Storm', snow: 'Snow', rain: 'Rain', wind: 'High wind', cloudy: 'Overcast', clear: 'Clear',
};

function dateForDay(projectStartDate: Date, dayNumber: number): string {
  const d = new Date(projectStartDate.getTime());
  d.setDate(d.getDate() + (dayNumber - 1));
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function shortIso(iso: string): string {
  const t = Date.parse(iso + 'T00:00:00');
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function WeatherRescheduleModal({
  visible, result, projectStartDate, onClose, onApply,
}: WeatherRescheduleModalProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const hasImpact = !!result && result.impacts.length > 0;
  const slip = result?.projectSlipDays ?? 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} style={styles.backdrop} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.card} onPress={() => {}}>
          <View style={styles.header}>
            <CloudRain size={16} color={t.accent} />
            <Text style={styles.title}>Weather reschedule</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              Forecast vs. your weather-sensitive tasks.
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
              <X size={18} color={t.textSecondary} />
            </TouchableOpacity>
          </View>

          {!hasImpact ? (
            <View style={styles.emptyWrap}>
              <CheckCircle2 size={30} color={t.success} />
              <Text style={styles.emptyTitle}>No weather delays ahead</Text>
              <Text style={styles.emptyBody}>
                No rained-out days fall on a weather-sensitive task in the forecast window.
                Mark exterior tasks (pours, roofing, sitework) as weather-sensitive so they&apos;re watched.
              </Text>
            </View>
          ) : (
            <>
              {/* Headline */}
              <View style={styles.summary}>
                <View style={styles.slipBox}>
                  <Text style={styles.slipNum}>{slip > 0 ? `+${slip}` : '0'}</Text>
                  <Text style={styles.slipUnit}>day{slip === 1 ? '' : 's'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryTitle}>
                    {slip > 0 ? `Project finish slips ${slip} day${slip === 1 ? '' : 's'}` : 'No net project slip'}
                  </Text>
                  <Text style={styles.summarySub}>
                    {result!.directHitCount} weather-sensitive task{result!.directHitCount === 1 ? '' : 's'} rained out
                    {result!.cascadedCount > 0 ? ` · ${result!.cascadedCount} downstream task${result!.cascadedCount === 1 ? '' : 's'} shifted` : ''}
                  </Text>
                </View>
              </View>

              <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 8 }}>
                {result!.impacts.map((im) => (
                  <View key={im.taskId} style={styles.row}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.rowTop}>
                        <Text style={styles.rowTitle} numberOfLines={1}>{im.title}</Text>
                        {im.directlyHit && (
                          <View style={styles.hitBadge}>
                            <Text style={styles.hitBadgeText}>
                              {im.worstCondition ? `${getConditionIcon(im.worstCondition)} ${CONDITION_LABEL[im.worstCondition]}` : 'Weather'}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {im.phase}
                        {im.badDates.length > 0 ? ` · rained out ${im.badDates.map(shortIso).join(', ')}` : ' · shifted by upstream weather'}
                      </Text>
                    </View>
                    <View style={styles.shiftBox}>
                      {im.startSlipDays > 0 ? (
                        <View style={styles.shiftRow}>
                          <Text style={styles.shiftFrom}>{dateForDay(projectStartDate, im.originalStartDay)}</Text>
                          <ArrowRight size={11} color={t.textMuted} />
                          <Text style={styles.shiftTo}>{dateForDay(projectStartDate, im.newStartDay)}</Text>
                        </View>
                      ) : (
                        <Text style={styles.shiftHeld}>holds {dateForDay(projectStartDate, im.newStartDay)}</Text>
                      )}
                      {im.directlyHit && (
                        <Text style={styles.shiftDelay}>+{im.weatherDelayDays}d lost</Text>
                      )}
                    </View>
                  </View>
                ))}
              </ScrollView>
            </>
          )}

          <View style={styles.footer}>
            <TouchableOpacity style={styles.btnGhost} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.btnGhostText}>{hasImpact ? 'Not now' : 'Close'}</Text>
            </TouchableOpacity>
            {hasImpact && (
              <TouchableOpacity style={styles.btnPrimary} onPress={onApply} activeOpacity={0.7}>
                <Text style={styles.btnPrimaryText}>Apply reschedule</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  card: {
    width: 640, maxWidth: '94%', maxHeight: '88%', backgroundColor: t.surface,
    borderRadius: Tokens.radius.card, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.line,
  },
  title: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  subtitle: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, marginLeft: 4 },
  closeBtn: { padding: 4 },

  emptyWrap: { alignItems: 'center', paddingHorizontal: 32, paddingVertical: 40, gap: 10 },
  emptyTitle: { fontSize: Type.headline.fontSize, fontWeight: '700', color: t.text },
  emptyBody: { fontSize: Type.caption1.fontSize, color: t.textSecondary, textAlign: 'center', lineHeight: 18 },

  summary: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 18, paddingVertical: 16,
    backgroundColor: t.surfaceAlt, borderBottomWidth: 1, borderBottomColor: t.line,
  },
  slipBox: {
    minWidth: 64, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: Tokens.radius.sm,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
  },
  slipNum: { fontSize: Type.title2.fontSize, fontWeight: '800', color: t.accent, letterSpacing: -0.5 },
  slipUnit: { fontSize: Type.caption2.fontSize, fontWeight: '600', color: t.textSecondary, marginTop: -2 },
  summaryTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  summarySub: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 2, lineHeight: 16 },

  list: { maxHeight: 380, paddingHorizontal: 14 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.line,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text, flexShrink: 1 },
  hitBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: Tokens.radius.xs, backgroundColor: t.accentSoft },
  hitBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accentLabel },
  rowMeta: { fontSize: Type.caption2.fontSize, color: t.textSecondary, marginTop: 2 },
  shiftBox: { alignItems: 'flex-end', flexShrink: 0 },
  shiftRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  shiftFrom: { fontSize: Type.caption1.fontSize, color: t.textMuted, textDecorationLine: 'line-through' },
  shiftTo: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.text },
  shiftHeld: { fontSize: Type.caption1.fontSize, color: t.textSecondary },
  shiftDelay: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent, marginTop: 1 },

  footer: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.line,
    ...(Platform.OS === 'web' ? ({ cursor: 'default' } as any) : {}),
  },
  btnGhost: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Tokens.radius.xs },
  btnGhostText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.textSecondary },
  btnPrimary: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Tokens.radius.xs, backgroundColor: t.accent },
  btnPrimaryText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: Colors.textOnAccent },
});
