// ============================================================================
// components/home/BrainWatchCard.tsx
//
// "Brain Watch" — proactive, glanceable "what needs your attention now" card
// for the home screen. Aggregates schedule health, overdue invoices, upcoming
// permit inspections, and expiring certifications from signals the engine
// already computes but keeps buried in individual screens.
//
// Data flow:
//   useBrainWatch() — THE canonical needs-attention set (same number the
//   Summary hero pill + Your-Projects tab badge consume) → top 6 rendered.
//
// Anti-slop: Colors/Type/Tokens only — no raw hex, no inline fontSize,
// no inline borderRadius.
// ============================================================================

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import {
  CalendarDays,
  FileText,
  FileSignature,
  ClipboardCheck,
  ListChecks,
  ShieldCheck,
  CheckCircle2,
  PartyPopper,
  ChevronRight,
  Truck,
  Building2,
  CloudOff,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Colors } from '@/constants/colors';
import { useBrainGrading } from '@/hooks/useBrainGrading';
import { useBrainWatch } from '@/hooks/useBrainWatch';
import { useTierAccess } from '@/hooks/useTierAccess';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { AttnKind, AttnSeverity } from '@/utils/brainWatch';

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_VISIBLE = 6;

// ─── Severity → semantic color ────────────────────────────────────────────────

// Maps severity to semantic color tokens from ThemeColors.
// Critical → danger, High → warning (amber), Medium → textSecondary (neutral).
function severityColor(severity: AttnSeverity, t: ThemeColors): string {
  if (severity === 'critical') return t.danger;
  if (severity === 'high') return Colors.warning; // theme-aware orange from Colors
  return t.textSecondary;
}

// ─── Kind → icon ─────────────────────────────────────────────────────────────

