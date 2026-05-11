// ============================================================================
// components/ProjectRow.tsx
//
// Dense desktop variant of ProjectCard. Used by the home tab at >= tablet
// widths where the mobile card (icon+name+stack-of-metas) wastes vertical
// real estate. Renders one horizontal row per project with table-style
// columns, mirroring SaaS-dashboard data tables (Linear / Notion / the
// reference user shared) instead of phone-style stacked cards.
//
// Columns (left → right):
//   [icon]  [name + location]   [area]   [quality]   [budget burn bar]   [total $]   [status pill]  ›
//
// All rows go in a single bordered container so the dividers between rows
// read as table-rules instead of independent floating cards. Click =
// navigate to project detail. Long-press still deletes (parent handler).
// ============================================================================

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import {
  Building2, Hammer, Plus, PenLine, Store, Trees, Home,
  LayoutGrid, Paintbrush, Droplets, Zap, Boxes, ChevronRight, MapPin,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { formatMoney } from '@/utils/formatters';
import type { Project, ProjectType } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const ICON_MAP: Record<string, React.ComponentType<{ size: number; color: string; strokeWidth?: number }>> = {
  Building2, Hammer, Plus, PenLine, Store, Trees, Home, LayoutGrid, Paintbrush, Droplets, Zap, Boxes,
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft:       { label: 'Draft',       color: Colors.warning,        bg: Colors.warningLight },
  estimated:   { label: 'Estimated',   color: Colors.success,        bg: Colors.successLight },
  in_progress: { label: 'In Progress', color: Colors.info,           bg: Colors.infoLight },
  // 'completed' = punch / closeout phase — work delivered, paperwork in
  // progress. Brand-orange reads as "done, finalize me" vs. the dead grey
  // it had before. 'closed' is the truly-archived state and stays muted.
  completed:   { label: 'Completed',   color: Colors.primary,        bg: Colors.primary + '14' },
  closed:      { label: 'Closed',      color: Colors.textSecondary,  bg: Colors.fillTertiary },
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
  const Icon = ICON_MAP[TYPE_ICON_MAP[project.type]] ?? Building2;
  const status = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.draft;

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
        <Icon size={18} color={Colors.primary} strokeWidth={1.8} />
      </View>

      <View style={styles.nameCol}>
        <Text style={styles.name} numberOfLines={1}>{project.name}</Text>
        {project.location ? (
          <View style={styles.locationRow}>
            <MapPin size={11} color={Colors.textMuted} />
            <Text style={styles.locationText} numberOfLines={1}>{project.location}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.metaCol}>
        <Text style={styles.metaLabel}>Area</Text>
        <Text style={styles.metaValue} numberOfLines={1}>
          {project.squareFootage > 0 ? `${project.squareFootage.toLocaleString()} sf` : '—'}
        </Text>
      </View>

      <View style={styles.metaCol}>
        <Text style={styles.metaLabel}>Quality</Text>
        <Text style={styles.metaValue} numberOfLines={1}>
          {project.quality ? project.quality.charAt(0).toUpperCase() + project.quality.slice(1) : '—'}
        </Text>
      </View>

      <View style={styles.burnCol}>
        <View style={styles.burnHeaderRow}>
          <Text style={styles.metaLabel}>Burn</Text>
          <Text style={[styles.burnPctText, burnIsHigh && { color: Colors.warning }]}>
            {hasEstimate ? `${burnPct}%` : '—'}
          </Text>
        </View>
        <View style={styles.burnTrack}>
          <View
            style={[
              styles.burnFill,
              {
                width: `${burnPct}%`,
                backgroundColor: burnIsHigh ? Colors.warning : Colors.primary,
              },
            ]}
          />
        </View>
      </View>

      <View style={[styles.metaCol, styles.totalCol]}>
        <Text style={styles.metaLabel}>Estimate</Text>
        <Text style={[styles.totalValue, !hasEstimate && styles.totalValueDim]} numberOfLines={1}>
          {hasEstimate ? formatMoney(estimateTotal) : '—'}
        </Text>
      </View>

      <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
        <View style={[styles.statusDot, { backgroundColor: status.color }]} />
        <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
      </View>

      <ChevronRight size={16} color={Colors.textMuted} strokeWidth={1.8} />
    </TouchableOpacity>
  );
});

export default ProjectRow;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 14,
    backgroundColor: Colors.surface,
  },
  rowWithDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(60,60,67,0.06)',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: Tokens.radius.sm,
    // Tinted-primary background instead of flat grey. Same treatment
    // as the phone ProjectCard so the type icon reads as a confident
    // brand mark, not a "deactivated" UI element. The icon itself is
    // already Colors.primary; pairing it with primary+12 alpha ties
    // the two together visually.
    backgroundColor: Colors.primary + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameCol: {
    flex: 2.2,
    minWidth: 0,
    gap: Tokens.spacing.hairline,
  },
  name: {
    fontSize: Type.body.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.2,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  locationText: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
  },
  metaCol: {
    flex: 1,
    minWidth: 80,
    gap: Tokens.spacing.hairline,
  },
  totalCol: {
    alignItems: 'flex-end',
  },
  metaLabel: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    fontWeight: '500' as const,
    letterSpacing: 0.2,
  },
  metaValue: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  totalValue: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800' as const,
    color: Colors.primary,
    letterSpacing: -0.2,
  },
  totalValueDim: {
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  burnCol: {
    flex: 1.2,
    minWidth: 110,
    gap: Tokens.spacing.xxs,
  },
  burnHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  burnPctText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  burnTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.fillTertiary,
    overflow: 'hidden',
  },
  burnFill: {
    height: 4,
    borderRadius: 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: Tokens.spacing.xxs,
    borderRadius: 999,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    letterSpacing: 0.1,
  },
});
