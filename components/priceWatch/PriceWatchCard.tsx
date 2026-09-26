// components/priceWatch/PriceWatchCard.tsx — PRICE WATCH on the receipts
// screen (app/material-receipt.tsx), read from receipts he REVIEWED.
//
// Two sections, both from utils/receiptPriceWatch (pure, validated by
// scripts/validate-receipt-price-watch.ts):
//   • "You paid more at one yard" — the same item, same unit, two suppliers.
//   • "Prices moved on an open estimate" — an unsigned estimate priced a line
//     at one price and his latest receipt says another. Reprice writes the
//     estimate ONLY on an explicit tap, after a confirm line showing the grand
//     total before → after, through commitEstimatePatch (the old estimate is
//     kept as a revision). Keep is remembered on this device only
//     (PRICE_WATCH_KEPT_KEY, swept at sign-out) and says so.
//
// No new tier gate: the card rides the receipts screen's own 'job_costing' gate.
// Renders null when there is nothing to say; with fewer than two reviewed
// receipts it says what it needs instead of implying "all clear".
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChevronDown, ChevronUp, TrendingUp } from 'lucide-react-native';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Card, Button, EyebrowLabel } from '@/components/ui';
import { commitEstimatePatch } from '@/utils/estimateCommit';
import { formatCalendarDay } from '@/utils/calendarDate';
import {
  PRICE_WATCH_KEPT_KEY,
  estimateDrift,
  keptKeyFor,
  repriceEstimate,
  supplierSpreads,
  vendorKey,
  type DriftFinding,
  type SpreadFinding,
} from '@/utils/receiptPriceWatch';
import type { Project } from '@/types';

const MAX_SPREADS = 3;
const MAX_LINES_PER_PROJECT = 3;
const WINDOW_DAYS = 30;

