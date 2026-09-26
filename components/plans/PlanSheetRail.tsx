// components/plans/PlanSheetRail.tsx — the plan viewer's sheet list, down the
// left edge of the canvas on desktop web (wave 6d, lane P1).
//
// A PM flips A-101 → A-102 → S-201 all day. The viewer had no way to reach the
// next sheet without going Back to the list; on a desktop the job's sheets now
// sit beside the drawing, the open one marked, and ↑ / ↓ flip (the viewer owns
// the keys — utils/plans/planRail adjacentSheetId). The list and its order come
// from railSheets (the live set, plus the open sheet if it is superseded).
//
// Desktop only: `if (!isDesktop) return null` — a phone never mounts a row.
// Colours are theme tokens; the active row is t.surfaceAlt with a 3 px accent
// edge (the accent is never a fill), a superseded row is dimmed and says so.

import React, { useCallback, useEffect, useRef } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native';
import { FileImage, PanelLeftClose } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Layout, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { useIsDesktop } from '@/components/ui/desktop';
import { planSheetImageState } from '@/utils/planSheetImageCore';
import type { PlanSheet } from '@/types';

export interface PlanSheetRailProps {
  sheets: PlanSheet[];
  activeId: string;
  onPick: (id: string) => void;
  onClose: () => void;
  sheetUri: (s: PlanSheet) => string;
}

export default function PlanSheetRail({ sheets, activeId, onPick, onClose, sheetUri }: PlanSheetRailProps) {
  const isDesktop = useIsDesktop();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const scrollRef = useRef<ScrollView>(null);
  // Each row's y inside the list, so the open sheet can be scrolled into view
  // on mount and whenever the open sheet changes.
  const rowY = useRef<Map<string, number>>(new Map());
  const shownFor = useRef<string | null>(null);
  const reveal = useCallback((id: string) => {
    const y = rowY.current.get(id);
    if (y == null) return;
    // One row of context above the open sheet.
    scrollRef.current?.scrollTo({ y: Math.max(0, y - Layout.control.lg), animated: false });
    shownFor.current = id;
  }, []);
  const onRowLayout = useCallback((id: string, e: LayoutChangeEvent) => {
    rowY.current.set(id, e.nativeEvent.layout.y);
    if (id === activeId && shownFor.current !== activeId) reveal(id);
  }, [activeId, reveal]);
  useEffect(() => {
    if (shownFor.current !== activeId) reveal(activeId);
  }, [activeId, reveal]);

  if (!isDesktop) return null;

  return (
    <View style={styles.rail} testID="plan-sheet-rail">
      <View style={styles.railHeader}>
        <Text style={styles.railHeading} numberOfLines={1}>{`Sheets · ${sheets.length}`}</Text>
        <TouchableOpacity
          onPress={onClose}
          style={styles.railClose}
          accessibilityRole="button"
          accessibilityLabel="Hide sheet list"
          testID="plan-rail-close"
        >
          <PanelLeftClose size={16} color={colors.textSecondary} strokeWidth={1.75} />
        </TouchableOpacity>
      </View>
      <ScrollView ref={scrollRef} style={styles.railList}>
        {sheets.map((s) => {
          const selected = s.id === activeId;
          const missing = planSheetImageState(s) === 'missing';
          return (
            <Pressable
              key={s.id}
              onPress={() => onPick(s.id)}
              onLayout={(e) => onRowLayout(s.id, e)}
              style={({ pressed }) => [
                styles.railRow,
                selected && styles.railRowActive,
                s.superseded && styles.railRowSuperseded,
                pressed && styles.railRowPressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${s.sheetNumber ? `${s.sheetNumber}, ` : ''}${s.name}${s.superseded ? ', superseded' : ''}`}
              testID={`plan-rail-${s.id}`}
            >
              <View style={styles.railThumb}>
                {missing
                  ? <FileImage size={18} color={colors.textMuted} strokeWidth={1.75} />
                  : <Image source={{ uri: sheetUri(s) }} style={styles.railThumbImg} resizeMode="cover" />}
              </View>
              <View style={styles.railText}>
                {s.sheetNumber ? <Text style={styles.railNumber} numberOfLines={1}>{s.sheetNumber}</Text> : null}
                <Text style={styles.railName} numberOfLines={2}>{s.name}</Text>
                {s.superseded ? <Text style={styles.railSupersededWord}>Superseded</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  rail: {
    width: Layout.column.index,
    borderRightWidth: 1,
    borderRightColor: t.line,
    backgroundColor: t.surface,
  },
  railHeader: {
    height: Layout.control.row,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: Layout.cardPad,
    paddingRight: Layout.rowGap,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  railHeading: {
    color: t.textSecondary,
    fontSize: Type.caption1.fontSize,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  railClose: { padding: 6, borderRadius: Tokens.radius.sm },
  railList: { flex: 1 },
  railRow: {
    minHeight: Layout.control.lg + 2 * Layout.rowGap,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Layout.rowGap,
    paddingVertical: Layout.rowGap,
    paddingRight: Layout.rowGap,
    paddingLeft: Layout.rowGap + 1,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  railRowActive: { backgroundColor: t.surfaceAlt, borderLeftColor: t.accent },
  railRowSuperseded: { opacity: 0.45 },
  railRowPressed: { backgroundColor: t.surfaceAlt },
  railThumb: {
    width: Layout.control.lg,
    height: Layout.control.lg,
    borderRadius: Tokens.radius.sm,
    overflow: 'hidden',
    backgroundColor: t.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railThumbImg: { width: '100%', height: '100%' },
  railText: { flex: 1, minWidth: 0 },
  railNumber: { color: t.accent, fontSize: Type.caption2.fontSize, fontWeight: '700', letterSpacing: 0.4 },
  railName: { color: t.text, fontSize: Type.caption1.fontSize, fontWeight: '500', marginTop: 1 },
  railSupersededWord: { color: t.warningLabel, fontSize: Type.caption2.fontSize, fontWeight: '700', marginTop: 2, textTransform: 'uppercase' },
});
