// components/schedule/SchedulerMenuBar.tsx — Plan / Track / Share menu bar.
// Replaces the 6-tab strip + the toolbar's More overflow with one grouped
// desktop-menubar grammar. View items switch the active tab; action items call
// handlers owned by schedule-pro (passed via `actions`).
//
// Wave 6c: each dropdown opens UNDER ITS OWN TRIGGER (measured with
// measureInWindow), 220-280 px wide, over a transparent backdrop. It used to
// open at a fixed `top: 96, left: 12` over a dimming scrim, so Track and Share
// opened under Plan and the whole page went grey for a menu.
// `actionsOnly` drops the view items (the Pro toolbar owns view switching);
// `inline` drops the bar's own chrome so the menus can sit in a toolbar.
import { useRef, useState } from 'react';
import { View, Text, Pressable, Modal, StyleSheet, useWindowDimensions } from 'react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Layout, Shadow, Tokens } from '@/constants/designTokens';
import { useHotkeys, type HotkeyBinding } from '@/hooks/useHotkeys';
import type { SchedulerTabKey } from './SchedulerTabShell';

export interface SchedulerActions {
  onAddTask: () => void; onImport: () => void; onReflow: () => void; onClosures: () => void;
  onCriticalPath: () => void; onBaseline: () => void; onWeather: () => void;
  onLevelResources?: () => void; onHistory?: () => void;
  onExport: () => void; onShare: () => void; onAI: () => void;
  /** Open the classic Today / Lookahead schedule. Shown under Share only when supplied. */
  openClassic?: () => void;
}
/** `onlyIfPresent`: the item is listed only when the screen supplies that handler. */
type Item = { label: string; view?: SchedulerTabKey; action?: keyof SchedulerActions; divider?: boolean; onlyIfPresent?: boolean };
const MENUS: { key: string; label: string; items: Item[] }[] = [
  { key: 'plan', label: 'Plan', items: [
    { label: 'Timeline', view: 'timeline' }, { label: 'List', view: 'list' }, { label: 'Board', view: 'board' },
    { label: '', divider: true },
    { label: 'Add task', action: 'onAddTask' }, { label: 'Import', action: 'onImport' },
    { label: 'Re-plan', action: 'onReflow' }, { label: 'Closures', action: 'onClosures' },
  ]},
  { key: 'track', label: 'Track', items: [
    { label: 'Overview', view: 'overview' }, { label: 'Workload', view: 'workload' }, { label: 'Calendar', view: 'calendar' },
    { label: '', divider: true },
    { label: 'Critical path', action: 'onCriticalPath' }, { label: 'Fix overloads', action: 'onLevelResources' }, { label: 'History', action: 'onHistory' }, { label: 'Baseline', action: 'onBaseline' }, { label: 'Weather re-plan', action: 'onWeather' },
  ]},
  { key: 'share', label: 'Share', items: [
    { label: 'Export', action: 'onExport' }, { label: 'Share link', action: 'onShare' }, { label: 'AI assist', action: 'onAI' },
    { label: 'Today & lookahead (classic)', action: 'openClassic', onlyIfPresent: true },
  ]},
];

/** The items a menu shows: view items dropped when `actionsOnly`, handler-
 *  gated items dropped when the handler is absent, and no divider left at an
 *  edge or doubled. */
export function menuItemsFor(items: Item[], opts: { actionsOnly?: boolean; actions: SchedulerActions }): Item[] {
  const kept = items.filter((i) => {
    if (opts.actionsOnly && i.view) return false;
    if (i.onlyIfPresent && i.action && !opts.actions[i.action]) return false;
    return true;
  });
  return kept.filter((i, idx) => {
    if (!i.divider) return true;
    const prev = kept[idx - 1];
    const next = kept[idx + 1];
    return !!prev && !prev.divider && !!next;
  });
}

/** The dropdown's frame from its trigger's window rect:
 *  top = y + h + Layout.menu.offset; left = min(x, window − Layout.menu.maxWidth − 8). */
export function menuDropdownPosition(
  trigger: { x: number; y: number; width: number; height: number },
  windowWidth: number,
): { top: number; left: number } {
  return {
    top: trigger.y + trigger.height + Layout.menu.offset,
    left: Math.max(8, Math.min(trigger.x, windowWidth - Layout.menu.maxWidth - 8)),
  };
}

/** Before a trigger has been measured: just under a toolbar-height bar. */
const UNMEASURED_DROPDOWN = { top: Layout.control.toolbar + Layout.menu.offset, left: 12 };

/** An open menu is a dialog to the shortcut registry. No handler: RN-web's
 *  Modal closes on Escape through onRequestClose. */
const MENU_ESC: readonly HotkeyBinding[] = [{ combo: 'escape' }];

