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
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { ChevronRight, Clock, CheckCircle2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

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
}

function daysSince(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function daysUntil(iso: string): number {
  const t = Date.parse(iso);
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
}: Props<S>) {
  const currentIdx = stages.findIndex(s => s.key === current);
  const currentStage = stages[currentIdx];
  const nextStage = currentIdx >= 0 && !currentStage?.terminal ? stages[currentIdx + 1] : null;

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
      <View style={styles.pipelineRow}>
        {stages.map((stage, i) => {
          const isPast = i < currentIdx;
          const isCurrent = i === currentIdx;
          const isFuture = i > currentIdx;
          return (
            <React.Fragment key={stage.key}>
              <View style={styles.stage}>
                <View style={[
                  styles.dot,
                  isPast && styles.dotPast,
                  isCurrent && styles.dotCurrent,
                  isFuture && styles.dotFuture,
                ]}>
                  {isPast ? <CheckCircle2 size={11} color={Colors.surface} strokeWidth={2.5} /> : null}
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
                <View style={[
                  styles.connector,
                  isPast && styles.connectorPast,
                ]} />
              ) : null}
            </React.Fragment>
          );
        })}
      </View>

      {(inDays !== null || dueDays !== null || nextStage) ? (
        <View style={styles.metaRow}>
          {inDays !== null ? (
            <View style={styles.metaPill}>
              <Clock size={11} color={Colors.textSecondary} strokeWidth={2} />
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
                isOverdue && { color: Colors.error },
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
              <ChevronRight size={14} color={Colors.primary} strokeWidth={2.4} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default StatusPipeline;

const styles = StyleSheet.create({
  root: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  pipelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stage: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 5,
    minWidth: 48,
    flexShrink: 1,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotPast: {
    backgroundColor: Colors.primary,
  },
  dotCurrent: {
    backgroundColor: Colors.primary,
    borderWidth: 3,
    borderColor: Colors.primary + '33',
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
    color: Colors.textSecondary,
    letterSpacing: 0.1,
    textAlign: 'center',
  },
  stageLabelCurrent: {
    color: Colors.text,
    fontWeight: '700' as const,
  },
  stageLabelFuture: {
    color: Colors.textMuted,
  },
  connector: {
    flex: 1,
    height: 2,
    backgroundColor: 'rgba(60,60,67,0.12)',
    marginHorizontal: 2,
    marginBottom: 18,
    borderRadius: 1,
  },
  connectorPast: {
    backgroundColor: Colors.primary,
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
    backgroundColor: Colors.fillTertiary,
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
    color: Colors.textSecondary,
    letterSpacing: 0.1,
  },
  advanceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Colors.primary + '14',
    borderWidth: 1,
    borderColor: Colors.primary + '33',
    marginLeft: 'auto',
  },
  advanceBtnText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: Colors.primary,
    letterSpacing: 0.1,
  },
});