const KIND_ICONS: Record<AttnKind, typeof CalendarDays> = {
  schedule: CalendarDays,
  invoice: FileText,
  permit: ClipboardCheck,
  cert: ShieldCheck,
  closeout: PartyPopper,
  punch: ListChecks,
  changeOrder: FileSignature,
  delivery: Truck,
  buildingAccess: Building2,
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function BrainWatchCard() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  // ── Data ──────────────────────────────────────────────────────────────────
  // The CANONICAL needs-attention set — same hook that feeds the Summary
  // hero pill and the Your-Projects tab badge, so every "needs attention"
  // number in the app is the same number (sim-audit #15).
  const { items, total, sourceFailed } = useBrainWatch();
  const { accuracyReport } = useBrainGrading();
  const { canAccess } = useTierAccess();

  const visible = items.slice(0, MAX_VISIBLE);

  // RT-R1: a failed fetch (dead session, no network) yields the same
  // `total === 0` as a genuinely quiet book — a dead session once showed a
  // green all-clear while every read 401'd. When MAGE could not be reached,
  // say so; what is listed is this device's last cache, not a current read.
  const unreachableLine =
    `Couldn't reach MAGE — showing what's on this ${Platform.OS === 'web' ? 'device' : 'phone'}`;

  // ── Render ───────────────────────────────────────────────────────────────

  if (total === 0) {
    if (sourceFailed) {
      return (
        <View style={styles.card} testID="brain-watch-unreachable">
          <View style={styles.unreachableRow}>
            <CloudOff size={16} color={colors.warningLabel} strokeWidth={2} />
            <Text style={styles.unreachableText}>{unreachableLine}</Text>
          </View>
        </View>
      );
    }
    // All-clear state: render a calming "nothing to do" row — only when the
    // source actually answered.
    return (
      <View style={styles.card}>
        <View style={styles.allClearRow}>
          <CheckCircle2 size={16} color={colors.success} strokeWidth={2} />
          <Text style={styles.allClearText}>All clear — your jobs are on track.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.headerRow}>
        <MageAIMark size={16} color={colors.accent} />
        <Text style={styles.headerTitle}>
          {total === 1
            ? '1 thing needs your attention'
            : `${total} things need your attention`}
        </Text>
      </View>

      {/* RT-R1: the rows below came from the local cache, not MAGE */}
      {sourceFailed ? (
        <View style={[styles.unreachableRow, styles.unreachableRowSpaced]} testID="brain-watch-unreachable">
          <CloudOff size={12} color={colors.warningLabel} strokeWidth={2} />
          <Text style={styles.unreachableText}>{unreachableLine}</Text>
        </View>
      ) : null}

      {/* Attention rows */}
      <View style={styles.list}>
        {visible.map((item) => {
          const Icon = KIND_ICONS[item.kind];
          const dotColor = severityColor(item.severity, colors);

          return (
            <TouchableOpacity
              key={item.id}
              style={styles.row}
              onPress={() => {
                // route.params may include projectId / invoiceId
                if (item.route.params && Object.keys(item.route.params).length > 0) {
                  router.push({
                    pathname: item.route.pathname as never,
                    params: item.route.params,
                  });
                } else {
                  router.push(item.route.pathname as never);
                }
              }}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={item.message}
            >
              {/* Severity stripe */}
              <View style={[styles.severityDot, { backgroundColor: dotColor }]} />

              {/* Kind icon */}
              <View style={styles.iconWrap}>
                <Icon size={14} color={dotColor} strokeWidth={2} />
              </View>

              {/* Message */}
              <Text style={styles.rowText} numberOfLines={1} ellipsizeMode="tail">
                {item.message}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Overflow hint */}
      {items.length > MAX_VISIBLE && (
        <Text style={styles.overflowHint}>
          +{items.length - MAX_VISIBLE} more — open each screen to review
        </Text>
      )}

      {/* Accuracy chip — Business+, only when at least one kind has n ≥ 3 */}
      {canAccess('brain_accuracy') && accuracyReport.hasEnoughData && (
        <TouchableOpacity
          style={styles.accuracyChip}
          onPress={() => router.push('/track-record' as any)}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="View the Brain's track record"
        >
          <MageAIMark size={12} color={colors.accent} />
          <Text style={styles.accuracyChipText}>
            {accuracyReport.rows.length} accuracy insight{accuracyReport.rows.length === 1 ? '' : 's'} ready
          </Text>
          <ChevronRight size={12} color={colors.textMuted} strokeWidth={2} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderRadius: Tokens.radius.panel,
      paddingVertical: Tokens.spacing.md,
      paddingHorizontal: Tokens.spacing.md,
      marginHorizontal: Tokens.spacing.md,
      marginTop: Tokens.spacing.sm,
      marginBottom: Tokens.spacing.xs,
      borderWidth: 1,
      borderColor: t.line,
    },
    headerRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: Tokens.spacing.xs,
      marginBottom: Tokens.spacing.sm,
    },
    headerTitle: {
      ...Type.subheadEmphasized,
      color: t.text,
      flex: 1,
    },
    list: {
      gap: Tokens.spacing.xs,
    },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: Tokens.spacing.xs,
      paddingVertical: 5,
    },
    severityDot: {
      width: 4,
      height: 4,
      borderRadius: Tokens.radius.full,
      flexShrink: 0,
    },
    iconWrap: {
      width: 20,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      flexShrink: 0,
    },
    rowText: {
      ...Type.footnote,
      color: t.textSecondary,
      flex: 1,
    },
    overflowHint: {
      ...Type.caption1,
      color: t.textMuted,
      marginTop: Tokens.spacing.sm,
    },
    allClearRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: Tokens.spacing.xs,
    },
    allClearText: {
      ...Type.footnote,
      color: t.textSecondary,
    },
    // RT-R1 "couldn't reach MAGE" — warning tone, never the success green.
    unreachableRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: Tokens.spacing.xs,
      paddingVertical: 6,
      paddingHorizontal: Tokens.spacing.sm,
      borderRadius: Tokens.radius.md,
      backgroundColor: t.warningSoft,
    },
    unreachableRowSpaced: {
      marginBottom: Tokens.spacing.sm,
    },
    unreachableText: {
      ...Type.footnote,
      color: t.warningLabel,
      flex: 1,
    },
    accuracyChip: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: Tokens.spacing.xs,
      marginTop: Tokens.spacing.sm,
      paddingVertical: 6,
      paddingHorizontal: Tokens.spacing.sm,
      borderRadius: Tokens.radius.full,
      borderWidth: 1,
      borderColor: t.line,
      backgroundColor: t.surfaceAlt,
      alignSelf: 'flex-start' as const,
    },
    accuracyChipText: {
      ...Type.caption1,
      color: t.textSecondary,
      fontWeight: '600' as const,
    },
  });