export function SchedulerMenuBar({ active, onSelectView, actions, actionsOnly, inline }: {
  /** The current view. Optional with `actionsOnly` (no view items to mark). */
  active?: SchedulerTabKey;
  /** Switch views. Optional with `actionsOnly` (no view items to press). */
  onSelectView?: (k: SchedulerTabKey) => void;
  actions: SchedulerActions;
  /** Drop the view items (Timeline / List / … / Calendar): the Pro toolbar switches views. */
  actionsOnly?: boolean;
  /** Drop the bar's own chrome (padding, rule, surface) to sit inside a toolbar. */
  inline?: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const { width: windowWidth } = useWindowDimensions();
  const [open, setOpen] = useState<string | null>(null);
  // Where the open menu's dropdown goes, tagged with the menu it was measured
  // for. Until its own trigger has been measured the dropdown is laid out but
  // invisible, so Track / Share never flash under Plan (measureInWindow calls
  // back after the open has rendered).
  const [pos, setPos] = useState<{ key: string; top: number; left: number } | null>(null);
  const triggers = useRef<Record<string, View | null>>({});
  useHotkeys(MENU_ESC, { scope: 'dialog', enabled: open !== null });
  // With `actionsOnly` no menu holds a view any more, so none is highlighted
  // as the active group (Plan / Track would otherwise stay accent-coloured).
  const activeMenu = actionsOnly || active == null ? undefined : MENUS.find(m => m.items.some(i => i.view === active));
  const openMenu = (key: string) => {
    setPos(null);
    setOpen(key);
    const node = triggers.current[key];
    if (typeof node?.measureInWindow !== 'function') {
      setPos({ key, ...UNMEASURED_DROPDOWN });
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      const measured = [x, y, width, height].every(Number.isFinite);
      setPos({ key, ...(measured ? menuDropdownPosition({ x, y, width, height }, windowWidth) : UNMEASURED_DROPDOWN) });
    });
  };
  const menus = MENUS
    .map(m => ({ ...m, items: menuItemsFor(m.items, { actionsOnly, actions }) }))
    .filter(m => m.items.length > 0);
  return (
    <View style={inline ? styles.inlineBar : styles.bar}>
      {menus.map(menu => {
        const isActiveGroup = !actionsOnly && activeMenu?.key === menu.key;
        const placed = pos && pos.key === menu.key ? pos : null;
        return (
          <View key={menu.key}>
            <Pressable ref={(n) => { triggers.current[menu.key] = n; }} onPress={() => openMenu(menu.key)} style={styles.menuBtn} hitSlop={4}>
              <Text style={[styles.menuLabel, isActiveGroup && styles.menuLabelActive]}>{menu.label} ▾</Text>
            </Pressable>
            <Modal visible={open === menu.key} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
              <Pressable style={styles.backdrop} onPress={() => setOpen(null)} accessibilityRole="button" accessibilityLabel="Close menu" />
              <View
                style={[styles.dropdown, placed ? { top: placed.top, left: placed.left } : styles.dropdownUnplaced]}
                accessibilityRole="menu"
              >
                {menu.items.map((it, idx) => it.divider ? (
                  <View key={`d${idx}`} style={styles.divider} />
                ) : (
                  <Pressable key={it.label} style={styles.item} accessibilityRole="menuitem"
                    onPress={() => {
                      setOpen(null);
                      if (it.view) onSelectView?.(it.view);
                      else if (it.action) actions[it.action]?.();
                    }}>
                    <Text style={[styles.itemText, it.view != null && it.view === active && styles.itemTextActive]}>{it.label}</Text>
                  </Pressable>
                ))}
              </View>
            </Modal>
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  bar: { flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line, backgroundColor: t.surface },
  inlineBar: { flexDirection: 'row', gap: 2, alignItems: 'center' },
  menuBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: Tokens.radius.sm },
  menuLabel: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.textSecondary },
  menuLabelActive: { color: t.accent },
  // Transparent: a menu does not grey out the page it belongs to.
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent' },
  // top / left come from the trigger (menuDropdownPosition).
  dropdown: { position: 'absolute', minWidth: Layout.menu.minWidth, maxWidth: Layout.menu.maxWidth, backgroundColor: t.surface, borderRadius: Tokens.radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line, paddingVertical: 6, ...Shadow.heavy },
  // Laid out but unseen until its trigger has been measured (one frame).
  dropdownUnplaced: { top: UNMEASURED_DROPDOWN.top, left: UNMEASURED_DROPDOWN.left, opacity: 0 },
  item: { paddingHorizontal: 14, paddingVertical: 10 },
  itemText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text },
  itemTextActive: { color: t.accent },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginVertical: 4 },
});
