// components/schedule/ScheduleRowMenu.tsx — row/bar context menu for the scheduler.
// Cross-platform (iOS ActionSheetIOS / web+Android modal), mirrors EntityActionSheet.
//
// Usage: call useScheduleRowMenu()(title, actions) on a row/bar long-press or
// right-click. On iOS it fires the native sheet imperatively and returns true;
// on web/Android it returns false and the caller opens the <ScheduleRowMenu>
// modal with the same actions. This keeps the trigger gesture (long-press /
// onContextMenu) distinct from the Gantt drag PanResponder.
//
// Desktop web (wave 6c): a right-click passes `anchor` (the pointer's page
// position) and the menu opens THERE as a 220-280 px popover over a
// transparent backdrop, the way every desktop context menu does. Before, it
// was a full-width bottom sheet under a dimmed page — on a 1512 px MacBook a
// 1,272 px strip at the bottom of the screen, far from the row he clicked.
// Without an anchor (a long-press, the phone, Android) it is today's sheet.
import { useState } from 'react';
import { Platform, ActionSheetIOS, Dimensions, Modal, Pressable, View, Text, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Layout, Shadow, Tokens } from '@/constants/designTokens';
import { useIsDesktopWeb } from '@/components/ui/desktop';
import { cardSurface } from '@/components/ui';
import { SheetOverlay, useSheetDialogScope, useSheetFrame } from '@/components/ui/Sheet';

export interface RowMenuAction { key: string; label: string; destructive?: boolean; onPress: () => void }

/** Where a right-click happened, in page (window) coordinates. */
export interface RowMenuAnchor { x: number; y: number }

export function useScheduleRowMenu() {
  // Imperative helper for iOS native sheet; web/android use the <ScheduleRowMenu> modal.
  return (title: string, actions: RowMenuAction[]) => {
    if (Platform.OS === 'ios') {
      const options = [...actions.map(a => a.label), 'Cancel'];
      const destructiveIndex = actions.findIndex(a => a.destructive);
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          options,
          cancelButtonIndex: options.length - 1,
          destructiveButtonIndex: destructiveIndex >= 0 ? destructiveIndex : undefined,
        },
        (i) => { if (i < actions.length) actions[i].onPress(); },
      );
      return true; // handled imperatively
    }
    return false; // caller should open the modal instead
  };
}

/** Title row + one row per action, before the popover has measured itself. */
const POPOVER_TITLE_H = 32;
const POPOVER_ITEM_H = 34;
const POPOVER_EDGE = 8;

/**
 * Where the popover goes: at the pointer, pulled back inside the window so a
 * right-click near the right or bottom edge never opens a clipped menu.
 *   left = min(x, innerWidth − Layout.menu.maxWidth − 8)
 *   top  = min(y, innerHeight − h − 8)
 */
export function rowMenuPopoverPosition(
  anchor: RowMenuAnchor,
  menuHeight: number,
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const left = Math.min(anchor.x, viewport.width - Layout.menu.maxWidth - POPOVER_EDGE);
  const top = Math.min(anchor.y, viewport.height - menuHeight - POPOVER_EDGE);
  return { left: Math.max(POPOVER_EDGE, left), top: Math.max(POPOVER_EDGE, top) };
}

function windowViewport(): { width: number; height: number } {
  const w = typeof window !== 'undefined' ? (window as { innerWidth?: number; innerHeight?: number }) : undefined;
  const d = Dimensions.get('window');
  return { width: w?.innerWidth || d.width, height: w?.innerHeight || d.height };
}

export function ScheduleRowMenu({ visible, title, actions, onClose, anchor }: {
  visible: boolean; title: string; actions: RowMenuAction[]; onClose: () => void;
  /** Desktop web: open as a popover at this page position (a right-click). */
  anchor?: RowMenuAnchor;
}) {
  const styles = useThemedStyles(makeStyles);
  const isDesktopWeb = useIsDesktopWeb();
  const [measuredH, setMeasuredH] = useState<number | null>(null);
  // The open menu is a dialog to the shortcut registry: while it is up, the
  // page behind it hears no keys. The popover claims it here; the sheet (no
  // anchor) claims it through its frame, which on desktop also centres it as
  // a dialog card instead of a full-width strip. RN-web's Modal closes both on
  // Escape through onRequestClose.
  useSheetDialogScope(visible && isDesktopWeb && !!anchor);
  const fMenu = useSheetFrame('dialog', { visible: visible && !(isDesktopWeb && anchor), animationType: 'fade' });

  if (isDesktopWeb && anchor) {
    const h = measuredH ?? POPOVER_TITLE_H + actions.length * POPOVER_ITEM_H + 12;
    const { left, top } = rowMenuPopoverPosition(anchor, h, windowViewport());
    const onMenuLayout = (e: LayoutChangeEvent) => {
      const next = Math.round(e.nativeEvent.layout.height);
      setMeasuredH((prev) => (prev === next ? prev : next));
    };
    return (
      <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
        <Pressable
          style={styles.popoverBackdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          // A second right-click elsewhere closes this menu instead of opening
          // the browser's own on top of it.
          {...({ onContextMenu: (e: { preventDefault?: () => void }) => { e?.preventDefault?.(); onClose(); } } as object)}
        />
        <View
          style={[styles.popover, { left, top, minWidth: Layout.menu.minWidth, maxWidth: Layout.menu.maxWidth }]}
          onLayout={onMenuLayout}
          accessibilityRole="menu"
          testID="schedule-row-menu-popover"
        >
          <Text style={styles.popoverTitle} numberOfLines={1}>{title}</Text>
          {actions.map(a => (
            <Pressable
              key={a.key}
              style={({ hovered }: { hovered?: boolean }) => [styles.popoverItem, hovered && styles.popoverItemHover]}
              onPress={() => { onClose(); a.onPress(); }}
              accessibilityRole="menuitem"
              accessibilityLabel={a.label}
            >
              <Text style={[styles.popoverItemText, a.destructive && styles.destructive]} numberOfLines={1}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType={fMenu.animationType} onRequestClose={onClose}>
      <SheetOverlay frame={fMenu}>
      <Pressable style={[styles.backdrop, fMenu.backdrop]} onPress={onClose} />
      <View style={[styles.sheet, fMenu.card]}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {actions.map(a => (
          <Pressable key={a.key} style={styles.item} onPress={() => { onClose(); a.onPress(); }}>
            <Text style={[styles.itemText, a.destructive && styles.destructive]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
      </SheetOverlay>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: Colors.overlay },
  sheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: t.surface, borderTopLeftRadius: Tokens.radius.lg, borderTopRightRadius: Tokens.radius.lg, paddingVertical: 8 },
  title: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.textSecondary, paddingHorizontal: 18, paddingVertical: 8 },
  item: { paddingHorizontal: 18, paddingVertical: 13 },
  itemText: { fontSize: Type.body.fontSize, fontWeight: '600', color: t.text },
  destructive: { color: t.danger },

  // ---- Desktop web popover (anchored at the pointer) ----
  // Transparent: a context menu does not dim the page it belongs to.
  popoverBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent' },
  popover: {
    position: 'absolute',
    ...cardSurface(t, { radius: 'md', pad: 'none' }),
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
    ...Shadow.heavy,
  },
  popoverTitle: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textSecondary, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 4 },
  popoverItem: { paddingHorizontal: 12, height: POPOVER_ITEM_H, justifyContent: 'center' },
  popoverItemHover: { backgroundColor: t.surfaceAlt },
  popoverItemText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text },
});
