// ============================================================================
// components/SmartInbox.tsx
//
// "Needs attention" card for the home screen. Renders rule-derived items from
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
import { Colors } from '@/constants/colors';
import { useSmartInbox, type InboxItem, type InboxCategory } from '@/hooks/useSmartInbox';
import { useEntityNavigation } from '@/hooks/useEntityNavigation';

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
          <Text style={styles.headerTitle}>Needs attention</Text>
          <Text style={styles.headerCount}>0</Text>
        </View>
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <CheckCircle2 size={20} color="#34C759" strokeWidth={2.2} />
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
        <Text style={styles.headerTitle}>Needs attention</Text>
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
              <meta.Icon size={12} color={active ? Colors.surface : Colors.textSecondary} strokeWidth={2} />
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
            <InboxRow key={item.id} item={item} onPress={onRowPress} onDismiss={onRowDismiss} />
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
          <ChevronDown size={14} color={Colors.primary} strokeWidth={2.2} />
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

function InboxRow({
  item, onPress, onDismiss,
}: { item: InboxItem; onPress: (i: InboxItem) => void; onDismiss: (i: InboxItem) => void }) {
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
        <XIcon size={14} color={Colors.textSecondary} strokeWidth={2} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.3,
  },
  headerCount: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Colors.fillTertiary,
  },
  chipActive: {
    backgroundColor: Colors.primary,
  },
  chipLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  chipLabelActive: {
    color: Colors.surface,
  },
  chipCountWrap: {
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipCountWrapActive: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  chipCount: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  chipCountActive: {
    color: Colors.surface,
  },
  list: {
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
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
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  rowSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  dismissBtn: {
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  showAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    marginTop: 4,
  },
  showAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  emptyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  emptySub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
});
