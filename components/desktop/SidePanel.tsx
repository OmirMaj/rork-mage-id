// components/desktop/SidePanel.tsx — a right-docked, NON-modal panel.
//
// WHY THIS EXISTS. On the web app, Ask MAGE, Schedule Pro's Change/Ask/Task
// panes and every "quick look" opened as a full-window modal over a scrim — so
// the GC could not look at the schedule while asking about it, which is the
// whole point of asking. This panel sits BESIDE the page: 440 px by default,
// resizable 360–560 by dragging its left edge (saved per panel id), with a
// header, optional tabs and a close button. Nothing is hidden behind a scrim;
// the page next to it stays interactive.
//
//   dock      the screen lays it out as the right sibling of its content
//             (a row); the content keeps working beside it.
//   overlay   under a 1200 px container (pass `containerWidth`) it floats over
//             the right edge instead of squeezing the page below the 760 px
//             form column. Still no scrim.
//   phone     a page sheet (RN Modal) with the same header — a 440 px column
//             does not exist on a 390 px screen.
//
// Keys (web): Esc closes it (page scope — it is not a dialog, so it does not
// swallow the rest of the page's shortcuts); `toggleCombo` (default Cmd/Ctrl+J
// when onToggle is given) toggles it. A page-scope binding beats the shell's
// global Cmd+J, which is how Schedule Pro's own panel takes Cmd+J on that route.
//
// The shell's global dock (components/desktop/ShellDock.tsx) renders THIS
// component with `hotkeyScope="global"`, so there is one right-panel
// implementation: a page-scope Esc (a SplitView record, a table search) beats
// the dock's, and an open dialog silences it. A screen that hosts its own
// SidePanel (page scope) does not need the dock.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { X } from 'lucide-react-native';
import { Layout, Shadow, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useHotkeys, type HotkeyScope } from '@/hooks/useHotkeys';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import {
  SIDE_PANEL_DEFAULT,
  clampSidePanelWidth,
  dragSidePanelWidth,
  sidePanelMode,
  sidePanelWidthKey,
} from '@/utils/splitViewLayout';

export interface SidePanelTab {
  key: string;
  label: string;
}

export interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Present → Cmd/Ctrl+J (or toggleCombo) opens and closes it. */
  onToggle?: () => void;
  toggleCombo?: string;
  tabs?: readonly SidePanelTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  /** Saves the dragged width (`mageid_panel_<panelId>`). Without it the width resets per mount. */
  panelId?: string;
  /** Initial width; clamped to 360–560. */
  defaultWidth?: number;
  /** The width the page has (hooks/useContainerWidth). Under 1200 → overlay. */
  containerWidth?: number;
  /** Extra header controls, left of the close button. */
  headerActions?: React.ReactNode;
  /** Default true: the body scrolls. False for a body that manages its own scroll (a chat). */
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Registry scope for Esc / the toggle key. Default 'page'; the shell dock
   *  passes 'global' so a page's own Esc wins over it. */
  hotkeyScope?: HotkeyScope;
  /** DOM id on the desktop panel (the shell dock's print rule hides it by id). */
  nativeID?: string;
}

/** Web: the resize cursor on the drag edge. RN types only 'auto' | 'pointer';
 *  react-native-web passes any CSS cursor through. */
const RESIZE_CURSOR: ViewStyle | null = Platform.OS === 'web'
  ? ({ cursor: 'col-resize' } as unknown as ViewStyle)
  : null;

