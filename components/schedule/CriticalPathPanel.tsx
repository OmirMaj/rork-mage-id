// CriticalPathPanel — replaces the raw "Schedule analysis" Alert with a real
// explained panel. Answers "what's actually driving the finish date?" in plain
// language: the ordered chain of critical tasks, plus which tasks have
// breathing room and by how much.
//
// Mirrors EarnedValuePanel's Modal + ScrollView + useThemedStyles + X-close
// header pattern. Pure presentation — the explanation is built upstream by
// buildCriticalPathExplanation() and passed in via props.

import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { floatPhrase } from '@/utils/floatExplain';
import { calendarDayToDate } from '@/utils/cpm';

export function CriticalPathPanel(props: {
  visible: boolean;
  explanation: import('@/utils/floatExplain').CriticalPathExplanation;
  onClose: () => void;
  /**
   * Day 1 of the schedule. Supplied so the finish can be rendered as a DATE.
   * Optional only so an older caller still renders; without it the panel falls
   * back to the bare day number it used to print.
   */
  projectStartDate?: Date;
}): React.JSX.Element {
  const { visible, explanation, onClose, projectStartDate } = props;
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>What&apos;s driving the finish date</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8} style={styles.modalCloseBtn} accessibilityRole="button" accessibilityLabel="Close">
              <X size={18} color={themeColors.text} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>

          {/* A DATE, not "day 33". This modal is titled "What's driving the
              finish date" — it is the screen a PM opens to explain the schedule
              to a client, and a bare ordinal is not an explanation of anything.
              explanation.finishDay is a CALENDAR index, so this is a plain date
              add (never addWorkingDays — that would print it days late). */}
          <Text style={styles.finishLine}>
            Projected finish:{' '}
            {projectStartDate
              ? calendarDayToDate(projectStartDate, explanation.finishDay).toLocaleDateString(
                  undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' },
                )
              : `day ${explanation.finishDay}`}
          </Text>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* The critical path. `cpm.criticalPath` is a SET — every task with
                zero float — and a real network often has two branches critical
                at once. This used to draw the whole set as ONE arrow-linked
                list, which asserted a dependency between tasks that merely run
                side by side. buildCriticalPathExplanation now groups it into
                real chains and we draw arrows only WITHIN a chain; parallel
                branches get their own row and a heading that says so. */}
            <Text style={styles.sectionHead}>
              {explanation.criticalChains.length > 1
                ? `The critical path — ${explanation.criticalChains.length} parallel branches`
                : 'The critical path'}
            </Text>
            {explanation.criticalChains.length > 1 && (
              <Text style={styles.branchNote}>
                These run at the same time. Every one of them has to hold for the
                finish date to hold.
              </Text>
            )}
            {explanation.criticalChains.length > 0 ? (
              explanation.criticalChains.map((chain, ci) => (
                <View key={chain[0]?.id ?? ci} style={styles.chainRow}>
                  {explanation.criticalChains.length > 1 && (
                    <Text style={styles.branchLabel}>{ci + 1}</Text>
                  )}
                  {chain.map((task, i) => (
                    <View key={task.id} style={styles.chainItem}>
                      <View style={styles.chip}>
                        <Text style={styles.chipText}>{task.title}</Text>
                      </View>
                      {i < chain.length - 1 && (
                        <Text style={styles.arrow}>→</Text>
                      )}
                    </View>
                  ))}
                </View>
              ))
            ) : (
              <Text style={styles.mutedLine}>
                No critical path — the schedule has slack throughout.
              </Text>
            )}

            {/* Tasks with breathing room — how far each can slip without moving the finish. */}
            <Text style={styles.sectionHead}>These have breathing room</Text>
            {explanation.slack.length > 0 ? (
              explanation.slack.map((task) => (
                <View key={task.id} style={styles.slackRow}>
                  <Text style={styles.slackTitle} numberOfLines={2}>{task.title}</Text>
                  <Text style={styles.slackPhrase}>{floatPhrase(task.canSlipDays)}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.mutedLine}>
                Every task is on the critical path — no slack anywhere.
              </Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    maxHeight: '90%' as const,
    backgroundColor: t.bg,
    borderTopLeftRadius: Tokens.radius.xl, borderTopRightRadius: Tokens.radius.xl,
    paddingHorizontal: Tokens.spacing.md, paddingTop: 10, gap: Tokens.spacing.sm,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: Tokens.radius.full,
    backgroundColor: t.line,
    alignSelf: 'center', marginBottom: 4,
  },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2, flex: 1 },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card,
  },

  finishLine: { fontSize: Type.callout.fontSize, fontWeight: '700', color: t.text, letterSpacing: -0.2 },

  body: { flex: 1 },

  sectionHead: {
    fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textMuted,
    letterSpacing: 0.5, textTransform: 'uppercase' as const, marginTop: Tokens.spacing.md, marginBottom: Tokens.spacing.xs,
  },

  chainRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Tokens.spacing.xxs, marginBottom: Tokens.spacing.xxs },
  branchNote: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginBottom: Tokens.spacing.xs },
  branchLabel: {
    fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textMuted,
    minWidth: 14, textAlign: 'right', marginRight: 2,
  },
  chainItem: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs },
  chip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm,
    backgroundColor: t.accent + '14',
    borderWidth: 1, borderColor: t.accent + '33',
  },
  chipText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  arrow: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.textMuted },

  slackRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Tokens.spacing.sm,
    paddingVertical: 10, paddingHorizontal: Tokens.spacing.sm,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
    marginBottom: 6,
  },
  slackTitle: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text },
  slackPhrase: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' },

  mutedLine: {
    fontSize: Type.caption1.fontSize, color: t.textMuted, fontStyle: 'italic',
    lineHeight: 18, paddingVertical: 6,
  },
});
