// components/schedule/desktop/ScheduleProToolbar.tsx — Schedule Pro's two
// toolbar rows on a desktop browser (wave 6c, lane DB).
//
// WHY. The founder on his 1512 × 945 MacBook: "the scheduler does not work
// well". Schedule Pro stacked a header, four signal bands, a 720 px "Tell me
// what to change" pill, the Plan / Track / Share menu bar and a KPI strip
// above the grid: ~425 px of chrome, ~9 task rows. All of it is now two rows,
// 88 px:
//
//   Row 1 (48)  ‹  Henderson                [ Ask or change the schedule… ⌘J ]   B 82  ↶ ↷  ⤓ Export
//               38 tasks · 9 critical · finish Fri Mar 20 ●
//   Row 2 (40)  [Split|Gantt|List|Board|Overview] More ▾      − Fit Today +   Rows [Compact|Comfortable]   Plan ▾ Track ▾ Share ▾
//
// Row 2 needs ~1236 px. Narrower, it collapses step by step instead of running
// past the right edge (row2Plan in utils/scheduleProLayout): the "Rows" label
// goes and density becomes one toggle; then Board and Overview move into
// More ▾; then Fit and Today become icons.
//
// The command field is the one front door to the AI: a question ("what's
// driving the finish?") opens the pane's Ask tab and asks it; anything else
// ("push paint 2 days") opens the Change tab and sends it as his first turn.
//
// Desktop only — the screen renders this in its desktop tree.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, StyleSheet, useWindowDimensions } from 'react-native';
import { ChevronLeft, Undo2, Redo2, Download, Minus, Plus, ChevronDown, Maximize2, CalendarDays } from 'lucide-react-native';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/SegmentedControl';
import { useSheetDialogScope } from '@/components/ui/Sheet';
import { webMotion } from '@/components/ui/motion';
import { SchedulerMenuBar, type SchedulerActions } from '@/components/schedule/SchedulerMenuBar';
import { ScheduleHealthBadge, type ScheduleHealthBadgeProps } from '@/components/schedule/ScheduleHealthScore';
import { Layout, Shadow, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useContainerWidth } from '@/hooks/useContainerWidth';
import {
  ALL_VIEWS, VIEW_LABEL, row2Plan, type Density, type ProView,
} from '@/utils/scheduleProLayout';
import type { VerdictTone } from '@/utils/scheduleVerdict';

export interface ScheduleProToolbarZoom {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  today: () => void;
}

