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

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronRight, Hash, Minus, Plus, Square } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Layout, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import EstimateJobPicker from '@/components/estimate/EstimateJobPicker';
import { RateProvenanceChip } from '@/components/estimate/RateProvenanceChip';
import { formatMoneyFull } from '@/utils/jobCostEngine';
import type { ConditionKind, rollup } from '@/utils/takeoff/conditions';

export type PanelRow = ReturnType<typeof rollup>['rows'][number];
export type PanelFilter = 'sheet' | 'all';

const KIND_ICON: Record<ConditionKind, typeof Square> = { area: Square, linear: Minus, count: Hash };

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
}

const qtyText = (row: PanelRow): string => {
  if (row.totals.measuredCount === 0) return 'not measured';
  return row.price.qty.toLocaleString('en-US', { maximumFractionDigits: 2 });
};

export default function ConditionsPanel(p: ConditionsPanelProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState<Record<string, boolean>>({});

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

      <ScrollView style={styles.list}>
        {p.rows.length === 0 ? (
          <Text style={styles.emptyLine} testID="takeoffws-panel-empty">No conditions yet — press N or pick a tool to start one.</Text>
        ) : null}
        {p.rows.map((row) => {
          const c = row.condition;
          const active = c.id === p.activeId;
          const expanded = !!open[c.id];
          const Icon = KIND_ICON[c.kind];
          const unpriced = row.price.amountCents == null;
          const measured = row.totals.measuredCount > 0;
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
                  style={styles.rowMain}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${c.name}, ${qtyText(row)} ${measured ? row.totals.unit : ''}`}
                  testID={`takeoffws-row-press-${c.id}`}
                >
                  <View style={[styles.swatch, { backgroundColor: c.color }]} />
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
                      ? <Text style={styles.detailText}>your rate (typed)</Text>
                      : null}
                  <TouchableOpacity onPress={() => p.onEdit(c.id)} accessibilityRole="button" testID={`takeoffws-edit-${c.id}`}>
                    <Text style={styles.link}>Edit condition</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          );
        })}
        <TouchableOpacity onPress={p.onNew} style={styles.newRow} accessibilityRole="button" testID="takeoffws-new-condition">
          <Plus size={14} color={t.textSecondary} strokeWidth={1.75} />
          <Text style={styles.newText}>New condition (N)</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.cost} testID="takeoffws-cost-line">{p.costLine}</Text>
        {p.markupLine ? <Text style={styles.muted}>{p.markupLine}</Text> : null}
        <EstimateJobPicker label="Push to" jobs={p.jobs} selectedId={p.projectId ?? undefined} onPick={p.onPickJob} testID="takeoffws-push-to" />
        <Text style={styles.muted}>Saved on this browser</Text>
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
  list: { flex: 1 },
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