export function SidePanel(props: SidePanelProps) {
  const {
    open, onClose, title, children, onToggle, toggleCombo = 'mod+j', tabs, activeTab, onTabChange,
    panelId, defaultWidth = SIDE_PANEL_DEFAULT, containerWidth, headerActions, scroll = true, style, testID,
    hotkeyScope = 'page', nativeID,
  } = props;
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  const [width, setWidth] = useState(() => clampSidePanelWidth(defaultWidth));
  const widthRef = useRef(width);
  widthRef.current = width;
  const dragStart = useRef(width);

  useEffect(() => {
    if (!panelId) return undefined;
    let alive = true;
    AsyncStorage.getItem(sidePanelWidthKey(panelId))
      .then((raw) => {
        const n = raw ? Number.parseFloat(raw) : NaN;
        if (alive && Number.isFinite(n)) setWidth(clampSidePanelWidth(n));
      })
      .catch(() => { /* default width */ });
    return () => { alive = false; };
  }, [panelId]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { dragStart.current = widthRef.current; },
    onPanResponderMove: (_e, g) => { setWidth(dragSidePanelWidth(dragStart.current, g.dx)); },
    onPanResponderRelease: (_e, g) => {
      const w = dragSidePanelWidth(dragStart.current, g.dx);
      setWidth(w);
      if (panelId) AsyncStorage.setItem(sidePanelWidthKey(panelId), String(w)).catch(() => { /* not saved */ });
    },
  }), [panelId]);

  // Mounted whether open or not, so the toggle key works while it is closed.
  useHotkeys(
    [
      { combo: 'escape', label: `Close ${title}`, group: 'Panel', enabled: open, handler: onClose },
      ...(onToggle ? [{ combo: toggleCombo, label: `Show / hide ${title}`, group: 'Panel', handler: onToggle }] : []),
    ],
    { enabled: isDesktop, scope: hotkeyScope },
  );

  const header = (
    <View style={styles.header}>
      <Text style={styles.title} numberOfLines={1} accessibilityRole="header">{title}</Text>
      {headerActions}
      <Pressable
        onPress={onClose}
        style={styles.close}
        accessibilityRole="button"
        accessibilityLabel={`Close ${title}`}
        hitSlop={8}
        testID={testID ? `${testID}-close` : undefined}
      >
        <X {...Tokens.iconSize.default} color={t.textSecondary} />
      </Pressable>
    </View>
  );

  const tabRow = tabs && tabs.length > 0 ? (
    <View style={styles.tabs} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const on = tab.key === activeTab;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onTabChange?.(tab.key)}
            style={[styles.tab, on && styles.tabOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            testID={testID ? `${testID}-tab-${tab.key}` : undefined}
          >
            <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  ) : null;

  const body = scroll
    ? <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    : <View style={styles.body}>{children}</View>;

  if (!isDesktop) {
    return (
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
        <View style={styles.phoneSheet} testID={testID}>
          {header}
          {tabRow}
          {body}
        </View>
      </Modal>
    );
  }

  if (!open) return null;
  const overlay = sidePanelMode(containerWidth) === 'overlay';
  return (
    <View
      style={[styles.panel, { width }, overlay ? styles.overlay : null, style]}
      testID={testID}
      nativeID={nativeID}
      accessibilityLabel={title}
    >
      <View
        {...pan.panHandlers}
        style={[styles.edge, RESIZE_CURSOR]}
        accessibilityRole="adjustable"
        accessibilityLabel={`Resize ${title}`}
        testID={testID ? `${testID}-edge` : undefined}
      />
      {header}
      {tabRow}
      {body}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  panel: {
    alignSelf: 'stretch',
    flexGrow: 0,
    flexShrink: 0,
    backgroundColor: t.surface,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: t.line,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    ...Shadow.heavy,
  },
  edge: { position: 'absolute', left: -4, top: 0, bottom: 0, width: 8, zIndex: 2 },
  phoneSheet: { flex: 1, backgroundColor: t.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Layout.rowGap,
    minHeight: Layout.control.toolbar,
    paddingHorizontal: Layout.cardPad,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.line,
  },
  // Section title 16/24 at 600 (the desktop type spec).
  title: { ...Type.callout, fontWeight: '600', lineHeight: 24, color: t.text, flex: 1 },
  close: { width: Layout.control.sm, height: Layout.control.sm, alignItems: 'center', justifyContent: 'center', borderRadius: Tokens.radius.sm },
  tabs: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: Layout.cardPad,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.line,
  },
  tab: { height: 36, justifyContent: 'center', paddingHorizontal: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: t.accentFill },
  tabText: { ...Type.footnoteEmphasized, color: t.textSecondary },
  tabTextOn: { color: t.text },
  body: { flex: 1 },
  bodyContent: { padding: Layout.cardPad, gap: Layout.groupGap },
});
