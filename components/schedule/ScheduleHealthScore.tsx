// ScheduleHealthScore — visualizes the 0-100 health grade + drill-down
// breakdown of contributing checks. Two surfaces:
//
//   1. Compact pill (`<ScheduleHealthBadge>`) — shows on the schedule
//      header next to "AI / Voice / Reflow" buttons. Tap → opens the
//      detail modal.
//
//   2. Detail modal (`<ScheduleHealthDetail>`) — full breakdown with
//      every check, severity color, and a per-check fix suggestion.
//      Includes a "tap to jump" affordance on each flagged task.
//
// Design notes:
//   - A is green, B is teal, C is amber, D is orange, F is red.
//   - The big number is the focal point. Don't bury it under chrome.
//   - Below the number: a 1-line summary, then the prioritized list of
//     checks from worst to best so the user immediately sees what's
//     hurting them.

import React, { memo, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Activity, X, AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { HealthScoreResult, HealthCheck, HealthGrade } from '@/utils/scheduleHealthScore';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const GRADE_COLOR: Record<HealthGrade, string> = {
  A: Colors.success,
  B: '#0F9B8E',     // teal — different shade from A so users can tell them apart
  C: Colors.warning,
  D: '#FF8A1A',     // orange between warning and error
  F: Colors.error,
};

function gradeColor(grade: HealthGrade): string {
  return GRADE_COLOR[grade];
}

// ─── Compact pill ─────────────────────────────────────────────────────

export interface ScheduleHealthBadgeProps {
  result: HealthScoreResult;
  /** Caller controls open state so they can drive it from a button or a tile tap. */
  onPress?: () => void;
  /** Compact size for header rows; default for the project tile. */
  size?: 'compact' | 'default';
}

function ScheduleHealthBadgeImpl({ result, onPress, size = 'default' }: ScheduleHealthBadgeProps) {
  const color = gradeColor(result.grade);
  const isCompact = size === 'compact';
  return (
    <TouchableOpacity
      style={[
        styles.badge,
        isCompact && styles.badgeCompact,
        { borderColor: color + '50', backgroundColor: color + '12' },
      ]}
      onPress={() => {
        if (Platform.OS !== 'web') void Haptics.selectionAsync();
        onPress?.();
      }}
      activeOpacity={0.85}
      testID="schedule-health-badge"
    >
      <Activity size={isCompact ? 12 : 14} color={color} strokeWidth={2.4} />
      <View style={styles.badgeBody}>
        <Text style={[styles.badgeScore, { color }, isCompact && styles.badgeScoreCompact]}>
          {result.score}
        </Text>
        <Text style={[styles.badgeLabel, isCompact && styles.badgeLabelCompact]}>
          /100 · {result.grade}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export const ScheduleHealthBadge = memo(ScheduleHealthBadgeImpl);

// ─── Detail modal ─────────────────────────────────────────────────────

export interface ScheduleHealthDetailProps {
  visible: boolean;
  onClose: () => void;
  result: HealthScoreResult;
  /** Tap a flagged task → jumps the underlying screen to it. Optional. */
  onJumpToTask?: (taskId: string) => void;
}

function ScheduleHealthDetailImpl({ visible, onClose, result, onJumpToTask }: ScheduleHealthDetailProps) {
  const insets = useSafeAreaInsets();
  const color = gradeColor(result.grade);

  // Sort: worst first, then by weight desc — addresses what hurts most.
  const sorted = useMemo(
    () => [...result.checks].sort((a, b) => {
      if (a.value !== b.value) return a.value - b.value;
      return b.weight - a.weight;
    }),
    [result.checks],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>Schedule health</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8} style={styles.modalCloseBtn} accessibilityRole="button" accessibilityLabel="Close"><X size={18} color={Colors.text} /></TouchableOpacity>
          </View>

          {/* Big-number hero */}
          <View style={styles.heroWrap}>
            <View style={[styles.heroRing, { borderColor: color }]}>
              <Text style={[styles.heroScore, { color }]}>{result.score}</Text>
              <Text style={styles.heroOver}>/100</Text>
            </View>
            <View style={[styles.heroGradePill, { backgroundColor: color + '18' }]}>
              <Text style={[styles.heroGrade, { color }]}>{result.grade}</Text>
            </View>
            <Text style={styles.heroSummary}>{result.summary}</Text>
          </View>

          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: Tokens.spacing.sm }}>
            {sorted.map((c, i) => (
              <CheckRow
                key={c.key + i}
                check={c}
                onJumpToTask={onJumpToTask}
                onClose={onClose}
              />
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export const ScheduleHealthDetail = memo(ScheduleHealthDetailImpl);

function CheckRow({
  check, onJumpToTask, onClose,
}: {
  check: HealthCheck;
  onJumpToTask?: (taskId: string) => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(check.severity !== 'good');
  const tone = check.severity === 'good' ? Colors.success
    : check.severity === 'warn' ? Colors.warning : Colors.error;
  const Icon = check.severity === 'good' ? CheckCircle2 : AlertTriangle;
  return (
    <View style={[styles.checkRow, { borderLeftColor: tone }]}>
      <TouchableOpacity
        onPress={() => setExpanded(e => !e)}
        activeOpacity={0.85}
        style={styles.checkRowHead}
      >
        <Icon size={16} color={tone} />
        <View style={{ flex: 1 }}>
          <View style={styles.checkLabelRow}>
            <Text style={styles.checkLabel}>{check.label}</Text>
            {check.dcmaLabel && (
              <View style={styles.dcmaPill}>
                <Text style={styles.dcmaPillText}>{check.dcmaLabel}</Text>
              </View>
            )}
          </View>
          <Text style={styles.checkDesc} numberOfLines={expanded ? undefined : 1}>
            {check.description}
          </Text>
        </View>
        <View style={[styles.checkScorePill, { backgroundColor: tone + '14' }]}>
          <Text style={[styles.checkScoreText, { color: tone }]}>
            {Math.round(check.value * 100)}
          </Text>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.checkBody}>
          <Text style={styles.checkSuggestion}>{check.suggestion}</Text>
          {check.flagged.length > 0 && (
            <View style={styles.flaggedList}>
              <Text style={styles.flaggedHead}>
                Flagged ({check.flagged.length}):
              </Text>
              {check.flagged.map(f => (
                <TouchableOpacity
                  key={f.id}
                  style={styles.flaggedRow}
                  onPress={() => {
                    if (onJumpToTask) {
                      onClose();
                      setTimeout(() => onJumpToTask(f.id), 80);
                    }
                  }}
                  activeOpacity={onJumpToTask ? 0.7 : 1}
                  disabled={!onJumpToTask}
                >
                  <View style={styles.flaggedDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.flaggedTitle}>{f.title}</Text>
                    <Text style={styles.flaggedReason}>{f.reason}</Text>
                  </View>
                  {onJumpToTask && <ChevronRight size={12} color={Colors.textMuted} />}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Badge
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: Tokens.radius.md, borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeCompact: {
    paddingHorizontal: Tokens.spacing.xs, paddingVertical: Tokens.spacing.xxs, borderRadius: Tokens.radius.sm, gap: Tokens.spacing.xxs,
  },
  badgeBody: { flexDirection: 'row', alignItems: 'baseline', gap: Tokens.spacing.hairline },
  badgeScore: { fontSize: Type.callout.fontSize, fontWeight: '900', letterSpacing: -0.4 },
  badgeScoreCompact: { fontSize: Type.footnote.fontSize },
  badgeLabel: { fontSize: 10, fontWeight: '700', color: Colors.textMuted },
  badgeLabelCompact: { fontSize: 9 },

  // Modal shell
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    maxHeight: '90%' as const,
    backgroundColor: Colors.background,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: Tokens.spacing.md, paddingTop: 10, gap: Tokens.spacing.xs,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center', marginBottom: Tokens.spacing.xs,
  },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: Colors.text, letterSpacing: -0.2 },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card,
  },

  // Hero
  heroWrap: {
    alignItems: 'center', paddingVertical: 14, gap: Tokens.spacing.xs,
  },
  heroRing: {
    width: 96, height: 96, borderRadius: 48,
    borderWidth: 4,
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: Tokens.spacing.hairline,
  },
  heroScore: { fontSize: 36, fontWeight: '900', letterSpacing: -1 },
  heroOver: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: Colors.textMuted, alignSelf: 'flex-end', marginBottom: Tokens.spacing.xs },
  heroGradePill: {
    paddingHorizontal: Tokens.spacing.sm, paddingVertical: Tokens.spacing.xxs, borderRadius: Tokens.radius.full,
  },
  heroGrade: { fontSize: Type.subheadline.fontSize, fontWeight: '900', letterSpacing: 0.5 },
  heroSummary: {
    fontSize: Type.footnote.fontSize, color: Colors.text, textAlign: 'center', lineHeight: 18,
    paddingHorizontal: Tokens.spacing.xl, marginTop: Tokens.spacing.xxs,
  },

  // Check list
  list: { flex: 1, marginTop: Tokens.spacing.xs },
  checkRow: {
    backgroundColor: Colors.card,
    borderRadius: Tokens.radius.card, padding: Tokens.spacing.sm,
    borderWidth: 1, borderColor: Colors.border,
    borderLeftWidth: 4,
    marginBottom: Tokens.spacing.xs,
  },
  checkRowHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const },
  checkLabel: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: Colors.text, letterSpacing: -0.1 },
  checkDesc: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.hairline, lineHeight: 16 },
  dcmaPill: {
    paddingHorizontal: 6, paddingVertical: Tokens.spacing.hairline, borderRadius: 4,
    backgroundColor: Colors.primary + '12',
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  dcmaPillText: { fontSize: 9, fontWeight: '800', color: Colors.primary, letterSpacing: 0.3 },
  checkScorePill: { paddingHorizontal: 10, paddingVertical: Tokens.spacing.xxs, borderRadius: Tokens.radius.sm, minWidth: 36, alignItems: 'center' },
  checkScoreText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '900' },
  checkBody: {
    marginTop: 10, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: Colors.border,
    gap: Tokens.spacing.xs,
  },
  checkSuggestion: {
    fontSize: Type.footnote.fontSize, color: Colors.text, lineHeight: 18, fontStyle: 'italic',
    paddingHorizontal: Tokens.spacing.xxs,
  },

  flaggedList: {
    backgroundColor: Colors.background,
    borderRadius: Tokens.radius.sm, padding: 10,
    gap: 6,
  },
  flaggedHead: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: Colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: Tokens.spacing.xxs },
  flaggedRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs, paddingVertical: 6 },
  flaggedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.warning },
  flaggedTitle: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: Colors.text },
  flaggedReason: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: 1 },
});
