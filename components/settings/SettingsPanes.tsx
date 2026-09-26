// SettingsPanes — Settings as an index and ONE group, desktop web only
// (wave 6d, lane P2).
//
// WHY. Settings measured 6.1 screens tall on the founder's 1,512 px MacBook,
// the longest page the web audit found: 22 sections on one scroll. On desktop
// web the page becomes two panes: an index on the left (Layout.column.index,
// fixed while the pane scrolls) and the selected group on the right (the form
// column), one group at a time — Account & plan, Workspace, Money … — chosen
// by `?section=<group | section id>` (utils/settingsSections).
//
// THE PHONE TREE IS UNCHANGED. With `enabled` false (every phone, native
// tablet and narrow browser) SettingsPanes renders a Fragment around its
// children, and with no pane context SettingsSection renders a Fragment
// around its section — no host node is added anywhere.
//
// The group filter is only a filter: the four persona wrappers pinned by
// validate-shell-6c stay in the screen and still decide what a property
// manager sees; SettingsSection sits INSIDE them.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Layout, Radius } from '@/constants/designTokens';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import {
  SECTION_LABEL, groupOf,
  type SettingsGroupKey, type SettingsSectionId, type VisibleGroup,
} from '@/utils/settingsSections';

interface PaneContextValue {
  group: SettingsGroupKey;
  register: (id: SettingsSectionId, y: number) => void;
}

/** null off desktop web: every SettingsSection is then a Fragment. */
export const SettingsPaneContext = createContext<PaneContextValue | null>(null);

/** One settings section, header through its last row. Off desktop web, a
 *  Fragment (the phone tree is identical); on desktop web, mounted only when
 *  its group is the selected one, and it reports its y so the index can
 *  scroll the pane to it. */
export function SettingsSection({ id, children }: { id: SettingsSectionId; children?: React.ReactNode }) {
  const ctx = useContext(SettingsPaneContext);
  if (!ctx) return <>{children}</>;
  if (groupOf(id) !== ctx.group) return null;
  return (
    <View onLayout={(e) => ctx.register(id, e.nativeEvent.layout.y)} testID={`settings-section-${id}`}>
      {children}
    </View>
  );
}

export interface SettingsPanesProps {
  /** useIsDesktopWeb() — false renders the children untouched. */
  enabled: boolean;
  group: SettingsGroupKey;
  /** The section `?section=` named, scrolled to once it mounts. */
  activeSection: SettingsSectionId | null;
  /** visibleIndex(...) for this person. */
  index: VisibleGroup[];
  /** Write `?section=<key>` (a group key or a section id). */
  onPick: (key: SettingsGroupKey | SettingsSectionId) => void;
  /** The pane's ScrollView. */
  scrollRef: React.RefObject<ScrollView | null>;
  children?: React.ReactNode;
}

export function SettingsPanes({ enabled, group, activeSection, index, onPick, scrollRef, children }: SettingsPanesProps) {
  const styles = useThemedStyles(makeStyles);
  const ys = useRef(new Map<SettingsSectionId, number>());
  const pending = useRef<SettingsSectionId | null>(null);
  const shownGroup = useRef(group);

  const scrollToY = useCallback((y: number) => {
    scrollRef.current?.scrollTo({ y, animated: false });
  }, [scrollRef]);

  // A different group: its sections mount fresh, so start the pane at the top.
  useEffect(() => {
    if (!enabled || shownGroup.current === group) return;
    shownGroup.current = group;
    ys.current.clear();
    scrollToY(0);
  }, [enabled, group, scrollToY]);

  // A named section: scroll to it now if it has laid out, else when it does.
  useEffect(() => {
    if (!enabled || !activeSection) { pending.current = null; return; }
    const y = ys.current.get(activeSection);
    if (typeof y === 'number') { pending.current = null; scrollToY(y); } else pending.current = activeSection;
  }, [enabled, activeSection, group, scrollToY]);

  const register = useCallback((id: SettingsSectionId, y: number) => {
    ys.current.set(id, y);
    if (pending.current === id) {
      pending.current = null;
      scrollToY(y);
    }
  }, [scrollToY]);

  const ctx = useMemo<PaneContextValue>(() => ({ group, register }), [group, register]);

  const pickSection = useCallback((id: SettingsSectionId) => {
    // Same group, already laid out: scroll now (re-picking the section already
    // in the URL changes no param, so the effect above would not run).
    const y = ys.current.get(id);
    if (groupOf(id) === group && typeof y === 'number') scrollToY(y);
    onPick(id);
  }, [group, onPick, scrollToY]);

  if (!enabled) return <>{children}</>;

  return (
    <View style={styles.row} testID="settings-panes">
      {/* The index keeps its place while the pane scrolls; it has its own
          scroll only for a window too short to hold every row. */}
      <ScrollView style={styles.index} contentContainerStyle={styles.indexContent} testID="settings-index">
        {index.map((g) => {
          const selected = g.key === group;
          return (
            <View key={g.key} style={styles.indexGroup}>
              <Pressable
                onPress={() => { if (selected) scrollToY(0); onPick(g.key); }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ hovered }) => [styles.groupRow, (selected || hovered) && styles.rowSelected]}
                testID={`settings-index-group-${g.key}`}
              >
                <Text style={[styles.indexGroupLabel, selected && styles.indexGroupLabelSelected]}>{g.label}</Text>
              </Pressable>
              {g.sections.map((id) => {
                const on = selected && activeSection === id;
                return (
                  <Pressable
                    key={id}
                    onPress={() => pickSection(id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={({ hovered }) => [styles.sectionRow, (on || hovered) && styles.rowSelected]}
                    testID={`settings-index-${id}`}
                  >
                    <Text style={[styles.sectionRowLabel, on && styles.sectionRowLabelOn]} numberOfLines={1}>
                      {SECTION_LABEL[id]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          );
        })}
      </ScrollView>
      <SettingsPaneContext.Provider value={ctx}>
        <View style={styles.pane}>{children}</View>
      </SettingsPaneContext.Provider>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    width: '100%',
    maxWidth: Layout.column.index + Layout.gutter + Layout.page.form,
    alignSelf: 'center',
    gap: Layout.gutter,
  },
  index: { width: Layout.column.index, flexGrow: 0, flexShrink: 0 },
  indexContent: { paddingTop: Layout.gutter, paddingBottom: Layout.gutter, gap: Layout.rowGap },
  indexGroup: { gap: 2 },
  groupRow: { minHeight: 28, justifyContent: 'center', paddingHorizontal: 10, borderRadius: Radius.sm },
  indexGroupLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: t.textMuted,
  },
  indexGroupLabelSelected: { color: t.text },
  sectionRow: { height: Layout.control.row, justifyContent: 'center', paddingHorizontal: 10, borderRadius: Radius.sm },
  // Selection is a quiet surfaceAlt fill plus the text — never an accent fill.
  rowSelected: { backgroundColor: t.surfaceAlt },
  sectionRowLabel: { fontSize: Type.footnote.fontSize, color: t.textSecondary },
  sectionRowLabelOn: { color: t.text, fontWeight: '600' },
  pane: { flex: 1, minWidth: 0 },
});

export default SettingsPanes;
