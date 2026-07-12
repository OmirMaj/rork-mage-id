// components/schedule/SchedulerMenuBar.tsx — Plan / Track / Share menu bar.
// Replaces the 6-tab strip + the toolbar's More overflow with one grouped
// desktop-menubar grammar. View items switch the active tab; action items call
// handlers owned by schedule-pro (passed via `actions`).
import { useState } from 'react';
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { SchedulerTabKey } from './SchedulerTabShell';

export interface SchedulerActions {
  onAddTask: () => void; onImport: () => void; onReflow: () => void; onClosures: () => void;
  onCriticalPath: () => void; onBaseline: () => void; onWeather: () => void;
  onLevelResources?: () => void;
  onExport: () => void; onShare: () => void; onAI: () => void;
}
type Item = { label: string; view?: SchedulerTabKey; action?: keyof SchedulerActions; divider?: boolean };
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
    { label: 'Critical path', action: 'onCriticalPath' }, { label: 'Fix overloads', action: 'onLevelResources' }, { label: 'Baseline', action: 'onBaseline' }, { label: 'Weather re-plan', action: 'onWeather' },
  ]},
  { key: 'share', label: 'Share', items: [
    { label: 'Export', action: 'onExport' }, { label: 'Share link', action: 'onShare' }, { label: 'AI assist', action: 'onAI' },
  ]},
];

export function SchedulerMenuBar({ active, onSelectView, actions }: {
  active: SchedulerTabKey; onSelectView: (k: SchedulerTabKey) => void; actions: SchedulerActions;
}) {
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState<string | null>(null);
  const activeMenu = MENUS.find(m => m.items.some(i => i.view === active));
  return (
    <View style={styles.bar}>
      {MENUS.map(menu => {
        const isActiveGroup = activeMenu?.key === menu.key;
        return (
          <View key={menu.key}>
            <Pressable onPress={() => setOpen(menu.key)} style={styles.menuBtn} hitSlop={4}>
              <Text style={[styles.menuLabel, isActiveGroup && styles.menuLabelActive]}>{menu.label} ▾</Text>
            </Pressable>
            <Modal visible={open === menu.key} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
              <Pressable style={styles.backdrop} onPress={() => setOpen(null)} />
              <View style={styles.dropdown}>
                {menu.items.map((it, idx) => it.divider ? (
                  <View key={`d${idx}`} style={styles.divider} />
                ) : (
                  <Pressable key={it.label} style={styles.item}
                    onPress={() => {
                      setOpen(null);
                      if (it.view) onSelectView(it.view);
                      else if (it.action) actions[it.action]?.();
                    }}>
                    <Text style={[styles.itemText, it.view === active && styles.itemTextActive]}>{it.label}</Text>
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
  menuBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: Tokens.radius.sm },
  menuLabel: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.textSecondary },
  menuLabelActive: { color: t.accent },
  backdrop: { flex: 1, backgroundColor: Colors.overlay },
  dropdown: { position: 'absolute', top: 96, left: 12, minWidth: 200, backgroundColor: t.surface, borderRadius: Tokens.radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: t.line, paddingVertical: 6 },
  item: { paddingHorizontal: 14, paddingVertical: 10 },
  itemText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text },
  itemTextActive: { color: t.accent },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginVertical: 4 },
});
