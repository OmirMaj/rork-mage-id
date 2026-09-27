// components/takeoff/ConditionsPanel.tsx — the desktop takeoff's live list
// (wave 4, lane T2). One row per condition: its swatch (the SAME colour as its
// shapes on the plan), kind, name, the quantity the push writes, and what it
// costs. Dividers, not cards; a sticky footer with the one push.
//
// Honesty rules this file carries:
//  - an unpriced condition reads "—" and says "No rate yet — set one", never $0;
//  - a condition whose sheet has no scale says "N not measured — set the scale
//    on A-101", never 0 SF;
//  - the footer's cost counts priced rows only and NAMES the unpriced ones;
//  - the push button, when blocked, says why under itself.
//
// Presentational: TakeoffWorkspace owns the doc, the rollups and the push.
//
// List-3 lane TK-a added: the "Start with" starter chips on an empty takeoff,
// the filter box ('/' focuses it; the workspace owns the text and filters
// with visibleRows, the same function its 1–9 keys read), hover-to-thicken
// (onHoverCondition), one sub-row per measurement in an expanded row, and the
// save line / conflict banner lane SYNC fills in.
//
// SEAM for lane TK-b: `{/* seam:ai-section */}` sits directly after the
// "+ New condition" row inside the ScrollView.
//
// Lane TK-b renders "Suggested by AI" there (AiSuggestionsSection — never
// counted until accepted) and gives an accepted AI condition its subline:
// "AI read — not measured · p.3 · … · draw it to measure" until it is drawn.

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronRight, Hash, Minus, Plus, Square, X } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Layout, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import EstimateJobPicker from '@/components/estimate/EstimateJobPicker';
import { RateProvenanceChip } from '@/components/estimate/RateProvenanceChip';
import { formatMoneyFull } from '@/utils/jobCostEngine';
import { matchesConditionFilter, type ConditionKind, type rollup } from '@/utils/takeoff/conditions';
import { filterSuggestions } from '@/utils/takeoff/aiSuggestions';
import AiSuggestionsSection, { type AiSuggestionsSectionProps } from './AiSuggestionsSection';
import type { TakeoffConflict } from '@/hooks/useTakeoffConditions';

export type PanelRow = ReturnType<typeof rollup>['rows'][number];
export type PanelFilter = 'sheet' | 'all';

/** The rows the panel shows for this filter text (after the This sheet / All
 *  sheets rollup). The workspace's 1–9 keys and lane TK-b's AI section read
 *  the SAME function, so "the Nth row" is always the Nth row he can see. */
export function visibleRows<R extends { condition: PanelRow['condition'] }>(rows: readonly R[], q: string): R[] {
  return rows.filter((r) => matchesConditionFilter(r.condition, q));
}

/** The filter input's DOM id: the workspace's Esc binding clears the box only
 *  when the key was typed in it (targetWithin). */
export const TAKEOFF_FILTER_DOM_ID = 'takeoffws-filter-input-dom';

/** One "Start with" chip: the name · unit, and its rate line ("$4.10/SF · from your jobs" / "no history"). */
export interface StarterChip { key: string; name: string; unit: string; rateLine: string }

/** One measurement under an expanded row: "A-101 · Area 1 · 212 SF". */
export interface MeasurementSubRow { id: string; text: string }

const KIND_ICON: Record<ConditionKind, typeof Square> = { area: Square, linear: Minus, count: Hash };

/** The AI section's inputs; `rows` are every unhandled suggestion (the panel applies its text filter). */
export type PanelAi = Omit<AiSuggestionsSectionProps, 'totalRows'>;

const CONF_WORD = { high: 'High', medium: 'Medium', low: 'Low' } as const;

