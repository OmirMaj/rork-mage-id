// ============================================================================
// components/DesktopActionRail.tsx
//
// Right-rail "Action Required" column shown next to the main content at very
// wide desktop widths (>= 1280px). Mirrors the SaaS-dashboard reference layout
// the user shared — sidebar / main / rail — so the eye flows: where am I →
// what am I looking at → what needs me right now.
//
// Data source is the same useSmartInbox() hook the inline SmartInbox uses; we
// just render a slimmer rail-shaped variant. The layout file hides the inline
// SmartInbox when this rail is mounted so the same items don't render twice.
//
// Width gate: 1280px MAIN VIEWPORT (not content width). Below that, the rail
// is dropped entirely and the inline SmartInbox takes over. This keeps narrow
// laptops (1024-1280) from getting cramped 3-column layouts.
// ============================================================================

import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AlertTriangle, ChevronRight, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useSmartInbox, type InboxItem } from '@/hooks/useSmartInbox';
import { useEntityNavigation } from '@/hooks/useEntityNavigation';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const SEVERITY_COLOR: Record<1 | 2 | 3, string> = {
  1: '#8E8E93',
  2: '#FF9500',
  3: '#FF3B30',
};

const RAIL_WIDTH = 300;

interface Props {
  width?: number;
}

const DesktopActionRail = React.memo(function DesktopActionRail({ width = RAIL_WIDTH }: Props) {
  const { items, isReady } = useSmartInbox();
  const { navigateTo } = useEntityNavigation();

  const top = useMemo(() => items.slice(0, 8), [items]);

  const onRowPress = useCallback((item: InboxItem) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    navigateTo(item.ref);
  }, [navigateTo]);

  if (!isReady) return null;

  return (
    <View style={[styles.rail, { width }]}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Action Required</Text>
        {items.length > 0 ? (
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{items.length}</Text>
          </View>
        ) : null}
      </View>

      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIconWrap}>
            <CheckCircle2 size={22} color={Colors.success} strokeWidth={1.8} />
          </View>
          <Text style={styles.emptyTitle}>All caught up</Text>
          <Text style={styles.emptySubtitle}>Nothing urgent across your projects.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.listWrap}>
          {top.map(item => (
            <TouchableOpacity
              key={item.id}
              style={styles.row}
              onPress={() => onRowPress(item)}
              activeOpacity={0.7}
              testID={`rail-row-${item.id}`}
            >
              <View style={[styles.severityDot, { backgroundColor: SEVERITY_COLOR[item.severity] }]} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                {item.subtitle ? (
                  <Text style={styles.rowSubtitle} numberOfLines={1}>{item.subtitle}</Text>
                ) : null}
              </View>
              <ChevronRight size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          ))}
          {items.length > top.length && (
            <Text style={styles.moreText}>+{items.length - top.length} more</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
});

export default DesktopActionRail;

const styles = StyleSheet.create({
  rail: {
    backgroundColor: Colors.background,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(60,60,67,0.08)',
    paddingHorizontal: Tokens.spacing.md,
    paddingTop: Tokens.spacing.xl,
    paddingBottom: Tokens.spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Tokens.spacing.xs,
    paddingHorizontal: Tokens.spacing.xxs,
    marginBottom: 14,
  },
  headerTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.1,
    flex: 1,
  },
  countPill: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: Tokens.spacing.xs,
    borderRadius: 11,
    backgroundColor: Colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countPillText: {
    color: Colors.surface,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.1,
  },
  emptyState: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    paddingVertical: 28,
    paddingHorizontal: Tokens.spacing.md,
    alignItems: 'center',
    gap: Tokens.spacing.xs,
  },
  emptyIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Tokens.spacing.xxs,
  },
  emptyTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  emptySubtitle: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  listWrap: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    paddingVertical: Tokens.spacing.xxs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: Tokens.spacing.sm,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(60,60,67,0.06)',
  },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: Colors.text,
    letterSpacing: -0.1,
  },
  rowSubtitle: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textSecondary,
    marginTop: Tokens.spacing.hairline,
  },
  moreText: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textSecondary,
    fontWeight: '500' as const,
    paddingVertical: 10,
    paddingHorizontal: 14,
    textAlign: 'center',
  },
});
