// components/automation/InspectionResultReviewSheet.tsx
//
// THE INSPECTION-RESULT CONFIRM GATE — the review surface between the pure
// adapter (utils/automation/inspectionResultToScheduleWork.ts) and a real
// schedule / safety mutation. Mirrors AutoScheduleReviewSheet's discipline:
//
//   • NOTHING commits until the contractor presses Confirm. Rendering the sheet,
//     dismissing — none of them commit. onConfirm is the ONLY commit path.
//
//   • PASS: shows the gated successor task(s) that will be RELEASED (unblocked)
//     so they can start.
//
//   • FAIL: shows (1) the DRAFT re-inspection that will be added, with its
//     honest lead-time provenance chip (a guess the contractor confirms, never a
//     jurisdiction fact by fiat); (2) that the gated successors stay BLOCKED;
//     (3) the DRAFT hazard that will be logged to Safety. All three commit
//     together on confirm.
//
// Tokens only (constants/colors + typography + designTokens). No hex literals,
// no inline fontSize. Pure presentational — all state/commit lives in the caller.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import {
  CalendarClock,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Lock,
} from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { RoadmapInspection } from '@/types';
import type { InspectionResultWork } from '@/utils/automation/inspectionResultToScheduleWork';

export interface InspectionResultReviewSheetProps {
  inspection: RoadmapInspection;
  result: 'passed' | 'failed';
  /** The DRAFT consequences from the pure adapter (read only — this sheet
   *  renders them; the caller commits on confirm). */
  work: InspectionResultWork;
  /** Fired ONLY on an explicit contractor confirm — the single commit path. */
  onConfirm: () => void;
  /** Dismiss without committing. */
  onCancel: () => void;
}

