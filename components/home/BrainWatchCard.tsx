// ============================================================================
// components/home/BrainWatchCard.tsx
//
// "Brain Watch" — proactive, glanceable "what needs your attention now" card
// for the home screen. Aggregates schedule health, overdue invoices, upcoming
// permit inspections, and expiring certifications from signals the engine
// already computes but keeps buried in individual screens.
//
// Data flow:
//   useProjects() → projects, invoices, getPermitsForProject
//   useSafety()   → expiringCertifications(todayISO)
//   brainWatch builders → AttentionItem[]
//   rankAttention → sorted list → top 6 rendered
//
// Anti-slop: Colors/Type/Tokens only — no raw hex, no inline fontSize,
// no inline borderRadius.
// ============================================================================

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import {
  CalendarDays,
  FileText,
  ClipboardCheck,
  ShieldCheck,
  Brain,
  CheckCircle2,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Colors } from '@/constants/colors';
import { useCoreData, useFinancialsData, useDocsData } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import {
  scheduleAttention,
  invoiceAttention,
  permitAttention,
  certAttention,
  rankAttention,
  summarize,
  type AttentionItem,
  type AttnKind,
  type AttnSeverity,
} from '@/utils/brainWatch';

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
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function BrainWatchCard() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  // ── Data sources ─────────────────────────────────────────────────────────
  const { projects } = useCoreData();
  const { invoices } = useFinancialsData();
  const { getPermitsForProject } = useDocsData();
  const safety = useSafety();

  // ── Build attention items ─────────────────────────────────────────────────
  const items: AttentionItem[] = useMemo(() => {
    const nowMs = Date.now();
    const todayISO = new Date().toISOString().slice(0, 10);

    const all: AttentionItem[] = [];

    // Schedule + Invoice + Permit signals — one pass over projects
    for (const project of projects) {
      // Skip non-active projects — closed/completed jobs rarely need daily attention
      if (project.status === 'closed' || project.status === 'completed') continue;

      all.push(...scheduleAttention(project));
      all.push(...invoiceAttention(project, invoices, nowMs));

      const permits = getPermitsForProject(project.id);
      all.push(...permitAttention(project, permits, nowMs));
    }

    // Cert signals — company-scoped, not project-scoped
    const expiring = safety.expiringCertifications(todayISO) as Parameters<typeof certAttention>[0];
    all.push(...certAttention(expiring, nowMs));

    return rankAttention(all);
  }, [projects, invoices, getPermitsForProject, safety]);

  const summary = useMemo(() => summarize(items), [items]);
  const visible = items.slice(0, MAX_VISIBLE);

  // ── Render ───────────────────────────────────────────────────────────────

  // All-clear state: render a calming "nothing to do" row
  if (summary.total === 0) {
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
        <Brain size={16} color={colors.accent} strokeWidth={2.2} />
        <Text style={styles.headerTitle}>
          {summary.total === 1
            ? '1 thing needs your attention'
            : `${summary.total} things need your attention`}
        </Text>
      </View>

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
      borderRadius: 2,
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
  });
