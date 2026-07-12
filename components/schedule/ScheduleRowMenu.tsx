// components/schedule/ScheduleRowMenu.tsx — row/bar context menu for the scheduler.
// Cross-platform (iOS ActionSheetIOS / web+Android modal), mirrors EntityActionSheet.
//
// Usage: call useScheduleRowMenu()(title, actions) on a row/bar long-press or
// right-click. On iOS it fires the native sheet imperatively and returns true;
// on web/Android it returns false and the caller opens the <ScheduleRowMenu>
// modal with the same actions. This keeps the trigger gesture (long-press /
// onContextMenu) distinct from the Gantt drag PanResponder.
import { Platform, ActionSheetIOS, Modal, Pressable, View, Text, StyleSheet } from 'react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export interface RowMenuAction { key: string; label: string; destructive?: boolean; onPress: () => void }

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

export function ScheduleRowMenu({ visible, title, actions, onClose }: {
  visible: boolean; title: string; actions: RowMenuAction[]; onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {actions.map(a => (
          <Pressable key={a.key} style={styles.item} onPress={() => { onClose(); a.onPress(); }}>
            <Text style={[styles.itemText, a.destructive && styles.destructive]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
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
});
