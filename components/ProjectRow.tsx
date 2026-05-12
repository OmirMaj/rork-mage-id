// ============================================================================
// components/ProjectRow.tsx
//
// Dense desktop variant of ProjectCard. Used at >= tablet widths where the
// mobile card wastes vertical real estate. Renders one horizontal row per
// project with table-style columns.
//
// Phase 1.5: migrated to themed styles + Fraunces name + mono status badge.
// ============================================================================

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import {
  Building2, Hammer, Plus, PenLine, Store, Trees, Home,
  LayoutGrid, Paintbrush, Droplets, Zap, Boxes, ChevronRight, MapPin,
} from 'lucide-react-native';
import { formatMoney } from '@/utils/formatters';
import type { Project, ProjectType } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Badge, type BadgeTone } from '@/components/ui/Badge';

const ICON_MAP: Record<string, React.ComponentType<{ size: number; color: string; strokeWidth?: number }>> = {
  Building2, Hammer, Plus, PenLine, Store, Trees, Home, LayoutGrid, Paintbrush, Droplets, Zap, Boxes,
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  estimated: 'Estimated',
  in_progress: 'In Progress',
  completed: 'Completed',
  closed: 'Closed',
};

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: 'warn',
  estimated: 'success',
  in_progress: 'info',
  completed: 'warn',
  closed: 'neutral',
};

const TYPE_ICON_MAP: Record<ProjectType, string> = {
  new_build: 'Building2', renovation: 'Hammer', addition: 'Plus', remodel: 'PenLine',
  commercial: 'Store', landscape: 'Trees', roofing: 'Home', flooring: 'LayoutGrid',
  painting: 'Paintbrush', plumbing: 'Droplets', electrical: 'Zap', concrete: 'Boxes',
};

interface Props {
  project: Project;
  onPress: () => void;
  onLongPress?: () => void;
  /** When true, draws the bottom divider line — false for the last row in the group. */
  showDivider?: boolean;
}

const ProjectRow = React.memo(function ProjectRow({ project, onPress, onLongPress, showDivider = true }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const Icon = ICON_MAP[TYPE_ICON_MAP[project.type]] ?? Building2;
  const statusLabel = STATUS_LABEL[project.status] ?? 'Draft';
  const statusTone: BadgeTone = STATUS_TONE[project.status] ?? 'neutral';

  const { hasEstimate, estimateTotal, burnRatio } = useMemo(() => {
    const linked = project.linkedEstimate;
    const legacy = project.estimate;
    const hasIt = !!(linked && Array.isArray(linked.items) && linked.items.length > 0) || !!legacy;
    const total = linked && Array.isArray(linked.items) && linked.items.length > 0
      ? (linked.grandTotal ?? 0)
      : (legacy?.grandTotal ?? 0);
    const invoiced = (project as { invoicedTotal?: number }).invoicedTotal ?? 0;
    const burn = hasIt && total > 0 ? Math.min(1, invoiced / total) : 0;
    return { hasEstimate: hasIt, estimateTotal: total, burnRatio: burn };
  }, [project]);

  const burnIsHigh = burnRatio >= 0.9;
  const burnPct = Math.round(burnRatio * 100);

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      activeOpacity={0.85}
      testID={`project-row-${project.id}`}
      style={[styles.row, showDivider && styles.rowWithDivider]}
      {...(Platform.OS === 'web' ? ({ accessibilityRole: 'link' as const } as any) : {})}
    >
      <View style={styles.iconWrap}>
        <Icon size={18} color={colors.accent} strokeWidth={1.8} />
      </View>

      <View style={styles.nameCol}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{project.name}</Text>
        {project.location ? (
          <View style={styles.locationRow}>
            <MapPin size={11} color={colors.textMuted} />
            <Text style={[styles.locationText, { color: colors.textMuted }]} numberOfLines={1}>{project.location}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.metaCol}>
        <Text style={[styles.metaLabel, { color: colors.textMuted }]}>Area</Text>
        <Text style={[styles.metaValue, { color: colors.text }]} numberOfLines={1}>
          {project.squareFootage > 0 ? `${project.squareFootage.toLocaleString()} sf` : '—'}
        </Text>
      </View>

      <View style={styles.metaCol}>
        <Text style={[styles.metaLabel, { color: colors.textMuted }]}>Quality</Text>
        <Text style={[styles.metaValue, { color: colors.text }]} numberOfLines={1}>
          {project.quality ? project.quality.charAt(0).toUpperCase() + project.quality.slice(1) : '—'}
        </Text>
      </View>

      <View style={styles.burnCol}>
        <View style={styles.burnHeaderRow}>
          <Text style={[styles.metaLabel, { color: colors.textMuted }]}>Burn</Text>
          <Text style={[styles.burnPctText, { color: burnIsHigh ? colors.danger : colors.text }]}>
            {hasEstimate ? `${burnPct}%` : '—'}
          </Text>
        </View>
        <View style={styles.burnTrack}>
          <View
            style={[
              styles.burnFill,
              {
                width: `${burnPct}%`,
                backgroundColor: burnIsHigh ? colors.danger : colors.accent,
              },
            ]}
          />
        </View>
      </View>

      <View style={[styles.metaCol, styles.totalCol]}>
        <Text style={[styles.metaLabel, { color: colors.textMuted }]}>Estimate</Text>
        <Text
          style={[styles.totalValue, { color: hasEstimate ? colors.accentLabel : colors.textMuted }]}
          numberOfLines={1}
        >
          {hasEstimate ? formatMoney(estimateTotal) : '—'}
        </Text>
      </View>

      <Badge tone={statusTone} dot>{statusLabel}</Badge>

      <ChevronRight size={16} color={colors.textMuted} strokeWidth={1.8} />
    </TouchableOpacity>
  );
});

export default ProjectRow;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 14,
    backgroundColor: t.surface,
  },
  rowWithDivider: {
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: Tokens.radius.sm,
    backgroundColor: t.accentSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  nameCol: {
    flex: 2.2,
    minWidth: 0,
    gap: 2,
  },
  name: {
    fontSize: Type.body.fontSize,
    fontWeight: '700' as const,
    letterSpacing: -0.2,
  },
  locationRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
  },
  locationText: {
    fontSize: Type.caption2.fontSize,
  },
  metaCol: {
    flex: 1,
    minWidth: 80,
    gap: 2,
  },
  totalCol: {
    alignItems: 'flex-end' as const,
  },
  metaLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '500' as const,
    letterSpacing: 0.2,
  },
  metaValue: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
  },
  totalValue: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800' as const,
    letterSpacing: -0.2,
  },
  burnCol: {
    flex: 1.2,
    minWidth: 110,
    gap: 4,
  },
  burnHeaderRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
  },
  burnPctText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
  },
  burnTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: t.line,
    overflow: 'hidden' as const,
  },
  burnFill: {
    height: 4,
    borderRadius: 2,
  },
});
