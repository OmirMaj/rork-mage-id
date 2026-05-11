// TakeoffQuotaBadge — "X of Y pages remaining this month" indicator.
//
// Drop-in component for the upload surfaces (Plans, Takeoff) that shows
// the GC their current monthly takeoff page quota inline, before they
// pick a file. Pre-fix the only signal was a 429 after upload + render
// + cap exhaustion; this surfaces the math up front.
//
// Three rendering modes:
//   1. No file selected yet → static "X / Y pages remaining this month"
//   2. File picked → "Henderson_Plans.pdf · 30 pages · uses 30 of 270"
//      with a soft progress bar that highlights the would-be-charge.
//   3. File exceeds remaining → red banner + Upgrade CTA, runs the
//      `onUpgrade` handler when tapped (typically opens /paywall).
//
// Compact (single row) by default; the full status card is rendered
// when `variant="card"` so the upload screens can choose how prominent
// to make it. The card variant is used at first-load when there's no
// file selected.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { AlertTriangle, Crown, FileText, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTakeoffPagesQuota } from '@/hooks/useUsageStatus';

interface Props {
  /** Optional — when set, the badge previews "this file would use X pages
   *  of Y remaining". When null/undefined, it shows just the live total. */
  pendingPages?: number | null;
  /** File name to surface alongside pending page count. */
  pendingFileName?: string | null;
  /** Visual style. `card` is the prominent variant for the empty upload
   *  state; `inline` is the compact one shown next to the upload button. */
  variant?: 'card' | 'inline';
  /** Tapping the upgrade pill calls this — typically routes to /paywall. */
  onUpgrade?: () => void;
}

export function TakeoffQuotaBadge({ pendingPages, pendingFileName, variant = 'inline', onUpgrade }: Props) {
  const { used, cap, remaining, tier, isLoading } = useTakeoffPagesQuota();

  if (isLoading) {
    return (
      <View style={[styles.row, variant === 'card' && styles.card]}>
        <ActivityIndicator size="small" color={Colors.textMuted} />
        <Text style={styles.muted}>Loading quota…</Text>
      </View>
    );
  }

  // Free tier (or any tier with cap=0) gets an upgrade pitch instead of
  // a quota row — "0/0 pages remaining" reads weird.
  if (cap === 0) {
    return (
      <TouchableOpacity
        style={[styles.row, styles.upgradeRow, variant === 'card' && styles.card]}
        onPress={onUpgrade}
        activeOpacity={0.85}
      >
        <View style={styles.iconWrap}>
          <Crown size={14} color="#7C3AED" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.upgradeTitle}>Takeoffs are a Pro feature</Text>
          <Text style={styles.muted}>Tap to upgrade and start running AI takeoffs.</Text>
        </View>
      </TouchableOpacity>
    );
  }

  const exceeds = pendingPages != null && pendingPages > remaining;
  const willUse = pendingPages != null ? Math.min(pendingPages, remaining) : 0;
  const usedAfter = used + (pendingPages ?? 0);
  const pctFilled = Math.min(100, (used / cap) * 100);
  const pctPending = Math.min(100 - pctFilled, ((pendingPages ?? 0) / cap) * 100);

  // Color shifts as the user gets closer to their cap. Hard wall at
  // exceeds; warning at >80%; healthy otherwise.
  const meterTint = exceeds
    ? Colors.errorDark
    : usedAfter / cap > 0.8
      ? Colors.warningDark
      : Colors.primary;

  return (
    <View style={[styles.col, variant === 'card' && styles.card]}>
      {/* Top row — file name (if any) + headline number */}
      <View style={styles.topRow}>
        <View style={styles.iconWrap}>
          {exceeds ? <AlertTriangle size={14} color={Colors.errorDark} /> : <FileText size={14} color={Colors.primary} />}
        </View>
        <View style={{ flex: 1 }}>
          {pendingPages != null ? (
            <Text style={styles.title} numberOfLines={1}>
              {pendingFileName ? `${pendingFileName} · ` : ''}
              {pendingPages} {pendingPages === 1 ? 'page' : 'pages'}
            </Text>
          ) : (
            <Text style={styles.title}>Takeoff quota this month</Text>
          )}
          <Text style={[styles.subtitle, exceeds && { color: Colors.errorDark }]}>
            {pendingPages != null
              ? exceeds
                ? `Only ${remaining} of ${cap} pages left — won't fit.`
                : `Uses ${willUse} of ${remaining} remaining (${cap} ${tier ?? ''} cap)`
              : `${used} of ${cap} pages used · ${remaining} remaining`}
          </Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.meter}>
        <View style={[styles.meterFilled, { width: `${pctFilled}%`, backgroundColor: meterTint }]} />
        {pendingPages != null && !exceeds && (
          <View style={[styles.meterPending, { width: `${pctPending}%`, left: `${pctFilled}%`, backgroundColor: meterTint }]} />
        )}
      </View>

      {/* Exceeds → Upgrade CTA inline */}
      {exceeds && (
        <View style={styles.exceedRow}>
          <TouchableOpacity onPress={onUpgrade} style={styles.upgradePill} activeOpacity={0.85}>
            <TrendingUp size={12} color={Colors.surface} />
            <Text style={styles.upgradePillText}>Upgrade plan</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: Tokens.spacing.xs, paddingHorizontal: Tokens.spacing.sm,
  },
  col: {
    flexDirection: 'column', gap: Tokens.spacing.xs,
    paddingVertical: Tokens.spacing.xs, paddingHorizontal: Tokens.spacing.sm,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    borderWidth: 0.5, borderColor: Colors.borderLight,
    padding: 14, gap: 10,
  },
  upgradeRow: {
    backgroundColor: '#7C3AED' + '14',
    borderRadius: Tokens.radius.md,
  },
  iconWrap: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary + '14',
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.text },
  upgradeTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: '#7C3AED' },
  subtitle: { fontSize: Type.caption1.fontSize, color: Colors.textSecondary, marginTop: Tokens.spacing.hairline },
  muted: { fontSize: Type.caption1.fontSize, color: Colors.textMuted },
  meter: {
    height: 6, borderRadius: 3,
    backgroundColor: Colors.fillTertiary,
    overflow: 'hidden' as const,
    position: 'relative' as const,
  },
  meterFilled: {
    height: '100%', borderRadius: 3,
  },
  meterPending: {
    position: 'absolute' as const, top: 0, height: '100%',
    opacity: 0.4,
  },
  exceedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  upgradePill: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: Tokens.radius.sm,
    backgroundColor: '#7C3AED',
  },
  upgradePillText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: Colors.surface },
});
