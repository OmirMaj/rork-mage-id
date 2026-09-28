// components/sidebar/SidebarActionRequiredRow.tsx — the sidebar footer's
// "Action Required" row (wave 6d, d6r lane K3).
//
// The attention list (overdue RFIs, unbilled work, expiring certs…) lived only
// on Home: in the 300 px rail at 1280+ and as inline cards below that. This row
// puts it one click away on EVERY page: it opens the list in the shell dock
// beside the page (DesktopActionRail variant="dock", ATTENTION_DOCK_ID) and a
// second press closes it. Named 'Action Required' because WORKSPACE already has
// an 'Inbox' (the notifications inbox).
//
// The pill is the Home tab's badge — attentionBadgeLabel over useBrainWatch():
// '!' when the read behind it failed (unknown, not zero), '99+' past 99, and no
// pill at 0. Contract D9, named exception 1: useBrainWatch has no loaded flag,
// so before invoices, COs, permits, punch items and safety certs load this can
// UNDERCOUNT — exactly as the Home tab badge and the rail do. It never claims
// more than it knows.
//
// DesktopSidebar renders it only for a contractor on desktop web
// (`!isMinimalPersona && isDesktopWeb`): first in the footer when expanded, and
// as a rail square before Settings when collapsed. The rail paints its own dark
// ground in both themes, so the inks below are the sidebar's RAIL values.

import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, type PressableStateCallbackType } from 'react-native';
import { CircleAlert } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useBrainWatch } from '@/hooks/useBrainWatch';
import { attentionBadgeLabel } from '@/utils/sidebarRail';
import { SIDE_PANEL_DEFAULT } from '@/utils/splitViewLayout';
import { ATTENTION_DOCK_ID, useShellDock } from '@/components/desktop/ShellDock';
import DesktopActionRail from '@/components/DesktopActionRail';
import { Layout, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { RAIL } from '@/components/sidebar/RailHoverPill';

/** The sidebar's RAIL inks (it paints RAIL.ground in both themes), plus the
 *  footer pill's fill. */
const INK = {
  ink: RAIL.ink,
  label: RAIL.label,
  hover: RAIL.hover,
  pill: 'rgba(255,255,255,0.10)',
} as const;

/** Pressable's state plus the `hovered` flag react-native-web adds. */
type RowState = PressableStateCallbackType & { hovered?: boolean };

export function SidebarActionRequiredRow({ collapsed = false }: { collapsed?: boolean }) {
  const { colors } = useTheme();
  const { total, sourceFailed } = useBrainWatch();
  const dock = useShellDock();
  const badge = attentionBadgeLabel(total, sourceFailed);
  const open = dock.id === ATTENTION_DOCK_ID && dock.showing;

  const onPress = useCallback(() => {
    if (dock.id === ATTENTION_DOCK_ID && dock.showing) {
      dock.close();
      return;
    }
    // A route whose dock host would not draw it (none today: the sidebar only
    // renders where the host is visible) — do nothing rather than dock it
    // invisibly.
    if (!dock.canShow(ATTENTION_DOCK_ID)) return;
    dock.open(<DesktopActionRail variant="dock" />, { id: ATTENTION_DOCK_ID, title: 'Action required', width: SIDE_PANEL_DEFAULT });
  }, [dock]);

  const spoken = badge === '!'
    ? ', the count could not load'
    : badge
      ? `, ${badge} need${badge === '1' ? 's' : ''} attention`
      : '';
  const a11y = `Action required${spoken}, opens beside the page${open ? ', open' : ''}`;

  if (collapsed) {
    return (
      <Pressable
        style={(s) => [
          styles.railSquare,
          open ? { backgroundColor: colors.accentFill } : (s as RowState).hovered ? styles.hovered : null,
        ]}
        onPress={onPress}
        testID="sidebar-action-required"
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
      >
        <CircleAlert size={18} color={open ? INK.ink : INK.label} strokeWidth={open ? 2.2 : 1.8} />
        {badge ? <View style={[styles.railDot, { backgroundColor: colors.danger }]} testID="sidebar-action-required-dot" /> : null}
      </Pressable>
    );
  }

  return (
    <Pressable
      style={(s) => [
        styles.row,
        open ? { backgroundColor: colors.accentFill } : (s as RowState).hovered ? styles.hovered : null,
      ]}
      onPress={onPress}
      testID="sidebar-action-required"
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ expanded: open }}
      aria-expanded={open}
    >
      {(state) => {
        const hovered = (state as RowState).hovered;
        return (
          <>
            <CircleAlert size={16} color={open || hovered ? INK.ink : INK.label} strokeWidth={open ? 2.2 : 1.8} />
            <Text style={[styles.rowLabel, (open || hovered) && styles.rowLabelLit]} numberOfLines={1}>
              Action required
            </Text>
            {badge ? (
              <View style={styles.countPill} testID="sidebar-action-required-pill">
                <Text style={styles.countPillLabel}>{badge}</Text>
              </View>
            ) : null}
          </>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // DesktopSidebar's navItem: a 32 px row.
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.md,
    marginBottom: 1,
  },
  hovered: {
    backgroundColor: INK.hover,
  },
  rowLabel: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '500' as const,
    color: INK.label,
    flexShrink: 1,
  },
  rowLabelLit: {
    color: INK.ink,
  },
  countPill: {
    marginLeft: 'auto' as const,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: Tokens.radius.full,
    backgroundColor: INK.pill,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  countPillLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: INK.label,
  },
  // DesktopSidebar's railItem: the 40 px square.
  railSquare: {
    width: Layout.control.md,
    height: Layout.control.md,
    borderRadius: Tokens.radius.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  railDot: {
    position: 'absolute' as const,
    top: 6,
    right: 6,
    width: 6,
    height: 6,
    borderRadius: Tokens.radius.full,
  },
});
