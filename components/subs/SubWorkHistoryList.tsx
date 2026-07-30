// components/subs/SubWorkHistoryList.tsx
//
// The sub's work history, one row per general contractor who has hired them.
// SUB-FACING: job counts, trades, and dates only — utils/subNetwork never puts
// a contract value in a SubGcHistory, so there is nothing here that could tell
// GC B what the sub charged GC A.
//
// Presentational. Rows are only pressable when the caller passes onSelectGc.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Building2, ChevronRight, CalendarDays, CircleDashed } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { SubGcHistory } from '@/utils/subNetwork';

function monthYear(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function span(entry: SubGcHistory): string {
  const first = monthYear(entry.firstJobISO);
  const last = monthYear(entry.lastJobISO);
  return first === last ? first : `${first} to ${last}`;
}

function Row({ entry, onPress }: { entry: SubGcHistory; onPress?: () => void }) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const jobs = `${entry.jobCount} ${entry.jobCount === 1 ? 'job' : 'jobs'}`;
  const closed = `${entry.completedJobCount} closed out`;

  const body = (
    <>
      <View style={styles.rowIcon}>
        <Building2 size={18} color={t.accent} strokeWidth={1.8} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <Text style={styles.gcName} numberOfLines={1}>{entry.gcName}</Text>
          {entry.activeNow ? (
            <View style={styles.activePill}>
              <CircleDashed size={10} color={t.success} strokeWidth={2.4} />
              <Text style={styles.activePillText}>Working now</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {jobs} · {closed}
          {entry.trades.length > 0 ? ` · ${entry.trades.join(', ')}` : ''}
        </Text>
        <View style={styles.rowDateLine}>
          <CalendarDays size={11} color={t.textMuted} strokeWidth={2} />
          <Text style={styles.rowDate}>{span(entry)}</Text>
        </View>
      </View>
      {onPress ? <ChevronRight size={16} color={t.textMuted} strokeWidth={1.9} /> : null}
    </>
  );

  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${entry.gcName}, ${jobs}`}
    >
      {body}
    </TouchableOpacity>
  );
}

export function SubWorkHistoryList({
  history,
  onSelectGc,
  title = 'Who you have worked for',
}: {
  history: SubGcHistory[];
  onSelectGc?: (gcId: string) => void;
  title?: string;
}) {
  const styles = useThemedStyles(makeStyles);

  if (history.length === 0) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.sectionLabel}>{title}</Text>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            No general contractors linked yet. Ask the GC who invited you to send your
            next bid or invoice through MAGE and this fills in on its own.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {history.map((entry) => (
        <Row
          key={entry.gcId}
          entry={entry}
          onPress={onSelectGc ? () => onSelectGc(entry.gcId) : undefined}
        />
      ))}
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    wrap: { gap: 8 },
    sectionLabel: { ...Type.eyebrow, color: t.textMuted },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: Tokens.spacing.sm,
      backgroundColor: t.surface,
      borderRadius: Tokens.radius.card,
      borderWidth: 1,
      borderColor: t.line,
      ...Tokens.continuousCorners,
    },
    rowIcon: {
      width: 38,
      height: 38,
      borderRadius: Tokens.radius.md,
      backgroundColor: t.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowBody: { flex: 1, minWidth: 0, gap: 3 },
    rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    gcName: { ...Type.subheadEmphasized, color: t.text, flexShrink: 1 },
    activePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: Tokens.radius.full,
      backgroundColor: t.successSoft,
    },
    activePillText: { ...Type.caption2, color: t.success, fontWeight: '600' },
    rowMeta: { ...Type.caption1, color: t.textSecondary },
    rowDateLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    rowDate: { ...Type.caption2, color: t.textMuted },

    empty: {
      padding: Tokens.spacing.md,
      borderRadius: Tokens.radius.card,
      borderWidth: 1,
      borderColor: t.line,
      borderStyle: 'dashed',
      backgroundColor: t.surfaceAlt,
    },
    emptyText: { ...Type.footnote, color: t.textSecondary },
  });

export default SubWorkHistoryList;
