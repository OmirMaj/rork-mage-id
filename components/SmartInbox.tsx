// ============================================================================
// components/SmartInbox.tsx
//
// "Inbox" card for the home screen — the dismissible actionable-items feed.
// (Scoped label: this is the Smart Inbox row count, NOT the canonical
// "needs attention" number — that lives in useBrainWatch and drives the
// Brain Watch card, Summary pill, and tab badge. Sim-audit #15.)
// Renders rule-derived items from
// useSmartInbox() grouped into filter chips (All / Money / Schedule / Safety).
// Default collapsed to top 5; "Show all" expands to the full list.
//
// Each row is tappable — routes to the source EntityRef via
// useEntityNavigation(). Long-press dismisses the item (soft-delete, persisted
// in AsyncStorage by the hook).
// ============================================================================

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  AlertTriangle, CheckCircle2, Clock, DollarSign, HardHat, ChevronDown,
  X as XIcon,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useSmartInbox, type InboxItem, type InboxCategory } from '@/hooks/useSmartInbox';
import { useEntityNavigation } from '@/hooks/useEntityNavigation';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

type FilterKey = 'all' | InboxCategory;

const DEFAULT_TOP = 5;

const SEVERITY_COLOR: Record<1 | 2 | 3, string> = {
  1: '#8E8E93',
  2: '#FF9500',
  3: '#FF3B30',
};

const CATEGORY_META: Record<FilterKey, { label: string; Icon: typeof AlertTriangle }> = {
  all: { label: 'All', Icon: AlertTriangle },
  money: { label: 'Money', Icon: DollarSign },
  schedule: { label: 'Schedule', Icon: Clock },
  safety: { label: 'Safety', Icon: HardHat },
  other: { label: 'Other', Icon: AlertTriangle },
};

export default function SmartInbox() {
  const { items, byCategory, counts, dismiss, isReady } = useSmartInbox();
  const { navigateTo } = useEntityNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [filter, setFilter] = useState<FilterKey>('all');
  const [expanded, setExpanded] = useState(false);

  const visible = useMemo<InboxItem[]>(() => {
    if (filter === 'all') return items;
    if (filter === 'other') return byCategory.other;
    return byCategory[filter];
  }, [filter, items, byCategory]);

  const shown = expanded ? visible : visible.slice(0, DEFAULT_TOP);
  const hiddenCount = visible.length - shown.length;

  const onRowPress = useCallback((item: InboxItem) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    navigateTo(item.ref);
  }, [navigateTo]);

  const onRowDismiss = useCallback((item: InboxItem) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    dismiss(item.id);
  }, [dismiss]);

  if (!isReady) return null;

  if (items.length === 0) {
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Inbox</Text>
          <Text style={styles.headerCount}>0</Text>
        </View>
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <CheckCircle2 size={20} color={colors.success} strokeWidth={2.2} />
          </View>
          <Text style={styles.emptyText}>All caught up.</Text>
          <Text style={styles.emptySub}>Nothing urgent across your projects.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Inbox</Text>
        <Text style={styles.headerCount}>· {counts.all}</Text>
      </View>

      <View style={styles.chipRow}>
        {(['all', 'money', 'schedule', 'safety'] as FilterKey[]).map(key => {
          const meta = CATEGORY_META[key];
          const count = counts[key];
          const active = filter === key;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setFilter(key)}
              style={[styles.chip, active && styles.chipActive]}
              activeOpacity={0.7}
              testID={`inbox-chip-${key}`}
            >
              <meta.Icon size={12} color={active ? '#FFFFFF' : colors.textSecondary} strokeWidth={2} />
              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                {meta.label}
              </Text>
              {count > 0 && (
                <View style={[styles.chipCountWrap, active && styles.chipCountWrapActive]}>
                  <Text style={[styles.chipCount, active && styles.chipCountActive]}>{count}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {shown.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>No items in this filter.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {shown.map(item => (
            <InboxRow
              key={item.id}
              item={item}
              onPress={onRowPress}
              onDismiss={onRowDismiss}
              styles={styles}
              colors={colors}
            />
          ))}
        </View>
      )}

      {hiddenCount > 0 && (
        <TouchableOpacity
          onPress={() => setExpanded(true)}
          style={styles.showAllBtn}
          activeOpacity={0.7}
          testID="inbox-show-all"
        >
          <Text style={styles.showAllText}>Show {hiddenCount} more</Text>
          <ChevronDown size={14} color={colors.accent} strokeWidth={2.2} />
        </TouchableOpacity>
      )}
      {expanded && visible.length > DEFAULT_TOP && (
        <TouchableOpacity
          onPress={() => setExpanded(false)}
          style={styles.showAllBtn}
          activeOpacity={0.7}
          testID="inbox-collapse"
        >
          <Text style={styles.showAllText}>Collapse</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

interface InboxRowProps {
  item: InboxItem;
  onPress: (i: InboxItem) => void;
  onDismiss: (i: InboxItem) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}

function InboxRow({ item, onPress, onDismiss, styles, colors }: InboxRowProps) {
  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={styles.rowMain}
        onPress={() => onPress(item)}
        onLongPress={() => onDismiss(item)}
        activeOpacity={0.7}
        testID={`inbox-row-${item.id}`}
      >
        <View style={[styles.severityDot, { backgroundColor: SEVERITY_COLOR[item.severity] }]} />
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
          {item.subtitle ? (
            <Text style={styles.rowSub} numberOfLines={1}>{item.subtitle}</Text>
          ) : null}
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.dismissBtn}
        onPress={() => onDismiss(item)}
        hitSlop={{ top: 8, left: 8, right: 8, bottom: 8 }}
        testID={`inbox-dismiss-${item.id}`}
      >
        <XIcon size={14} color={colors.textSecondary} strokeWidth={2} />
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: t.line,
  },
  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'baseline' as const,
    gap: 6,
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: Type.body.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    letterSpacing: -0.3,
  },
  headerCount: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
  },
  chipRow: {
    flexDirection: 'row' as const,
    gap: 6,
    marginBottom: 12,
    flexWrap: 'wrap' as const,
  },
  chip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.surfaceAlt,
  },
  chipActive: {
    backgroundColor: t.accent,
  },
  chipLabel: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
  },
  chipLabelActive: {
    color: '#FFFFFF',
  },
  chipCountWrap: {
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 9,
    backgroundColor: t.line,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  chipCountWrapActive: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  chipCount: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: t.textSecondary,
  },
  chipCountActive: {
    color: '#FFFFFF',
  },
  list: {
    gap: 2,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.line,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
  },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  rowSub: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    marginTop: 2,
  },
  dismissBtn: {
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  showAllBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 4,
    paddingVertical: 10,
    marginTop: 4,
  },
  showAllText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.accent,
  },
  emptyWrap: {
    alignItems: 'center' as const,
    paddingVertical: 20,
  },
  emptyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.successSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  emptySub: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    marginTop: 2,
  },
});
