// components/desktop/ToolbarActions.tsx — a header's actions, sized for a desk.
//
// WHY THIS EXISTS. The web audit measured project-detail's action buttons at
// 1360 px wide each, stacked, because they are the phone's full-width buttons
// on a laptop. Editors (RFI, submittal, change order, invoice, pay app) and
// Schedule Pro have the same problem. This fits ScreenHeader's existing
// `actions` slot:
//
//   • up to 6 compact 32 px icon + label buttons (max 280 wide);
//   • a ⋯ overflow menu for rare actions and EVERY destructive one — a delete
//     never sits one mis-click from "Save" — and a destructive action with
//     `confirm` asks first;
//   • a blocked action stays visible, reads disabled, and SAYS WHY when pressed
//     (the brain-center rule: a button never silently does nothing);
//   • each action's testID is passed through untouched, so existing tests keep
//     finding their buttons;
//   • breadcrumbs ("Henderson › RFIs › RFI-012"), each segment a link, sit on
//     the left for project-scoped routes.
//
// Phone: icon-only 44 px buttons (the first 3), the rest in the ⋯ menu, no
// breadcrumbs (the phone header already has its back button).

import React, { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Link, type Href } from 'expo-router';
import { ChevronRight, Ellipsis } from 'lucide-react-native';
import { Layout, Shadow, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useHotkeys, type HotkeyBinding } from '@/hooks/useHotkeys';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { showAlert } from '@/utils/alert';
import { cardSurface } from '@/components/ui/Card';
import { labelOn } from '@/components/ui/ink';
import { webMotion } from '@/components/ui/motion';

type IconComponent = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

export interface ToolbarAction {
  key: string;
  label: string;
  icon?: IconComponent;
  onPress: () => void;
  /** Blocked. Stays visible; pressing it explains `disabledReason`. */
  disabled?: boolean;
  disabledReason?: string | null;
  /** Always goes to the ⋯ menu, in the danger colour. */
  destructive?: boolean;
  /** Ask before running. */
  confirm?: { title: string; message?: string; confirmLabel?: string };
  /** Rare: the ⋯ menu even when there is room. */
  overflow?: boolean;
  /** The screen's main action — filled. */
  primary?: boolean;
  testID?: string;
}

export interface Breadcrumb {
  label: string;
  href?: Href;
}

export interface ToolbarActionsProps {
  actions: readonly ToolbarAction[];
  breadcrumbs?: readonly Breadcrumb[];
  /** Default 6 on desktop, 3 on a phone. */
  maxVisible?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Which actions show as buttons and which go to ⋯, in the order given. */
export function splitToolbarActions<A extends Pick<ToolbarAction, 'destructive' | 'overflow'>>(
  actions: readonly A[],
  maxVisible: number,
): { visible: A[]; overflow: A[] } {
  const visible: A[] = [];
  const overflow: A[] = [];
  for (const a of actions) {
    if (a.destructive || a.overflow || visible.length >= Math.max(0, maxVisible)) overflow.push(a);
    else visible.push(a);
  }
  return { visible, overflow };
}

function runAction(a: ToolbarAction): void {
  if (a.disabled) {
    showAlert(a.label, a.disabledReason?.trim() ? a.disabledReason : `${a.label} isn't available right now.`);
    return;
  }
  if (a.confirm) {
    showAlert(a.confirm.title, a.confirm.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: a.confirm.confirmLabel ?? a.label, style: a.destructive ? 'destructive' : 'default', onPress: a.onPress },
    ]);
    return;
  }
  a.onPress();
}

const MENU_WIDTH = Layout.menu.maxWidth;

/** The open ⋯ menu is a DIALOG to the shortcut registry: a handler-less Esc
 *  entry makes the dialog scope exclusive, so the Esc that closes the menu
 *  (RN-web's Modal, onRequestClose) never also closes the SplitView record the
 *  toolbar sits on. A handler here would close the menu twice. */
const MENU_DIALOG_BINDINGS: readonly HotkeyBinding[] = [{ combo: 'escape' }];

