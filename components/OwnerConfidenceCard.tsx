// components/OwnerConfidenceCard.tsx
//
// The owner's "is my project on time & on budget?" card — the top of the
// client portal view. CLIENT-FACING: contract/billing only, never the GC's
// cost or margin. Data comes from utils/ownerConfidence (pure, tested).

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CheckCircle2, Clock, AlertCircle, Flag, BellRing } from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { formatMoney } from '@/utils/formatters';
import type { OwnerConfidence, ConfidenceStatus } from '@/utils/ownerConfidence';

function statusColor(s: ConfidenceStatus, t: ThemeColors): string {
  if (s === 'on_track' || s === 'complete') return t.success;
  if (s === 'minor_delays') return Colors.warning;
  if (s === 'behind') return t.danger;
  return t.textSecondary; // not_started
}

const STATUS_ICON: Record<ConfidenceStatus, typeof CheckCircle2> = {
  on_track: CheckCircle2,
  complete: CheckCircle2,
  minor_delays: Clock,
  behind: AlertCircle,
  not_started: Clock,
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso + 'T00:00:00');
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function BillRow({
  label,
  value,
  styles,
  emphasize,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof makeStyles>;
  emphasize?: boolean;
}) {
  return (
    <View style={styles.billRow}>
      <Text style={emphasize ? styles.billLabelEmph : styles.billLabel}>{label}</Text>
      <Text style={emphasize ? styles.billValueEmph : styles.billValue}>{value}</Text>
    </View>
  );
}

export function OwnerConfidenceCard({
  confidence: c,
  showBudget = true,
}: {
  confidence: OwnerConfidence;
  showBudget?: boolean;
}) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const sc = statusColor(c.status, t);
  const SIcon = STATUS_ICON[c.status];
  const paidPct =
    c.billing.revisedContract > 0
      ? Math.round(Math.min(1, c.billing.paid / c.billing.revisedContract) * 100)
      : 0;

  return (
    <View style={styles.card}>
      {/* Status + est. completion */}
      <View style={styles.heroRow}>
        <View style={[styles.statusPill, { backgroundColor: sc + '18' }]}>
          <SIcon size={13} color={sc} strokeWidth={2.25} />
          <Text style={[styles.statusText, { color: sc }]}>{c.statusLabel}</Text>
        </View>
        {c.projectedFinishISO && c.status !== 'complete' ? (
          <Text style={styles.finishText} numberOfLines={1}>
            Est. completion {fmtDate(c.projectedFinishISO)}
          </Text>
        ) : null}
      </View>

      {/* Progress */}
      {c.hasSchedule ? (
        <View style={styles.progressBlock}>
          <View style={styles.progressLabelRow}>
            <Text style={styles.progressPct}>{c.pctComplete}%</Text>
            <Text style={styles.progressLabel}>complete</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${c.pctComplete}%`, backgroundColor: sc }]} />
          </View>
        </View>
      ) : null}

      {/* Billing — client-facing only; hidden when the portal disables budget. */}
      {showBudget ? (
        <>
          <View style={styles.divider} />
          <View style={styles.billRows}>
            <BillRow label="Contract" value={formatMoney(c.billing.contract)} styles={styles} />
            {c.billing.approvedChanges !== 0 ? (
              <BillRow
                label="Approved changes"
                value={(c.billing.approvedChanges > 0 ? '+' : '') + formatMoney(c.billing.approvedChanges)}
                styles={styles}
              />
            ) : null}
            {c.billing.approvedChanges !== 0 ? (
              <BillRow label="Revised contract" value={formatMoney(c.billing.revisedContract)} styles={styles} emphasize />
            ) : null}
            <BillRow label="Invoiced to date" value={formatMoney(c.billing.billed)} styles={styles} />
            <BillRow label="Paid" value={formatMoney(c.billing.paid)} styles={styles} />
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${paidPct}%`, backgroundColor: t.success }]} />
          </View>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>Balance remaining</Text>
            <Text style={styles.balanceValue}>{formatMoney(c.billing.balance)}</Text>
          </View>
        </>
      ) : null}

      {/* What's next */}
      {c.nextMilestones.length > 0 ? (
        <>
          <View style={styles.divider} />
          <Text style={styles.sectionLabel}>What's next</Text>
          {c.nextMilestones.map((m, i) => (
            <View key={`${m.title}-${i}`} style={styles.mRow}>
              <Flag size={13} color={t.accent} strokeWidth={2} />
              <Text style={styles.mTitle} numberOfLines={1}>{m.title}</Text>
              <Text style={styles.mDate}>{fmtDate(m.dateISO)}</Text>
            </View>
          ))}
        </>
      ) : null}

      {/* Needs the owner */}
      {c.awaitingApproval > 0 ? (
        <View style={[styles.awaitRow, { backgroundColor: Colors.warning + '15', borderColor: Colors.warning + '40' }]}>
          <BellRing size={14} color={Colors.warning} strokeWidth={2} />
          <Text style={styles.awaitText}>
            {c.awaitingApproval} {c.awaitingApproval === 1 ? 'item needs' : 'items need'} your approval
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
      padding: Tokens.spacing.md,
      marginHorizontal: 16,
      marginBottom: 12,
    },
    heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    statusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: Tokens.radius.full,
    },
    statusText: { ...Type.footnoteEmphasized },
    finishText: { ...Type.caption1, color: t.textSecondary, flexShrink: 1, textAlign: 'right' },
    progressBlock: { marginTop: Tokens.spacing.md },
    progressLabelRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, marginBottom: 6 },
    progressPct: { ...Type.title2, color: t.text },
    progressLabel: { ...Type.footnote, color: t.textSecondary, marginBottom: 3 },
    track: { height: 8, borderRadius: Tokens.radius.full, backgroundColor: t.surfaceAlt, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: Tokens.radius.full },
    divider: { height: 1, backgroundColor: t.line, marginVertical: Tokens.spacing.md },
    billRows: { gap: 7, marginBottom: 10 },
    billRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    billLabel: { ...Type.footnote, color: t.textSecondary },
    billLabelEmph: { ...Type.footnoteEmphasized, color: t.text },
    billValue: { ...Type.footnote, color: t.text, fontVariant: ['tabular-nums'] },
    billValueEmph: { ...Type.subheadEmphasized, color: t.text, fontVariant: ['tabular-nums'] },
    balanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
    balanceLabel: { ...Type.subheadEmphasized, color: t.text },
    balanceValue: { ...Type.subheadEmphasized, color: t.text, fontVariant: ['tabular-nums'] },
    sectionLabel: {
      ...Type.caption1,
      color: t.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 8,
      fontWeight: '700',
    },
    mRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
    mTitle: { ...Type.footnote, color: t.text, flex: 1 },
    mDate: { ...Type.caption1, color: t.textSecondary },
    awaitRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: Tokens.spacing.md,
      padding: 10,
      borderRadius: Tokens.radius.md,
      borderWidth: 1,
    },
    awaitText: { ...Type.footnote, color: t.text, flex: 1, fontWeight: '600' },
  });

export default OwnerConfidenceCard;
