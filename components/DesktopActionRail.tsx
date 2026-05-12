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
import { useSmartInbox, type InboxItem } from '@/hooks/useSmartInbox';
import { useEntityNavigation } from '@/hooks/useEntityNavigation';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

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
            <CheckCircle2 size={22} color={colors.success} strokeWidth={1.8} />
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
              <ChevronRight size={14} color={colors.textMuted} />
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

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  rail: {
    backgroundColor: t.bg,
    borderLeftWidth: 1,
    borderLeftColor: t.line,
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 4,
    marginBottom: 14,
  },
  headerTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    letterSpacing: -0.1,
    flex: 1,
  },
  countPill: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.danger,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  countPillText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.1,
  },
  emptyState: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1,
    borderColor: t.line,
    paddingVertical: 28,
    paddingHorizontal: 16,
    alignItems: 'center' as const,
    gap: 8,
  },
  emptyIconWrap: {
    width: 40,
    height: 40,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.successSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: t.text,
  },
  emptySubtitle: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    textAlign: 'center' as const,
  },
  listWrap: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1,
    borderColor: t.line,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
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
    color: t.text,
    letterSpacing: -0.1,
  },
  rowSubtitle: {
    fontSize: Type.caption2.fontSize,
    color: t.textSecondary,
    marginTop: 2,
  },
  moreText: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    fontWeight: '500' as const,
    paddingVertical: 10,
    paddingHorizontal: 14,
    textAlign: 'center' as const,
  },
});