export function ToolbarActions({ actions, breadcrumbs, maxVisible, style, testID }: ToolbarActionsProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop, width: windowWidth } = useResponsiveLayout();
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<View>(null);
  useHotkeys(MENU_DIALOG_BINDINGS, { scope: 'dialog', enabled: menu !== null });

  const { visible, overflow } = splitToolbarActions(actions, maxVisible ?? (isDesktop ? 6 : 3));
  // The ⋯ menu drops in (web CSS; null on native and under Reduce Motion). It
  // renders only while open, so nothing changes at rest.
  const menuDrop = webMotion('dropIn');

  const openMenu = () => {
    const node = triggerRef.current;
    const place = (x: number, y: number, w: number, h: number) => {
      // Right-align the menu to its trigger, 4 px below it, kept on screen.
      const left = Math.max(8, Math.min(x + w - MENU_WIDTH, windowWidth - MENU_WIDTH - 8));
      setMenu({ top: y + h + Layout.menu.offset, left });
    };
    // Open at once (top-right of the window), then move under the trigger when
    // the measurement lands — the menu never waits on a measure that might not
    // call back.
    place(windowWidth - 8 - MENU_WIDTH, 0, MENU_WIDTH, Layout.control.toolbar);
    if (node && typeof node.measureInWindow === 'function') node.measureInWindow(place);
  };

  return (
    <View style={[styles.row, style]} testID={testID}>
      {isDesktop && breadcrumbs && breadcrumbs.length > 0 ? (
        <View style={styles.crumbs} accessibilityRole="header">
          {breadcrumbs.map((b, i) => {
            const last = i === breadcrumbs.length - 1;
            const text = <Text style={[styles.crumb, last && styles.crumbLast]} numberOfLines={1}>{b.label}</Text>;
            return (
              <React.Fragment key={`${i}-${b.label}`}>
                {i > 0 ? <ChevronRight {...Tokens.iconSize.micro} color={t.textMuted} /> : null}
                {b.href && !last ? (
                  <Link href={b.href} asChild>
                    <Pressable accessibilityRole="link" style={styles.crumbLink}>{text}</Pressable>
                  </Link>
                ) : text}
              </React.Fragment>
            );
          })}
        </View>
      ) : null}
      <View style={styles.spacer} />
      {visible.map((a) => {
        const Icon = a.icon;
        const blocked = !!a.disabled;
        // Text on the accent fill: labelOn picks white or ink by contrast (the
        // surface token is dark in dark mode and would vanish on the fill).
        const ink = a.primary && !blocked ? labelOn(t.accentFill) : t.text;
        return (
          <Pressable
            key={a.key}
            onPress={() => runAction(a)}
            style={[
              isDesktop ? styles.button : styles.phoneButton,
              a.primary && styles.primary,
              blocked && styles.blocked,
            ]}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            accessibilityState={{ disabled: blocked }}
            accessibilityHint={blocked ? (a.disabledReason ?? undefined) : undefined}
            testID={a.testID}
          >
            {Icon ? <Icon {...Tokens.iconSize.small} color={ink} /> : null}
            {isDesktop || !Icon ? <Text style={[styles.buttonText, { color: ink }]} numberOfLines={1}>{a.label}</Text> : null}
          </Pressable>
        );
      })}
      {overflow.length > 0 ? (
        <Pressable
          ref={triggerRef}
          onPress={openMenu}
          style={isDesktop ? styles.iconButton : styles.phoneButton}
          accessibilityRole="button"
          accessibilityLabel="More actions"
          testID={testID ? `${testID}-more` : undefined}
        >
          <Ellipsis {...Tokens.iconSize.default} color={t.textSecondary} />
        </Pressable>
      ) : null}
      <Modal visible={menu !== null} transparent animationType="none" onRequestClose={() => setMenu(null)}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(null)} accessibilityRole="button" accessibilityLabel="Close menu" />
        {menu ? (
          <View style={menuDrop ? [styles.menu, { top: menu.top, left: menu.left }, menuDrop] : [styles.menu, { top: menu.top, left: menu.left }]} accessibilityRole="menu">
            {overflow.map((a) => {
              const Icon = a.icon;
              const blocked = !!a.disabled;
              const ink = a.destructive && !blocked ? t.dangerLabel : t.text;
              return (
                <Pressable
                  key={a.key}
                  onPress={() => { setMenu(null); runAction(a); }}
                  style={[styles.menuItem, blocked && styles.blocked]}
                  accessibilityRole="menuitem"
                  accessibilityState={{ disabled: blocked }}
                  accessibilityHint={blocked ? (a.disabledReason ?? undefined) : undefined}
                  testID={a.testID}
                >
                  {Icon ? <Icon {...Tokens.iconSize.small} color={ink} /> : <View style={styles.menuIconSpace} />}
                  <Text style={[styles.menuText, { color: ink }]} numberOfLines={1}>{a.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Layout.rowGap, flexShrink: 1 },
  crumbs: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, minWidth: 0 },
  crumbLink: { flexShrink: 1 },
  crumb: { ...Type.footnoteEmphasized, color: t.textSecondary, flexShrink: 1 },
  crumbLast: { color: t.text },
  spacer: { flexGrow: 1, flexShrink: 1 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: Layout.control.sm,
    minWidth: Layout.button.minWidth.sm,
    maxWidth: Layout.button.maxWidth,
    justifyContent: 'center',
    ...cardSurface(t, { radius: 'sm', pad: 'none' }),
    paddingHorizontal: 12,
  },
  primary: { backgroundColor: t.accentFill, borderColor: t.accentFill },
  iconButton: {
    width: Layout.control.sm,
    height: Layout.control.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Tokens.radius.sm,
    borderWidth: 1,
    borderColor: t.line,
  },
  phoneButton: {
    minWidth: Tokens.touchTarget.min,
    height: Tokens.touchTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  buttonText: { ...Type.footnoteEmphasized },
  blocked: { opacity: 0.5 },
  menu: {
    position: 'absolute',
    minWidth: Layout.menu.minWidth,
    width: MENU_WIDTH,
    ...cardSurface(t, { radius: 'card', pad: 'none' }),
    paddingVertical: 4,
    ...Shadow.heavy,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 36, paddingHorizontal: 12 },
  menuIconSpace: { width: 14 },
  menuText: { ...Type.bodyCompact, flexShrink: 1 },
});