export function InspectionResultReviewSheet(
  props: InspectionResultReviewSheetProps,
): React.JSX.Element {
  const { inspection, result, work, onConfirm, onCancel } = props;
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const isPass = result === 'passed';
  const releasedCount = work.releasedTaskIds?.length ?? 0;
  const blockedCount = work.blockedTaskIds?.length ?? 0;
  const lead = work.reinspectionLead;

  return (
    <View style={styles.sheet} testID="inspection-result-sheet">
      <View style={styles.header}>
        <View
          style={[styles.headerIconWrap, isPass ? styles.headerIconPass : styles.headerIconFail]}
        >
          {isPass ? (
            <CheckCircle2 {...Tokens.iconSize.default} color={colors.successLabel} />
          ) : (
            <XCircle {...Tokens.iconSize.default} color={colors.dangerLabel} />
          )}
        </View>
        <View style={styles.headerTextWrap}>
          <Text style={styles.eyebrow}>
            {isPass ? 'Inspection passed' : 'Inspection failed'}
          </Text>
          <Text style={styles.title} testID="result-sheet-title">
            {inspection.title}
          </Text>
          <Text style={styles.subtitle}>
            Draft only — nothing changes until you confirm.
          </Text>
        </View>
      </View>

      <ScrollView style={styles.list} testID="result-sheet-list">
        {isPass ? (
          <View style={styles.block} testID="result-release-block">
            <View style={styles.blockHead}>
              <CalendarClock {...Tokens.iconSize.small} color={colors.successLabel} />
              <Text style={styles.blockTitle}>
                {releasedCount === 0
                  ? 'No gated tasks to release'
                  : releasedCount === 1
                    ? '1 task will be released to start'
                    : `${releasedCount} tasks will be released to start`}
              </Text>
            </View>
            <Text style={styles.blockBody}>
              {releasedCount === 0
                ? 'This inspection did not gate any scheduled task — marking it passed just records the result.'
                : 'The task(s) this inspection was holding will be unblocked and the schedule reflowed.'}
            </Text>
          </View>
        ) : (
          <>
            {/* Re-inspection draft */}
            <View style={styles.block} testID="result-reinspect-block">
              <View style={styles.blockHead}>
                <CalendarClock {...Tokens.iconSize.small} color={colors.accent} />
                <Text style={styles.blockTitle}>A re-inspection will be scheduled</Text>
              </View>
              {work.reinspectionDraft ? (
                <Text style={styles.blockBody}>{work.reinspectionDraft.title}</Text>
              ) : null}
              {lead ? (
                <View style={styles.chip} testID="reinspect-lead-chip">
                  <Text style={styles.chipText}>
                    {`${lead.days}d lead · ${lead.source === 'jurisdiction' ? 'Jurisdiction' : 'Typical'} · ${lead.confidence} confidence`}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Successors stay blocked */}
            <View style={styles.block} testID="result-blocked-block">
              <View style={styles.blockHead}>
                <Lock {...Tokens.iconSize.small} color={colors.warningLabel} />
                <Text style={styles.blockTitle}>
                  {blockedCount === 0
                    ? 'No downstream tasks were gated'
                    : blockedCount === 1
                      ? '1 task stays blocked'
                      : `${blockedCount} tasks stay blocked`}
                </Text>
              </View>
              <Text style={styles.blockBody}>
                {blockedCount === 0
                  ? 'Nothing downstream was waiting on this inspection.'
                  : 'The task(s) this inspection gates remain blocked until the re-inspection clears.'}
              </Text>
            </View>

            {/* Hazard draft */}
            {work.hazardDraft ? (
              <View style={styles.block} testID="result-hazard-block">
                <View style={styles.blockHead}>
                  <ShieldAlert {...Tokens.iconSize.small} color={colors.dangerLabel} />
                  <Text style={styles.blockTitle}>A safety hazard will be logged</Text>
                </View>
                <Text style={styles.blockBody}>{work.hazardDraft.description}</Text>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <View style={styles.actions}>
        <TouchableOpacity
          onPress={onCancel}
          style={styles.cancelBtn}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          testID="result-cancel-btn"
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onConfirm}
          style={[styles.confirmBtn, !isPass && styles.confirmBtnFail]}
          accessibilityRole="button"
          accessibilityLabel={
            isPass ? 'Confirm and release the schedule' : 'Confirm re-inspection and hazard'
          }
          testID="result-confirm-btn"
        >
          <Text style={styles.confirmText}>
            {isPass ? 'Confirm & release' : 'Confirm re-inspection'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    sheet: {
      backgroundColor: t.surface,
      borderTopLeftRadius: Tokens.radius.xl,
      borderTopRightRadius: Tokens.radius.xl,
      paddingHorizontal: Tokens.spacing.md,
      paddingTop: Tokens.spacing.lg,
      paddingBottom: Tokens.spacing.md,
      flex: 1,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Tokens.spacing.sm,
      marginBottom: Tokens.spacing.md,
    },
    headerIconWrap: {
      width: Tokens.touchTarget.min,
      height: Tokens.touchTarget.min,
      borderRadius: Tokens.radius.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerIconPass: { backgroundColor: t.successSoft },
    headerIconFail: { backgroundColor: t.dangerSoft },
    headerTextWrap: { flex: 1 },
    eyebrow: { ...Type.eyebrow, color: t.textSecondary, marginBottom: Tokens.spacing.xxs },
    title: { ...Type.title3, color: t.text },
    subtitle: { ...Type.footnote, color: t.textSecondary, marginTop: Tokens.spacing.xxs },

    list: { flex: 1 },
    block: {
      backgroundColor: t.surfaceAlt,
      borderRadius: Tokens.radius.card,
      padding: Tokens.spacing.sm,
      marginBottom: Tokens.spacing.sm,
    },
    blockHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Tokens.spacing.xs,
      marginBottom: Tokens.spacing.xxs,
    },
    blockTitle: { ...Type.subheadEmphasized, color: t.text, flex: 1 },
    blockBody: { ...Type.footnote, color: t.textSecondary },
    chip: {
      alignSelf: 'flex-start',
      backgroundColor: t.surface,
      borderRadius: Tokens.radius.xs,
      paddingHorizontal: Tokens.spacing.xs,
      paddingVertical: Tokens.spacing.hairline,
      marginTop: Tokens.spacing.xs,
    },
    chipText: { ...Type.caption1, color: t.textSecondary },

    actions: {
      flexDirection: 'row',
      gap: Tokens.spacing.sm,
      marginTop: Tokens.spacing.md,
    },
    cancelBtn: {
      flex: 1,
      minHeight: Tokens.touchTarget.comfortable,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: Tokens.radius.card,
      borderWidth: 1,
      borderColor: t.line,
    },
    cancelText: { ...Type.bodyEmphasized, color: t.text },
    confirmBtn: {
      flex: 2,
      minHeight: Tokens.touchTarget.comfortable,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: Tokens.radius.card,
      backgroundColor: t.accentFill,
    },
    confirmBtnFail: { backgroundColor: t.dangerLabel },
    confirmText: { ...Type.bodyEmphasized, color: Colors.textOnAccent },
  });
