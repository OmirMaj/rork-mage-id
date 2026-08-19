// components/subs/SubCredentialCard.tsx
//
// The thing an invited sub actually gets to keep: their own record across every
// GC who has hired them, in a form they can hand to a GC who has never heard of
// them. SUB-FACING — the profile it renders is built by utils/subNetwork, which
// guarantees there is no cost, rate, markup, or margin anywhere in it. This
// component adds none: it only draws what the engine produced.
//
// Presentational. All data arrives as props; the caller owns share/copy.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { BadgeCheck, ShieldCheck, Share2, Copy, Wrench, HardHat } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { SubNetworkProfile } from '@/utils/subNetwork';

function monthYear(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function Stat({
  value,
  label,
  styles,
}: {
  value: string;
  label: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>{label}</Text>
    </View>
  );
}

function Chip({
  label,
  tone,
  styles,
  t,
}: {
  label: string;
  tone: 'good' | 'neutral';
  styles: ReturnType<typeof makeStyles>;
  t: ThemeColors;
}) {
  const good = tone === 'good';
  return (
    <View style={[styles.chip, { backgroundColor: good ? t.successSoft : t.surfaceAlt }]}>
      {good ? <ShieldCheck size={12} color={t.success} strokeWidth={2.2} /> : null}
      <Text style={[styles.chipText, { color: good ? t.success : t.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function SubCredentialCard({
  profile,
  onShare,
  onCopy,
}: {
  profile: SubNetworkProfile;
  /** Send the credential to a new GC. Omit to hide the button. */
  onShare?: (text: string) => void;
  /** Copy the credential to the clipboard. Omit to hide the button. */
  onCopy?: (text: string) => void;
}) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { credential: c, reliability: r } = profile;

  const shareText = [c.summary, '', ...c.highlights.map((h) => `- ${h}`), '', c.verifiedLine]
    .join('\n')
    .trim();

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>Your record on MAGE ID</Text>

      <View style={styles.identityRow}>
        <View style={styles.avatar}>
          <HardHat size={20} color={t.accent} strokeWidth={1.9} />
        </View>
        <View style={styles.identityText}>
          <Text style={styles.name} numberOfLines={2}>{profile.companyName}</Text>
          {profile.trades.length > 0 ? (
            <View style={styles.tradeRow}>
              <Wrench size={12} color={t.textMuted} strokeWidth={2} />
              <Text style={styles.trades} numberOfLines={1}>{profile.trades.join(' · ')}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {profile.isEmpty ? (
        <Text style={styles.emptyBody}>
          Nothing linked yet. The moment a general contractor sends you a bid invite or a
          commitment through MAGE, the job lands here — and it stays yours, on every job,
          for every GC.
        </Text>
      ) : (
        <>
          <View style={styles.statRow}>
            <Stat value={String(c.jobCount)} label={c.jobCount === 1 ? 'job' : 'jobs'} styles={styles} />
            <View style={styles.statDivider} />
            <Stat value={String(c.gcCount)} label={c.gcCount === 1 ? 'general contractor' : 'general contractors'} styles={styles} />
            <View style={styles.statDivider} />
            <Stat value={String(c.jobsCompleted)} label="closed out" styles={styles} />
          </View>

          <View style={styles.chipRow}>
            {r.onTimePct != null ? (
              <Chip label={`${r.onTimePct}% on time`} tone="good" styles={styles} t={t} />
            ) : null}
            {r.punchCleanPct != null ? (
              <Chip label={`${r.punchCleanPct}% punch clean`} tone="good" styles={styles} t={t} />
            ) : null}
            <Chip
              label={r.coiCurrent ? `COI to ${monthYear(r.coiExpiryISO)}` : 'COI not current'}
              tone={r.coiCurrent ? 'good' : 'neutral'}
              styles={styles}
              t={t}
            />
            <Chip
              label={r.licenseCurrent ? `License to ${monthYear(r.licenseExpiryISO)}` : 'License not current'}
              tone={r.licenseCurrent ? 'good' : 'neutral'}
              styles={styles}
              t={t}
            />
            {r.w9OnFile ? <Chip label="W-9 on file" tone="good" styles={styles} t={t} /> : null}
          </View>

          {c.highlights.length > 0 ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.sectionLabel}>What a new GC sees</Text>
              {c.highlights.map((h, i) => (
                <View key={`hl-${i}`} style={styles.hlRow}>
                  <View style={styles.bullet} />
                  <Text style={styles.hlText}>{h}</Text>
                </View>
              ))}
            </>
          ) : null}
        </>
      )}

      <View style={styles.verifiedRow}>
        <BadgeCheck size={13} color={t.accent} strokeWidth={2} />
        <Text style={styles.verifiedText}>{c.verifiedLine}</Text>
      </View>

      {onShare || onCopy ? (
        <View style={styles.actionRow}>
          {onCopy ? (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => onCopy(shareText)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Copy your credential"
            >
              <Copy size={15} color={t.text} strokeWidth={1.9} />
              <Text style={styles.actionText}>Copy</Text>
            </TouchableOpacity>
          ) : null}
          {onShare ? (
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnPrimary]}
              onPress={() => onShare(shareText)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Send your credential to a general contractor"
            >
              <Share2 size={15} color={t.surface} strokeWidth={1.9} />
              <Text style={[styles.actionText, { color: t.surface }]}>Send to a GC</Text>
            </TouchableOpacity>
          ) : null}
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
      gap: Tokens.spacing.sm,
      ...Tokens.continuousCorners,
    },
    eyebrow: { ...Type.eyebrow, color: t.textMuted },

    identityRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: Tokens.radius.card,
      backgroundColor: t.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    identityText: { flex: 1, minWidth: 0, gap: 3 },
    name: { ...Type.title3, color: t.text },
    tradeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    trades: { ...Type.footnote, color: t.textSecondary, flexShrink: 1 },

    statRow: { flexDirection: 'row', alignItems: 'stretch', marginTop: Tokens.spacing.xxs },
    stat: { flex: 1, alignItems: 'center', gap: 2 },
    statValue: { ...Type.title2, color: t.text, fontVariant: ['tabular-nums'] },
    statLabel: { ...Type.caption2, color: t.textMuted, textAlign: 'center' },
    statDivider: { width: 1, backgroundColor: t.line, marginVertical: Tokens.spacing.xxs },

    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: Tokens.radius.full,
    },
    chipText: { ...Type.caption2, fontWeight: '600' },

    divider: { height: 1, backgroundColor: t.line, marginTop: Tokens.spacing.xxs },
    sectionLabel: { ...Type.eyebrow, color: t.textMuted },
    hlRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    bullet: {
      width: 4,
      height: 4,
      borderRadius: Tokens.radius.full,
      backgroundColor: t.accent,
      marginTop: 7,
    },
    hlText: { ...Type.footnote, color: t.text, flex: 1 },

    emptyBody: { ...Type.footnote, color: t.textSecondary },

    verifiedRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      backgroundColor: t.accentSoft,
      borderRadius: Tokens.radius.md,
      padding: 10,
    },
    verifiedText: { ...Type.caption1, color: t.text, flex: 1 },

    actionRow: { flexDirection: 'row', gap: 8 },
    actionBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: Tokens.touchTarget.min,
      borderRadius: Tokens.radius.md,
      borderWidth: 1,
      borderColor: t.line,
      backgroundColor: t.surfaceAlt,
      ...Tokens.continuousCorners,
    },
    actionBtnPrimary: { backgroundColor: t.accentFill, borderColor: t.accent },
    actionText: { ...Type.footnoteEmphasized, color: t.text },
  });

export default SubCredentialCard;