export interface ScheduleProToolbarProps {
  projectName: string;
  /** "38 tasks · 9 critical · finish Fri Mar 20" */
  meta: string;
  /** The schedule verdict's tone — the dot after the meta line. */
  verdictTone: VerdictTone;
  health: ScheduleHealthBadgeProps['result'];
  onHealthPress: () => void;
  onBack: () => void;
  /** The command field, so the screen's Cmd+J can focus it. */
  commandRef?: React.Ref<TextInput>;
  /** He pressed Enter in the command field (trimmed, non-empty). */
  onCommand: (text: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
  view: ProView;
  onView: (v: ProView) => void;
  zoom: ScheduleProToolbarZoom;
  density: Density;
  onDensity: (d: Density) => void;
  actions: SchedulerActions;
}

/** Zoom / Fit / Today act on the timeline, which only the Split and Gantt views show. */
export function zoomEnabledFor(view: ProView): boolean {
  return view === 'split' || view === 'gantt';
}

const viewOption = (v: ProView): SegmentedOption<ProView> => ({ value: v, label: VIEW_LABEL[v], testID: `schedule-view-${v}` });
const DENSITY_OPTIONS: SegmentedOption<Density>[] = [
  { value: 'compact', label: 'Compact', testID: 'schedule-density-compact' },
  { value: 'comfortable', label: 'Comfortable', testID: 'schedule-density-comfortable' },
];
const DENSITY_LABEL: Readonly<Record<'compact' | 'comfortable', string>> = { compact: 'Compact', comfortable: 'Comfortable' };

export function ScheduleProToolbar(p: ScheduleProToolbarProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [command, setCommand] = useState('');
  const submit = useCallback(() => {
    const text = command.trim();
    if (!text) return;
    setCommand('');
    p.onCommand(text);
  }, [command, p]);

  const dot = p.verdictTone === 'behind' ? t.danger
    : p.verdictTone === 'slightlyBehind' ? t.warningLabel
    : p.verdictTone === 'ahead' || p.verdictTone === 'onPace' ? t.success
    : t.textMuted;
  const zoomOn = zoomEnabledFor(p.view);
  const zoomReason = zoomOn ? undefined : 'Zoom works on the Split and Gantt views';

  // "More ▾": every view that is not on the segmented control (four, or six
  // once a narrow row 2 moves Board and Overview in).
  const { width: windowWidth } = useWindowDimensions();
  // Row 2 collapses instead of overflowing (wave 6d, C4): the plan follows the
  // toolbar's OWN measured width. Unmeasured (the first frame, and any
  // renderer with no layout) reads 0, which row2Plan treats as "everything".
  // The dropdown's `left` clamp below stays on the window: it is a fixed Modal.
  const { width: barW, measured: barMeasured, onLayout: onBarLayout } = useContainerWidth();
  const plan = row2Plan(barMeasured ? barW : 0);
  const viewOptions = useMemo(() => plan.primary.map(viewOption), [plan.primary]);
  const moreViews = useMemo(() => ALL_VIEWS.filter((v) => !plan.primary.includes(v)), [plan.primary]);
  const densityNow: 'compact' | 'comfortable' = p.density === 'comfortable' ? 'comfortable' : 'compact';
  const densityNext: 'compact' | 'comfortable' = densityNow === 'compact' ? 'comfortable' : 'compact';
  const [moreOpen, setMoreOpen] = useState(false);
  const [morePos, setMorePos] = useState<{ top: number; left: number } | null>(null);
  const moreRef = useRef<View | null>(null);
  // The More chevron glides (slicker pass): armed by the first open, so the
  // bar at rest — and every golden — keeps today's bare icon.
  const moreChevronArmed = useRef(false);
  useSheetDialogScope(moreOpen);
  const openMore = () => {
    moreChevronArmed.current = true;
    setMoreOpen(true);
    const node = moreRef.current;
    if (typeof node?.measureInWindow !== 'function') { setMorePos({ top: Layout.control.toolbar * 2, left: Layout.gutter }); return; }
    node.measureInWindow((x, y, _w, h) => {
      const ok = [x, y, h].every(Number.isFinite);
      setMorePos(ok
        ? { top: y + h + Layout.menu.offset, left: Math.max(8, Math.min(x, windowWidth - Layout.menu.maxWidth - 8)) }
        : { top: Layout.control.toolbar * 2, left: Layout.gutter });
    });
  };
  const moreActive = moreViews.includes(p.view);
  // The More menu drops in (web CSS; null on native and under Reduce Motion).
  const menuDrop = webMotion('dropIn');

  return (
    <View style={styles.root} testID="schedule-pro-toolbar" onLayout={onBarLayout}>
      {/* ── Row 1 ─────────────────────────────────────────────────────── */}
      <View style={styles.row1} testID="schedule-toolbar-row1">
        <Pressable onPress={p.onBack} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back" hitSlop={4}>
          <ChevronLeft size={20} color={t.textSecondary} strokeWidth={1.75} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">{p.projectName}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta} numberOfLines={1}>{p.meta}</Text>
            <View style={[styles.verdictDot, { backgroundColor: dot }]} accessibilityLabel={`Schedule verdict: ${p.verdictTone}`} />
          </View>
        </View>
        <TextInput
          ref={p.commandRef}
          value={command}
          onChangeText={setCommand}
          onSubmitEditing={submit}
          placeholder="Ask or change the schedule… ⌘J"
          placeholderTextColor={t.textMuted}
          returnKeyType="send"
          style={styles.command}
          accessibilityLabel="Ask or change the schedule"
          testID="schedule-command-field"
        />
        <View style={styles.spacer} />
        <ScheduleHealthBadge result={p.health} onPress={p.onHealthPress} size="compact" />
        <Pressable
          onPress={p.onUndo}
          disabled={!p.canUndo}
          style={[styles.iconBtn, !p.canUndo && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel="Undo (⌘Z)"
          accessibilityState={{ disabled: !p.canUndo }}
          testID="schedule-toolbar-undo"
        >
          <Undo2 size={16} color={t.textSecondary} strokeWidth={1.75} />
        </Pressable>
        <Pressable
          onPress={p.onRedo}
          disabled={!p.canRedo}
          style={[styles.iconBtn, !p.canRedo && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel="Redo (⇧⌘Z)"
          accessibilityState={{ disabled: !p.canRedo }}
          testID="schedule-toolbar-redo"
        >
          <Redo2 size={16} color={t.textSecondary} strokeWidth={1.75} />
        </Pressable>
        <Pressable onPress={p.onExport} style={styles.textBtn} accessibilityRole="button" accessibilityLabel="Export" testID="schedule-toolbar-export">
          <Download size={14} color={t.accentLabel} strokeWidth={1.75} />
          <Text style={styles.textBtnLabel}>Export</Text>
        </Pressable>
      </View>

      {/* ── Row 2 ─────────────────────────────────────────────────────── */}
      <View style={styles.row2} testID="schedule-toolbar-row2">
        <SegmentedControl
          options={viewOptions}
          value={p.view}
          onChange={p.onView}
          variant="pill"
          size="sm"
          accessibilityLabel="Schedule view"
          testID="schedule-view"
        />
        <Pressable
          ref={moreRef}
          onPress={openMore}
          style={[styles.textBtn, moreActive && styles.textBtnOn]}
          accessibilityRole="button"
          accessibilityLabel="More views"
          testID="schedule-view-more"
        >
          <Text style={[styles.textBtnLabel, moreActive && styles.textBtnLabelOn]}>{moreActive ? VIEW_LABEL[p.view] : 'More'}</Text>
          {moreChevronArmed.current ? (
            <View style={[{ transform: [{ rotate: moreOpen ? '180deg' : '0deg' }] }, webMotion('rotateGlide')]}>
              <ChevronDown size={14} color={moreActive ? t.text : t.textSecondary} strokeWidth={1.75} />
            </View>
          ) : (
            <ChevronDown size={14} color={moreActive ? t.text : t.textSecondary} strokeWidth={1.75} />
          )}
        </Pressable>
        <View style={styles.spacer} />
        <View style={styles.group} accessibilityLabel={zoomReason}>
          <Pressable onPress={p.zoom.zoomOut} disabled={!zoomOn} style={[styles.iconBtn, !zoomOn && styles.disabled]} accessibilityRole="button" accessibilityLabel={zoomOn ? 'Zoom out' : `Zoom out — ${zoomReason}`} testID="schedule-zoom-out">
            <Minus size={14} color={t.textSecondary} strokeWidth={1.75} />
          </Pressable>
          <Pressable onPress={p.zoom.fit} disabled={!zoomOn} style={[plan.zoomLabels ? styles.textBtn : styles.iconBtn, !zoomOn && styles.disabled]} accessibilityRole="button" accessibilityLabel={zoomOn ? 'Fit the whole project' : `Fit — ${zoomReason}`} testID="schedule-zoom-fit">
            {plan.zoomLabels
              ? <Text style={styles.textBtnLabel}>Fit</Text>
              : <Maximize2 size={14} color={t.textSecondary} strokeWidth={1.75} />}
          </Pressable>
          <Pressable onPress={p.zoom.today} disabled={!zoomOn} style={[plan.zoomLabels ? styles.textBtn : styles.iconBtn, !zoomOn && styles.disabled]} accessibilityRole="button" accessibilityLabel={zoomOn ? 'Scroll to today' : `Today — ${zoomReason}`} testID="schedule-zoom-today">
            {plan.zoomLabels
              ? <Text style={styles.textBtnLabel}>Today</Text>
              : <CalendarDays size={14} color={t.textSecondary} strokeWidth={1.75} />}
          </Pressable>
          <Pressable onPress={p.zoom.zoomIn} disabled={!zoomOn} style={[styles.iconBtn, !zoomOn && styles.disabled]} accessibilityRole="button" accessibilityLabel={zoomOn ? 'Zoom in' : `Zoom in — ${zoomReason}`} testID="schedule-zoom-in">
            <Plus size={14} color={t.textSecondary} strokeWidth={1.75} />
          </Pressable>
        </View>
        {plan.density === 'segmented' ? (
          <View style={styles.group}>
            {plan.rowsLabel ? <Text style={styles.groupLabel}>Rows</Text> : null}
            <SegmentedControl
              options={DENSITY_OPTIONS}
              value={densityNow}
              onChange={p.onDensity}
              variant="pill"
              size="sm"
              accessibilityLabel="Row density"
              testID="schedule-density"
            />
          </View>
        ) : (
          <Pressable
            onPress={() => p.onDensity(densityNext)}
            style={styles.textBtn}
            accessibilityRole="button"
            accessibilityLabel={`Row density: ${DENSITY_LABEL[densityNow]}. Switch to ${DENSITY_LABEL[densityNext]}`}
            testID="schedule-density"
          >
            <Text style={styles.textBtnLabel}>{DENSITY_LABEL[densityNow]}</Text>
          </Pressable>
        )}
        <SchedulerMenuBar actionsOnly inline actions={p.actions} />
      </View>

      <Modal visible={moreOpen} transparent animationType="fade" onRequestClose={() => setMoreOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMoreOpen(false)} accessibilityRole="button" accessibilityLabel="Close menu" />
        <View
          style={menuDrop
            ? [styles.menu, morePos ? { top: morePos.top, left: morePos.left } : styles.menuUnplaced, menuDrop]
            : [styles.menu, morePos ? { top: morePos.top, left: morePos.left } : styles.menuUnplaced]}
          accessibilityRole="menu"
          testID="schedule-view-more-menu"
        >
          {moreViews.map((v) => (
            <Pressable
              key={v}
              style={styles.menuItem}
              accessibilityRole="menuitem"
              onPress={() => { setMoreOpen(false); p.onView(v); }}
              testID={`schedule-view-${v}`}
            >
              <Text style={[styles.menuItemText, v === p.view && styles.menuItemTextOn]}>{VIEW_LABEL[v]}</Text>
            </Pressable>
          ))}
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { backgroundColor: t.surface },
  row1: {
    height: Layout.control.toolbar,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Layout.rowGap,
    paddingHorizontal: Layout.gutter,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.line,
  },
  row2: {
    height: Layout.control.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Layout.rowGap,
    paddingHorizontal: Layout.gutter,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.line,
  },
  iconBtn: {
    width: Layout.control.sm,
    height: Layout.control.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Tokens.radius.sm,
  },
  disabled: { opacity: 0.4 },
  titleBlock: { flexShrink: 1, maxWidth: Layout.field.md },
  // Serif headline: the phase-A rule for self-drawn screen titles (validate-type-identity).
  title: { ...Type.serifHeadline, color: t.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { ...Type.caption1, color: t.textSecondary, flexShrink: 1 },
  verdictDot: { width: 8, height: 8, borderRadius: Tokens.radius.full },
  command: {
    flex: 1,
    minWidth: Layout.field.sm,
    maxWidth: Layout.field.md,
    height: Layout.control.sm,
    paddingHorizontal: 12,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: t.line,
    backgroundColor: t.bg,
    color: t.text,
    ...Type.footnote,
  },
  spacer: { flex: 1 },
  textBtn: {
    height: Layout.control.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.sm,
  },
  textBtnOn: { backgroundColor: t.surfaceAlt },
  textBtnLabel: { ...Type.footnoteEmphasized, color: t.textSecondary },
  textBtnLabelOn: { color: t.text },
  group: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  groupLabel: { ...Type.caption1, color: t.textSecondary, marginRight: 6 },
  // "More ▾": a transparent backdrop (a menu does not dim the page) and a
  // Layout.menu-wide popover under its trigger.
  menuBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent' },
  menu: {
    position: 'absolute',
    minWidth: Layout.menu.minWidth,
    maxWidth: Layout.menu.maxWidth,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.line,
    paddingVertical: 6,
    ...Shadow.heavy,
  },
  menuUnplaced: { top: Layout.control.toolbar * 2, left: Layout.gutter, opacity: 0 },
  menuItem: { paddingHorizontal: 14, paddingVertical: 10 },
  menuItemText: { ...Type.footnote, fontWeight: '600', color: t.text },
  menuItemTextOn: { color: t.accentLabel },
});
