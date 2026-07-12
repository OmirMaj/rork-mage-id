// LevelingPreviewModal — "Fix overloads" preview.
//
// Runs after the resource-leveling engine has produced a set of shifts.
// Shows a one-line summary (how many tasks move, whether the project
// finish slips, and the biggest single move), then lists every shift
// (Day X → Y / ±Nd) so the user can eyeball the plan BEFORE committing.
// "Apply leveling" applies the shift undoably; "Cancel" discards it.
//
// Mirrors the Modal + ScrollView + X-close-header pattern of
// EarnedValuePanel.tsx. Tokens only.

import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { LevelingSummary } from '@/utils/levelingSummary';

export function LevelingPreviewModal(props: {
  visible: boolean;
  summary: LevelingSummary;
  projectFinishDelta: number;
  onApply: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { summary, projectFinishDelta } = props;
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const finishText =
    projectFinishDelta > 0 ? `+${projectFinishDelta} days` : 'unchanged';

  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="slide"
      onRequestClose={props.onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>Fix overloads</Text>
            <TouchableOpacity
              onPress={props.onClose}
              hitSlop={8}
              style={styles.modalCloseBtn}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <X size={18} color={themeColors.text} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>

          <Text style={styles.summaryLine}>
            {summary.shiftedCount} task(s) shift · finish {finishText} · biggest move {summary.maxShiftDays}d
          </Text>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {summary.shifts.map(shift => (
              <View key={shift.id} style={styles.shiftRow}>
                <Text style={styles.shiftTitle} numberOfLines={1}>{shift.title}</Text>
                <View style={styles.shiftMeta}>
                  <Text style={styles.shiftDays}>Day {shift.fromDay} → {shift.toDay}</Text>
                  <Text style={styles.shiftDelta}>
                    {shift.deltaDays > 0 ? '+' : ''}{shift.deltaDays}d
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              onPress={props.onClose}
              style={[styles.btn, styles.btnSecondary]}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.btnSecondaryText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={props.onApply}
              style={[styles.btn, styles.btnPrimary]}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Apply leveling"
            >
              <Text style={styles.btnPrimaryText}>Apply leveling</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  modalBackdrop: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  modalCard: {
    maxHeight: '90%' as const,
    backgroundColor: t.bg,
    borderTopLeftRadius: Tokens.radius.xl,
    borderTopRightRadius: Tokens.radius.xl,
    paddingHorizontal: Tokens.spacing.md,
    paddingTop: Tokens.spacing.xs + 2,
    gap: Tokens.spacing.sm,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: Tokens.radius.xs,
    backgroundColor: t.line,
    alignSelf: 'center', marginBottom: Tokens.spacing.xxs,
  },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  modalCloseBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.card,
  },
  summaryLine: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17 },

  list: { flexGrow: 0 },
  shiftRow: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm,
    padding: Tokens.spacing.sm, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
    marginBottom: Tokens.spacing.xxs + 2,
  },
  shiftTitle: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  shiftMeta: { alignItems: 'flex-end' },
  shiftDays: { fontSize: Type.caption2.fontSize, color: t.textMuted },
  shiftDelta: { fontSize: Type.footnote.fontSize, fontWeight: '900', color: t.accent, letterSpacing: -0.2, marginTop: 2 },

  footer: { flexDirection: 'row', gap: Tokens.spacing.xs, marginTop: Tokens.spacing.xxs },
  btn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: Tokens.spacing.sm, borderRadius: Tokens.radius.card,
  },
  btnSecondary: {
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
  },
  btnSecondaryText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  btnPrimary: { backgroundColor: t.accent },
  btnPrimaryText: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: Colors.textOnAccent },
});