export interface ConditionsPanelProps {
  rows: PanelRow[];
  filter: PanelFilter;
  onFilter: (f: PanelFilter) => void;
  activeId: string | null;
  onActivate: (id: string) => void;
  onEdit: (id: string) => void;
  onNew: () => void;
  /** Sheet id → its number (or name), for "set the scale on A-101". */
  sheetLabel: (sheetId: string) => string;
  /** "Cost $X · P of N priced from your jobs · 2 have no rate yet" */
  costLine: string;
  /** Markup line, or the no-markup sentence. null = nothing to say. */
  markupLine: string | null;
  jobs: { id: string; name: string }[];
  projectId: string | null;
  onPickJob: (id: string) => void;
  pushLabel: string;
  /** Why the push is blocked (in words), or null when it can run. */
  pushReason: string | null;
  onPush: () => void;
  /** "Estimate updated $118,000 → $137,713" + "1 updated, 2 added" after a push. */
  result: { line: string; counts: string } | null;
  onOpenEstimate: () => void;
  /** "2 have no rate yet — not pushed" … */
  skippedLines: string[];
  /** "Saved on this browser" until lane SYNC words it for account sync. */
  saveLine: string;
  /** Lane SYNC's account-sync conflict: the hook's own type (useTakeoffConditions().conflict). */
  conflict: TakeoffConflict | null;
  /** The filter box's text (the workspace owns it). */
  filterText: string;
  onFilterText: (q: string) => void;
  filterInputRef: React.RefObject<TextInput | null>;
  /** The six starters, shown only while the takeoff has no conditions. */
  starters: StarterChip[];
  onStarter: (key: string) => void;
  /** An expanded row's measurements (This sheet / All sheets already applied), in order. */
  subRowsFor: (conditionId: string) => MeasurementSubRow[];
  selectedMeasurementId: string | null;
  onPickMeasurement: (id: string) => void;
  onDeleteMeasurement: (id: string) => void;
  /** Hovering a row (or its sub-rows) thickens that condition's shapes; null on leave. */
  onHoverCondition: (id: string | null) => void;
  /** "Suggested by AI" (lane TK-b). */
  ai: PanelAi;
  /** Condition ids with a measurement on ANY sheet (the whole doc, not this filter). */
  drawnAnywhere: ReadonlySet<string>;
}

const fmtQty = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
/** A number when it is drawn, or an accepted AI read in All sheets; else "not measured". */
const hasQty = (row: PanelRow): boolean => row.totals.measuredCount > 0 || row.totals.source === 'ai_read';
const qtyText = (row: PanelRow): string => (hasQty(row) ? fmtQty(row.price.qty) : 'not measured');

/** An accepted AI condition's subline, or null (no AI read, or the no-scale warning already speaks). */
function aiReadLine(row: PanelRow, filter: PanelFilter, drawnAnywhere: ReadonlySet<string>): string | null {
  const ai = row.condition.aiRead;
  if (!ai) return null;
  const was = row.totals.aiReadQty != null ? `${fmtQty(row.totals.aiReadQty)} ${ai.unit}` : null;
  if (row.totals.source === 'ai_read') {
    return `AI read — not measured · ${ai.citation} · ${CONF_WORD[ai.confidence]} confidence · draw it to measure`;
  }
  if (row.totals.source === 'measured' && was) return `Measured · AI read was ${was}`;
  // Only while nothing is drawn anywhere: drawn on another sheet, All sheets
  // shows it measured and the AI number no longer counts.
  if (row.totals.source === 'none' && was && filter === 'sheet' && row.totals.unmeasuredCount === 0
    && !drawnAnywhere.has(row.condition.id)) {
    return `AI read ${was} is for the whole plan set — see All sheets`;
  }
  return null;
}

