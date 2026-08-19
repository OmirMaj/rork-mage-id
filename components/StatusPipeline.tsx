// ============================================================================
// components/StatusPipeline.tsx
//
// Visual lifecycle breadcrumb for RFIs, Submittals, and any other workflow
// that walks through ordered states. Shows where the item sits *right now*
// in its pipeline plus a "days in status" counter so the GC can see at a
// glance whether something is overdue.
//
// User-research finding (DFR / RFI app reviews): status is usually buried
// in a dropdown halfway down the form. The user has to scroll to find it,
// tap, then choose from a list. That's three steps for the most-mutated
// field on the screen. A pipeline visualization at the top of the form +
// a one-tap "advance status" button collapses that to one tap and tells
// the user something the dropdown doesn't — what comes next.
//
//   Open ──▶ Answered ──▶ Closed
//   ●         ○            ○        (filled = past, half = current, empty = future)
//
// Pair with `StatusAdvanceButton` (export below) for the one-tap action.
// ============================================================================

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { ChevronRight, Clock, CheckCircle2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { parseCalendarDay } from '@/utils/calendarDate';

export interface PipelineStage<S extends string> {
  /** Internal state value (e.g. 'open', 'answered'). Pass-through to onPress. */
  key: S;
  /** Human-readable label (e.g. "Open", "Answered"). */
  label: string;
  /**
   * Optional terminal-state flag. Terminal stages don't get an "advance"
   * arrow — e.g. Closed, Void, Approved are usually terminal.
   */
  terminal?: boolean;
}

interface Props<S extends string> {
  stages: PipelineStage<S>[];
  current: S;
  /** Optional ISO date for the "days in status" counter. */
  startedAt?: string;
  /** Optional date the item became overdue (used to color the counter red). */
  dueAt?: string;
  /** When set, the user can tap "Advance →" to move to the next non-terminal stage. */
  onAdvance?: (next: S) => void;
  /** Optional override label for the advance button (e.g. "Mark answered"). */
  advanceLabel?: string;
  /**
   * The item has not ENTERED this pipeline yet, so no dot is current — which is
   * the honest picture; a permit that is merely `approved` has reached no
   * inspection stage — but the advance action still targets the FIRST stage.
   *
   * Opt-in, because the component cannot tell the difference between "hasn't
   * started" and "this status has nothing to do with this pipeline": both land
   * at `currentIdx === -1`. Only the caller's model knows. Treating them the
   * same is what made "Schedule inspection" unreachable on an approved permit —
   * the pipeline rendered blank AND withheld the only way into it.
   */
  notStarted?: boolean;
}

function daysSince(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function daysUntil(iso: string): number {
  // `dueAt` is a calendar day (app/punch-list.tsx passes item.dueDate, a bare
  // 'YYYY-MM-DD'). Date.parse of a bare date is UTC midnight, so west of
  // Greenwich the day lands one calendar day early and the overdue/urgent
  // badge fires a day too soon — the same off-by-one utils/calendarDate.ts
  // fixes elsewhere. parseCalendarDay lands on LOCAL midnight of that day;
  // for a full ISO instant it truncates to the date part. Fall back to
  // Date.parse only when the value is not a recognisable calendar day.
  const day = parseCalendarDay(iso);
  const t = day ? day.getTime() : Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.floor((t - Date.now()) / 86400000);
}

export function StatusPipeline<S extends string>({
  stages,
  current,
  startedAt,
  dueAt,
  onAdvance,
  advanceLabel,
  notStarted,
}: Props<S>) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const currentIdx = stages.findIndex(s => s.key === current);
  const currentStage = stages[currentIdx];
  // `notStarted` is the only case where an item off the pipeline still has a
  // next step, and it is the way IN: the first stage. Everything else needs a
  // real position (`currentIdx >= 0`) before there is anything to advance to.
  const nextStage = notStarted
    ? (currentIdx < 0 ? stages[0] ?? null : null)
    : (currentIdx >= 0 && !currentStage?.terminal ? stages[currentIdx + 1] ?? null : null);

  const inDays = startedAt ? daysSince(startedAt) : null;
  const dueDays = dueAt ? daysUntil(dueAt) : null;
  const isOverdue = dueDays !== null && dueDays < 0;
  const isUrgent = dueDays !== null && dueDays >= 0 && dueDays <= 2;

  const handleAdvance = React.useCallback(() => {
    if (!nextStage || !onAdvance) return;
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    onAdvance(nextStage.key);
  }, [nextStage, onAdvance]);

  return (
    <View style={styles.root}>
      {/* Horizontally scrollable, not a fixed row. The stages carry the only
          text in this component and they must never be the thing that gives
          way: `contentContainerStyle` grows to fill the width when everything
          fits (so short pipelines look exactly as before), and overflows into
          a scroll when it does not. See `stage` / `connector` below. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        alwaysBounceHorizontal={false}
        contentContainerStyle={styles.pipelineRow}
      >
        {stages.map((stage, i) => {
          const isPast = i < currentIdx;
          const isCurrent = i === currentIdx;
          const isFuture = i > currentIdx;
          return (
            <React.Fragment key={stage.key}>
              <View style={styles.stage} testID={`pipeline-stage-${stage.key}`}>
                <View style={[
                  styles.dot,
                  isPast && styles.dotPast,
                  isCurrent && styles.dotCurrent,
                  isFuture && styles.dotFuture,
                ]}>
                  {isPast ? <CheckCircle2 size={11} color={themeColors.surface} strokeWidth={2.5} /> : null}
                </View>
                <Text style={[
                  styles.stageLabel,
                  isCurrent && styles.stageLabelCurrent,
                  isFuture && styles.stageLabelFuture,
                ]} numberOfLines={1}>
                  {stage.label}
                </Text>
              </View>
              {i < stages.length - 1 ? (
                <View
                  style={[styles.connector, isPast && styles.connectorPast]}
                  testID={`pipeline-connector-${stage.key}`}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </ScrollView>

      {(inDays !== null || dueDays !== null || nextStage) ? (
        <View style={styles.metaRow}>
          {inDays !== null ? (
            <View style={styles.metaPill}>
              <Clock size={11} color={themeColors.textSecondary} strokeWidth={2} />
              <Text style={styles.metaPillText}>
                {inDays === 0 ? 'opened today' : `${inDays}d in pipeline`}
              </Text>
            </View>
          ) : null}
          {dueDays !== null ? (
            <View style={[
              styles.metaPill,
              isOverdue && styles.metaPillOverdue,
              isUrgent && !isOverdue && styles.metaPillUrgent,
            ]}>
              <Text style={[
                styles.metaPillText,
                isOverdue && { color: themeColors.danger },
                isUrgent && !isOverdue && { color: Colors.warning },
              ]}>
                {isOverdue
                  ? `${Math.abs(dueDays)}d overdue`
                  : dueDays === 0 ? 'due today' : `due in ${dueDays}d`}
              </Text>
            </View>
          ) : null}
          {nextStage && onAdvance ? (
            <TouchableOpacity
              style={styles.advanceBtn}
              onPress={handleAdvance}
              activeOpacity={0.7}
              testID={`status-advance-${nextStage.key}`}
            >
              <Text style={styles.advanceBtnText}>
                {advanceLabel ?? `Mark ${nextStage.label.toLowerCase()}`}
              </Text>
              <ChevronRight size={14} color={themeColors.accent} strokeWidth={2.4} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default StatusPipeline;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1,
    borderColor: t.line,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  // contentContainerStyle of the horizontal ScrollView. `flexGrow: 1` makes it
  // fill the available width when the stages fit, which is what keeps the
  // connectors looking like long rules on a 2- or 3-stage pipeline.
  pipelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexGrow: 1,
  },
  // `flexShrink: 0` is the fix, and it is deliberate: a stage is sized by its
  // label and is never compressed. It used to be `flexShrink: 1` next to
  // `connector: { flex: 1 }` — i.e. flexBasis 0 — so the connectors soaked up
  // every spare pixel while the stages absorbed 100% of the shortfall down to
  // a 48px floor, which at Type.caption2 truncated the 5-stage OAC pipeline to
  // "Schedu… / In Progr… / Conclu… / Distribu…". Now the row overflows into a
  // scroll instead of eating the words.
  stage: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 5,
    minWidth: 48,
    flexShrink: 0,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotPast: {
    backgroundColor: t.accent,
  },
  dotCurrent: {
    backgroundColor: t.accent,
    borderWidth: 3,
    borderColor: t.accent + '33',
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  dotFuture: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: 'rgba(60,60,67,0.25)',
  },
  stageLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
    letterSpacing: 0.1,
    textAlign: 'center',
  },
  stageLabelCurrent: {
    color: t.text,
    fontWeight: '700' as const,
  },
  stageLabelFuture: {
    color: t.textMuted,
  },
  // Takes the leftover width when there is any (flexGrow) and gives up nothing
  // when there is not (flexShrink 0, floored at flexBasis). The connector is
  // decoration; it may stretch, it may not squeeze a label.
  connector: {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 12,
    minWidth: 12,
    height: 2,
    backgroundColor: 'rgba(60,60,67,0.12)',
    marginHorizontal: 2,
    marginBottom: 18,
    borderRadius: 1,
  },
  connectorPast: {
    backgroundColor: t.accent,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: t.surfaceAlt,
  },
  metaPillUrgent: {
    backgroundColor: Colors.warningLight,
  },
  metaPillOverdue: {
    backgroundColor: Colors.errorLight,
  },
  metaPillText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
    letterSpacing: 0.1,
  },
  advanceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: t.accent + '14',
    borderWidth: 1,
    borderColor: t.accent + '33',
    marginLeft: 'auto',
  },
  advanceBtnText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    // Orange TEXT at caption size on the soft accent+'14' tint: brand accent
    // #FF6A1A is only 2.87:1 on white. accentLabel (#B23E08 light / #FF6A1A
    // dark) clears 4.5:1 here — 5.38 on surface, 5.10 on bg, 4.76 on surfaceAlt.
    color: t.accentLabel,
    letterSpacing: 0.1,
  },
});