/** Whole dollars from cents: 41234 → "$412". */
function dollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${Math.round(Math.abs(cents) / 100).toLocaleString('en-US')}`;
}
/** Signed whole dollars: "+$1,240" / "-$80". */
function signedDollars(cents: number): string {
  return `${cents >= 0 ? '+' : '-'}$${Math.round(Math.abs(cents) / 100).toLocaleString('en-US')}`;
}
/** A unit price to the cent: 1248 → "$12.48". */
function unitMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function shortDay(day: string): string {
  return formatCalendarDay(day, { month: 'short', day: 'numeric' });
}

interface ProjectDrift {
  project: Project;
  drifts: DriftFinding[];
  pct: number;
  allUp: boolean;
  allDown: boolean;
  costDeltaCents: number;
  sellDeltaCents: number;
  grandBefore: number;
  grandAfter: number;
}

export function PriceWatchCard({ projectId }: { projectId?: string }) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { projects, updateProject } = useProjects();
  const { receipts } = useMaterialReceipts();

  const [kept, setKept] = useState<Set<string>>(() => new Set());
  const [openSpread, setOpenSpread] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [repriced, setRepriced] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(PRICE_WATCH_KEPT_KEY);
        const arr: unknown = raw ? JSON.parse(raw) : [];
        if (alive && Array.isArray(arr)) setKept(new Set(arr.filter((x): x is string => typeof x === 'string')));
      } catch {
        // No storage (private window, blocked site data): nothing was kept.
      }
    })();
    return () => { alive = false; };
  }, []);

  const reviewedCount = useMemo(() => receipts.filter(r => r.status === 'reviewed').length, [receipts]);
  const spreads = useMemo<SpreadFinding[]>(
    () => supplierSpreads(receipts, Date.now(), WINDOW_DAYS).slice(0, MAX_SPREADS),
    [receipts],
  );

  const byProject = useMemo<ProjectDrift[]>(() => {
    const drifts = estimateDrift(projects, receipts).filter(d => !kept.has(keptKeyFor(d)));
    const groups = new Map<string, DriftFinding[]>();
    for (const d of drifts) {
      const list = groups.get(d.projectId);
      if (list) list.push(d); else groups.set(d.projectId, [d]);
    }
    const out: ProjectDrift[] = [];
    for (const [pid, list] of groups) {
      const project = projects.find(p => p.id === pid);
      const est = project?.linkedEstimate;
      if (!project || !est) continue;
      let pricedCents = 0;
      for (const d of list) {
        const qty = Number(est.items.find(i => i.materialId === d.materialId)?.quantity) || 0;
        pricedCents += qty * d.pricedUnitCents;
      }
      const net = list.reduce((s, d) => s + d.deltaCents, 0);
      const { next, costDeltaCents, sellDeltaCents } = repriceEstimate(est, list);
      out.push({
        project,
        drifts: list,
        pct: pricedCents > 0 ? Math.round((net / pricedCents) * 100) : 0,
        allUp: list.every(d => d.pct > 0),
        allDown: list.every(d => d.pct < 0),
        costDeltaCents,
        sellDeltaCents,
        grandBefore: Math.round((Number(est.grandTotal) || 0) * 100),
        grandAfter: Math.round((Number(next.grandTotal) || 0) * 100),
      });
    }
    // This screen's own job first, then the biggest move.
    return out.sort((a, b) =>
      (a.project.id === projectId ? -1 : 0) - (b.project.id === projectId ? -1 : 0)
      || Math.abs(b.sellDeltaCents) - Math.abs(a.sellDeltaCents));
  }, [projects, receipts, kept, projectId]);

  const persistKept = useCallback((next: Set<string>) => {
    setKept(next);
    void (async () => {
      try { await AsyncStorage.setItem(PRICE_WATCH_KEPT_KEY, JSON.stringify([...next])); } catch { /* device-only memory; the card still hides it this session */ }
    })();
  }, []);

  const keep = useCallback((g: ProjectDrift) => {
    const next = new Set(kept);
    for (const d of g.drifts) next.add(keptKeyFor(d));
    persistKept(next);
    setConfirming(null);
  }, [kept, persistKept]);

  const reprice = useCallback((g: ProjectDrift) => {
    const est = g.project.linkedEstimate;
    if (!est) return;
    const { next } = repriceEstimate(est, g.drifts);
    updateProject(g.project.id, commitEstimatePatch(g.project, next, { reason: 'manual', note: 'Repriced from your receipts' }));
    setRepriced(prev => new Set(prev).add(g.project.id));
    setConfirming(null);
  }, [updateProject]);

  if (reviewedCount < 2) {
    return (
      <View testID="pricewatch-card" style={styles.quietWrap}>
        <Text style={styles.quietLine}>Price watch compares your reviewed receipts — it needs the same item from two suppliers.</Text>
      </View>
    );
  }

  const groups = byProject.filter(g => !repriced.has(g.project.id));
  if (spreads.length === 0 && groups.length === 0 && repriced.size === 0) return null;

  return (
    <View testID="pricewatch-card" style={styles.wrap}>
      <Card pad={Tokens.spacing.md} radius="md">
        <EyebrowLabel tone="neutral" showDot={false}>Price watch</EyebrowLabel>
        <Text style={styles.muted}>From receipts you reviewed.</Text>

        {spreads.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>You paid more at one yard</Text>
            {spreads.map(s => {
              const open = openSpread === s.key;
              const dearReceipts = new Set(s.evidence.filter(e => vendorKey(e.vendor) === vendorKey(s.dearVendor)).map(e => e.receiptId)).size;
              return (
                <View key={s.key} style={styles.row}>
                  <TouchableOpacity
                    onPress={() => setOpenSpread(open ? null : s.key)}
                    style={styles.rowPress}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open }}
                    testID={`pricewatch-spread-${s.key}`}
                  >
                    <TrendingUp size={14} color={t.warningLabel} strokeWidth={1.75} style={styles.rowIcon} />
                    <Text style={styles.rowText}>
                      {`${s.label} · ${s.pctMore}% more at ${s.dearVendor} than ${s.cheapVendor} in the last ${WINDOW_DAYS} days · ${dollars(s.overpaidCents)} across ${dearReceipts} receipt${dearReceipts === 1 ? '' : 's'}`}
                    </Text>
                    {open
                      ? <ChevronUp size={14} color={t.textMuted} strokeWidth={1.75} />
                      : <ChevronDown size={14} color={t.textMuted} strokeWidth={1.75} />}
                  </TouchableOpacity>
                  {open ? (
                    <View style={styles.evidence}>
                      {s.evidence.map((e, i) => (
                        <Text key={`${e.receiptId}-${i}`} style={styles.evidenceLine}>
                          {`${e.vendor} · ${shortDay(e.date)} · ${e.qty} ${s.unit} at ${unitMoney(e.unitCents)}`}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {groups.length > 0 || repriced.size > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Prices moved on an open estimate</Text>
            {repriced.size > 0 ? (
              <Text style={styles.muted}>Repriced from your receipts — the earlier estimate is kept in its revision history.</Text>
            ) : null}
            {groups.map(g => {
              const n = g.drifts.length;
              const lines = `${n} line${n === 1 ? '' : 's'}`;
              const move = g.allUp
                ? `${n === 1 ? 'is' : 'are'} up ${Math.abs(g.pct)}% on your latest receipts`
                : g.allDown
                  ? `${n === 1 ? 'is' : 'are'} down ${Math.abs(g.pct)}% on your latest receipts`
                  : `moved on your latest receipts (net ${g.pct >= 0 ? '+' : ''}${g.pct}%)`;
              const isConfirming = confirming === g.project.id;
              return (
                <View key={g.project.id} style={styles.row} testID={`pricewatch-drift-${g.project.id}`}>
                  <Text style={styles.rowTextStrong}>{`${g.project.name} · ${lines} ${move}`}</Text>
                  {g.drifts.slice(0, MAX_LINES_PER_PROJECT).map(d => (
                    <Text key={`${d.materialId}-${d.latestReceiptLineId}`} style={styles.evidenceLine}>
                      {`${d.itemName}: priced ${unitMoney(d.pricedUnitCents)}/${d.unit}, paid ${unitMoney(d.latestUnitCents)} at ${d.latestVendor} on ${shortDay(d.latestDate)}`}
                    </Text>
                  ))}
                  {n > MAX_LINES_PER_PROJECT ? (
                    <Text style={styles.evidenceLine}>{`and ${n - MAX_LINES_PER_PROJECT} more`}</Text>
                  ) : null}
                  {isConfirming ? (
                    <View style={styles.confirm}>
                      <Text style={styles.confirmText}>
                        {`Grand total ${unitMoney(g.grandBefore)} → ${unitMoney(g.grandAfter)}. Each line keeps its own markup.`}
                      </Text>
                      <View style={styles.actions}>
                        <Button label="Reprice now" variant="primary" size="sm" onPress={() => reprice(g)} testID={`pricewatch-confirm-${g.project.id}`} />
                        <Button label="Cancel" variant="secondary" size="sm" onPress={() => setConfirming(null)} testID={`pricewatch-cancel-${g.project.id}`} />
                      </View>
                    </View>
                  ) : (
                    <View style={styles.actions}>
                      <Button
                        label={`Reprice (${signedDollars(g.sellDeltaCents)})`}
                        variant="secondary"
                        size="sm"
                        onPress={() => setConfirming(g.project.id)}
                        testID={`pricewatch-reprice-${g.project.id}`}
                      />
                      <Button label="Keep" variant="secondary" size="sm" onPress={() => keep(g)} testID={`pricewatch-keep-${g.project.id}`} />
                    </View>
                  )}
                  <Text style={styles.muted}>Keep is saved on this device until you sign out.</Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

export default PriceWatchCard;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { marginTop: 22 },
  quietWrap: { marginTop: 22 },
  quietLine: { ...Type.footnote, color: t.textMuted },
  muted: { ...Type.footnote, color: t.textMuted, marginTop: 4 },
  section: { marginTop: 12, gap: 8 },
  sectionTitle: { ...Type.subheadEmphasized, color: t.text },
  row: { gap: 4 },
  rowPress: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  rowIcon: { marginTop: 2 },
  rowText: { ...Type.subhead, color: t.text, flex: 1 },
  rowTextStrong: { ...Type.subheadEmphasized, color: t.text },
  evidence: { marginLeft: 22, gap: 2 },
  evidenceLine: { ...Type.footnote, color: t.textSecondary },
  confirm: { marginTop: 6, gap: 6 },
  confirmText: { ...Type.footnote, color: t.text },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 6 },
});