export default function ConditionsPanel(p: ConditionsPanelProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // The sub-row under the pointer / with keyboard focus on its delete: shows the X.
  const [hoverSub, setHoverSub] = useState<string | null>(null);
  const [focusSub, setFocusSub] = useState<string | null>(null);
  const shown = visibleRows(p.rows, p.filterText);
  const q = p.filterText.trim();
  const aiRows = filterSuggestions(p.ai.rows, p.filterText);

  return (
    <View style={styles.panel} testID="takeoffws-panel">
      <View style={styles.header}>
        <Text style={styles.heading} accessibilityRole="header">Conditions</Text>
        <View style={styles.segment}>
          {(['sheet', 'all'] as const).map((f) => {
            const on = p.filter === f;
            return (
              <Pressable
                key={f}
                onPress={() => p.onFilter(f)}
                style={[styles.segBtn, on && styles.segBtnOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                testID={`takeoffws-filter-${f}`}
              >
                <Text style={[styles.segText, on && styles.segTextOn]}>{f === 'sheet' ? 'This sheet' : 'All sheets'}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.filterRow}>
        <TextInput
          ref={p.filterInputRef}
          id={TAKEOFF_FILTER_DOM_ID}
          value={p.filterText}
          onChangeText={p.onFilterText}
          placeholder="Filter conditions  /"
          placeholderTextColor={t.textMuted}
          style={styles.filterInput}
          accessibilityLabel="Filter conditions"
          autoCorrect={false}
          autoCapitalize="none"
          testID="takeoffws-filter-input"
        />
      </View>

      <ScrollView style={styles.list}>
        {p.rows.length === 0 && p.starters.length > 0 ? (
          <View style={styles.starters} testID="takeoffws-starters">
            <Text style={styles.startersLabel}>Start with</Text>
            <View style={styles.starterWrap}>
              {p.starters.map((s) => (
                <Pressable
                  key={s.key}
                  onPress={() => p.onStarter(s.key)}
                  style={styles.starter}
                  accessibilityRole="button"
                  accessibilityLabel={`Start a ${s.name} condition, ${s.unit}, ${s.rateLine}`}
                  testID={`takeoffws-starter-${s.key}`}
                >
                  <Text style={styles.starterName} numberOfLines={1}>{`${s.name} · ${s.unit}`}</Text>
                  <Text style={styles.starterRate} numberOfLines={1}>{s.rateLine}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        {p.rows.length === 0 ? (
          <Text style={styles.emptyLine} testID="takeoffws-panel-empty">No conditions yet — press N or pick a tool to start one.</Text>
        ) : null}
        {p.rows.length > 0 && shown.length === 0 ? (
          <Text style={styles.emptyLine} testID="takeoffws-filter-empty">{`No conditions match “${q}”`}</Text>
        ) : null}
        {shown.map((row) => {
          const c = row.condition;
          const active = c.id === p.activeId;
          const expanded = !!open[c.id];
          const Icon = KIND_ICON[c.kind];
          const unpriced = row.price.amountCents == null;
          const measured = hasQty(row);
          const aiLine = aiReadLine(row, p.filter, p.drawnAnywhere);
          const unmeasured = row.totals.unmeasuredCount > 0
            ? `${row.totals.unmeasuredCount} not measured — set the scale on ${row.totals.unmeasuredSheetIds.map(p.sheetLabel).join(', ')}`
            : null;
          return (
            <View key={c.id} style={[styles.rowWrap, active && styles.rowActive]} testID={`takeoffws-row-${c.id}`}>
              <View style={styles.row}>
                <Pressable
                  onPress={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))}
                  style={styles.chevron}
                  accessibilityRole="button"
                  accessibilityLabel={expanded ? `Collapse ${c.name}` : `Expand ${c.name}`}
                >
                  {expanded
                    ? <ChevronDown size={14} color={t.textMuted} strokeWidth={1.75} />
                    : <ChevronRight size={14} color={t.textMuted} strokeWidth={1.75} />}
                </Pressable>
                <Pressable
                  onPress={() => p.onActivate(c.id)}
                  onHoverIn={() => p.onHoverCondition(c.id)}
                  onHoverOut={() => p.onHoverCondition(null)}
                  style={styles.rowMain}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${c.name}, ${qtyText(row)} ${measured ? row.totals.unit : ''}`}
                  testID={`takeoffws-row-press-${c.id}`}
                >
                  <View style={[styles.swatch, { backgroundColor: c.color }]} testID={`takeoffws-swatch-${c.id}`} />
                  <Icon size={14} color={t.textMuted} strokeWidth={1.75} />
                  <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
                  <Text style={[styles.qty, !measured && styles.qtyMuted]} numberOfLines={1} testID={`takeoffws-qty-${c.id}`}>{qtyText(row)}</Text>
                  <Text style={styles.unit}>{measured ? row.totals.unit : ''}</Text>
                  <Text style={styles.amount} numberOfLines={1} testID={`takeoffws-amount-${c.id}`}>
                    {unpriced ? '—' : formatMoneyFull((row.price.amountCents as number) / 100)}
                  </Text>
                </Pressable>
              </View>
              {unpriced ? (
                <TouchableOpacity onPress={() => p.onEdit(c.id)} style={styles.subline} accessibilityRole="button" testID={`takeoffws-norate-${c.id}`}>
                  <Text style={styles.norate}>No rate yet — set one</Text>
                </TouchableOpacity>
              ) : null}
              {unmeasured ? (
                <Text style={[styles.subline, styles.warn]} testID={`takeoffws-unmeasured-${c.id}`}>{unmeasured}</Text>
              ) : null}
              {aiLine ? (
                <Text style={[styles.subline, styles.aiLine]} testID={`takeoffws-airead-${c.id}`}>{aiLine}</Text>
              ) : null}
              {expanded ? (
                <View style={styles.detail}>
                  <Text style={styles.detailText}>
                    {[
                      c.trade ?? 'No trade',
                      row.price.rateCents != null ? `${formatMoneyFull(row.price.rateCents / 100)} / ${row.totals.unit}` : 'No rate',
                      c.kind !== 'count' ? `${c.wastePct}% waste` : null,
                      row.totals.wallSf != null ? `Wall ≈ ${Math.round(row.totals.wallSf).toLocaleString('en-US')} SF` : null,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                  {row.price.rateSource === 'book'
                    ? <RateProvenanceChip entry={row.price.entry} />
                    : row.price.rateSource === 'override'
                      ? <Text style={styles.detailText}>Your rate (typed)</Text>
                      : null}
                  <TouchableOpacity onPress={() => p.onEdit(c.id)} accessibilityRole="button" testID={`takeoffws-edit-${c.id}`}>
                    <Text style={styles.link}>Edit condition</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {expanded ? p.subRowsFor(c.id).map((m) => {
                const sel = m.id === p.selectedMeasurementId;
                const showX = hoverSub === m.id || focusSub === m.id;
                return (
                  <View key={m.id} style={[styles.sub, sel && styles.subSel]}>
                    <Pressable
                      onPress={() => p.onPickMeasurement(m.id)}
                      onHoverIn={() => { setHoverSub(m.id); p.onHoverCondition(c.id); }}
                      onHoverOut={() => { setHoverSub((h) => (h === m.id ? null : h)); p.onHoverCondition(null); }}
                      style={styles.subMain}
                      accessibilityRole="button"
                      accessibilityState={{ selected: sel }}
                      accessibilityLabel={`Show ${m.text}`}
                      testID={`takeoffws-m-${m.id}`}
                    >
                      <Text style={styles.subText} numberOfLines={1}>{m.text}</Text>
                    </Pressable>
                    {/* Visible on hover; always in the tab order and read by a screen reader. */}
                    <Pressable
                      onPress={() => p.onDeleteMeasurement(m.id)}
                      onHoverIn={() => setHoverSub(m.id)}
                      onHoverOut={() => setHoverSub((h) => (h === m.id ? null : h))}
                      onFocus={() => setFocusSub(m.id)}
                      onBlur={() => setFocusSub((f) => (f === m.id ? null : f))}
                      style={[styles.subDel, !showX && styles.subDelHidden]}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${m.text}`}
                      testID={`takeoffws-mdel-${m.id}`}
                    >
                      <X size={14} color={t.textMuted} strokeWidth={1.75} />
                    </Pressable>
                  </View>
                );
              }) : null}
            </View>
          );
        })}
        <TouchableOpacity onPress={p.onNew} style={styles.newRow} accessibilityRole="button" testID="takeoffws-new-condition">
          <Plus size={14} color={t.textSecondary} strokeWidth={1.75} />
          <Text style={styles.newText}>New condition (N)</Text>
        </TouchableOpacity>
        {/* seam:ai-section */}
        <AiSuggestionsSection {...p.ai} rows={aiRows} totalRows={p.ai.rows.length} />
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.cost} testID="takeoffws-cost-line">{p.costLine}</Text>
        {p.markupLine ? <Text style={styles.muted}>{p.markupLine}</Text> : null}
        <EstimateJobPicker label="Push to" jobs={p.jobs} selectedId={p.projectId ?? undefined} onPick={p.onPickJob} testID="takeoffws-push-to" />
        <Text style={styles.muted} testID="takeoffws-save-line">{p.saveLine}</Text>
        {p.conflict ? (
          <View style={styles.conflict} testID="takeoffws-conflict">
            <Text style={styles.muted}>{p.conflict.notice}</Text>
            <View style={styles.conflictActions}>
              {p.conflict.hasBackup ? (
                <TouchableOpacity onPress={p.conflict.restore} accessibilityRole="button" testID="takeoffws-conflict-restore">
                  <Text style={styles.link}>Restore this browser’s copy</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity onPress={p.conflict.dismiss} accessibilityRole="button" testID="takeoffws-conflict-dismiss">
                <Text style={styles.link}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
        <TouchableOpacity
          onPress={p.onPush}
          disabled={!!p.pushReason}
          style={[styles.push, !!p.pushReason && styles.pushOff]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !!p.pushReason }}
          accessibilityHint={p.pushReason ?? undefined}
          testID="takeoffws-push"
        >
          <Text style={styles.pushText}>{p.pushLabel}</Text>
        </TouchableOpacity>
        {p.pushReason ? <Text style={styles.muted} testID="takeoffws-push-reason">{p.pushReason}</Text> : null}
        {p.skippedLines.map((s) => <Text key={s} style={styles.muted}>{s}</Text>)}
        {p.result ? (
          <View style={styles.result} testID="takeoffws-push-result">
            <Text style={styles.resultText}>
              {p.result.line}
              {' · '}
              <Text style={styles.link} onPress={p.onOpenEstimate} accessibilityRole="link">Open estimate</Text>
            </Text>
            <Text style={styles.muted}>{p.result.counts}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  panel: { width: Layout.column.rail, backgroundColor: t.surface, borderLeftWidth: 1, borderLeftColor: t.line },
  header: {
    height: Layout.control.toolbar,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Layout.cardPad,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  heading: { ...Type.footnoteEmphasized, color: t.text },
  segment: { flexDirection: 'row', borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.sm, overflow: 'hidden' },
  segBtn: { height: 28, paddingHorizontal: 10, justifyContent: 'center' },
  segBtnOn: { backgroundColor: t.surfaceAlt },
  segText: { ...Type.caption1, color: t.textMuted },
  segTextOn: { color: t.text, fontWeight: '600' },
  filterRow: { paddingHorizontal: Layout.cardPad, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.line },
  filterInput: {
    height: 28,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: Tokens.radius.sm,
    backgroundColor: t.bg,
    color: t.text,
    fontSize: 13,
  },
  list: { flex: 1 },
  starters: { paddingHorizontal: Layout.cardPad, paddingTop: Layout.cardPad, gap: 8 },
  startersLabel: { ...Type.caption1, color: t.textSecondary, fontWeight: '600' },
  starterWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  starter: {
    // Two per row in the 360 rail: (360 − 1 border − 2 × cardPad − 6 gap) / 2 ≈ 160.
    width: 160,
    minHeight: Layout.control.row,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: Tokens.radius.sm,
    justifyContent: 'center',
  },
  starterName: { fontSize: 12, fontWeight: '600', color: t.text },
  starterRate: { ...Type.caption2, color: t.textMuted },
  sub: { height: 32, flexDirection: 'row', alignItems: 'center', paddingLeft: 28, paddingRight: 8 },
  subSel: { backgroundColor: t.bg },
  subMain: { flex: 1, height: 32, justifyContent: 'center', minWidth: 0 },
  subText: { ...Type.caption1, color: t.textSecondary, fontVariant: ['tabular-nums'] },
  subDel: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: Tokens.radius.sm },
  subDelHidden: { opacity: 0 },
  conflict: { gap: 4, paddingVertical: 6, paddingHorizontal: 8, borderRadius: Tokens.radius.sm, backgroundColor: t.surfaceAlt },
  conflictActions: { flexDirection: 'row', gap: Layout.cardPad },
  emptyLine: { ...Type.footnote, color: t.textMuted, padding: Layout.cardPad },
  rowWrap: { borderBottomWidth: 1, borderBottomColor: t.line, borderLeftWidth: 3, borderLeftColor: 'transparent' },
  rowActive: { backgroundColor: t.surfaceAlt, borderLeftColor: t.accent },
  row: { minHeight: Layout.control.row, flexDirection: 'row', alignItems: 'center' },
  chevron: { width: 28, height: Layout.control.row, alignItems: 'center', justifyContent: 'center' },
  rowMain: { flex: 1, minHeight: Layout.control.row, flexDirection: 'row', alignItems: 'center', gap: Layout.rowGap, paddingRight: Layout.cardPad },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  name: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '600', color: t.text },
  qty: { fontSize: 13, fontWeight: '600', color: t.text, textAlign: 'right', fontVariant: ['tabular-nums'] },
  qtyMuted: { color: t.textMuted, fontWeight: '400' },
  unit: { width: 24, fontSize: 11, color: t.textMuted },
  amount: { width: 84, fontSize: 13, color: t.textSecondary, textAlign: 'right', fontVariant: ['tabular-nums'] },
  subline: { paddingLeft: 28 + 10 + Layout.rowGap, paddingRight: Layout.cardPad, paddingBottom: 6 },
  norate: { ...Type.caption1, color: t.accentLabel, fontWeight: '600' },
  warn: { ...Type.caption1, color: t.warningLabel },
  aiLine: { ...Type.caption1, color: t.textMuted },
  detail: { paddingLeft: 28, paddingRight: Layout.cardPad, paddingBottom: 10, gap: 6, alignItems: 'flex-start' },
  detailText: { ...Type.caption1, color: t.textSecondary },
  link: { ...Type.caption1, color: t.accentLabel, fontWeight: '600' },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 6, height: Layout.control.row, paddingHorizontal: Layout.cardPad },
  newText: { ...Type.footnote, color: t.textSecondary },
  footer: { borderTopWidth: 1, borderTopColor: t.line, padding: Layout.cardPad, gap: 6 },
  cost: { ...Type.footnoteEmphasized, color: t.text, fontVariant: ['tabular-nums'] },
  muted: { ...Type.caption1, color: t.textMuted },
  push: {
    marginTop: 4,
    minHeight: Layout.control.md,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Layout.cardPad,
  },
  pushOff: { opacity: 0.45 },
  pushText: { ...Type.bodyCompactEmphasized, color: '#FFFFFF' },
  result: { gap: 2, marginTop: 4 },
  resultText: { ...Type.caption1, color: t.text },
});
